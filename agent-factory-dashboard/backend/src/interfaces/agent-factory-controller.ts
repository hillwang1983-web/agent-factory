import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import type { AgentFactoryMonitorUseCase } from '../application/agent-factory-monitor';
import type { ProjectOnboardingUseCase } from '../application/project-onboarding';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import type { Logger } from 'pino';
import { HermesConfigRepository } from '../infrastructure/hermes-config-repository';
import { AgentModelSettingsRepository } from '../infrastructure/agent-model-settings-repository';
import { loadAppConfig } from '../config';
import { broadcastOrchestratorEvent, activeOrchestrators } from '../websocket/broadcaster';
import type { AgentFactoryArtifactEdit, AgentFactoryReview } from '../domain/agent-factory';
import { OrchestrationOperationStore } from '../application/orchestration-operation-store';
import { EpicMonitor } from '../application/epic-monitor';
import { RegistryLock } from '../infrastructure/registry-lock';

const config = loadAppConfig();
const operationStore = OrchestrationOperationStore.getInstance();

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

import { ProjectRepository } from '../domain/project-repository';
import { AgentFactoryRepository } from '../domain/agent-factory-repository';
import { ProjectAduFactory } from '../application/project-adu-factory';
import { AduIntake } from '../application/adu-intake';
import { EpicFactory } from '../application/epic-factory';
import multer from 'multer';

import { FileOperatorRepository } from '../infrastructure/operator/file-operator-repository';
import { OperatorLockService } from '../infrastructure/operator/operator-lock-service';
import { NextActionAdvisor } from '../application/operator/next-action-advisor';
import { OperatorControl } from '../application/operator/operator-control';
import { OperatorActionType } from '../domain/operator';

export function createAgentFactoryRouter(
  monitor: AgentFactoryMonitorUseCase,
  projectOnboarding: ProjectOnboardingUseCase,
  projectRepository: ProjectRepository,
  agentFactoryRepository: AgentFactoryRepository,
  logger: Logger,
  aduIntake: AduIntake,
  epicFactory: EpicFactory
): Router {
  const router = Router();
  const upload = multer({ dest: '/tmp/' });
  const epicMonitor = new EpicMonitor(agentFactoryRepository);

  const operatorRepo = new FileOperatorRepository(config.workspaceRoot);
  const operatorLock = new OperatorLockService(config.workspaceRoot);
  const nextActionAdvisor = new NextActionAdvisor();



  const resolveWorkspaceRootOverride = async (aduId?: string): Promise<string | undefined> => {
    if (!aduId) return undefined;
    const adu = await monitor.getAdu(aduId);
    if (!adu || !adu.project_id) return undefined;
    const project = await projectOnboarding.getProject(adu.project_id);
    if (!project) return undefined;
    return project.repo_path;
  };

  const approveReviewHelper = async (
    aduId: string,
    gate: 'analysis' | 'design',
    comment: string | undefined,
    requestedBy: string
  ): Promise<{ nextState: string }> => {
    return RegistryLock.runLocked(async () => {
      const adus = await monitor.repo.readAdus();
      const adu = adus.find((a) => a.id === aduId);
      if (!adu) {
        const err = new Error(`ADU ${aduId} not found`);
        (err as any).status = 404;
        throw err;
      }

      const expectedState = gate === 'analysis' ? 'analysis_review' : 'design_review';
      if (adu.state !== expectedState) {
        const err = new Error(`ADU state must be ${expectedState} to approve`);
        (err as any).status = 400;
        throw err;
      }

      if (gate === 'analysis') {
        const hasPendingBlocking = adu.clarification_questions?.some(
          (q: any) => q.blocking && q.status === 'pending'
        );
        if (hasPendingBlocking) {
          const err = new Error('存在未解答的阻塞性澄清问题，请先解答或延期。');
          (err as any).status = 400;
          throw err;
        }
      }

      const nextState = gate === 'analysis' ? 'analyzed' : 'designed';
      const artifactPath = gate === 'analysis'
        ? `.ai-agent/analysis/${aduId}.md`
        : `.ai-agent/designs/${aduId}-detailed-design.md`;

      const workspaceRootOverride = await resolveWorkspaceRootOverride(aduId);
      let sha256 = '';
      try {
        const art = await monitor.repo.readTextArtifact(artifactPath, 200000, workspaceRootOverride);
        if (!art || !art.content || art.content.trim() === '') {
          const err = new Error(`审核文档 ${artifactPath} 内容为空，无法批准审核。`);
          (err as any).status = 400;
          throw err;
        }
        if (art.truncated) {
          const err = new Error(`审核文档 ${artifactPath} 超过大小限制被截断，无法验证完整性，请先修整文档。`);
          (err as any).status = 409;
          throw err;
        }
        const crypto = await import('crypto');
        sha256 = crypto.createHash('sha256').update(art.content, 'utf-8').digest('hex');
      } catch (err: any) {
        const wrappedErr = new Error(`无法读取审核文档 ${artifactPath}，请确保文档已被 Agent 正常生成：${err.message || '文件不存在'}`);
        (wrappedErr as any).status = 400;
        throw wrappedErr;
      }

      const reviews = await monitor.repo.readReviews();
      let review = reviews.find((r) => r.adu_id === aduId && r.gate === gate && r.status === 'pending');

      if (review) {
        review.status = 'approved';
        review.updated_at = new Date().toISOString();
        review.approved_at = new Date().toISOString();
        review.approved_by = requestedBy;
        review.comment = comment || null;
        review.approved_hashes = { [artifactPath]: sha256 };
      } else {
        review = {
          review_id: `review-${aduId}-${gate}-${Date.now()}`,
          adu_id: aduId,
          gate,
          state: expectedState,
          status: 'approved',
          artifact_paths: [artifactPath],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          approved_at: new Date().toISOString(),
          approved_by: requestedBy,
          comment: comment || null,
          approved_hashes: { [artifactPath]: sha256 }
        };
        reviews.push(review);
      }

      await monitor.repo.writeReviews(reviews);

      if (gate === 'design' && Array.isArray(adu.pending_design_write_paths) && adu.pending_design_write_paths.length > 0) {
        const blockedPrefixes = ['.git/', '.agent-factory/', '.ai-agent/registry/', '~/', '/Users/', '/home/', '/etc/', '/tmp/', '/var/'];
        const normalize = (raw: string): string | null => {
          if (typeof raw !== 'string') return null;
          const value = raw.trim().replace(/\\/g, '/');
          if (!value || value.startsWith('/') || value.includes('\0')) return null;
          if (value.split('/').includes('..')) return null;
          if (blockedPrefixes.some((prefix) => value.startsWith(prefix) || value === prefix.replace(/\/$/, ''))) return null;
          return value;
        };
        const safePaths = adu.pending_design_write_paths
          .map((p) => normalize(p))
          .filter((p): p is string => Boolean(p));
        adu.allowed_write_paths = adu.allowed_write_paths ?? [];
        adu.allowed_read_paths = adu.allowed_read_paths ?? [];
        for (const pathToAdd of safePaths) {
          if (!adu.allowed_write_paths.includes(pathToAdd)) adu.allowed_write_paths.push(pathToAdd);
          if (!adu.allowed_read_paths.includes(pathToAdd)) adu.allowed_read_paths.push(pathToAdd);
        }
        adu.pending_design_write_paths = [];
      }

      adu.state = nextState;
      await monitor.repo.writeAdus(adus);

      const wsEvent = {
        type: 'agentFactoryEvent',
        event: 'review_approved',
        aduId,
        gate,
        toState: nextState
      };
      broadcastOrchestratorEvent(wsEvent);

      return { nextState };
    });
  };

  const requestReworkHelper = async (
    aduId: string,
    gate: 'analysis' | 'design',
    comment: string | undefined,
    requestedBy: string
  ): Promise<{ reworkState: string }> => {
    return RegistryLock.runLocked(async () => {
      if (!comment) {
        const err = new Error('Rework reason/comment is required');
        (err as any).status = 400;
        throw err;
      }

      const adus = await monitor.repo.readAdus();
      const adu = adus.find((a) => a.id === aduId);
      if (!adu) {
        const err = new Error(`ADU ${aduId} not found`);
        (err as any).status = 404;
        throw err;
      }

      const expectedState = gate === 'analysis' ? 'analysis_review' : 'design_review';
      if (adu.state !== expectedState) {
        const err = new Error(`ADU state must be ${expectedState} to request rework`);
        (err as any).status = 400;
        throw err;
      }

      const reworkState = gate === 'analysis' ? 'created' : 'contexted';
      const artifactPath = gate === 'analysis'
        ? `.ai-agent/analysis/${aduId}.md`
        : `.ai-agent/designs/${aduId}-detailed-design.md`;

      const reviews = await monitor.repo.readReviews();
      let review = reviews.find((r) => r.adu_id === aduId && r.gate === gate && r.status === 'pending');

      if (review) {
        review.status = 'rework_requested';
        review.updated_at = new Date().toISOString();
        review.comment = comment || null;
      } else {
        review = {
          review_id: `review-${aduId}-${gate}-${Date.now()}`,
          adu_id: aduId,
          gate,
          state: expectedState,
          status: 'rework_requested',
          artifact_paths: [artifactPath],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          approved_at: null,
          approved_by: null,
          comment,
          approved_hashes: {}
        };
        reviews.push(review);
      }

      await monitor.repo.writeReviews(reviews);

      if (gate === 'analysis') {
        const existingClarifications = Array.isArray(adu.clarifications) ? adu.clarifications : [];
        adu.clarifications = [
          ...existingClarifications,
          {
            question: '需求分析审核澄清/返工意见',
            status: 'answered',
            answer: comment,
            impact: 'design',
            updated_at: new Date().toISOString()
          }
        ];
      }
      adu.state = reworkState;
      await monitor.repo.writeAdus(adus);

      const wsEvent = {
        type: 'agentFactoryEvent',
        event: 'review_rework_requested',
        aduId,
        gate,
        toState: reworkState
      };
      broadcastOrchestratorEvent(wsEvent);

      return { reworkState };
    });
  };

  const runnerDelegate = {
    async spawnAduOrchestrator(aduId: string, mode: 'start' | 'continue' | 'step'): Promise<any> {
      return spawnOrchestrator(aduId, mode);
    },
    async spawnEpicOrchestrator(epicId: string, mode: 'start' | 'continue' | 'step'): Promise<any> {
      return spawnEpicOrchestrator(epicId, mode);
    },
    async executeNonDirectAction(action: any): Promise<any> {
      const targetId = action.target.id;
      const targetType = action.target.type;
      const payload = action.payload;

      if (action.action === 'answer_clarifications') {
        const { question_id, answer } = payload as { question_id: string; answer: string };
        if (!question_id || !answer) {
          throw Object.assign(new Error('question_id and answer are required payload fields'), { status: 400 });
        }
        const adus = await monitor.repo.readAdus();
        const adu = adus.find((a) => a.id === targetId);
        if (!adu) {
          throw Object.assign(new Error(`ADU ${targetId} not found`), { status: 404 });
        }
        if (!adu.clarification_questions) {
          throw Object.assign(new Error('No clarification questions found on this ADU'), { status: 404 });
        }
        const question = adu.clarification_questions.find((q: any) => q.id === question_id);
        if (!question) {
          throw Object.assign(new Error(`Question ${question_id} not found`), { status: 404 });
        }

        question.status = 'answered';
        question.answer = answer;
        question.answered_at = new Date().toISOString();

        adu.clarifications = adu.clarifications ?? [];
        adu.clarifications = adu.clarifications.filter((c: any) => c.question !== question.question);
        adu.clarifications.push({
          question: question.question,
          answer: question.answer || '',
          status: 'answered',
          impact: (question as any).impact || 'unknown',
          updated_at: question.answered_at || new Date().toISOString()
        });

        await monitor.repo.writeAdus(adus);
        broadcastOrchestratorEvent({
          type: 'agentFactoryEvent',
          event: 'clarification_answered',
          aduId: targetId,
          questionId: question_id,
          answer
        });

        return { success: true, message: 'Clarification answered successfully' };
      }

      if (action.action === 'approve_review' || action.action === 'request_rework') {
        const comment = payload?.comment || '';

        if (targetType === 'adu') {
          const adu = await monitor.repo.getAduById(targetId);
          if (!adu) throw Object.assign(new Error(`ADU ${targetId} not found`), { status: 404 });

          let gate: 'analysis' | 'design' | 'token_budget' | null = null;
          if (adu.state === 'analysis_review') gate = 'analysis';
          else if (adu.state === 'design_review') gate = 'design';
          else if (adu.state === 'human_gate' && adu.gate_type === 'token_budget_approval') gate = 'token_budget';

          if (!gate) {
            throw Object.assign(new Error(`State ${adu.state} does not support review approval/rework`), { status: 400 });
          }

          if (gate === 'token_budget') {
            const HumanGateService = (await import('../application/human-gate-service')).HumanGateService;
            const humanGateService = HumanGateService.getInstance();
            const activeGates = await humanGateService.listGates();
            const targetGate = activeGates.find((g: any) => g.target_id === targetId && g.gate_type === 'token_budget_approval' && g.status === 'pending');

            if (action.action === 'approve_review') {
              await humanGateService.approveGate(targetGate?.gate_id || '', comment);
            } else {
              await humanGateService.cancelGate(targetGate?.gate_id || '', comment || 'Rejected budget');
            }
            return { success: true };
          } else {
            if (action.action === 'approve_review') {
              const helperRes = await approveReviewHelper(targetId, gate, comment, action.requested_by);
              return { success: true, toState: helperRes.nextState };
            } else {
              const helperRes = await requestReworkHelper(targetId, gate, comment || 'Rework requested by Operator', action.requested_by);
              return { success: true, toState: helperRes.reworkState };
            }
          }
        } else if (targetType === 'epic') {
          const epic = await epicMonitor.getEpic(targetId);
          if (!epic) throw Object.assign(new Error(`Epic ${targetId} not found`), { status: 404 });
          if (epic.state !== 'epic_acceptance') {
            throw Object.assign(new Error('Epic state must be epic_acceptance'), { status: 400 });
          }

          const epics = await agentFactoryRepository.readEpics();
          const targetEpic = epics.find(e => e.id === targetId);
          if (targetEpic) {
            targetEpic.state = action.action === 'approve_review' ? 'epic_evidenced' : 'epic_failed';
            await agentFactoryRepository.saveEpic(targetEpic);
          }

          broadcastOrchestratorEvent({
            type: 'agentFactoryEvent',
            event: action.action === 'approve_review' ? 'epic_approved' : 'epic_rework_requested',
            epicId: targetId
          });

          return { success: true, message: 'Epic review processed successfully' };
        }
      }

      if (action.action === 'approve_write_path' || action.action === 'reject_write_path') {
        const { request_id } = payload as { request_id: string };
        if (!request_id) {
          throw Object.assign(new Error('request_id is required'), { status: 400 });
        }

        const p = path.join(config.workspaceRoot, '.ai-agent', 'registry', 'write-path-expansion-requests.json');
        let data = { version: 1, requests: [] as any[] };
        try {
          data = JSON.parse(await fs.promises.readFile(p, 'utf-8'));
        } catch (e) {}

        const reqIndex = data.requests.findIndex((r: any) => r.request_id === request_id && r.adu_id === targetId);
        if (reqIndex === -1) {
          throw Object.assign(new Error(`Request ${request_id} not found for ADU ${targetId}`), { status: 404 });
        }

        const expansionRequest = data.requests[reqIndex];
        if (expansionRequest.decision !== 'pending_human_approval') {
          throw Object.assign(new Error('Only pending requests can be approved/rejected'), { status: 400 });
        }

        const comment = payload?.reason as string || '';
        const adu = await agentFactoryRepository.getAduById(targetId);
        if (!adu) {
          throw Object.assign(new Error(`ADU ${targetId} not found`), { status: 404 });
        }

        if (action.action === 'approve_write_path') {
          const approvedPaths = expansionRequest.requested_paths;
          if (approvedPaths.length > 0) {
            try {
              const scriptPath = path.join(config.workspaceRoot, 'scripts', 'write_path_policy.py');
              const registryDir = path.join(config.workspaceRoot, '.ai-agent', 'registry');
              const policyOut = execFileSync('python3', [
                scriptPath,
                '--adu', targetId,
                '--requested-paths', JSON.stringify(approvedPaths),
                '--registry-dir', registryDir
              ], { encoding: 'utf-8' });
              const policyRes = JSON.parse(policyOut);
              if (policyRes.result === 'blocked') {
                throw Object.assign(new Error(`Approval rejected: paths are blocked by policy: ${policyRes.blocked_paths.join(', ')}`), { status: 400 });
              }
            } catch (e: any) {
              if (e.status) throw e;
              throw Object.assign(new Error(`Policy re-validation failed: ${e.message}`), { status: 500 });
            }
          }

          expansionRequest.decision = 'approved';
          expansionRequest.comment = comment;
          expansionRequest.updated_at = new Date().toISOString();

          const currentWrite = adu.allowed_write_paths || [];
          const currentRead = adu.allowed_read_paths || [];
          for (const filePath of approvedPaths) {
            if (!currentWrite.includes(filePath)) currentWrite.push(filePath);
            if (!currentRead.includes(filePath)) currentRead.push(filePath);
          }
          adu.allowed_write_paths = currentWrite;
          adu.allowed_read_paths = currentRead;

          if (!adu.write_path_expansions) adu.write_path_expansions = [];
          adu.write_path_expansions.push({
            request_id: expansionRequest.request_id,
            source_agent: expansionRequest.source_agent || 'unknown',
            requested_paths: expansionRequest.requested_paths,
            approved_paths: approvedPaths,
            decision: 'approved',
            reason: comment || expansionRequest.reason || '',
            created_at: expansionRequest.created_at,
            updated_at: expansionRequest.updated_at
          });
        } else {
          expansionRequest.decision = 'rejected';
          expansionRequest.comment = comment;
          expansionRequest.updated_at = new Date().toISOString();

          if (!adu.write_path_expansions) adu.write_path_expansions = [];
          adu.write_path_expansions.push({
            request_id: expansionRequest.request_id,
            source_agent: expansionRequest.source_agent || 'unknown',
            requested_paths: expansionRequest.requested_paths,
            approved_paths: [],
            decision: 'rejected',
            reason: comment || '',
            created_at: expansionRequest.created_at,
            updated_at: expansionRequest.updated_at
          });
        }

        const remainingPending = data.requests.some((r: any) => r.adu_id === targetId && r.decision === 'pending_human_approval' && r.request_id !== request_id);
        if (!remainingPending && adu.state === 'human_gate' && adu.gate_type === 'write_path_expansion') {
          adu.state = adu.pre_gate_state || 'created';
          adu.human_gate_required = false;
          delete adu.gate_type;
        }

        await fs.promises.writeFile(p, JSON.stringify(data, null, 2), 'utf-8');
        await agentFactoryRepository.saveAdu(adu);

        // Try to also resolve the human gate record in HumanGateService
        try {
          const HumanGateService = (await import('../application/human-gate-service')).HumanGateService;
          const humanGateService = HumanGateService.getInstance();
          const activeGates = await humanGateService.listGates();
          const targetGate = activeGates.find((g: any) => g.target_id === targetId && g.gate_type === 'write_path_expansion' && g.status === 'pending');
          if (targetGate) {
            targetGate.status = action.action === 'approve_write_path' ? 'approved' : 'canceled';
            targetGate.resolved_at = new Date().toISOString();
            targetGate.resolution = { action: action.action === 'approve_write_path' ? 'approve' : 'cancel', comment };
            await (humanGateService as any).writeGates(activeGates);
          }
        } catch (e) {
          logger.warn({ e, targetId }, 'Failed to sync HumanGateService status during operator write path dispose');
        }

        return { success: true, message: 'Write path action processed' };
      }

      if (action.action === 'submit_runtime_evidence' || action.action === 'grant_environment_waiver') {
        let comment = '';
        let affectedAssertions: string[] = [];

        if (action.action === 'grant_environment_waiver') {
          if (!payload?.waiver_reason || typeof payload.waiver_reason !== 'string' || !payload.waiver_reason.trim()) {
            throw Object.assign(new Error('waiver_reason is required and must be a non-empty string'), { status: 400 });
          }
          if (!payload?.affected_assertions || !Array.isArray(payload.affected_assertions) || payload.affected_assertions.length === 0 || payload.affected_assertions.some((id: any) => typeof id !== 'string' || !id.trim())) {
            throw Object.assign(new Error('affected_assertions must be a non-empty array of strings'), { status: 400 });
          }
          comment = payload.waiver_reason.trim();
          affectedAssertions = payload.affected_assertions;
        } else {
          comment = payload?.runtime_log as string || 'Runtime evidence submitted';
        }

        const disposition = action.action === 'grant_environment_waiver' ? 'environment_waiver' : 'provide_missing_evidence';
        await monitor.disposeHumanGate(targetId, { disposition, comment, affectedAssertions });

        // Try to also resolve the human gate record in HumanGateService so it doesn't stay pending
        try {
          const HumanGateService = (await import('../application/human-gate-service')).HumanGateService;
          const humanGateService = HumanGateService.getInstance();
          const activeGates = await humanGateService.listGates();
          const targetGate = activeGates.find((g: any) => g.target_id === targetId && g.gate_type === 'environment_verification_required' && g.status === 'pending');
          if (targetGate) {
            if (action.action === 'grant_environment_waiver') {
              targetGate.status = 'waived';
              targetGate.resolved_at = new Date().toISOString();
              targetGate.resolution = { action: 'approve_waiver', comment };
            } else {
              targetGate.status = 'resolved';
              targetGate.resolved_at = new Date().toISOString();
              targetGate.resolution = { action: 'submit_runtime_result', comment };
            }
            await (humanGateService as any).writeGates(activeGates);
          }
        } catch (e) {
          logger.warn({ e, targetId }, 'Failed to sync HumanGateService status during operator dispose');
        }

        return { success: true, message: 'Evidence/Waiver action processed' };
      }

      throw Object.assign(new Error(`Action ${action.action} is not supported`), { status: 400 });
    }
  };

  const operatorControl = new OperatorControl(
    monitor,
    epicMonitor,
    operatorRepo,
    operatorLock,
    operationStore,
    runnerDelegate
  );

  // Helper middleware to check control permissions
  const requireControl: RequestHandler = (req, res, next) => {
    if (!config.enableControl) {
      res.status(403).json({
        success: false,
        error: 'Control API is disabled in monitoring-only mode',
      });
      return;
    }
    next();
  };

  // GET /api/agent-factory/projects
  router.get('/projects', asyncHandler(async (_req: Request, res: Response) => {
    try {
      const projects = await projectOnboarding.listProjects();
      res.json(projects);
    } catch (err: unknown) {
      logger.error({ err }, 'AgentFactory: listProjects error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // POST /api/agent-factory/projects
  router.post('/projects', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { projectId, name, repoPath, description } = req.body as {
      projectId?: string;
      name?: string;
      repoPath?: string;
      description?: string;
    };
    if (!name || !repoPath) {
      res.status(400).json({ success: false, error: 'name and repoPath are required' });
      return;
    }
    try {
      const project = await projectOnboarding.registerProject({
        projectId: projectId || '',
        name,
        repoPath,
        description,
      });
      res.json({ success: true, project });
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('Access Denied') || error.message.includes('Not a Git repository') || error.message.includes('already registered') || error.message.includes('does not exist')) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      logger.error({ err }, 'AgentFactory: registerProject error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/projects/:projectId
  router.get('/projects/:projectId', asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    try {
      const project = await projectOnboarding.getProject(projectId);
      if (!project) {
        res.status(404).json({ success: false, error: 'Project not found' });
        return;
      }
      res.json(project);
    } catch (err: unknown) {
      logger.error({ err, projectId }, 'AgentFactory: getProject error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // POST /api/agent-factory/projects/:projectId/profile
  router.post('/projects/:projectId/profile', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    try {
      const result = await projectOnboarding.runProfiling(projectId);
      res.json(result);
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('not found')) {
        res.status(404).json({ success: false, error: error.message });
        return;
      }
      logger.error({ err, projectId }, 'AgentFactory: runProfiling error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/projects/:projectId/profile
  router.get('/projects/:projectId/profile', asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    try {
      const profile = await projectOnboarding.getProjectProfile(projectId);
      res.json(profile);
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('not found')) {
        res.status(404).json({ success: false, error: error.message });
        return;
      }
      if (error.message.includes('does not exist')) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      logger.error({ err, projectId }, 'AgentFactory: getProjectProfile error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/projects/:projectId/knowledge
  router.get('/projects/:projectId/knowledge', asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    try {
      const docs = await projectOnboarding.getProjectKnowledgeList(projectId);
      res.json(docs);
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('not found')) {
        res.status(404).json({ success: false, error: error.message });
        return;
      }
      logger.error({ err, projectId }, 'AgentFactory: getProjectKnowledgeList error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/projects/:projectId/knowledge/:doc
  router.get('/projects/:projectId/knowledge/:doc', asyncHandler(async (req: Request, res: Response) => {
    const { projectId, doc } = req.params;
    try {
      const content = await projectOnboarding.getProjectKnowledgeDoc(projectId, doc);
      res.send(content);
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('not found')) {
        res.status(404).json({ success: false, error: error.message });
        return;
      }
      if (error.message.includes('Invalid knowledge')) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      logger.error({ err, projectId, doc }, 'AgentFactory: getProjectKnowledgeDoc error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // POST /api/agent-factory/projects/:projectId/disable
  router.post('/projects/:projectId/disable', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    try {
      await projectOnboarding.disableProject(projectId);
      res.json({ success: true });
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('not found')) {
        res.status(404).json({ success: false, error: error.message });
        return;
      }
      logger.error({ err, projectId }, 'AgentFactory: disableProject error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/dashboard
  router.get('/dashboard', asyncHandler(async (_req: Request, res: Response) => {
    try {
      const dashboard = await monitor.getDashboard(activeOrchestrators);
      res.json(dashboard);
    } catch (err: unknown) {
      logger.error({ err }, 'AgentFactory: getDashboard error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/adus
  router.get('/adus', asyncHandler(async (_req: Request, res: Response) => {
    try {
      const dashboard = await monitor.getDashboard(activeOrchestrators);
      res.json(dashboard.adus);
    } catch (err: unknown) {
      logger.error({ err }, 'AgentFactory: getAdus error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // --- Project ADU Management ---

  router.post('/projects/:projectId/adus', requireControl, asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    if (!projectId || !projectId.match(/^[A-Za-z0-9_.-]+$/)) {
      res.status(400).json({ error: 'Invalid projectId' });
      return;
    }
    try {
      const factory = new ProjectAduFactory(projectRepository, agentFactoryRepository);
      const adu = await factory.createForProject(projectId, req.body);
      res.status(201).json({ adu });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }));

  router.get('/projects/:projectId/adus', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { projectId } = req.params;
    if (!projectId || !projectId.match(/^[A-Za-z0-9_.-]+$/)) {
      res.status(400).json({ error: 'Invalid projectId' });
      return;
    }
    // @ts-ignore - Added in Phase 2
    const adus = await agentFactoryRepository.listAdusByProject(projectId);
    res.json({ project_id: projectId, adus });
  }));

  router.get('/adus/:aduId/project-context', asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { aduId } = req.params;
    if (!aduId || !aduId.match(/^[A-Za-z0-9_.-]+$/)) {
      res.status(400).json({ error: 'Invalid aduId' });
      return;
    }
    // @ts-ignore - Added in Phase 2
    const adu = await agentFactoryRepository.getAduById(aduId);
    if (!adu) { res.status(404).json({ error: 'ADU not found' }); return; }
    if (!adu.project_id) { res.status(400).json({ error: 'ADU is not bound to a project' }); return; }

    const project = await projectRepository.getProject(adu.project_id);
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    res.json({
      aduId: adu.id,
      project: {
        project_id: project.project_id,
        name: project.name,
        repo_path: project.repo_path,
        status: project.status,
      },
      profile: {
        exists: !!project.profile_path,
        path: project.profile_path,
        summary: project.profile_summary,
      },
      knowledge: ['project-summary.md', 'module-map.md', 'test-strategy.md', 'risk-map.md'].map((name) => {
        const filePath = `.agent-factory/knowledge/${name}`;
        const exists = fs.existsSync(path.join(project.repo_path, filePath));
        return { name, path: filePath, exists };
      }),
      policies: {
        allowed_read_paths: adu.allowed_read_paths || [],
        allowed_write_paths: adu.allowed_write_paths || [],
        required_commands: adu.required_commands || []
      }
    });
  }));

  // GET /api/agent-factory/adus/:id
  router.get('/adus/:id', asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const adu = await monitor.getAdu(id, activeOrchestrators);
      if (!adu) {
        res.status(404).json({ success: false, error: 'ADU not found' });
        return;
      }
      res.json(adu);
    } catch (err: unknown) {
      logger.error({ err, id }, 'AgentFactory: getAdu error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/agents
  router.get('/agents', asyncHandler(async (_req: Request, res: Response) => {
    try {
      const dashboard = await monitor.getDashboard();
      res.json(dashboard.agents);
    } catch (err: unknown) {
      logger.error({ err }, 'AgentFactory: getAgents error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/agents/model-settings
  router.get('/agents/model-settings', asyncHandler(async (_req: Request, res: Response) => {
    try {
      const repo = new AgentModelSettingsRepository(undefined, logger);
      const settings = await repo.readSettings();
      res.json(settings);
    } catch (err: unknown) {
      logger.error({ err }, 'AgentFactory: getAllAgentModelSettings error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // PUT /api/agent-factory/agents/:agentId/model
  router.put('/agents/:agentId/model', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { agentId } = req.params;
    const { provider, model } = req.body as { provider?: string; model?: string };
    if (!model) {
      res.status(400).json({ success: false, error: 'Model is required' });
      return;
    }
    try {
      // 1. Validate agentId exists
      const dashboard = await monitor.getDashboard();
      const agentExists = dashboard.agents.some((a: any) => a.id === agentId);
      if (!agentExists) {
        res.status(404).json({ success: false, error: `Agent ${agentId} not found` });
        return;
      }

      // 2. Validate provider + model pair
      if (model !== 'default') {
        const hermesRepo = new HermesConfigRepository(logger, config.hermesConfigPath);
        const hermesConfig = await hermesRepo.readConfig();
        const isValidModel = hermesConfig.models.some(
          (m: any) => m.provider === provider && m.model === model
        );
        if (!isValidModel) {
          res.status(400).json({ success: false, error: `Invalid provider/model combination: ${provider}/${model}` });
          return;
        }
      }

      const repo = new AgentModelSettingsRepository(undefined, logger);
      const settings = await repo.readSettings();
      if (model === 'default') {
        delete settings[agentId];
      } else {
        settings[agentId] = { provider, model };
      }
      await repo.writeSettings(settings);
      res.json({ success: true });
    } catch (err: unknown) {
      logger.error({ err, agentId }, 'AgentFactory: updateAgentModel error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/hermes/models
  router.get('/hermes/models', asyncHandler(async (_req: Request, res: Response) => {
    try {
      const hermesRepo = new HermesConfigRepository(logger, config.hermesConfigPath);
      const hermesConfig = await hermesRepo.readConfig();
      res.json(hermesConfig.models);
    } catch (err: unknown) {
      logger.error({ err }, 'AgentFactory: getHermesModels error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/token-budget
  router.get('/token-budget', asyncHandler(async (req: Request, res: Response) => {
    const aduId = req.query.aduId as string | undefined;
    try {
      const { TokenBudgetRepository } = await import('../infrastructure/token-budget-repository');
      const repo = new TokenBudgetRepository(logger);
      const budget = await repo.readBudget();

      const defaultCfg = budget.default ?? {
        inputTokenLimit: 500000,
        outputTokenLimit: 100000,
        warnAtRatio: 0.8,
      };

      let inputUsed = 0;
      let outputUsed = 0;

      if (aduId) {
        const runs = await monitor.getAllRuns({ aduId });
        for (const run of runs) {
          const usage = (run as any).token_usage;
          if (usage) {
            inputUsed += usage.inputTokens || 0;
            outputUsed += usage.outputTokens || 0;
          }
        }
      }

      res.json({
        default: {
          inputTokenLimit: defaultCfg.inputTokenLimit ?? 500000,
          outputTokenLimit: defaultCfg.outputTokenLimit ?? 100000,
          warnAtRatio: defaultCfg.warnAtRatio ?? 0.8,
          inputUsed,
          outputUsed,
        },
        agents: budget.agents || {},
      });
    } catch (err: unknown) {
      logger.error({ err, aduId }, 'AgentFactory: getTokenBudget error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // Helper: spawn orchestrator with a given mode
  const spawnOrchestrator = async (aduId: string, mode: string): Promise<any> => {
    const workspaceRootOverride = await resolveWorkspaceRootOverride(aduId) || config.workspaceRoot;

    // Check project status — only 'profiled' projects may run ADUs
    const adu = await monitor.getAdu(aduId);
    if (adu && adu.project_id) {
      const project = await projectOnboarding.getProject(adu.project_id);
      if (project) {
        if (project.status === 'disabled') {
          const err: any = new Error(`Project for ADU ${aduId} is disabled (read-only mode)`);
          err.forbidden = true;
          throw err;
        }
        if (project.status !== 'profiled') {
          const statusMessages: Record<string, string> = {
            registered: 'Project has not been profiled yet. Run profiling first.',
            profiling: 'Project profiling is in progress. Wait for it to complete.',
            profile_failed: 'Project profiling failed. Re-run profiling before proceeding.',
          };
          const msg = statusMessages[project.status] ?? `Project is not ready (status: ${project.status})`;
          const err: any = new Error(msg);
          err.forbidden = true;
          throw err;
        }
      }
    }

    if (['start', 'continue', 'step'].includes(mode)) {
      const projectId = adu?.project_id || 'default-open5gs';
      const lockPath = path.join(config.workspaceRoot, '.ai-agent', 'locks', `${projectId}__${aduId}.lock`);
      if (fs.existsSync(lockPath)) {
        try {
          const lockContent = fs.readFileSync(lockPath, 'utf-8');
          const lockData = JSON.parse(lockContent);
          const heartbeat = lockData.heartbeat_at;
          if (heartbeat) {
            const hbTime = new Date(heartbeat).getTime();
            const now = Date.now();
            if (now - hbTime < 1800 * 1000) {
              const err: any = new Error(`ADU ${aduId} is already being processed (PID ${lockData.pid})`);
              err.conflict = true;
              throw err;
            }
          }
        } catch (e: any) {
          if (e.conflict) throw e;
          // lock is corrupted or invalid, ignore and proceed
        }
      }
    }

    const orchestratorPath = path.join(config.workspaceRoot, 'scripts', 'hermes_agent_orchestrator.py');
    if (!fs.existsSync(orchestratorPath)) {
      throw new Error(`Orchestrator script not found at ${orchestratorPath}`);
    }

    const activeOp = operationStore.getActiveOperation(aduId);
    if (activeOp || activeOrchestrators.has(aduId)) {
      const err: any = new Error(`Orchestrator is already running or waiting for ADU ${aduId}`);
      err.conflict = true;
      throw err;
    }

    const NEXT_AGENT_BY_STATE: Record<string, string | null> = {
      created: 'requirement-analyst',
      analysis_review: null,
      analyzed: 'context-pack',
      contexted: 'detail-designer',
      design_review: null,
      designed: 'contract',
      contracted: 'testwriter',
      test_red: 'developer',
      code_rework: 'developer',
      build_rework: 'developer',
      acceptance_rework: 'developer',
      implemented: 'code-reviewer',
      code_reviewed: 'buildfix-debugger',
      debugged: 'acceptance-reviewer',
      acceptance_reviewed: 'evidence',
    };

    const nextAgent = NEXT_AGENT_BY_STATE[adu?.state || ''] || 'developer';
    const TokenGovernanceService = (await import('../application/token-governance')).TokenGovernanceService;
    const tokenGovService = TokenGovernanceService.getInstance();
    const budget = await tokenGovService.estimateNextRun(aduId, nextAgent);
    if (budget && budget.budget_status === 'hard_stop') {
      const HumanGateService = (await import('../application/human-gate-service')).HumanGateService;
      const humanGateService = HumanGateService.getInstance();
      await humanGateService.openGate({
        scope: 'adu',
        target_id: aduId,
        gate_type: 'token_budget_approval',
        title: 'Token Budget Hard Stop Blocked',
        reason: `Estimated input tokens ${budget.estimated_input_tokens} exceeds the hard budget limit.`,
        source_agent: nextAgent,
        pre_gate_state: adu?.state
      });
      const err: any = new Error(`Estimated tokens (${budget.estimated_input_tokens}) exceeds hard stop limit. Created token_budget_approval human gate.`);
      err.budgetBlocked = true;
      throw err;
    }

    // Create Operation
    const op = operationStore.createOperation({
      scope: 'adu',
      target_id: aduId,
      action: mode as any,
      project_id: adu?.project_id || 'default-open5gs',
      epic_id: adu?.parent_epic_id || undefined
    });

    activeOrchestrators.add(aduId);

    const { spawn } = await import('child_process');
    const spawnArgs = [orchestratorPath, '--adu', aduId, '--mode', mode, '--repo-root', workspaceRootOverride, '--operation-id', op.operation_id];
    if (adu?.project_id) {
      spawnArgs.push('--project', adu.project_id);
    }
    const child = spawn('python3', spawnArgs, {
      cwd: config.workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    operationStore.updateOperation(op.operation_id, { pid: child.pid });

    let stdoutData = '';
    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
      let lineEnd = stdoutData.indexOf('\n');
      while (lineEnd !== -1) {
        const line = stdoutData.substring(0, lineEnd).trim();
        stdoutData = stdoutData.substring(lineEnd + 1);
        if (line) {
          try {
            const parsed = JSON.parse(line);
            broadcastOrchestratorEvent(parsed);

            // Map parsed fields into the new Event schema
            operationStore.addEvent(op.operation_id, {
              type: parsed.event || parsed.type || 'orchestrator_event',
              payload: parsed,
              stream: 'stdout',
              message: parsed.message || (parsed.payload && parsed.payload.message) || '',
              severity: parsed.severity || 'info'
            });

            // Update current status / current agent of operation
            const updates: any = {};
            if (parsed.agent) updates.current_agent = parsed.agent;
            if (parsed.state) updates.current_state = parsed.state;
            if (parsed.event === 'human_gate_opened') {
              updates.status = 'waiting_human';
            }
            if (Object.keys(updates).length > 0) {
              operationStore.updateOperation(op.operation_id, updates);
            }
          } catch (e) {
            logger.debug({ line }, 'Failed to parse line from orchestrator stdout');
            operationStore.addEvent(op.operation_id, {
              type: 'stdout_raw',
              payload: { line },
              stream: 'stdout',
            });
          }
        }
        lineEnd = stdoutData.indexOf('\n');
      }
    });

    let stderrBuf = '';
    child.stderr.on('data', (chunk) => {
      const str = chunk.toString();
      logger.error(`Orchestrator stderr: ${str}`);
      stderrBuf += str;
      let lineEnd = stderrBuf.indexOf('\n');
      while (lineEnd !== -1) {
        const line = stderrBuf.substring(0, lineEnd).trim();
        stderrBuf = stderrBuf.substring(lineEnd + 1);
        if (line) {
          operationStore.addEvent(op.operation_id, {
            type: 'stderr_line',
            payload: { line },
            stream: 'stderr',
          });
        }
        lineEnd = stderrBuf.indexOf('\n');
      }
    });

    child.on('close', async (code) => {
      logger.info(`Orchestrator child process closed with code ${code}`);
      activeOrchestrators.delete(aduId);

      // flush remaining buffers
      if (stdoutData.trim()) {
        try {
          const parsed = JSON.parse(stdoutData.trim());
          broadcastOrchestratorEvent(parsed);
          operationStore.addEvent(op.operation_id, {
            type: parsed.event || parsed.type || 'orchestrator_event',
            payload: parsed,
            stream: 'stdout',
            message: parsed.message || (parsed.payload && parsed.payload.message) || '',
            severity: parsed.severity || 'info'
          });
        } catch (_) {
          operationStore.addEvent(op.operation_id, {
            type: 'stdout_raw',
            payload: { line: stdoutData.trim() },
            stream: 'stdout',
          });
        }
      }
      if (stderrBuf.trim()) {
        operationStore.addEvent(op.operation_id, {
          type: 'stderr_line',
          payload: { line: stderrBuf.trim() },
          stream: 'stderr',
        });
      }

      broadcastOrchestratorEvent({ adu: aduId, action: 'closed', code });

      let finalState: string | undefined;
      let gateType: string | undefined;
      try {
        const updatedAdu = await agentFactoryRepository.getAduById(aduId);
        if (updatedAdu) {
          finalState = updatedAdu.state;
          gateType = updatedAdu.gate_type;
        }
      } catch (_) {}

      let status: any = 'completed';
      let result: any = 'success';

      if (code === 20 || finalState === 'human_gate') {
        status = 'waiting_human';
        result = 'human_gate';

        // Open Human Gate
        const HumanGateService = (await import('../application/human-gate-service')).HumanGateService;
        const humanGateService = HumanGateService.getInstance();
        await humanGateService.openGate({
          scope: 'adu',
          target_id: aduId,
          gate_type: (gateType as any) || 'environment_verification_required',
          title: gateType === 'write_path_expansion' ? 'Write Path Expansion Required' : 'Runtime Evidence Required',
          reason: gateType === 'write_path_expansion' ? 'Proposed modifications affect derived files. Approval required.' : 'Acceptance testing requires environment verification.',
          source_agent: nextAgent,
          pre_gate_state: adu?.state || 'debugged'
        });
      } else if (code !== 0) {
        status = 'failed';
        result = 'failed';
      }

      operationStore.updateOperation(op.operation_id, {
        status,
        result,
        exitCode: code,
        finalState,
      });
    });

    return op;
  };

  // POST /api/agent-factory/adus/:aduId/start
  router.post('/adus/:aduId/start', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    const { language } = req.body as { language?: string };
    try {
      const adu = await monitor.getAdu(aduId);
      if (!adu) {
        res.status(404).json({ success: false, error: `ADU ${aduId} not found` });
        return;
      }
      if (language) {
        await monitor.updateAduLanguage(aduId, language);
      }
      const result = await spawnOrchestrator(aduId, 'start');
      res.json(result);
    } catch (err: unknown) {
      if ((err as any).budgetBlocked) {
        res.status(400).json({ success: false, error: (err as Error).message });
        return;
      }
      if ((err as any).conflict) {
        res.status(409).json({ success: false, error: (err as Error).message });
        return;
      }
      if ((err as any).forbidden) {
        res.status(403).json({ success: false, error: (err as Error).message });
        return;
      }
      logger.error({ err, aduId }, 'AgentFactory: startOrchestrator error');
      res.status(500).json({ success: false, error: 'Failed to start orchestrator' });
    }
  }));

  // PATCH /api/agent-factory/adus/:aduId/paths
  router.patch('/adus/:aduId/paths', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(aduId)) {
      res.status(400).json({ success: false, error: 'Invalid aduId format' });
      return;
    }
    const { add_write_paths = [], add_read_paths = [] } = req.body as {
      add_write_paths?: string[];
      add_read_paths?: string[];
    };
    if (!Array.isArray(add_write_paths) || !Array.isArray(add_read_paths)) {
      res.status(400).json({ success: false, error: 'add_write_paths and add_read_paths must be arrays' });
      return;
    }
    if (activeOrchestrators.has(aduId)) {
      res.status(409).json({ success: false, error: 'Cannot modify paths while orchestrator is running' });
      return;
    }
    try {
      const result = await monitor.appendAduPaths(aduId, add_write_paths, add_read_paths);
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      if ((err as any).forbidden) {
        res.status(403).json({ success: false, error: (err as Error).message });
        return;
      }
      logger.error({ err, aduId }, 'AgentFactory: appendAduPaths error');
      res.status(400).json({ success: false, error: (err as Error).message ?? 'Failed to update paths' });
    }
  }));

  // POST /api/agent-factory/adus/:aduId/pause
  router.post('/adus/:aduId/pause', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(aduId)) {
      res.status(400).json({ success: false, error: 'Invalid aduId format' });
      return;
    }
    try {
      await monitor.pauseAdu(aduId);
      res.json({ success: true, message: 'ADU flagged for pause; running orchestrator will stop at next checkpoint' });
    } catch (err: unknown) {
      if ((err as any).notFound) { res.status(404).json({ success: false, error: (err as Error).message }); return; }
      if ((err as any).forbidden) { res.status(403).json({ success: false, error: (err as Error).message }); return; }
      logger.error({ err, aduId }, 'AgentFactory: pauseAdu error');
      res.status(500).json({ success: false, error: 'Failed to pause ADU' });
    }
  }));

  // POST /api/agent-factory/adus/:aduId/cancel
  router.post('/adus/:aduId/cancel', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(aduId)) {
      res.status(400).json({ success: false, error: 'Invalid aduId format' });
      return;
    }
    try {
      await monitor.cancelAdu(aduId);
      res.json({ success: true, message: 'ADU canceled' });
    } catch (err: unknown) {
      if ((err as any).notFound) { res.status(404).json({ success: false, error: (err as Error).message }); return; }
      logger.error({ err, aduId }, 'AgentFactory: cancelAdu error');
      res.status(500).json({ success: false, error: 'Failed to cancel ADU' });
    }
  }));

  // POST /api/agent-factory/adus/:aduId/continue
  router.post('/adus/:aduId/continue', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    try {
      const adu = await monitor.getAdu(aduId);
      if (!adu) {
        res.status(404).json({ success: false, error: `ADU ${aduId} not found` });
        return;
      }
      const result = await spawnOrchestrator(aduId, 'continue');
      res.json(result);
    } catch (err: unknown) {
      if ((err as any).budgetBlocked) {
        res.status(400).json({ success: false, error: (err as Error).message });
        return;
      }
      if ((err as any).conflict) {
        res.status(409).json({ success: false, error: (err as Error).message });
        return;
      }
      if ((err as any).forbidden) {
        res.status(403).json({ success: false, error: (err as Error).message });
        return;
      }
      logger.error({ err, aduId }, 'AgentFactory: continueOrchestrator error');
      res.status(500).json({ success: false, error: 'Failed to continue orchestrator' });
    }
  }));

  // POST /api/agent-factory/adus/:aduId/human-gate/waive
  router.post('/adus/:aduId/human-gate/waive', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    const { reasonType, comment } = req.body as { reasonType?: string; comment?: string };
    if (!/^[A-Za-z0-9_.-]+$/.test(aduId)) {
      res.status(400).json({ success: false, error: 'Invalid aduId format' });
      return;
    }
    if (reasonType !== 'environment') {
      res.status(400).json({ success: false, error: 'Only environment waivers are supported' });
      return;
    }
    try {
      const result = await monitor.disposeHumanGate(aduId, {
        disposition: 'environment_waiver',
        comment: comment || '',
      });
      broadcastOrchestratorEvent({
        type: 'agentFactoryEvent',
        event: 'human_gate_waived',
        aduId,
        reasonType,
        toState: result.state,
      });
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      if ((err as any).notFound) { res.status(404).json({ success: false, error: (err as Error).message }); return; }
      if ((err as any).forbidden) { res.status(403).json({ success: false, error: (err as Error).message }); return; }
      logger.error({ err, aduId }, 'AgentFactory: waiveHumanGate error');
      res.status(400).json({ success: false, error: (err as Error).message || 'Failed to waive human gate' });
    }
  }));

  // POST /api/agent-factory/adus/:aduId/human-gate/disposition
  router.post('/adus/:aduId/human-gate/disposition', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    const { disposition, comment, affectedAssertions } = req.body as {
      disposition?: 'environment_waiver' | 'accept_risk' | 'request_rework' | 'provide_missing_evidence' | 'external_dependency_block' | 'cancel_adu';
      comment?: string;
      affectedAssertions?: string[];
    };
    if (!/^[A-Za-z0-9_.-]+$/.test(aduId)) {
      res.status(400).json({ success: false, error: 'Invalid aduId format' });
      return;
    }
    if (!disposition || !comment) {
      res.status(400).json({ success: false, error: 'disposition and comment are required' });
      return;
    }
    try {
      const result = await monitor.disposeHumanGate(aduId, {
        disposition,
        comment,
        affectedAssertions,
      });
      broadcastOrchestratorEvent({
        type: 'agentFactoryEvent',
        event: 'human_gate_disposed',
        aduId,
        disposition,
        toState: result.state,
      });
      res.json({ success: true, ...result });
    } catch (err: unknown) {
      if ((err as any).notFound) { res.status(404).json({ success: false, error: (err as Error).message }); return; }
      if ((err as any).forbidden) { res.status(403).json({ success: false, error: (err as Error).message }); return; }
      logger.error({ err, aduId }, 'AgentFactory: disposeHumanGate error');
      res.status(400).json({ success: false, error: (err as Error).message || 'Failed to dispose human gate' });
    }
  }));

  // GET /api/agent-factory/runs
  router.get('/runs', asyncHandler(async (req: Request, res: Response) => {
    const aduId = req.query.aduId as string | undefined;
    const agent = req.query.agent as string | undefined;
    const limitStr = req.query.limit as string | undefined;

    let limit: number | undefined;
    if (limitStr) {
      const parsed = parseInt(limitStr, 10);
      if (!isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 200);
      }
    }

    try {
      const runs = await monitor.getRuns({ aduId, agent, limit });
      res.json(runs);
    } catch (err: unknown) {
      logger.error({ err }, 'AgentFactory: getRuns error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/artifacts
  router.get('/artifacts', asyncHandler(async (req: Request, res: Response) => {
    const artifactPath = req.query.path as string | undefined;
    const maxBytesStr = req.query.maxBytes as string | undefined;
    const aduId = req.query.aduId as string | undefined;

    if (!artifactPath) {
      res.status(400).json({ success: false, error: 'Query parameter "path" is required' });
      return;
    }

    let maxBytes = 100000;
    if (maxBytesStr) {
      const parsed = parseInt(maxBytesStr, 10);
      if (!isNaN(parsed) && parsed > 0) {
        maxBytes = Math.min(parsed, 100000);
      }
    }

    try {
      const workspaceRootOverride = await resolveWorkspaceRootOverride(aduId);
      const artifact = await monitor.repo.readTextArtifact(artifactPath, maxBytes, workspaceRootOverride);
      res.json(artifact);
    } catch (err: unknown) {
      const error = err as Error & { code?: string };
      const errorMessage = error.message || 'Unknown error';
      if (errorMessage.includes('Access denied')) {
        res.status(403).json({ success: false, error: errorMessage });
        return;
      }
      if (errorMessage.includes('escapes workspace root')) {
        res.status(400).json({ success: false, error: errorMessage });
        return;
      }
      if (error.code === 'ENOENT') {
        res.status(404).json({ success: false, error: `Artifact file not found: ${artifactPath}` });
        return;
      }
      logger.error({ err, path: artifactPath }, 'AgentFactory: getArtifact error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // POST /api/agent-factory/adus/:aduId/run-next-step
  router.post('/adus/:aduId/run-next-step', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    try {
      const adu = await monitor.getAdu(aduId);
      if (!adu) {
        res.status(404).json({ success: false, error: `ADU ${aduId} not found` });
        return;
      }
      if (adu.state === 'analysis_review' || adu.state === 'design_review') {
        res.status(409).json({ success: false, error: 'review_required' });
        return;
      }
      const result = await spawnOrchestrator(aduId, 'step');
      res.json(result);
    } catch (err: unknown) {
      if ((err as any).budgetBlocked) {
        res.status(400).json({ success: false, error: (err as Error).message });
        return;
      }
      if ((err as any).conflict) {
        res.status(409).json({ success: false, error: (err as Error).message });
        return;
      }
      if ((err as any).forbidden) {
        res.status(403).json({ success: false, error: (err as Error).message });
        return;
      }
      logger.error({ err, aduId }, 'AgentFactory: runNextStep error');
      res.status(500).json({ success: false, error: 'Failed to start step execution' });
    }
  }));

  // GET /api/agent-factory/adus/:aduId/quality-reports
  router.get('/adus/:aduId/quality-reports', asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(aduId)) {
      res.status(400).json({ success: false, error: 'Invalid aduId format' });
      return;
    }

    try {
      const workspaceRootOverride = await resolveWorkspaceRootOverride(aduId) || config.workspaceRoot;
      const contractPath = `.ai-agent/contracts/${aduId}.json`;
      const codeReviewPath = `.ai-agent/reviews/${aduId}-code-review.json`;
      const acceptanceReviewPath = `.ai-agent/acceptance/${aduId}-acceptance-review.json`;

      let contractExists = false;
      let contractValid = false;
      try {
        const art = await monitor.repo.readTextArtifact(contractPath, 100000, workspaceRootOverride);
        if (art && art.content) {
          contractExists = true;
          try {
            const scriptPath = path.join(config.workspaceRoot, 'scripts', 'validate_agent_contract.py');
            execFileSync('python3', [scriptPath, '--adu', aduId, '--repo-root', workspaceRootOverride], { stdio: 'ignore' });
            contractValid = true;
          } catch (execErr) {
            contractValid = false;
          }
        }
      } catch (e) {
        // Fallback
      }

      let codeReviewExists = false;
      let codeReviewStatus: string | undefined;
      let codeReviewValid = false;
      try {
        const art = await monitor.repo.readTextArtifact(codeReviewPath, 100000, workspaceRootOverride);
        if (art && art.content) {
          codeReviewExists = true;
          const parsed = JSON.parse(art.content);
          codeReviewStatus = parsed.review_status;
          try {
            const scriptPath = path.join(config.workspaceRoot, 'scripts', 'validate_quality_report.py');
            execFileSync('python3', [scriptPath, '--adu', aduId, '--kind', 'code-review', '--repo-root', workspaceRootOverride], { stdio: 'ignore' });
            codeReviewValid = true;
          } catch (execErr) {
            codeReviewValid = false;
          }
        }
      } catch (e) {
        // Fallback
      }

      let acceptanceReviewExists = false;
      let acceptanceReviewStatus: string | undefined;
      let acceptanceReviewValid = false;
      try {
        const art = await monitor.repo.readTextArtifact(acceptanceReviewPath, 100000, workspaceRootOverride);
        if (art && art.content) {
          acceptanceReviewExists = true;
          const parsed = JSON.parse(art.content);
          acceptanceReviewStatus = parsed.acceptance_status;
          try {
            const scriptPath = path.join(config.workspaceRoot, 'scripts', 'validate_quality_report.py');
            execFileSync('python3', [scriptPath, '--adu', aduId, '--kind', 'acceptance', '--repo-root', workspaceRootOverride], { stdio: 'ignore' });
            acceptanceReviewValid = true;
          } catch (execErr) {
            acceptanceReviewValid = false;
          }
        }
      } catch (e) {
        // Fallback
      }

      res.json({
        aduId,
        contract: {
          path: contractPath,
          exists: contractExists,
          valid: contractValid
        },
        codeReview: {
          path: codeReviewPath,
          exists: codeReviewExists,
          status: codeReviewStatus,
          valid: codeReviewValid
        },
        acceptanceReview: {
          path: acceptanceReviewPath,
          exists: acceptanceReviewExists,
          status: acceptanceReviewStatus,
          valid: acceptanceReviewValid
        }
      });
    } catch (err: unknown) {
      logger.error({ err, aduId }, 'AgentFactory: getQualityReports error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/adus/:aduId/reviews
  router.get('/adus/:aduId/reviews', asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    try {
      const reviews = await monitor.repo.readReviews();
      const filtered = reviews.filter((r) => r.adu_id === aduId);
      res.json({ aduId, reviews: filtered });
    } catch (err: unknown) {
      logger.error({ err, aduId }, 'AgentFactory: getReviews error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // POST /api/agent-factory/adus/:aduId/clarifications/:questionId
  router.post('/adus/:aduId/clarifications/:questionId', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId, questionId } = req.params;
    const { answer, status } = req.body as { answer?: string; status?: 'pending' | 'answered' | 'deferred' };


    try {
      const adus = await monitor.repo.readAdus();
      const adu = adus.find((a) => a.id === aduId);
      if (!adu) {
        res.status(404).json({ success: false, error: `ADU ${aduId} not found` });
        return;
      }

      if (!adu.clarification_questions) {
        res.status(404).json({ success: false, error: 'No clarification questions found on this ADU' });
        return;
      }

      const question = adu.clarification_questions.find((q: any) => q.id === questionId);
      if (!question) {
        res.status(404).json({ success: false, error: `Question ${questionId} not found` });
        return;
      }

      const targetStatus = status || (answer?.trim() ? 'answered' : 'deferred');

      if (status && !['pending', 'answered', 'deferred'].includes(status)) {
        res.status(400).json({ success: false, error: 'Invalid status value. Must be pending, answered, or deferred.' });
        return;
      }

      if (targetStatus === 'answered' && (!answer || answer.trim() === '')) {
        res.status(400).json({ success: false, error: 'Answer is required when status is answered.' });
        return;
      }

      question.answer = answer?.trim() || null;
      question.status = targetStatus;
      question.answered_at = new Date().toISOString();

      // Sync to legacy clarifications array for agent parsing
      adu.clarifications = adu.clarifications ?? [];
      if (targetStatus === 'pending') {
        adu.clarifications = adu.clarifications.filter(
          (c: any) => c.id !== questionId && c.question !== question.question
        );
      } else {
        const existingClar = adu.clarifications.find(
          (c: any) => c.id === questionId || c.question === question.question
        );
        if (existingClar) {
          existingClar.answer = question.answer || '';
          existingClar.status = question.status === 'answered' ? 'answered' : 'defer_to_requirement_analyst';
          existingClar.updated_at = new Date().toISOString();
        } else {
          adu.clarifications.push({
            question: question.question,
            answer: question.answer || '',
            status: question.status === 'answered' ? 'answered' : 'defer_to_requirement_analyst',
            impact: 'unknown',
            updated_at: new Date().toISOString()
          });
        }
      }


      await monitor.repo.writeAdus(adus);

      broadcastOrchestratorEvent({
        type: 'agentFactoryEvent',
        event: 'clarification_answered',
        aduId,
        questionId,
        status: targetStatus
      });

      res.json({ success: true, question });
    } catch (err: unknown) {
      logger.error({ err, aduId, questionId }, 'AgentFactory: answerClarification error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // POST /api/agent-factory/adus/:aduId/reviews/:gate/approve
  router.post('/adus/:aduId/reviews/:gate/approve', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId, gate } = req.params;
    const { comment } = req.body as { comment?: string };

    if (gate !== 'analysis' && gate !== 'design') {
      res.status(400).json({ success: false, error: 'Invalid gate' });
      return;
    }

    try {
      const adus = await monitor.repo.readAdus();
      const adu = adus.find((a) => a.id === aduId);
      if (!adu) {
        res.status(404).json({ success: false, error: `ADU ${aduId} not found` });
        return;
      }

      const expectedState = gate === 'analysis' ? 'analysis_review' : 'design_review';
      if (adu.state !== expectedState) {
        res.status(400).json({ success: false, error: `ADU state must be ${expectedState} to approve` });
        return;
      }

      if (gate === 'analysis') {
        const hasPendingBlocking = adu.clarification_questions?.some(
          (q: any) => q.blocking && q.status === 'pending'
        );
        if (hasPendingBlocking) {
          res.status(400).json({ success: false, error: '存在未解答的阻塞性澄清问题，请先解答或延期。' });
          return;
        }
      }


      const nextState = gate === 'analysis' ? 'analyzed' : 'designed';
      const artifactPath = gate === 'analysis'
        ? `.ai-agent/analysis/${aduId}.md`
        : `.ai-agent/designs/${aduId}-detailed-design.md`;

      const workspaceRootOverride = await resolveWorkspaceRootOverride(aduId);
      let sha256 = '';
      try {
        const art = await monitor.repo.readTextArtifact(artifactPath, 200000, workspaceRootOverride);
        if (!art || !art.content || art.content.trim() === '') {
          res.status(400).json({ success: false, error: `审核文档 ${artifactPath} 内容为空，无法批准审核。` });
          return;
        }
        if (art.truncated) {
          res.status(409).json({ success: false, error: `审核文档 ${artifactPath} 超过大小限制被截断，无法验证完整性，请先修整文档。` });
          return;
        }
        const crypto = await import('crypto');
        sha256 = crypto.createHash('sha256').update(art.content, 'utf-8').digest('hex');
      } catch (err: any) {
        res.status(400).json({ success: false, error: `无法读取审核文档 ${artifactPath}，请确保文档已被 Agent 正常生成：${err.message || '文件不存在'}` });
        return;
      }

      const reviews = await monitor.repo.readReviews();
      let review = reviews.find((r) => r.adu_id === aduId && r.gate === gate && r.status === 'pending');

      if (review) {
        review.status = 'approved';
        review.updated_at = new Date().toISOString();
        review.approved_at = new Date().toISOString();
        review.approved_by = 'local-user';
        review.comment = comment || null;
        review.approved_hashes = { [artifactPath]: sha256 };
      } else {
        review = {
          review_id: `review-${aduId}-${gate}-${Date.now()}`,
          adu_id: aduId,
          gate,
          state: expectedState,
          status: 'approved',
          artifact_paths: [artifactPath],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          approved_at: new Date().toISOString(),
          approved_by: 'local-user',
          comment: comment || null,
          approved_hashes: { [artifactPath]: sha256 }
        };
        reviews.push(review);
      }

      await monitor.repo.writeReviews(reviews);

      // Update ADU state
      if (gate === 'design' && Array.isArray(adu.pending_design_write_paths) && adu.pending_design_write_paths.length > 0) {
        const blockedPrefixes = ['.git/', '.agent-factory/', '.ai-agent/registry/', '~/', '/Users/', '/home/', '/etc/', '/tmp/', '/var/'];
        const normalize = (raw: string): string | null => {
          if (typeof raw !== 'string') return null;
          const value = raw.trim().replace(/\\/g, '/');
          if (!value || value.startsWith('/') || value.includes('\0')) return null;
          if (value.split('/').includes('..')) return null;
          if (blockedPrefixes.some((prefix) => value.startsWith(prefix) || value === prefix.replace(/\/$/, ''))) return null;
          return value;
        };
        const safePaths = adu.pending_design_write_paths
          .map((p) => normalize(p))
          .filter((p): p is string => Boolean(p));
        adu.allowed_write_paths = adu.allowed_write_paths ?? [];
        adu.allowed_read_paths = adu.allowed_read_paths ?? [];
        for (const pathToAdd of safePaths) {
          if (!adu.allowed_write_paths.includes(pathToAdd)) adu.allowed_write_paths.push(pathToAdd);
          if (!adu.allowed_read_paths.includes(pathToAdd)) adu.allowed_read_paths.push(pathToAdd);
        }
        adu.pending_design_write_paths = [];
      }
      adu.state = nextState;
      await monitor.repo.writeAdus(adus);

      // Broadcast WS event
      const wsEvent = {
        type: 'agentFactoryEvent',
        event: 'review_approved',
        aduId,
        gate,
        toState: nextState
      };
      broadcastOrchestratorEvent(wsEvent);

      res.json({ success: true, toState: nextState });
    } catch (err: unknown) {
      logger.error({ err, aduId, gate }, 'AgentFactory: approveReview error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // POST /api/agent-factory/adus/:aduId/reviews/:gate/request-rework
  router.post('/adus/:aduId/reviews/:gate/request-rework', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId, gate } = req.params;
    const { comment } = req.body as { comment?: string };

    if (gate !== 'analysis' && gate !== 'design') {
      res.status(400).json({ success: false, error: 'Invalid gate' });
      return;
    }

    if (!comment) {
      res.status(400).json({ success: false, error: 'Rework reason/comment is required' });
      return;
    }

    try {
      const adus = await monitor.repo.readAdus();
      const adu = adus.find((a) => a.id === aduId);
      if (!adu) {
        res.status(404).json({ success: false, error: `ADU ${aduId} not found` });
        return;
      }

      const expectedState = gate === 'analysis' ? 'analysis_review' : 'design_review';
      if (adu.state !== expectedState) {
        res.status(400).json({ success: false, error: `ADU state must be ${expectedState} to request rework` });
        return;
      }

      const reworkState = gate === 'analysis' ? 'created' : 'contexted';
      const artifactPath = gate === 'analysis'
        ? `.ai-agent/analysis/${aduId}.md`
        : `.ai-agent/designs/${aduId}-detailed-design.md`;

      const reviews = await monitor.repo.readReviews();
      let review = reviews.find((r) => r.adu_id === aduId && r.gate === gate && r.status === 'pending');

      if (review) {
        review.status = 'rework_requested';
        review.updated_at = new Date().toISOString();
        review.comment = comment || null;
      } else {
        review = {
          review_id: `review-${aduId}-${gate}-${Date.now()}`,
          adu_id: aduId,
          gate,
          state: expectedState,
          status: 'rework_requested',
          artifact_paths: [artifactPath],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          approved_at: null,
          approved_by: null,
          comment,
          approved_hashes: {}
        };
        reviews.push(review);
      }

      await monitor.repo.writeReviews(reviews);

      // Update ADU state
      if (gate === 'analysis') {
        const existingClarifications = Array.isArray(adu.clarifications) ? adu.clarifications : [];
        adu.clarifications = [
          ...existingClarifications,
          {
            question: '需求分析审核澄清/返工意见',
            status: 'answered',
            answer: comment,
            impact: 'design',
            updated_at: new Date().toISOString()
          }
        ];
      }
      adu.state = reworkState;
      await monitor.repo.writeAdus(adus);

      // Broadcast WS
      const wsEvent = {
        type: 'agentFactoryEvent',
        event: 'review_rework_requested',
        aduId,
        gate,
        toState: reworkState
      };
      broadcastOrchestratorEvent(wsEvent);

      res.json({ success: true, toState: reworkState });
    } catch (err: unknown) {
      logger.error({ err, aduId, gate }, 'AgentFactory: requestRework error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/adus/:aduId/editable-artifacts
  router.get('/adus/:aduId/editable-artifacts', asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    try {
      const workspaceRootOverride = await resolveWorkspaceRootOverride(aduId);
      const analysisPath = `.ai-agent/analysis/${aduId}.md`;
      const designPath = `.ai-agent/designs/${aduId}-detailed-design.md`;

      const artifacts = await monitor.repo.listArtifacts([analysisPath, designPath], workspaceRootOverride);
      const results = artifacts.map((art) => {
        const kind = art.path.includes('analysis') ? 'analysis' : 'design';
        const title = kind === 'analysis' ? '需求分析' : '详细设计';

        return {
          kind,
          path: art.path,
          title,
          exists: art.exists,
          editable: true,
          lastModifiedAt: art.modified_at || null,
          bytes: art.size_bytes || 0,
          sha256: ''
        };
      });

      // Calculate sha256 for existing ones
      for (const item of results) {
        if (item.exists) {
          try {
            const artContent = await monitor.repo.readTextArtifact(item.path, 200000, workspaceRootOverride);
            const crypto = await import('crypto');
            item.sha256 = crypto.createHash('sha256').update(artContent.content, 'utf-8').digest('hex');
          } catch (e) {}
        }
      }

      res.json({ aduId, artifacts: results });
    } catch (err: unknown) {
      logger.error({ err, aduId }, 'AgentFactory: getEditableArtifacts error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/editable-artifacts/content
  router.get('/editable-artifacts/content', asyncHandler(async (req: Request, res: Response) => {
    const filePath = req.query.path as string | undefined;
    const aduId = req.query.aduId as string | undefined;
    if (!filePath) {
      res.status(400).json({ success: false, error: 'Query parameter "path" is required' });
      return;
    }

    try {
      const workspaceRootOverride = await resolveWorkspaceRootOverride(aduId);
      const art = await monitor.repo.readTextArtifact(filePath, 200000, workspaceRootOverride);
      if (art.truncated) {
        res.status(400).json({ success: false, error: '文档大小超过 200KB 最大编辑上限，为防止保存时内容丢失，已被系统禁止编辑。' });
        return;
      }
      const crypto = await import('crypto');
      const sha256 = crypto.createHash('sha256').update(art.content, 'utf-8').digest('hex');
      res.json({
        path: filePath,
        content: art.content,
        sha256,
        bytes: Buffer.byteLength(art.content, 'utf-8'),
        truncated: art.truncated
      });
    } catch (err: unknown) {
      const error = err as Error & { code?: string };
      const errorMessage = error.message || 'Unknown error';
      if (errorMessage.includes('Access denied')) {
        res.status(403).json({ success: false, error: errorMessage });
        return;
      }
      if (errorMessage.includes('escapes workspace root')) {
        res.status(400).json({ success: false, error: errorMessage });
        return;
      }
      if (error.code === 'ENOENT') {
        res.status(404).json({ success: false, error: `Artifact file not found: ${filePath}` });
        return;
      }
      logger.error({ err, path: filePath }, 'AgentFactory: getEditableArtifactContent error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // PUT /api/agent-factory/editable-artifacts/content
  router.put('/editable-artifacts/content', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId, gate, path: filePath, content, baseSha256, changeReason } = req.body as {
      aduId: string;
      gate: 'analysis' | 'design';
      path: string;
      content: string;
      baseSha256: string;
      changeReason?: string;
    };

    if (!filePath || content === undefined || !baseSha256) {
      res.status(400).json({ success: false, error: 'path, content, and baseSha256 are required' });
      return;
    }

    try {
      // Check project status (disabled project is blocked from saving edits)
      const adu = await monitor.getAdu(aduId);
      if (adu && adu.project_id) {
        const project = await projectOnboarding.getProject(adu.project_id);
        if (project && project.status === 'disabled') {
          res.status(403).json({ success: false, error: `Project for ADU ${aduId} is disabled (read-only mode)` });
          return;
        }
      }

      const workspaceRootOverride = await resolveWorkspaceRootOverride(aduId);
      let currentContent = '';
      let currentSha256 = '';
      try {
        const art = await monitor.repo.readTextArtifact(filePath, 200000, workspaceRootOverride);
        if (art.truncated) {
          res.status(409).json({ error: 'conflict', message: '文档已超过 200KB 编辑上限，为防止数据丢失拒绝保存。' });
          return;
        }
        currentContent = art.content;
        const crypto = await import('crypto');
        currentSha256 = crypto.createHash('sha256').update(currentContent, 'utf-8').digest('hex');
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }

      if (currentSha256 && currentSha256 !== baseSha256) {
        res.status(409).json({ error: 'conflict', message: 'Artifact has changed since it was loaded.' });
        return;
      }

      const writeResult = await monitor.repo.writeTextArtifact(filePath, content, workspaceRootOverride);

      const edits = await monitor.repo.readEdits();
      const newEdit: AgentFactoryArtifactEdit = {
        edit_id: `edit-${aduId}-${Date.now()}`,
        adu_id: aduId,
        gate,
        artifact_path: filePath,
        editor: 'local-user',
        edited_at: new Date().toISOString(),
        change_reason: changeReason || '',
        previous_sha256: baseSha256,
        new_sha256: writeResult.sha256,
        previous_bytes: Buffer.byteLength(currentContent, 'utf-8'),
        new_bytes: writeResult.bytes
      };
      edits.push(newEdit);
      await monitor.repo.writeEdits(edits);

      const wsEvent = {
        type: 'agentFactoryEvent',
        event: 'artifact_updated',
        aduId,
        path: filePath,
        sha256: writeResult.sha256
      };
      broadcastOrchestratorEvent(wsEvent);

      res.json({ ok: true, path: filePath, sha256: writeResult.sha256, bytes: writeResult.bytes });
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message.includes('Access denied')) {
        res.status(403).json({ success: false, error: error.message });
        return;
      }
      if (error.message.includes('Payload too large')) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      logger.error({ err, path: filePath }, 'AgentFactory: saveEditableArtifactContent error');
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }));

  // --- ADU Intake Drafts ---

  router.post('/projects/:projectId/intake-drafts', requireControl, upload.array('files', 8), asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await aduIntake.createDraft(
        req.params.projectId,
        req.body.rawText || '',
        req.body.userHints || '',
        req.body.requirementType || 'feature',
        (req.files as Express.Multer.File[]) || []
      );
      res.status(201).json({ draft: result });
    } catch (e: any) {
      const status = e.status || (e.message?.includes('not found') || e.message?.includes('not profiled') ? 404 : 400);
      res.status(status).json({ error: e.message });
    }
  }));

  router.post('/intake-drafts/:draftId/generate', requireControl, asyncHandler(async (req: Request, res: Response) => {
    try {
      await aduIntake.generateDraft(req.params.draftId);
      res.json({ success: true, status: 'generating' });
    } catch (e: any) {
      const status = e.message?.includes('not found') ? 404 : 400;
      res.status(status).json({ error: e.message });
    }
  }));

  router.get('/intake-drafts/:draftId', asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await aduIntake.getDraft(req.params.draftId);
      res.json(result);
    } catch (e: any) {
      res.status(404).json({ error: e.message });
    }
  }));

  router.put('/intake-drafts/:draftId', requireControl, asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await aduIntake.updateDraft(req.params.draftId, req.body);
      res.json({ success: true, draft: result });
    } catch (e: any) {
      const status = e.message?.includes('not found') ? 404 : 400;
      res.status(status).json({ error: e.message });
    }
  }));

  router.post('/intake-drafts/:draftId/register-adu', requireControl, asyncHandler(async (req: Request, res: Response) => {
    try {
      const confirmed = req.body?.confirmed === true;
      const targetType = req.body?.target_type || 'adu';

      if (targetType === 'epic') {
        const result = await aduIntake.registerEpicDraft(req.params.draftId, { confirmed });
        res.json({ success: true, epic: { id: result.epic_id } });
      } else {
        const result = await aduIntake.registerDraft(req.params.draftId, { confirmed });
        res.json({ success: true, adu: { id: result.adu_id } });
      }
    } catch (e: any) {
      const status = e.status || (e.status === 409 || e.message?.includes('unresolved') ? 409 : e.message?.includes('not found') ? 404 : e.message?.includes('disabled') ? 403 : 400);
      res.status(status).json({ error: e.message });
    }
  }));

  // GET /api/agent-factory/adus/:aduId/write-path-expansions
  router.get('/adus/:aduId/write-path-expansions', asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    try {
      const p = path.join(config.workspaceRoot, '.ai-agent', 'registry', 'write-path-expansion-requests.json');
      let requests: any[] = [];
      try {
        const content = await fs.promises.readFile(p, 'utf-8');
        const data = jsonParse(content);
        requests = data.requests || [];
      } catch (e) {
        // file doesn't exist yet, return empty
      }
      const aduRequests = requests.filter((r: any) => r.adu_id === aduId);
      res.json({ aduId, requests: aduRequests });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  // POST /api/agent-factory/adus/:aduId/write-path-expansions/:requestId/approve
  router.post('/adus/:aduId/write-path-expansions/:requestId/approve', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId, requestId } = req.params;
    const { comment } = req.body;
    try {
      const p = path.join(config.workspaceRoot, '.ai-agent', 'registry', 'write-path-expansion-requests.json');
      let data = { version: 1, requests: [] as any[] };
      try {
        data = JSON.parse(await fs.promises.readFile(p, 'utf-8'));
      } catch (e) {}

      if (!data || !Array.isArray(data.requests)) {
        res.status(400).json({ error: 'Malformed expansion requests registry: requests must be an array' });
        return;
      }

      const reqIndex = data.requests.findIndex((r: any) => r.request_id === requestId && r.adu_id === aduId);
      if (reqIndex === -1) {
        res.status(404).json({ error: `Request ${requestId} not found for ADU ${aduId}` });
        return;
      }

      const expansionRequest = data.requests[reqIndex];
      if (expansionRequest.decision !== 'pending_human_approval') {
        res.status(400).json({ error: 'Only pending requests can be approved' });
        return;
      }

      const approvedPaths = expansionRequest.requested_paths;
      if (!Array.isArray(approvedPaths) || approvedPaths.length === 0 || !approvedPaths.every((p: any) => typeof p === 'string' && p.trim().length > 0)) {
        res.status(400).json({ error: 'Invalid or empty requested_paths array in expansion request' });
        return;
      }

      if (approvedPaths.length > 0) {
        try {
          const scriptPath = path.join(config.workspaceRoot, 'scripts', 'write_path_policy.py');
          const registryDir = path.join(config.workspaceRoot, '.ai-agent', 'registry');
          const policyOut = execFileSync('python3', [
            scriptPath,
            '--adu', aduId,
            '--requested-paths', JSON.stringify(approvedPaths),
            '--registry-dir', registryDir
          ], { encoding: 'utf-8' });
          const policyRes = JSON.parse(policyOut);
          if (policyRes.result === 'blocked') {
            expansionRequest.decision = 'blocked';
            expansionRequest.comment = comment || '';
            expansionRequest.updated_at = new Date().toISOString();
            await fs.promises.writeFile(p, JSON.stringify(data, null, 2), 'utf-8');

            res.status(400).json({ error: `Approval rejected: paths are blocked by policy: ${policyRes.blocked_paths.join(', ')}. Reason: ${policyRes.reason}` });
            return;
          }
        } catch (e: any) {
          res.status(500).json({ error: `Policy re-validation failed: ${e.message}` });
          return;
        }
      }

      expansionRequest.decision = 'approved';
      expansionRequest.comment = comment || '';
      expansionRequest.updated_at = new Date().toISOString();

      const adu = await agentFactoryRepository.getAduById(aduId);
      if (!adu) {
        res.status(404).json({ error: `ADU ${aduId} not found` });
        return;
      }

      const currentWrite = adu.allowed_write_paths || [];
      const currentRead = adu.allowed_read_paths || [];

      for (const filePath of approvedPaths) {
        if (!currentWrite.includes(filePath)) currentWrite.push(filePath);
        if (!currentRead.includes(filePath)) currentRead.push(filePath);
      }

      adu.allowed_write_paths = currentWrite;
      adu.allowed_read_paths = currentRead;

      if (!adu.write_path_expansions) adu.write_path_expansions = [];
      adu.write_path_expansions.push({
        request_id: expansionRequest.request_id,
        source_agent: expansionRequest.source_agent || 'unknown',
        requested_paths: expansionRequest.requested_paths,
        approved_paths: approvedPaths,
        decision: 'approved',
        reason: comment || expansionRequest.reason || '',
        created_at: expansionRequest.created_at,
        updated_at: expansionRequest.updated_at
      });

      const remainingPending = data.requests.some((r: any) => r.adu_id === aduId && r.decision === 'pending_human_approval' && r.request_id !== requestId);
      if (!remainingPending && adu.state === 'human_gate' && adu.gate_type === 'write_path_expansion') {
        adu.state = adu.pre_gate_state || 'created';
        adu.human_gate_required = false;
        delete adu.gate_type;
      }

      await fs.promises.writeFile(p, JSON.stringify(data, null, 2), 'utf-8');
      await agentFactoryRepository.saveAdu(adu);

      res.json({ success: true, adu });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  // POST /api/agent-factory/adus/:aduId/write-path-expansions/:requestId/reject
  router.post('/adus/:aduId/write-path-expansions/:requestId/reject', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId, requestId } = req.params;
    const { comment } = req.body;
    try {
      const p = path.join(config.workspaceRoot, '.ai-agent', 'registry', 'write-path-expansion-requests.json');
      let data = { version: 1, requests: [] as any[] };
      try {
        data = JSON.parse(await fs.promises.readFile(p, 'utf-8'));
      } catch (e) {}

      if (!data || !Array.isArray(data.requests)) {
        res.status(400).json({ error: 'Malformed expansion requests registry: requests must be an array' });
        return;
      }

      const reqIndex = data.requests.findIndex((r: any) => r.request_id === requestId && r.adu_id === aduId);
      if (reqIndex === -1) {
        res.status(404).json({ error: `Request ${requestId} not found for ADU ${aduId}` });
        return;
      }

      const expansionRequest = data.requests[reqIndex];
      if (expansionRequest.decision !== 'pending_human_approval') {
        res.status(400).json({ error: 'Only pending requests can be rejected' });
        return;
      }

      const approvedPaths = expansionRequest.requested_paths;
      if (!Array.isArray(approvedPaths) || approvedPaths.length === 0 || !approvedPaths.every((p: any) => typeof p === 'string' && p.trim().length > 0)) {
        res.status(400).json({ error: 'Invalid or empty requested_paths array in expansion request' });
        return;
      }

      expansionRequest.decision = 'rejected';
      expansionRequest.comment = comment || '';
      expansionRequest.updated_at = new Date().toISOString();

      const adu = await agentFactoryRepository.getAduById(aduId);
      if (adu) {
        if (!adu.write_path_expansions) adu.write_path_expansions = [];
        adu.write_path_expansions.push({
          request_id: expansionRequest.request_id,
          source_agent: expansionRequest.source_agent || 'unknown',
          requested_paths: expansionRequest.requested_paths,
          approved_paths: [],
          decision: 'rejected',
          reason: comment || '',
          created_at: expansionRequest.created_at,
          updated_at: expansionRequest.updated_at
        });
        await agentFactoryRepository.saveAdu(adu);
      }

      await fs.promises.writeFile(p, JSON.stringify(data, null, 2), 'utf-8');
      res.json({ success: true, request: expansionRequest });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  // Helper function to safely parse json
  function jsonParse(str: string): any {
    try {
      return JSON.parse(str);
    } catch {
      return {};
    }
  }

  // ── Phase 3: Epic Management ──

  // GET /api/agent-factory/epics
  router.get('/epics', asyncHandler(async (_req: Request, res: Response) => {
    try {
      const { epics } = await epicMonitor.getEpicDashboard();
      res.json({ epics });
    } catch (err: unknown) {
      logger.error({ err }, 'AgentFactory: listEpics error');
      res.status(500).json({ error: 'Internal server error' });
    }
  }));

  // POST /api/agent-factory/projects/:projectId/epics
  router.post('/projects/:projectId/epics', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    if (!projectId || !projectId.match(/^[A-Za-z0-9_.-]+$/)) {
      res.status(400).json({ error: 'Invalid projectId' });
      return;
    }
    try {
      const epic = await epicFactory.createForProject(projectId, req.body);
      res.status(201).json({ epic });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  }));

  // GET /api/agent-factory/projects/:projectId/epics
  router.get('/projects/:projectId/epics', asyncHandler(async (req: Request, res: Response) => {
    const { projectId } = req.params;
    if (!projectId || !projectId.match(/^[A-Za-z0-9_.-]+$/)) {
      res.status(400).json({ error: 'Invalid projectId' });
      return;
    }
    try {
      const { epics } = await epicMonitor.getEpicDashboard();
      const filtered = epics.filter(e => e.project_id === projectId);
      res.json({ project_id: projectId, epics: filtered });
    } catch (err: unknown) {
      logger.error({ err, projectId }, 'AgentFactory: listEpicsByProject error');
      res.status(500).json({ error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/epics/:epicId
  router.get('/epics/:epicId', asyncHandler(async (req: Request, res: Response) => {
    const { epicId } = req.params;
    if (!epicId || !epicId.match(/^[A-Za-z0-9_.-]+$/)) {
      res.status(400).json({ error: 'Invalid epicId' });
      return;
    }
    try {
      const epic = await epicMonitor.getEpic(epicId);
      if (!epic) {
        res.status(404).json({ error: 'Epic not found' });
        return;
      }
      res.json(epic);
    } catch (err: unknown) {
      logger.error({ err, epicId }, 'AgentFactory: getEpic error');
      res.status(500).json({ error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/epics/:epicId/artifacts
  router.get('/epics/:epicId/artifacts', asyncHandler(async (req: Request, res: Response) => {
    const { epicId } = req.params;
    if (!epicId || !epicId.match(/^[A-Za-z0-9_.-]+$/)) {
      res.status(400).json({ error: 'Invalid epicId' });
      return;
    }
    try {
      const epic = await epicMonitor.getEpic(epicId);
      if (!epic) {
        res.status(404).json({ error: 'Epic not found' });
        return;
      }
      const artifacts = await agentFactoryRepository.listEpicArtifacts(epicId, epic.repo_path);
      res.json({ epicId, artifacts });
    } catch (err: unknown) {
      logger.error({ err, epicId }, 'AgentFactory: listEpicArtifacts error');
      res.status(500).json({ error: 'Internal server error' });
    }
  }));

  // GET /api/agent-factory/epics/:epicId/dag
  router.get('/epics/:epicId/dag', asyncHandler(async (req: Request, res: Response) => {
    const { epicId } = req.params;
    if (!epicId || !epicId.match(/^[A-Za-z0-9_.-]+$/)) {
      res.status(400).json({ error: 'Invalid epicId' });
      return;
    }
    try {
      const epic = await epicMonitor.getEpic(epicId);
      if (!epic) {
        res.status(404).json({ error: 'Epic not found' });
        return;
      }
      res.json({ epic, children: epic.child_adu_views || [], dependencies: epic.dependencies });
    } catch (err: unknown) {
      logger.error({ err, epicId }, 'AgentFactory: getEpicDag error');
      res.status(500).json({ error: 'Internal server error' });
    }
  }));

  // ── Phase 3: Epic Orchestration ──

  const spawnEpicOrchestrator = async (epicId: string, mode: string): Promise<any> => {
    const epic = await agentFactoryRepository.getEpic(epicId);
    if (!epic) {
      throw Object.assign(new Error(`Epic ${epicId} not found`), { notFound: true });
    }

    // Check project status
    const project = await projectOnboarding.getProject(epic.project_id);
    if (project) {
      if (project.status === 'disabled') {
        throw Object.assign(new Error(`Project for Epic ${epicId} is disabled`), { forbidden: true });
      }
      if (project.status !== 'profiled') {
        throw Object.assign(new Error(`Project is not profiled (status: ${project.status})`), { forbidden: true });
      }
    }

    const orchestratorPath = path.join(config.workspaceRoot, 'scripts', 'hermes_epic_orchestrator.py');
    if (!fs.existsSync(orchestratorPath)) {
      throw new Error(`Epic orchestrator script not found at ${orchestratorPath}`);
    }

    const activeOp = operationStore.getActiveOperation(epicId);
    if (activeOp || activeOrchestrators.has(epicId)) {
      throw Object.assign(new Error(`Orchestrator is already running or waiting for Epic ${epicId}`), { conflict: true });
    }

    // Create Operation
    const op = operationStore.createOperation({
      scope: 'epic',
      target_id: epicId,
      action: mode as any,
      project_id: epic.project_id
    });

    activeOrchestrators.add(epicId);

    const { spawn } = await import('child_process');
    const spawnArgs = [
      orchestratorPath,
      '--epic', epicId,
      '--mode', mode,
      '--project', epic.project_id,
      '--repo-root', epic.repo_path,
      '--operation-id', op.operation_id
    ];
    const child = spawn('python3', spawnArgs, {
      cwd: config.workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    operationStore.updateOperation(op.operation_id, { pid: child.pid });

    let stdoutData = '';
    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
      let lineEnd = stdoutData.indexOf('\n');
      while (lineEnd !== -1) {
        const line = stdoutData.substring(0, lineEnd).trim();
        stdoutData = stdoutData.substring(lineEnd + 1);
        if (line) {
          try {
            const parsed = JSON.parse(line);
            broadcastOrchestratorEvent(parsed);
            operationStore.addEvent(op.operation_id, {
              type: parsed.event || parsed.type || 'orchestrator_event',
              payload: parsed,
              stream: 'stdout',
              message: parsed.message || (parsed.payload && parsed.payload.message) || '',
              severity: parsed.severity || 'info'
            });

            // Update current status / state of operation
            const updates: any = {};
            if (parsed.agent) updates.current_agent = parsed.agent;
            if (parsed.state) updates.current_state = parsed.state;
            if (parsed.event === 'human_gate_opened') {
              updates.status = 'waiting_human';
            }
            if (Object.keys(updates).length > 0) {
              operationStore.updateOperation(op.operation_id, updates);
            }
          } catch (_) {
            logger.debug({ line }, 'Failed to parse line from epic orchestrator stdout');
            operationStore.addEvent(op.operation_id, {
              type: 'stdout_raw',
              payload: { line },
              stream: 'stdout',
            });
          }
        }
        lineEnd = stdoutData.indexOf('\n');
      }
    });

    let stderrBuf = '';
    child.stderr.on('data', (chunk) => {
      const str = chunk.toString();
      logger.error(`EpicOrchestrator stderr: ${str}`);
      stderrBuf += str;
      let lineEnd = stderrBuf.indexOf('\n');
      while (lineEnd !== -1) {
        const line = stderrBuf.substring(0, lineEnd).trim();
        stderrBuf = stderrBuf.substring(lineEnd + 1);
        if (line) {
          operationStore.addEvent(op.operation_id, {
            type: 'stderr_line',
            payload: { line },
            stream: 'stderr',
          });
        }
        lineEnd = stderrBuf.indexOf('\n');
      }
    });

    child.on('close', async (code) => {
      logger.info(`EpicOrchestrator closed with code ${code}`);
      activeOrchestrators.delete(epicId);

      // flush remaining buffers
      if (stdoutData.trim()) {
        try {
          const parsed = JSON.parse(stdoutData.trim());
          broadcastOrchestratorEvent(parsed);
          operationStore.addEvent(op.operation_id, {
            type: parsed.event || parsed.type || 'orchestrator_event',
            payload: parsed,
            stream: 'stdout',
            message: parsed.message || (parsed.payload && parsed.payload.message) || '',
            severity: parsed.severity || 'info'
          });
        } catch (_) {
          operationStore.addEvent(op.operation_id, {
            type: 'stdout_raw',
            payload: { line: stdoutData.trim() },
            stream: 'stdout',
          });
        }
      }
      if (stderrBuf.trim()) {
        operationStore.addEvent(op.operation_id, {
          type: 'stderr_line',
          payload: { line: stderrBuf.trim() },
          stream: 'stderr',
        });
      }

      broadcastOrchestratorEvent({ epic: epicId, action: 'closed', code });

      let finalState: string | undefined;
      try {
        const updatedEpic = await agentFactoryRepository.getEpic(epicId);
        if (updatedEpic) {
          finalState = updatedEpic.state;
        }
      } catch (_) {}

      let status: any = 'completed';
      let result: any = 'success';

      if (code === 20 || finalState === 'human_gate') {
        status = 'waiting_human';
        result = 'human_gate';

        const HumanGateService = (await import('../application/human-gate-service')).HumanGateService;
        const humanGateService = HumanGateService.getInstance();
        await humanGateService.openGate({
          scope: 'epic',
          target_id: epicId,
          gate_type: 'environment_verification_required',
          title: 'Epic Runtime Evidence Required',
          reason: 'Epic acceptance testing requires environment verification.',
          source_agent: 'epic-acceptance-reviewer',
          pre_gate_state: epic.state || 'child_adus_evidenced'
        });
      } else if (code !== 0) {
        status = 'failed';
        result = 'failed';
      }

      operationStore.updateOperation(op.operation_id, {
        status,
        result,
        exitCode: code,
        finalState,
      });
    });

    return op;
  };

  // POST /api/agent-factory/epics/:epicId/start
  router.post('/epics/:epicId/start', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { epicId } = req.params;
    try {
      const result = await spawnEpicOrchestrator(epicId, 'start');
      res.json(result);
    } catch (err: unknown) {
      if ((err as any).notFound) { res.status(404).json({ error: (err as Error).message }); return; }
      if ((err as any).conflict) { res.status(409).json({ error: (err as Error).message }); return; }
      if ((err as any).forbidden) { res.status(403).json({ error: (err as Error).message }); return; }
      logger.error({ err, epicId }, 'AgentFactory: startEpic error');
      res.status(500).json({ error: 'Failed to start Epic orchestrator' });
    }
  }));

  // POST /api/agent-factory/epics/:epicId/continue
  router.post('/epics/:epicId/continue', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { epicId } = req.params;
    try {
      const result = await spawnEpicOrchestrator(epicId, 'continue');
      res.json(result);
    } catch (err: unknown) {
      if ((err as any).notFound) { res.status(404).json({ error: (err as Error).message }); return; }
      if ((err as any).conflict) { res.status(409).json({ error: (err as Error).message }); return; }
      if ((err as any).forbidden) { res.status(403).json({ error: (err as Error).message }); return; }
      logger.error({ err, epicId }, 'AgentFactory: continueEpic error');
      res.status(500).json({ error: 'Failed to continue Epic orchestrator' });
    }
  }));

  // POST /api/agent-factory/epics/:epicId/step
  router.post('/epics/:epicId/step', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { epicId } = req.params;
    try {
      const result = await spawnEpicOrchestrator(epicId, 'step');
      res.json(result);
    } catch (err: unknown) {
      if ((err as any).notFound) { res.status(404).json({ error: (err as Error).message }); return; }
      if ((err as any).conflict) { res.status(409).json({ error: (err as Error).message }); return; }
      if ((err as any).forbidden) { res.status(403).json({ error: (err as Error).message }); return; }
      logger.error({ err, epicId }, 'AgentFactory: stepEpic error');
      res.status(500).json({ error: 'Failed to step Epic orchestrator' });
    }
  }));

  // POST /api/agent-factory/epics/:epicId/pause
  router.post('/epics/:epicId/pause', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { epicId } = req.params;
    try {
      const result = await spawnEpicOrchestrator(epicId, 'pause');
      res.json(result);
    } catch (err: unknown) {
      if ((err as any).notFound) { res.status(404).json({ error: (err as Error).message }); return; }
      if ((err as any).conflict) { res.status(409).json({ error: (err as Error).message }); return; }
      if ((err as any).forbidden) { res.status(403).json({ error: (err as Error).message }); return; }
      logger.error({ err, epicId }, 'AgentFactory: pauseEpic error');
      res.status(500).json({ error: 'Failed to pause Epic' });
    }
  }));

  // POST /api/agent-factory/epics/:epicId/cancel
  router.post('/epics/:epicId/cancel', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { epicId } = req.params;
    try {
      const result = await spawnEpicOrchestrator(epicId, 'cancel');
      res.json(result);
    } catch (err: unknown) {
      if ((err as any).notFound) { res.status(404).json({ error: (err as Error).message }); return; }
      if ((err as any).conflict) { res.status(409).json({ error: (err as Error).message }); return; }
      if ((err as any).forbidden) { res.status(403).json({ error: (err as Error).message }); return; }
      logger.error({ err, epicId }, 'AgentFactory: cancelEpic error');
      res.status(500).json({ error: 'Failed to cancel Epic' });
    }
  }));

  // POST /api/agent-factory/epics/:epicId/materialize-child-adus
  router.post('/epics/:epicId/materialize-child-adus', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { epicId } = req.params;
    try {
      const result = await spawnEpicOrchestrator(epicId, 'step');
      res.json(result);
    } catch (err: unknown) {
      if ((err as any).notFound) { res.status(404).json({ error: (err as Error).message }); return; }
      if ((err as any).conflict) { res.status(409).json({ error: (err as Error).message }); return; }
      if ((err as any).forbidden) { res.status(403).json({ error: (err as Error).message }); return; }
      logger.error({ err, epicId }, 'AgentFactory: materializeChildAdus error');
      res.status(500).json({ error: 'Failed to materialize child ADUs' });
    }
  }));

  // GET /api/agent-factory/operations
  router.get('/operations', asyncHandler(async (req: Request, res: Response) => {
    const { targetId, scope } = req.query as { targetId?: string; scope?: string };
    let ops = operationStore.getAll();
    if (targetId) {
      ops = ops.filter(o => o.target_id === targetId || o.targetId === targetId);
    }
    if (scope) {
      ops = ops.filter(o => o.scope === scope || o.targetType === scope);
    }
    res.json(ops);
  }));

  // GET /api/agent-factory/operations/:operationId
  router.get('/operations/:operationId', asyncHandler(async (req: Request, res: Response) => {
    const { operationId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(operationId)) {
      res.status(400).json({ success: false, error: 'Invalid operationId format' });
      return;
    }
    const op = operationStore.getOperation(operationId);
    if (!op) {
      res.status(404).json({ error: `Operation ${operationId} not found` });
      return;
    }
    res.json(op);
  }));


  // GET /api/agent-factory/operations/:operationId/events
  router.get('/operations/:operationId/events', asyncHandler(async (req: Request, res: Response) => {
    const { operationId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(operationId)) {
      res.status(400).json({ success: false, error: 'Invalid operationId format' });
      return;
    }
    const registryDir = path.join(config.workspaceRoot, '.ai-agent', 'registry');
    const file = path.join(registryDir, 'events.json');
    if (!fs.existsSync(file)) {
      res.json([]);
      return;
    }
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(content);
      const events = parsed.events || [];
      const opEvents = events.filter((e: any) => e.operation_id === operationId);
      res.json(opEvents);
    } catch (_) {
      res.json([]);
    }
  }));

  // GET /api/agent-factory/events
  router.get('/events', asyncHandler(async (req: Request, res: Response) => {
    const { targetId, operationId, limit } = req.query as { targetId?: string; operationId?: string; limit?: string };
    if (targetId && !/^[A-Za-z0-9_.-]+$/.test(targetId)) {
      res.status(400).json({ success: false, error: 'Invalid targetId format' });
      return;
    }
    if (operationId && !/^[A-Za-z0-9_.-]+$/.test(operationId)) {
      res.status(400).json({ success: false, error: 'Invalid operationId format' });
      return;
    }

    const registryDir = path.join(config.workspaceRoot, '.ai-agent', 'registry');
    const file = path.join(registryDir, 'events.json');
    if (!fs.existsSync(file)) {
      res.json([]);
      return;
    }
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(content);
      let events = parsed.events || [];
      if (targetId) {
        events = events.filter((e: any) => e.target_id === targetId);
      }
      if (operationId) {
        events = events.filter((e: any) => e.operation_id === operationId);
      }
      if (limit) {
        const lim = parseInt(limit, 10);
        if (!isNaN(lim)) {
          events = events.slice(-lim);
        }
      }
      res.json(events);
    } catch (_) {
      res.json([]);
    }
  }));

  // GET /api/agent-factory/epics/:epicId/operations/latest
  router.get('/epics/:epicId/operations/latest', asyncHandler(async (req: Request, res: Response) => {
    const { epicId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(epicId)) {
      res.status(400).json({ success: false, error: 'Invalid epicId format' });
      return;
    }
    const op = operationStore.getLatestForTarget('epic', epicId);
    res.json(op || null);
  }));

  // GET /api/agent-factory/adus/:aduId/operations/latest
  router.get('/adus/:aduId/operations/latest', asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(aduId)) {
      res.status(400).json({ success: false, error: 'Invalid aduId format' });
      return;
    }
    const op = operationStore.getLatestForTarget('adu', aduId);
    res.json(op || null);
  }));

  // GET /api/agent-factory/human-gates
  router.get('/human-gates', asyncHandler(async (req: Request, res: Response) => {
    const { status } = req.query as { status?: string };
    if (status && !['pending', 'approved', 'rejected', 'rework_requested', 'waived', 'resolved', 'canceled'].includes(status)) {
      res.status(400).json({ success: false, error: 'Invalid status query value' });
      return;
    }
    const HumanGateService = (await import('../application/human-gate-service')).HumanGateService;
    const gates = await HumanGateService.getInstance().listGates(status ? { status } : undefined);
    res.json(gates);
  }));

  // GET /api/agent-factory/human-gates/:gateId
  router.get('/human-gates/:gateId', asyncHandler(async (req: Request, res: Response) => {
    const { gateId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(gateId)) {
      res.status(400).json({ success: false, error: 'Invalid gateId format' });
      return;
    }
    const HumanGateService = (await import('../application/human-gate-service')).HumanGateService;
    const gate = await HumanGateService.getInstance().getGate(gateId);
    if (!gate) {
      res.status(404).json({ error: `Human Gate ${gateId} not found` });
      return;
    }
    res.json(gate);
  }));


  // POST /api/agent-factory/human-gates/:gateId/runtime-result
  router.post('/human-gates/:gateId/runtime-result', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { gateId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(gateId)) {
      res.status(400).json({ success: false, error: 'Invalid gateId format' });
      return;
    }
    const { command, exitCode, output } = req.body as { command: string; exitCode: number; output: string };
    if (typeof command !== 'string' || !command.trim()) {
      res.status(400).json({ success: false, error: 'command must be a non-empty string' });
      return;
    }
    if (typeof exitCode !== 'number' || exitCode !== 0) {
      res.status(400).json({ success: false, error: 'exitCode must be 0 for passing runtime result' });
      return;
    }
    if (typeof output !== 'string' || !output.trim()) {
      res.status(400).json({ success: false, error: 'output must be a non-empty string' });
      return;
    }
    const HumanGateService = (await import('../application/human-gate-service')).HumanGateService;
    await HumanGateService.getInstance().submitRuntimeResult(gateId, { command, exitCode, output });
    res.json({ success: true });
  }));

  // POST /api/agent-factory/human-gates/:gateId/waive
  router.post('/human-gates/:gateId/waive', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { gateId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(gateId)) {
      res.status(400).json({ success: false, error: 'Invalid gateId format' });
      return;
    }
    const { assertion_ids, waiver_type, reason, risk, follow_up, operator } = req.body as {
      assertion_ids: string[];
      waiver_type: string;
      reason: string;
      risk: string;
      follow_up: string;
      operator: string;
    };
    if (!Array.isArray(assertion_ids) || assertion_ids.length === 0 || assertion_ids.some(id => typeof id !== 'string' || !id.trim())) {
      res.status(400).json({ success: false, error: 'assertion_ids must be a non-empty array of strings' });
      return;
    }
    if (typeof waiver_type !== 'string' || !waiver_type.trim()) {
      res.status(400).json({ success: false, error: 'waiver_type must be a non-empty string' });
      return;
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      res.status(400).json({ success: false, error: 'reason must be a non-empty string' });
      return;
    }
    if (typeof risk !== 'string' || !risk.trim()) {
      res.status(400).json({ success: false, error: 'risk must be a non-empty string' });
      return;
    }
    if (typeof follow_up !== 'string') {
      res.status(400).json({ success: false, error: 'follow_up must be a string' });
      return;
    }
    if (operator && typeof operator !== 'string') {
      res.status(400).json({ success: false, error: 'operator must be a string' });
      return;
    }

    const HumanGateService = (await import('../application/human-gate-service')).HumanGateService;
    try {
      await HumanGateService.getInstance().approveWaiver(gateId, {
        assertion_ids,
        waiver_type,
        reason,
        risk,
        follow_up,
        operator: operator || 'local-operator'
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }));

  // POST /api/agent-factory/human-gates/:gateId/request-rework
  router.post('/human-gates/:gateId/request-rework', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { gateId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(gateId)) {
      res.status(400).json({ success: false, error: 'Invalid gateId format' });
      return;
    }
    const { targetAgent, instruction } = req.body as { targetAgent: 'developer' | 'rework-planner'; instruction: string };
    if (targetAgent !== 'developer' && targetAgent !== 'rework-planner') {
      res.status(400).json({ success: false, error: 'Invalid targetAgent. Must be developer or rework-planner' });
      return;
    }
    if (typeof instruction !== 'string' || !instruction.trim()) {
      res.status(400).json({ success: false, error: 'instruction must be a non-empty string' });
      return;
    }
    const HumanGateService = (await import('../application/human-gate-service')).HumanGateService;
    await HumanGateService.getInstance().requestRework(gateId, { targetAgent, instruction });
    res.json({ success: true });
  }));

  // POST /api/agent-factory/human-gates/:gateId/cancel
  router.post('/human-gates/:gateId/cancel', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { gateId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(gateId)) {
      res.status(400).json({ success: false, error: 'Invalid gateId format' });
      return;
    }
    const { reason } = req.body as { reason: string };
    if (typeof reason !== 'string' || !reason.trim()) {
      res.status(400).json({ success: false, error: 'reason must be a non-empty string' });
      return;
    }
    const HumanGateService = (await import('../application/human-gate-service')).HumanGateService;
    await HumanGateService.getInstance().cancelGate(gateId, reason);
    res.json({ success: true });
  }));

  // POST /api/agent-factory/human-gates/:gateId/approve
  router.post('/human-gates/:gateId/approve', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { gateId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(gateId)) {
      res.status(400).json({ success: false, error: 'Invalid gateId format' });
      return;
    }
    const { comment } = req.body as { comment?: string };
    if (comment !== undefined && typeof comment !== 'string') {
      res.status(400).json({ success: false, error: 'comment must be a string' });
      return;
    }
    const HumanGateService = (await import('../application/human-gate-service')).HumanGateService;
    await HumanGateService.getInstance().approveGate(gateId, comment);
    res.json({ success: true });
  }));


  // GET /api/agent-factory/adus/:aduId/evidence-matrix
  router.get('/adus/:aduId/evidence-matrix', asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(aduId)) {
      res.status(400).json({ success: false, error: 'Invalid aduId format' });
      return;
    }
    const EvidenceGovernanceService = (await import('../application/evidence-governance')).EvidenceGovernanceService;
    const matrix = await EvidenceGovernanceService.getInstance().buildEvidenceMatrix(aduId);
    res.json(matrix);
  }));

  // POST /api/agent-factory/adus/:aduId/validate-evidence
  router.post('/adus/:aduId/validate-evidence', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(aduId)) {
      res.status(400).json({ success: false, error: 'Invalid aduId format' });
      return;
    }
    const EvidenceGovernanceService = (await import('../application/evidence-governance')).EvidenceGovernanceService;
    const result = await EvidenceGovernanceService.getInstance().validateEvidencePackage(aduId);
    res.json(result);
  }));


  // GET /api/agent-factory/token-governance
  router.get('/token-governance', asyncHandler(async (_req: Request, res: Response) => {
    const TokenGovernanceService = (await import('../application/token-governance')).TokenGovernanceService;
    const budgetConfig = TokenGovernanceService.getInstance().getBudgetConfig();
    res.json(budgetConfig);
  }));

  // PUT /api/agent-factory/token-governance
  router.put('/token-governance', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const TokenGovernanceService = (await import('../application/token-governance')).TokenGovernanceService;
    TokenGovernanceService.getInstance().updateBudgetConfig(req.body);
    res.json({ success: true });
  }));

  // POST /api/agent-factory/token-governance/estimate-next-run
  router.post('/token-governance/estimate-next-run', asyncHandler(async (req: Request, res: Response) => {
    const { aduId, agent } = req.body as { aduId: string; agent: string };
    const TokenGovernanceService = (await import('../application/token-governance')).TokenGovernanceService;
    const estimation = await TokenGovernanceService.getInstance().estimateNextRun(aduId, agent);
    res.json(estimation);
  }));

  // POST /api/agent-factory/epics/:epicId/reconcile
  router.post('/epics/:epicId/reconcile', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { epicId } = req.params;
    try {
      const epic = await agentFactoryRepository.getEpic(epicId);
      if (!epic) {
        res.status(404).json({ success: false, error: 'Epic not found' });
        return;
      }
      const dashboard = await epicMonitor.getEpicDashboard();
      const updated = dashboard.epics.find(e => e.id === epicId);
      res.json({ success: true, epic: updated });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to reconcile epic' });
    }
  }));

  // ── Operator Control Layer Endpoints ──

  // POST /api/agent-factory/operator/intake
  router.post('/operator/intake', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { project_id, raw_requirement, source_files, preferred_granularity, language } = req.body as {
      project_id: string;
      raw_requirement: string;
      source_files?: any[];
      preferred_granularity?: 'auto' | 'adu' | 'epic';
      language?: string;
    };
    if (!project_id || !raw_requirement) {
      res.status(400).json({ success: false, error: 'project_id and raw_requirement are required' });
      return;
    }
    const project = await projectOnboarding.getProject(project_id);
    if (!project || project.status !== 'profiled') {
      res.status(400).json({ success: false, error: `Project ${project_id} not found or not profiled` });
      return;
    }

    let recTarget: 'adu' | 'epic' = 'adu';
    if (preferred_granularity === 'epic' || preferred_granularity === 'adu') {
      recTarget = preferred_granularity;
    } else {
      const lowerReq = raw_requirement.toLowerCase();
      if (lowerReq.includes('epic') || lowerReq.includes('多个adu') || lowerReq.includes('multiple modules') || lowerReq.includes('系统架构') || raw_requirement.length > 500) {
        recTarget = 'epic';
      }
    }

    const draftResult = await aduIntake.createDraft(
      project_id,
      raw_requirement,
      '',
      'feature',
      []
    );

    await aduIntake.generateDraftSync(draftResult.draft_id);

    res.json({
      draft_id: draftResult.draft_id,
      recommended_target: recTarget,
      reason: recTarget === 'epic' ? 'The requirement is complex, recommending an Epic split.' : 'The requirement is scoped, recommending a single ADU.',
      clarification_questions: []
    });
  }));

  // GET /api/agent-factory/operator/:targetType/:targetId/next-action
  router.get('/operator/:targetType/:targetId/next-action', asyncHandler(async (req: Request, res: Response) => {
    const { targetType, targetId } = req.params;
    if (targetType === 'adu') {
      const adu = await monitor.repo.getAduById(targetId);
      if (!adu) {
        res.status(404).json({ success: false, error: `ADU ${targetId} not found` });
        return;
      }
      const nextAction = await nextActionAdvisor.getNextActionForAdu(adu);
      res.json(nextAction);
    } else if (targetType === 'epic') {
      const epic = await epicMonitor.getEpic(targetId);
      if (!epic) {
        res.status(404).json({ success: false, error: `Epic ${targetId} not found` });
        return;
      }
      const nextAction = await nextActionAdvisor.getNextActionForEpic(epic);
      res.json(nextAction);
    } else {
      res.status(400).json({ success: false, error: `Invalid targetType: ${targetType}` });
    }
  }));

  // POST /api/agent-factory/operator/:targetType/:targetId/actions
  router.post('/operator/:targetType/:targetId/actions', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { targetType, targetId } = req.params;
    const { action, idempotency_key, requested_by, payload } = req.body as {
      action: OperatorActionType;
      idempotency_key: string;
      requested_by?: 'human' | 'codex' | 'system';
      payload?: Record<string, any>;
    };

    if (targetType !== 'adu' && targetType !== 'epic') {
      res.status(400).json({ success: false, error: 'targetType must be adu or epic' });
      return;
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(targetId)) {
      res.status(400).json({ success: false, error: 'Invalid targetId format' });
      return;
    }
    if (!action || !idempotency_key) {
      res.status(400).json({ success: false, error: 'action and idempotency_key are required' });
      return;
    }

    try {
      const result = await operatorControl.executeAction({
        id: `ACT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        target: { type: targetType as any, id: targetId },
        action: action,
        requested_by: requested_by || 'human',
        idempotency_key,
        payload,
        created_at: new Date().toISOString()
      });
      res.json(result);
    } catch (err: any) {
      if (err.conflict) {
        res.status(409).json({ success: false, error: err.message });
      } else if (err.forbidden) {
        res.status(403).json({ success: false, error: err.message });
      } else {
        logger.error({ err, targetId, action }, 'Operator action failed');
        res.status(err.status || 500).json({ success: false, error: err.message || 'Internal server error' });
      }
    }
  }));

  // GET /api/agent-factory/operator/:targetType/:targetId/handoff
  router.get('/operator/:targetType/:targetId/handoff', asyncHandler(async (req: Request, res: Response) => {
    const { targetType, targetId } = req.params;

    if (targetType === 'adu') {
      const adu = await monitor.getAdu(targetId);
      if (!adu) {
        res.status(404).json({ success: false, error: `ADU ${targetId} not found` });
        return;
      }

      const nextAction = await nextActionAdvisor.getNextActionForAdu(adu);
      const recentRuns = adu.runs ? adu.runs.slice(0, 5) : [];

      res.json({
        target: { type: 'adu', id: targetId },
        summary: `ADU is currently in state: ${adu.state}. Goal: ${adu.title}.`,
        current_state: adu.state,
        next_action: nextAction,
        recent_events: recentRuns.map(r => `Run ${r.agent} at ${r.timestamp} finished with result ${r.result}`),
        quality_risks: adu.health?.reasons || [],
        token_summary: adu.token_summary || {},
        artifact_links: adu.artifact_status ? adu.artifact_status.filter(a => a.exists).map(a => a.path) : []
      });
    } else if (targetType === 'epic') {
      const epic = await epicMonitor.getEpic(targetId);
      if (!epic) {
        res.status(404).json({ success: false, error: `Epic ${targetId} not found` });
        return;
      }

      const nextAction = await nextActionAdvisor.getNextActionForEpic(epic);
      const childAdus = epic.child_adu_views || [];

      res.json({
        target: { type: 'epic', id: targetId },
        summary: `Epic is in state: ${epic.state}. Contains ${childAdus.length} child ADUs.`,
        current_state: epic.state,
        next_action: nextAction,
        recent_events: [],
        quality_risks: epic.health?.reasons || [],
        token_summary: {},
        artifact_links: []
      });
    } else {
      res.status(400).json({ success: false, error: `Invalid targetType: ${targetType}` });
    }
  }));

  return router;
}

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
import type { AgentFactoryArtifactEdit } from '../domain/agent-factory';

const config = loadAppConfig();

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
import multer from 'multer';

export function createAgentFactoryRouter(
  monitor: AgentFactoryMonitorUseCase,
  projectOnboarding: ProjectOnboardingUseCase,
  projectRepository: ProjectRepository,
  agentFactoryRepository: AgentFactoryRepository,
  logger: Logger,
  aduIntake: AduIntake
): Router {
  const router = Router();
  const upload = multer({ dest: '/tmp/' });

  const resolveWorkspaceRootOverride = async (aduId?: string): Promise<string | undefined> => {
    if (!aduId) return undefined;
    const adu = await monitor.getAdu(aduId);
    if (!adu || !adu.project_id) return undefined;
    const project = await projectOnboarding.getProject(adu.project_id);
    if (!project) return undefined;
    return project.repo_path;
  };

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
  const spawnOrchestrator = async (aduId: string, mode: string): Promise<{ success: boolean; message: string }> => {
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

    if ((mode === 'start' || mode === 'continue') && activeOrchestrators.has(aduId)) {
      throw new Error(`Orchestrator is already running for ADU ${aduId}`);
    }

    if (mode === 'start' || mode === 'continue') {
      activeOrchestrators.add(aduId);
    }

    const { spawn } = await import('child_process');
    const spawnArgs = [orchestratorPath, '--adu', aduId, '--mode', mode, '--repo-root', workspaceRootOverride];
    if (adu?.project_id) {
      spawnArgs.push('--project', adu.project_id);
    }
    const child = spawn('python3', spawnArgs, {
      cwd: config.workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

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
          } catch (e) {
            logger.debug({ line }, 'Failed to parse line from orchestrator stdout');
          }
        }
        lineEnd = stdoutData.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk) => {
      logger.error(`Orchestrator stderr: ${chunk.toString()}`);
    });

    child.on('close', (code) => {
      logger.info(`Orchestrator child process closed with code ${code}`);
      activeOrchestrators.delete(aduId);
      broadcastOrchestratorEvent({ adu: aduId, action: 'closed', code });
    });

    return { success: true, message: `Orchestrator ${mode} dispatched` };
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

  // POST /api/agent-factory/adus/:aduId/pause
  router.post('/adus/:aduId/pause', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    try {
      const adu = await monitor.getAdu(aduId);
      if (!adu) {
        res.status(404).json({ success: false, error: `ADU ${aduId} not found` });
        return;
      }
      const result = await spawnOrchestrator(aduId, 'pause');
      res.json(result);
    } catch (err: unknown) {
      logger.error({ err, aduId }, 'AgentFactory: pauseOrchestrator error');
      res.status(500).json({ success: false, error: 'Failed to pause orchestrator' });
    }
  }));

  // POST /api/agent-factory/adus/:aduId/cancel
  router.post('/adus/:aduId/cancel', requireControl, asyncHandler(async (req: Request, res: Response) => {
    const { aduId } = req.params;
    try {
      const adu = await monitor.getAdu(aduId);
      if (!adu) {
        res.status(404).json({ success: false, error: `ADU ${aduId} not found` });
        return;
      }
      const result = await spawnOrchestrator(aduId, 'cancel');
      res.json(result);
    } catch (err: unknown) {
      logger.error({ err, aduId }, 'AgentFactory: cancelOrchestrator error');
      res.status(500).json({ success: false, error: 'Failed to cancel orchestrator' });
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
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  }));

  router.post('/intake-drafts/:draftId/generate', requireControl, asyncHandler(async (req: Request, res: Response) => {
    try {
      await aduIntake.generateDraft(req.params.draftId);
      res.json({ success: true, status: 'generating' });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  }));

  router.get('/intake-drafts/:draftId', asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await aduIntake.getDraft(req.params.draftId);
      res.json(result);
    } catch (e: any) { res.status(404).json({ error: e.message }); }
  }));

  router.put('/intake-drafts/:draftId', requireControl, asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await aduIntake.updateDraft(req.params.draftId, req.body);
      res.json({ success: true, draft: result });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  }));

  router.post('/intake-drafts/:draftId/register-adu', requireControl, asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await aduIntake.registerDraft(req.params.draftId);
      res.json({ success: true, adu: { id: result.adu_id } });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  }));

  return router;
}

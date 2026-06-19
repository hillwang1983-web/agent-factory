import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { IntakeGenerationService } from './intake/intake-generation-service';
import { FileProjectRepository } from '../infrastructure/file-project-repository';
import { ProjectAduFactory } from './project-adu-factory';
import { EpicFactory } from './epic-factory';
import { RegistryLock } from '../infrastructure/registry-lock';
import {
  AgentFactoryIntakeRawInput,
  AgentFactoryAduDraft,
  AgentFactoryIntakeSourceFile,
  AgentFactoryDraftQuestionAnswer,
  AgentFactoryEpic
} from '../domain/agent-factory';

const BLOCKED_COMMAND_FRAGMENTS = [
  'rm -rf', 'sudo ', 'curl ', 'wget ', 'ssh ', 'scp ', 'rsync ',
  'chmod -R 777', '> /dev/', 'dd ', 'mkfs', 'launchctl', 'security ',
  'git push', 'git clean', 'git reset --hard',
  '|', ';', '&&', '||', '>', '<', '`',
];

const BLOCKED_WRITE_PATH_PREFIXES = ['.git/', '.agent-factory/', '~/', '/Users/', '/home/', '/etc/', '/tmp/', '/var/'];

function validateRepoRelativePath(input: string, label: string): string {
  const v = input.trim().replace(/\\/g, '/');
  if (!v) throw new Error(`${label}: path must not be empty`);
  if (v.startsWith('/')) throw new Error(`${label}: path must not start with "/" — got "${input}"`);
  if (v.includes('..')) throw new Error(`${label}: path must not contain ".." — got "${input}"`);
  if (v.includes('\0')) throw new Error(`${label}: path contains NUL bytes`);
  return v;
}

function validateDraftFields(updates: Partial<AgentFactoryAduDraft>): void {
  if (updates.preferredReadPaths !== undefined) {
    for (const p of updates.preferredReadPaths) validateRepoRelativePath(p, 'preferredReadPaths');
  }
  if (updates.preferredWritePaths !== undefined) {
    for (const p of updates.preferredWritePaths) {
      validateRepoRelativePath(p, 'preferredWritePaths');
      for (const blocked of BLOCKED_WRITE_PATH_PREFIXES) {
        if (p.startsWith(blocked) || p === blocked.replace(/\/$/, '')) {
          throw new Error(`preferredWritePaths: blocked path "${p}"`);
        }
      }
    }
  }
  if (updates.requiredCommands !== undefined) {
    for (const cmd of updates.requiredCommands) {
      for (const fragment of BLOCKED_COMMAND_FRAGMENTS) {
        if (cmd.includes(fragment)) {
          throw new Error(`requiredCommands: blocked fragment "${fragment}" in command "${cmd}"`);
        }
      }
    }
  }
  if (updates.risk !== undefined && !['low', 'medium', 'high'].includes(updates.risk)) {
    throw new Error(`risk must be low, medium, or high — got "${updates.risk}"`);
  }
  if (updates.targetLevel !== undefined && !['mvp', 'production'].includes(updates.targetLevel)) {
    throw new Error(`targetLevel must be mvp or production — got "${updates.targetLevel}"`);
  }
  if (updates.question_answers !== undefined) {
    if (!Array.isArray(updates.question_answers)) {
      throw new Error('question_answers must be an array');
    }
    let totalLength = 0;
    for (const qa of updates.question_answers) {
      if (typeof qa.question !== 'string' || typeof qa.answer !== 'string') {
        throw new Error('question and answer must be strings');
      }
      if (!qa.question || !qa.question.trim()) {
        throw new Error('question must not be empty');
      }
      if (qa.answer.length > 4000) {
        throw new Error('single answer must not exceed 4000 characters');
      }
      if (!['unanswered', 'answered', 'defer_to_requirement_analyst', 'out_of_scope'].includes(qa.status)) {
        throw new Error(`Invalid status: ${qa.status}`);
      }
      if (!['scope', 'acceptance_criteria', 'design', 'implementation', 'test', 'unknown'].includes(qa.impact)) {
        throw new Error(`Invalid impact: ${qa.impact}`);
      }
      totalLength += qa.answer.length;
    }
    if (totalLength > 20000) {
      throw new Error('total answers length must not exceed 20000 characters');
    }
  }
}

export interface UploadedFile {
  path: string;
  originalname: string;
  size: number;
}

export class AduIntake {
  constructor(
    private projectRepo: FileProjectRepository,
    private aduFactory: ProjectAduFactory,
    private workspaceRoot: string,
    private epicFactory?: EpicFactory,
    private generationService?: IntakeGenerationService
  ) {}

  private normalizeQuestionAnswers(draft: any): AgentFactoryDraftQuestionAnswer[] {
    const questions: string[] = draft.questions || [];
    const answers: AgentFactoryDraftQuestionAnswer[] = draft.question_answers || [];

    // Migrate simple string questions into the answers array if they don't exist
    for (const q of questions) {
      if (!answers.find(a => a.question === q)) {
        answers.push({
          question: q,
          answer: '',
          status: 'unanswered',
          impact: 'unknown'
        });
      }
    }
    return answers;
  }

  private async getIntakeRegistryPath(): Promise<string> {
    const p = path.join(this.workspaceRoot, '.ai-agent', 'registry', 'intake-drafts.json');
    try {
      await fs.access(p);
    } catch {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, JSON.stringify({ version: 1, drafts: [] }, null, 2), 'utf-8');
    }
    return p;
  }

  async createDraft(
    projectId: string,
    rawText: string,
    userHints: string,
    requirementType: AgentFactoryIntakeRawInput['requirement_type'],
    files: UploadedFile[]
  ): Promise<{ draft_id: string; status: string }> {
    const project = await this.projectRepo.getProject(projectId);
    if (!project || project.status !== 'profiled') {
      throw new Error(`Project ${projectId} not found or not profiled`);
    }

    const dateStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 8);
    const draftId = `DRAFT-${dateStr}-${crypto.randomBytes(4).toString('hex')}`;
    const intakeDir = path.join(project.repo_path, '.ai-agent', 'intake', draftId);
    const uploadDir = path.join(intakeDir, 'uploaded');

    await fs.mkdir(uploadDir, { recursive: true });

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > 1024 * 1024) {
      throw new Error(`Total upload size ${(totalSize / 1024 / 1024).toFixed(2)} MB exceeds the 1 MB per-draft limit`);
    }

    const sourceFiles: AgentFactoryIntakeSourceFile[] = [];
    for (const f of files) {
      if (f.size > 200 * 1024) throw new Error(`File ${f.originalname} exceeds 200KB`);
      const fileId = crypto.randomBytes(4).toString('hex');
      const safeName = f.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filename = `${fileId}-${safeName}`;
      const destPath = path.join(uploadDir, filename);

      const fileBuffer = await fs.readFile(f.path);
      if (fileBuffer.includes(0x00)) throw new Error(`File ${f.originalname} contains NUL bytes`);

      await fs.writeFile(destPath, fileBuffer);
      await fs.unlink(f.path);
      const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      let mediaType: any = 'text/plain';
      if (f.originalname.endsWith('.md')) mediaType = 'text/markdown';
      else if (f.originalname.endsWith('.json')) mediaType = 'application/json';
      else if (!f.originalname.endsWith('.txt')) throw new Error(`Unsupported extension for ${f.originalname}`);

      sourceFiles.push({
        file_id: fileId,
        filename: safeName,
        media_type: mediaType,
        relative_path: `.ai-agent/intake/${draftId}/uploaded/${filename}`,
        bytes: f.size,
        truncated: false,
        sha256
      });
    }

    const rawInput: AgentFactoryIntakeRawInput = {
      raw_text: rawText,
      user_hints: userHints,
      requirement_type: requirementType,
      files: sourceFiles
    };

    await fs.writeFile(path.join(intakeDir, 'raw-input.json'), JSON.stringify(rawInput, null, 2), 'utf-8');

    const draftMeta = {
      draft_id: draftId,
      project_id: projectId,
      repo_path: project.repo_path,
      status: 'created',
      title: 'Pending Generation',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      draft_path: `.ai-agent/intake/${draftId}/draft.json`,
      report_path: `.ai-agent/intake/${draftId}/intake-report.md`
    };

    const regPath = await this.getIntakeRegistryPath();
    const registry = JSON.parse(await fs.readFile(regPath, 'utf-8'));
    registry.drafts.push(draftMeta);
    await fs.writeFile(regPath, JSON.stringify(registry, null, 2), 'utf-8');

    return { draft_id: draftId, status: 'created' };
  }

  async generateDraft(draftId: string): Promise<void> {
    if (!this.generationService) throw new Error('IntakeGenerationService not configured');
    await this.generationService.start(draftId);
  }

  async getDraft(draftId: string): Promise<{ meta: any, draft: AgentFactoryAduDraft | null }> {
      const regPath = await this.getIntakeRegistryPath();
      const registry = JSON.parse(await fs.readFile(regPath, 'utf-8'));
      const meta = registry.drafts.find((d: any) => d.draft_id === draftId);
      if (!meta) throw new Error('Draft not found');

      let draft = null;
      try {
          draft = JSON.parse(await fs.readFile(path.join(meta.repo_path, meta.draft_path), 'utf-8'));
          if (draft) {
              draft.question_answers = this.normalizeQuestionAnswers(draft);
          }
      } catch (e) {}

      return { meta, draft };
  }

  async updateDraft(draftId: string, updates: Partial<AgentFactoryAduDraft>): Promise<AgentFactoryAduDraft> {
      validateDraftFields(updates);

      const regPath = await this.getIntakeRegistryPath();
      const registry = JSON.parse(await fs.readFile(regPath, 'utf-8'));
      const meta = registry.drafts.find((d: any) => d.draft_id === draftId);
      if (!meta) throw new Error('Draft not found');

      const draftPath = path.join(meta.repo_path, meta.draft_path);
      const draft = JSON.parse(await fs.readFile(draftPath, 'utf-8'));

      const updatedDraft = { ...draft, ...updates, updated_at: new Date().toISOString() };
      await fs.writeFile(draftPath, JSON.stringify(updatedDraft, null, 2), 'utf-8');

      meta.title = updatedDraft.title;
      meta.updated_at = updatedDraft.updated_at;
      await fs.writeFile(regPath, JSON.stringify(registry, null, 2), 'utf-8');

      return updatedDraft;
  }

  async registerDraft(draftId: string, options?: { confirmed?: boolean }): Promise<{ adu_id: string }> {
    return RegistryLock.runLocked(async () => {
      const { meta, draft } = await this.getDraft(draftId);
      if (!draft) throw new Error('Draft content not found');
      if (meta.status === 'registered') throw new Error('Draft already registered');

      // Command safety checks
      if (Array.isArray(draft.requiredCommands)) {
        for (const cmd of draft.requiredCommands) {
          const lower = cmd.toLowerCase();
          for (const frag of BLOCKED_COMMAND_FRAGMENTS) {
            if (lower.includes(frag.toLowerCase())) {
              throw new Error(`Access denied: command contains blocked fragment: ${cmd}`);
            }
          }
        }
      }

      // Path safety checks
      if (Array.isArray(draft.preferredWritePaths)) {
        for (const p of draft.preferredWritePaths) {
          validateRepoRelativePath(p, 'preferredWritePaths');
        }
      }
      if (Array.isArray(draft.preferredReadPaths)) {
        for (const p of draft.preferredReadPaths) {
          validateRepoRelativePath(p, 'preferredReadPaths');
        }
      }

      // Spec §8 hard rule: empty requiredCommands requires manualEvidenceMode
      if ((!draft.requiredCommands || draft.requiredCommands.length === 0) && !draft.manualEvidenceMode) {
        throw new Error(
          'requiredCommands is empty but manualEvidenceMode is false. ' +
          'Either add verification commands or set manualEvidenceMode to true.'
        );
      }

      // Spec §8 soft rules — require explicit confirmation via options.confirmed
      const confirmed = options?.confirmed === true;
      if (draft.confidence === 'low' && !confirmed) {
        const err = new Error('Draft confidence is low. Pass confirmed:true to register anyway.');
        (err as any).status = 409;
        throw err;
      }

      const questionAnswers = this.normalizeQuestionAnswers(draft);

      // Enforce question answers validation on registration to prevent bypasses
      validateDraftFields({ question_answers: questionAnswers });

      const unresolved = questionAnswers.filter(a => {
        if (a.status === 'unanswered') return true;
        if (a.status === 'answered' && (!a.answer || !a.answer.trim())) return true;
        return false;
      });

      if (unresolved.length > 0) {
        const err = new Error(`Draft has ${unresolved.length} unresolved question(s). Please answer them or defer to requirement analyst.`);
        (err as any).status = 409;
        throw err;
      }

      // Check for deferrals to enforce analysisReviewRequired
      const hasDeferral = questionAnswers.some(a => a.status === 'defer_to_requirement_analyst');
      const analysisReviewRequired = draft.analysisReviewRequired || hasDeferral;

      // Construct Goal summary
      let finalGoal = draft.goal;
      if (questionAnswers.length > 0) {
        let summary = "\n\n用户澄清问题：\n";
        questionAnswers.forEach((qa, idx) => {
          summary += `${idx + 1}. 问题：${qa.question}\n   处理：${qa.status}\n   答案：${qa.answer || '无'}\n   影响范围：${qa.impact}\n`;
        });
        finalGoal += summary;
      }

      // Path and command safety — ProjectAduFactory.createForProject is the final hard boundary
      const createdAdu = await this.aduFactory.createForProject(meta.project_id, {
          aduId: draft.aduId,
          title: draft.title,
          goal: finalGoal,
          risk: draft.risk,
          targetLevel: draft.targetLevel,
          preferredReadPaths: draft.preferredReadPaths,
          preferredWritePaths: draft.preferredWritePaths,
          requiredCommands: draft.requiredCommands,
          analysisReviewRequired: analysisReviewRequired,
          designReviewRequired: draft.designReviewRequired,
          manualEvidenceMode: draft.manualEvidenceMode,
          clarifications: questionAnswers,
          sourceSummary: draft.source_summary
      });

      const regPath = await this.getIntakeRegistryPath();
      const registry = JSON.parse(await fs.readFile(regPath, 'utf-8'));
      const fIndex = registry.drafts.findIndex((d: any) => d.draft_id === draftId);
      registry.drafts[fIndex].status = 'registered';
      registry.drafts[fIndex].registered_adu_id = createdAdu.id;
      await fs.writeFile(regPath, JSON.stringify(registry, null, 2), 'utf-8');

      draft.status = 'registered';
      draft.registered_adu_id = createdAdu.id;
      await fs.writeFile(path.join(meta.repo_path, meta.draft_path), JSON.stringify(draft, null, 2), 'utf-8');

      return { adu_id: createdAdu.id };
    });
  }

  async generateDraftSync(draftId: string): Promise<void> {
    if (!this.generationService) throw new Error('IntakeGenerationService not configured');
    await this.generationService.start(draftId);
    const softTimeoutMs = process.env.INTAKE_TIMEOUT_MS ? parseInt(process.env.INTAKE_TIMEOUT_MS, 10) : 30000;
    await this.generationService.wait(draftId, softTimeoutMs);
  }

  async registerEpicDraft(draftId: string, options?: { confirmed?: boolean }): Promise<{ epic_id: string }> {
    return RegistryLock.runLocked(async () => {
      if (!this.epicFactory) {
        throw new Error('EpicFactory is not configured on AduIntake');
      }
      const { meta, draft } = await this.getDraft(draftId);
      if (!draft) throw new Error('Draft content not found');
      if (meta.status === 'registered') throw new Error('Draft already registered');

      // Enforce question answers validation on registration to prevent bypasses
      const questionAnswers = this.normalizeQuestionAnswers(draft);
      validateDraftFields({ question_answers: questionAnswers });

      const unresolved = questionAnswers.filter(a => {
        if (a.status === 'unanswered') return true;
        if (a.status === 'answered' && (!a.answer || !a.answer.trim())) return true;
        return false;
      });

      if (unresolved.length > 0) {
        const err = new Error(`Draft has ${unresolved.length} unresolved question(s). Please answer them or defer to requirement analyst.`);
        (err as any).status = 409;
        throw err;
      }

      // Construct source_requirement by appending questions and answers
      let finalRequirement = draft.goal || draft.title;
      if (questionAnswers.length > 0) {
        let summary = "\n\n用户澄清问题：\n";
        questionAnswers.forEach((qa, idx) => {
          summary += `${idx + 1}. 问题：${qa.question}\n   处理：${qa.status}\n   答案：${qa.answer || '无'}\n   影响范围：${qa.impact}\n`;
        });
        finalRequirement += summary;
      }

      // Create Epic using epicFactory
      const createdEpic = await this.epicFactory.createForProject(meta.project_id, {
        title: draft.title,
        source_requirement: finalRequirement,
        risk: draft.risk || 'medium',
        target_level: draft.targetLevel || 'mvp',
        language: (draft as any).language || 'zh',
        clarifications: questionAnswers
      });

      const regPath = await this.getIntakeRegistryPath();
      const registry = JSON.parse(await fs.readFile(regPath, 'utf-8'));
      const fIndex = registry.drafts.findIndex((d: any) => d.draft_id === draftId);
      registry.drafts[fIndex].status = 'registered';
      registry.drafts[fIndex].registered_epic_id = createdEpic.id;
      await fs.writeFile(regPath, JSON.stringify(registry, null, 2), 'utf-8');

      draft.status = 'registered';
      (draft as any).registered_epic_id = createdEpic.id;
      await fs.writeFile(path.join(meta.repo_path, meta.draft_path), JSON.stringify(draft, null, 2), 'utf-8');

      return { epic_id: createdEpic.id };
    });
  }
}

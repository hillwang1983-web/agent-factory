import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { FileProjectRepository } from '../infrastructure/file-project-repository';
import { ProjectAduFactory } from './project-adu-factory';
import {
  AgentFactoryIntakeRawInput,
  AgentFactoryAduDraft,
  AgentFactoryIntakeSourceFile
} from '../domain/agent-factory';

export class AduIntake {
  constructor(
    private projectRepo: FileProjectRepository,
    private aduFactory: ProjectAduFactory,
    private workspaceRoot: string
  ) {}

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
    requirementType: any,
    files: Express.Multer.File[]
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
    const regPath = await this.getIntakeRegistryPath();
    const registry = JSON.parse(await fs.readFile(regPath, 'utf-8'));
    const draftIndex = registry.drafts.findIndex((d: any) => d.draft_id === draftId);
    if (draftIndex === -1) throw new Error('Draft not found');

    const meta = registry.drafts[draftIndex];
    meta.status = 'generating';
    await fs.writeFile(regPath, JSON.stringify(registry, null, 2), 'utf-8');

    const scriptPath = path.join(this.workspaceRoot, 'scripts', 'hermes_agent_run.py');
    const child = spawn('python3', [scriptPath, '--intake-draft', draftId, '--project', meta.project_id, '--repo-root', meta.repo_path], {
        cwd: this.workspaceRoot
    });

    child.on('close', async (code) => {
        const freshRegistry = JSON.parse(await fs.readFile(regPath, 'utf-8'));
        const fIndex = freshRegistry.drafts.findIndex((d: any) => d.draft_id === draftId);
        if (code === 0) {
            freshRegistry.drafts[fIndex].status = 'draft_ready';
            try {
                const draftContent = JSON.parse(await fs.readFile(path.join(meta.repo_path, meta.draft_path), 'utf-8'));
                freshRegistry.drafts[fIndex].title = draftContent.title || 'Untitled';
            } catch (e) {}
        } else {
            freshRegistry.drafts[fIndex].status = 'generation_failed';
        }
        await fs.writeFile(regPath, JSON.stringify(freshRegistry, null, 2), 'utf-8');
    });
  }

  async getDraft(draftId: string): Promise<{ meta: any, draft: AgentFactoryAduDraft | null }> {
      const regPath = await this.getIntakeRegistryPath();
      const registry = JSON.parse(await fs.readFile(regPath, 'utf-8'));
      const meta = registry.drafts.find((d: any) => d.draft_id === draftId);
      if (!meta) throw new Error('Draft not found');

      let draft = null;
      try {
          draft = JSON.parse(await fs.readFile(path.join(meta.repo_path, meta.draft_path), 'utf-8'));
      } catch (e) {}

      return { meta, draft };
  }

  async updateDraft(draftId: string, updates: Partial<AgentFactoryAduDraft>): Promise<AgentFactoryAduDraft> {
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

  async registerDraft(draftId: string): Promise<{ adu_id: string }> {
      const { meta, draft } = await this.getDraft(draftId);
      if (!draft) throw new Error('Draft content not found');
      if (meta.status === 'registered') throw new Error('Draft already registered');

      // The validation inside ProjectAduFactory.createForProject will handle path/command safety
      const createdAdu = await this.aduFactory.createForProject(meta.project_id, {
          aduId: draft.aduId,
          title: draft.title,
          goal: draft.goal,
          risk: draft.risk,
          targetLevel: draft.targetLevel,
          preferredReadPaths: draft.preferredReadPaths,
          preferredWritePaths: draft.preferredWritePaths,
          requiredCommands: draft.requiredCommands,
          analysisReviewRequired: draft.analysisReviewRequired,
          designReviewRequired: draft.designReviewRequired,
          manualEvidenceMode: draft.manualEvidenceMode
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
  }
}

# Agent Factory Phase 2.5: ADU Intake Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the ADU Intake Agent feature to generate project-aware ADU drafts from raw text and uploaded requirement documents, allowing human review before formal registration.

**Architecture:** 
- Add new domain types for Drafts and Intake sources.
- Create an `AduIntake` use case in the backend to handle draft creation and file uploads (saved to project-local `.ai-agent/intake/`).
- Create a new `adu-intake-agent` prompt and a python script to run it.
- Build a new 3-step wizard UI (Frontend) for inputting requirements, waiting for generation, and reviewing/editing/registering the draft.
- Use existing `ProjectAduFactory` for final draft registration to guarantee safety checks.

**Tech Stack:** TypeScript, Node.js (Express), React, Python, Hermes CLI.

---

### Task 1: Backend Domain Types

**Files:**
- Modify: `agent-factory-dashboard/backend/src/domain/agent-factory.ts`
- Modify: `agent-factory-dashboard/frontend/src/types/agent-factory.ts`

- [ ] **Step 1: Add Intake Types to Backend Domain**
Open `agent-factory-dashboard/backend/src/domain/agent-factory.ts` and append the new types at the bottom.

```typescript
export type AgentFactoryIntakeDraftStatus =
  | 'created'
  | 'generating'
  | 'draft_ready'
  | 'generation_failed'
  | 'registered'
  | 'discarded';

export interface AgentFactoryIntakeSourceFile {
  file_id: string;
  filename: string;
  media_type: 'text/plain' | 'text/markdown' | 'application/json';
  relative_path: string;
  bytes: number;
  truncated: boolean;
  sha256: string;
}

export interface AgentFactoryIntakeRawInput {
  raw_text: string;
  user_hints?: string;
  requirement_type: 'feature' | 'bugfix' | 'test' | 'docs' | 'refactor' | 'unknown';
  files: AgentFactoryIntakeSourceFile[];
}

export interface AgentFactoryAduDraft {
  draft_id: string;
  project_id: string;
  status: AgentFactoryIntakeDraftStatus;
  confidence: 'high' | 'medium' | 'low';
  aduId?: string;
  title: string;
  goal: string;
  risk: 'low' | 'medium' | 'high';
  targetLevel: 'mvp' | 'production';
  preferredReadPaths: string[];
  preferredWritePaths: string[];
  requiredCommands: string[];
  analysisReviewRequired: boolean;
  designReviewRequired: boolean;
  manualEvidenceMode: boolean;
  scope: {
    in_scope: string[];
    out_of_scope: string[];
  };
  risks: string[];
  questions: string[];
  split_suggestions: Array<{
    title: string;
    reason: string;
    suggested_goal: string;
  }>;
  source_summary: string;
  created_at: string;
  updated_at: string;
  registered_adu_id?: string;
  error?: string;
}
```

- [ ] **Step 2: Sync Types to Frontend**
Open `agent-factory-dashboard/frontend/src/types/agent-factory.ts` and append the exact same type definitions as above.

- [ ] **Step 3: Commit Domain Types**

```bash
git add agent-factory-dashboard/backend/src/domain/agent-factory.ts agent-factory-dashboard/frontend/src/types/agent-factory.ts
git commit -m "feat(domain): add ADU intake draft types"
```

---

### Task 2: Artifact Allowlist & Registry Boilerplate

**Files:**
- Modify: `agent-factory-dashboard/backend/src/infrastructure/file-agent-factory-repository.ts`

- [ ] **Step 1: Add `.ai-agent/intake/` to allowed artifact paths**
In `agent-factory-dashboard/backend/src/infrastructure/file-agent-factory-repository.ts`, find the `isPathAllowed` logic (or similar list of allowed prefixes like `.ai-agent/analysis/`) and add `.ai-agent/intake/`.

```typescript
// Look for an array like this and add the intake path
const allowedPrefixes = [
  '.agent-factory/',
  '.ai-agent/analysis/',
  '.ai-agent/context-packs/',
  '.ai-agent/designs/',
  '.ai-agent/contracts/',
  '.ai-agent/reviews/',
  '.ai-agent/acceptance/',
  '.ai-agent/evidence/',
  '.ai-agent/runs/',
  '.ai-agent/intake/', // Add this line
  'tests/ai-agent-mvp/'
];
```

- [ ] **Step 2: Commit Allowlist Changes**

```bash
git add agent-factory-dashboard/backend/src/infrastructure/file-agent-factory-repository.ts
git commit -m "feat(repo): add .ai-agent/intake/ to artifact allowlist"
```

---

### Task 3: Backend Application Use Case (AduIntake)

**Files:**
- Create: `agent-factory-dashboard/backend/src/application/adu-intake.ts`

- [ ] **Step 1: Implement `adu-intake.ts`**
Create `agent-factory-dashboard/backend/src/application/adu-intake.ts`. It will need access to project repo paths and will spawn the `adu-intake-agent`.

```typescript
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
          requirement_text: draft.source_summary,
          risk: draft.risk,
          target_level: draft.targetLevel,
          allowed_read_paths: draft.preferredReadPaths,
          allowed_write_paths: draft.preferredWritePaths,
          commands: draft.requiredCommands,
          review_policy: {
              require_analysis_review: draft.analysisReviewRequired,
              require_design_review: draft.designReviewRequired,
              require_acceptance_review: true
          },
          manual_evidence_mode: draft.manualEvidenceMode
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
```

- [ ] **Step 2: Commit Use Case**

```bash
git add agent-factory-dashboard/backend/src/application/adu-intake.ts
git commit -m "feat(application): implement AduIntake use case"
```

---

### Task 4: Backend Controller Endpoints

**Files:**
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Modify: `agent-factory-dashboard/backend/src/index.ts` (to instantiate AduIntake)

- [ ] **Step 1: Instantiate AduIntake in `index.ts`**
In `agent-factory-dashboard/backend/src/index.ts`, after creating `ProjectAduFactory`, create `AduIntake` and pass it to `AgentFactoryController`. (You might need to add `multer` middleware here or inside the controller).

```typescript
// In index.ts
import multer from 'multer';
import { AduIntake } from './application/adu-intake';
// ...
const upload = multer({ dest: '/tmp/' });
const aduIntake = new AduIntake(projectRepo, aduFactory, config.workspaceRoot);
const controller = new AgentFactoryController(
    /* ... existing args ... */,
    aduIntake
);
```

- [ ] **Step 2: Add Endpoints in `agent-factory-controller.ts`**
Add the new methods and register the routes in the constructor. (Assume `multer` is available or injected).

```typescript
// In agent-factory-controller.ts constructor:
this.router.post('/projects/:projectId/intake-drafts', this.upload.array('files', 8), this.createIntakeDraft);
this.router.post('/intake-drafts/:draftId/generate', this.generateIntakeDraft);
this.router.get('/intake-drafts/:draftId', this.getIntakeDraft);
this.router.put('/intake-drafts/:draftId', this.updateIntakeDraft);
this.router.post('/intake-drafts/:draftId/register-adu', this.registerIntakeDraft);

// Methods:
private createIntakeDraft = async (req: Request, res: Response) => {
    if (!this.enableControl) return res.status(403).json({ error: 'Control disabled' });
    try {
        const result = await this.aduIntake.createDraft(
            req.params.projectId,
            req.body.rawText,
            req.body.userHints || '',
            req.body.requirementType,
            req.files as Express.Multer.File[] || []
        );
        res.json({ draft: result });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
};

private generateIntakeDraft = async (req: Request, res: Response) => {
    if (!this.enableControl) return res.status(403).json({ error: 'Control disabled' });
    try {
        await this.aduIntake.generateDraft(req.params.draftId);
        res.json({ success: true, status: 'generating' });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
};

private getIntakeDraft = async (req: Request, res: Response) => {
    try {
        const result = await this.aduIntake.getDraft(req.params.draftId);
        res.json(result);
    } catch (e: any) { res.status(404).json({ error: e.message }); }
};

private updateIntakeDraft = async (req: Request, res: Response) => {
    if (!this.enableControl) return res.status(403).json({ error: 'Control disabled' });
    try {
        const result = await this.aduIntake.updateDraft(req.params.draftId, req.body);
        res.json({ success: true, draft: result });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
};

private registerIntakeDraft = async (req: Request, res: Response) => {
    if (!this.enableControl) return res.status(403).json({ error: 'Control disabled' });
    try {
        const result = await this.aduIntake.registerDraft(req.params.draftId);
        res.json({ success: true, adu: { id: result.adu_id } });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
};
```

- [ ] **Step 3: Commit Controller Updates**

```bash
npm install multer @types/multer
git add package.json package-lock.json agent-factory-dashboard/backend/src/index.ts agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts
git commit -m "feat(api): add ADU intake draft API endpoints"
```

---

### Task 5: ADU Intake Agent Prompt

**Files:**
- Create: `.ai-agent/prompts/adu-intake-agent.md`

- [ ] **Step 1: Write `adu-intake-agent.md`**

```markdown
# Role
You are the ADU Intake Agent. Your job is to convert raw requirement text and uploaded requirement documents into a structured Project-Aware ADU Draft.

# Rules
1. Do not modify production code.
2. Do not create formal ADUs. You only generate drafts.
3. Use Chinese for explanations.
4. Preserve JSON keys, commands, paths, identifiers, file names, and API names in English.
5. All paths MUST be repository-relative. No leading slashes. No `../`.
6. DO NOT include dangerous commands (`rm -rf`, `sudo`, `curl`).

# Input Context
[Project Profile]
{PROJECT_PROFILE}

[Knowledge Pack]
{KNOWLEDGE_PACK}

[Raw Input]
Type: {REQUIREMENT_TYPE}
Text:
{RAW_TEXT}
Hints: {USER_HINTS}
Files Content:
{UPLOADED_FILES_CONTENT}

# Output Requirement
You must output a single JSON block containing `draft.json` content and `intake-report.md` path.

```json
{
  "result": "success",
  "draft_id": "{DRAFT_ID}",
  "artifacts": [
    ".ai-agent/intake/{DRAFT_ID}/draft.json",
    ".ai-agent/intake/{DRAFT_ID}/intake-report.md"
  ],
  "draft_content": {
    "confidence": "high",
    "title": "...",
    "goal": "...",
    "risk": "low",
    "targetLevel": "mvp",
    "preferredReadPaths": [],
    "preferredWritePaths": [],
    "requiredCommands": [],
    "analysisReviewRequired": true,
    "designReviewRequired": true,
    "manualEvidenceMode": false,
    "scope": { "in_scope": [], "out_of_scope": [] },
    "risks": [],
    "questions": [],
    "split_suggestions": [],
    "source_summary": "..."
  },
  "report_content": "# ADU 草案生成报告\n..."
}
```
```

- [ ] **Step 2: Commit Prompt**

```bash
git add .ai-agent/prompts/adu-intake-agent.md
git commit -m "feat(prompts): add adu-intake-agent prompt"
```

---

### Task 6: Python Runner Update

**Files:**
- Modify: `scripts/hermes_agent_run.py`

- [ ] **Step 1: Add `--intake-draft` mode to runner**
In `scripts/hermes_agent_run.py`, parse `--intake-draft`. If present, skip normal ADU loading. Load `raw-input.json`, `project-profile.json`, and knowledge pack. Fill `adu-intake-agent.md` prompt. Call Hermes. Parse JSON output, and write `draft.json` and `intake-report.md` to `.ai-agent/intake/<draft_id>/`.

```python
# Draft logic snippet for hermes_agent_run.py
if args.intake_draft:
    draft_id = args.intake_draft
    intake_dir = os.path.join(args.repo_root, ".ai-agent", "intake", draft_id)
    with open(os.path.join(intake_dir, "raw-input.json")) as f:
        raw_input = json.load(f)
    
    # ... load profile, load knowledge ...
    # ... render adu-intake-agent.md prompt ...
    # call hermes cli
    # parse json block
    # write draft_content to draft.json
    # write report_content to intake-report.md
    sys.exit(0 if success else 1)
```

- [ ] **Step 2: Commit Python changes**

```bash
git add scripts/hermes_agent_run.py
git commit -m "feat(runner): support adu-intake-agent execution"
```

---

### Task 7: Frontend API & Store

**Files:**
- Modify: `agent-factory-dashboard/frontend/src/api/agentFactory.ts`
- Modify: `agent-factory-dashboard/frontend/src/stores/agentFactory.ts`

- [ ] **Step 1: Add API functions to `agentFactory.ts`**

```typescript
export const createIntakeDraft = async (projectId: string, formData: FormData) => {
    const res = await fetch(`/api/agent-factory/projects/${projectId}/intake-drafts`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
};
export const generateIntakeDraft = async (draftId: string) => {
    const res = await fetch(`/api/agent-factory/intake-drafts/${draftId}/generate`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
};
export const getIntakeDraft = async (draftId: string) => {
    const res = await fetch(`/api/agent-factory/intake-drafts/${draftId}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
};
export const updateIntakeDraft = async (draftId: string, updates: any) => {
    const res = await fetch(`/api/agent-factory/intake-drafts/${draftId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
};
export const registerIntakeDraft = async (draftId: string) => {
    const res = await fetch(`/api/agent-factory/intake-drafts/${draftId}/register-adu`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
};
```

- [ ] **Step 2: Commit Frontend API updates**

```bash
git add agent-factory-dashboard/frontend/src/api/agentFactory.ts
git commit -m "feat(ui-api): add intake draft api calls"
```

---

### Task 8: Frontend Wizard UI

**Files:**
- Create: `agent-factory-dashboard/frontend/src/components/intake/AduIntakeWizard.tsx`
- Create: `agent-factory-dashboard/frontend/src/components/intake/RequirementSourceStep.tsx`
- Create: `agent-factory-dashboard/frontend/src/components/intake/DraftReviewStep.tsx`
- Modify: `agent-factory-dashboard/frontend/src/components/projects/ProjectsPage.tsx`

- [ ] **Step 1: Create `RequirementSourceStep.tsx`**
A form with `textarea` for raw text, file input for `.md`/`.txt`, and submit button calling `createIntakeDraft`.

- [ ] **Step 2: Create `DraftReviewStep.tsx`**
A form displaying the parsed `draft.json` fields, allowing edits to `title`, `goal`, `preferredWritePaths`, `requiredCommands`, etc. Includes a "Register ADU" button calling `registerIntakeDraft`.

- [ ] **Step 3: Create `AduIntakeWizard.tsx`**
Manages the 3-step state: `RequirementSourceStep` -> generating state/polling -> `DraftReviewStep`.

- [ ] **Step 4: Update `ProjectsPage.tsx`**
Add "从原始需求创建 ADU" button for `profiled` projects that opens the `AduIntakeWizard`.

- [ ] **Step 5: Commit Frontend UI updates**

```bash
git add agent-factory-dashboard/frontend/src/components/intake/ agent-factory-dashboard/frontend/src/components/projects/ProjectsPage.tsx
git commit -m "feat(ui): implement ADU Intake Wizard"
```

---

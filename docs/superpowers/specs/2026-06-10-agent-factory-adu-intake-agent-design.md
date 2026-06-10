# Agent Factory Phase 2.5: ADU Intake Agent Design Spec

**Date:** 2026-06-10
**Topic:** Generate project-aware ADU drafts from raw requirement text and uploaded requirement documents
**Author:** Codex
**Status:** Draft for review

## 1. Overview

Phase 2 can already execute project-aware ADU development after a user manually creates a valid ADU. The remaining friction is that ADU creation still requires the user to manually fill implementation-oriented fields such as read paths, write paths, commands, risk, review policy, and manual evidence mode. Those fields are necessary for safety, but they should be produced from the project profile and requirement context rather than typed from scratch.

This spec adds an **ADU Intake Agent** and an **ADU Intake Center** to the standalone Agent Factory Dashboard. The feature accepts raw requirement text, uploaded requirement documents, or both. It converts them into an editable **ADU Draft** that the user reviews before registering it as a formal project-aware ADU through the existing `ProjectAduFactory`.

The feature is intentionally a pre-development intake layer. It does not replace the existing requirement analysis Agent, detailed design Agent, contract Agent, or Phase 2 execution workflow.

## 2. Goals

- Let users create ADU drafts from natural-language text.
- Let users upload requirement files and include their contents in the intake process.
- Support using both text input and uploaded files in the same draft.
- Use the selected project's `project-profile.json` and `.agent-factory/knowledge/` pack to recommend safe paths, commands, risk, scope, and review policy.
- Keep a human approval/edit step between Agent-generated draft output and formal ADU registration.
- Reuse the existing `POST /api/agent-factory/projects/:projectId/adus` creation path so Phase 2 safety checks remain authoritative.
- Store all intake source material and draft artifacts under the target repository, not in the legacy NMS codebase.

## 3. Non-Goals

- Do not modify or maintain the old NMS-integrated Agent Factory.
- Do not allow the Intake Agent to directly start the development pipeline.
- Do not allow uploaded files to become trusted commands or paths without backend validation.
- Do not support binary uploads in the MVP.
- Do not implement PDF/DOCX parsing in the first release. These can be added after the text and Markdown flow is stable.
- Do not automatically split one raw requirement into multiple formal ADUs in the MVP. The Agent may recommend splits, but the first release registers one draft at a time.

## 4. Existing Context

The current standalone Agent Factory already has:

- Project registry: `/Users/hill/open5gs/.ai-agent/registry/projects.json`
- ADU registry: `/Users/hill/open5gs/.ai-agent/registry/adu.json`
- Project profile: `<target-repo>/.agent-factory/project-profile.json`
- Project knowledge: `<target-repo>/.agent-factory/knowledge/`
- Project ADU creation use case: `agent-factory-dashboard/backend/src/application/project-adu-factory.ts`
- Project ADU creation route: `POST /api/agent-factory/projects/:projectId/adus`
- Manual ADU creation UI: `agent-factory-dashboard/frontend/src/components/projects/CreateProjectAduModal.tsx`
- Runtime prompt directory: `/Users/hill/open5gs/.ai-agent/prompts/`

The new feature must sit before this existing project ADU creation flow:

```text
Raw requirement text / uploaded files
  -> ADU Intake Agent
  -> ADU Draft
  -> Human review and edit
  -> ProjectAduFactory.createForProject()
  -> Formal ADU in created state
  -> Existing Phase 2 workflow
```

## 5. User Experience

### 5.1 Entry Points

Add an entry named **从原始需求创建 ADU** in two places:

- Project card actions in `ProjectsPage.tsx` for projects whose status is `profiled`.
- Agent Factory ADU creation area, with the current project selector if no project is selected.

For non-profiled projects:

- `registered`: disabled, message `项目尚未画像，请先运行画像`
- `profiling`: disabled, message `项目画像进行中，请稍后`
- `profile_failed`: disabled, message `项目画像失败，请重新运行画像`
- `disabled`: disabled, message `项目已停用`

### 5.2 Intake Wizard

The UI should be a three-step wizard, not a single giant form.

#### Step 1: 原始需求输入

Fields:

- Project name, read-only.
- Requirement type:
  - `feature`
  - `bugfix`
  - `test`
  - `docs`
  - `refactor`
  - `unknown`
- Raw requirement text textarea.
- File upload control.
- Optional user hints textarea.

Supported MVP file types:

- `.txt`
- `.md`
- `.json`

Upload constraints:

- Max 200 KB per file.
- Max 1 MB total per draft.
- Max 8 files per draft.
- Decode as UTF-8 text.
- Reject files containing NUL bytes.
- Mark files as truncated if content exceeds per-file read limit.

The user may provide only text, only files, or both. Empty text plus no files is invalid.

#### Step 2: 生成 ADU 草案

The user clicks **生成草案**. The backend creates an intake draft record and runs `adu-intake-agent`.

The UI shows:

- Draft status: `created`, `generating`, `draft_ready`, `generation_failed`, `registered`, `discarded`
- Agent run output summary
- Token usage if available
- Any parsing warnings
- Any missing context warnings

The user can retry generation while status is `generation_failed` or `draft_ready`.

#### Step 3: 审核并注册

The generated draft is displayed as editable fields:

- ADU ID, optional
- Title
- Goal
- Risk
- Target level
- Preferred read paths
- Preferred write paths
- Required commands
- Analysis review required
- Design review required
- Manual evidence mode
- Scope in
- Scope out
- Risks
- Questions
- Split suggestions

High-risk fields must be visually flagged:

- Write paths containing `src/`, `lib/`, `core/`, `crypto/`, `security/`, `protocol/`
- Empty required commands when `manualEvidenceMode` is false
- Commands not found in project profile build/test commands
- Any draft with `confidence = low`
- Any draft with unresolved `questions`

Clicking **注册 ADU** calls the existing project ADU creation endpoint. If registration succeeds, the user is taken to the Agent Factory page with the new ADU selected.

## 6. Backend Design

### 6.1 New Domain Types

Add types to `agent-factory-dashboard/backend/src/domain/agent-factory.ts`.

```ts
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

### 6.2 Storage Layout

Intake files are project-local:

```text
<target-repo>/.ai-agent/intake/<draft_id>/
├── raw-input.json
├── uploaded/
│   ├── <safe-file-id>-<original-name>.md
│   └── <safe-file-id>-<original-name>.txt
├── draft.json
├── intake-report.md
├── stdout.md
├── stderr.md
└── prompt.md
```

Global registry stores a lightweight index:

```text
/Users/hill/open5gs/.ai-agent/registry/intake-drafts.json
```

Shape:

```json
{
  "version": 1,
  "drafts": [
    {
      "draft_id": "DRAFT-20260610-0001",
      "project_id": "ueransim",
      "repo_path": "/Users/hill/open5gs/UERANSIM",
      "status": "draft_ready",
      "title": "为 UERANSIM 增加样例配置 smoke check 脚本",
      "created_at": "2026-06-10T00:00:00.000Z",
      "updated_at": "2026-06-10T00:00:00.000Z",
      "draft_path": ".ai-agent/intake/DRAFT-20260610-0001/draft.json",
      "report_path": ".ai-agent/intake/DRAFT-20260610-0001/intake-report.md"
    }
  ]
}
```

The registry index is only for listing and status. The authoritative draft body is the project-local `draft.json`.

### 6.3 New Backend Use Case

Create:

`agent-factory-dashboard/backend/src/application/adu-intake.ts`

Responsibilities:

- Validate project exists and is `profiled`.
- Create intake draft directory.
- Normalize uploaded text files.
- Write `raw-input.json`.
- Spawn Intake Agent runner.
- Read generated `draft.json`.
- Save user edits to `draft.json`.
- Register a draft as a formal ADU by calling `ProjectAduFactory.createForProject`.

The use case must not duplicate `ProjectAduFactory` validation. It may pre-validate for user-friendly errors, but final registration must still go through `ProjectAduFactory`.

### 6.4 Backend APIs

All APIs require `AGENT_FACTORY_ENABLE_CONTROL=true` except read-only list/detail endpoints.

#### Create Draft

`POST /api/agent-factory/projects/:projectId/intake-drafts`

Request must use `multipart/form-data` for file support.

Fields:

- `rawText`
- `userHints`
- `requirementType`
- `files[]`

Response:

```json
{
  "draft": {
    "draft_id": "DRAFT-20260610-0001",
    "project_id": "ueransim",
    "status": "created"
  }
}
```

#### Generate Draft

`POST /api/agent-factory/intake-drafts/:draftId/generate`

Runs the `adu-intake-agent`.

Response:

```json
{
  "success": true,
  "draft_id": "DRAFT-20260610-0001",
  "status": "generating"
}
```

Generation may be implemented synchronously for MVP if it follows the current step-run pattern, but the persisted status must still be updated so the UI can poll safely.

#### Get Draft

`GET /api/agent-factory/intake-drafts/:draftId`

Returns:

- Draft metadata
- Parsed `draft.json`
- `intake-report.md` path and existence
- Raw source summary
- Last error

#### Update Draft

`PUT /api/agent-factory/intake-drafts/:draftId`

Request body is the editable subset of `AgentFactoryAduDraft`.

Backend must revalidate:

- Path format
- Command denylist
- Risk enum
- Review policy booleans
- Text fields non-empty where required

#### Register Draft

`POST /api/agent-factory/intake-drafts/:draftId/register-adu`

Creates a formal ADU by translating draft fields into `CreateProjectAduInput`.

Response:

```json
{
  "success": true,
  "adu": {
    "id": "REQ-2026-0001",
    "project_id": "ueransim",
    "state": "created"
  }
}
```

Failure:

- `400`: invalid draft fields
- `404`: draft not found
- `409`: project not profiled, duplicate ADU id, draft already registered, unresolved required confirmation
- `403`: project disabled or control API disabled

### 6.5 Artifact Allowlist

Project artifact allowlist must include:

- `.ai-agent/intake/`
- `.ai-agent/analysis/`
- `.ai-agent/context-packs/`
- `.ai-agent/designs/`
- `.ai-agent/contracts/`
- `.ai-agent/reviews/`
- `.ai-agent/acceptance/`
- `.ai-agent/evidence/`
- `.ai-agent/runs/`
- `.agent-factory/`

Uploaded files and generated draft files must be readable through the existing artifact API only when an `aduId` or `draftId` resolves to the same project root. Cross-project reads must remain forbidden.

## 7. ADU Intake Agent Design

### 7.1 Prompt File

Create:

`/Users/hill/open5gs/.ai-agent/prompts/adu-intake-agent.md`

Mission:

- Convert raw requirements into a safe ADU draft.
- Do not modify production code.
- Do not create formal ADUs.
- Do not start orchestrator.
- Use Chinese for explanations.
- Preserve JSON keys, commands, paths, identifiers, file names, and API names in English.

### 7.2 Agent Inputs

The runner passes this payload:

```json
{
  "draft_id": "DRAFT-20260610-0001",
  "project": {
    "project_id": "ueransim",
    "name": "UERANSIM",
    "repo_path": "/Users/hill/open5gs/UERANSIM",
    "status": "profiled"
  },
  "raw_input": {
    "raw_text": "...",
    "user_hints": "...",
    "requirement_type": "feature",
    "files": [
      {
        "filename": "requirement.md",
        "content": "...",
        "truncated": false
      }
    ]
  },
  "project_profile": {},
  "knowledge_pack": {
    "project-summary.md": "...",
    "module-map.md": "...",
    "test-strategy.md": "...",
    "risk-map.md": "..."
  },
  "available_commands": {
    "build_commands": [],
    "test_commands": []
  },
  "blocked_command_patterns": [
    "rm -rf",
    "sudo ",
    "curl ",
    "wget ",
    "git push",
    "git reset --hard"
  ]
}
```

### 7.3 Agent Outputs

The Agent must write:

`<target-repo>/.ai-agent/intake/<draft_id>/draft.json`

```json
{
  "draft_id": "DRAFT-20260610-0001",
  "project_id": "ueransim",
  "confidence": "medium",
  "title": "为 UERANSIM 增加样例配置 smoke check 脚本",
  "goal": "实现一个低风险检查脚本，用于验证 config 下关键样例配置文件是否存在，并输出结构化结果。",
  "risk": "low",
  "targetLevel": "mvp",
  "preferredReadPaths": [
    "config/",
    "tools/",
    "README.md",
    ".agent-factory/knowledge/"
  ],
  "preferredWritePaths": [
    "tools/",
    ".ai-agent/"
  ],
  "requiredCommands": [
    "python3 tools/agent_factory_smoke_check.py"
  ],
  "analysisReviewRequired": true,
  "designReviewRequired": true,
  "manualEvidenceMode": false,
  "scope": {
    "in_scope": [
      "新增低风险 smoke check 脚本"
    ],
    "out_of_scope": [
      "不修改 UE/GNB 核心协议栈"
    ]
  },
  "risks": [
    "项目缺少原生自动化测试框架，最终验收可能需要人工证据"
  ],
  "questions": [],
  "split_suggestions": [],
  "source_summary": "用户希望根据 UERANSIM 样例配置增加一个低风险检查工具。"
}
```

And:

`<target-repo>/.ai-agent/intake/<draft_id>/intake-report.md`

Chinese structure:

```markdown
# ADU 草案生成报告

## 原始需求理解

## 推荐 ADU 范围

## 推荐读路径

## 推荐写路径

## 推荐验证命令

## 风险与人工确认点

## 是否建议拆分
```

Final response must include a single fenced JSON block:

```json
{
  "result": "success",
  "draft_id": "DRAFT-20260610-0001",
  "artifacts": [
    ".ai-agent/intake/DRAFT-20260610-0001/draft.json",
    ".ai-agent/intake/DRAFT-20260610-0001/intake-report.md"
  ],
  "risks": [],
  "questions": []
}
```

## 8. Draft Validation Rules

Before a draft can be registered as an ADU:

- `title` must be non-empty.
- `goal` must be non-empty and at least 20 characters.
- `risk` must be `low`, `medium`, or `high`.
- `targetLevel` must be `mvp` or `production`.
- All paths must be repository-relative.
- No path may contain `..`, NUL bytes, or start with `/`.
- `preferredWritePaths` must not include `.git/`, `.agent-factory/`, home directories, or system paths.
- Commands must not contain blocked fragments.
- Commands with shell pipes, semicolons, `&&`, `||`, redirects, `curl`, `wget`, `ssh`, `sudo`, `git push`, or `git reset --hard` are rejected unless explicitly allowed by future policy.
- If `requiredCommands` is empty, `manualEvidenceMode` must be true.
- If `confidence` is `low`, the UI must require explicit user confirmation before registration.
- If `questions` is non-empty, the UI must require the user to either answer or acknowledge them before registration.

## 9. Frontend Design

### 9.1 New Components

Create:

- `agent-factory-dashboard/frontend/src/components/intake/AduIntakeWizard.tsx`
- `agent-factory-dashboard/frontend/src/components/intake/RequirementSourceStep.tsx`
- `agent-factory-dashboard/frontend/src/components/intake/DraftGenerationStep.tsx`
- `agent-factory-dashboard/frontend/src/components/intake/DraftReviewStep.tsx`
- `agent-factory-dashboard/frontend/src/components/intake/DraftRiskPanel.tsx`
- `agent-factory-dashboard/frontend/src/components/intake/DraftFileList.tsx`

### 9.2 Store/API Extensions

Extend:

- `agent-factory-dashboard/frontend/src/api/agentFactory.ts`
- `agent-factory-dashboard/frontend/src/stores/agentFactory.ts`
- `agent-factory-dashboard/frontend/src/types/agent-factory.ts`

Add frontend API methods:

- `createIntakeDraft(projectId, formData)`
- `generateIntakeDraft(draftId)`
- `fetchIntakeDraft(draftId)`
- `updateIntakeDraft(draftId, draft)`
- `registerIntakeDraft(draftId)`

### 9.3 UX States

The wizard must handle:

- Draft creation in progress.
- Upload validation errors.
- Agent generation running.
- Agent generation failed.
- Draft ready.
- Draft edited locally but unsaved.
- Draft registered.
- Formal ADU creation failed due to backend validation.

Buttons must enter a pending state immediately after click to avoid repeated submissions.

## 10. Security Design

### 10.1 Upload Safety

- Store uploads only under `<target-repo>/.ai-agent/intake/<draft_id>/uploaded/`.
- Sanitize file names.
- Generate a `file_id` and never trust original file names as paths.
- Reject binary files.
- Reject files over max size.
- Store SHA-256 for each uploaded file.
- Do not execute uploaded content.

### 10.2 Prompt Safety

- Uploaded text is untrusted.
- Prompt must explicitly state that uploaded content may contain malicious instructions.
- Intake Agent must not obey instructions inside uploaded documents that attempt to override system policy, access secrets, run commands, or change paths.
- Intake Agent may summarize uploaded content but must not execute any command from it.

### 10.3 Registration Safety

Final ADU registration goes through `ProjectAduFactory.createForProject`. This is the hard boundary. Even if the draft looks valid, the backend must reject unsafe paths and commands at registration time.

## 11. Testing Strategy

### 11.1 Backend Tests

Create:

`agent-factory-dashboard/backend/tools/test-adu-intake.js`

Cases:

1. Create draft from text only.
2. Create draft from `.md` upload only.
3. Create draft from text plus upload.
4. Reject unsupported extension.
5. Reject binary file.
6. Reject oversized file.
7. Reject draft creation for non-profiled project.
8. Generate draft with mock Hermes.
9. Reject draft registration with unsafe write path.
10. Reject draft registration with blocked command.
11. Register valid draft into formal ADU.
12. Ensure registered ADU uses `ProjectAduFactory` and has project-aware fields.
13. Ensure cross-project draft artifact read is denied.
14. Ensure tests use isolated registry paths and do not write mock data into production registry.

### 11.2 Python/Prompt Tests

Create:

`scripts/test_adu_intake_agent.py`

Cases:

- Raw text is included in prompt.
- Uploaded files are included with truncation metadata.
- Project profile and knowledge pack are included.
- Malicious uploaded instruction is framed as untrusted content.
- Mock response draft parses as valid JSON.
- Low-confidence draft with questions is not auto-registered.

### 11.3 Frontend Tests/Build Checks

At minimum:

- `npm run build` in backend.
- `npm run build` in frontend.
- Manual UI walkthrough:
  - Text-only draft.
  - File-only draft.
  - Combined draft.
  - Edit draft.
  - Register ADU.
  - Open newly created ADU in Agent Factory page.

## 12. Rollout Plan

MVP rollout:

1. Implement backend draft storage and APIs.
2. Add `adu-intake-agent.md`.
3. Implement mock Hermes based backend tests.
4. Add frontend wizard.
5. Register valid drafts through existing `ProjectAduFactory`.
6. Test with one low-risk UERANSIM requirement.

Post-MVP:

- Add `.docx` parsing.
- Add `.pdf` parsing.
- Add multi-ADU split creation.
- Add duplicate/similar requirement detection.
- Add draft comparison between multiple Agent-generated alternatives.

## 13. Open Decisions

The MVP makes these decisions explicitly:

- `.txt`, `.md`, and `.json` are supported in the first release.
- `.docx` and `.pdf` are not supported in the first release.
- Intake Agent creates drafts only; humans register formal ADUs.
- Formal ADU registration reuses `ProjectAduFactory`.
- Draft artifacts are project-local.
- Process documents and reports default to Chinese.

## 14. Acceptance Criteria

The feature is accepted when:

- A user can select a profiled project and create an intake draft from raw text.
- A user can create an intake draft from an uploaded `.md`, `.txt`, or `.json` file.
- A user can combine text input and uploaded files.
- Intake Agent generates `draft.json` and `intake-report.md`.
- The draft can be edited in the UI.
- Unsafe paths and commands are rejected before registration.
- A valid draft can be registered as a formal project-aware ADU.
- The registered ADU appears in the Agent Factory page in `created` state.
- No old NMS code is modified.
- Tests prove upload safety, path safety, command safety, and registration through `ProjectAduFactory`.


# Agent Factory Universal Git Repository Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the standalone Agent Factory from a single Open5GS/5GC-oriented factory into a reusable first-stage platform where any local Git repository can be registered, profiled, and prepared for later ADU-based requirement development.

**Architecture:** Add a project layer above the existing Agent Factory core. The current ADU development pipeline, Orchestrator, Hermes runner, quality gates, model selection, Token tracking, and Dashboard controls remain reusable; first-stage universalization introduces project registry, project profiling, project knowledge packs, project-scoped workspace resolution, and Dashboard project switching.

**Tech Stack:** Python scripts, Hermes CLI executor, JSON file registries, Markdown knowledge artifacts, standalone Express backend in `agent-factory-dashboard/backend`, React/Zustand frontend in `agent-factory-dashboard/frontend`.

---

## 1. Scope

This phase updates only the standalone Agent Factory:

```text
agent-factory-dashboard/
scripts/
.ai-agent/
docs/superpowers/
```

Do not update or validate the old NMS integration:

```text
open5gs-nms/
```

The first phase target is not “automatically develop any requirement in any repo.” The target is:

```text
Any local Git repository can be registered, analyzed, and represented as a Project Profile + Project Knowledge Pack.
```

After this phase, the existing ADU development pipeline can be reused by associating ADUs with `project_id`.

## 2. Product Goals

### 2.1 User-Facing Goals

1. User can add any local Git repository path from the standalone Dashboard.
2. Agent Factory validates that the path is a readable Git repository.
3. Agent Factory creates a project record in `.ai-agent/registry/projects.json`.
4. User can run a read-only project profiling workflow.
5. The profiling workflow generates:

```text
<repo>/.agent-factory/project-profile.json
<repo>/.agent-factory/knowledge/project-summary.md
<repo>/.agent-factory/knowledge/module-map.md
<repo>/.agent-factory/knowledge/test-strategy.md
<repo>/.agent-factory/knowledge/risk-map.md
```

6. Dashboard shows project list, project profile status, detected stack, discovered commands, and knowledge artifacts.
7. Future ADUs can reference `project_id` and reuse the existing development pipeline.

### 2.2 Engineering Goals

1. Keep current Agent Factory core reusable.
2. Avoid hard-coded Open5GS workspace assumptions in standalone Dashboard and scripts.
3. Make project onboarding read-only by default.
4. Support multiple projects without mixing ADUs, runs, locks, artifacts, or costs.
5. Keep the profile schema generic enough for Node, Python, Go, Rust, Java, C/C++, monorepo, and unknown legacy repositories.

## 3. Non-Goals

This phase does not:

1. Clone remote repositories.
2. Install dependencies.
3. Run heavy build/test commands by default.
4. Modify target project source code.
5. Automatically open PRs.
6. Add multi-user auth.
7. Move registries into a database.
8. Build a full Agent Marketplace.

## 4. Conceptual Model

### 4.1 Existing Core To Reuse

These existing capabilities remain the delivery engine:

```text
ADU registry
Hermes runner
Orchestrator state machine
Prompt registry
Model selection
Token budget
Single-step / auto-run
Review gates
Contract gate
Code reviewer
Acceptance reviewer
Evidence collector
Standalone Dashboard
```

### 4.2 New Project Layer

Add a project layer:

```text
Project Registry
Project Profile
Project Knowledge Pack
Project-scoped ADUs
Project-scoped workspace root
Project-scoped command and path policy
```

Resulting structure:

```text
Universal Agent Factory
├── Factory Core
│   ├── Orchestrator
│   ├── Runner
│   ├── Agent Registry
│   ├── Token / Model / Lock
│   └── Quality Gates
├── Project Layer
│   ├── projects.json
│   ├── project-profiler
│   ├── project-profile.json
│   ├── knowledge pack
│   └── project path policy
└── Dashboard
    ├── Project List
    ├── Project Profile
    ├── Knowledge Pack
    ├── ADU Queue
    └── Workflow Control
```

## 5. Data Model

### 5.1 Factory Project Registry

Create:

```text
.ai-agent/registry/projects.json
```

Schema:

```json
{
  "version": 1,
  "projects": [
    {
      "project_id": "open5gs",
      "name": "Open5GS Workspace",
      "repo_path": "/Users/hill/open5gs",
      "git_root": "/Users/hill/open5gs",
      "default_branch": "main",
      "status": "profiled",
      "created_at": "2026-06-08T12:00:00Z",
      "updated_at": "2026-06-08T12:30:00Z",
      "profile_path": "/Users/hill/open5gs/.agent-factory/project-profile.json",
      "knowledge_dir": "/Users/hill/open5gs/.agent-factory/knowledge",
      "last_profiled_at": "2026-06-08T12:30:00Z",
      "profile_summary": {
        "detected_stack": ["typescript", "python", "c"],
        "project_type": "monorepo",
        "risk_level": "high",
        "build_commands": ["npm run build"],
        "test_commands": ["npm test"]
      }
    }
  ]
}
```

Status values:

| Status | Meaning |
| --- | --- |
| `registered` | Path is known but profiling has not run |
| `profiling` | Project profiler is running |
| `profiled` | Profile and knowledge pack exist |
| `profile_failed` | Profiling failed |
| `disabled` | Project is hidden from active selection |

### 5.2 Project Profile In Target Repository

Create inside the target repository:

```text
<repo>/.agent-factory/project-profile.json
```

Schema:

```json
{
  "version": 1,
  "project_id": "example-repo",
  "name": "example-repo",
  "repo_path": "/Users/hill/example-repo",
  "git": {
    "git_root": "/Users/hill/example-repo",
    "default_branch": "main",
    "current_branch": "main",
    "is_dirty": false,
    "remote_count": 1
  },
  "project_type": "web-frontend",
  "detected_stack": [
    "typescript",
    "react",
    "vite"
  ],
  "package_managers": [
    "npm"
  ],
  "language_breakdown": [
    {
      "language": "typescript",
      "files": 120,
      "bytes": 850000
    }
  ],
  "important_files": [
    "package.json",
    "vite.config.ts",
    "tsconfig.json"
  ],
  "source_dirs": [
    "src"
  ],
  "test_dirs": [
    "tests",
    "src"
  ],
  "config_dirs": [
    ".github",
    "config"
  ],
  "generated_or_vendor_dirs": [
    "node_modules",
    "dist",
    "build",
    ".next",
    "target",
    "__pycache__"
  ],
  "forbidden_paths": [
    ".git",
    "node_modules",
    "dist",
    "build",
    ".env"
  ],
  "discovered_commands": {
    "install": [
      "npm install"
    ],
    "build": [
      "npm run build"
    ],
    "test": [
      "npm test"
    ],
    "lint": [
      "npm run lint"
    ],
    "typecheck": [
      "npm run typecheck"
    ],
    "dev": [
      "npm run dev"
    ]
  },
  "safe_probe_commands_run": [
    {
      "command": "git status --short",
      "exit_code": 0,
      "summary": "clean"
    }
  ],
  "risk_level": "medium",
  "risk_reasons": [
    "Frontend app with build and lint commands detected",
    "No deployment commands executed during profiling"
  ],
  "recommended_pipeline": [
    "requirement-analyst",
    "detail-designer",
    "contract",
    "testwriter",
    "developer",
    "code-reviewer",
    "buildfix-debugger",
    "acceptance-reviewer",
    "evidence"
  ],
  "default_adu_policy": {
    "allowed_read_paths": [
      "."
    ],
    "allowed_write_paths": [
      "src",
      "tests",
      "docs"
    ],
    "required_commands": [
      "npm run build"
    ]
  },
  "profiled_at": "2026-06-08T12:30:00Z"
}
```

### 5.3 Knowledge Pack

Create:

```text
<repo>/.agent-factory/knowledge/project-summary.md
<repo>/.agent-factory/knowledge/module-map.md
<repo>/.agent-factory/knowledge/test-strategy.md
<repo>/.agent-factory/knowledge/risk-map.md
```

`project-summary.md`:

```markdown
# Project Summary

## Repository

## Detected Stack

## Application Shape

## Build And Test Commands

## Main Developer Entry Points

## Notes For Future ADUs
```

`module-map.md`:

```markdown
# Module Map

## Top-Level Directories

## Source Modules

## Test Modules

## Config Modules

## Generated Or Vendor Directories
```

`test-strategy.md`:

```markdown
# Test Strategy

## Discovered Test Frameworks

## Test Commands

## Commands Safe To Run Automatically

## Commands Requiring Human Approval

## Missing Test Signals
```

`risk-map.md`:

```markdown
# Risk Map

## High-Risk Paths

## Secrets And Environment Files

## Generated Or Vendor Paths

## Deployment Or Destructive Commands

## Recommended Human Gates
```

### 5.4 ADU Project Association

Extend `.ai-agent/registry/adu.json`:

```json
{
  "id": "REQ-XXX",
  "project_id": "example-repo",
  "project_profile_path": "/Users/hill/example-repo/.agent-factory/project-profile.json",
  "workspace_root": "/Users/hill/example-repo"
}
```

Rules:

1. Existing ADUs without `project_id` are treated as belonging to a default project.
2. New ADUs must include `project_id`.
3. Orchestrator must resolve `workspace_root` from project registry, not from global `AGENT_FACTORY_WORKSPACE`.
4. Runner must inject project profile and knowledge pack into every Agent prompt.

## 6. Project Profiler Agent

### 6.1 Agent Registration

Add to `.ai-agent/registry/agents.json`:

```json
"project-profiler": {
  "description": "Analyze a local Git repository and generate a generic project profile plus project knowledge pack.",
  "prompt": ".ai-agent/prompts/project-profiler-agent.md",
  "worktree": false,
  "hermes_args": ["--profile", "coding", "-t", "hermes-cli"]
}
```

### 6.2 Prompt

Create:

```text
.ai-agent/prompts/project-profiler-agent.md
```

Prompt:

```markdown
# Project Profiler Agent

Analyze the registered Git repository for project `{{PROJECT_ID}}`.

## Mission

Create a project profile and knowledge pack that allow future Agent Factory ADUs to work safely in this repository.

## Safety Rules

You must not modify source code.
You must not install dependencies.
You must not run deployment, migration, publish, delete, cleanup, or release commands.
You may read files and run safe discovery commands only.

## Required Inputs

Read the runtime payload. It contains:

```json
{
  "project_id": "{{PROJECT_ID}}",
  "repo_path": "/path/to/repo"
}
```

## Discovery Requirements

Inspect:

1. Git metadata and branch state.
2. Top-level directory structure.
3. Package and build files.
4. CI workflow files.
5. Test directories and test file naming patterns.
6. Source directories.
7. Generated or vendor directories.
8. Secret and environment file patterns.
9. Commands that appear safe, unsafe, or ambiguous.

## Files To Recognize

Recognize at least:

```text
package.json
pnpm-lock.yaml
yarn.lock
pyproject.toml
requirements.txt
setup.py
go.mod
Cargo.toml
pom.xml
build.gradle
CMakeLists.txt
meson.build
Makefile
.github/workflows/*.yml
.gitlab-ci.yml
Dockerfile
docker-compose.yml
```

## Output Artifacts

Write:

```text
<repo>/.agent-factory/project-profile.json
<repo>/.agent-factory/knowledge/project-summary.md
<repo>/.agent-factory/knowledge/module-map.md
<repo>/.agent-factory/knowledge/test-strategy.md
<repo>/.agent-factory/knowledge/risk-map.md
```

All Markdown documents should use Chinese by default. Commands, paths, code identifiers, JSON keys, framework names, and protocol terms stay in their original form.

## Final Response

Return exactly one JSON block:

```json
{
  "result": "success",
  "next_state": "project_profiled",
  "changed_files": [
    ".agent-factory/project-profile.json",
    ".agent-factory/knowledge/project-summary.md",
    ".agent-factory/knowledge/module-map.md",
    ".agent-factory/knowledge/test-strategy.md",
    ".agent-factory/knowledge/risk-map.md"
  ],
  "artifacts": [
    ".agent-factory/project-profile.json",
    ".agent-factory/knowledge/project-summary.md",
    ".agent-factory/knowledge/module-map.md",
    ".agent-factory/knowledge/test-strategy.md",
    ".agent-factory/knowledge/risk-map.md"
  ],
  "risks": [],
  "next_agent": null
}
```
```

## 7. Local Deterministic Scanner

The first phase should not depend only on LLM inference. Add a deterministic scanner that prepares structured facts for the `project-profiler` Agent.

Create:

```text
scripts/project_profile_scan.py
```

CLI:

```bash
python3 scripts/project_profile_scan.py --project-id example --repo /path/to/repo --out /tmp/project-scan.json
```

The scanner must:

1. Validate the repo path exists.
2. Validate it is inside a Git repository.
3. Resolve realpath to prevent symlink confusion.
4. Read only metadata and small text files.
5. Ignore `.git`, `node_modules`, `dist`, `build`, `.next`, `target`, `__pycache__`, `.venv`, `vendor`.
6. Detect package/build files.
7. Parse `package.json` scripts.
8. Parse basic command hints from known files.
9. Count languages by extension.
10. Generate `project-scan.json`.

Example output:

```json
{
  "project_id": "example",
  "repo_path": "/path/to/repo",
  "git_root": "/path/to/repo",
  "current_branch": "main",
  "is_dirty": false,
  "detected_files": ["package.json", "tsconfig.json"],
  "package_managers": ["npm"],
  "language_breakdown": [
    {"language": "typescript", "files": 42, "bytes": 310000}
  ],
  "commands": {
    "build": ["npm run build"],
    "test": ["npm test"],
    "lint": ["npm run lint"]
  },
  "source_dirs": ["src"],
  "test_dirs": ["tests"],
  "risk_paths": [".env"],
  "ignored_dirs": ["node_modules", "dist"]
}
```

## 8. Backend Design

### 8.1 Config

Modify:

```text
agent-factory-dashboard/backend/src/config.ts
```

Add:

```ts
projectsRegistryPath: string;
allowProjectPaths: string[];
```

Environment variables:

```text
AGENT_FACTORY_PROJECTS_REGISTRY=/Users/hill/open5gs/.ai-agent/registry/projects.json
AGENT_FACTORY_ALLOWED_PROJECT_ROOTS=/Users/hill,/Users/hill/Desktop,/Users/hill/open5gs
```

Default:

```ts
projectsRegistryPath = path.join(workspaceRoot, '.ai-agent', 'registry', 'projects.json')
allowProjectPaths = [path.dirname(workspaceRoot), workspaceRoot]
```

### 8.2 Project Repository

Create:

```text
agent-factory-dashboard/backend/src/domain/project.ts
agent-factory-dashboard/backend/src/domain/project-repository.ts
agent-factory-dashboard/backend/src/infrastructure/file-project-repository.ts
```

Types:

```ts
export type ProjectStatus =
  | 'registered'
  | 'profiling'
  | 'profiled'
  | 'profile_failed'
  | 'disabled';

export interface AgentFactoryProject {
  project_id: string;
  name: string;
  repo_path: string;
  git_root: string;
  default_branch: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  profile_path: string | null;
  knowledge_dir: string | null;
  last_profiled_at: string | null;
  profile_summary?: {
    detected_stack: string[];
    project_type: string;
    risk_level: 'low' | 'medium' | 'high' | 'unknown';
    build_commands: string[];
    test_commands: string[];
  };
}
```

Repository interface:

```ts
export interface ProjectRepository {
  listProjects(): Promise<AgentFactoryProject[]>;
  getProject(projectId: string): Promise<AgentFactoryProject | null>;
  createProject(input: RegisterProjectInput): Promise<AgentFactoryProject>;
  updateProject(project: AgentFactoryProject): Promise<void>;
  disableProject(projectId: string): Promise<void>;
}
```

Path safety:

1. Resolve `repo_path` with `fs.realpath`.
2. Require the path to be under one of `allowProjectPaths`.
3. Require `.git` directory or `git rev-parse --show-toplevel` success.
4. Reject paths under forbidden directories:

```text
/
/System
/Library
/Applications
/Users/hill/.ssh
/Users/hill/.hermes
/Users/hill/.codex
```

### 8.3 Project Use Case

Create:

```text
agent-factory-dashboard/backend/src/application/project-onboarding.ts
```

Responsibilities:

1. Register project.
2. Validate path.
3. Create `.agent-factory/` directories in target repo.
4. Run deterministic scanner.
5. Spawn `project-profiler`.
6. Update project status.
7. Aggregate project profile and knowledge artifacts for Dashboard.

### 8.4 API Endpoints

Add to standalone backend:

```http
GET /api/agent-factory/projects
POST /api/agent-factory/projects
GET /api/agent-factory/projects/:projectId
POST /api/agent-factory/projects/:projectId/profile
GET /api/agent-factory/projects/:projectId/profile
GET /api/agent-factory/projects/:projectId/knowledge
GET /api/agent-factory/projects/:projectId/knowledge/:doc
POST /api/agent-factory/projects/:projectId/disable
```

### 8.5 Register Project API

Request:

```json
{
  "name": "Example Repo",
  "repoPath": "/Users/hill/example-repo"
}
```

Response:

```json
{
  "project": {
    "project_id": "example-repo",
    "name": "Example Repo",
    "repo_path": "/Users/hill/example-repo",
    "git_root": "/Users/hill/example-repo",
    "status": "registered"
  }
}
```

Errors:

| Status | Error |
| --- | --- |
| 400 | Path missing or not a directory |
| 403 | Path outside allowed roots |
| 409 | Project already registered |
| 422 | Not a Git repository |

### 8.6 Run Profile API

```http
POST /api/agent-factory/projects/:projectId/profile
```

Response:

```json
{
  "success": true,
  "projectId": "example-repo",
  "status": "profiling"
}
```

Behavior:

1. Set project status to `profiling`.
2. Run `scripts/project_profile_scan.py`.
3. Spawn `project-profiler`.
4. Stream profiler events to WebSocket.
5. On success, set status to `profiled`.
6. On failure, set status to `profile_failed`.

## 9. Python Runner And Orchestrator Changes

### 9.1 Project-Aware Runner

Modify:

```text
scripts/hermes_agent_run.py
```

Add optional CLI args:

```bash
--project <PROJECT_ID>
--repo <REPO_PATH>
```

Rules:

1. If `--adu` is used, resolve project from ADU `project_id`.
2. If `--agent project-profiler`, require `--project`.
3. Runtime payload must include:

```json
{
  "project": {
    "project_id": "example-repo",
    "repo_path": "/path/to/repo",
    "profile_path": "/path/to/repo/.agent-factory/project-profile.json",
    "knowledge_dir": "/path/to/repo/.agent-factory/knowledge"
  }
}
```

4. For non-profiler ADU Agents, include project profile and knowledge paths in prompt.
5. For ADU Agents, run Hermes with `cwd` equal to project `repo_path`.
6. Run records still go to factory registry:

```text
.ai-agent/registry/runs.json
```

7. Run records must include:

```json
{
  "project_id": "example-repo",
  "workspace_root": "/path/to/repo"
}
```

### 9.2 Project-Aware Orchestrator

Modify:

```text
scripts/hermes_agent_orchestrator.py
```

Rules:

1. Resolve ADU project before selecting next Agent.
2. Lock key becomes:

```text
.ai-agent/locks/<PROJECT_ID>__<ADU_ID>.lock
```

3. If ADU has no `project_id`, assign default project id:

```text
default-open5gs
```

4. When running `hermes_agent_run.py`, pass:

```bash
--project <PROJECT_ID>
```

5. ADU state machine is unchanged.

### 9.3 Project Profiling Script

Create:

```text
scripts/hermes_project_profile.py
```

CLI:

```bash
python3 scripts/hermes_project_profile.py --project example-repo
```

Behavior:

1. Read `.ai-agent/registry/projects.json`.
2. Set project status to `profiling`.
3. Run deterministic scan.
4. Run `hermes_agent_run.py --project example-repo --agent project-profiler`.
5. Validate project profile exists and is valid JSON.
6. Validate knowledge files exist and are non-empty.
7. Set project status to `profiled`.
8. Update `profile_summary`.

## 10. Dashboard Frontend Design

### 10.1 Navigation

Add a project selector at the top of the standalone Dashboard:

```text
[Project: Open5GS Workspace v]
```

Views:

```text
Projects
Project Profile
Knowledge Pack
ADUs
Runs
Quality Gates
Token Budget
```

### 10.2 Projects Page

Create:

```text
agent-factory-dashboard/frontend/src/components/projects/ProjectsPage.tsx
agent-factory-dashboard/frontend/src/components/projects/RegisterProjectModal.tsx
agent-factory-dashboard/frontend/src/components/projects/ProjectCard.tsx
agent-factory-dashboard/frontend/src/components/projects/ProjectProfilePanel.tsx
agent-factory-dashboard/frontend/src/components/projects/KnowledgePackPanel.tsx
```

Project card displays:

1. Project name.
2. Repo path.
3. Status.
4. Detected stack.
5. Risk level.
6. Last profiled time.
7. Buttons:
   - `Run Profile`
   - `View Profile`
   - `View Knowledge`
   - `Disable`

### 10.3 ADU Filtering

ADU list should filter by selected `project_id`.

If no project is selected, show all ADUs grouped by project.

### 10.4 Empty State

If no projects exist:

```text
No projects registered yet.
Register a local Git repository to create its Project Profile and Knowledge Pack.
```

## 11. Safety Model

### 11.1 Read-Only Profiling

Project profiling may write only:

```text
<repo>/.agent-factory/
```

It may not modify:

```text
<repo>/src
<repo>/tests
<repo>/package.json
<repo>/pyproject.toml
<repo>/go.mod
<repo>/Cargo.toml
```

### 11.2 Safe Commands

Allowed without approval:

```text
git status --short
git branch --show-current
git rev-parse --show-toplevel
git remote -v
find/list directory equivalents implemented in Python
```

Not allowed in Phase 1:

```text
npm install
pip install
cargo build
go test
mvn test
docker build
docker compose up
deploy
publish
migrate
rm
git checkout
git reset
```

### 11.3 File Size Limits

Profiler should read:

1. Known manifest files up to 200KB each.
2. Directory listings up to 5,000 files.
3. Total scan output up to 2MB.

If exceeded, record truncation in `risk-map.md` and `project-profile.json`.

## 12. Reusing Existing Requirement Development

Once a project is `profiled`, users can create ADUs for that project.

ADU creation should prefill from project profile:

```json
{
  "project_id": "example-repo",
  "allowed_read_paths": [".", ".agent-factory/knowledge"],
  "allowed_write_paths": ["src", "tests", "docs"],
  "required_commands": ["npm run build"],
  "document_language": "zh-CN"
}
```

Existing Agents should receive these additional context files:

```text
<repo>/.agent-factory/project-profile.json
<repo>/.agent-factory/knowledge/project-summary.md
<repo>/.agent-factory/knowledge/module-map.md
<repo>/.agent-factory/knowledge/test-strategy.md
<repo>/.agent-factory/knowledge/risk-map.md
```

No new development pipeline is required in Phase 1. The current pipeline remains:

```text
requirement-analyst
context-pack
detail-designer
contract
testwriter
developer
code-reviewer
buildfix-debugger
acceptance-reviewer
evidence
```

## 13. File Changes

### 13.1 New Files

```text
.ai-agent/prompts/project-profiler-agent.md
scripts/project_profile_scan.py
scripts/hermes_project_profile.py
agent-factory-dashboard/backend/src/domain/project.ts
agent-factory-dashboard/backend/src/domain/project-repository.ts
agent-factory-dashboard/backend/src/infrastructure/file-project-repository.ts
agent-factory-dashboard/backend/src/application/project-onboarding.ts
agent-factory-dashboard/backend/tools/test-project-onboarding.js
agent-factory-dashboard/frontend/src/components/projects/ProjectsPage.tsx
agent-factory-dashboard/frontend/src/components/projects/RegisterProjectModal.tsx
agent-factory-dashboard/frontend/src/components/projects/ProjectCard.tsx
agent-factory-dashboard/frontend/src/components/projects/ProjectProfilePanel.tsx
agent-factory-dashboard/frontend/src/components/projects/KnowledgePackPanel.tsx
```

### 13.2 Modified Files

```text
.ai-agent/registry/agents.json
.ai-agent/registry/adu.json
scripts/hermes_agent_run.py
scripts/hermes_agent_orchestrator.py
scripts/hermes_agent_next.py
agent-factory-dashboard/backend/src/config.ts
agent-factory-dashboard/backend/src/index.ts
agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts
agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts
agent-factory-dashboard/backend/src/infrastructure/file-agent-factory-repository.ts
agent-factory-dashboard/backend/package.json
agent-factory-dashboard/frontend/src/App.tsx
agent-factory-dashboard/frontend/src/api/agentFactory.ts
agent-factory-dashboard/frontend/src/stores/agentFactory.ts
agent-factory-dashboard/frontend/src/types/agent-factory.ts
```

## 14. Implementation Tasks

### Task 1: Add Project Registry And Backend Repository

**Files:**
- Create: `agent-factory-dashboard/backend/src/domain/project.ts`
- Create: `agent-factory-dashboard/backend/src/domain/project-repository.ts`
- Create: `agent-factory-dashboard/backend/src/infrastructure/file-project-repository.ts`
- Modify: `agent-factory-dashboard/backend/src/config.ts`

- [ ] **Step 1: Add project domain types**

Create `project.ts` with `ProjectStatus`, `AgentFactoryProject`, `RegisterProjectInput`, and `ProjectProfileSummary`.

- [ ] **Step 2: Add repository interface**

Create `project-repository.ts` with:

```ts
export interface ProjectRepository {
  listProjects(): Promise<AgentFactoryProject[]>;
  getProject(projectId: string): Promise<AgentFactoryProject | null>;
  createProject(input: RegisterProjectInput): Promise<AgentFactoryProject>;
  updateProject(project: AgentFactoryProject): Promise<void>;
  disableProject(projectId: string): Promise<void>;
}
```

- [ ] **Step 3: Implement file repository**

Implement `.ai-agent/registry/projects.json` read/write with atomic writes and path validation.

- [ ] **Step 4: Build**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run build
```

Expected: `tsc` passes.

### Task 2: Add Deterministic Project Scanner

**Files:**
- Create: `scripts/project_profile_scan.py`

- [ ] **Step 1: Implement CLI args**

Support:

```bash
python3 scripts/project_profile_scan.py --project-id example --repo /path/to/repo --out /tmp/project-scan.json
```

- [ ] **Step 2: Implement safe scan**

The scanner must ignore:

```python
IGNORED_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    "target",
    "__pycache__",
    ".venv",
    "vendor",
}
```

- [ ] **Step 3: Implement stack detection**

Detect stack from manifest files:

```python
MANIFEST_STACK = {
    "package.json": ["node"],
    "pyproject.toml": ["python"],
    "requirements.txt": ["python"],
    "go.mod": ["go"],
    "Cargo.toml": ["rust"],
    "pom.xml": ["java"],
    "build.gradle": ["java"],
    "CMakeLists.txt": ["c-cpp"],
    "meson.build": ["c-cpp"],
}
```

- [ ] **Step 4: Validate output**

Run against `/Users/hill/open5gs`:

```bash
python3 scripts/project_profile_scan.py --project-id open5gs --repo /Users/hill/open5gs --out /tmp/open5gs-project-scan.json
python3 -m json.tool /tmp/open5gs-project-scan.json
```

Expected: valid JSON.

### Task 3: Add Project Profiler Agent

**Files:**
- Create: `.ai-agent/prompts/project-profiler-agent.md`
- Modify: `.ai-agent/registry/agents.json`
- Create: `scripts/hermes_project_profile.py`

- [ ] **Step 1: Register `project-profiler`**

Add the agent entry from section 6.1.

- [ ] **Step 2: Create prompt**

Use the prompt from section 6.2.

- [ ] **Step 3: Implement project profiling script**

`hermes_project_profile.py` must:

1. Read project registry.
2. Run deterministic scanner.
3. Run `hermes_agent_run.py --project <id> --agent project-profiler`.
4. Validate profile and knowledge artifacts.
5. Update project registry.

- [ ] **Step 4: Compile**

Run:

```bash
python3 -m py_compile scripts/project_profile_scan.py scripts/hermes_project_profile.py
```

Expected: no output.

### Task 4: Make Runner And Orchestrator Project-Aware

**Files:**
- Modify: `scripts/hermes_agent_run.py`
- Modify: `scripts/hermes_agent_orchestrator.py`
- Modify: `scripts/hermes_agent_next.py`

- [ ] **Step 1: Add CLI args**

Add:

```python
parser.add_argument("--project", required=False)
parser.add_argument("--repo", required=False)
```

- [ ] **Step 2: Resolve project for ADU**

If `--adu` exists, load ADU, read `project_id`, then load project from `projects.json`.

- [ ] **Step 3: Inject project context**

Add to prompt payload:

```json
{
  "project_profile": "<repo>/.agent-factory/project-profile.json",
  "project_knowledge": [
    "<repo>/.agent-factory/knowledge/project-summary.md",
    "<repo>/.agent-factory/knowledge/module-map.md",
    "<repo>/.agent-factory/knowledge/test-strategy.md",
    "<repo>/.agent-factory/knowledge/risk-map.md"
  ]
}
```

- [ ] **Step 4: Use project cwd for ADU Agents**

For all ADU agents except registry-only operations, run Hermes with:

```python
cwd = project["repo_path"]
```

- [ ] **Step 5: Use project-scoped locks**

Change lock filename to:

```text
<PROJECT_ID>__<ADU_ID>.lock
```

### Task 5: Add Project APIs

**Files:**
- Create: `agent-factory-dashboard/backend/src/application/project-onboarding.ts`
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Modify: `agent-factory-dashboard/backend/src/index.ts`

- [ ] **Step 1: Register Project API**

Implement:

```http
POST /api/agent-factory/projects
```

- [ ] **Step 2: List Project API**

Implement:

```http
GET /api/agent-factory/projects
```

- [ ] **Step 3: Run Profile API**

Implement:

```http
POST /api/agent-factory/projects/:projectId/profile
```

- [ ] **Step 4: Read Profile And Knowledge APIs**

Implement:

```http
GET /api/agent-factory/projects/:projectId/profile
GET /api/agent-factory/projects/:projectId/knowledge
GET /api/agent-factory/projects/:projectId/knowledge/:doc
```

### Task 6: Add Project Dashboard UI

**Files:**
- Modify: `agent-factory-dashboard/frontend/src/App.tsx`
- Modify: `agent-factory-dashboard/frontend/src/api/agentFactory.ts`
- Modify: `agent-factory-dashboard/frontend/src/stores/agentFactory.ts`
- Create: project components listed in section 13.1

- [ ] **Step 1: Add project API client methods**

Methods:

```ts
fetchProjects()
registerProject(input)
runProjectProfile(projectId)
fetchProjectProfile(projectId)
fetchProjectKnowledge(projectId)
fetchProjectKnowledgeDoc(projectId, doc)
```

- [ ] **Step 2: Add project state**

Store:

```ts
projects: AgentFactoryProject[];
selectedProjectId: string | null;
projectProfile: unknown | null;
projectKnowledge: Record<string, string>;
```

- [ ] **Step 3: Add Projects page**

Implement project list, register modal, and profile controls.

- [ ] **Step 4: Filter ADUs by selected project**

Existing ADUs without `project_id` appear under default project.

### Task 7: Add Integration Tests

**Files:**
- Create: `agent-factory-dashboard/backend/tools/test-project-onboarding.js`
- Modify: `agent-factory-dashboard/backend/package.json`

- [ ] **Step 1: Add script**

Add:

```json
"test:project-onboarding": "node tools/test-project-onboarding.js"
```

- [ ] **Step 2: Test registering a temp Git repo**

The test should:

1. Create temp directory under `/tmp`.
2. Run `git init`.
3. Write `package.json`.
4. Call `POST /api/agent-factory/projects`.
5. Assert status `registered`.

- [ ] **Step 3: Test scanner**

Run:

```bash
python3 scripts/project_profile_scan.py --project-id tmp-test --repo <tmp-repo> --out <tmp>/scan.json
```

Assert detected stack contains `node`.

- [ ] **Step 4: Test profile artifact read**

Write a fake valid project profile under temp repo, then call:

```http
GET /api/agent-factory/projects/:projectId/profile
```

Assert JSON is returned.

## 15. Acceptance Criteria

This phase is complete only when:

1. Standalone Dashboard can register a local Git repository.
2. Invalid path outside allowed roots is rejected.
3. Non-Git path is rejected.
4. `projects.json` is created and updated safely.
5. Deterministic scanner works on at least:
   - a Node repo
   - this Open5GS workspace
6. `project-profiler` is registered.
7. Project profile and knowledge pack can be generated.
8. Dashboard shows project list and profile summary.
9. ADUs can include `project_id`.
10. Runner injects project profile and knowledge paths into prompts.
11. Orchestrator uses project-scoped locks.
12. Existing single-project Open5GS ADUs still display under the default project.
13. `agent-factory-dashboard/backend npm run build` passes.
14. `agent-factory-dashboard/frontend npm run build` passes.
15. `python3 -m py_compile scripts/project_profile_scan.py scripts/hermes_project_profile.py scripts/hermes_agent_run.py scripts/hermes_agent_orchestrator.py` passes.
16. `agent-factory-dashboard/backend npm run test:project-onboarding` passes.

## 16. Verification Commands

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run build
npm run test:project-onboarding
```

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/frontend
npm run build
```

Run:

```bash
cd /Users/hill/open5gs
python3 -m py_compile scripts/project_profile_scan.py scripts/hermes_project_profile.py scripts/hermes_agent_run.py scripts/hermes_agent_orchestrator.py
```

Manual smoke:

```bash
python3 scripts/project_profile_scan.py --project-id open5gs --repo /Users/hill/open5gs --out /tmp/open5gs-project-scan.json
python3 -m json.tool /tmp/open5gs-project-scan.json
```

## 17. Rollout Strategy

### 17.1 Default Project Migration

On first startup, if `projects.json` does not exist, create:

```json
{
  "project_id": "default-open5gs",
  "name": "Default Open5GS Workspace",
  "repo_path": "/Users/hill/open5gs",
  "git_root": "/Users/hill/open5gs",
  "status": "registered"
}
```

Existing ADUs without `project_id` are displayed under `default-open5gs`.

### 17.2 Backward Compatibility

Existing ADU development does not stop working. If `project_id` is missing:

1. Use default project.
2. Use existing `AGENT_FACTORY_WORKSPACE` as workspace.
3. Emit warning in backend logs:

```text
ADU <id> has no project_id; using default project.
```

### 17.3 Operational Risk

The largest risk is path safety. Do not relax project path validation to support arbitrary system folders. A Git repository must be under configured allowed roots.

## 18. Self-Review

Spec coverage:

1. 任意 Git 仓库基础分析: covered by project registry, scanner, and profiler.
2. 复用现有开发功能: covered by project-aware ADU and runner injection.
3. 第一阶段不自动开发需求: stated in scope and non-goals.
4. 独立 Dashboard only: stated in scope and file changes.
5. Antigravity can develop directly: tasks include files, APIs, schemas, and verification commands.

No placeholder markers remain.


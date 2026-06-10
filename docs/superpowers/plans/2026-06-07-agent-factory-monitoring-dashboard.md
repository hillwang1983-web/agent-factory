# Agent Factory Monitoring Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web monitoring dashboard inside Open5GS NMS that displays current Agent factory requirements, Agent run states, workflow transitions, artifacts, and recent execution logs from `.ai-agent`.

**Architecture:** Add a read-only Agent Factory monitoring module to the existing NMS backend and frontend. The backend reads `.ai-agent/registry/adu.json`, `.ai-agent/registry/agents.json`, `.ai-agent/registry/runs.json`, evidence files, and run folders, then exposes REST APIs plus WebSocket status updates; the frontend adds an Agent Factory page with requirement cards, Agent lane status, workflow timeline, run table, artifact drawer, and health indicators.

**Tech Stack:** Express + TypeScript backend, Zod validation, `fs/promises`, existing `ws` WebSocket server, React 18 + Vite frontend, Zustand state, Axios API client, Recharts charts, lucide-react icons, Tailwind/NMS component classes.

---

## Product Scope

The first dashboard version is read-only. It monitors and explains current factory state; it does not start, stop, retry, or approve Agent runs.

Required monitoring coverage:

| Requirement | Dashboard Capability |
| --- | --- |
| 当前在处理的需求 | ADU list with state, risk, retry count, target level, next Agent, artifacts, and evidence state. |
| 各 Agent 的运行状态 | Agent lane cards showing last run, success/failure count, active/stale status, average duration if timestamps allow it. |
| 当前工作流转状态 | Per-ADU workflow stepper and run timeline from `created` through `evidenced` or `human_gate`. |
| 运行记录 | Run table with timestamp, ADU, Agent, return code, parsed result, run directory, stdout/stderr availability. |
| 证据与产物 | Artifact list linking evidence, contracts, context packs, validation summaries, stdout/stderr files. |
| 健康状态 | Registry validity, missing artifact count, stuck ADU count, human gate count, unstructured result count. |

Non-goals for first version:

| Excluded | Reason |
| --- | --- |
| Starting Hermes runs from UI | Requires approval model and command execution policy. |
| Editing ADU registry from UI | First version should be observability-only. |
| Streaming raw Hermes stdout live | Current factory writes run files after execution; live streaming can be added later. |
| Multi-workspace support | MVP targets `/Users/hill/open5gs`. |

## Data Sources

Existing deployment files:

```text
/Users/hill/open5gs/.ai-agent/
  registry/
    agents.json
    adu.json
    runs.json
  context-packs/
  contracts/
  runs/
  evidence/
```

Current observed state:

```text
REQ-MVP-001 | state=evidenced | 6 successful runs
REQ-MVP-004 | state=created | no registered run
```

## Backend Design

### Backend File Structure

Create these files:

```text
open5gs-nms/backend/src/domain/entities/agent-factory.ts
open5gs-nms/backend/src/domain/interfaces/agent-factory-repository.ts
open5gs-nms/backend/src/infrastructure/agent-factory/file-agent-factory-repository.ts
open5gs-nms/backend/src/application/use-cases/agent-factory-monitor.ts
open5gs-nms/backend/src/interfaces/rest/agent-factory-controller.ts
```

Modify:

```text
open5gs-nms/backend/src/index.ts
open5gs-nms/backend/src/config/app-config.ts
```

### Backend Domain Types

File: `open5gs-nms/backend/src/domain/entities/agent-factory.ts`

```ts
export type AgentFactoryAduState =
  | 'created'
  | 'contexted'
  | 'contracted'
  | 'test_red'
  | 'implemented'
  | 'debugged'
  | 'evidenced'
  | 'mvp_ready'
  | 'human_gate'
  | string;

export interface AgentFactoryAdu {
  id: string;
  title: string;
  goal: string;
  state: AgentFactoryAduState;
  retry_count: number;
  max_retries: number;
  risk: string;
  target_level: string;
  allowed_read_paths: string[];
  allowed_write_paths: string[];
  required_commands: string[];
  required_evidence: string[];
  artifacts: string[];
  human_gate_required: boolean;
}

export interface AgentFactoryAgentConfig {
  description: string;
  prompt: string;
  worktree: boolean;
  hermes_args: string[];
}

export interface AgentFactoryRun {
  timestamp: string;
  adu_id: string;
  agent: string;
  returncode: number;
  result: string;
  run_dir: string;
  parsed_result: {
    result?: string;
    next_state?: string;
    changed_files?: string[];
    commands_run?: Array<string | { command: string; result?: string }>;
    artifacts?: string[];
    risks?: string[];
    next_agent?: string | null;
  } | null;
}

export interface AgentFactoryArtifact {
  path: string;
  kind: 'context' | 'contract' | 'contract-notes' | 'validation' | 'run-log' | 'evidence' | 'stdout' | 'stderr' | 'prompt' | 'other';
  exists: boolean;
  size_bytes?: number;
  modified_at?: string;
}

export interface AgentFactoryWorkflowStep {
  state: AgentFactoryAduState;
  label: string;
  status: 'complete' | 'current' | 'pending' | 'blocked' | 'failed';
  agent?: string;
  run_timestamp?: string;
  result?: string;
}

export interface AgentFactoryAduView extends AgentFactoryAdu {
  next_agent: string | null;
  latest_run: AgentFactoryRun | null;
  runs: AgentFactoryRun[];
  workflow: AgentFactoryWorkflowStep[];
  artifact_status: AgentFactoryArtifact[];
  health: {
    status: 'healthy' | 'active' | 'blocked' | 'stale' | 'failed';
    reasons: string[];
  };
}

export interface AgentFactoryAgentView {
  id: string;
  description: string;
  prompt: string;
  worktree: boolean;
  hermes_args: string[];
  total_runs: number;
  success_runs: number;
  failed_runs: number;
  unstructured_runs: number;
  latest_run: AgentFactoryRun | null;
  active_adu_ids: string[];
  status: 'idle' | 'active' | 'failed' | 'stale';
}

export interface AgentFactoryDashboard {
  generated_at: string;
  workspace: string;
  registry_valid: boolean;
  summary: {
    total_adus: number;
    active_adus: number;
    evidenced_adus: number;
    human_gate_adus: number;
    total_runs: number;
    success_runs: number;
    failed_runs: number;
    unstructured_runs: number;
    missing_artifacts: number;
  };
  adus: AgentFactoryAduView[];
  agents: AgentFactoryAgentView[];
  recent_runs: AgentFactoryRun[];
}
```

### Repository Interface

File: `open5gs-nms/backend/src/domain/interfaces/agent-factory-repository.ts`

```ts
import {
  AgentFactoryAdu,
  AgentFactoryAgentConfig,
  AgentFactoryArtifact,
  AgentFactoryRun,
} from '../entities/agent-factory';

export interface AgentFactoryRepository {
  getWorkspaceRoot(): string;
  readAdus(): Promise<AgentFactoryAdu[]>;
  readAgents(): Promise<Record<string, AgentFactoryAgentConfig>>;
  readRuns(): Promise<AgentFactoryRun[]>;
  listArtifacts(paths: string[]): Promise<AgentFactoryArtifact[]>;
  listRunFiles(runDir: string): Promise<AgentFactoryArtifact[]>;
  readTextArtifact(path: string, maxBytes: number): Promise<{ path: string; content: string; truncated: boolean }>;
}
```

### File Repository Behavior

File: `open5gs-nms/backend/src/infrastructure/agent-factory/file-agent-factory-repository.ts`

Responsibilities:

| Method | Behavior |
| --- | --- |
| `readAdus()` | Read `.ai-agent/registry/adu.json`, return `adus`. If missing, return empty array and let use case mark registry invalid. |
| `readAgents()` | Read `.ai-agent/registry/agents.json`, return `agents`. |
| `readRuns()` | Read `.ai-agent/registry/runs.json`, return `runs`. |
| `listArtifacts(paths)` | For each relative path, stat it under workspace root and classify kind. |
| `listRunFiles(runDir)` | Return `prompt.md`, `stdout.md`, `stderr.md`, and any files in run directory. |
| `readTextArtifact(path, maxBytes)` | Read only relative paths inside workspace root; reject `..` traversal; cap response to `maxBytes`. |

Path safety rules:

```ts
const resolved = path.resolve(workspaceRoot, relativePath);
if (!resolved.startsWith(workspaceRoot + path.sep)) {
  throw new Error('Artifact path escapes workspace root');
}
```

### Use Case Design

File: `open5gs-nms/backend/src/application/use-cases/agent-factory-monitor.ts`

Main class:

```ts
export class AgentFactoryMonitorUseCase {
  constructor(private readonly repo: AgentFactoryRepository) {}

  async getDashboard(): Promise<AgentFactoryDashboard>;
  async getAdu(aduId: string): Promise<AgentFactoryAduView | null>;
  async getRuns(filter?: { aduId?: string; agent?: string; limit?: number }): Promise<AgentFactoryRun[]>;
  async getArtifact(path: string): Promise<{ path: string; content: string; truncated: boolean }>;
}
```

Workflow step order:

```ts
const WORKFLOW = [
  { state: 'created', label: 'Created', agent: 'context-pack' },
  { state: 'contexted', label: 'Context', agent: 'contract' },
  { state: 'contracted', label: 'Contract', agent: 'testwriter' },
  { state: 'test_red', label: 'Test Red', agent: 'developer' },
  { state: 'implemented', label: 'Implemented', agent: 'buildfix-debugger' },
  { state: 'debugged', label: 'Debugged', agent: 'evidence' },
  { state: 'evidenced', label: 'Evidence', agent: null },
];
```

Next Agent mapping:

```ts
const NEXT_AGENT_BY_STATE: Record<string, string | null> = {
  created: 'context-pack',
  contexted: 'contract',
  contracted: 'testwriter',
  test_red: 'developer',
  implemented: 'buildfix-debugger',
  debugged: 'evidence',
  evidenced: null,
  human_gate: null,
};
```

Health rules:

| Condition | Health |
| --- | --- |
| `human_gate_required === true` or state `human_gate` | `blocked` |
| latest run result `failed` or `unstructured` | `failed` |
| state not terminal and no run for ADU | `active` |
| state not terminal and latest run older than 30 minutes | `stale` |
| state `evidenced` or `mvp_ready` | `healthy` |

Summary rules:

| Field | Calculation |
| --- | --- |
| `active_adus` | ADUs not in `evidenced`, `mvp_ready`, `human_gate`. |
| `evidenced_adus` | ADUs in `evidenced` or `mvp_ready`. |
| `human_gate_adus` | ADUs with `human_gate_required` or state `human_gate`. |
| `success_runs` | runs where `result === "success"`. |
| `failed_runs` | runs where `returncode !== 0` or `result === "failed"`. |
| `unstructured_runs` | runs where `result === "unstructured"` or `parsed_result === null`. |
| `missing_artifacts` | artifact entries where `exists === false`. |

### REST API

File: `open5gs-nms/backend/src/interfaces/rest/agent-factory-controller.ts`

Routes:

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/api/agent-factory/dashboard` | `AgentFactoryDashboard` |
| `GET` | `/api/agent-factory/adus` | `AgentFactoryAduView[]` |
| `GET` | `/api/agent-factory/adus/:id` | `AgentFactoryAduView` |
| `GET` | `/api/agent-factory/agents` | `AgentFactoryAgentView[]` |
| `GET` | `/api/agent-factory/runs?aduId=&agent=&limit=` | `AgentFactoryRun[]` |
| `GET` | `/api/agent-factory/artifacts?path=` | `{ path, content, truncated }` |

Controller rules:

- All routes are authenticated because they are registered under `/api`.
- Artifact content endpoint returns text only.
- `maxBytes` defaults to `100000`.
- Artifact path must be query-encoded and relative to `/Users/hill/open5gs`.
- Controller returns `404` for unknown ADU or missing artifact.
- Controller returns `400` for path traversal attempts.

### WebSocket Events

Reuse the existing backend WebSocket server. Add a polling broadcaster in `index.ts` that emits dashboard snapshots every 3 seconds when state changes.

Event:

```json
{
  "type": "agent_factory_status",
  "payload": {
    "generated_at": "2026-06-07T16:20:00.000Z",
    "summary": {
      "total_adus": 2,
      "active_adus": 1,
      "evidenced_adus": 1,
      "human_gate_adus": 0,
      "total_runs": 6,
      "success_runs": 6,
      "failed_runs": 0,
      "unstructured_runs": 0,
      "missing_artifacts": 0
    }
  }
}
```

Implementation options:

1. Extend `WssBroadcaster` with a generic `broadcast(type, payload)` method if not already available.
2. If the existing broadcaster is service-specific, create `AgentFactoryStatusPoller` that uses `wss.clients.forEach`.

First version can use REST polling every 5 seconds if WebSocket integration is risky. The design still includes WebSocket as the target.

### Backend Config

Modify `open5gs-nms/backend/src/config/app-config.ts` to add:

```ts
agentFactoryWorkspace: process.env.AGENT_FACTORY_WORKSPACE || '/Users/hill/open5gs',
agentFactoryPollIntervalMs: Number(process.env.AGENT_FACTORY_POLL_INTERVAL_MS || 3000),
agentFactoryArtifactMaxBytes: Number(process.env.AGENT_FACTORY_ARTIFACT_MAX_BYTES || 100000),
```

## Frontend Design

### Frontend File Structure

Create:

```text
open5gs-nms/frontend/src/types/agent-factory.ts
open5gs-nms/frontend/src/api/agentFactory.ts
open5gs-nms/frontend/src/stores/agentFactory.ts
open5gs-nms/frontend/src/components/agent-factory/AgentFactoryPage.tsx
open5gs-nms/frontend/src/components/agent-factory/SummaryStrip.tsx
open5gs-nms/frontend/src/components/agent-factory/AduQueuePanel.tsx
open5gs-nms/frontend/src/components/agent-factory/AgentLanePanel.tsx
open5gs-nms/frontend/src/components/agent-factory/WorkflowTimeline.tsx
open5gs-nms/frontend/src/components/agent-factory/RunHistoryTable.tsx
open5gs-nms/frontend/src/components/agent-factory/ArtifactDrawer.tsx
open5gs-nms/frontend/src/components/agent-factory/HealthBadge.tsx
```

Modify:

```text
open5gs-nms/frontend/src/App.tsx
open5gs-nms/frontend/src/components/common/Layout.tsx
open5gs-nms/frontend/src/hooks/useWebSocket.ts
```

### Frontend Types

File: `open5gs-nms/frontend/src/types/agent-factory.ts`

Use frontend equivalents of backend interfaces. Keep fields snake_case where registry data is snake_case to avoid transform bugs.

```ts
export type AgentFactoryHealth = 'healthy' | 'active' | 'blocked' | 'stale' | 'failed';

export interface AgentFactoryRun {
  timestamp: string;
  adu_id: string;
  agent: string;
  returncode: number;
  result: string;
  run_dir: string;
  parsed_result: {
    result?: string;
    next_state?: string;
    changed_files?: string[];
    commands_run?: Array<string | { command: string; result?: string }>;
    artifacts?: string[];
    risks?: string[];
    next_agent?: string | null;
  } | null;
}

export interface AgentFactoryArtifact {
  path: string;
  kind: string;
  exists: boolean;
  size_bytes?: number;
  modified_at?: string;
}

export interface AgentFactoryWorkflowStep {
  state: string;
  label: string;
  status: 'complete' | 'current' | 'pending' | 'blocked' | 'failed';
  agent?: string;
  run_timestamp?: string;
  result?: string;
}

export interface AgentFactoryAduView {
  id: string;
  title: string;
  goal: string;
  state: string;
  retry_count: number;
  max_retries: number;
  risk: string;
  target_level: string;
  allowed_read_paths: string[];
  allowed_write_paths: string[];
  required_commands: string[];
  required_evidence: string[];
  artifacts: string[];
  human_gate_required: boolean;
  next_agent: string | null;
  latest_run: AgentFactoryRun | null;
  runs: AgentFactoryRun[];
  workflow: AgentFactoryWorkflowStep[];
  artifact_status: AgentFactoryArtifact[];
  health: {
    status: AgentFactoryHealth;
    reasons: string[];
  };
}

export interface AgentFactoryAgentView {
  id: string;
  description: string;
  prompt: string;
  worktree: boolean;
  hermes_args: string[];
  total_runs: number;
  success_runs: number;
  failed_runs: number;
  unstructured_runs: number;
  latest_run: AgentFactoryRun | null;
  active_adu_ids: string[];
  status: 'idle' | 'active' | 'failed' | 'stale';
}

export interface AgentFactoryDashboard {
  generated_at: string;
  workspace: string;
  registry_valid: boolean;
  summary: {
    total_adus: number;
    active_adus: number;
    evidenced_adus: number;
    human_gate_adus: number;
    total_runs: number;
    success_runs: number;
    failed_runs: number;
    unstructured_runs: number;
    missing_artifacts: number;
  };
  adus: AgentFactoryAduView[];
  agents: AgentFactoryAgentView[];
  recent_runs: AgentFactoryRun[];
}
```

### API Client

File: `open5gs-nms/frontend/src/api/agentFactory.ts`

```ts
import axios from 'axios';
import type { AgentFactoryDashboard, AgentFactoryRun } from '../types/agent-factory';

export async function fetchAgentFactoryDashboard(): Promise<AgentFactoryDashboard> {
  const { data } = await axios.get<AgentFactoryDashboard>('/api/agent-factory/dashboard');
  return data;
}

export async function fetchAgentFactoryRuns(params: {
  aduId?: string;
  agent?: string;
  limit?: number;
}): Promise<AgentFactoryRun[]> {
  const { data } = await axios.get<AgentFactoryRun[]>('/api/agent-factory/runs', { params });
  return data;
}

export async function fetchAgentFactoryArtifact(path: string): Promise<{
  path: string;
  content: string;
  truncated: boolean;
}> {
  const { data } = await axios.get('/api/agent-factory/artifacts', { params: { path } });
  return data;
}
```

### Zustand Store

File: `open5gs-nms/frontend/src/stores/agentFactory.ts`

State:

```ts
interface AgentFactoryState {
  dashboard: AgentFactoryDashboard | null;
  selectedAduId: string | null;
  selectedArtifactPath: string | null;
  artifactContent: string | null;
  artifactTruncated: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setDashboard: (dashboard: AgentFactoryDashboard) => void;
  selectAdu: (aduId: string) => void;
  openArtifact: (path: string) => Promise<void>;
  closeArtifact: () => void;
}
```

Store behavior:

- `refresh()` calls `/api/agent-factory/dashboard`.
- `setDashboard()` is used by WebSocket updates.
- If selected ADU disappears, select first active ADU.
- `openArtifact()` fetches artifact text and opens drawer.

### Page Layout

Page: `AgentFactoryPage`

Visual layout:

```text
┌────────────────────────────────────────────────────────────────────┐
│ Summary Strip: ADUs | Active | Evidenced | Human Gate | Runs | Fail │
├───────────────────────┬────────────────────────────────────────────┤
│ ADU Queue             │ Selected Requirement Details                │
│ - REQ-MVP-004 active  │ WorkflowTimeline                            │
│ - REQ-MVP-001 done    │ AgentLanePanel                              │
│                       │ RunHistoryTable                             │
│                       │ Artifact list                               │
└───────────────────────┴────────────────────────────────────────────┘
```

UI rules:

- Dense operational layout; no hero section.
- Use existing `nms-card`, `nms-btn`, `nms-input` classes.
- Use lucide icons: `Bot`, `Workflow`, `Activity`, `CheckCircle`, `AlertTriangle`, `Clock`, `FileText`, `Terminal`, `PackageCheck`.
- No nested cards. Use side-by-side panels and tables.
- Auto-refresh every 5 seconds through store; WebSocket updates can override immediately.

### Components

| Component | Responsibility |
| --- | --- |
| `SummaryStrip` | Shows KPI counters and registry health. |
| `AduQueuePanel` | Left-side list of ADUs, state badges, retry count, next Agent. |
| `WorkflowTimeline` | Shows current state flow for selected ADU. |
| `AgentLanePanel` | Shows all Agents, latest run status, active ADUs, success/failure counts. |
| `RunHistoryTable` | Shows recent runs for selected ADU or all ADUs. |
| `ArtifactDrawer` | Shows text artifact content with path, size, truncation status. |
| `HealthBadge` | Consistent color and label for `healthy`, `active`, `blocked`, `stale`, `failed`. |

### Navigation

Modify `Layout.tsx`:

- Import `Bot` or `Workflow` from `lucide-react`.
- Add nav item:

```ts
{ id: 'agent-factory', label: 'Agent Factory', icon: Bot }
```

Modify `App.tsx`:

```ts
import { AgentFactoryPage } from './components/agent-factory/AgentFactoryPage';
```

Add switch case:

```tsx
case 'agent-factory':
  return <AgentFactoryPage />;
```

### WebSocket Hook

Modify `useWebSocket.ts`:

```ts
if (msg.type === 'agent_factory_status') {
  useAgentFactoryStore.getState().setDashboard(msg.payload);
}
```

If hooks cannot import stores directly under current lint rules, create `handleRealtimeMessage(msg)` in `stores/realtime.ts` and call it from the hook.

## Backend Implementation Tasks

### Task 1: Add Backend Domain Types

**Files:**
- Create: `open5gs-nms/backend/src/domain/entities/agent-factory.ts`
- Create: `open5gs-nms/backend/src/domain/interfaces/agent-factory-repository.ts`

- [ ] **Step 1: Add entity interfaces**

Create `agent-factory.ts` with the interfaces listed in the Backend Domain Types section.

- [ ] **Step 2: Add repository interface**

Create `agent-factory-repository.ts` with the repository interface listed above.

- [ ] **Step 3: Build backend**

Run:

```bash
cd open5gs-nms/backend && npm run build
```

Expected: TypeScript build succeeds.

### Task 2: Add File Repository

**Files:**
- Create: `open5gs-nms/backend/src/infrastructure/agent-factory/file-agent-factory-repository.ts`

- [ ] **Step 1: Implement path-safe file reader**

Implement repository using `fs/promises`, `path`, and the path safety rules in this plan.

- [ ] **Step 2: Classify artifacts**

Classification rules:

| Path pattern | Kind |
| --- | --- |
| `.ai-agent/context-packs/` | `context` |
| `.ai-agent/contracts/*-notes.md` | `contract-notes` |
| `.ai-agent/contracts/` | `contract` |
| `tests/ai-agent-mvp/` | `validation` |
| `.ai-agent/evidence/` | `evidence` |
| `stdout.md` | `stdout` |
| `stderr.md` | `stderr` |
| `prompt.md` | `prompt` |
| `.ai-agent/runs/` | `run-log` |

- [ ] **Step 3: Build backend**

Run:

```bash
cd open5gs-nms/backend && npm run build
```

Expected: TypeScript build succeeds.

### Task 3: Add Monitor Use Case

**Files:**
- Create: `open5gs-nms/backend/src/application/use-cases/agent-factory-monitor.ts`

- [ ] **Step 1: Implement dashboard aggregation**

Use these inputs:

```ts
const [adus, agents, runs] = await Promise.all([
  repo.readAdus(),
  repo.readAgents(),
  repo.readRuns(),
]);
```

Compute:

- `next_agent`;
- `latest_run`;
- per-ADU runs;
- workflow steps;
- artifact statuses;
- health;
- summary counters;
- agent views.

- [ ] **Step 2: Sort recent runs**

Sort by timestamp descending:

```ts
const recentRuns = [...runs].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 50);
```

- [ ] **Step 3: Build backend**

Run:

```bash
cd open5gs-nms/backend && npm run build
```

Expected: TypeScript build succeeds.

### Task 4: Add REST Controller

**Files:**
- Create: `open5gs-nms/backend/src/interfaces/rest/agent-factory-controller.ts`

- [ ] **Step 1: Implement router**

Router factory signature:

```ts
export function createAgentFactoryRouter(
  monitor: AgentFactoryMonitorUseCase,
  logger: pino.Logger,
): Router
```

Routes:

```ts
router.get('/dashboard', asyncHandler(...));
router.get('/adus', asyncHandler(...));
router.get('/adus/:id', asyncHandler(...));
router.get('/agents', asyncHandler(...));
router.get('/runs', asyncHandler(...));
router.get('/artifacts', asyncHandler(...));
```

- [ ] **Step 2: Validate query params**

Use simple inline validation:

- `limit`: integer 1-200, default 50.
- `path`: required for artifacts.
- `aduId` and `agent`: optional strings.

- [ ] **Step 3: Build backend**

Run:

```bash
cd open5gs-nms/backend && npm run build
```

Expected: TypeScript build succeeds.

### Task 5: Wire Backend in `index.ts`

**Files:**
- Modify: `open5gs-nms/backend/src/index.ts`
- Modify: `open5gs-nms/backend/src/config/app-config.ts`

- [ ] **Step 1: Add config fields**

Add `agentFactoryWorkspace`, `agentFactoryPollIntervalMs`, and `agentFactoryArtifactMaxBytes` to app config.

- [ ] **Step 2: Instantiate repository and use case**

In `index.ts` near other use case initialization:

```ts
const agentFactoryRepo = new FileAgentFactoryRepository(
  config.agentFactoryWorkspace,
  config.agentFactoryArtifactMaxBytes,
  logger,
);
const agentFactoryMonitorUseCase = new AgentFactoryMonitorUseCase(agentFactoryRepo);
```

- [ ] **Step 3: Register router**

After auth middleware:

```ts
app.use('/api/agent-factory', createAgentFactoryRouter(agentFactoryMonitorUseCase, logger));
```

- [ ] **Step 4: Build backend**

Run:

```bash
cd open5gs-nms/backend && npm run build
```

Expected: TypeScript build succeeds.

## Frontend Implementation Tasks

### Task 6: Add Frontend Types and API Client

**Files:**
- Create: `open5gs-nms/frontend/src/types/agent-factory.ts`
- Create: `open5gs-nms/frontend/src/api/agentFactory.ts`

- [ ] **Step 1: Add types**

Create the frontend types from the Frontend Types section.

- [ ] **Step 2: Add API client**

Create the API client from the API Client section.

- [ ] **Step 3: Build frontend**

Run:

```bash
cd open5gs-nms/frontend && npm run build
```

Expected: TypeScript and Vite build succeeds.

### Task 7: Add Zustand Store

**Files:**
- Create: `open5gs-nms/frontend/src/stores/agentFactory.ts`
- Modify: `open5gs-nms/frontend/src/stores/index.ts`

- [ ] **Step 1: Implement store**

Implement the store behavior from the Zustand Store section.

- [ ] **Step 2: Export store**

Add export to `stores/index.ts`:

```ts
export * from './agentFactory';
```

- [ ] **Step 3: Build frontend**

Run:

```bash
cd open5gs-nms/frontend && npm run build
```

Expected: TypeScript and Vite build succeeds.

### Task 8: Add Dashboard Components

**Files:**
- Create: `open5gs-nms/frontend/src/components/agent-factory/HealthBadge.tsx`
- Create: `open5gs-nms/frontend/src/components/agent-factory/SummaryStrip.tsx`
- Create: `open5gs-nms/frontend/src/components/agent-factory/AduQueuePanel.tsx`
- Create: `open5gs-nms/frontend/src/components/agent-factory/WorkflowTimeline.tsx`
- Create: `open5gs-nms/frontend/src/components/agent-factory/AgentLanePanel.tsx`
- Create: `open5gs-nms/frontend/src/components/agent-factory/RunHistoryTable.tsx`
- Create: `open5gs-nms/frontend/src/components/agent-factory/ArtifactDrawer.tsx`

- [ ] **Step 1: Implement `HealthBadge`**

Health colors:

| Status | Classes |
| --- | --- |
| `healthy` | `bg-nms-green/10 text-nms-green border-nms-green/30` |
| `active` | `bg-nms-accent/10 text-nms-accent border-nms-accent/30` |
| `blocked` | `bg-amber-500/10 text-amber-400 border-amber-500/30` |
| `stale` | `bg-slate-500/10 text-slate-300 border-slate-500/30` |
| `failed` | `bg-nms-red/10 text-nms-red border-nms-red/30` |

- [ ] **Step 2: Implement summary and panels**

Use existing `nms-card` styles. Keep panels compact and table-oriented.

- [ ] **Step 3: Implement artifact drawer**

Drawer behavior:

- Opens from the right.
- Shows path, truncated badge, monospace content.
- Supports close button with `X` icon.
- Uses `max-h-[80vh] overflow-auto`.

- [ ] **Step 4: Build frontend**

Run:

```bash
cd open5gs-nms/frontend && npm run build
```

Expected: TypeScript and Vite build succeeds.

### Task 9: Add `AgentFactoryPage`

**Files:**
- Create: `open5gs-nms/frontend/src/components/agent-factory/AgentFactoryPage.tsx`

- [ ] **Step 1: Implement page load**

On mount:

```ts
useEffect(() => {
  void refresh();
  const timer = setInterval(() => void refresh(), 5000);
  return () => clearInterval(timer);
}, [refresh]);
```

- [ ] **Step 2: Render loading and error states**

Loading state:

```tsx
<div className="p-6 text-sm text-nms-text-dim">Loading Agent Factory state...</div>
```

Error state:

```tsx
<div className="nms-card border-nms-red/30 text-nms-red">{error}</div>
```

- [ ] **Step 3: Render main dashboard**

Layout:

```tsx
<div className="p-6 space-y-4">
  <SummaryStrip dashboard={dashboard} />
  <div className="grid grid-cols-12 gap-4">
    <div className="col-span-12 xl:col-span-4">
      <AduQueuePanel ... />
    </div>
    <div className="col-span-12 xl:col-span-8 space-y-4">
      <WorkflowTimeline ... />
      <AgentLanePanel ... />
      <RunHistoryTable ... />
    </div>
  </div>
  <ArtifactDrawer ... />
</div>
```

- [ ] **Step 4: Build frontend**

Run:

```bash
cd open5gs-nms/frontend && npm run build
```

Expected: TypeScript and Vite build succeeds.

### Task 10: Wire Navigation and Realtime Updates

**Files:**
- Modify: `open5gs-nms/frontend/src/App.tsx`
- Modify: `open5gs-nms/frontend/src/components/common/Layout.tsx`
- Modify: `open5gs-nms/frontend/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Add nav item**

In `Layout.tsx`, import:

```ts
Bot
```

from `lucide-react`.

Add:

```ts
{ id: 'agent-factory', label: 'Agent Factory', icon: Bot }
```

- [ ] **Step 2: Add page route**

In `App.tsx`, import and switch:

```tsx
import { AgentFactoryPage } from './components/agent-factory/AgentFactoryPage';
```

```tsx
case 'agent-factory':
  return <AgentFactoryPage />;
```

- [ ] **Step 3: Add WebSocket handling**

In `useWebSocket.ts`, process:

```ts
if (msg.type === 'agent_factory_status') {
  useAgentFactoryStore.getState().setDashboard(msg.payload);
}
```

- [ ] **Step 4: Build frontend**

Run:

```bash
cd open5gs-nms/frontend && npm run build
```

Expected: TypeScript and Vite build succeeds.

## API Acceptance Examples

After backend is running and authenticated session is available:

```bash
curl http://127.0.0.1:<backend-port>/api/agent-factory/dashboard
```

Expected response contains:

```json
{
  "summary": {
    "total_adus": 2,
    "evidenced_adus": 1,
    "total_runs": 6,
    "success_runs": 6
  }
}
```

Artifact request:

```bash
curl "http://127.0.0.1:<backend-port>/api/agent-factory/artifacts?path=.ai-agent/evidence/REQ-MVP-001.json"
```

Expected response:

```json
{
  "path": ".ai-agent/evidence/REQ-MVP-001.json",
  "content": "{ ... }",
  "truncated": false
}
```

## UI Acceptance Criteria

Dashboard must show:

- `REQ-MVP-001` as `evidenced` / healthy.
- `REQ-MVP-004` as `created` / active.
- Six successful runs for `REQ-MVP-001`.
- Agent cards for `context-pack`, `contract`, `testwriter`, `developer`, `buildfix-debugger`, `evidence`.
- Workflow timeline with completed steps for `REQ-MVP-001`.
- Artifact drawer can open `.ai-agent/evidence/REQ-MVP-001.json`.
- Missing artifact count is `0` for `REQ-MVP-001`.
- Human gate count is `0` for current registry.

## Test Plan

### Backend

Run:

```bash
cd open5gs-nms/backend && npm run build
```

Expected: build succeeds.

Manual API checks:

```bash
curl -s http://127.0.0.1:<backend-port>/api/agent-factory/dashboard | jq '.summary'
curl -s "http://127.0.0.1:<backend-port>/api/agent-factory/runs?aduId=REQ-MVP-001" | jq 'length'
```

Expected:

```text
summary exists
run length is 6
```

### Frontend

Run:

```bash
cd open5gs-nms/frontend && npm run build
```

Expected: build succeeds.

Visual checks:

- Sidebar contains `Agent Factory`.
- Page uses dense operational layout.
- Text fits in cards and table cells.
- No overlapping panels at desktop width.
- At mobile width, ADU queue stacks above details.

## Security and Safety

| Risk | Mitigation |
| --- | --- |
| Path traversal through artifact endpoint | Resolve path under workspace root and reject escapes. |
| Leaking secrets from arbitrary files | Only allow artifact reads from `.ai-agent/`, `tests/ai-agent-mvp/`, and known run directories. |
| Accidentally enabling command execution | First dashboard version has no run/retry/start buttons. |
| Large artifact responses | Cap artifact reads to configured max bytes. |
| Unauthenticated visibility | Register routes under existing `/api` auth middleware. |

## Future Extensions

Add only after read-only dashboard is stable:

| Extension | Trigger |
| --- | --- |
| Run/retry button | Approval and command execution policy exists. |
| Live Hermes stdout | Hermes runner writes streaming events. |
| ADU editor | Schema validation and audit logging exist. |
| Human gate approval UI | Role-based approval model exists. |
| Multi-workspace selector | More than one Agent factory workspace exists. |

## Final Acceptance Checklist

- [ ] Backend exposes `/api/agent-factory/dashboard`.
- [ ] Backend exposes `/api/agent-factory/runs`.
- [ ] Backend exposes path-safe artifact reading.
- [ ] Frontend sidebar contains `Agent Factory`.
- [ ] Dashboard displays current ADUs.
- [ ] Dashboard displays Agent run states.
- [ ] Dashboard displays workflow state for selected ADU.
- [ ] Dashboard opens evidence artifact content.
- [ ] Backend build passes.
- [ ] Frontend build passes.
- [ ] No write or command-execution action exists in the UI.

When every checklist item passes, the monitoring dashboard is ready for MVP operations.

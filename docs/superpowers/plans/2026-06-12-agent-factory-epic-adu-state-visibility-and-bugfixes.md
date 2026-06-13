# Agent Factory Epic/ADU State Visibility And Remaining Bugfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent Factory 当前调试暴露出的状态显示、流程反馈、质量门、Human Gate、写路径授权等遗留问题，使 Epic 和 ADU 的真实运行状态、失败原因、人工处置结果可以在独立 Dashboard 中稳定、准确、可操作地呈现。

**Architecture:** 以“后端统一事实源 + 前端只消费标准化状态”为核心：后端聚合 Epic/ADU/Run/HumanGate/QualityGate 的可显示视图，前端不再用 `human_gate_required`、旧 run、局部推断来判断阻塞。Epic/ADU 编排操作从“只返回 dispatched”升级为“返回 operationId + 可轮询运行状态 + 事件流”，避免按钮点击后页面无变化。

**Tech Stack:** TypeScript/Express backend, React/Zustand frontend, Python Hermes runner/orchestrators, JSON registry files under `.ai-agent/registry`, project artifacts under `<repo>/.ai-agent`.

---

## 0. 当前版本画像

### 0.1 独立 Dashboard 代码范围

- 后端：`agent-factory-dashboard/backend/src`
- 前端：`agent-factory-dashboard/frontend/src`
- Python runner/orchestrator：`scripts/hermes_agent_run.py`, `scripts/hermes_agent_orchestrator.py`, `scripts/hermes_epic_orchestrator.py`
- Registry：
  - `.ai-agent/registry/adu.json`
  - `.ai-agent/registry/runs.json`
  - `.ai-agent/registry/epics.json`
  - `.ai-agent/registry/agent-model-settings.json`
- 项目侧产物：`<repo>/.ai-agent/**`

### 0.2 当前确认的真实运行状态

以 `EPIC-2026-6603` 为例：

- 4 个子 ADU 均已 `evidenced`：
  - `ADU-6603-001`
  - `ADU-6603-002`
  - `ADU-6603-003`
  - `ADU-6603-004`
- Epic 已进入 `epic_evidenced`
- Epic 验收产物：
  - `open5gs/.ai-agent/epics/EPIC-2026-6603/epic-acceptance.json`
  - `open5gs/.ai-agent/epics/EPIC-2026-6603/epic-acceptance.md`
- `validate_epic_acceptance.py` 对上述 JSON 校验通过。

### 0.3 当前暴露的问题汇总

| ID | 优先级 | 问题 | 影响 |
|---|---|---|---|
| BUG-001 | P0 | Epic 点击“继续自动”后页面看不出状态转换 | 用户无法知道按钮是否生效、Agent 是否启动、是否失败、是否完成 |
| BUG-002 | P0 | ADU Requirements Queue 中已完成 ADU 仍显示 `Blocked` | 终态 ADU 被错误标红，影响验收判断 |
| BUG-003 | P0 | Orchestrator API 返回 dispatched 后不暴露子进程最终结果 | 后端实际失败时前端仍显示“提交成功” |
| BUG-004 | P0 | Hermes 因日志目录权限失败时 stderr 不在页面突出显示 | 运行失败被误认为“页面无变化” |
| BUG-005 | P1 | `allowed_write_paths` 静态授权模型反复阻塞开发 | detail-designer/developer/code-reviewer 之间授权不同步 |
| BUG-006 | P1 | Human Gate 处置类型过少 | 环境问题、风险接受、外部依赖、补证据、返工等无法统一处理 |
| BUG-007 | P1 | Quality Gate 失败类型没有结构化展示 | `failed`、`unstructured`、`invalid_final_json`、validator fail 混在一起 |
| BUG-008 | P1 | Epic 页面不是完整闭环操作台 | 子 ADU 审核、异常、质量报告仍要跳到 ADU 页面处理 |
| BUG-009 | P2 | 需求分析阶段澄清问题生命周期不完整 | 分析 Agent 提出的问题没有标准化进入澄清/返工/继承流程 |

---

## 1. 目标行为

### 1.1 Epic 状态转换必须可见

用户点击 Epic 控制面板按钮后，页面必须立即显示：

1. 操作已创建：`operationId`
2. 当前运行阶段：例如 `starting`, `running`, `waiting_for_agent`, `validating`, `completed`, `failed`
3. 当前 Agent：例如 `system-flow-designer`, `adu-splitter`, `epic-acceptance-reviewer`
4. 最新事件流：至少显示最近 20 条 Epic orchestration events
5. 最终结果：
   - 成功：显示新 state，例如 `epic_evidenced`
   - 失败：显示 stderr / validator error / missing artifact / permission error

### 1.2 ADU Queue 阻塞标识必须以 `health.status` 为准

ADU Queue 中不允许再直接用 `human_gate_required` 渲染 `Blocked`。

显示规则：

| ADU state | health.status | Queue 显示 |
|---|---|---|
| `evidenced` | `healthy` | Completed/Healthy |
| `mvp_ready` | `healthy` | Completed/Healthy |
| `human_gate` | `blocked` | Blocked |
| 最新 run failed | `failed` | Failed |
| orchestrator active | `running` | Running |
| 普通中间态 | `active/stale` | Active/Stale |

`human_gate_required` 只能作为“该 ADU 允许或曾经需要人工门”的配置/历史信息，不能作为当前阻塞状态。

### 1.3 编排 API 不能假成功

现状：`POST /epics/:id/continue` spawn 子进程后马上返回 `{ success: true, message: "... dispatched" }`。这只能说明“进程已派发”，不能说明“流程成功”。

目标：

- API 返回 `operationId`
- 后端保存 operation 状态
- 子进程退出后写入 operation final result
- 前端在控制面板显示 operation 状态，不把 dispatched 当作 completed

### 1.4 质量门和 Human Gate 必须结构化

质量门失败必须能区分：

- Agent 执行失败：Hermes returncode 非 0
- Agent 输出非结构化：没有最终 JSON block
- Agent 输出 JSON 语法错误：`invalid_final_json`
- Agent 生成报告但 validator 失败：`validator_failed`
- 环境类断言被人工豁免：`waived_by_environment`
- 真实验收失败：`acceptance_rework`

---

## 2. 文件改造总览

### 2.1 后端新增/修改

- Create: `agent-factory-dashboard/backend/src/domain/orchestration-operation.ts`
  - 定义通用 operation 类型。
- Create: `agent-factory-dashboard/backend/src/application/orchestration-operation-store.ts`
  - 内存保存当前/历史 operation，后续可持久化。
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
  - ADU/Epic 编排 API 返回 `operationId`。
  - 增加 operation 查询 API。
  - 捕获 stdout/stderr 并写入 operation events。
- Modify: `agent-factory-dashboard/backend/src/application/epic-monitor.ts`
  - `getEpicDashboard()` 输出标准化 Epic phase/progress/last_operation。
  - 修复 summary 与 state 聚合保存策略。
- Modify: `agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts`
  - 输出 `display_status`，统一 Queue/详情页口径。
  - 终态优先，清理 stale human gate 标记影响。
- Modify: `agent-factory-dashboard/backend/src/domain/agent-factory.ts`
  - 扩展 ADU/Epic view 类型。
- Modify: `scripts/hermes_epic_orchestrator.py`
  - 保证所有状态转换、Agent 开始/结束、validator 失败、权限错误都输出 NDJSON。
  - `continue` 模式在 `child_adus_evidenced` 后执行 `epic-acceptance-reviewer` 时，必须保存中间态 `epic_acceptance`。
- Modify: `scripts/hermes_agent_run.py`
  - 将 Hermes CLI 权限错误、validator 错误、JSON 解析错误写入结构化 `run_record.failure`.
- Modify: `scripts/validate_quality_report.py`
  - 保留已修复的 environment waiver 支持，并补齐回归测试。

### 2.2 前端新增/修改

- Create: `agent-factory-dashboard/frontend/src/components/shared/OperationStatusPanel.tsx`
  - 统一展示 ADU/Epic 操作状态、事件流、stderr。
- Modify: `agent-factory-dashboard/frontend/src/stores/agentFactory.ts`
  - 保存 active operations。
  - 控制操作后立即拉取 operation。
  - 定时轮询 active operation，完成后刷新 dashboard/epic DAG。
- Modify: `agent-factory-dashboard/frontend/src/api/agentFactory.ts`
  - 增加 `getOperation(operationId)`。
  - start/continue/step 返回 operation payload。
- Modify: `agent-factory-dashboard/frontend/src/components/epics/EpicControlPanel.tsx`
  - 显示 operation status，不再只显示“请求已提交”。
  - 终态按钮禁用原因可见。
- Modify: `agent-factory-dashboard/frontend/src/components/epics/EpicsPage.tsx`
  - WebSocket event 或 operation polling 到达时立即刷新，不只依赖 5 秒轮询。
- Modify: `agent-factory-dashboard/frontend/src/components/epics/EpicDagView.tsx`
  - 显示 Epic 自身阶段：`child_adus_evidenced`, `epic_acceptance`, `epic_evidenced`。
- Modify: `agent-factory-dashboard/frontend/src/components/agent-factory/AduQueuePanel.tsx`
  - 删除 `human_gate_required` 直接显示 `Blocked` 的逻辑。
  - 使用 `adu.display_status` 或 `adu.health.status`。
- Modify: `agent-factory-dashboard/frontend/src/components/agent-factory/HealthBadge.tsx`
  - 增加 `completed`, `waived`, `validator_failed`, `invalid_output` 等可读状态或 tooltip。

### 2.3 测试新增/修改

- Create: `agent-factory-dashboard/backend/tools/test-orchestration-operation.js`
- Modify: `agent-factory-dashboard/backend/tools/test-epic-dag.js`
- Modify: `agent-factory-dashboard/backend/tools/test-quality-gates.js`
- Modify: `scripts/test_validate_quality_report.py`
- Create: `agent-factory-dashboard/frontend/src/components/agent-factory/__tests__/AduQueuePanel.test.tsx`
- Create: `agent-factory-dashboard/frontend/src/components/epics/__tests__/EpicControlPanel.test.tsx`

---

## 3. Task 1: 修复 ADU Queue 已完成仍显示 Blocked

**Files:**
- Modify: `agent-factory-dashboard/frontend/src/components/agent-factory/AduQueuePanel.tsx`
- Modify: `agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts`
- Modify: `agent-factory-dashboard/backend/src/domain/agent-factory.ts`
- Test: `agent-factory-dashboard/backend/tools/test-monitor.js` 或现有 `test:review-gate`/`test:project-adu` 中补充断言

### 3.1 后端定义统一显示状态

在 `AgentFactoryAduView` 增加：

```ts
display_status: {
  kind: 'completed' | 'running' | 'blocked' | 'failed' | 'active' | 'stale' | 'canceled';
  label: string;
  reason: string;
};
```

计算规则必须集中在后端：

```ts
function computeAduDisplayStatus(adu, latestRun, activeOrchestrators) {
  if (adu.state === 'evidenced' || adu.state === 'mvp_ready') {
    return {
      kind: 'completed',
      label: 'Completed',
      reason: 'ADU has completed evidence generation.',
    };
  }
  if (adu.state === 'canceled') {
    return { kind: 'canceled', label: 'Canceled', reason: 'ADU was canceled.' };
  }
  if (activeOrchestrators?.has(adu.id)) {
    return { kind: 'running', label: 'Running', reason: 'An orchestrator is currently active.' };
  }
  if (adu.state === 'human_gate') {
    return { kind: 'blocked', label: 'Blocked', reason: 'ADU is waiting for human gate disposition.' };
  }
  if (latestRun && (latestRun.result === 'failed' || latestRun.result === 'unstructured' || latestRun.returncode !== 0)) {
    return {
      kind: latestRun.result === 'unstructured' ? 'failed' : 'failed',
      label: latestRun.result === 'unstructured' ? 'Invalid Output' : 'Failed',
      reason: `Latest run ${latestRun.agent} ended with ${latestRun.result}.`,
    };
  }
  return { kind: 'active', label: 'Active', reason: `ADU is in state ${adu.state}.` };
}
```

### 3.2 前端删除错误 Blocked 条件

当前错误逻辑位于 `AduQueuePanel.tsx`：

```tsx
{adu.human_gate_required && (
  <span className="flex items-center gap-0.5 text-red-400">
    <AlertCircle className="w-2.5 h-2.5" /> Blocked
  </span>
)}
```

必须替换为：

```tsx
{adu.display_status?.kind === 'blocked' && (
  <span className="flex items-center gap-0.5 text-red-400" title={adu.display_status.reason}>
    <AlertCircle className="w-2.5 h-2.5" /> Blocked
  </span>
)}
```

对于 `evidenced` 且 `human_gate_required=true` 的 ADU，Queue 必须显示 Completed/Healthy，不得显示 Blocked。

### 3.3 测试

新增后端断言：

```js
assert.equal(view.state, 'evidenced');
assert.equal(view.human_gate_required, true);
assert.equal(view.health.status, 'healthy');
assert.equal(view.display_status.kind, 'completed');
```

新增前端断言：

```tsx
render(<AduQueuePanel />);
expect(screen.getByText('ADU-6603-001')).toBeInTheDocument();
expect(screen.queryByText('Blocked')).not.toBeInTheDocument();
expect(screen.getByText('Completed')).toBeInTheDocument();
```

---

## 4. Task 2: Epic 控制面板增加 operation 状态与事件流

**Files:**
- Create: `agent-factory-dashboard/backend/src/domain/orchestration-operation.ts`
- Create: `agent-factory-dashboard/backend/src/application/orchestration-operation-store.ts`
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Modify: `agent-factory-dashboard/frontend/src/api/agentFactory.ts`
- Modify: `agent-factory-dashboard/frontend/src/stores/agentFactory.ts`
- Modify: `agent-factory-dashboard/frontend/src/components/epics/EpicControlPanel.tsx`
- Create: `agent-factory-dashboard/frontend/src/components/shared/OperationStatusPanel.tsx`
- Test: `agent-factory-dashboard/backend/tools/test-orchestration-operation.js`

### 4.1 Operation 类型

```ts
export type OrchestrationOperationStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface OrchestrationOperationEvent {
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
  stream?: 'stdout' | 'stderr' | 'system';
}

export interface OrchestrationOperation {
  id: string;
  targetType: 'adu' | 'epic';
  targetId: string;
  mode: 'start' | 'continue' | 'step' | 'pause' | 'cancel' | 'materialize';
  status: OrchestrationOperationStatus;
  startedAt: string;
  endedAt?: string;
  pid?: number;
  exitCode?: number | null;
  finalState?: string;
  error?: string;
  events: OrchestrationOperationEvent[];
}
```

### 4.2 后端 API 行为

Epic start/continue/step 不再返回：

```json
{ "success": true, "message": "Epic orchestrator continue dispatched" }
```

改为：

```json
{
  "operationId": "op-EPIC-2026-6603-1781268000000",
  "status": "running",
  "targetType": "epic",
  "targetId": "EPIC-2026-6603",
  "mode": "continue"
}
```

新增：

- `GET /api/agent-factory/operations/:operationId`
- `GET /api/agent-factory/epics/:epicId/operations/latest`
- `GET /api/agent-factory/adus/:aduId/operations/latest`

### 4.3 子进程 stdout/stderr 处理

`spawnEpicOrchestrator()` 必须：

1. 创建 operation，状态 `running`
2. stdout 每行 JSON 事件写入 operation.events
3. stderr 原文写入 operation.events，`stream='stderr'`
4. close 时：
   - `code === 0`：operation `completed`
   - `code !== 0`：operation `failed`
   - 写入 `exitCode`
   - 读取最新 Epic/ADU state 写入 `finalState`

### 4.4 前端显示

`EpicControlPanel` 必须显示：

- 当前操作：`continue`
- 状态：`running/completed/failed`
- 当前 Agent：从最新 event 提取 `agent`
- 最新状态：从 latest DAG 或 operation.finalState
- stderr 折叠区：当失败或 stderr 非空时自动展开
- 最近事件流：按时间倒序显示 20 条

### 4.5 验收

用户点击“继续自动”后，即使 Epic 验收 Agent 失败，也必须看到：

```text
continue failed
agent: epic-acceptance-reviewer
exitCode: 1
stderr: PermissionError: [Errno 1] Operation not permitted: '/Users/hill/.hermes/profiles/coding/logs/agent.log'
```

如果成功，必须看到：

```text
continue completed
finalState: epic_evidenced
```

---

## 5. Task 3: Epic 阶段可视化与状态刷新

**Files:**
- Modify: `agent-factory-dashboard/backend/src/application/epic-monitor.ts`
- Modify: `agent-factory-dashboard/frontend/src/components/epics/EpicDagView.tsx`
- Modify: `agent-factory-dashboard/frontend/src/components/epics/EpicOverviewPanel.tsx`
- Modify: `agent-factory-dashboard/frontend/src/components/epics/EpicsPage.tsx`

### 5.1 后端输出 Epic progress

为 Epic view 增加：

```ts
progress: {
  current_phase: 'flow' | 'split' | 'child_adus' | 'epic_acceptance' | 'completed' | 'failed';
  completed_phases: string[];
  current_agent: string | null;
  next_action: string | null;
  child_summary: {
    total: number;
    evidenced: number;
    blocked: number;
    running: number;
  };
};
```

映射：

| Epic state | current_phase | next_action |
|---|---|---|
| `created` | `flow` | `Run system-flow-designer` |
| `flow_designed` | `split` | `Run adu-splitter` |
| `split_required` | `split` | `Materialize child ADUs` |
| `child_adus_running` | `child_adus` | `Continue child ADU DAG` |
| `child_adus_evidenced` | `epic_acceptance` | `Run epic-acceptance-reviewer` |
| `epic_evidenced` | `completed` | `None` |
| `epic_failed` | `failed` | `Review epic acceptance findings` |

### 5.2 前端视觉改造

`EpicDagView` 顶部增加 Epic 阶段条：

```text
System Flow -> Split Plan -> Child ADUs -> Epic Acceptance -> Epic Evidenced
```

每个阶段显示：

- complete: 绿色
- current: 蓝色或琥珀色
- failed/blocked: 红色
- pending: 灰色

### 5.3 刷新策略

`EpicsPage` 当前 5 秒轮询不够。改为：

- 操作按钮返回 operationId 后，1 秒轮询 operation
- operation running 时，每 1 秒刷新 selected Epic DAG
- operation completed/failed 后，立即刷新：
  - `fetchEpics()`
  - `loadEpicDag(selectedEpicId)`
  - `refresh()`
- 保留 5 秒后台轮询作为兜底。

---

## 6. Task 4: Hermes 权限错误和子进程失败必须在页面可见

**Files:**
- Modify: `scripts/hermes_agent_run.py`
- Modify: `scripts/hermes_epic_orchestrator.py`
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Modify: `agent-factory-dashboard/frontend/src/components/shared/OperationStatusPanel.tsx`

### 6.1 失败结构

runner/orchestrator 写入 run record 时增加：

```json
{
  "failure": {
    "category": "hermes_startup_error",
    "message": "PermissionError: [Errno 1] Operation not permitted",
    "stderr_excerpt": "...",
    "remediation": "Hermes profile log directory is not writable by the current backend process."
  }
}
```

分类：

| category | 触发条件 |
|---|---|
| `hermes_startup_error` | Hermes CLI returncode 非 0 且未产出 stdout JSON |
| `invalid_final_json` | stdout 有 JSON fence 但 JSON 解析失败 |
| `unstructured_output` | stdout 无最终 JSON |
| `validator_failed` | validator returncode 非 0 |
| `artifact_missing` | Agent success 但必需产物缺失 |
| `environment_blocked` | build/test 因外部环境缺失进入 human_gate |

### 6.2 页面展示

OperationStatusPanel 失败时显示：

- category
- message
- stderr excerpt
- suggested remediation
- run_dir 链接

验收：当 Hermes 写日志失败时，页面必须显示具体路径：

```text
/Users/hill/.hermes/profiles/coding/logs/agent.log
```

---

## 7. Task 5: 完整 Human Gate Disposition 模型

**Files:**
- Modify: `agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts`
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Modify: `agent-factory-dashboard/frontend/src/components/agent-factory/OrchestratorControlPanel.tsx`
- Create: `agent-factory-dashboard/frontend/src/components/agent-factory/HumanGateDispositionPanel.tsx`

### 7.1 支持的处置类型

```ts
type HumanGateDispositionType =
  | 'environment_waiver'
  | 'accept_risk'
  | 'request_rework'
  | 'provide_missing_evidence'
  | 'external_dependency_block'
  | 'cancel_adu';
```

### 7.2 状态转换

| 当前 state | pre_gate_state | disposition | 新 state |
|---|---|---|---|
| `human_gate` | `code_reviewed` | `environment_waiver` | `debugged` |
| `human_gate` | `debugged` | `environment_waiver` | `acceptance_reviewed` only if acceptance waiver is explicit |
| `human_gate` | any | `request_rework` | `rework_planned` |
| `human_gate` | any | `provide_missing_evidence` | previous state |
| `human_gate` | any | `external_dependency_block` | `human_gate` with blocked reason |
| `human_gate` | any | `cancel_adu` | `canceled` |

### 7.3 审计记录

所有处置写入：

```json
{
  "human_gate_dispositions": [
    {
      "id": "disp-ADU-6603-002-...",
      "type": "environment_waiver",
      "from_state": "human_gate",
      "to_state": "debugged",
      "pre_gate_state": "code_reviewed",
      "comment": "...",
      "created_at": "...",
      "approved_by": "local-user",
      "affected_assertions": ["A2"]
    }
  ]
}
```

`human_gate_waivers` 可保留兼容，但新逻辑以 `human_gate_dispositions` 为准。

---

## 8. Task 6: allowed_write_paths 升级为策略引擎

**Files:**
- Use design source: `docs/superpowers/specs/2026-06-12-agent-factory-write-path-policy-engine-design.md`
- Create: `scripts/agent_path_policy.py`
- Modify: `scripts/hermes_agent_run.py`
- Modify: `scripts/hermes_epic_orchestrator.py`
- Modify: `agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts`
- Modify: `agent-factory-dashboard/frontend/src/components/agent-factory/ReviewGatePanel.tsx`

### 8.1 根因

当前 `allowed_write_paths` 是 ADU 注册时静态生成的，detail-designer 发现新文件后无法自动同步给 developer，导致：

- contract 可以写某文件，但 developer 被拒绝
- design 方案要求改文件，但 ADU write path 没有
- code-reviewer 追加 approved path 后，后续 Agent 未必继承

### 8.2 目标模型

引入路径授权请求：

```json
{
  "pending_path_requests": [
    {
      "id": "pathreq-...",
      "source_agent": "detail-designer",
      "reason": "Design requires adding src/mme/meson.build for new object file.",
      "requested_write_paths": ["src/mme/meson.build"],
      "requested_read_paths": ["src/mme/meson.build"],
      "risk": "low",
      "status": "pending"
    }
  ]
}
```

### 8.3 自动批准规则

可自动批准：

- 在项目 repo 内
- 非绝对路径
- 不含 `..`
- 不在 blocked prefixes
- 与当前 ADU scope 同目录或构建文件强相关：
  - `src/<nf>/meson.build`
  - `lib/<module>/meson.build`
  - `tests/ai-agent-mvp/<ADU_ID>-*.js`
  - `.ai-agent/**`

必须人工审核：

- 跨模块根目录
- `webui/` 与 C 网元混合修改
- `configs/`
- `lib/proto/types.h`
- 任意删除/迁移类操作

### 8.4 Agent 交互

detail-designer 输出必须包含：

```json
{
  "requested_write_paths": [
    {
      "path": "src/mme/meson.build",
      "reason": "New source file must be compiled into MME target."
    }
  ]
}
```

runner 在 Agent 成功后：

1. 读取 `requested_write_paths`
2. 调用 path policy
3. 自动批准则写入 ADU `allowed_write_paths`
4. 需要人工则进入 path review gate

---

## 9. Task 7: Quality Gate 状态结构化展示

**Files:**
- Modify: `scripts/validate_quality_report.py`
- Modify: `scripts/hermes_agent_run.py`
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Modify: `agent-factory-dashboard/frontend/src/components/agent-factory/QualityReportPanel.tsx`
- Modify: `agent-factory-dashboard/frontend/src/components/agent-factory/RunHistoryTable.tsx`

### 9.1 Validator 输出 JSON

validator 失败时除 stderr 外，同时支持 `--json`：

```bash
python3 scripts/validate_quality_report.py --adu ADU-6603-003 --kind acceptance --repo-root /path --json
```

输出：

```json
{
  "valid": false,
  "kind": "acceptance",
  "adu_id": "ADU-6603-003",
  "failure_code": "assertion_not_pass_without_waiver",
  "message": "assertion_results[1] status is not pass and no approved waiver covers it",
  "assertion_id": "A2"
}
```

### 9.2 页面状态

QualityReportPanel 必须显示：

- `通过`
- `通过但含豁免`
- `无效通过`
- `验收失败`
- `报告结构错误`
- `Validator 失败`

### 9.3 已知回归

保留并扩展：

- `scripts/test_validate_quality_report.py`
  - environment waiver 可覆盖 waived assertion
  - 无 waiver 时 waived assertion 必须失败
  - `missing_evidence` 仅允许对应 waived assertion
  - unrelated missing evidence 必须失败

---

## 10. Task 8: Epic 页面闭环子 ADU 操作

**Files:**
- Modify: `agent-factory-dashboard/frontend/src/components/epics/EpicChildAduTable.tsx`
- Modify: `agent-factory-dashboard/frontend/src/components/epics/EpicsPage.tsx`
- Reuse: `ReviewGatePanel`, `QualityReportPanel`, `RunHistoryTable`, `OrchestratorControlPanel`

### 10.1 目标

Epic 页面不再只是 DAG 概览。用户在 Epic 页面应能直接处理子 ADU：

- 查看子 ADU workflow
- 打开子 ADU 质量报告
- 处理 analysis/design review gate
- 处理 human gate disposition
- 对单个子 ADU 单步/继续自动
- 查看子 ADU run stderr/stdout

### 10.2 UI

`EpicChildAduTable` 每行增加：

- `打开详情`
- `继续`
- `单步`
- `处理阻塞`
- `质量报告`

点击后在右侧 drawer 打开子 ADU 操作区，而不是跳走页面。

---

## 11. Task 9: 需求分析澄清问题生命周期

**Files:**
- Modify: `.ai-agent/prompts/requirement-analyst-agent.md`
- Modify: `scripts/hermes_agent_run.py`
- Modify: `agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts`
- Modify: `agent-factory-dashboard/frontend/src/components/agent-factory/ReviewGatePanel.tsx`

### 11.1 结构化输出

requirement-analyst 如果提出澄清问题，必须在 JSON result 中输出：

```json
{
  "clarification_questions": [
    {
      "id": "CQ-1",
      "question": "IMEI 获取时序应以 Identity Response 还是 Security Mode Complete 为准？",
      "impact": "design",
      "default_recommendation": "由 detail-designer 结合代码路径决定",
      "blocking": false
    }
  ]
}
```

### 11.2 状态规则

- `blocking=true`：进入 `analysis_review`，页面必须要求回答或选择 defer/out_of_scope。
- `blocking=false`：可继续，但问题进入 ADU `clarifications`，后续 detail-designer 必须读取。
- 所有回答必须写入 ADU `clarifications`，并进入 prompt payload。

---

## 12. 执行顺序

### 第一批：必须先修

1. Task 1：ADU Queue Blocked 错误显示
2. Task 2：Operation 状态与事件流
3. Task 3：Epic 阶段可视化与刷新
4. Task 4：Hermes 权限/子进程失败可见

### 第二批：流程能力增强

5. Task 5：Human Gate Disposition
6. Task 6：allowed_write_paths 策略引擎
7. Task 7：Quality Gate 结构化展示

### 第三批：闭环体验

8. Task 8：Epic 页面闭环子 ADU 操作
9. Task 9：澄清问题生命周期

---

## 13. 验收清单

### 13.1 Epic 继续自动

- 创建一个 Epic，物化 2 个以上子 ADU。
- 将所有子 ADU 置为 `evidenced`。
- 在 Epic 页面点击“继续自动”。
- 页面必须在 1 秒内显示 operation running。
- 运行 `epic-acceptance-reviewer` 时必须显示当前 Agent。
- 成功后页面必须显示 `epic_evidenced`，无需手工刷新。
- 如果 Hermes 权限失败，页面必须显示 stderr 路径和 remediation。

### 13.2 ADU Queue

- 构造一个 `state=evidenced` 且 `human_gate_required=true` 的 ADU。
- Queue 不得显示 Blocked。
- HealthBadge 显示 Healthy/Completed。
- Summary 的 blocked count 不包含该 ADU。

### 13.3 Quality Gate

- acceptance report 中 A2 为 `waived` 且 ADU 有 environment waiver：validator pass。
- acceptance report 中 A2 为 `waived` 但 ADU 无 waiver：validator fail。
- pass report 有 unrelated missing evidence：validator fail。
- 页面显示“通过但含豁免”，而不是普通通过或失败。

### 13.4 Path Policy

- detail-designer 请求 `src/mme/meson.build`，同 ADU scope 为 `src/mme/`：自动批准。
- detail-designer 请求 `/Users/hill/...`：拒绝。
- detail-designer 请求 `../secret`：拒绝。
- detail-designer 请求跨模块 `src/upf/`：进入人工 path review gate。

---

## 14. 非目标

- 本计划不要求重新设计 Hermes CLI。
- 本计划不要求替换 JSON registry 为数据库。
- 本计划不要求恢复 NMS 内嵌版本；后续只维护独立 Dashboard。
- 本计划不要求解决 macOS Docker 环境本身，只要求把环境失败可见化、可处置、可审计。

---

## 15. 自检结果

- 覆盖了本轮两个新缺陷：Epic 页面无状态转换可见性、ADU Queue 已完成仍 Blocked。
- 覆盖了此前遗留问题：静态 write path、Human Gate 处置不足、Quality Gate 展示混乱、Epic 页面不闭环、澄清问题生命周期不足。
- 所有状态转换均指定了后端事实源和前端显示口径。
- 没有使用 NMS 版本作为改造对象，只面向独立 Dashboard。

# Agent Factory Agent Lanes Runtime Status Redesign

日期：2026-06-22

状态：Approved for implementation planning

适用范围：独立版 `agent-factory-dashboard`

## 1. 背景

任务看板当前的 `Agent Lanes Status` 使用固定高度卡片展示 Agent 状态和历史运行统计。现有实现存在两个问题：

1. 信息密度低，Agent 数量增加后需要大量滚动，难以横向比较。
2. 状态语义不准确：
   - ADU 的 `next_agent` 等于某 Agent 时，该 Agent 会被标记为 `active`，但此时通常只是等待启动。
   - Agent 最近一次运行失败时，即使当前没有未解决异常，Agent 仍可能长期显示 `failed`。
   - `stale` 同时承担运行状态和异常提示两种含义。
   - 页面无法区分真实执行、等待队列、待人工处理和历史结果。

本次改造将卡片视图替换为运行监控表格，并重新定义 Agent 的实时状态模型。

## 2. 目标

本次改造必须实现：

- 准确区分 `Running`、`Ready`、`Needs attention` 和 `Idle`。
- 将心跳超时作为 Running 的异常标记，而不是独立生命周期状态。
- 历史失败只展示为最近结果，不直接决定当前状态。
- 默认展示整个 Agent Factory 的全局状态。
- 支持切换到当前选中 ADU 的 Agent 范围。
- 支持状态筛选、名称搜索、任务跳转和行详情展开。
- 桌面端使用紧凑表格，移动端使用不溢出的两行列表。

本次改造不做：

- 修改 Agent 编排顺序。
- 修改 ADU/Epic 状态机。
- 新增 Agent。
- 修改模型配置。
- 将历史统计迁移到数据库。

## 3. 状态模型

### 3.1 状态枚举

```ts
export type AgentRuntimeStatus =
  | 'running'
  | 'ready'
  | 'needs_attention'
  | 'idle';
```

### 3.2 状态定义

| 状态 | 定义 | 页面文案 |
|---|---|---|
| `running` | 存在属于该 Agent 的活跃 Operation，且对应 Runner/Orchestrator 尚未结束 | Running |
| `ready` | 当前没有活跃 Operation，但至少一个可执行 ADU/Epic 的 `next_agent` 是该 Agent | Ready |
| `needs_attention` | 当前没有活跃 Operation，但存在尚未解决、明确归属于该 Agent 或其最近任务的失败/人工门 | Needs attention |
| `idle` | 没有活跃 Operation、等待任务或未解决异常 | Idle |

### 3.3 状态优先级

状态计算必须使用以下优先级：

```text
running > needs_attention > ready > idle
```

原因：

- 真实运行中的 Agent 必须优先显示为 Running，即使其队列中还有任务。
- 当前运行结束后，如果产生未解决异常，应显示 Needs attention。
- 只有没有运行和异常时，等待任务才显示 Ready。

### 3.4 Stale 语义

`stale` 不再是 `runtime_status`。

活跃 Operation 的心跳或事件更新时间超过配置阈值时：

```ts
stale_warning: {
  stale: true;
  reason: string;
  last_heartbeat_at: string | null;
  stale_after_seconds: number;
}
```

页面展示：

```text
Running · heartbeat delayed
```

该标记不得自动把 Agent 改成 Failed，也不得仅凭时间差修改 ADU 状态。

## 4. 当前状态的数据来源

### 4.1 Running

Running 必须来源于真实 Operation，而不是 `next_agent`：

- Operation `target_type` 为 `adu` 或 `epic`。
- Operation 状态属于：
  - `spawning`
  - `running`
- Operation 的 `current_agent` 等于 Agent ID。

如果存在多个 Operation，全部放入 `current_operations`。

`queued` Operation 尚未产生真实执行进程，必须归入 Ready 队列，不能显示为 Running。

### 4.2 Ready

Ready 来源于可继续执行的任务：

- ADU/Epic 不处于终态。
- 不处于 Human Gate。
- 没有活跃 Operation。
- `next_agent` 等于 Agent ID。

Ready 数据写入 `queued_targets`，并记录排队时间。

### 4.3 Needs Attention

Needs attention 只能由未解决问题触发：

- 活跃 Human Gate 明确指向该 Agent 的输出或返工目标。
- 最新 Quality Decision 的 `recommended_next_agent` 等于该 Agent。
- Open Rework Chain 的 `target_agent` 等于该 Agent。
- Agent 最近一次 Run 失败，且该 Run 仍是目标 ADU 的控制性失败，尚未被后续成功 Run、人工豁免、Operator Override 或取消操作解决。
- Operation 异常终止且没有对应的后续处理记录。

仅有一条历史失败 Run 不足以触发 Needs attention。

### 4.4 Idle

前述三个条件均不满足时为 Idle。

## 5. 后端数据模型

修改：

```text
agent-factory-dashboard/backend/src/domain/agent-factory.ts
```

新增：

```ts
export interface AgentFactoryAgentOperationRef {
  operation_id: string;
  target_type: 'adu' | 'epic';
  target_id: string;
  status: 'spawning' | 'running';
  current_state: string | null;
  started_at: string | null;
  updated_at: string | null;
  elapsed_seconds: number | null;
}

export interface AgentFactoryAgentQueuedTarget {
  target_type: 'adu' | 'epic';
  target_id: string;
  title: string;
  state: string;
  queued_since: string | null;
}

export interface AgentFactoryAgentAttentionItem {
  id: string;
  target_type: 'adu' | 'epic';
  target_id: string;
  kind:
    | 'run_failed'
    | 'human_gate'
    | 'quality_decision'
    | 'rework_required'
    | 'operation_failed';
  severity: 'P0' | 'P1' | 'P2' | 'P3' | 'unknown';
  summary: string;
  recommended_action: string | null;
  created_at: string;
}

export interface AgentFactoryAgentLastResult {
  run_timestamp: string;
  target_id: string;
  result: string;
  effective_returncode: number | null;
  finished_at: string | null;
}
```

扩展 `AgentFactoryAgentView`：

```ts
export interface AgentFactoryAgentView {
  // Existing configuration and counters remain.
  runtime_status: AgentRuntimeStatus;
  current_operations: AgentFactoryAgentOperationRef[];
  queued_targets: AgentFactoryAgentQueuedTarget[];
  attention_items: AgentFactoryAgentAttentionItem[];
  last_result: AgentFactoryAgentLastResult | null;
  last_run_at: string | null;
  success_rate: number | null;
  stale_warning: {
    stale: boolean;
    reason: string | null;
    last_heartbeat_at: string | null;
    stale_after_seconds: number;
  };
}
```

旧字段迁移：

- 保留 `total_runs`、`success_runs`、`failed_runs`、`unstructured_runs`。
- `active_adu_ids` 标记为 deprecated，前端不再读取。
- 旧 `status` 在一个兼容周期内保留，由 `runtime_status` 映射生成；新前端不得使用它。

## 6. 后端状态聚合

修改：

```text
agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts
```

新增独立聚合器：

```text
agent-factory-dashboard/backend/src/application/agent-runtime-status.ts
```

职责：

```ts
deriveAgentRuntimeView({
  agentId,
  runs,
  aduViews,
  epicViews,
  operations,
  humanGates,
  qualityDecisions,
  reworkChains,
  now,
  staleAfterSeconds,
})
```

该函数必须为纯函数，便于正反例测试。

### 6.1 成功率

```text
success_rate = success_runs / terminal_runs
```

其中：

```text
terminal_runs = success_runs + failed_runs + unstructured_runs
```

无终态 Run 时返回 `null`，不显示 `0%`。

被 Operator Override 修正为 success 的 Run 按有效结果统计，但详情仍保留原始结果。

### 6.2 最近结果

`last_result` 始终来自最新 Run 的有效结果：

1. 优先使用 Operator Override 后的 `result` 和 `effective_returncode`。
2. 没有 Override 时使用 Runner 原始结果。
3. Human Gate 显示 `human_gate`，不归类为普通 failed。

## 7. API

现有 Dashboard API 继续返回 `agents` 以保持兼容，同时新增可独立刷新 Agent 状态的接口：

```http
GET /api/agent-factory/agents/runtime-status
```

查询参数：

```text
scope=global|adu
aduId=<ADU_ID>
status=running,ready,needs_attention,idle
search=<agent-name>
```

响应：

```json
{
  "generated_at": "2026-06-22T10:00:00Z",
  "scope": "global",
  "summary": {
    "running": 1,
    "ready": 2,
    "needs_attention": 1,
    "idle": 12
  },
  "agents": []
}
```

范围规则：

- `global`：返回所有已注册 Agent。
- `adu`：返回当前 ADU 工作流涉及的 Agent；至少包含 workflow 中已完成、当前和后续 Agent。
- `scope=adu` 缺少或找不到 `aduId` 时返回 `400/404`。

## 8. 前端设计

替换：

```text
agent-factory-dashboard/frontend/src/components/agent-factory/AgentLanePanel.tsx
```

建议拆分为：

```text
AgentRuntimeTable.tsx
AgentRuntimeFilters.tsx
AgentRuntimeRow.tsx
AgentRuntimeDetail.tsx
```

### 8.1 表格列

桌面端列顺序：

| 列 | 内容 |
|---|---|
| Agent | Agent ID 和简短角色描述 |
| 当前状态 | Running / Ready / Needs attention / Idle，附 stale warning |
| 当前/下个任务 | Running Operation 或首个 queued target，并显示额外队列数量 |
| 最近结果 | success / failed / human_gate / unstructured |
| 成功率 | 百分比和成功/终态次数 |
| 最近运行 | 相对时间，Tooltip 显示完整时间 |

### 8.2 顶部控制

- 分段控制：
  - `全局`
  - `当前 ADU`
- 状态多选筛选。
- Agent 名称搜索。
- 状态统计：
  - Running 数量
  - Ready 数量
  - Needs attention 数量
  - Idle 数量

当没有选中 ADU 时，`当前 ADU` 禁用并给出 Tooltip。

### 8.3 行交互

- 点击任务 ID：选择并滚动到对应 ADU；Epic 目标跳转 Epic 页面。
- 点击整行或展开图标：展示详情。
- 展开详情包含：
  - 当前 Operations。
  - Ready 队列。
  - Attention Items。
  - 最近 5 次 Run。
- Needs attention 行提供“查看处理入口”，跳转 Human Gate、Quality Report 或对应 ADU。

### 8.4 移动端

小于 `768px` 时不展示横向滚动宽表格，改为两行列表：

第一行：

```text
Agent ID | 状态 | 最近运行
```

第二行：

```text
当前/下个任务 | 最近结果 | 成功率
```

长 Agent ID 必须换行，不允许被状态标签覆盖。

## 9. 视觉规范

- 继续使用现有 NMS/Agent Factory 色彩 Token，不引入新的渐变主题。
- 状态使用圆点加文字，不能只依赖颜色：
  - Running：绿色。
  - Ready：蓝色。
  - Needs attention：琥珀色。
  - Idle：灰色。
- Failed 只用于 `Last result`，不作为当前状态标签。
- Running 可使用轻量动画，但整行不得闪烁。
- 表格行高稳定，详情展开不得改变其他列宽。
- 卡片圆角不超过现有设计系统标准。

## 10. 刷新与一致性

- WebSocket Operation Event 到达时刷新 Agent runtime status。
- 保留 5 秒 REST 轮询作为降级机制。
- 前端筛选状态在刷新后保持。
- 后端 `generated_at` 用于防止旧响应覆盖新响应。
- Operation、Registry 和 Run 数据读取必须使用同一聚合快照，避免同一响应内状态互相矛盾。

## 11. 错误和空状态

- Dashboard 不可用：显示连接错误，不展示全员 Idle。
- Agent Registry 为空：显示“未注册 Agent”。
- 当前 ADU 不涉及任何 Agent：显示明确空状态。
- Operation 缺少 `current_agent`：不能猜测 Running Agent；记录数据质量警告。
- Run timestamp 无法解析：最近运行显示原始值，不能因此标记 stale。

## 12. 测试设计

### 12.1 后端状态映射测试

新增：

```text
agent-factory-dashboard/backend/tools/test-agent-runtime-status.js
```

必须覆盖：

1. 有 `next_agent`、无 Operation：`ready`。
2. 有活跃 Operation、`current_agent` 匹配：`running`。
3. 历史最后一次失败、当前无未解决问题：`idle`。
4. 当前控制性失败未解决：`needs_attention`。
5. Human Gate 指向该 Agent：`needs_attention`。
6. 同时 Running 和 Ready：`running`，队列仍保留。
7. 同时 Needs attention 和 Ready：`needs_attention`。
8. Running 心跳超时：`running` 且 `stale_warning.stale=true`。
9. 后续成功 Run 解决旧失败：不再 Needs attention。
10. Operator Override 解决失败：最近结果按有效结果显示。
11. 无 Run：成功率为 `null`。
12. 当前 ADU Scope 仅返回工作流相关 Agent。

### 12.2 前端测试

新增：

```text
agent-factory-dashboard/frontend/tools/test-agent-runtime-view.mjs
```

至少验证：

- 四种状态均有文字标签。
- Failed 不作为 runtime status。
- 全局/当前 ADU 切换。
- 搜索和状态筛选组合。
- 长 Agent ID 不截断或覆盖。
- 移动端不产生横向页面溢出。
- 当前 ADU 未选中时筛选禁用。

### 12.3 回归

必须通过：

```bash
cd agent-factory-dashboard/backend
npm run build
npm run test:agent-runtime-status
npm run test:phase37-regression
npm run check:portable
npm run doctor -- --skip-hermes

cd ../frontend
npm run build
npm run test:agent-runtime-view

cd ../..
git diff --check
```

## 13. 验收标准

- Ready 不再显示为 Active/Running。
- 历史失败不会让空闲 Agent 永久显示 Failed。
- Running 必须有真实 Operation 证据。
- Needs attention 必须有可定位、未解决的问题记录。
- Stale 作为 Running 警告展示。
- 表格支持全局和当前 ADU 两种范围。
- 用户可从任务或异常直接跳转到对应处置页面。
- 桌面端能在一屏比较主要 Agent 状态。
- 移动端无文字覆盖和横向页面溢出。
- 状态映射反例和现有回归全部通过。

## 14. 实施顺序

1. 建立纯函数 Agent Runtime Status 聚合器和反例测试。
2. 扩展后端领域类型和 Dashboard 聚合。
3. 增加独立 runtime-status API。
4. 同步前端类型和 API。
5. 实现表格、筛选和详情展开。
6. 实现当前 ADU Scope 和任务跳转。
7. 完成移动端适配。
8. 接入 WebSocket 刷新并运行全量回归。

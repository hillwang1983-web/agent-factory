# Agent Factory Phase 3.7 十五项缺陷修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Phase 3.7 真实需求调试中发现的 15 项缺陷，使 Intake、ADU、Epic、Agent Runner、Operation 和前端状态形成可控、可恢复、可观测且不会无限消耗 Token 的完整闭环。

**Architecture:** 不对 15 个现象分别打补丁，而是按六个共享边界治理：运行版本与错误契约、统一 Intake 生命周期、Agent 运行预算与上下文治理、Epic 设计/拆分质量门、Epic 物化与状态聚合、Operation/锁/前端一致性。Python Runner 负责进程级预算和产物终态，Node 后端负责业务任务与 Operation 状态，前端只消费确定的 API 状态，不自行推断。

**Tech Stack:** TypeScript、Node.js、Express、React、Zustand、Python 3、Hermes CLI、JSON Registry、NDJSON Event Stream、现有 Agent Factory validators。

---

## 1. 实施边界

### 1.1 必须修复

| 缺陷 | 归属工作包 | 最终要求 |
|---|---|---|
| BUG-37-001 | 运行版本与错误契约 | 页面和 API 可识别实际运行版本 |
| BUG-37-002 | Intake 生命周期 | HTTP 等待超时不再误杀后台任务 |
| BUG-37-003 | Runner 生命周期 | 产物完成或超限后进程可靠退出 |
| BUG-37-004 | Intake 生命周期 | 异步 Intake 有硬超时和恢复机制 |
| BUG-37-005 | Intake 生命周期 | 产物校验决定终态，迟到事件不能覆盖 |
| BUG-37-006 | 运行版本与错误契约 | 返回稳定错误码和可恢复信息 |
| BUG-37-007 | 前端一致性 | 注册 Epic 后立即刷新并选中 |
| BUG-37-008 | Epic 设计质量门 | 已回答澄清不得被重新打开或冲突 |
| BUG-37-009 | Operation 可观测性 | 当前 Agent、状态、进展时间可见 |
| BUG-37-010 | Splitter 质量门 | 依赖边语义明确且可验证 |
| BUG-37-011 | Splitter 质量门 | 写路径、测试路径、UI 范围和风险路径完整 |
| BUG-37-012 | Epic 物化 | 一个动作完成物化并保留审计语义 |
| BUG-37-013 | Epic 状态聚合 | `created` 子 ADU 不得显示为运行中 |
| BUG-37-014 | Runner 生命周期 | Agent 有硬时限、无进展时限和上下文上限 |
| BUG-37-015 | 锁治理 | 死 PID 锁可立即安全回收 |

### 1.2 不在本轮范围

- 不实现 Phase 3.8 完整的跨供应商精确 Token 计费。
- 不重写 Hermes 内部 Agent loop。
- 不恢复已经失败的历史 Operation；只保证新 Operation 使用新语义。
- 不更新 NMS 内嵌版本，只修改独立 `agent-factory-dashboard`。
- 不修改 Open5GS License 业务实现。

## 2. 目标状态机与关键约束

### 2.1 Intake 状态机

```text
created
  -> queued
  -> generating
  -> validating
  -> draft_ready

queued/generating/validating
  -> generation_failed
  -> canceled
```

终态规则：

1. `draft_ready`、`generation_failed`、`canceled` 是终态。
2. 只有完成 `draft.json` Schema 校验和安全校验才能进入 `draft_ready`。
3. 已进入 `draft_ready` 后，迟到的 timeout、close、error 不得覆盖终态。
4. Soft timeout 只结束 HTTP 等待，不改变任务状态。
5. Hard timeout 必须终止整个进程组并写入 `generation_failed`。

### 2.2 Agent Run 状态机

```text
queued -> spawning -> running -> validating -> completed
                           |          |
                           |          +-> human_gate
                           +-> failed
                           +-> timed_out
                           +-> no_progress
                           +-> canceled
```

每次运行至少记录：

```json
{
  "run_id": "RUN-...",
  "agent": "requirement-analyst",
  "started_at": "...",
  "last_progress_at": "...",
  "finished_at": "...",
  "status": "completed",
  "termination_reason": "normal",
  "estimated_input_tokens": 11200,
  "actual_input_tokens": 0,
  "actual_output_tokens": 0,
  "prompt_bytes": 45563,
  "artifact_paths": [],
  "exit_code": 0
}
```

### 2.3 Epic 子 ADU 状态

```text
split_required
  -> child_adus_created
  -> child_adus_running
  -> child_adus_blocked
  -> child_adus_completed
```

硬规则：

- 物化成功后必须停在 `child_adus_created`。
- 只有存在活动 Operation，或至少一个子 ADU 离开 `created` 且未终态，才能进入 `child_adus_running`。
- 所有子 ADU 均为 `created` 且 `runs=0` 时不得显示 Running。

## 3. 文件结构调整

### 3.1 新增后端模块

```text
agent-factory-dashboard/backend/src/application/intake/
  intake-generation-service.ts
  intake-output-validator.ts
  intake-error.ts

agent-factory-dashboard/backend/src/application/runtime/
  agent-run-policy.ts
  orchestrator-event-mapper.ts

agent-factory-dashboard/backend/src/interfaces/
  version-controller.ts
```

### 3.2 新增 Python 模块

```text
scripts/agent_run_policy.py
scripts/context_payload_builder.py
scripts/test_agent_run_policy.py
scripts/test_context_payload_builder.py
```

### 3.3 新增 Registry

```text
.ai-agent/policies/agent-run-policy.json
.ai-agent/registry/intake-operations.json
```

运行时 Registry 必须加入 `.gitignore`、bootstrap 和 doctor 清单。

## 4. Task 1：建立缺陷回归基线和测试命令

**Files:**
- Modify: `agent-factory-dashboard/backend/package.json`
- Create: `agent-factory-dashboard/backend/tools/test-phase37-regression.js`
- Modify: `docs/superpowers/debugging/2026-06-19-agent-factory-phase3-7-debug-bug-log.md`

- [ ] **Step 1: 创建总回归测试入口**

`test-phase37-regression.js` 只负责顺序执行专项测试，并在任一子测试失败时退出非零：

```js
const { spawnSync } = require('child_process');

const commands = [
  ['node', ['tools/test-phase37-bugs.js']],
  ['node', ['tools/test-intake-lifecycle.js']],
  ['node', ['tools/test-operation-events.js']],
  ['node', ['tools/test-epic-state-semantics.js']],
  ['python3', ['../../scripts/test_agent_run_policy.py']],
  ['python3', ['../../scripts/test_context_payload_builder.py']],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
```

- [ ] **Step 2: 注册 npm 命令**

```json
"test:phase37-regression": "node tools/test-phase37-regression.js"
```

- [ ] **Step 3: 先写 15 项失败占位断言**

每个 Bug 至少对应一个可执行测试名称，不允许只在文档中声明：

```text
T01 runtime version mismatch is visible
T02 intake soft timeout keeps task running
T03 completed intake artifact terminates process
T04 async intake reaches hard timeout
T05 terminal intake state cannot be overwritten
T06 intake errors expose stable error_code
T07 epic registration refresh contract exists
T08 system flow rejects clarification conflict
T09 operation maps current agent and state
T10 dependency direction is prerequisite to dependent
T11 split plan covers acceptance paths and risk rules
T12 materialize action completes in one operation
T13 created children remain child_adus_created
T14 agent run stops on duration or no progress
T15 dead PID lock is reclaimed safely
```

- [ ] **Step 4: 执行基线测试**

Run:

```bash
cd agent-factory-dashboard/backend
npm run test:phase37-regression
```

Expected: FAIL，且失败项能够对应当前缺陷，不得因测试脚本语法错误失败。

- [ ] **Step 5: 提交测试基线**

```bash
git add agent-factory-dashboard/backend/package.json \
  agent-factory-dashboard/backend/tools/test-phase37-regression.js \
  docs/superpowers/debugging/2026-06-19-agent-factory-phase3-7-debug-bug-log.md
git commit -m "test(agent-factory): add phase 3.7 bug regression baseline"
```

## 5. Task 2：运行版本探针和统一错误契约

覆盖：BUG-37-001、BUG-37-006。

**Files:**
- Create: `agent-factory-dashboard/backend/src/interfaces/version-controller.ts`
- Modify: `agent-factory-dashboard/backend/src/index.ts`
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Modify: `agent-factory-dashboard/frontend/src/api/agentFactory.ts`
- Modify: `agent-factory-dashboard/frontend/src/App.tsx`
- Create: `agent-factory-dashboard/frontend/src/components/system/RuntimeCompatibilityBanner.tsx`
- Test: `agent-factory-dashboard/backend/tools/test-runtime-contract.js`

- [ ] **Step 1: 定义运行版本响应**

```ts
export interface AgentFactoryRuntimeInfo {
  phase: '3.7';
  api_version: '2026-06-19';
  build_commit: string;
  build_time: string;
  control_enabled: boolean;
  capabilities: string[];
}
```

新增：

```text
GET /api/agent-factory/runtime-info
```

响应中的 `build_commit` 优先读取 `AGENT_FACTORY_BUILD_COMMIT`，否则读取构建时生成的版本文件；禁止在每次请求中执行 `git`。

- [ ] **Step 2: 定义统一 API 错误**

```ts
export interface AgentFactoryApiError {
  success: false;
  error_code: string;
  message: string;
  retryable: boolean;
  target_id?: string;
  operation_id?: string;
  details?: Record<string, unknown>;
}
```

Intake 至少支持：

```text
INTAKE_SOFT_TIMEOUT
INTAKE_HARD_TIMEOUT
INTAKE_ALREADY_RUNNING
INTAKE_AGENT_FAILED
INTAKE_OUTPUT_INVALID
INTAKE_CANCELED
```

- [ ] **Step 3: 修改全局错误处理**

`agent-factory-controller.ts` 不再把已知业务异常改写为 `Internal server error`。未知异常才返回：

```json
{
  "success": false,
  "error_code": "INTERNAL_ERROR",
  "message": "Internal server error",
  "retryable": false
}
```

服务端日志保留原始异常和 target ID。

- [ ] **Step 4: 前端增加版本兼容提示**

页面启动时获取 `runtime-info`。以下情况显示阻断 Banner：

- API 404；
- `phase` 低于前端要求；
- `control_enabled=false` 但用户进入控制功能；
- 缺少 `operator-control` capability。

- [ ] **Step 5: 编写正反例测试**

必须验证：

1. 最新后端返回版本和能力。
2. 模拟旧后端时前端 API 能识别不兼容。
3. Intake 软超时不会返回 500。
4. 未知异常仍被安全遮蔽。

- [ ] **Step 6: 执行测试和提交**

```bash
cd agent-factory-dashboard/backend
npm run build
node tools/test-runtime-contract.js
cd ../frontend
npm run build
git add agent-factory-dashboard
git commit -m "fix(agent-factory): expose runtime version and structured errors"
```

## 6. Task 3：统一 Intake Generation 生命周期

覆盖：BUG-37-002、BUG-37-004、BUG-37-005。

**Files:**
- Create: `agent-factory-dashboard/backend/src/application/intake/intake-error.ts`
- Create: `agent-factory-dashboard/backend/src/application/intake/intake-output-validator.ts`
- Create: `agent-factory-dashboard/backend/src/application/intake/intake-generation-service.ts`
- Modify: `agent-factory-dashboard/backend/src/application/adu-intake.ts`
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Modify: `agent-factory-dashboard/backend/src/index.ts`
- Modify: `scripts/agent_factory_bootstrap.py`
- Modify: `scripts/agent_factory_doctor.py`
- Modify: `.gitignore`
- Test: `agent-factory-dashboard/backend/tools/test-intake-lifecycle.js`

- [ ] **Step 1: 定义 Intake Operation**

```ts
export type IntakeOperationStatus =
  | 'queued'
  | 'generating'
  | 'validating'
  | 'draft_ready'
  | 'generation_failed'
  | 'canceled';

export interface IntakeOperation {
  draft_id: string;
  project_id: string;
  status: IntakeOperationStatus;
  pid: number | null;
  process_group_id: number | null;
  started_at: string | null;
  last_progress_at: string | null;
  soft_deadline_at: string | null;
  hard_deadline_at: string | null;
  finished_at: string | null;
  artifact_completed_at: string | null;
  termination_reason: string | null;
  error_code: string | null;
  error_message: string | null;
}
```

- [ ] **Step 2: 实现产物校验器**

`intake-output-validator.ts` 必须检查：

1. `draft.json` 和 `intake-report.md` 同时存在；
2. `draft.json` 是合法 JSON；
3. `title`、`goal` 为非空字符串；
4. 路径、命令和 question answers 通过现有安全校验；
5. 报告不为空；
6. 返回规范化的 title 和 SHA-256。

```ts
export async function validateIntakeOutput(
  repoPath: string,
  draftPath: string,
  reportPath: string
): Promise<{ title: string; draftSha256: string; reportSha256: string }>;
```

- [ ] **Step 3: 合并同步和异步 spawn**

`AduIntake.generateDraft()` 和 `generateDraftSync()` 不再各自创建子进程。统一调用：

```ts
generationService.start(draftId)
generationService.wait(draftId, softTimeoutMs)
```

`start()` 对同一 Draft ID 必须幂等；已有活动任务时返回已有 Operation。

- [ ] **Step 4: 区分软超时和硬超时**

默认建议：

```text
soft_timeout_ms = 30_000
hard_timeout_ms = 300_000
termination_grace_ms = 5_000
```

Soft timeout：

```json
{
  "status": 202,
  "error_code": "INTAKE_SOFT_TIMEOUT",
  "draft_id": "DRAFT-...",
  "task_status": "generating"
}
```

Hard timeout：

1. 向进程组发送 `SIGTERM`；
2. 等待 5 秒；
3. 仍存活则发送 `SIGKILL`；
4. 校验产物；
5. 完整产物可进入 `draft_ready`；
6. 不完整产物进入 `generation_failed`。

- [ ] **Step 5: 实现终态保护**

所有状态写入必须使用 Compare-And-Set 语义：

```ts
if (current.status === 'draft_ready') return current;
if (isTerminal(current.status) && current.status !== nextStatus) {
  throw new IntakeStateConflictError(current.status, nextStatus);
}
```

Timeout、close、error 回调都必须重新读取 Registry，不得使用旧内存对象覆盖新状态。

- [ ] **Step 6: 后端重启恢复**

服务启动时扫描 `intake-operations.json`：

- PID 存活：重新挂载 watchdog；
- PID 已死亡且产物完整：进入 `draft_ready`；
- PID 已死亡且产物不完整：进入 `generation_failed`；
- 不得留下永久 `generating`。

- [ ] **Step 7: 编写反例测试**

至少包含：

1. 软超时后进程继续，最终进入 `draft_ready`。
2. 产物完成但进程不退出，终态为 `draft_ready`。
3. 只有一个产物，进入 `generation_failed`。
4. 非法 JSON，错误码为 `INTAKE_OUTPUT_INVALID`。
5. timeout 事件晚于 success，仍保持 `draft_ready`。
6. 同一 Draft 并发启动只产生一个 PID。
7. 后端重启后可以恢复遗留任务。

- [ ] **Step 8: 执行测试和提交**

```bash
cd agent-factory-dashboard/backend
npm run build
node tools/test-intake-lifecycle.js
npm run test:adu-intake
git add .gitignore agent-factory-dashboard scripts/agent_factory_bootstrap.py scripts/agent_factory_doctor.py
git commit -m "fix(intake): unify generation lifecycle and terminal state rules"
```

## 7. Task 4：Agent Runner 运行预算和进程收敛

覆盖：BUG-37-003、BUG-37-014。

**Files:**
- Create: `.ai-agent/policies/agent-run-policy.json`
- Create: `scripts/agent_run_policy.py`
- Modify: `scripts/hermes_agent_run.py`
- Modify: `scripts/hermes_agent_orchestrator.py`
- Modify: `scripts/hermes_epic_orchestrator.py`
- Modify: `scripts/agent_factory_bootstrap.py`
- Modify: `scripts/agent_factory_doctor.py`
- Test: `scripts/test_agent_run_policy.py`

- [ ] **Step 1: 定义分 Agent 运行策略**

```json
{
  "version": 1,
  "defaults": {
    "max_duration_seconds": 600,
    "no_progress_timeout_seconds": 180,
    "termination_grace_seconds": 5,
    "max_prompt_bytes": 120000,
    "max_estimated_input_tokens": 30000
  },
  "agents": {
    "adu-intake-agent": {
      "max_duration_seconds": 300,
      "no_progress_timeout_seconds": 120
    },
    "requirement-analyst": {
      "max_duration_seconds": 240,
      "no_progress_timeout_seconds": 90,
      "max_prompt_bytes": 60000,
      "max_estimated_input_tokens": 16000
    },
    "system-flow-designer": {
      "max_duration_seconds": 360
    },
    "developer": {
      "max_duration_seconds": 1200
    }
  }
}
```

- [ ] **Step 2: 实现策略加载和校验**

```py
@dataclass(frozen=True)
class AgentRunPolicy:
    max_duration_seconds: int
    no_progress_timeout_seconds: int
    termination_grace_seconds: int
    max_prompt_bytes: int
    max_estimated_input_tokens: int
```

非法负数、零时限、未知字段必须由 doctor 报错。

- [ ] **Step 3: 将 `subprocess.run` 改为受控 `Popen`**

主 Agent 调用使用：

```py
proc = subprocess.Popen(
    cmd,
    cwd=str(cwd_path),
    text=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    start_new_session=True,
)
```

watchdog 周期检查：

- 总运行时间；
- stdout/stderr 最近活动时间；
- 目标产物 mtime；
- orchestrator cancel/pause 标记。

超限时终止整个进程组：

```py
os.killpg(proc.pid, signal.SIGTERM)
...
os.killpg(proc.pid, signal.SIGKILL)
```

- [ ] **Step 4: 定义无进展**

满足任一条件都刷新 `last_progress_at`：

- stdout/stderr 有新字节；
- 目标产物新建或 mtime 变化；
- Hermes 输出可解析进度事件。

仅模型代理日志中的 HTTP 200 不算业务进展。

- [ ] **Step 5: 写入结构化终止结果**

超时结果：

```json
{
  "result": "failed",
  "error_code": "AGENT_RUN_TIMEOUT",
  "termination_reason": "max_duration_exceeded",
  "next_state": null
}
```

无进展结果：

```json
{
  "result": "failed",
  "error_code": "AGENT_NO_PROGRESS",
  "termination_reason": "no_progress_timeout",
  "next_state": null
}
```

ADU/Epic 状态不得推进，Operation 必须失败。

- [ ] **Step 6: 产物完成快速收敛**

Hermes CLI 仍以最终 JSON 为完成信号。Runner 解析到合法最终 JSON 后必须立即：

1. 写入 stdout/stderr；
2. 校验声明的 artifacts；
3. 更新 run record；
4. 返回退出码；
5. 不再执行额外 Agent 调用。

如 Hermes 子进程在最终输出后仍不退出，Runner 应在宽限期后终止它，但保留成功结果。

- [ ] **Step 7: 编写 Mock 进程测试**

测试脚本创建四类 Mock Hermes：

1. 立即成功并生成产物；
2. 持续输出但不生成产物；
3. 完全静默；
4. 生成最终 JSON 后不退出。

断言：

- 2 达到 max duration 后失败；
- 3 达到 no progress 后失败；
- 4 保留 success 并回收进程；
- 所有场景无孤儿进程。

- [ ] **Step 8: 执行测试和提交**

```bash
python3 scripts/test_agent_run_policy.py
python3 -m py_compile scripts/agent_run_policy.py scripts/hermes_agent_run.py \
  scripts/hermes_agent_orchestrator.py scripts/hermes_epic_orchestrator.py
git add .ai-agent/policies scripts
git commit -m "fix(runtime): enforce agent run budgets and process convergence"
```

## 8. Task 5：按 Agent 裁剪和去重上下文

覆盖：BUG-37-014，并降低 BUG-37-003 的复现概率。

**Files:**
- Create: `scripts/context_payload_builder.py`
- Modify: `scripts/hermes_agent_run.py`
- Modify: `.ai-agent/prompts/requirement-analyst-agent.md`
- Test: `scripts/test_context_payload_builder.py`

- [ ] **Step 1: 定义上下文层级**

```py
CONTEXT_LEVELS = {
    "requirement-analyst": "focused",
    "context-pack": "full",
    "detail-designer": "focused",
    "contract": "focused",
    "developer": "task",
    "code-reviewer": "task",
    "acceptance-reviewer": "task",
}
```

- [ ] **Step 2: 实现 focused context**

Requirement Analyst 只注入：

- ADU 核心字段；
- `clarifications`；
- parent Epic 的相关约束；
- 技术栈；
- allowed paths 对应模块；
-构建/测试命令；
- 命中的 risk paths；
- 每个知识文件不超过 2,000 字符的相关摘要。

不得重复注入：

- 完整 ADU 两次；
- `allowed_*_paths` 的多份副本；
- 与当前 ADU 无路径或关键词关联的知识段落。

- [ ] **Step 3: 增加 Prompt Manifest**

每次 run 写入：

```text
.ai-agent/runs/<run-id>/context-manifest.json
```

示例：

```json
{
  "agent": "requirement-analyst",
  "context_level": "focused",
  "prompt_bytes": 18240,
  "estimated_tokens": 4560,
  "sources": [
    {"path": ".agent-factory/project-profile.json", "bytes": 3200},
    {"path": ".agent-factory/knowledge/module-map.md", "bytes": 1800}
  ],
  "deduplicated_fields": ["adu.allowed_read_paths"]
}
```

- [ ] **Step 4: 增加大小硬门**

超过 `max_prompt_bytes` 时：

1. 先压缩知识包摘要；
2. 再移除非相关模块；
3. 仍超限则以 `CONTEXT_BUDGET_EXCEEDED` 失败；
4. 不调用模型。

- [ ] **Step 5: 测试 License ADU 样本**

使用 `ADU-1351-001` 的脱敏 fixture，断言：

- prompt 小于 60KB；
- 澄清答案全部存在；
- `lib/app`、Meson 和测试信息存在；
- 无关的 HA/5G-LAN 大段正文不进入 prompt；
- 相同 ADU JSON 不重复出现。

- [ ] **Step 6: 执行测试和提交**

```bash
python3 scripts/test_context_payload_builder.py
git add scripts/context_payload_builder.py scripts/hermes_agent_run.py \
  .ai-agent/prompts/requirement-analyst-agent.md
git commit -m "fix(context): build focused deduplicated agent payloads"
```

## 9. Task 6：Epic 澄清约束质量门

覆盖：BUG-37-008。

**Files:**
- Modify: `.ai-agent/prompts/system-flow-designer-agent.md`
- Modify: `scripts/hermes_agent_run.py`
- Modify: `scripts/validate_epic_flow.py`
- Create: `scripts/test_validate_epic_flow_clarifications.py`

- [ ] **Step 1: 将 clarifications 作为独立顶级输入**

Epic Runner payload 必须包含：

```json
{
  "epic": {},
  "clarifications": [
    {
      "question": "...",
      "answer": "...",
      "status": "answered",
      "impact": "design"
    }
  ]
}
```

不得只把澄清答案拼接到 `source_requirement`。

- [ ] **Step 2: 强化 Prompt**

加入硬规则：

```text
answered clarifications are immutable facts.
Do not repeat an answered clarification in open_questions.
Do not propose alternatives that contradict an answered clarification.
out_of_scope clarifications must remain outside all operations and acceptance points.
```

- [ ] **Step 3: 扩展 System Flow JSON**

增加：

```json
{
  "clarification_traceability": [
    {
      "question_hash": "sha256:...",
      "decision": "直接丢包",
      "applied_to": ["FLOW-UPF-THROUGHPUT", "A-UPF-OVERLIMIT"]
    }
  ]
}
```

- [ ] **Step 4: Validator 校验**

必须阻断：

1. answered 问题重新出现在 `open_questions`；
2. answered 澄清没有 traceability；
3. `out_of_scope` 内容进入 operation；
4. 明确枚举决策发生冲突。

对于自然语言冲突，Validator 使用确定性规则覆盖常见互斥词，并把无法确定的情况送人工 System Flow Review，不得静默通过。

- [ ] **Step 5: 反例测试**

至少覆盖：

- “直接丢包”后再次提出令牌桶问题；
- Fail-Closed 被改成 demo/fail-open；
- WebUI-only 被改成 Prometheus；
- 完整一致的设计通过。

- [ ] **Step 6: 执行测试和提交**

```bash
python3 scripts/test_validate_epic_flow_clarifications.py
python3 -m py_compile scripts/validate_epic_flow.py
git add .ai-agent/prompts/system-flow-designer-agent.md scripts
git commit -m "fix(epic): enforce clarification traceability in system flow"
```

## 10. Task 7：Splitter 依赖、覆盖范围和风险路径质量门

覆盖：BUG-37-010、BUG-37-011。

**Files:**
- Modify: `.ai-agent/prompts/adu-splitter-agent.md`
- Modify: `scripts/validate_epic_split_plan.py`
- Modify: `scripts/hermes_epic_orchestrator.py`
- Modify: `agent-factory-dashboard/backend/tools/test-epic-dag.js`
- Create: `scripts/test_validate_epic_split_semantics.py`

- [ ] **Step 1: 明确依赖语义**

保留兼容字段但在 Schema 中明确定义：

```json
{
  "from": "ADU-BASE",
  "to": "ADU-CONSUMER",
  "semantics": "prerequisite_to_dependent",
  "reason": "ADU-CONSUMER consumes the library produced by ADU-BASE"
}
```

物化后的 dependent ADU 必须生成：

```json
"depends_on": ["ADU-BASE"]
```

- [ ] **Step 2: 增加 acceptance coverage map**

Split Plan 增加：

```json
{
  "acceptance_coverage": [
    {
      "acceptance_id": "A-WEBUI-STATUS",
      "covered_by": ["ADU-002"],
      "required_paths": [
        "webui/src/pages/license/index.js",
        "webui/server/routes/license.js"
      ]
    }
  ]
}
```

每个 Epic acceptance point 必须至少由一个子 ADU 覆盖。

- [ ] **Step 3: 校验命令和写路径**

Validator 必须检查：

- required command 引用的项目内测试文件在 read/write path 中；
- 声称新增 UI 时至少包含页面/组件路径和后端 API 路径；
- 声称修改公共库时包含 build manifest；
- 候选路径命中项目画像高风险路径时，需要 `risk_justification` 和人工审核；
- 有低风险等价路径却无理由选择高风险路径时阻断。

- [ ] **Step 4: 修正依赖物化**

`materialize_child_adus()` 根据 `from -> to` 生成 `to.depends_on += from`，并验证结果与 split plan 一致。

- [ ] **Step 5: 反例测试**

必须包括：

1. 方向反转但 DAG 无环；
2. WebUI 需求只有 API 路径；
3. 测试命令引用未授权测试文件；
4. 使用 `lib/core` 但没有风险理由；
5. 四项全部正确的 License split plan。

- [ ] **Step 6: 执行测试和提交**

```bash
python3 scripts/test_validate_epic_split_semantics.py
cd agent-factory-dashboard/backend
npm run test:epic-dag
git add .ai-agent/prompts/adu-splitter-agent.md scripts \
  agent-factory-dashboard/backend/tools/test-epic-dag.js
git commit -m "fix(epic): validate split dependencies coverage and risk paths"
```

## 11. Task 8：物化动作和 Epic 状态聚合

覆盖：BUG-37-012、BUG-37-013。

**Files:**
- Modify: `agent-factory-dashboard/backend/src/application/operator/operator-control.ts`
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Modify: `agent-factory-dashboard/backend/src/application/epic-monitor.ts`
- Modify: `scripts/hermes_epic_orchestrator.py`
- Modify: `agent-factory-dashboard/frontend/src/api/agentFactory.ts`
- Modify: `agent-factory-dashboard/frontend/src/stores/agentFactory.ts`
- Modify: `agent-factory-dashboard/frontend/src/components/epics/EpicControlPanel.tsx`
- Create: `agent-factory-dashboard/backend/tools/test-epic-state-semantics.js`

- [ ] **Step 1: Epic Orchestrator 增加显式 mode**

CLI 支持：

```text
--mode materialize
```

该模式必须在一次进程中：

1. 接受 `split_decision` 或 `split_required`；
2. 读取并验证 split plan；
3. 将 decision 推进为 `split_required`；
4. 物化全部子 ADU；
5. 将 Epic 保存为 `child_adus_created`；
6. 输出 `child_adus_materialized` 事件；
7. 退出，不启动子 ADU。

- [ ] **Step 2: Operator 保留原始动作**

```ts
case 'materialize_child_adus':
  result = await runnerDelegate.spawnEpicOrchestrator(targetId, 'materialize');
  break;
```

Operation 中：

```json
{
  "action": "materialize_child_adus",
  "mode": "materialize"
}
```

- [ ] **Step 3: 修正聚合算法**

```py
if all(child["state"] == "created" for child in children):
    return "child_adus_created"
if any_active_operation or any(is_running_state(child["state"]) for child in children):
    return "child_adus_running"
```

`created` 不属于 running state。

- [ ] **Step 4: 前端按钮语义**

- `split_decision/split_required`：显示“生成子 ADU”；
- `child_adus_created`：显示“启动可运行子 ADU”；
- `child_adus_running`：显示当前运行数量；
- 按钮提交后立即显示 Operation，不允许重复点击。

- [ ] **Step 5: 集成测试**

1. 一次 materialize 请求创建全部子 ADU。
2. 审计 action 不退化为 `step`。
3. 四个 created 子 ADU得到 `child_adus_created`。
4. 一个子 ADU产生活动 Operation 后才进入 running。
5. 重复幂等调用不创建重复 ADU。

- [ ] **Step 6: 执行测试和提交**

```bash
cd agent-factory-dashboard/backend
npm run build
node tools/test-epic-state-semantics.js
cd ../frontend
npm run build
git add agent-factory-dashboard scripts/hermes_epic_orchestrator.py
git commit -m "fix(epic): make materialization atomic and correct child state aggregation"
```

## 12. Task 9：Operation 事件映射和进展可观测性

覆盖：BUG-37-009，并为 BUG-37-014 提供页面证据。

**Files:**
- Create: `agent-factory-dashboard/backend/src/application/runtime/orchestrator-event-mapper.ts`
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Modify: `agent-factory-dashboard/backend/src/application/orchestration-operation-store.ts`
- Modify: `scripts/hermes_agent_orchestrator.py`
- Modify: `scripts/hermes_epic_orchestrator.py`
- Modify: `agent-factory-dashboard/frontend/src/types/agent-factory.ts`
- Modify: `agent-factory-dashboard/frontend/src/components/operations/OperationStatusBanner.tsx`
- Modify: `agent-factory-dashboard/frontend/src/components/shared/OperationStatusPanel.tsx`
- Test: `agent-factory-dashboard/backend/tools/test-operation-events.js`

- [ ] **Step 1: 统一事件 Schema**

```json
{
  "event": "agent_started",
  "scope": "adu",
  "target_id": "ADU-...",
  "agent": "requirement-analyst",
  "state": "created",
  "run_id": "RUN-...",
  "timestamp": "...",
  "message": "Requirement Analyst started"
}
```

Epic 和 ADU 不再使用不同字段名表达同一事件。

- [ ] **Step 2: 集中事件映射**

```ts
export function mapOrchestratorEvent(
  event: Record<string, unknown>
): Partial<AgentFactoryOperation>;
```

映射规则：

- `agent_started` 更新 `current_agent/current_state/last_progress_at`；
- `state_changed` 更新 `current_state/last_progress_at`；
- `artifact_written` 更新 `last_progress_at`；
- `human_gate_opened` 更新 `status=waiting_human`；
- `agent_failed` 更新错误摘要；
- close 后保留 final agent/state。

- [ ] **Step 3: 补充 Operation 字段**

```ts
last_progress_at: string | null;
termination_reason: string | null;
prompt_bytes: number | null;
estimated_input_tokens: number | null;
```

- [ ] **Step 4: 修复未换行和残留 buffer**

stdout parser 必须处理：

- NDJSON；
-最后一行无换行；
- pretty JSON 最终结果；
- 非 JSON 行作为 `stdout_raw` 保存。

- [ ] **Step 5: 页面展示**

运行状态至少显示：

- 当前 Agent；
- 当前状态；
- 已运行时长；
- 距离最近进展的时间；
- prompt bytes / estimated tokens；
-停止原因。

- [ ] **Step 6: 测试和提交**

```bash
cd agent-factory-dashboard/backend
node tools/test-operation-events.js
npm run build
cd ../frontend
npm run build
git add agent-factory-dashboard scripts/hermes_agent_orchestrator.py \
  scripts/hermes_epic_orchestrator.py
git commit -m "fix(operations): normalize events and expose live agent progress"
```

## 13. Task 10：死锁回收和 owner-safe 清理

覆盖：BUG-37-015。

**Files:**
- Modify: `agent-factory-dashboard/backend/src/infrastructure/registry-lock.ts`
- Modify: `agent-factory-dashboard/backend/src/infrastructure/operator/operator-lock-service.ts`
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Modify: `scripts/registry_lock.py`
- Modify: `scripts/hermes_agent_orchestrator.py`
- Modify: `scripts/hermes_epic_orchestrator.py`
- Modify: `agent-factory-dashboard/backend/tools/test-phase37-bugs.js`

- [ ] **Step 1: 锁结构增加 owner token**

```json
{
  "pid": 12345,
  "owner": "uuid",
  "heartbeat_at": "...",
  "created_at": "..."
}
```

- [ ] **Step 2: 定义锁有效性**

锁有效必须同时满足：

```text
PID alive AND heartbeat fresh
```

处理规则：

- PID dead：可立即回收；
- PID alive + heartbeat fresh：有效；
- PID alive + heartbeat stale：不得直接删除，先报告 lock health 异常；
- JSON 解析失败且文件年龄小于 30 秒：不得删除；
- JSON 解析失败且文件较旧：进入隔离重命名后重建。

- [ ] **Step 3: owner-safe 释放**

```ts
releaseLock(path, ownerToken)
```

只有磁盘 owner 与调用方 owner 相同时才删除。Python 使用相同规则。

- [ ] **Step 4: Signal 和 close 清理**

Python Orchestrator 在 `finally` 中释放锁；Node child close 只能作为兜底，并且必须验证 owner token。

- [ ] **Step 5: 反例测试**

1. dead PID + fresh heartbeat 立即回收；
2. live PID + stale heartbeat 不误删；
3. 旧进程 close 不删除新 owner 的锁；
4. Node 与 Python 竞争时只有一个持有者；
5. Agent 被 SIGTERM 后可以立即重试。

- [ ] **Step 6: 执行测试和提交**

```bash
cd agent-factory-dashboard/backend
node tools/test-phase37-bugs.js
python3 ../../scripts/test_agent_factory_operator.py
git add agent-factory-dashboard scripts
git commit -m "fix(locking): reclaim dead process locks with owner-safe release"
```

## 14. Task 11：前端注册刷新、运行反馈和按钮防重

覆盖：BUG-37-007，并补齐 BUG-37-009、BUG-37-012 的用户体验。

**Files:**
- Modify: `agent-factory-dashboard/frontend/src/components/operator/RequirementWorkbench.tsx`
- Modify: `agent-factory-dashboard/frontend/src/components/operator/OperatorConsolePage.tsx`
- Modify: `agent-factory-dashboard/frontend/src/stores/agentFactory.ts`
- Modify: `agent-factory-dashboard/frontend/src/components/epics/EpicsPage.tsx`
- Modify: `agent-factory-dashboard/frontend/src/components/epics/EpicControlPanel.tsx`
- Modify: `agent-factory-dashboard/frontend/src/hooks/useWebSocket.ts`
- Modify: `agent-factory-dashboard/frontend/tools/test-navigation.mjs`

- [ ] **Step 1: 注册成功后刷新并选中**

Epic 注册响应必须返回：

```json
{
  "epic": {
    "id": "EPIC-..."
  }
}
```

前端顺序执行：

```ts
await refreshEpics();
selectEpic(epicId);
navigateTo('epics');
```

- [ ] **Step 2: WebSocket 事件刷新**

收到以下事件时刷新：

```text
epic_created
child_adus_materialized
operation_started
operation_finished
epic_state_changed
```

必须去抖，避免事件风暴。

- [ ] **Step 3: 按钮防重**

开始请求后立即进入本地 submitting；收到 Operation 后改为 running。以下任一条件存在时禁用重复动作：

- submitting；
- active Operation；
- active lock；
- API 返回 409。

- [ ] **Step 4: 显示结构化错误**

根据 `error_code` 提供明确操作：

- `INTAKE_SOFT_TIMEOUT`：显示“后台继续生成”；
- `INTAKE_ALREADY_RUNNING`：跳转已有任务；
- `AGENT_RUN_TIMEOUT`：显示停止原因和重试建议；
- `RUNTIME_INCOMPATIBLE`：要求重启或更新后端。

- [ ] **Step 5: 自动化和手工测试**

自动测试覆盖注册后导航和按钮防重。手工验收：

1. 注册 Epic 后无需刷新；
2. 物化按钮点击一次后立即禁用；
3. 页面能显示当前 Agent；
4. 后端旧版本时显示兼容性告警。

- [ ] **Step 6: 提交**

```bash
cd agent-factory-dashboard/frontend
npm run build
node tools/test-navigation.mjs
git add agent-factory-dashboard/frontend
git commit -m "fix(ui): refresh registered epics and show reliable operation state"
```

## 15. Task 12：全量回归、真实需求复验和发布门禁

**Files:**
- Modify: `agent-factory-dashboard/backend/package.json`
- Modify: `agent-factory-dashboard/backend/tools/test-phase37-regression.js`
- Modify: `docs/superpowers/debugging/2026-06-19-agent-factory-phase3-7-debug-bug-log.md`
- Create: `docs/superpowers/verification/2026-06-19-phase3-7-bugfix-verification.md`

- [ ] **Step 1: 运行专项测试**

```bash
cd agent-factory-dashboard/backend
npm run test:phase37-regression
npm run test:operator
```

Expected: 全部 PASS。

- [ ] **Step 2: 运行现有回归**

```bash
npm run test:adu-intake
npm run test:project-adu
npm run test:review-gate
npm run test:quality-gates
npm run test:epic-factory
npm run test:epic-dag
npm run check:portable
npm run doctor -- --skip-hermes
```

Onboarding 若依赖真实模型，必须使用已存在的 Mock Hermes 模式；CI 不得依赖外部付费模型。

- [ ] **Step 3: 构建和语法检查**

```bash
cd agent-factory-dashboard/backend
npm run build
cd ../frontend
npm run build
cd ../..
python3 -m py_compile scripts/*.py
git diff --check
```

- [ ] **Step 4: 使用 License Epic 做真实复验**

重新创建独立测试 Epic，不直接修改历史 `EPIC-2026-1351`。依次验证：

1. Intake 超过 30 秒后返回 202，后台继续；
2. Draft 完成后自动进入 `draft_ready`；
3. 注册 Epic 后立即显示；
4. System Flow 严格遵循 8 条澄清；
5. Split Plan 依赖方向、UI 路径和测试路径正确；
6. 一次操作物化四个子 ADU；
7. Epic 停在 `child_adus_created`；
8. Requirement Analyst prompt 小于 60KB；
9. Requirement Analyst 在 240 秒内完成，或以明确超时失败；
10. 页面显示当前 Agent、状态、最近进展和终止原因；
11. 异常终止后可立即重试，无残留锁。

- [ ] **Step 5: 更新 Bug 台账**

每个 Bug 只能在具备以下证据后改为 `Verified`：

- 对应自动化用例；
- 构建通过；
- 真实 License Epic 复验结果；
- 运行记录或截图路径。

- [ ] **Step 6: 最终提交**

```bash
git add agent-factory-dashboard scripts .ai-agent/policies \
  docs/superpowers/debugging docs/superpowers/verification .gitignore
git commit -m "fix(agent-factory): close phase 3.7 runtime and epic workflow defects"
```

## 16. 必须增加的发布门禁

以下任何一项失败都不得宣布修复完成：

1. `npm run test:phase37-regression` 非零。
2. 存在 Agent 进程超时后仍存活。
3. 存在 ADU/Epic 状态在 Agent 失败后错误推进。
4. Intake 产物完整但状态不是 `draft_ready`。
5. 四个未启动子 ADU仍显示 `child_adus_running`。
6. `materialize_child_adus` 需要调用两次。
7. Requirement Analyst prompt 超过策略上限仍调用模型。
8. System Flow 可以违反 answered clarification。
9. Split Plan 依赖方向反转仍通过。
10. 死 PID 锁阻断立即重试。
11. 前后端构建失败。
12. `git diff --check` 失败。

## 17. Antigravity 执行要求

1. 按 Task 1 至 Task 12 顺序执行，不允许先改页面后补运行时。
2. 每个 Task 先写失败测试，再写实现。
3. 不得删除或弱化现有质量门以使测试通过。
4. 不得通过提高所有超时时间掩盖无进展问题。
5. 不得把本机绝对路径写入源码、测试或文档 fixture。
6. 不得使用真实生产 Registry 运行测试。
7. 所有测试使用临时工作区及 `AGENT_FACTORY_REGISTRY_DIR` 隔离。
8. 每个 Task 独立提交，提交信息使用本计划给出的语义。
9. 完成后提交：
   - `task.md`；
   - `walkthrough.md`；
   - 全部测试命令和真实输出摘要；
   - 15 项 Bug 的逐项证据映射。
10. “构建通过”不能替代真实状态机反例测试。

## 18. 最终验收矩阵

| Bug | 自动测试 | 真实复验 |
|---|---|---|
| BUG-37-001 | runtime contract | 旧后端显示不兼容 |
| BUG-37-002 | soft timeout | Intake 202 后继续 |
| BUG-37-003 | final-output hang mock | 产物后进程退出 |
| BUG-37-004 | hard timeout/recovery | 无永久 generating |
| BUG-37-005 | late-event race | 终态不回退 |
| BUG-37-006 | structured error | 页面显示可操作错误 |
| BUG-37-007 | navigation test | Epic 自动显示并选中 |
| BUG-37-008 | clarification conflict | 8 条澄清全部落地 |
| BUG-37-009 | event mapper | 页面显示当前 Agent |
| BUG-37-010 | reverse-edge negative | License DAG 正确 |
| BUG-37-011 | coverage/risk negative | UI/测试路径齐全 |
| BUG-37-012 | atomic materialize | 一次生成四个 ADU |
| BUG-37-013 | created-children negative | Epic 状态为 `child_adus_created` |
| BUG-37-014 | timeout/no-progress mock | Analyst 有界执行 |
| BUG-37-015 | dead-PID lock test | 异常后立即重试 |

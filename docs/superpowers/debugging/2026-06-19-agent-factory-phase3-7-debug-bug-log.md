# Agent Factory Phase 3.7 调试缺陷台账

## 1. 文档目的

本文档用于持续记录 Agent Factory Phase 3.7 在真实需求开发过程中的缺陷、运行异常、临时处置和修复进度。

本文档是动态调试台账，不替代正式设计文档、实施计划或测试报告。后续调试发现的新问题应继续追加到本文档中，并保留问题从发现、分析、修复到复验的完整记录。

## 2. 基本信息

| 项目 | 内容 |
|---|---|
| 首次记录日期 | 2026-06-19 |
| Agent Factory 版本 | Phase 3.7 |
| 被测项目 | Open5GS |
| 测试需求 | License 文件、签约用户数量限制、UPF 总吞吐率限制 |
| Intake Draft ID | `DRAFT-20260619-eccab08a` |
| Epic ID | `EPIC-2026-1351` |
| Dashboard | `http://localhost:5175/` |
| Backend | `http://localhost:3011/` |
| 测试方式 | Codex 通过 Phase 3.7 Operator API 分步骤驱动，用户在页面逐步检查 |

## 3. 严重级别

| 级别 | 定义 |
|---|---|
| P0 | 数据破坏、安全事故或整个 Agent Factory 不可用 |
| P1 | 主流程无法继续、错误推进状态或产生不可控 Token 消耗 |
| P2 | 功能可以继续使用，但需要人工恢复、刷新或绕行 |
| P3 | 展示、提示、日志或易用性问题 |

## 4. 状态定义

| 状态 | 定义 |
|---|---|
| Open | 已确认问题，尚未修复 |
| Analyzing | 正在分析根因 |
| Planned | 已有修复方案，尚未开发 |
| Fixing | 正在开发修复 |
| Fixed | 已完成修改，尚未独立复验 |
| Verified | 已通过正例、反例和回归测试 |
| Deferred | 明确延期处理，并已记录风险 |

## 5. 本轮调试结论

本轮测试验证了 Phase 3.7 Operator API 的基础能力，但暴露出 Intake 生命周期管理不完整的问题。最主要的风险不是模型调用失败，而是 Agent 已生成有效产物后仍不退出，导致同步接口误判超时、异步接口长期占用进程并继续消耗 Token。

建议优先修复 BUG-37-002 至 BUG-37-005，再继续用真实大型需求验证 Phase 3.7。

## 6. 缺陷清单

| ID | 级别 | 标题 | 状态 | 影响范围 |
|---|---|---|---|---|
| BUG-37-001 | P2 | 运行中的后端不是最新构建，Phase 3.7 API 返回 404 | Verified | 部署、自举、版本可观测性 |
| BUG-37-002 | P1 | 同步 Intake 固定 180 秒超时，误杀正常长任务 | Verified | Operator Intake、需求草案生成 |
| BUG-37-003 | P1 | Intake 产物完成后 Hermes 仍继续运行并消耗 Token | Verified | Hermes Runner、Token 成本 |
| BUG-37-004 | P1 | 异步 Intake 无最大时长和进程收敛保护 | Verified | 异步任务、孤儿进程 |
| BUG-37-005 | P1 | 已有完整产物仍被标记为 `generation_failed` 或停留在 `generating` | Verified | 状态一致性、草案注册 |
| BUG-37-006 | P2 | Operator Intake 错误被统一返回为 `Internal server error` | Verified | API 错误语义、页面提示 |
| BUG-37-007 | P2 | 新注册 Epic 不会立即出现在 Epic 页面 | Verified | 前端 Store、实时刷新 |
| BUG-37-008 | P1 | System Flow 重新提出已由用户澄清的问题并产生冲突设计 | Verified | 澄清传递、设计质量门 |
| BUG-37-009 | P2 | Epic Operation 运行期间不更新 `current_agent/current_state` | Verified | 运行监控、页面状态 |
| BUG-37-010 | P1 | Splitter 生成的依赖边方向与编排器语义相反 | Verified | Epic DAG、子 ADU 调度 |
| BUG-37-011 | P1 | Splitter 遗漏前端页面和测试文件写路径，并选中高风险 `lib/core` | Verified | 拆分完整性、路径策略 |
| BUG-37-012 | P2 | `materialize_child_adus` 需要执行两次且审计动作被记录为 `step` | Verified | Operator 语义、幂等审计 |
| BUG-37-013 | P1 | 子 ADU 全部未启动时 Epic 被标记为 `child_adus_running` | Verified | Epic 状态聚合、页面误导 |
| BUG-37-014 | P1 | Requirement Analyst 无运行上限，连续调用模型但不生成产物 | Verified | Agent Runner、Token 成本、步骤执行 |
| BUG-37-015 | P2 | Agent 异常终止后残留锁仍按心跳存活 30 分钟 | Verified | 锁回收、失败恢复、重试 |

---

## BUG-37-001：运行中的后端不是最新构建

### 现象

Phase 3.7 专项测试和 TypeScript 构建均通过，但访问以下真实接口时返回 `404 Cannot GET`：

```text
GET /api/agent-factory/operator/adu/REQ-2026-6559/next-action
GET /api/agent-factory/operator/adu/REQ-2026-6559/handoff
```

### 根因

端口 `3011` 上运行的是旧版后端进程。源码和 `dist/` 已包含 Phase 3.7 路由，但运行中的进程没有加载最新构建。

### 临时处置

1. 执行后端构建：

   ```bash
   cd agent-factory-dashboard/backend
   npm run build
   ```

2. 停止旧进程。
3. 使用控制模式启动最新后端：

   ```bash
   AGENT_FACTORY_ENABLE_CONTROL=true npm run start
   ```

4. 复验两个接口均返回 HTTP `200`。

### 修复建议

1. 后端增加 `/api/agent-factory/version` 或扩展 `/health`，返回：
   - Git commit；
   - 构建时间；
   - Phase 版本；
   - `enableControl`；
   - 已注册 Operator 路由版本。
2. 前端启动后校验最低兼容版本，不兼容时显示明确告警。
3. 部署脚本统一执行“构建、停止旧进程、启动新进程、健康检查”。
4. 禁止仅凭端口处于 LISTEN 状态判定服务为最新版本。

### 验收标准

- 启动旧版后端时，页面明确显示版本不兼容。
- 发布脚本执行后，Phase 3.7 Operator API 必须通过健康探针。
- `/health` 可区分源码版本、构建版本和运行版本。

---

## BUG-37-002：同步 Intake 固定 180 秒超时

### 现象

提交 Open5GS License 需求后，Operator Intake 请求约 180 秒后返回：

```json
{
  "success": false,
  "error": "Internal server error"
}
```

后端日志显示：

```text
[AduIntake] generation timed out for DRAFT-20260619-eccab08a after 180000ms
Draft generation timed out after 3 minutes
```

### 根因

`AduIntake.generateDraftSync()` 使用固定的默认超时：

```text
INTAKE_TIMEOUT_MS = 180000
```

超时判断只依据子进程是否退出，没有检查 `draft.json` 和 `intake-report.md` 是否已经完整生成。

### 影响

- 正常但耗时超过 3 分钟的需求分析被误判失败。
- API 请求长时间阻塞后只返回通用错误。
- 用户可能重复提交需求，产生重复草案和额外 Token 消耗。

### 临时处置

改用异步生成接口，并复用原 Draft ID：

```text
POST /api/agent-factory/intake-drafts/{draftId}/generate
GET  /api/agent-factory/intake-drafts/{draftId}
```

### 推荐修复

同步和异步接口必须共用统一的 `IntakeGenerationService`：

1. 同步接口只负责提交任务并等待有限时间，不直接拥有子进程生命周期。
2. 超时后返回 `202 Accepted` 和 Draft ID，而不是将任务标记失败。
3. 若产物已完整生成，应立即进入校验阶段并转为 `draft_ready`。
4. 超时信息必须使用实际配置值，不能固定写成“三分钟”。

### 验收标准

- Agent 超过 HTTP 等待时间但仍在运行时，接口返回 `202`。
- 超时不会将有效任务标记为 `generation_failed`。
- 重复请求同一 Draft ID 不会启动第二个 Agent。

---

## BUG-37-003：产物完成后 Hermes 仍继续运行

### 现象

以下文件已生成且内容完整：

```text
open5gs/.ai-agent/intake/DRAFT-20260619-eccab08a/draft.json
open5gs/.ai-agent/intake/DRAFT-20260619-eccab08a/intake-report.md
```

文件生成后，`adu-intake-agent` 仍持续调用模型。Hermes 日志显示多次 `POST /chat/completions HTTP/1.1 200`。

### 根因

当前完成条件依赖 Hermes CLI 子进程自然退出。系统没有独立的“有效产物已经完成”完成信号，也没有最大推理轮次或最大模型调用数。

### 影响

- 无意义地继续消耗输入和输出 Token。
- 子进程长时间占用资源。
- Node 端无法区分“已完成但未退出”和“仍在生成”。

### 临时处置

确认两个产物完整后，人工终止以下进程树：

```text
hermes_agent_run.py
└── hermes --profile coding ... adu-intake-agent
```

### 推荐修复

1. `hermes_agent_run.py` 在解析出符合 Schema 的最终 JSON 后立即：
   - 原子写入两个产物；
   - 写入 `completion.json`；
   - 输出单行 NDJSON `intake_completed` 事件；
   - 以退出码 `0` 退出。
2. 为 Intake Agent 配置最大模型调用次数和最大总 Token。
3. Node 端观察到有效完成事件后，不再等待 Hermes 自然收尾。
4. 若 Hermes 不退出，先发送 `SIGTERM`，宽限期后发送 `SIGKILL`。

### 验收标准

- 最终产物写入后 5 秒内 Agent 进程退出。
- 完成后的模型调用次数为零。
- 运行记录包含模型调用次数、Token 使用量和终止原因。

---

## BUG-37-004：异步 Intake 无最大时长和进程收敛保护

### 现象

切换到异步生成后，草案已经生成，但状态长期停留在：

```text
generating
```

异步执行没有超时计时器，也不会主动检查产物完成状态。

### 根因

`AduIntake.generateDraft()` 与 `generateDraftSync()` 分别实现了两套不同的生命周期逻辑：

- 同步版本有固定超时；
- 异步版本无超时；
- 两者都以 `child.close` 作为主要完成依据；
- 没有统一的进程树终止和状态收敛逻辑。

### 推荐修复

1. 删除同步和异步路径中的重复 spawn 逻辑。
2. 建立统一任务对象：

```json
{
  "draft_id": "DRAFT-...",
  "status": "generating",
  "pid": 1234,
  "started_at": "...",
  "soft_deadline_at": "...",
  "hard_deadline_at": "...",
  "artifact_completed_at": null,
  "model_calls": 0,
  "termination_reason": null
}
```

3. 设置两级超时：
   - Soft timeout：停止 HTTP 同步等待，但后台继续；
   - Hard timeout：终止整个进程组并将任务标记失败。
4. 后端重启时扫描并恢复或关闭遗留任务。

### 验收标准

- 异步 Intake 不会无限运行。
- 后端重启后不存在无人管理的 Hermes 子进程。
- 一个 Draft ID 同时最多存在一个活动生成任务。

---

## BUG-37-005：产物状态与实际结果不一致

### 现象

本轮出现了两种不一致：

1. `draft.json` 已存在且完整，但同步接口将状态写为 `generation_failed`。
2. `draft.json` 和 `intake-report.md` 均已存在，但异步状态仍为 `generating`。

### 根因

状态机将“进程退出状态”作为事实来源，而不是将“产物完整性校验结果”作为事实来源。同步超时还会无条件覆盖草案状态。

### 临时处置

在确认文件完整后，人工将注册表恢复为：

```json
{
  "status": "draft_ready",
  "title": "Open5GS 核心网及 UPF 用户面 License 限制功能草案"
}
```

### 推荐状态机

```text
created
  -> queued
  -> generating
  -> validating
  -> draft_ready

generating/validating
  -> generation_failed
  -> canceled
```

状态转换规则：

1. 只有完成 Schema 和安全校验后才能进入 `draft_ready`。
2. 已进入 `draft_ready` 后，超时或迟到的进程事件不得覆盖状态。
3. `generation_failed` 必须记录失败阶段和错误分类。
4. 注册操作只接受 `draft_ready`。

### 验收标准

- 构造“产物完成但进程不退出”的场景，最终状态必须是 `draft_ready`。
- 构造“只有一个产物文件”的场景，最终状态必须是 `generation_failed`。
- 迟到的 `close`、`timeout` 和 `error` 事件不能覆盖终态。

---

## BUG-37-006：API 错误被隐藏为 Internal Server Error

### 现象

实际错误为：

```text
Draft generation timed out after 3 minutes
```

客户端收到的却是：

```text
Internal server error
```

### 影响

- 用户无法判断是否应该等待、重试或修改需求。
- 页面无法提供可操作的恢复入口。
- 调试必须进入后端日志。

### 推荐修复

定义稳定的错误码：

| error_code | HTTP | 含义 |
|---|---:|---|
| `INTAKE_SOFT_TIMEOUT` | 202 | 同步等待结束，后台仍在生成 |
| `INTAKE_HARD_TIMEOUT` | 504 | 达到硬超时并终止 |
| `INTAKE_AGENT_FAILED` | 502 | Hermes 或模型调用失败 |
| `INTAKE_OUTPUT_INVALID` | 422 | Agent 输出或产物 Schema 无效 |
| `INTAKE_ALREADY_RUNNING` | 409 | 同一草案已有活动任务 |
| `INTAKE_CANCELED` | 409 | 任务已取消 |

错误响应至少包含：

```json
{
  "success": false,
  "error_code": "INTAKE_SOFT_TIMEOUT",
  "message": "同步等待已结束，草案仍在后台生成",
  "draft_id": "DRAFT-...",
  "status": "generating",
  "retryable": true
}
```

---

## BUG-37-007：新注册 Epic 不会立即显示

### 现象

后端成功注册 `EPIC-2026-1351` 后，切换到 Epic 编排页面仍显示：

```text
0 Epics
暂无 Epic
```

浏览器整页刷新后，Epic 列表才显示为 3 条，并出现新 Epic。

### 根因初判

Epic 页面首次挂载或切换时使用了旧 Store 快照，没有在注册成功事件或页面激活时重新获取 Epic 列表。

### 临时处置

刷新整个页面。

### 推荐修复

1. Epic 注册成功后立即调用 `refreshEpics()`。
2. WebSocket 收到 `epic_created` 事件时刷新列表。
3. 切换到 Epic 页面时，如果数据超过轮询周期或尚未加载，执行一次刷新。
4. 注册成功后可直接导航并选中新 Epic。

### 验收标准

- 注册 Epic 后无需刷新页面，5 秒内出现在列表中。
- 新 Epic 自动处于选中状态。
- 不允许出现后端已创建但页面仍显示 0 条的状态。

---

## BUG-37-008：System Flow 未严格遵守用户澄清

### 现象

用户在 Epic 注册前已经明确回答：

```text
当 UPF 吞吐率超过 License 上限时直接丢包。
```

`system-flow-designer` 生成的设计仍包含：

```text
采用滑动窗口或令牌桶算法
```

并在 `open_questions` 中再次询问：

```text
使用简易 1s 累加窗口还是令牌桶/漏桶算法
```

### 根因初判

Epic 的 `source_requirement` 和 `clarifications` 已包含用户答案，但 System Flow Prompt 只声明 Project Context 为事实来源，没有建立“用户澄清优先级高于 Agent 建议”的硬约束。Validator 只检查 JSON 结构，没有检查设计是否与澄清答案冲突。

### 影响

- 已确认的业务决策被重新打开。
- 后续 `adu-splitter` 可能基于错误或模糊设计拆分子 ADU。
- Developer 可能实现用户已明确拒绝的令牌桶方案。

### 推荐修复

1. 在 `system-flow-designer-agent.md` 中加入硬规则：
   - `clarifications` 是不可覆盖的事实约束；
   - 已回答问题不得重新出现在 `open_questions`；
   - 设计不得提供与已回答约束冲突的备选方案。
2. 在 System Flow Payload 中增加独立的 `clarifications` 顶级字段，不只拼接在自然语言需求中。
3. 扩展 `validate_epic_flow.py`：
   - 加载 Epic 的结构化 `clarifications`；
   - 检查 `open_questions` 是否与已回答问题重复；
   - 检查关键决策关键词是否出现明显冲突。
4. 在进入 `adu-splitter` 前增加人工 System Flow 审核门。

### 验收标准

- “直接丢包”已确认时，产物不得再次提出令牌桶作为未决方案。
- 所有 `answered` 澄清都能在系统链路设计中找到对应落点。
- 反例测试构造冲突设计时 Validator 必须失败。

---

## BUG-37-009：Operation 当前 Agent 和状态为空

### 现象

`system-flow-designer` 已经启动，Operation Events 中明确存在：

```text
epic_agent_started: system-flow-designer
```

但 Operation 主对象在整个运行期间保持：

```json
{
  "current_agent": null,
  "current_state": null,
  "status": "running"
}
```

### 影响

- 页面无法可靠展示当前正在运行的 Agent。
- 用户只能通过事件时间线推断运行阶段。
- Phase 3.7 的“对话驱动 + 页面检查”模式缺少清晰的实时反馈。

### 推荐修复

1. 后端解析 `epic_agent_started` 时同步更新：

   ```json
   {
     "current_agent": "system-flow-designer",
     "current_state": "created"
   }
   ```

2. 解析 `epic_state_changed` 时更新 `current_state`。
3. Operation 完成后保留最终 Agent 和最终状态，不能清空。
4. 前端运行状态 Banner 优先读取 Operation 主字段，事件流作为补充。

### 验收标准

- Agent 启动事件到达后 1 秒内，Operation API 返回正确 `current_agent`。
- 状态转换事件到达后，页面无需刷新即可显示新状态。
- ADU 和 Epic Operation 使用相同字段语义。

---

## BUG-37-010：Splitter 依赖边方向错误

### 现象

拆分报告文字明确表示 `ADU-1351-003` 和 `ADU-1351-004` 依赖 `ADU-1351-001`，但 JSON 输出为：

```json
{
  "from": "ADU-1351-003",
  "to": "ADU-1351-001"
}
```

编排器的真实语义为 `to` 依赖 `from`，因此该配置会使基础库错误地依赖 UPF/UDR 子任务。

### 根因

Splitter Prompt 没有明确依赖边方向。`validate_epic_split_plan.py` 只验证节点存在和无环，不验证依赖语义是否与文字原因及子任务目标一致。

### 临时处置

将依赖改为：

```text
ADU-1351-001 -> ADU-1351-002
ADU-1351-001 -> ADU-1351-003
ADU-1351-001 -> ADU-1351-004
```

### 修复建议

1. Splitter Prompt 明确定义：`from` 是 prerequisite，`to` 是 dependent。
2. JSON Schema 将字段改名为 `prerequisite` 和 `dependent`，减少歧义。
3. Validator 根据 `reason`、`goal` 和 `depends_on` 生成结果做一致性检查。
4. 增加“依赖方向反转但仍无环”的反例测试。

---

## BUG-37-011：Splitter 范围和写路径不完整

### 现象

初始拆分计划存在三类遗漏：

1. 将共享 License 库放入项目画像明确标为高风险的 `lib/core/`。
2. WebUI 子任务只包含后端 API，没有包含用户要求的 License 状态页面。
3. 多个子任务要求生成或运行测试脚本，但 `allowed_write_paths` 没有包含对应测试文件。

### 影响

- 后续 Contract 或 Developer 会触发不必要的写路径人工门。
- 即使所有子 ADU 完成，仍可能缺失 WebUI 状态页面。
- 修改 `lib/core` 会放大核心基础设施风险。

### 临时处置

1. 将共享 C License 库移动至 `lib/app/ogs-license.c/.h`。
2. 补齐 `lib/app/meson.build`、`lib/app/ogs-app.h` 和单元测试路径。
3. 将 WebUI License 页面、Container、Sidebar 和状态模块加入 ADU-002。
4. 为 ADU-002/003/004 增加明确的测试文件写路径。

### 修复建议

1. Splitter 必须将 acceptance point 映射到至少一个子 ADU 的写路径和验收摘要。
2. Required command 引用的测试文件必须自动加入写路径。
3. 高风险路径必须优先寻找低风险等价落点；无法避免时进入人工审核。
4. 增加“要求页面但拆分只有 API”“测试命令引用未授权文件”的反例测试。

---

## BUG-37-012：物化动作语义退化为两次 step

### 现象

在 Epic 状态为 `split_decision` 时调用：

```text
POST /operator/epic/{id}/actions
action=materialize_child_adus
```

第一次调用只将状态推进至 `split_required`，没有创建子 ADU。Operation 的 `action` 和 `mode` 还被记录为 `step`。随后必须再次调用专用物化端点，子 ADU 才真正创建。

### 影响

- 用户认为物化成功，但页面仍无子 ADU。
- Operator 审计记录无法区分普通单步和物化动作。
- 相同幂等键重试时可能直接返回第一次的非物化结果。

### 修复建议

1. `materialize_child_adus` 必须是独立 Orchestrator mode。
2. 该动作应在一次调用内完成：
   - 确认或推进 `split_decision -> split_required`；
   - 校验 split plan；
   - 物化全部子 ADU；
   - 停止在 `child_adus_created`。
3. Operation 和审计日志保留原始动作名称。
4. 增加一次调用完成物化的集成测试。

---

## BUG-37-013：未启动子 ADU 被聚合为运行中

### 现象

物化完成后四个子 ADU 均为：

```text
state=created
runs=0
latest_run=null
```

但 Epic 被保存并展示为：

```text
state=child_adus_running
health=Child ADUs are executing
```

### 影响

- 用户无法区分“仅已创建”和“正在执行”。
- 页面会错误暗示 Agent 已经开始修改代码。
- 操作按钮的启用条件可能基于错误状态。

### 修复建议

1. 保留独立状态 `child_adus_created`，直到至少一个子 ADU 离开 `created`。
2. `aggregate_epic_state()` 只有检测到活动 Operation 或子 ADU 处于执行中间态时才能返回 `child_adus_running`。
3. Epic Monitor 不得将 `created` 子 ADU计入 running。
4. 增加“4 个 created、0 runs”反例，断言 Epic 状态为 `child_adus_created`。

## 7. 推荐修复优先级

### 第一批：P1 Intake 生命周期闭环

1. BUG-37-003：产物完成后立即停止 Agent。
2. BUG-37-005：以产物校验结果驱动终态。
3. BUG-37-004：同步和异步共用生命周期管理。
4. BUG-37-002：同步超时改为软超时。
5. BUG-37-008：澄清约束进入 System Flow 质量门。

### 第二批：可观测性与操作恢复

1. BUG-37-006：结构化错误码。
2. BUG-37-001：运行版本探针。
3. BUG-37-007：Epic 列表实时刷新。
4. BUG-37-009：Operation 当前 Agent 和状态实时更新。

## 8. 必须新增的自动化测试

### Intake 生命周期反例

1. Agent 已生成两个有效产物但不退出：
   - 预期状态：`draft_ready`；
   - 预期行为：Node 终止进程树；
   - 不得标记为失败。
2. Agent 超过同步等待时间但仍正常运行：
   - 预期 HTTP：`202`；
   - 后台任务继续；
   - 不启动重复任务。
3. Agent 达到硬超时且没有完整产物：
   - 预期状态：`generation_failed`；
   - 进程树全部结束。
4. 只生成 `draft.json`：
   - 预期状态：`generation_failed`。
5. 生成非法 JSON：
   - 预期错误码：`INTAKE_OUTPUT_INVALID`。
6. 超时事件晚于成功事件到达：
   - 最终状态仍为 `draft_ready`。

### 页面与 API

1. Operator Intake 软超时返回结构化状态。
2. 新 Epic 注册成功后自动刷新并选中。
3. 旧版后端与前端版本不兼容时显示阻断告警。

## 9. 后续新增 Bug 模板

复制以下模板追加到“缺陷清单”和文档末尾：

```markdown
## BUG-37-XXX：缺陷标题

### 基本信息

- 发现日期：
- 发现步骤：
- 关联 Project：
- 关联 Draft / ADU / Epic：
- Agent：
- 严重级别：
- 当前状态：

### 现象

描述页面、API、状态机或 Agent 输出中的异常。

### 复现步骤

1.
2.
3.

### 期望结果

描述正确行为。

### 实际结果

描述实际行为，并附错误码、日志和状态。

### 证据

- API：
- 日志：
- 运行记录：
- 产物路径：

### 根因

只在有证据确认后填写；未确认时写“分析中”。

### 临时处置

记录本轮调试采用的安全恢复方式。

### 修复建议

列出代码边界、状态规则和错误处理要求。

### 测试要求

列出正例、反例和回归测试。

### 复验记录

- 复验日期：
- 构建版本：
- 测试结果：
- 验收结论：
```

## BUG-37-014：Requirement Analyst 无运行上限，连续调用模型但不生成产物

### 基本信息

- 发现日期：2026-06-19
- 发现步骤：步骤 6，单步运行 `requirement-analyst`
- 关联 Project：`open5gs`
- 关联 ADU：`ADU-1351-001`
- 关联 Epic：`EPIC-2026-1351`
- Operation：`op-ADU-1351-001-1781871846132`
- Agent：`requirement-analyst`
- 严重级别：P1
- 当前状态：Open

### 现象

通过 Operator API 单步启动 `requirement-analyst` 后，Agent 运行超过 6 分钟，Hermes 代理累计产生约 38 次成功模型请求，但目标需求分析文档始终没有生成：

```text
open5gs/.ai-agent/analysis/ADU-1351-001.md
```

运行目录中只有 `prompt.md`，没有 `stdout.md`、`stderr.md` 或结构化运行结果。

### 实际结果

- prompt 文件大小为 45,563 字节；
- Agent 使用 `google/gemini-3.5-flash`；
- prompt 同时注入完整 ADU、项目画像以及全部知识包正文；
- Operation 运行期间 `current_agent`、`current_state` 均为 `null`，事件列表为空；
- 进程不会按单步任务的合理时限自行收敛；
- 人工终止后 Operation 才更新为 `failed`，ADU 正确保持 `created`。

### 根因

当前 Runner 只对调用前的估算输入 Token 进行预算检查，没有针对一次 Agent 执行设置以下运行期边界：

1. 最大执行时长；
2. 最大模型调用次数；
3. 最大累计输入/输出 Token；
4. 首个有效产物的截止时间；
5. 长时间无进展的 watchdog。

此外，`requirement-analyst` 的任务范围较窄，但 Runner 无差别注入完整项目画像和所有知识包正文，放大了每轮调用成本，也增加了 Agent 在项目探索中循环的概率。

### 临时处置

1. 终止进程树：
   - Orchestrator PID `12501`；
   - Runner PID `12539`；
   - Hermes PID `12558`。
2. 确认进程全部退出。
3. 确认 ADU 状态仍为 `created`，没有错误推进。
4. 删除死亡进程遗留的锁文件。
5. 暂不直接重试，避免重复产生不可控 Token 消耗。

### 修复建议

1. 为所有 Agent 增加分角色的运行预算：
   - `max_duration_seconds`；
   - `max_model_calls`；
   - `max_total_input_tokens`；
   - `max_total_output_tokens`；
   - `no_progress_timeout_seconds`。
2. Hermes 每次模型调用后向 Runner 输出可解析的进度事件和累计 Token。
3. Runner 超限时终止整个进程组，写入结构化失败记录，并释放锁。
4. Requirement Analyst 使用裁剪后的上下文：
   - 完整保留 ADU、澄清答案和 Epic 约束；
   - 项目画像只保留技术栈、相关模块、构建测试命令和风险路径；
   - 知识包按 ADU 路径和关键词检索后按需注入；
   - 禁止重复注入同一 ADU 字段。
5. 如果目标分析文档在限定时间内未创建且模型调用数持续增长，应触发 `agent_no_progress`，而不是继续运行。
6. 页面显示模型调用次数、累计 Token、最近进展时间和停止原因。

### 测试要求

1. 构造不产生产物但持续调用模型的 Mock Agent，达到调用上限后必须被终止。
2. 构造不产生产物且无输出的 Mock Agent，达到无进展时限后必须被终止。
3. 超限后 Operation 必须为 `failed`，包含明确错误码，ADU 状态不得推进。
4. 超限后进程组和锁文件必须全部清理。
5. Requirement Analyst 的输入上下文必须满足去重和大小上限断言。
6. 正常 Agent 在预算内生成产物时不得被误杀。

## BUG-37-015：Agent 异常终止后残留锁仍按心跳存活 30 分钟

### 基本信息

- 发现日期：2026-06-19
- 发现步骤：步骤 6 异常执行恢复
- 关联 ADU：`ADU-1351-001`
- 严重级别：P2
- 当前状态：Open

### 现象

Agent 进程树已全部死亡，但以下锁文件仍然存在：

```text
open5gs/.ai-agent/locks/open5gs__ADU-1351-001.lock
```

后端启动前检查只判断 `heartbeat_at` 是否在 1,800 秒内，没有同时检查锁记录中的 PID 是否仍存活。因此立即重试会被错误阻断为“already being processed”。

### 修复建议

1. 锁有效性必须同时满足 PID 存活和心跳未过期。
2. Orchestrator 捕获 `SIGTERM`、`SIGINT` 后必须在 `finally` 中释放锁。
3. Node 子进程 `close` 回调发现 PID 已结束时，应执行 owner-safe 的残留锁回收。
4. 锁回收必须校验 owner token，避免删除其他新执行持有的锁。

### 测试要求

1. 终止 Agent 后立即重试，不得等待 30 分钟。
2. 死 PID + 新心跳锁必须被安全回收。
3. 活 PID + 旧心跳锁不得被误删。
4. 旧执行的退出回调不得删除新执行持有的同名锁。

## 10. 更新记录

| 日期 | 更新人 | 内容 |
|---|---|---|
| 2026-06-19 | Codex | 首次建立 Phase 3.7 调试缺陷台账，记录 License 需求调试中发现的 7 项问题 |
| 2026-06-19 | Codex | 步骤 3 调试新增 BUG-37-008 和 BUG-37-009，记录澄清冲突与 Operation 实时字段缺失 |
| 2026-06-19 | Codex | 步骤 4 调试新增 BUG-37-010 和 BUG-37-011，记录依赖方向错误与拆分范围/写路径遗漏 |
| 2026-06-19 | Codex | 步骤 5 调试新增 BUG-37-012 和 BUG-37-013，记录物化动作两步化与未启动子 ADU 被误报运行中 |
| 2026-06-19 | Codex | 步骤 6 调试新增 BUG-37-014 和 BUG-37-015，记录 Requirement Analyst 无运行上限及异常退出残留锁 |
| 2026-06-20 | Antigravity | 完成 Phase 3.7 遗留缺陷（R37-01 至 R37-07）的全面修复与自动化测试覆盖，将所有 BUG 状态更新为 Verified |

---

## R37-01：Agent 写完业务产物后没有可靠完成信号，可能继续消耗 Token 或被最大时限终止

### 根因
Hermes 进程执行完毕或业务产物（如 `detailed-design.md` 或 `contracts.json`）生成后，子进程并不会自动快速退出，且 Watchdog 原先仅靠业务产物存在进行提前结束，判定过于宽泛不稳固。

### 修复
在 Runner 中实现显式完成文件协议：
- Agent 必须在全部声明变更就绪后，以原子更名方式写入 `.ai-agent/runs/<run-id>/completion.json`。
- Watchdog 中引入 `read_completion_result` 逻辑，在轮询中检测到符合 Schema 的 `completion.json` 后，安全终止进程组并标记完成。

### 自动化测试
`scripts/test_agent_run_policy.py` 中的 `Testing Case 6: Explicit completion success then hang` 以及 `Testing Case 7: Invalid completion file`。

### 真实链路证据
目前已在集成测试（`test_agent_run_policy.py` 测试用例 6、7、8）中模拟并验证了这一机制；待真实 Agent 部署上线并在实际链路上运行后，将在对应的 `runs/<run-id>/` 目录下原子写入 `completion.json`，由 Watchdog 提前捕获以退出。

---

## R37-02：ADU Operation 运行期间缺少 `agent_started`，`current_agent/current_state` 长时间为空

### 根因
Orchestrator 仅在完成时广播 `step_completed` / `state_changed`，在调用 `hermes_agent_run.py` 之前没有发送开始的生命周期事件，导致 Dashboard backend 无法获知当前正在执行何种 Agent。

### 修复
- 在 `scripts/hermes_agent_orchestrator.py` 的 `run_agent()` 之前广播 `agent_started` 事件。
- 后端 `agent-factory-dashboard/backend/src/application/runtime/orchestrator-event-mapper.ts` 捕获该事件并置 status 为 `running`、更新 `current_agent` 和 `current_state`。

### 自动化测试
`tools/test-operation-events.js` 中的 `1. Test agent_started` 与 `13. Lifecycle order test`。

---

## R37-03：`human_gate_required=true` 会让非 `human_gate` 状态显示伪 Blocked

### 根因
前端/Monitor 读取 ADU 状态时，错误地把非终端状态下的 `adu.human_gate_required` 属性也解释为 `blocked`。即便 ADU 已离开 Human Gate 进入后续流程（甚至全部完成），只要该属性存在，就会导致 Dashboard 上整条 Timeline 伪 Blocked。

### 修复
收紧 `agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts` 中的判定，只当 `state === 'human_gate'` 时才激活并显示 Human Gate 阻断状态。

### 自动化测试
`tools/test-monitor-human-gate.js` 中的正例及 stale flag 反例测试。

---

## R37-04：静默推理可能被 no-progress Watchdog 误杀

### 根因
在 Agent 启动初期（特别是在大模型生成速度慢、尚未有任何 stdout 输出或物理产物变更的“静默期”），容易提前触发 `no_progress_timeout_seconds` 而被强杀。

### 修复
在 `scripts/agent_run_policy.py` 中引入 `progress_observed` 状态。在未观察到首次实质输出或产物修改前，仅使用全局 `max_duration_seconds` 看门狗进行保护；一旦有输出产生，才激活 `no_progress` 定时器。

### 自动化测试
`scripts/test_agent_run_policy.py` 中的 `Testing Case 3: Silent inference completes` 与 `Testing Case 4: Progress followed by stall`。

---

## R37-05：Detail Designer 返工时收不到 Design Review 意见

### 根因
在设计返工流程中，`detail-designer` 重跑时没有从 Registry (`reviews.json`) 中检索最新的 Design Review 反馈信息并注入到 Prompt Payload 中。

### 修复
在 `hermes_agent_run.py` 的 `render_prompt` 函数中增加 `load_latest_review_feedback(adu_id, "design")` 逻辑，在 `contexted` 返工状态下，如果存在 rework请求，将 review comment 以 `design_review_feedback` 结构化对象注入 Payload。

### 自动化测试
`scripts/test_phase2_flow_integrity.py` 中的 `T06: design review feedback is injected into detail-designer prompt`。

---

## R37-06：Agent 可在最终 JSON 中虚报未修改 of `changed_files`

### 根因
Agent 可以在返回的 `changed_files` 包含其实际并未修改或根本不存在的文件，而系统缺乏相应的后验真实性校验。

### 修复
- 在 `hermes_agent_run.py` 中加入 `validate_declared_changes()` 校验函数。
- 比对文件的修改时间（mtime）是否晚于 Agent 本轮运行的启动时间戳 (`run_started_ns`)。
- 若不满足或存在路径逃逸，强制将任务置为 `failed` 并输出 `declared_changes_unverified`。

### 自动化测试
`scripts/test_phase2_flow_integrity.py` 中的 `T07: unchanged and missing changed_files are rejected`。

---

## R37-07：Contract runner 目标路径与 Prompt、Validator、Dashboard 不一致

### 根因
先前 contract 模块输出的文件命名为 `<ADU_ID>-contract.json`，而仪表盘、校验器和提示词预期的是标准的 `.ai-agent/contracts/<ADU_ID>.json`，从而导致衔接中断或无法通过验证。

### 修复
- 在 `hermes_agent_run.py` 中修改 `get_agent_target_files` 返回结果，使 contract 预期目标文件修正为标准路径。

### 自动化测试
`scripts/test_phase2_flow_integrity.py` 中的 `T08: contract watchdog targets use standard contract artifact paths`。

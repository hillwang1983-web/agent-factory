# Agent Factory Phase 3.7 Residual Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Phase 3.7 真实 License 需求调试后确认的 7 项遗留问题，使 Agent 完成信号、ADU Operation 实时状态、Human Gate 展示和现有未提交补丁形成可测试、可提交、可发布的闭环。

**Architecture:** 使用 runner 管理的 `completion.json` 作为 Agent 的显式完成协议，不再把普通业务产物创建等同于 Agent 完成；ADU Orchestrator 在调用 runner 前后发送标准 NDJSON 生命周期事件，由既有 Operation Event Mapper 更新运行状态；任务流水线只在 ADU 实际进入 `human_gate` 时显示阻塞，活动 Gate 记录继续由 Human Gate Center 独立展示。现有 Watchdog、设计返工反馈、`changed_files` 校验和 Contract 路径修复先独立固化，再执行全量回归。

**Tech Stack:** Python 3、Hermes CLI、TypeScript、Node.js、Express、JSON Registry、NDJSON Event Stream、现有 Agent Factory Dashboard 测试脚本。

---

## 1. 修复范围

| ID | 严重度 | 问题 | 本计划任务 |
|---|---|---|---|
| R37-01 | P1 | Agent 写完业务产物后没有可靠完成信号，可能继续消耗 Token 或被最大时限终止 | Task 3 |
| R37-02 | P2 | ADU Operation 运行期间缺少 `agent_started`，`current_agent/current_state` 长时间为空 | Task 4 |
| R37-03 | P2 | `human_gate_required=true` 会让非 `human_gate` 状态显示伪 Blocked | Task 5 |
| R37-04 | P0 | 静默推理可能被 no-progress Watchdog 误杀 | Task 2 |
| R37-05 | P1 | Detail Designer 返工时收不到 Design Review 意见 | Task 2 |
| R37-06 | P1 | Agent 可在最终 JSON 中虚报未修改的 `changed_files` | Task 2 |
| R37-07 | P1 | Contract runner 目标路径与 Prompt、Validator、Dashboard 不一致 | Task 2 |

## 2. 不在本轮范围

- 不修改 NMS 内嵌版 Agent Factory。
- 不调整 Open5GS License 业务设计或业务代码。
- 不增加新的 Agent 角色或模型供应商。
- 不重写 Hermes CLI 内部循环。
- 不删除用户或其他 Agent 已产生的未提交业务改动。
- 不用简单增加超时时间替代完成协议。

## 3. 文件结构与职责

### 修改文件

| 文件 | 职责 |
|---|---|
| `scripts/hermes_agent_run.py` | 注入完成文件约束、读取完成结果、校验声明变更、统一目标产物路径 |
| `scripts/agent_run_policy.py` | 监控显式完成文件、终止已完成的 Hermes 进程组、保留 Watchdog |
| `scripts/hermes_agent_orchestrator.py` | 发出 ADU `agent_started`、`agent_completed`、`agent_failed` 标准事件 |
| `scripts/test_agent_run_policy.py` | 完成协议、静默推理、停滞和超时反例测试 |
| `scripts/test_phase2_flow_integrity.py` | 设计反馈、变更真实性、Contract 路径回归 |
| `.ai-agent/policies/agent-run-policy.json` | Agent 运行时限策略 |
| `scripts/agent_factory_bootstrap.py` | 新工作区运行策略默认值 |
| `agent-factory-dashboard/backend/src/application/runtime/orchestrator-event-mapper.ts` | 将 ADU 生命周期事件映射为 Operation 更新 |
| `agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts` | 正确判断 Human Gate 展示状态 |
| `agent-factory-dashboard/backend/tools/test-operation-events.js` | 真实 ADU NDJSON 事件映射测试 |
| `agent-factory-dashboard/backend/tools/test-monitor-human-gate.js` | Human Gate 正反例测试 |
| `agent-factory-dashboard/backend/tools/test-phase37-regression.js` | 汇总本轮新增回归测试 |
| `docs/superpowers/debugging/2026-06-19-agent-factory-phase3-7-debug-bug-log.md` | 同步历史 15 项缺陷与本轮 7 项缺陷状态 |

### 运行时新增文件

每次 Agent Run 新增：

```text
<project-repo>/.ai-agent/runs/<run-id>/completion.json
```

该文件属于运行证据，保留在对应 Run 目录中，不加入根 Registry。

完成文件 Schema：

```json
{
  "version": 1,
  "status": "success",
  "result": {
    "result": "success",
    "next_state": "contracted",
    "changed_files": [
      ".ai-agent/contracts/ADU-1351-001.json"
    ],
    "commands_run": [],
    "artifacts": [
      ".ai-agent/contracts/ADU-1351-001.json"
    ],
    "risks": [],
    "next_agent": "testwriter"
  }
}
```

约束：

1. `version` 必须等于 `1`。
2. `status` 只允许 `success` 或 `failed`。
3. `result` 必须是对象。
4. `status=success` 时，`result.result` 必须是 `success`。
5. 文件必须先写临时文件，再原子重命名为 `completion.json`。
6. Runner 只信任完成文件中的结构化结果，业务产物存在不再触发提前结束。

---

### Task 1: 建立干净基线并保护现有未提交修改

**Files:**
- Inspect: `.ai-agent/policies/agent-run-policy.json`
- Inspect: `scripts/agent_run_policy.py`
- Inspect: `scripts/hermes_agent_run.py`
- Inspect: `scripts/test_agent_run_policy.py`
- Inspect: `scripts/test_phase2_flow_integrity.py`
- Inspect: `agent-factory-dashboard/backend/tools/test-phase37-regression.js`
- Delete generated file: `temp_outcome_2.json`

- [ ] **Step 1: 记录当前工作区，不覆盖现有改动**

Run:

```bash
cd /Users/hill/open5gs
git status --short
git diff --check
git diff --name-only
```

Expected:

```text
现有 7 个已修改文件被完整列出；
git diff --check 退出码为 0；
不得执行 git reset、git checkout -- 或覆盖用户改动。
```

- [ ] **Step 2: 删除测试泄漏的临时文件**

Run:

```bash
cd /Users/hill/open5gs
test -f temp_outcome_2.json && rm temp_outcome_2.json || true
```

Expected:

```text
git status --short 中不再出现 ?? temp_outcome_2.json
```

- [ ] **Step 3: 运行现有专项测试作为基线**

Run:

```bash
cd /Users/hill/open5gs
python3 scripts/test_agent_run_policy.py
python3 scripts/test_phase2_flow_integrity.py
python3 -m py_compile \
  scripts/agent_run_policy.py \
  scripts/hermes_agent_run.py \
  scripts/test_agent_run_policy.py \
  scripts/test_phase2_flow_integrity.py
```

Expected:

```text
Watchdog tests: 5/5 PASS
Phase 2 flow integrity: 9/9 PASS
py_compile: exit 0
```

- [ ] **Step 4: 修复测试清理逻辑，保证失败也不泄漏文件**

在 `scripts/test_agent_run_policy.py` 的 `finally` 中加入：

```python
        for temp_path in (
            workspace / "temp_outcome_1.json",
            workspace / "temp_outcome_2.json",
            workspace / "temp_outcome_4.json",
            workspace / "temp_wrapper.py",
        ):
            if temp_path.exists():
                temp_path.unlink()
```

- [ ] **Step 5: 运行测试两次验证可重复性**

Run:

```bash
cd /Users/hill/open5gs
python3 scripts/test_agent_run_policy.py
python3 scripts/test_agent_run_policy.py
test ! -e temp_outcome_1.json
test ! -e temp_outcome_2.json
test ! -e temp_outcome_4.json
test ! -e temp_wrapper.py
```

Expected: 两轮测试均通过，四个临时文件均不存在。

- [ ] **Step 6: 提交测试卫生修复**

```bash
cd /Users/hill/open5gs
git add scripts/test_agent_run_policy.py
git commit -m "test(agent-factory): isolate watchdog temporary files"
```

---

### Task 2: 固化现有四项 runner 修复

**Files:**
- Modify: `.ai-agent/policies/agent-run-policy.json`
- Modify: `scripts/agent_factory_bootstrap.py`
- Modify: `scripts/agent_run_policy.py`
- Modify: `scripts/hermes_agent_run.py`
- Modify: `scripts/test_agent_run_policy.py`
- Modify: `scripts/test_phase2_flow_integrity.py`
- Modify: `agent-factory-dashboard/backend/tools/test-phase37-regression.js`

- [ ] **Step 1: 保留静默推理 Watchdog 反例**

`scripts/test_agent_run_policy.py` 必须包含以下行为测试：

```python
policy = AgentRunPolicy(6, 1, 1, 10000, 1000)
cmd = [
    sys.executable,
    str(mock_hermes_path),
    "silent_success",
    str(target_file),
]
result = execute_controlled_process(
    cmd,
    workspace,
    None,
    policy,
    [str(target_file)],
)
assert result.returncode == 0
```

测试目的：首次可观测进展前，静默推理超过 `no_progress_timeout_seconds` 仍可完成，但不得超过 `max_duration_seconds`。

- [ ] **Step 2: 保留进展后停滞反例**

```python
policy = AgentRunPolicy(10, 2, 1, 10000, 1000)
cmd = [
    sys.executable,
    str(mock_hermes_path),
    "progress_then_stall",
    str(target_file),
]
```

Expected:

```text
进程退出码 1
结构化结果 error_code == "AGENT_NO_PROGRESS"
```

- [ ] **Step 3: 固化 Design Review 反馈注入**

`scripts/hermes_agent_run.py` 保留：

```python
if agent_name == "detail-designer" and rework_state == "contexted":
    design_feedback = load_latest_review_feedback(adu_id, "design")
    if design_feedback:
        payload["design_review_feedback"] = {
            "review_id": design_feedback.get("review_id"),
            "status": design_feedback.get("status"),
            "comment": design_feedback.get("comment"),
            "artifact_paths": design_feedback.get("artifact_paths", []),
            "updated_at": design_feedback.get("updated_at"),
        }
```

对应测试必须断言 Prompt 中同时出现：

```text
"design_review_feedback"
Canonical String 歧义
Base64 栈溢出风险
```

- [ ] **Step 4: 固化 `changed_files` 真实性校验**

`validate_declared_changes()` 必须拒绝：

```text
绝对路径
包含 .. 的路径
逃逸项目根目录的路径
不存在的文件
mtime 早于本轮 run_started_ns 的文件
```

失败结果必须写为：

```python
result["result"] = "failed"
result["error_code"] = "declared_changes_unverified"
result["error"] = "Agent declared file changes that were not produced during this run."
result["change_validation_errors"] = change_errors
```

- [ ] **Step 5: 固化 Contract 标准路径**

`get_agent_target_files("contract", ...)` 必须返回：

```python
[
    str(project_repo_path / ".ai-agent" / "contracts" / f"{adu_id}.json"),
    str(project_repo_path / ".ai-agent" / "contracts" / f"{adu_id}-notes.md"),
]
```

禁止再出现：

```text
<ADU_ID>-contract.json
```

- [ ] **Step 6: 将 Phase 2 流程测试纳入总回归**

`agent-factory-dashboard/backend/tools/test-phase37-regression.js` 的命令列表必须包含：

```js
['python3', [path.resolve(
  __dirname,
  '../../../scripts/test_phase2_flow_integrity.py'
)]],
```

- [ ] **Step 7: 运行专项测试**

Run:

```bash
cd /Users/hill/open5gs
python3 scripts/test_agent_run_policy.py
python3 scripts/test_phase2_flow_integrity.py
git diff --check
```

Expected:

```text
Watchdog tests全部通过
Phase 2 flow integrity 9/9 PASS
git diff --check: exit 0
```

- [ ] **Step 8: 提交现有 runner 修复**

```bash
cd /Users/hill/open5gs
git add \
  .ai-agent/policies/agent-run-policy.json \
  agent-factory-dashboard/backend/tools/test-phase37-regression.js \
  scripts/agent_factory_bootstrap.py \
  scripts/agent_run_policy.py \
  scripts/hermes_agent_run.py \
  scripts/test_agent_run_policy.py \
  scripts/test_phase2_flow_integrity.py
git commit -m "fix(agent-factory): harden runner watchdog and flow integrity"
```

---

### Task 3: 实现显式 Agent 完成协议

**Files:**
- Modify: `scripts/hermes_agent_run.py`
- Modify: `scripts/agent_run_policy.py`
- Modify: `scripts/test_agent_run_policy.py`
- Modify: `scripts/test_phase2_flow_integrity.py`

- [ ] **Step 1: 写完成文件 Schema 反例测试**

在 `scripts/test_agent_run_policy.py` 增加：

```python
def write_completion(path, payload):
    tmp_path = path.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(payload), encoding="utf-8")
    tmp_path.replace(path)
```

Mock 场景：

```python
elif scenario == "completion_success_then_hang":
    completion_file = pathlib.Path(sys.argv[3])
    output_file.write_text("business artifact", encoding="utf-8")
    write_completion(completion_file, {
        "version": 1,
        "status": "success",
        "result": {
            "result": "success",
            "next_state": "contracted",
            "changed_files": [str(output_file)],
            "commands_run": [],
            "artifacts": [str(output_file)],
            "risks": [],
            "next_agent": "testwriter"
        }
    })
    time.sleep(100)
```

新增断言：

```python
result = execute_controlled_process(
    cmd,
    workspace,
    None,
    AgentRunPolicy(20, 10, 1, 10000, 1000),
    target_files=[str(target_file)],
    completion_file=completion_file,
)
assert result.returncode == 0
assert result.termination_reason == "completion_signal"
assert result.completion_result["result"] == "success"
assert elapsed < 5
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
cd /Users/hill/open5gs
python3 scripts/test_agent_run_policy.py
```

Expected: FAIL，错误明确指出 `execute_controlled_process()` 不支持 `completion_file` 或结果缺少 `completion_result`。

- [ ] **Step 3: 在 runner Prompt 中注入完成协议**

在 `render_prompt()` 的 payload 中加入：

```python
if run_dir:
    completion_path = run_dir / "completion.json"
    payload["runtime_control"] = {
        "completion_file": str(completion_path.relative_to(artifact_root)),
        "completion_schema_version": 1,
        "completion_write_rule": (
            "Write the JSON to completion.json.tmp and atomically rename it "
            "to completion.json only after all declared artifacts are complete."
        ),
    }
```

在最终 Prompt 末尾加入强制说明：

```python
if run_dir:
    rendered += (
        "\n\n# Runtime Completion Protocol\n\n"
        "Before finishing, write the same final structured result to the "
        "`runtime_control.completion_file` path. Write a temporary sibling "
        "file first, then atomically rename it. Do not write completion.json "
        "until all declared files are fully persisted.\n"
    )
```

- [ ] **Step 4: 实现完成文件校验函数**

在 `scripts/agent_run_policy.py` 增加：

```python
def read_completion_result(completion_path):
    if completion_path is None or not completion_path.is_file():
        return None

    try:
        payload = json.loads(completion_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    if payload.get("version") != 1:
        return None
    if payload.get("status") not in ("success", "failed"):
        return None

    result = payload.get("result")
    if not isinstance(result, dict):
        return None
    if payload["status"] == "success" and result.get("result") != "success":
        return None
    if payload["status"] == "failed" and result.get("result") == "success":
        return None

    return result
```

- [ ] **Step 5: 扩展受控进程返回类型**

修改函数签名：

```python
def execute_controlled_process(
    cmd,
    cwd_path,
    env,
    policy,
    target_files=None,
    completion_file=None,
):
```

初始化：

```python
completion_path = pathlib.Path(completion_file) if completion_file else None
completion_result = None
```

在进程状态检查前读取完成信号：

```python
completion_result = read_completion_result(completion_path)
if completion_result is not None:
    termination_reason = "completion_signal"
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    exit_code = 0 if completion_result.get("result") == "success" else 1
    break
```

完成信号不是超时，不进入超时错误分支：

```python
if termination_reason and termination_reason != "completion_signal":
    # existing timeout termination path
```

返回对象扩展为：

```python
class ControlledProcessResult:
    def __init__(
        self,
        stdout,
        stderr,
        returncode,
        completion_result=None,
        termination_reason=None,
    ):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode
        self.completion_result = completion_result
        self.termination_reason = termination_reason
```

- [ ] **Step 6: Runner 优先使用完成文件结果**

在 `scripts/hermes_agent_run.py` 中：

```python
completion_file = run_dir / "completion.json"
proc = agent_run_policy.execute_controlled_process(
    cmd,
    cwd_path,
    env,
    policy,
    target_files=target_files,
    completion_file=completion_file,
)
```

结果解析改为：

```python
result = proc.completion_result or extract_json_result(proc.stdout)
```

Run record 增加：

```python
"termination_reason": proc.termination_reason or "process_exit",
"completion_signal_used": proc.completion_result is not None,
```

- [ ] **Step 7: 增加无效完成文件反例**

至少覆盖：

```text
非法 JSON
version != 1
status 缺失
result 不是对象
status=success 但 result.result=failed
只生成普通业务产物但没有 completion.json
```

最后一种必须继续等待，直到真实进程退出或 Watchdog 超时，不能报告成功。

- [ ] **Step 8: 运行完成协议测试**

Run:

```bash
cd /Users/hill/open5gs
python3 scripts/test_agent_run_policy.py
python3 scripts/test_phase2_flow_integrity.py
python3 -m py_compile scripts/agent_run_policy.py scripts/hermes_agent_run.py
```

Expected: 全部通过，完成信号场景在 5 秒内收敛。

- [ ] **Step 9: 提交完成协议**

```bash
cd /Users/hill/open5gs
git add \
  scripts/agent_run_policy.py \
  scripts/hermes_agent_run.py \
  scripts/test_agent_run_policy.py \
  scripts/test_phase2_flow_integrity.py
git commit -m "feat(agent-factory): add explicit agent completion protocol"
```

---

### Task 4: 补齐 ADU Operation 实时生命周期事件

**Files:**
- Modify: `scripts/hermes_agent_orchestrator.py`
- Modify: `agent-factory-dashboard/backend/src/application/runtime/orchestrator-event-mapper.ts`
- Modify: `agent-factory-dashboard/backend/tools/test-operation-events.js`

- [ ] **Step 1: 写真实 ADU `agent_started` 映射测试**

在 `test-operation-events.js` 增加：

```js
const started = mapOrchestratorEvent({
  type: 'agent_factory_orchestrator_event',
  payload: {
    event: 'agent_started',
    adu_id: 'ADU-1351-001',
    agent_id: 'contract',
    state: 'designed'
  }
});

eq(started.current_agent, 'contract', 'ADU agent_started agent');
eq(started.current_state, 'designed', 'ADU agent_started state');
eq(started.status, 'running', 'ADU agent_started status');
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run build
node tools/test-operation-events.js
```

Expected: FAIL，因为当前 mapper 不会在 `agent_started` 时写入 `status=running`。

- [ ] **Step 3: Orchestrator 在调用 runner 前发送开始事件**

在 `run_agent()` 前加入：

```python
broadcast_event("agent_factory_orchestrator_event", {
    "event": "agent_started",
    "adu_id": args.adu,
    "agent_id": next_agent,
    "state": current_state,
    "operation_id": args.operation_id,
})
```

该事件必须在 `update_lock_heartbeat()` 之后、`run_agent()` 之前发送。

- [ ] **Step 4: Orchestrator 在 runner 返回后发送结束事件**

成功时：

```python
broadcast_event("agent_factory_orchestrator_event", {
    "event": "agent_completed",
    "adu_id": args.adu,
    "agent_id": next_agent,
    "from_state": current_state,
    "to_state": adu["state"],
    "result": "success",
    "operation_id": args.operation_id,
})
```

失败时保留已有 `agent_failed`，但字段统一为：

```python
{
    "event": "agent_failed",
    "adu_id": args.adu,
    "agent_id": next_agent,
    "state": current_state,
    "result": "failed",
    "returncode": rc,
    "stderr": error_msg,
    "operation_id": args.operation_id,
}
```

- [ ] **Step 5: Mapper 明确更新 Operation 状态**

修改：

```ts
if (normalized.includes('agent_started')) {
  if (agent) updates.current_agent = agent;
  if (state) updates.current_state = state;
  updates.status = 'running';
  updates.last_progress_at = timestamp;
} else if (normalized.includes('agent_completed')) {
  if (agent) updates.current_agent = agent;
  if (state) updates.current_state = state;
  updates.last_progress_at = timestamp;
}
```

`agent_completed` 不将整个 Operation 标记 `completed`；Operation 终态仍由 orchestrator 进程关闭和最终状态决定。

- [ ] **Step 6: 增加生命周期顺序测试**

```js
const lifecycle = [
  { event: 'agent_started', agent_id: 'contract', state: 'designed' },
  {
    event: 'agent_completed',
    agent_id: 'contract',
    from_state: 'designed',
    to_state: 'contracted'
  },
  {
    event: 'step_completed',
    agent_id: 'contract',
    from_state: 'designed',
    to_state: 'contracted'
  }
];
```

断言：

```text
第一事件 current_agent=contract, current_state=designed, status=running
第二事件 current_state=contracted
第三事件 current_state=contracted
```

- [ ] **Step 7: 运行事件测试**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run build
node tools/test-operation-events.js
```

Expected: 全部通过。

- [ ] **Step 8: 提交实时事件修复**

```bash
cd /Users/hill/open5gs
git add \
  scripts/hermes_agent_orchestrator.py \
  agent-factory-dashboard/backend/src/application/runtime/orchestrator-event-mapper.ts \
  agent-factory-dashboard/backend/tools/test-operation-events.js
git commit -m "fix(agent-factory): publish live ADU agent lifecycle events"
```

---

### Task 5: 修复 Human Gate 假阻塞

**Files:**
- Modify: `agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts`
- Create: `agent-factory-dashboard/backend/tools/test-monitor-human-gate.js`
- Modify: `agent-factory-dashboard/backend/tools/test-phase37-regression.js`

- [ ] **Step 1: 创建 Monitor 测试仓储**

`test-monitor-human-gate.js` 使用内存仓储：

```js
class FakeRepo {
  constructor(adu, runs = [], gates = []) {
    this.adu = adu;
    this.runs = runs;
    this.gates = gates;
  }

  async readAdus() { return [this.adu]; }
  async readAgents() { return {}; }
  async readRuns() { return this.runs; }
  async listArtifacts() { return []; }
  async readHumanGates() { return this.gates; }
}
```

如果 `AgentFactoryRepository` 当前没有 `readHumanGates()`，本任务不扩展 Repository；Monitor 只使用状态机硬事实 `adu.state === 'human_gate'`，活动 Gate 由 Human Gate Center 单独展示。

- [ ] **Step 2: 写伪阻塞反例**

```js
const staleFlagAdu = {
  id: 'ADU-STALE-GATE',
  state: 'contracted',
  human_gate_required: true,
  project_id: 'open5gs',
  repo_path: '/tmp/open5gs',
  artifacts: []
};

const dashboard = await new AgentFactoryMonitorUseCase(
  new FakeRepo(staleFlagAdu)
).getDashboard();

const view = dashboard.adus[0];
assert.strictEqual(
  view.workflow.some(step => step.state === 'human_gate'),
  false
);
assert.notStrictEqual(view.health.status, 'blocked');
```

- [ ] **Step 3: 写真实 Gate 正例**

```js
const blockedAdu = {
  id: 'ADU-REAL-GATE',
  state: 'human_gate',
  human_gate_required: true,
  gate_type: 'environment_verification_required',
  project_id: 'open5gs',
  repo_path: '/tmp/open5gs',
  artifacts: []
};
```

断言：

```text
workflow 中存在且仅存在一个 human_gate
human_gate.status == blocked
health.status == blocked
```

- [ ] **Step 4: 运行测试确认 RED**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run build
node tools/test-monitor-human-gate.js
```

Expected: stale flag 反例失败。

- [ ] **Step 5: 收紧 Monitor 判断**

将：

```ts
if (adu.state === 'human_gate' || (!isTerminal && adu.human_gate_required)) {
```

改为：

```ts
if (adu.state === 'human_gate') {
```

`human_gate_required` 继续作为 ADU 策略字段存在，但不得作为当前阻塞状态来源。

- [ ] **Step 6: 将测试纳入总回归**

在 `test-phase37-regression.js` 增加：

```js
['node', ['tools/test-monitor-human-gate.js']],
```

- [ ] **Step 7: 运行 Monitor 与构建测试**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run build
node tools/test-monitor-human-gate.js
node tools/test-quality-gates.js
```

Expected: 全部通过。

- [ ] **Step 8: 提交 Human Gate 修复**

```bash
cd /Users/hill/open5gs
git add \
  agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts \
  agent-factory-dashboard/backend/tools/test-monitor-human-gate.js \
  agent-factory-dashboard/backend/tools/test-phase37-regression.js
git commit -m "fix(agent-factory): derive blocked workflow from actual human gate state"
```

---

### Task 6: 全量回归、真实链路复验与缺陷台账更新

**Files:**
- Modify: `docs/superpowers/debugging/2026-06-19-agent-factory-phase3-7-debug-bug-log.md`

- [ ] **Step 1: 执行 Phase 3.7 总回归**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run build
npm run test:phase37-regression
```

Expected:

```text
所有 Node 子测试通过
test_phase2_flow_integrity.py 通过
test_agent_run_policy.py 通过
test_context_payload_builder.py 通过
```

- [ ] **Step 2: 执行核心跨阶段回归**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run test:adu-intake
npm run test:project-adu
npm run test:review-gate
npm run test:quality-gates
npm run test:epic-factory
npm run test:epic-dag
```

Expected: 全部退出码为 0。

- [ ] **Step 3: 执行前后端构建与 Python 检查**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run build

cd /Users/hill/open5gs/agent-factory-dashboard/frontend
npm run build

cd /Users/hill/open5gs
python3 -m py_compile \
  scripts/agent_run_policy.py \
  scripts/hermes_agent_run.py \
  scripts/hermes_agent_orchestrator.py \
  scripts/test_agent_run_policy.py \
  scripts/test_phase2_flow_integrity.py
git diff --check
```

Expected:

```text
Backend build PASS
Frontend build PASS
Python compile PASS
git diff --check exit 0
```

- [ ] **Step 4: 用测试 ADU 验证完成协议**

使用专门的测试 ADU，不重跑生产 ADU：

```text
状态：designed
下一 Agent：contract
Contract Agent 写入标准契约文件和 completion.json
Hermes 进程在 completion.json 出现后 5 秒内退出
Operation 在运行时显示 current_agent=contract
最终状态：contracted
```

必须保存以下证据：

```text
Run 目录中的 completion.json
Operation Events 中的 agent_started
Operation Events 中的 agent_completed
Operation Events 中的 step_completed
Contract Validator PASS 输出
```

- [ ] **Step 5: 验证 stale Human Gate 不再显示**

构造：

```json
{
  "state": "contracted",
  "human_gate_required": true
}
```

Expected:

```text
Requirement Progress Pipeline 不显示 Human Gate Blocked
ADU health 不为 blocked
Human Gate Center 仍可展示真实未处理 Gate 记录
```

- [ ] **Step 6: 更新历史缺陷状态**

在调试台账中：

1. 将原 BUG-37-001 至 BUG-37-015 按对应提交和测试证据更新为 `Verified`。
2. 增加 R37-01 至 R37-07 小节。
3. 每项记录：
   - 根因；
   - 修复提交；
   - 自动化测试；
   - 真实链路证据；
   - 是否需要后续观察。
4. 不再保留“15 项仍全部 Open”的错误总表。

- [ ] **Step 7: 检查工作区清洁度**

Run:

```bash
cd /Users/hill/open5gs
git status --short
git diff --check
find . -maxdepth 1 -name 'temp_outcome_*.json' -print
find . -maxdepth 1 -name 'temp_wrapper.py' -print
```

Expected:

```text
没有临时测试文件
没有未跟踪运行产物
只剩计划内文档修改
```

- [ ] **Step 8: 提交台账与验收证据**

```bash
cd /Users/hill/open5gs
git add \
  docs/superpowers/debugging/2026-06-19-agent-factory-phase3-7-debug-bug-log.md
git commit -m "docs(agent-factory): close phase 3.7 residual bug audit"
```

---

## 4. 发布门禁

以下任一条件不满足，不得宣布本轮修复完成：

1. `completion.json` 无法通过 Schema 校验。
2. 只生成业务产物、没有完成文件时，runner 仍报告成功。
3. 完成文件出现后，Hermes 进程 5 秒内没有收敛。
4. ADU Operation 运行期间 `current_agent` 仍为空。
5. 非 `human_gate` 状态仍显示 Human Gate Blocked。
6. `changed_files` 可声明不存在或本轮未修改的文件。
7. Contract runner 仍引用 `*-contract.json`。
8. `npm run test:phase37-regression` 未全绿。
9. 工作区存在 `temp_outcome_*.json`、`temp_wrapper.py` 等测试泄漏。
10. 缺陷台账仍把已经验证的历史问题标成 `Open`。

## 5. 建议提交顺序

```text
test(agent-factory): isolate watchdog temporary files
fix(agent-factory): harden runner watchdog and flow integrity
feat(agent-factory): add explicit agent completion protocol
fix(agent-factory): publish live ADU agent lifecycle events
fix(agent-factory): derive blocked workflow from actual human gate state
docs(agent-factory): close phase 3.7 residual bug audit
```

每个提交都必须保持对应专项测试可独立通过，禁止把六个工作包压成一个无法定位回归来源的大提交。

# AgentFactory ADU Flow Reliability Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `ADU-1351-002` 调试暴露出的 Rework、Evidence、人工纠偏、Watchdog、运行日志、状态元数据与看板显示问题，使新建 ADU 能在不手工编辑 Registry 的情况下稳定完成完整流程。

**Architecture:** 保留现有 Runner、Orchestrator 和质量门边界，但把 Agent 的自由文本输出限制在可验证的数据接口内。Rework 在分派 Developer 前做权限可执行性检查；Evidence 由确定性编译器生成；人工纠偏只允许修正可证明的运行元数据；所有运行结果通过统一持久化函数原子更新 ADU、Run、Operation 和事件。

**Tech Stack:** Python 3、Node.js/TypeScript、Express、React、Vitest、Hermes CLI、JSON Registry、现有 `RegistryLock`。

---

## 1. 修复清单

| ID | 级别 | 问题 | 当前判断 | 目标状态 |
|---|---|---|---|---|
| AF-1351-01 | P0 | Rework Planner 要求修改 ADU 白名单外路径，却仍返回 Developer | 已有未提交的 Human Gate 雏形，需补完整状态与 API 测试 | 自动进入 `rework_requires_operator_cleanup`，绝不启动 Developer |
| AF-1351-02 | P0 | Evidence Agent 自由生成的 JSON 与 Contract `required_fields` 不一致 | 当前第二次运行通过，但生成方式仍不确定 | Canonical Evidence 由确定性编译器生成 |
| AF-1351-03 | P1 | Developer 声明历史文件为本轮变更，触发 mtime 校验失败 | mtime 门禁行为正确，缺少安全纠偏路径 | 保留门禁；支持经文件快照证明的声明修正 |
| AF-1351-04 | P1 | Developer 无 Validator，Operator Override 无法安全处理声明误报 | 不应开放通用强制成功 | 新增窄范围 `amend_file_declaration` 操作 |
| AF-1351-05 | P1 | Agent 输出少量内容后挂起，Watchdog 终止但不会安全重试 | 已确认 `no_progress_timeout`，供应商根因未证实 | 无副作用时自动重试一次，并完整记录 attempt |
| AF-1351-06 | P1 | 新运行的 stdout/stderr 可能为空，成功摘要曾被写进 stderr | 已有局部修复，需建立持久化契约 | 每次运行都生成可读日志；成功 stderr 保持真实语义 |
| AF-1351-07 | P1 | `rework_planned` 未完整进入后端状态顺序和流程图 | 已有未提交映射修复 | 后端、前端和测试统一显示当前 Rework 节点 |
| AF-1351-08 | P1 | ADU 已 `evidenced`，但 `latest_agent/latest_run_timestamp` 仍停在 Code Reviewer | 当前数据已复现 | 每次 Run 完成时原子更新最新运行元数据 |
| AF-1351-09 | P2 | Operation/Lock 残留导致页面显示失败但 API 返回 already running | 部分已有 PID 清理 | 统一 Run、Operation、Lock 的终态收敛 |
| AF-1351-10 | P2 | Completion Envelope 兼容、Rework Planner `Unstructured` 等回归风险 | 已有修复提交，需纳入总回归入口 | 固化为不可回退的协议测试 |

## 2. 不允许采用的修复方式

1. 不允许通过 `touch` 文件绕过 `changed_files` 校验。
2. 不允许删除 mtime/hash 校验来迁就 Agent 的虚假声明。
3. 不允许为 Developer 增加无 Validator 的通用 `force success`。
4. 不允许由前端或操作员直接编辑 `adu.json`、`runs.json`、`operations.json`。
5. 不允许把 20-30 秒无输出直接视为模型失败；重试阈值必须按 Agent Policy 配置。
6. 不修改历史 ADU 的业务产物；历史数据只作为只读回归夹具。

## 3. 文件结构

**新增文件：**

- `scripts/evidence_package_compiler.py`：从 Contract、Acceptance Report 和可信命令结果编译 Canonical Evidence。
- `scripts/test_evidence_package_compiler.py`：Evidence 编译器正反例测试。
- `scripts/run_file_snapshot.py`：创建并比较运行前后文件 SHA-256 快照。
- `scripts/test_run_file_snapshot.py`：快照及声明修正测试。
- `agent-factory-dashboard/backend/tools/test-adu-flow-reliability.js`：跨 Runner、Registry、Operation 的集成回归入口。

**修改文件：**

- `scripts/hermes_agent_run.py`：Rework 可执行性门禁、Attempt 重试、Evidence 编译、日志与元数据收敛。
- `scripts/agent_run_policy.py`：返回目标文件变化、Attempt 终止原因和可重试判定。
- `scripts/test_agent_run_policy.py`：无进展重试前置条件与完成协议测试。
- `scripts/test_phase2_flow_integrity.py`：Rework、日志和状态推进反例。
- `scripts/validate_evidence_package.py`：只校验 Canonical Evidence，不承担格式猜测。
- `.ai-agent/prompts/evidence-agent.md`：Evidence Agent 改为生成审计说明，不再拥有 Canonical JSON 结构。
- `.ai-agent/policies/agent-run-policy.json`：增加 No Progress Retry 配置。
- `agent-factory-dashboard/backend/src/domain/operator-override.ts`：新增受控声明修正类型。
- `agent-factory-dashboard/backend/src/application/operator-override-service.ts`：实现快照校验后的声明修正。
- `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`：新增声明修正 API，统一终态事件。
- `agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts`：统一 Rework 状态和最新运行显示。
- `agent-factory-dashboard/backend/src/application/orchestration-operation-store.ts`：终态收敛及损坏 Registry 显式报错。
- `agent-factory-dashboard/backend/tools/test-operator-overrides.js`：Developer 声明修正安全反例。
- `agent-factory-dashboard/backend/tools/test-monitor-human-gate.js`：Rework/Human Gate 时间线测试。
- `agent-factory-dashboard/backend/tools/test-orchestration-operation.js`：Operation/Lock 收敛测试。
- `agent-factory-dashboard/frontend/src/components/agent-factory/OperatorOverridePanel.tsx`：展示受控声明修正，不提供任意强制成功。
- `agent-factory-dashboard/frontend/src/components/agent-factory/ArtifactDrawer.tsx`：稳定展示 stdout/stderr 的空状态和读取错误。
- `agent-factory-dashboard/frontend/tools/test-artifact-drawer.test.tsx`：日志抽屉回归测试。
- `agent-factory-dashboard/backend/package.json`：注册可靠性总回归命令。

---

### Task 1: 建立冻结基线与总回归入口

**Files:**
- Create: `agent-factory-dashboard/backend/tools/test-adu-flow-reliability.js`
- Modify: `agent-factory-dashboard/backend/package.json`
- Test: `agent-factory-dashboard/backend/tools/test-adu-flow-reliability.js`

- [ ] **Step 1: 记录当前工作区，不覆盖已有修复**

Run:

```bash
git status --short
git diff -- scripts/hermes_agent_run.py scripts/agent_run_policy.py \
  agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts
```

Expected: 输出当前未提交变更。执行 Agent 必须逐块保留已有 Completion、日志、Rework Gate 和 Timeline 修复，不得重置文件。

- [ ] **Step 2: 创建失败优先的总回归脚本**

```javascript
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const checks = [
  ['completion', 'python3', ['scripts/test_agent_run_policy.py']],
  ['flow', 'python3', ['scripts/test_phase2_flow_integrity.py']],
  ['monitor', 'node', ['agent-factory-dashboard/backend/tools/test-monitor-human-gate.js']],
  ['operation', 'node', ['agent-factory-dashboard/backend/tools/test-orchestration-operation.js']],
  ['override', 'node', ['agent-factory-dashboard/backend/tools/test-operator-overrides.js']],
];

for (const [name, command, args] of checks) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[FAIL] ${name}`);
    process.exit(result.status || 1);
  }
  console.log(`[PASS] ${name}`);
}
```

- [ ] **Step 3: 注册命令并冻结当前基线**

在 `package.json` 增加：

```json
"test:adu-flow-reliability": "npm run build && node tools/test-adu-flow-reliability.js"
```

Run: `cd agent-factory-dashboard/backend && npm run test:adu-flow-reliability`

Expected: 当前已有专项测试全部 PASS。后续任务每增加一个测试文件，就把该测试追加到此总回归脚本。

- [ ] **Step 4: 提交测试入口**

```bash
git add agent-factory-dashboard/backend/package.json \
  agent-factory-dashboard/backend/tools/test-adu-flow-reliability.js
git commit -m "test(agent-factory): add ADU flow reliability regression entrypoint"
```

---

### Task 2: 修复 Rework 权限矛盾并保留文件真实性门禁

**Files:**
- Modify: `scripts/hermes_agent_run.py`
- Modify: `scripts/test_phase2_flow_integrity.py`
- Test: `scripts/test_phase2_flow_integrity.py`

- [ ] **Step 1: 添加 Rework 越权反例**

测试必须构造 `additional_write_paths=["src/core.c"]`、ADU 仅允许 `webui/`，并断言：

```python
gate = evaluate_rework_plan_gate(adu, result, repo_root)
assert gate["result"] == "human_gate"
assert gate["gate_type"] == "rework_requires_operator_cleanup"
assert gate["blocked_write_paths"] == ["src/core.c"]
assert gate["next_agent"] == "human"
```

同时添加允许路径正例，断言返回 `None`。

- [ ] **Step 2: 运行测试确认当前实现差异**

Run: `python3 scripts/test_phase2_flow_integrity.py`

Expected: 如果现有未提交代码仍设置 `next_agent: null`，反例应 FAIL，证明事件语义尚未完整。

- [ ] **Step 3: 完成 Rework Gate 返回协议**

`evaluate_rework_plan_gate()` 返回：

```python
return {
    "result": "human_gate",
    "next_state": "human_gate",
    "next_agent": "human",
    "gate_type": "rework_requires_operator_cleanup",
    "pre_gate_state": "rework_planned",
    "blocked_write_paths": sorted(set(blocked_paths)),
    "operator_actions": ["cleanup_out_of_scope_changes", "reject_rework_plan"],
    "changed_files": result.get("changed_files", []),
    "artifacts": result.get("artifacts", []),
    "commands_run": result.get("commands_run", []),
    "risks": ["Rework plan requires writes outside allowed_write_paths."],
}
```

门禁必须在 Rework Planner 成功后、Developer 被调度前执行。保留 `validate_agent_file_declarations()` 的 mtime 检查，不增加 `touch`。

- [ ] **Step 4: 验证 Rework 正反例**

Run: `python3 scripts/test_phase2_flow_integrity.py`

Expected: 全部 PASS；越权计划进入 Human Gate，允许范围内计划仍返回 Developer。

- [ ] **Step 5: 提交**

```bash
git add scripts/hermes_agent_run.py scripts/test_phase2_flow_integrity.py
git commit -m "fix(agent-factory): gate rework plans that exceed ADU permissions"
```

---

### Task 3: 用确定性编译器生成 Canonical Evidence

**Files:**
- Create: `scripts/evidence_package_compiler.py`
- Create: `scripts/test_evidence_package_compiler.py`
- Modify: `scripts/hermes_agent_run.py`
- Modify: `.ai-agent/prompts/evidence-agent.md`
- Modify: `scripts/validate_evidence_package.py`
- Test: `scripts/test_evidence_package_compiler.py`
- Test: `scripts/test_validate_evidence_package.py`

- [ ] **Step 1: 编写编译器失败测试**

覆盖以下场景：

```python
def test_runtime_assertion_requires_matching_trusted_command(): ...
def test_manual_assertion_compiles_from_acceptance_result(): ...
def test_negative_assertions_are_preserved(): ...
def test_missing_runtime_result_becomes_pending_environment_verification(): ...
def test_required_fields_exist_in_compiled_package(): ...
def test_a1_does_not_match_a12(): ...
```

Canonical 结构必须固定为：

```json
{
  "version": 1,
  "adu_id": "ADU-X",
  "acceptance_status": "pass",
  "assertions": {
    "A1": {
      "status": "pass",
      "command": "node tests/a.js",
      "exit_code": 0,
      "observed_result": "scenario passed"
    }
  },
  "negative_assertions": {
    "N1": {
      "status": "pass",
      "observed_result": "no out-of-scope files"
    }
  }
}
```

- [ ] **Step 2: 实现纯函数编译器**

```python
def compile_evidence(contract, acceptance_report, verification_results, runtime_records):
    assertions = {}
    acceptance_by_id = {
        item["assertion_id"]: item
        for item in acceptance_report.get("assertion_results", [])
        if isinstance(item, dict) and isinstance(item.get("assertion_id"), str)
    }
    command_results = {
        item["command"]: item
        for item in verification_results.get("commands", [])
        if isinstance(item, dict) and isinstance(item.get("command"), str)
    }
    for assertion in contract.get("acceptance_assertions", []):
        assertion_id = assertion["id"]
        review = acceptance_by_id.get(assertion_id, {})
        if assertion.get("verification_type") == "automated_test":
            command = assertion.get("verification_command", "")
            execution = command_results.get(command)
            assertions[assertion_id] = compile_runtime_assertion(review, command, execution, runtime_records)
        else:
            assertions[assertion_id] = compile_manual_assertion(review)
    return build_package(contract["adu_id"], assertions, acceptance_report)

def validate_compiled_package(package, contract):
    missing = []
    for requirement in contract.get("evidence_requirements", []):
        for field_path in requirement.get("required_fields", []):
            if not has_non_empty_path(package, field_path):
                missing.append(field_path)
    if missing:
        raise ValueError("Missing required evidence fields: " + ", ".join(missing))

def compile_evidence_from_files(contract_path, acceptance_path, verification_path, runtime_records):
    contract = load_json(contract_path)
    acceptance = load_json(acceptance_path)
    verification = load_json(verification_path)
    package = compile_evidence(contract, acceptance, verification, runtime_records)
    validate_compiled_package(package, contract)
    return package
```

命令匹配必须精确；`exit_code` 必须是整数 `0`；输出必须非空。缺失运行结果时生成 `pending_environment_verification`，不得猜测为 pass。

- [ ] **Step 3: 将 Evidence Agent 降级为审计说明生成器**

Prompt 中删除“Agent 自行决定 Evidence JSON 结构”的隐含职责，加入：

```markdown
The canonical `.ai-agent/evidence/{{ADU_ID}}.json` is generated by the runtime compiler.
Do not replace its schema. Read it, report risks, and write only
`.ai-agent/evidence/{{ADU_ID}}-notes.md` when explanatory notes are needed.
```

- [ ] **Step 4: Runner 在 Evidence 阶段调用编译器**

Evidence Agent 完成后，由 Runner 使用最新 Acceptance Run 的 `verification-results.json` 编译临时文件，验证后原子替换：

```python
temp_path = evidence_path.with_suffix(".json.tmp")
package = compile_evidence_from_files(
    contract_path,
    acceptance_path,
    verification_results_path,
    runtime_records,
)
temp_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
temp_path.replace(evidence_path)
```

- [ ] **Step 5: 验证编译与原校验器一致**

Run:

```bash
python3 scripts/test_evidence_package_compiler.py
python3 scripts/test_validate_evidence_package.py
```

Expected: 全部 PASS；Acceptance 的 `assertion_results[]` 被正确编译为 Evidence 的 `assertions{}`。

- [ ] **Step 6: 提交**

```bash
git add scripts/evidence_package_compiler.py scripts/test_evidence_package_compiler.py \
  scripts/hermes_agent_run.py scripts/validate_evidence_package.py \
  .ai-agent/prompts/evidence-agent.md
git commit -m "fix(agent-factory): compile canonical evidence deterministically"
```

---

### Task 4: 增加运行前后文件快照，安全修正 Developer 声明

**Files:**
- Create: `scripts/run_file_snapshot.py`
- Create: `scripts/test_run_file_snapshot.py`
- Modify: `scripts/hermes_agent_run.py`
- Test: `scripts/test_run_file_snapshot.py`

- [ ] **Step 1: 编写 SHA-256 快照测试**

```python
def test_diff_detects_created_modified_deleted_files(): ...
def test_unchanged_file_is_not_reported(): ...
def test_snapshot_rejects_path_escape(): ...
def test_declared_files_must_equal_or_be_subset_of_actual_delta(): ...
```

- [ ] **Step 2: 实现快照模块**

```python
def snapshot_allowed_files(repo_root: Path, allowed_paths: list[str]) -> dict[str, dict]:
    return {
        relative: {"sha256": sha256_file(path), "exists": True}
        for relative, path in expand_allowed_files(repo_root, allowed_paths)
        if path.is_file()
    }

def diff_snapshots(before: dict, after: dict) -> dict[str, list[str]]:
    keys = set(before) | set(after)
    return {
        "created": sorted(k for k in keys if k not in before),
        "modified": sorted(k for k in keys if k in before and k in after and before[k] != after[k]),
        "deleted": sorted(k for k in keys if k not in after),
    }
```

- [ ] **Step 3: Runner 持久化每次运行的快照和真实 Delta**

写入：

```text
.ai-agent/runs/<timestamp>-<adu>-<agent>/file-snapshot-before.json
.ai-agent/runs/<timestamp>-<adu>-<agent>/file-snapshot-after.json
.ai-agent/runs/<timestamp>-<adu>-<agent>/file-delta.json
```

`changed_files` 仍表示“本次运行实际修改”，不能表示整个 ADU 累计产物。

- [ ] **Step 4: 验证历史正确文件不会被 Agent 重新声明**

Run: `python3 scripts/test_run_file_snapshot.py`

Expected: 旧文件未变化时不在 Delta；Agent 声明旧文件时返回 `declared_changes_unverified`。

- [ ] **Step 5: 提交**

```bash
git add scripts/run_file_snapshot.py scripts/test_run_file_snapshot.py scripts/hermes_agent_run.py
git commit -m "feat(agent-factory): record per-run file deltas"
```

---

### Task 5: 用 `amend_file_declaration` 替代 Developer 强制成功

**Files:**
- Modify: `agent-factory-dashboard/backend/src/domain/operator-override.ts`
- Modify: `agent-factory-dashboard/backend/src/application/operator-override-service.ts`
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Modify: `agent-factory-dashboard/backend/tools/test-operator-overrides.js`
- Modify: `agent-factory-dashboard/frontend/src/components/agent-factory/OperatorOverridePanel.tsx`

- [ ] **Step 1: 添加安全反例**

测试必须证明以下请求被拒绝：

```javascript
await assertRejects(() => amend({ changed_files: ['src/not-in-delta.c'] }), 422);
await assertRejects(() => amendRunWithError('trusted_verification_failed'), 409);
await assertRejects(() => amendAlreadySuccessfulRun(), 409);
await assertRejects(() => amendWithoutComment(), 400);
```

- [ ] **Step 2: 扩展领域类型**

```typescript
export type OperatorOverrideOperation =
  | 'accept_validator_result'
  | 'amend_file_declaration';

export interface AmendFileDeclarationInput {
  operation: 'amend_file_declaration';
  changed_files: string[];
  comment: string;
}
```

- [ ] **Step 3: 实现严格适用条件**

只有同时满足以下条件才能修正：

```typescript
run.agent === 'developer'
run.error_code === 'declared_changes_unverified'
run.result === 'failed'
requestedFiles.every(file => actualDelta.has(file))
requestedFiles.every(file => isAllowedByAdu(file, adu.allowed_write_paths))
```

修正后保存原始 `parsed_result`、原始错误和操作员审计记录；状态仅推进到 `implemented`，后续 Code Review、BuildFix 和 Acceptance 不得跳过。

- [ ] **Step 4: 前端仅展示“修正文件声明”**

Developer 失败时不显示“强制通过”，只显示从 `file-delta.json` 选择真实文件的控件，并要求至少 10 字的原因。

- [ ] **Step 5: 验证**

Run:

```bash
cd agent-factory-dashboard/backend && npm run build && node tools/test-operator-overrides.js
cd ../frontend && npm run build
```

Expected: 允许真实 Delta 修正；拒绝越权文件和其他失败类型。

- [ ] **Step 6: 提交**

```bash
git add agent-factory-dashboard/backend/src/domain/operator-override.ts \
  agent-factory-dashboard/backend/src/application/operator-override-service.ts \
  agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts \
  agent-factory-dashboard/backend/tools/test-operator-overrides.js \
  agent-factory-dashboard/frontend/src/components/agent-factory/OperatorOverridePanel.tsx
git commit -m "feat(agent-factory): add verified developer declaration correction"
```

---

### Task 6: 为 No Progress 增加无副作用重试

**Files:**
- Modify: `.ai-agent/policies/agent-run-policy.json`
- Modify: `scripts/agent_run_policy.py`
- Modify: `scripts/hermes_agent_run.py`
- Modify: `scripts/test_agent_run_policy.py`

- [ ] **Step 1: 添加策略和反例测试**

```json
{
  "retry": {
    "no_progress_max_attempts": 2,
    "backoff_seconds": 5,
    "require_no_target_file_changes": true
  }
}
```

测试覆盖：第一次 `no_progress_timeout` 且目标文件未变化时重试；目标文件已变化、已有 Completion、收到明确 4xx 或第二次超时时不再重试。

- [ ] **Step 2: 扩展受控进程结果**

```python
ControlledProcessResult(
    stdout=final_stdout,
    stderr=final_stderr,
    returncode=exit_code,
    completion_result=completion_result,
    completion_status=completion_status,
    termination_reason=termination_reason,
    pid=proc.pid,
    target_files_changed=current_mtime > initial_mtime,
)
```

- [ ] **Step 3: Runner 实现 Attempt 循环**

```python
for attempt in range(1, policy.no_progress_max_attempts + 1):
    proc = execute_controlled_process(...)
    persist_attempt_log(run_dir, attempt, proc)
    retryable = (
        proc.termination_reason == "no_progress_timeout"
        and proc.completion_status == "missing"
        and not proc.target_files_changed
        and attempt < policy.no_progress_max_attempts
    )
    if not retryable:
        break
    time.sleep(policy.retry_backoff_seconds * attempt)
```

每个 Attempt 使用独立 session/completion 文件，避免读取上一次残留信号。

- [ ] **Step 4: 验证**

Run: `python3 scripts/test_agent_run_policy.py`

Expected: 无副作用挂起重试一次；有文件变化的挂起直接失败并保留现场。

- [ ] **Step 5: 提交**

```bash
git add .ai-agent/policies/agent-run-policy.json scripts/agent_run_policy.py \
  scripts/hermes_agent_run.py scripts/test_agent_run_policy.py
git commit -m "feat(agent-factory): retry no-progress runs without side effects"
```

---

### Task 7: 原子更新 Run、ADU 与 Operation 终态

**Files:**
- Modify: `scripts/hermes_agent_run.py`
- Modify: `scripts/hermes_agent_orchestrator.py`
- Modify: `agent-factory-dashboard/backend/src/application/orchestration-operation-store.ts`
- Modify: `agent-factory-dashboard/backend/tools/test-orchestration-operation.js`
- Modify: `agent-factory-dashboard/backend/tools/test-adu1351-regressions.js`

- [ ] **Step 1: 添加最新元数据失败测试**

构造 ADU 从 `acceptance_reviewed` 进入 `evidenced`，断言：

```javascript
assert.equal(adu.state, 'evidenced');
assert.equal(adu.latest_agent, 'evidence');
assert.equal(adu.latest_run_timestamp, evidenceRun.timestamp);
assert.equal(operation.status, 'completed');
assert.equal(operation.current_state, 'evidenced');
```

- [ ] **Step 2: Runner 在同一 Registry Lock 内写入最新元数据**

```python
fresh_adu["state"] = final_state
fresh_adu["latest_agent"] = args.agent
fresh_adu["latest_run_timestamp"] = run_record["timestamp"]
fresh_adu["last_result"] = run_record["result"]
fresh_adu["updated_at"] = datetime.now(timezone.utc).isoformat()
```

无论 success、failed、human_gate 都更新 latest 字段；只有 success 才推进业务 state。

- [ ] **Step 3: Orchestrator 终态统一关闭 Operation 和 Lock**

使用 `try/finally` 保证：

```python
finally:
    publish_operation_finished(final_status, final_state, error)
    release_owned_lock(adu_id, owner_token)
```

只释放当前 owner token 对应的锁；不得删除其他进程持有的锁。

- [ ] **Step 4: Operation Store 不再吞 JSON 损坏**

`operations.json` 或 `events.json` 解析失败时抛出包含文件路径的错误，不返回空数组伪装成“无运行”。

- [ ] **Step 5: 验证**

Run:

```bash
cd agent-factory-dashboard/backend
npm run build
node tools/test-orchestration-operation.js
node tools/test-adu1351-regressions.js
```

Expected: Evidence 运行成为最新元数据；死亡 PID 被收敛为 failed；活 PID 不被回收。

- [ ] **Step 6: 提交**

```bash
git add scripts/hermes_agent_run.py scripts/hermes_agent_orchestrator.py \
  agent-factory-dashboard/backend/src/application/orchestration-operation-store.ts \
  agent-factory-dashboard/backend/tools/test-orchestration-operation.js \
  agent-factory-dashboard/backend/tools/test-adu1351-regressions.js
git commit -m "fix(agent-factory): atomically converge run and operation state"
```

---

### Task 8: 固化 stdout/stderr 和 Completion 协议

**Files:**
- Modify: `scripts/hermes_agent_run.py`
- Modify: `scripts/test_agent_run_policy.py`
- Modify: `scripts/test_phase2_flow_integrity.py`
- Modify: `agent-factory-dashboard/backend/src/infrastructure/file-agent-factory-repository.ts`
- Modify: `agent-factory-dashboard/frontend/src/components/agent-factory/ArtifactDrawer.tsx`
- Modify: `agent-factory-dashboard/frontend/tools/test-artifact-drawer.test.tsx`

- [ ] **Step 1: 添加协议测试**

覆盖：合法 Completion 缺省 `commands_run/risks` 时规范化为空数组；成功运行 stderr 不写诊断成功摘要；失败运行 stderr 含错误码；不存在日志时 API 返回明确 `not_recorded`，而不是空白成功。

- [ ] **Step 2: 日志写入使用原始流语义**

```python
write_text_atomic(run_dir / "stdout.md", proc.stdout or "")
write_text_atomic(run_dir / "stderr.md", proc.stderr or "")
write_text_atomic(run_dir / "result.json", json.dumps(result, ensure_ascii=False, indent=2))
```

成功摘要写入 `result.json` 或 `summary.md`，不得写进 `stderr.md`。

- [ ] **Step 3: Artifact API 返回日志状态**

```typescript
type ArtifactReadResult = {
  path: string;
  content: string;
  truncated: boolean;
  availability: 'available' | 'empty' | 'not_recorded';
};
```

- [ ] **Step 4: 前端区分空日志与读取失败**

`empty` 显示“本次运行未产生 stderr”；`not_recorded` 显示“该历史运行未持久化日志”；API 错误显示错误消息和重试按钮。

- [ ] **Step 5: 验证**

Run:

```bash
python3 scripts/test_agent_run_policy.py
python3 scripts/test_phase2_flow_integrity.py
cd agent-factory-dashboard/frontend && npm run test:artifact-drawer && npm run build
```

Expected: Completion、成功、失败、空日志和历史缺失五种状态均通过。

- [ ] **Step 6: 提交**

```bash
git add scripts/hermes_agent_run.py scripts/test_agent_run_policy.py \
  scripts/test_phase2_flow_integrity.py \
  agent-factory-dashboard/backend/src/infrastructure/file-agent-factory-repository.ts \
  agent-factory-dashboard/frontend/src/components/agent-factory/ArtifactDrawer.tsx \
  agent-factory-dashboard/frontend/tools/test-artifact-drawer.test.tsx
git commit -m "fix(agent-factory): persist and classify agent run logs"
```

---

### Task 9: 统一 Rework 流程图与状态显示

**Files:**
- Modify: `agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts`
- Modify: `agent-factory-dashboard/backend/tools/test-monitor-human-gate.js`
- Modify: `agent-factory-dashboard/backend/tools/test-runtime-isolation.js`
- Test: `agent-factory-dashboard/backend/tools/test-monitor-human-gate.js`

- [ ] **Step 1: 添加状态映射测试**

```javascript
assert.equal(NEXT_AGENT_BY_STATE.rework_planned, 'developer');
assert.equal(workflow.find(x => x.state === 'rework_planned').status, 'current');
assert.equal(workflow.find(x => x.state === 'created').status, 'complete');
```

Human Gate 的 `pre_gate_state=rework_planned` 必须显示 Rework 节点 blocked，不得跳回 requirement-analyst。

- [ ] **Step 2: 统一三份状态定义**

`WORKFLOW_STEPS_CONFIG`、`STATE_ORDER`、`NEXT_AGENT_BY_STATE` 同时包含：

```typescript
{ state: 'rework_planned', label: 'Rework Planned', agent: 'developer' }
```

如果 `gate_type === 'rework_requires_operator_cleanup'`，显示 Human Gate 为 blocked，next agent 为 human。

- [ ] **Step 3: 验证**

Run:

```bash
cd agent-factory-dashboard/backend
npm run build
node tools/test-monitor-human-gate.js
node tools/test-runtime-isolation.js
```

Expected: `rework_planned` 不再回到 Phase 1，Scope 隔离仍通过。

- [ ] **Step 4: 提交**

```bash
git add agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts \
  agent-factory-dashboard/backend/tools/test-monitor-human-gate.js \
  agent-factory-dashboard/backend/tools/test-runtime-isolation.js
git commit -m "fix(dashboard): render rework workflow state accurately"
```

---

### Task 10: 全量回归、真实夹具验证与交付

**Files:**
- Modify: `agent-factory-dashboard/backend/tools/test-adu-flow-reliability.js`
- Modify: `docs/superpowers/plans/2026-06-28-agent-factory-adu-flow-reliability-bugfix-plan.md`

- [ ] **Step 1: 使用脱敏副本回归 ADU-1351-002**

从现有 Contract、Acceptance、Rework Plan 和 Run Record 构造临时目录夹具。测试不得写入生产 `.ai-agent/registry/*.json`。

必须验证：

1. 越权 Rework Plan 进入 Human Gate。
2. Developer 不能声明未修改的历史 WebUI 文件。
3. Canonical Evidence 一次生成并通过 Validator。
4. Evidence 成为 ADU 最新 Agent。
5. Operation 完成且 Lock 被 owner-safe 释放。

- [ ] **Step 2: 运行专项总回归**

先在 `test-adu-flow-reliability.js` 的 `checks` 中追加：

```javascript
['evidence-compiler', 'python3', ['scripts/test_evidence_package_compiler.py']],
['file-snapshot', 'python3', ['scripts/test_run_file_snapshot.py']],
```

Run:

```bash
cd agent-factory-dashboard/backend
npm run test:adu-flow-reliability
npm run test:operator
npm run test:agent-runtime-status
```

Expected: 全部 PASS。

- [ ] **Step 3: 运行构建与通用回归**

Run:

```bash
python3 -m py_compile scripts/hermes_agent_run.py scripts/hermes_agent_orchestrator.py \
  scripts/agent_run_policy.py scripts/evidence_package_compiler.py scripts/run_file_snapshot.py
python3 scripts/test_validate_evidence_package.py
cd agent-factory-dashboard/backend && npm run build
cd ../frontend && npm run build && npm run test:artifact-drawer
git diff --check
```

Expected: Python、后端、前端、Evidence 和格式检查全部通过。

- [ ] **Step 4: 检查生产 Registry 未被测试污染**

Run:

```bash
git status --short .ai-agent/registry
python3 scripts/agent_factory_doctor.py --skip-hermes
```

Expected: 没有新增运行态 Registry 文件进入 Git；Doctor 为 0 errors。

- [ ] **Step 5: 更新清单状态并提交**

在本计划第 1 节为每个 BUG 填写最终提交号与验证命令，随后：

```bash
git add docs/superpowers/plans/2026-06-28-agent-factory-adu-flow-reliability-bugfix-plan.md \
  agent-factory-dashboard/backend/tools/test-adu-flow-reliability.js
git commit -m "docs(agent-factory): close ADU flow reliability bugfix plan"
```

## 4. 验收标准

1. 新 ADU 的完整流程无需手工编辑任何 Registry JSON。
2. 越权 Rework 不会被错误分派给 Developer。
3. Agent 无法通过声明历史文件或 `touch` 文件伪造本轮变更。
4. Evidence 首次生成即满足 Contract Schema，缺少运行证据时进入 Human Gate。
5. Developer 声明纠偏只能接受快照证明的实际 Delta，且不会跳过后续质量门。
6. No Progress 仅在无文件副作用、无 Completion 时自动重试，最多一次。
7. 每次运行均有明确 stdout/stderr 可用性状态。
8. ADU、Run、Operation、Lock、Timeline 的最终状态一致。
9. `ADU-1351-002` 脱敏夹具和全部现有 Phase 3.7 回归测试通过。

## 5. 实施顺序与发布门

- **批次 A（阻断性修复）：** Task 1-3。完成后解决 Rework 与 Evidence 两个 P0。
- **批次 B（安全纠偏与容错）：** Task 4-6。完成后开放受控纠偏和安全重试。
- **批次 C（可观测性与一致性）：** Task 7-9。完成后解决页面、日志和状态漂移。
- **批次 D（交付）：** Task 10。只有专项回归、全量构建和 Doctor 同时通过才允许合并。

每个批次必须单独评审。批次 A 未通过时，不得开始通过 Operator Override 绕过 P0。

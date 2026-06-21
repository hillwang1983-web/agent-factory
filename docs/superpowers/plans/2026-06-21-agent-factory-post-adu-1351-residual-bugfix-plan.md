# Agent Factory Post-ADU-1351 Residual Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `ADU-1351-001` 真实开发链路暴露的 6 项 Agent Factory 遗留缺陷，使 Code Review、返工、命令验证、Evidence、人工纠偏和 Token 统计形成可审计的确定性闭环。

**Architecture:** 保留 Hermes 负责推理和生成候选结论，但不再直接信任 Agent 对代码事实、命令结果、文件变更和 Token 用量的自述。Runner 负责完成信封解析、命令策略校验和可信验证记录；独立 Validator 负责将 Contract、源码快照、测试结果与质量报告交叉校验；Dashboard 只通过受控 API 执行人工覆盖并保留不可变审计记录。

**Tech Stack:** Python 3、Hermes CLI、Node.js/TypeScript、Express、React、Zustand、JSON 文件注册表、现有 RegistryLock、Meson/项目自定义验证命令。

---

## 1. 修复范围

本计划覆盖 `ADU-1351-001` 执行后确认的以下缺陷：

| ID | 严重度 | 缺陷 | 目标结果 |
|---|---|---|---|
| AF-1351-01 | P1 | Code Reviewer 可产生事实性假通过 | Reviewer 的通过结论必须由源码哈希、Contract 覆盖和 Runner 可信验证记录支持 |
| AF-1351-02 | P1 | `completion.json` 已合法生成，但 Runner 误解析 stdout 中的业务 JSON | 启用完成协议时只以合法完成信封为终态来源，stdout 只用于诊断 |
| AF-1351-03 | P1 | Agent 可声明或执行不在 ADU allowlist 中的验证命令 | 状态推进只承认 Runner 按策略执行的命令；违规命令进入结构化 Human Gate |
| AF-1351-04 | P1 | Evidence Agent 把 Registry/generated 文件误报为 `changed_files` | Evidence 角色使用独立文件声明规则，运行态文件不会导致错误失败 |
| AF-1351-05 | P2 | 缺少标准化人工纠偏机制 | 通过 API/UI 创建可审计 override，禁止直接改 `adu.json`/`runs.json` |
| AF-1351-06 | P2 | Token 汇总遗漏重复运行和最终 Agent | 从所有 run 记录聚合，按 Agent 保存累计值和运行次数 |

### 1.1 明确不在本轮范围内的事项

本轮的 Command Policy 是 **Runner 可信执行与状态推进门禁**：

1. Agent 自报的 `commands_run` 不再作为验证证据。
2. Runner 只执行 ADU `command_policy.allowed_commands` 中允许的命令。
3. 不在 allowlist 中的命令不能形成可信验证结果，也不能推动状态。
4. Agent 自报执行了越权命令时，流程进入 `command_policy_exception` Human Gate。

本轮不声称提供容器、虚拟机或内核级命令隔离。若要在执行前物理阻止 Hermes 使用绝对路径调用任意二进制，应单独规划 sandbox/container executor。

## 2. 文件结构与职责

### 新增文件

| 文件 | 单一职责 |
|---|---|
| `scripts/command_policy.py` | 规范化命令并判断 allowlist/blocked pattern |
| `scripts/run_trusted_verification.py` | 由 Runner 执行批准命令并生成可信验证记录 |
| `scripts/code_review_fact_gate.py` | 交叉校验 Code Review、Contract、源码快照和可信验证记录 |
| `scripts/token_ledger.py` | 从 runs 生成确定性的 ADU Token 汇总 |
| `scripts/test_command_policy.py` | Command Policy 正反例测试 |
| `scripts/test_code_review_fact_gate.py` | Code Review 假通过反例测试 |
| `scripts/test_token_ledger.py` | Token 重复运行和最终 Agent 聚合测试 |
| `agent-factory-dashboard/backend/src/domain/operator-override.ts` | 人工覆盖领域类型 |
| `agent-factory-dashboard/backend/src/application/operator-override-service.ts` | 覆盖校验、状态修改和审计写入 |
| `agent-factory-dashboard/frontend/src/components/agent-factory/OperatorOverridePanel.tsx` | 人工纠偏交互面板 |
| `agent-factory-dashboard/backend/tools/test-operator-overrides.js` | Override API 集成测试 |
| `agent-factory-dashboard/backend/tools/test-adu1351-regressions.js` | 六项缺陷统一回归入口 |

### 修改文件

| 文件 | 修改职责 |
|---|---|
| `scripts/agent_run_policy.py` | 完成信封读取结果增加明确状态，不再与 stdout 竞争 |
| `scripts/hermes_agent_run.py` | 完成信封优先级、角色化文件声明、可信验证和质量门接入 |
| `scripts/hermes_agent_orchestrator.py` | 调用统一 Token Ledger，不再覆盖同 Agent 的历史用量 |
| `scripts/validate_quality_report.py` | Code Review 接入事实门；保留 Acceptance 现有行为 |
| `.ai-agent/prompts/code-reviewer-agent.md` | 输出可验证的源码声明和 Contract 映射 |
| `.ai-agent/prompts/buildfix-debugger-agent.md` | 禁止将自报命令当成可信验证证据 |
| `.ai-agent/prompts/evidence-agent.md` | 限定 Evidence 的 `changed_files` 和 `artifacts` |
| `agent-factory-dashboard/backend/src/domain/agent-factory.ts` | 扩展 run、token summary、override 类型 |
| `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts` | 新增 override API 和准确 Token API |
| `agent-factory-dashboard/backend/src/infrastructure/file-agent-factory-repository.ts` | 受锁保护地追加 override 和修改 run/ADU |
| `agent-factory-dashboard/frontend/src/api/agentFactory.ts` | 新增 override API client |
| `agent-factory-dashboard/frontend/src/types/agent-factory.ts` | 同步新类型 |
| `agent-factory-dashboard/frontend/src/components/agent-factory/AgentFactoryPage.tsx` | 挂载人工纠偏面板 |
| `agent-factory-dashboard/backend/package.json` | 注册专项回归测试 |

## 3. 数据契约

### 3.1 可信命令验证记录

每次由 Runner 执行的命令写入：

```text
<project-repo>/.ai-agent/runs/<run-id>/verification-results.json
```

结构固定为：

```json
{
  "version": 1,
  "adu_id": "ADU-1351-001",
  "run_id": "20260621-100512-code-reviewer",
  "generated_by": "agent-factory-runner",
  "commands": [
    {
      "command": "meson test -C build unit",
      "policy_decision": "allowed",
      "started_at": "2026-06-21T10:05:12Z",
      "finished_at": "2026-06-21T10:05:18Z",
      "exit_code": 0,
      "stdout_path": "verification/command-001.stdout.log",
      "stderr_path": "verification/command-001.stderr.log",
      "stdout_sha256": "hex-digest",
      "stderr_sha256": "hex-digest",
      "timed_out": false
    }
  ]
}
```

### 3.2 Code Review 可验证声明

Code Review JSON 增加：

```json
{
  "report_version": 3,
  "source_snapshot": [
    {
      "path": "lib/app/ogs-license.c",
      "sha256": "hex-digest"
    }
  ],
  "fact_claims": [
    {
      "id": "FC-001",
      "kind": "pattern_absent",
      "path": "lib/app/ogs-license.c",
      "pattern": "\\(void\\)",
      "description": "关键返回值未通过 void cast 丢弃"
    },
    {
      "id": "FC-002",
      "kind": "test_command",
      "command": "meson test -C build unit",
      "expected_exit_code": 0,
      "description": "单元测试通过"
    }
  ],
  "contract_assertion_results": [
    {
      "assertion_id": "A5",
      "status": "pass",
      "evidence_claim_ids": ["FC-002"],
      "test_references": ["tests/unit/license-test.c:test_license_next_key"]
    }
  ]
}
```

允许的 `fact_claims.kind` 仅包括：

```text
file_exists
pattern_present
pattern_absent
test_command
```

Validator 不解释自然语言 summary，也不尝试证明任意开放式声明。

### 3.3 人工覆盖记录

新增 Registry：

```text
.ai-agent/registry/operator-overrides.json
```

结构：

```json
{
  "version": 1,
  "overrides": [
    {
      "override_id": "override-ADU-1351-001-20260621T103000Z",
      "adu_id": "ADU-1351-001",
      "run_timestamp": "20260621-102439",
      "operation": "accept_validator_result",
      "from_result": "failed",
      "to_result": "success",
      "from_state": "acceptance_reviewed",
      "to_state": "evidenced",
      "reason_code": "agent_declaration_mismatch",
      "comment": "Evidence validator passed; Agent incorrectly declared runtime registry files.",
      "validator": {
        "command": "python3 scripts/validate_evidence_package.py --adu ADU-1351-001 --repo-root /workspace/open5gs --registry-dir /workspace/.ai-agent/registry",
        "exit_code": 0,
        "output": "PASS: All contract assertions have valid evidence/waivers."
      },
      "actor": "operator",
      "created_at": "2026-06-21T10:30:00Z"
    }
  ]
}
```

### 3.4 Token 汇总

`token_summary.agentBreakdown` 改为累计结构：

```json
{
  "inputTokens": 130000,
  "outputTokens": 7000,
  "totalTokens": 137000,
  "runCount": 21,
  "agentBreakdown": {
    "code-reviewer": {
      "inputTokens": 19594,
      "outputTokens": 1014,
      "runCount": 2,
      "successCount": 2,
      "failureCount": 0,
      "status": "normal"
    },
    "evidence": {
      "inputTokens": 5000,
      "outputTokens": 300,
      "runCount": 1,
      "successCount": 1,
      "failureCount": 0,
      "status": "normal"
    }
  }
}
```

---

### Task 1: 建立 ADU-1351 缺陷回归基线

**Files:**
- Create: `agent-factory-dashboard/backend/tools/test-adu1351-regressions.js`
- Modify: `agent-factory-dashboard/backend/package.json`
- Reference: `.ai-agent/registry/runs.json`

- [ ] **Step 1: 编写统一测试入口**

创建以下脚本，任何子测试失败时立即退出：

```javascript
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const tests = [
  ['python3', ['scripts/test_agent_run_policy.py']],
  ['python3', ['scripts/test_command_policy.py']],
  ['python3', ['scripts/test_code_review_fact_gate.py']],
  ['python3', ['scripts/test_token_ledger.py']],
  ['node', ['agent-factory-dashboard/backend/tools/test-operator-overrides.js']],
];

for (const [command, args] of tests) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env },
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('[PASS] ADU-1351 residual regression suite');
```

- [ ] **Step 2: 注册 package script**

在 `agent-factory-dashboard/backend/package.json` 的 `scripts` 中增加：

```json
"test:adu1351-regressions": "node tools/test-adu1351-regressions.js"
```

- [ ] **Step 3: 运行基线并确认缺失测试失败**

Run:

```bash
cd agent-factory-dashboard/backend
npm run test:adu1351-regressions
```

Expected: FAIL，首先报告 `scripts/test_command_policy.py` 不存在。

- [ ] **Step 4: Commit**

```bash
git add agent-factory-dashboard/backend/tools/test-adu1351-regressions.js agent-factory-dashboard/backend/package.json
git commit -m "test(agent-factory): add ADU-1351 residual regression entrypoint"
```

---

### Task 2: 修复完成信封与 stdout 解析竞争

**Files:**
- Modify: `scripts/agent_run_policy.py`
- Modify: `scripts/hermes_agent_run.py:908-929`
- Modify: `scripts/test_agent_run_policy.py`

- [ ] **Step 1: 增加“completion 存在时禁止 stdout 抢占”的失败测试**

在 `scripts/test_agent_run_policy.py` 增加一个子进程场景：

```python
def write_business_json_then_completion(completion_path):
    print(json.dumps({
        "version": 1,
        "adu_id": "ADU-TEST",
        "source": "code-review",
        "must_fix_now": []
    }), flush=True)
    envelope = {
        "version": 1,
        "status": "success",
        "result": {
            "result": "success",
            "next_state": "rework_planned",
            "changed_files": [".ai-agent/rework/ADU-TEST-rework-plan.json"],
            "artifacts": [".ai-agent/rework/ADU-TEST-rework-plan.json"],
            "commands_run": [],
            "risks": [],
            "next_agent": "developer"
        }
    }
    tmp = completion_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(envelope), encoding="utf-8")
    tmp.replace(completion_path)
    time.sleep(60)
```

断言：

```python
assert result.completion_status == "valid"
assert result.completion_result["next_state"] == "rework_planned"
assert result.termination_reason == "completion_signal"
```

- [ ] **Step 2: 运行测试并验证当前实现失败**

Run:

```bash
python3 scripts/test_agent_run_policy.py
```

Expected: FAIL，因为 `ControlledProcessResult` 尚无 `completion_status`。

- [ ] **Step 3: 扩展受控进程结果**

在 `scripts/agent_run_policy.py` 的结果数据结构中增加：

```python
completion_status: str
```

只允许以下值：

```text
not_expected
missing
invalid
valid
```

`execute_controlled_process()` 的返回逻辑：

```python
if completion_path is None:
    completion_status = "not_expected"
elif completion_result is not None:
    completion_status = "valid"
elif completion_path.exists():
    completion_status = "invalid"
else:
    completion_status = "missing"
```

- [ ] **Step 4: 修改 Runner 的终态解析规则**

将 `scripts/hermes_agent_run.py` 中：

```python
result = proc.completion_result or extract_json_result(proc.stdout)
```

替换为：

```python
if proc.completion_status == "valid":
    result = proc.completion_result
elif proc.completion_status == "not_expected":
    result = extract_json_result(proc.stdout)
else:
    result = None
```

当 completion 协议已启用但结果为 `missing` 或 `invalid` 时，生成：

```python
result = build_unstructured_result(proc.stdout, proc.stderr)
result["error_code"] = (
    "invalid_completion_envelope"
    if proc.completion_status == "invalid"
    else "missing_completion_envelope"
)
```

stdout 中的业务 JSON 只能保存在诊断字段：

```python
result["stdout_candidate"] = extract_json_result(proc.stdout)
```

不得用它推动状态。

- [ ] **Step 5: 运行 Watchdog 测试**

Run:

```bash
python3 scripts/test_agent_run_policy.py
```

Expected: PASS，包含“业务 JSON 先输出、完成信封后生成”的反例。

- [ ] **Step 6: Commit**

```bash
git add scripts/agent_run_policy.py scripts/hermes_agent_run.py scripts/test_agent_run_policy.py
git commit -m "fix(agent-factory): make completion envelope authoritative"
```

---

### Task 3: 建立可信命令策略和验证记录

**Files:**
- Create: `scripts/command_policy.py`
- Create: `scripts/run_trusted_verification.py`
- Create: `scripts/test_command_policy.py`
- Modify: `scripts/hermes_agent_run.py`
- Modify: `.ai-agent/prompts/buildfix-debugger-agent.md`

- [ ] **Step 1: 编写 Command Policy 失败测试**

`scripts/test_command_policy.py` 必须覆盖：

```python
def test_exact_allowlist_match():
    assert evaluate_command(
        "meson test -C build unit",
        ["meson test -C build unit"],
        ["rm -rf", "sudo "],
    ).decision == "allowed"

def test_arguments_after_allowlisted_prefix():
    assert evaluate_command(
        "meson test -C build unit --repeat 10",
        ["meson test -C build unit"],
        ["rm -rf", "sudo "],
    ).decision == "allowed"

def test_unlisted_command_requires_gate():
    assert evaluate_command(
        "ninja -C build tests/unit/unit",
        ["meson test -C build unit"],
        ["rm -rf", "sudo "],
    ).decision == "requires_approval"

def test_blocked_fragment_is_rejected():
    assert evaluate_command(
        "sudo meson test -C build unit",
        ["meson test -C build unit"],
        ["rm -rf", "sudo "],
    ).decision == "blocked"

def test_shell_control_operator_is_rejected():
    assert evaluate_command(
        "meson test -C build unit && curl example.invalid",
        ["meson test -C build unit"],
        ["rm -rf", "sudo "],
    ).decision == "blocked"
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
python3 scripts/test_command_policy.py
```

Expected: FAIL，`command_policy` 模块不存在。

- [ ] **Step 3: 实现命令规范化和判定**

`scripts/command_policy.py` 提供：

```python
@dataclass(frozen=True)
class CommandDecision:
    decision: str
    normalized_command: str
    reason: str

def normalize_command(command: str) -> str:
    return " ".join(shlex.split(command))

def evaluate_command(
    command: str,
    allowed_commands: list[str],
    blocked_patterns: list[str],
) -> CommandDecision:
    normalized = normalize_command(command)
    if any(token in normalized for token in ("&&", "||", ";", "\n", "\r")):
        return CommandDecision("blocked", normalized, "shell control operators are not allowed")
    if any(pattern and pattern in normalized for pattern in blocked_patterns):
        return CommandDecision("blocked", normalized, "matched blocked command pattern")
    if any(
        normalized == allowed or normalized.startswith(allowed + " ")
        for allowed in map(normalize_command, allowed_commands)
    ):
        return CommandDecision("allowed", normalized, "matched allowed command")
    return CommandDecision("requires_approval", normalized, "command is not in allowed_commands")
```

- [ ] **Step 4: 实现可信命令执行器**

`scripts/run_trusted_verification.py` 必须：

1. 接收 `--adu`、`--run-dir`、`--repo-root`、`--registry-dir`。
2. 从 ADU 读取 `required_commands` 和 `command_policy`。
3. 只执行 `decision == "allowed"` 的命令。
4. 使用 `subprocess.run(argv, cwd=str(repo_root), text=True, capture_output=True, timeout=timeout_seconds, shell=False)`。
5. 使用 `shlex.split()` 构造 argv。
6. 将 stdout/stderr 分别写入 `run-dir/verification/`。
7. 原子写入 `verification-results.json`。
8. 任意命令非零返回时自身退出码为 `1`。
9. 任意命令需要审批时退出码为 `20`。
10. 任意命令命中 blocked pattern 时退出码为 `2`。

核心执行必须是：

```python
argv = shlex.split(decision.normalized_command)
completed = subprocess.run(
    argv,
    cwd=str(repo_root),
    text=True,
    capture_output=True,
    timeout=timeout_seconds,
    shell=False,
)
```

- [ ] **Step 5: Runner 接入可信验证**

在 `scripts/hermes_agent_run.py` 中：

1. `buildfix-debugger`、`code-reviewer`、`acceptance-reviewer` 完成候选输出后，调用 `run_trusted_verification.py`。
2. `commands_run` 改名理解为 `agent_reported_commands`，仅保存审计，不作为 pass 证据。
3. 可信执行器返回 `20` 时：

```python
run_result = "human_gate"
result["result"] = "human_gate"
result["gate_type"] = "command_policy_exception"
result["next_state"] = "human_gate"
result["next_agent"] = "human"
```

4. 可信执行器返回 `1/2` 时，质量门失败，不推进状态。
5. 将 `verification_results_path` 写入 run record。

- [ ] **Step 6: 更新 BuildFix Prompt**

在 `.ai-agent/prompts/buildfix-debugger-agent.md` 加入：

```markdown
- `commands_run` is an audit declaration only. It is not trusted verification evidence.
- Do not invent alternative build commands. Use only commands listed in
  `adu.command_policy.allowed_commands`.
- The Agent Factory Runner will independently execute approved verification
  commands after your response. A command outside the allowlist triggers a
  `command_policy_exception` human gate.
```

- [ ] **Step 7: 运行专项测试**

Run:

```bash
python3 scripts/test_command_policy.py
python3 scripts/run_trusted_verification.py \
  --adu ADU-1351-001 \
  --run-dir /tmp/adu-1351-verification-test \
  --repo-root /Users/hill/open5gs/open5gs \
  --registry-dir /Users/hill/open5gs/.ai-agent/registry
```

Expected:

- 单元测试全部 PASS。
- 执行器只运行 ADU 允许的命令。
- `verification-results.json` 存在且命令记录包含 hash、exit code 和日志路径。

- [ ] **Step 8: Commit**

```bash
git add scripts/command_policy.py scripts/run_trusted_verification.py scripts/test_command_policy.py scripts/hermes_agent_run.py .ai-agent/prompts/buildfix-debugger-agent.md
git commit -m "feat(agent-factory): add trusted command verification gate"
```

---

### Task 4: 阻断 Code Reviewer 事实性假通过

**Files:**
- Create: `scripts/code_review_fact_gate.py`
- Create: `scripts/test_code_review_fact_gate.py`
- Modify: `scripts/validate_quality_report.py`
- Modify: `.ai-agent/prompts/code-reviewer-agent.md`

- [ ] **Step 1: 编写 ADU-1351 型假通过反例**

创建临时项目：

```python
source.write_text(
    "int f(void) { (void)dangerous_call(); return 0; }\n",
    encoding="utf-8",
)
```

写入声称不存在 `(void)` 的报告：

```python
report = {
    "report_version": 3,
    "adu_id": "ADU-TEST",
    "review_status": "pass",
    "next_state": "code_reviewed",
    "checked_files": ["src/license.c"],
    "source_snapshot": [{
        "path": "src/license.c",
        "sha256": sha256_file(source),
    }],
    "fact_claims": [{
        "id": "FC-1",
        "kind": "pattern_absent",
        "path": "src/license.c",
        "pattern": r"\(void\)",
        "description": "No discarded return value",
    }],
    "contract_assertion_results": [{
        "assertion_id": "A1",
        "status": "pass",
        "evidence_claim_ids": ["FC-1"],
        "test_references": ["tests/test_license.c:test_a1"],
    }],
    "findings": [],
    "required_developer_actions": [],
}
```

断言 Validator 返回非零且 failure code 为：

```text
fact_claim_contradicted
```

- [ ] **Step 2: 增加可信测试命令反例**

报告声明：

```json
{
  "kind": "test_command",
  "command": "meson test -C build unit",
  "expected_exit_code": 0
}
```

但 `verification-results.json` 中该命令 `exit_code` 为 `1`。断言：

```text
trusted_test_command_failed
```

- [ ] **Step 3: 增加 Contract 覆盖缺失反例**

Contract 包含 `A1`、`A2` 两个 `must_pass: true` 断言，报告只覆盖 `A1`。断言：

```text
contract_assertion_coverage_incomplete
```

- [ ] **Step 4: 运行测试并确认失败**

Run:

```bash
python3 scripts/test_code_review_fact_gate.py
```

Expected: FAIL，事实门模块不存在。

- [ ] **Step 5: 实现源码事实门**

`scripts/code_review_fact_gate.py` 必须完成：

1. 校验 `report_version == 3`。
2. `checked_files` 均存在并位于 repo 内。
3. `source_snapshot` 的 SHA-256 与当前文件一致。
4. `pattern_present` 使用 Python `re.search()` 验证。
5. `pattern_absent` 必须确认 `re.search()` 无匹配。
6. `test_command` 只能引用 `verification-results.json` 中的可信记录。
7. 每个 `must_pass` Contract assertion 必须存在唯一结果。
8. pass assertion 至少引用一个 `fact_claim`。
9. `test_references` 中 `path:symbol` 的路径必须存在。
10. 任意矛盾使 Code Review pass 失效。

返回 JSON：

```json
{
  "valid": false,
  "failure_code": "fact_claim_contradicted",
  "claim_id": "FC-1",
  "message": "pattern_absent claim contradicted by src/license.c"
}
```

- [ ] **Step 6: 接入现有质量报告 Validator**

在 `scripts/validate_quality_report.py`：

1. 为 CLI 增加可选参数：

```text
--run-dir
```

2. `--kind code-review` 且 `review_status == pass` 时，调用：

```python
validate_code_review_facts(
    report=report,
    contract=contract,
    repo_root=root,
    verification_results_path=run_dir / "verification-results.json",
)
```

3. 事实门失败必须沿用非零退出码，Runner 不能推进到 `code_reviewed`。

- [ ] **Step 7: 更新 Code Reviewer Prompt**

明确禁止无法验证的泛化结论：

```markdown
- A pass report MUST use `report_version: 3`.
- Every factual statement used to justify pass MUST be represented in
  `fact_claims`.
- Do not claim a test passed from source inspection or from the presence of a
  test file. Reference the trusted command exactly as listed in the runtime
  verification results.
- Do not write broad claims such as "fully covered", "perfectly implemented",
  "no placeholders", or "no discarded return values" unless each claim has a
  machine-verifiable fact entry.
- Every must-pass contract assertion must reference fact claim IDs and concrete
  test symbols.
```

- [ ] **Step 8: 运行质量门测试**

Run:

```bash
python3 scripts/test_code_review_fact_gate.py
python3 scripts/test_validate_quality_report.py
cd agent-factory-dashboard/backend
npm run test:quality-gates
```

Expected: 全部 PASS，且 ADU-1351 型假通过被拒绝。

- [ ] **Step 9: Commit**

```bash
git add scripts/code_review_fact_gate.py scripts/test_code_review_fact_gate.py scripts/validate_quality_report.py .ai-agent/prompts/code-reviewer-agent.md
git commit -m "fix(agent-factory): require deterministic facts for code review pass"
```

---

### Task 5: 修复 Evidence 角色的文件声明语义

**Files:**
- Modify: `scripts/hermes_agent_run.py`
- Modify: `.ai-agent/prompts/evidence-agent.md`
- Modify: `scripts/test_agent_run_policy.py`

- [ ] **Step 1: 编写 Evidence 声明分类测试**

在测试中构造：

```python
result = {
    "result": "success",
    "changed_files": [
        ".ai-agent/evidence/ADU-TEST.json",
        ".ai-agent/registry/adu.json",
        "build/build.ninja",
    ],
    "artifacts": [".ai-agent/evidence/ADU-TEST.json"],
}
```

期望分类结果：

```python
assert classification.valid_changed_files == [
    ".ai-agent/evidence/ADU-TEST.json"
]
assert classification.runtime_managed_files == [
    ".ai-agent/registry/adu.json"
]
assert classification.generated_files == [
    "build/build.ninja"
]
assert classification.errors == []
```

如果 Evidence 声明了 `src/foo.c`，必须报：

```text
evidence_agent_declared_source_change
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
python3 scripts/test_agent_run_policy.py
```

Expected: FAIL，因为尚无角色化分类函数。

- [ ] **Step 3: 实现角色化文件声明验证**

在 `scripts/hermes_agent_run.py` 增加：

```python
RUNTIME_MANAGED_PREFIXES = (
    ".ai-agent/registry/",
    ".ai-agent/locks/",
    ".ai-agent/runs/",
)

GENERATED_PREFIXES = (
    "build/",
    "dist/",
    "coverage/",
)
```

提供：

```python
def validate_agent_file_declarations(agent_name, result, repo_root, run_started_ns):
    declared = result.get("changed_files", [])
    if not isinstance(declared, list):
        return {
            "valid_changed_files": [],
            "runtime_managed_files": [],
            "generated_files": [],
            "errors": ["changed_files must be an array"],
        }

    valid_changed_files = []
    runtime_managed_files = []
    generated_files = []
    errors = []

    for raw_path in declared:
        normalized = normalize_repo_relative_path(raw_path)
        if not normalized:
            errors.append(f"invalid changed_files path: {raw_path!r}")
            continue

        if normalized.startswith(RUNTIME_MANAGED_PREFIXES):
            runtime_managed_files.append(normalized)
            continue

        if normalized.startswith(GENERATED_PREFIXES):
            generated_files.append(normalized)
            continue

        if agent_name == "evidence":
            allowed_prefix = ".ai-agent/evidence/"
            if not normalized.startswith(allowed_prefix):
                errors.append(
                    f"evidence_agent_declared_source_change: {normalized}"
                )
                continue

        file_path = (repo_root / normalized).resolve()
        try:
            file_path.relative_to(repo_root.resolve())
        except ValueError:
            errors.append(f"changed file escapes repository: {normalized}")
            continue
        if not file_path.is_file():
            errors.append(f"declared changed file does not exist: {normalized}")
            continue
        if file_path.stat().st_mtime_ns < run_started_ns:
            errors.append(
                f"declared changed file was not modified during this run: {normalized}"
            )
            continue
        valid_changed_files.append(normalized)

    return {
        "valid_changed_files": valid_changed_files,
        "runtime_managed_files": runtime_managed_files,
        "generated_files": generated_files,
        "errors": errors,
    }
```

Evidence 角色规则：

1. `changed_files` 只允许 `.ai-agent/evidence/<ADU_ID>.json` 和对应 Markdown。
2. Registry、lock、run metadata 归入 `runtime_managed_files`，不作为 Agent 修改验证。
3. `build/` 等生成文件归入 `generated_files`，不作为 Agent 修改验证。
4. 任何源码路径进入 `changed_files` 都失败。
5. 分类结果写入 run record，保留审计。

- [ ] **Step 4: 更新 Evidence Prompt**

将最终输出模板固定为：

```json
{
  "result": "success",
  "next_state": "evidenced",
  "changed_files": [".ai-agent/evidence/{{ADU_ID}}.json"],
  "runtime_managed_files": [],
  "generated_files": [],
  "commands_run": [],
  "artifacts": [".ai-agent/evidence/{{ADU_ID}}.json"],
  "risks": [],
  "next_agent": null
}
```

并明确：

```markdown
- Never list `.ai-agent/registry/*`, `.ai-agent/locks/*`, `.ai-agent/runs/*`,
  `build/*`, `dist/*`, or `coverage/*` in `changed_files`.
- Do not repeat commands executed by previous Agents in `commands_run`.
- Cite trusted verification records inside the evidence JSON instead.
```

- [ ] **Step 5: 运行测试**

Run:

```bash
python3 scripts/test_agent_run_policy.py
python3 scripts/validate_evidence_package.py \
  --adu ADU-1351-001 \
  --repo-root /Users/hill/open5gs/open5gs \
  --registry-dir /Users/hill/open5gs/.ai-agent/registry
```

Expected: 全部 PASS；无需人工编辑 Registry 即可接受合法 Evidence 输出。

- [ ] **Step 6: Commit**

```bash
git add scripts/hermes_agent_run.py scripts/test_agent_run_policy.py .ai-agent/prompts/evidence-agent.md
git commit -m "fix(agent-factory): classify evidence file declarations by ownership"
```

---

### Task 6: 增加标准化 Operator Override

**Files:**
- Create: `agent-factory-dashboard/backend/src/domain/operator-override.ts`
- Create: `agent-factory-dashboard/backend/src/application/operator-override-service.ts`
- Create: `agent-factory-dashboard/backend/tools/test-operator-overrides.js`
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Modify: `agent-factory-dashboard/backend/src/infrastructure/file-agent-factory-repository.ts`
- Modify: `.gitignore`

- [ ] **Step 1: 编写 API 反例测试**

测试必须验证：

1. ADU 不存在返回 `404`。
2. run 不存在返回 `404`。
3. run 原本成功时禁止 override，返回 `409`。
4. 没有 validator command/result 返回 `400`。
5. Validator exit code 非 `0` 时禁止改为 success。
6. `to_state` 不是该 Agent 合法终态时返回 `400`。
7. 重复提交同一 override 返回原记录，不重复写入。

请求示例：

```javascript
const response = await request(
  `${baseUrl}/api/agent-factory/adus/ADU-TEST/runs/20260621-102439/override`,
  {
    method: 'POST',
    body: JSON.stringify({
      operation: 'accept_validator_result',
      to_result: 'success',
      to_state: 'evidenced',
      reason_code: 'agent_declaration_mismatch',
      comment: 'Validator passed; changed_files declaration was incorrect.',
      validator: {
        command: 'python3 scripts/validate_evidence_package.py --adu ADU-TEST --repo-root /workspace/project --registry-dir /workspace/.ai-agent/registry',
        exit_code: 0,
        output: 'PASS'
      }
    })
  }
);
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
node agent-factory-dashboard/backend/tools/test-operator-overrides.js
```

Expected: FAIL，路由不存在。

- [ ] **Step 3: 定义领域类型**

`operator-override.ts` 定义：

```typescript
export type OperatorOverrideReason =
  | 'agent_declaration_mismatch'
  | 'validator_false_negative'
  | 'environment_verified'
  | 'manual_evidence_accepted';

export interface OperatorOverride {
  override_id: string;
  adu_id: string;
  run_timestamp: string;
  operation: 'accept_validator_result';
  from_result: string;
  to_result: 'success';
  from_state: string;
  to_state: string;
  reason_code: OperatorOverrideReason;
  comment: string;
  validator: {
    command: string;
    exit_code: 0;
    output: string;
  };
  actor: string;
  created_at: string;
}
```

- [ ] **Step 4: 实现 Override Service**

Service 必须在一次 RegistryLock 临界区内：

1. 读取 ADU。
2. 读取目标 run。
3. 校验 run 当前不是 success。
4. 校验 Agent 到终态映射：

```typescript
const allowedTerminalStateByAgent: Record<string, string> = {
  'code-reviewer': 'code_reviewed',
  'buildfix-debugger': 'debugged',
  'acceptance-reviewer': 'acceptance_reviewed',
  evidence: 'evidenced',
};
```

5. 追加 `operator-overrides.json`。
6. 在 run 中增加 `operator_override_id`，保留原始：

```typescript
run.original_result = run.result;
run.original_effective_returncode = run.effective_returncode;
run.result = 'success';
run.effective_returncode = 0;
```

7. 更新 ADU state。
8. 写入 Operation event：

```text
operator_override_applied
```

- [ ] **Step 5: 添加受控 API**

路由：

```text
POST /api/agent-factory/adus/:aduId/runs/:runTimestamp/override
GET  /api/agent-factory/adus/:aduId/overrides
```

要求：

1. 使用现有 `requireControl`。
2. `aduId`、`runTimestamp` 使用 `/^[A-Za-z0-9_.-]+$/`。
3. comment 长度为 `10..4000`。
4. validator output 最大 `20000` 字符。
5. 不接受客户端提交 `from_result`、`from_state`、`actor`。

- [ ] **Step 6: 更新移植性和运行态清单**

将：

```text
.ai-agent/registry/operator-overrides.json
```

加入：

1. `.gitignore`
2. bootstrap 默认 registry
3. doctor runtime registry blocklist
4. portability 检查允许的运行态文件

- [ ] **Step 7: 运行 API 测试**

Run:

```bash
cd agent-factory-dashboard/backend
npm run build
node tools/test-operator-overrides.js
npm run doctor -- --skip-hermes
npm run check:portable
```

Expected: 全部 PASS。

- [ ] **Step 8: Commit**

```bash
git add .gitignore agent-factory-dashboard/backend/src/domain/operator-override.ts agent-factory-dashboard/backend/src/application/operator-override-service.ts agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts agent-factory-dashboard/backend/src/infrastructure/file-agent-factory-repository.ts agent-factory-dashboard/backend/tools/test-operator-overrides.js scripts/agent_factory_bootstrap.py scripts/agent_factory_doctor.py scripts/check_tracked_path_leaks.py
git commit -m "feat(agent-factory): add audited operator result overrides"
```

---

### Task 7: 在 Dashboard 提供人工纠偏面板

**Files:**
- Create: `agent-factory-dashboard/frontend/src/components/agent-factory/OperatorOverridePanel.tsx`
- Modify: `agent-factory-dashboard/frontend/src/api/agentFactory.ts`
- Modify: `agent-factory-dashboard/frontend/src/types/agent-factory.ts`
- Modify: `agent-factory-dashboard/frontend/src/components/agent-factory/AgentFactoryPage.tsx`

- [ ] **Step 1: 增加前端类型**

```typescript
export interface AgentFactoryOperatorOverride {
  override_id: string;
  adu_id: string;
  run_timestamp: string;
  operation: 'accept_validator_result';
  from_result: string;
  to_result: 'success';
  from_state: string;
  to_state: string;
  reason_code:
    | 'agent_declaration_mismatch'
    | 'validator_false_negative'
    | 'environment_verified'
    | 'manual_evidence_accepted';
  comment: string;
  validator: {
    command: string;
    exit_code: 0;
    output: string;
  };
  actor: string;
  created_at: string;
}
```

- [ ] **Step 2: 增加 API Client**

```typescript
async applyRunOverride(
  aduId: string,
  runTimestamp: string,
  input: {
    operation: 'accept_validator_result';
    to_result: 'success';
    to_state: string;
    reason_code: AgentFactoryOperatorOverride['reason_code'];
    comment: string;
    validator: {
      command: string;
      exit_code: 0;
      output: string;
    };
  }
): Promise<AgentFactoryOperatorOverride> {
  const res = await fetch(
    `${API_URL}/api/agent-factory/adus/${aduId}/runs/${runTimestamp}/override`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to apply operator override');
  }
  return res.json();
}
```

- [ ] **Step 3: 实现面板显示条件**

面板只在以下条件全部满足时显示：

```typescript
const eligible =
  latestRun &&
  latestRun.result !== 'success' &&
  ['code-reviewer', 'buildfix-debugger', 'acceptance-reviewer', 'evidence']
    .includes(latestRun.agent);
```

必须包含：

1. 原始失败原因，只读。
2. Validator command，只读或从后端候选值加载。
3. Validator exit code，必须为 0。
4. Validator output。
5. reason code 下拉框。
6. comment 文本框。
7. 二次确认。
8. 已存在 override 时显示审计记录，按钮禁用。

- [ ] **Step 4: 挂载面板**

在 `AgentFactoryPage.tsx` 中放在：

```text
QualityReportPanel
之后
RunHistoryTable
之前
```

挂载：

```tsx
<OperatorOverridePanel
  adu={selectedAdu}
  latestRun={selectedAdu.runs?.[0] ?? null}
  onApplied={refresh}
/>
```

不得在正常 success run 上显示纠偏按钮。

- [ ] **Step 5: 构建并手工验收**

Run:

```bash
cd agent-factory-dashboard/frontend
npm run build
```

Manual acceptance:

1. 选择一个 failed Evidence run。
2. 面板显示原始失败原因。
3. 未填写 10 字以上 comment 时按钮禁用。
4. 成功提交后 ADU 刷新为目标状态。
5. 页面显示 override ID 和原始 result。
6. 刷新页面后审计记录仍存在。

- [ ] **Step 6: Commit**

```bash
git add agent-factory-dashboard/frontend/src/components/agent-factory/OperatorOverridePanel.tsx agent-factory-dashboard/frontend/src/api/agentFactory.ts agent-factory-dashboard/frontend/src/types/agent-factory.ts agent-factory-dashboard/frontend/src/components/agent-factory/AgentFactoryPage.tsx
git commit -m "feat(agent-factory): expose audited run override controls"
```

---

### Task 8: 修复 Token Ledger 累计逻辑

**Files:**
- Create: `scripts/token_ledger.py`
- Create: `scripts/test_token_ledger.py`
- Modify: `scripts/hermes_agent_orchestrator.py:739-781`
- Modify: `agent-factory-dashboard/backend/src/domain/agent-factory.ts`
- Modify: `agent-factory-dashboard/frontend/src/types/agent-factory.ts`
- Modify: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts:933-975`

- [ ] **Step 1: 编写重复 Agent 聚合反例**

测试数据必须包含：

```python
runs = [
    run("code-reviewer", 1000, 100, "success"),
    run("code-reviewer", 1200, 120, "success"),
    run("evidence", 800, 80, "failed"),
    run("evidence", 900, 90, "success"),
]
```

断言：

```python
assert summary["inputTokens"] == 3900
assert summary["outputTokens"] == 390
assert summary["runCount"] == 4
assert summary["agentBreakdown"]["code-reviewer"]["inputTokens"] == 2200
assert summary["agentBreakdown"]["code-reviewer"]["runCount"] == 2
assert summary["agentBreakdown"]["evidence"]["inputTokens"] == 1700
assert summary["agentBreakdown"]["evidence"]["failureCount"] == 1
assert summary["agentBreakdown"]["evidence"]["successCount"] == 1
```

- [ ] **Step 2: 运行测试并确认现有覆盖逻辑失败**

Run:

```bash
python3 scripts/test_token_ledger.py
```

Expected: FAIL，`token_ledger` 模块不存在。

- [ ] **Step 3: 实现纯函数 Token Ledger**

`scripts/token_ledger.py` 提供：

```python
def aggregate_adu_tokens(runs, adu_id, budget):
    summary = {
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
        "runCount": 0,
        "agentBreakdown": {},
    }
    default_budget = budget.get("default", {})
    agent_budgets = budget.get("agents", {})

    for run in runs:
        if run.get("adu_id") != adu_id:
            continue

        agent = run.get("agent") or "unknown"
        usage = run.get("token_usage") or {}
        input_tokens = int(usage.get("inputTokens") or 0)
        output_tokens = int(usage.get("outputTokens") or 0)
        result = run.get("result")

        entry = summary["agentBreakdown"].setdefault(agent, {
            "inputTokens": 0,
            "outputTokens": 0,
            "runCount": 0,
            "successCount": 0,
            "failureCount": 0,
            "status": "normal",
        })
        entry["inputTokens"] += input_tokens
        entry["outputTokens"] += output_tokens
        entry["runCount"] += 1
        if result == "success":
            entry["successCount"] += 1
        else:
            entry["failureCount"] += 1

        summary["inputTokens"] += input_tokens
        summary["outputTokens"] += output_tokens
        summary["runCount"] += 1

    for agent, entry in summary["agentBreakdown"].items():
        limits = agent_budgets.get(agent, default_budget)
        input_limit = int(limits.get("inputTokenLimit") or 0)
        output_limit = int(limits.get("outputTokenLimit") or 0)
        warn_ratio = float(limits.get("warnAtRatio") or 0.8)
        if (
            (input_limit and entry["inputTokens"] >= input_limit)
            or (output_limit and entry["outputTokens"] >= output_limit)
        ):
            entry["status"] = "exceeded"
        elif (
            (input_limit and entry["inputTokens"] >= input_limit * warn_ratio)
            or (output_limit and entry["outputTokens"] >= output_limit * warn_ratio)
        ):
            entry["status"] = "warning"

    summary["totalTokens"] = (
        summary["inputTokens"] + summary["outputTokens"]
    )
    return summary
```

规则：

1. 遍历该 ADU 的所有 run，不限最近 50 条。
2. 每个 run 的 `token_usage` 都计入总量，包括 failed/unstructured。
3. 同一 Agent 使用 `+=`，不能覆盖。
4. 保存 runCount/successCount/failureCount。
5. 没有 token_usage 的 run 仍计入 runCount，但 token 为 0。
6. status 根据累计使用量与 Agent budget 判断。

- [ ] **Step 4: Orchestrator 使用统一聚合器**

删除 `scripts/hermes_agent_orchestrator.py:739-781` 内联聚合代码，替换为：

```python
from token_ledger import aggregate_adu_tokens

adu["token_summary"] = aggregate_adu_tokens(
    runs_data.get("runs", []),
    args.adu,
    budget_data,
)
```

必须在每次 run 记录写入后再聚合，确保最终 Evidence 包含在内。

- [ ] **Step 5: 后端 Token API 使用相同语义**

`GET /token-budget?aduId=ADU-1351-001` 返回：

```json
{
  "usage": {
    "inputTokens": 3900,
    "outputTokens": 390,
    "totalTokens": 4290,
    "runCount": 4,
    "agentBreakdown": {}
  },
  "limits": {
    "default": {}
  }
}
```

后端不再单独实现一套只计算 input/output 的循环；优先读取 ADU 的最新 `token_summary`，并在缺失时从全部 runs 重建。

- [ ] **Step 6: 同步前后端类型**

Agent breakdown 增加：

```typescript
runCount: number;
successCount: number;
failureCount: number;
```

Token summary 增加：

```typescript
runCount: number;
```

- [ ] **Step 7: 运行测试**

Run:

```bash
python3 scripts/test_token_ledger.py
cd agent-factory-dashboard/backend
npm run build
cd ../frontend
npm run build
```

Expected: 全部 PASS；ADU-1351 的 breakdown 包含 `evidence`，重复 Reviewer/Designer run 使用累计值。

- [ ] **Step 8: Commit**

```bash
git add scripts/token_ledger.py scripts/test_token_ledger.py scripts/hermes_agent_orchestrator.py agent-factory-dashboard/backend/src/domain/agent-factory.ts agent-factory-dashboard/frontend/src/types/agent-factory.ts agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts
git commit -m "fix(agent-factory): aggregate complete per-run token ledger"
```

---

### Task 9: 全量回归与真实链路验收

**Files:**
- Modify: `docs/superpowers/debugging/2026-06-19-agent-factory-phase3-7-debug-bug-log.md`
- Modify: `agent-factory-dashboard/backend/tools/test-adu1351-regressions.js`

- [ ] **Step 1: 运行专项回归**

Run:

```bash
cd agent-factory-dashboard/backend
npm run test:adu1351-regressions
```

Expected:

```text
[PASS] ADU-1351 residual regression suite
```

- [ ] **Step 2: 运行既有 Python 回归**

Run:

```bash
python3 scripts/test_agent_run_policy.py
python3 scripts/test_validate_quality_report.py
python3 scripts/test_validate_agent_contract.py
python3 scripts/test_phase2_flow_integrity.py
```

Expected: 全部 PASS。

- [ ] **Step 3: 运行既有后端集成测试**

Run:

```bash
cd agent-factory-dashboard/backend
npm run test:quality-gates
npm run test:phase37-regression
npm run test:operator
npm run test:epic-dag
npm run test:epic-factory
```

Expected: 全部 PASS。

- [ ] **Step 4: 构建双端**

Run:

```bash
cd agent-factory-dashboard/backend
npm run build
cd ../frontend
npm run build
```

Expected: TypeScript 和 Vite 构建通过。

- [ ] **Step 5: 运行移植性与格式门禁**

Run:

```bash
cd agent-factory-dashboard/backend
npm run check:portable
npm run doctor -- --skip-hermes
cd /Users/hill/open5gs
git diff --check
```

Expected:

- no tracked local path leaks
- doctor 0 errors / 0 warnings
- `git diff --check` 无输出

- [ ] **Step 6: 使用隔离 ADU 复验完整链路**

复制 `ADU-1351-001` 的 Contract 和最小 fixture，注册 `ADU-1351-REGRESSION`，执行：

```text
test_red
-> developer
-> code-reviewer
-> buildfix-debugger
-> acceptance-reviewer
-> evidence
-> evidenced
```

验收条件：

1. Code Reviewer 提交与源码矛盾的 `pattern_absent` 时被阻断。
2. Reviewer 修正报告后可以继续。
3. Runner 生成 `verification-results.json`。
4. 未批准的 `ninja` 命令不能成为 pass 证据，并触发 Human Gate。
5. rework-planner stdout 出现业务 JSON 时仍以 completion 信封推进。
6. Evidence 声明 Registry/build 文件时被自动分类，不需要改 Registry。
7. 人工 override 通过 API 完成并保留原始 run。
8. Token breakdown 包含所有重复运行和 Evidence Agent。

- [ ] **Step 7: 更新缺陷台账**

在调试台账追加：

| ID | 状态 | 验证证据 |
|---|---|---|
| AF-1351-01 | Verified | `test_code_review_fact_gate.py` |
| AF-1351-02 | Verified | `test_agent_run_policy.py` completion precedence case |
| AF-1351-03 | Verified | `test_command_policy.py` + trusted verification artifact |
| AF-1351-04 | Verified | Evidence declaration classification test |
| AF-1351-05 | Verified | `test-operator-overrides.js` |
| AF-1351-06 | Verified | `test_token_ledger.py` |

没有完成真实隔离 ADU 链路时，状态只能写 `Fixed-Pending-E2E`，不能写 `Verified`。

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/debugging/2026-06-19-agent-factory-phase3-7-debug-bug-log.md agent-factory-dashboard/backend/tools/test-adu1351-regressions.js
git commit -m "test(agent-factory): verify ADU-1351 residual bug fixes end to end"
```

## 4. 最终验收标准

必须同时满足：

1. Code Review pass 不能只靠 Agent 自述。
2. Source snapshot 被修改后，旧报告自动失效。
3. Contract must-pass assertion 缺少事实或测试引用时不能通过。
4. `completion.json` 合法时 stdout JSON 永远不能覆盖它。
5. 启用完成协议但缺少/损坏信封时明确返回结构化错误。
6. 只有 Runner 执行的 allowlisted command 才是可信测试证据。
7. 越权命令进入 `command_policy_exception`，不推进状态。
8. Evidence 不再因 Registry/generated 文件声明错误而要求人工改 JSON。
9. 人工纠偏必须通过 API，保留原始失败结果和 validator 证据。
10. Token 汇总覆盖所有 run、重复 Agent、失败 run 和最终 Evidence run。
11. 全量回归、双端构建、doctor、portability 和格式检查通过。
12. 使用隔离 ADU 完成一次真实 E2E 后，六项缺陷才可标记为 `Verified`。

## 5. 自检结论

- **Spec coverage:** 六项遗留缺陷均映射到独立 Task，并在 Task 9 统一做真实链路验证。
- **Boundary clarity:** 明确区分了 Runner 可信命令门禁与 OS/container sandbox，未夸大本轮能力。
- **Type consistency:** `OperatorOverride`、Token breakdown 和 verification record 的字段在后端、前端和测试中保持一致。
- **No placeholder scan:** 文档不包含 TBD、TODO、泛化的“补充测试”或无实现细节的步骤。
- **TDD order:** 每项修复先写反例并确认失败，再实现最小修复、运行测试、提交。

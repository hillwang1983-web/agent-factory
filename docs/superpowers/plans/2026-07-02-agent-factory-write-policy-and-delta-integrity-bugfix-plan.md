# Agent Factory Write Policy And Delta Integrity Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立单一角色写入策略和可扩展的仓库 Delta 证明，阻断越权写入、未声明修改、Runtime/generated 分类绕过，并修复 Issue #9。

**Architecture:** 将角色授权从 `hermes_agent_run.py` 的条件分支提取为独立策略模块；所有 Agent 都通过同一 `authorize_declared_and_actual_changes()` 门禁。仓库变化采用 Git tracked/untracked 基线加精确 ignored artifact 目标的混合快照，避免递归 Hash 整个仓库，同时强制 `actual agent changes = declared changes`，Runner 自有文件使用精确路径集合单独核销。

**Tech Stack:** Python 3、Git plumbing commands、现有 `run_file_snapshot.py`、Hermes Runner、标准库 `unittest/tempfile/subprocess/hashlib`。

---

## 1. 缺陷范围

本计划覆盖以下问题：

| ID | 严重度 | 缺陷 | 目标行为 |
|---|---|---|---|
| WP-01 | P0 | Developer 不执行 ADU `allowed_write_paths` | Developer 只能修改 ADU 白名单路径 |
| WP-02 | P0 | 未声明实际修改不阻断 | 实际 Agent 修改必须与 `changed_files` 完全一致 |
| WP-03 | P1 | BuildFix 可修改生产代码 | 只能写当前 ADU 验证摘要 |
| WP-04 | P1 | 文档 Agent 可互相覆盖产物 | 每个角色只允许当前 ADU 的固定产物 |
| WP-05 | P1 | Profiler/Epic 缺省 `.` 导致全仓库 Hash | 禁止 `['.']` 回退，改用混合 Delta |
| WP-06 | P1 | Runtime/generated 提前分类绕过 | Agent 声明这些路径必须失败 |
| WP-07 | P2 | TestWriter 可写任意 `tests/` 与 `.ai-agent/` | 只能写当前 ADU 验证文档 |
| WP-08 | P1 | Issue #9 Profiler 合法产物被阻断 | 仅允许五个固定画像产物 |

关联 Issue：<https://github.com/hillwang1983-web/agent-factory/issues/9>

画像 Schema 与 Dashboard 字段解析不在本计划实施，见：

`docs/superpowers/plans/2026-07-02-agent-factory-project-profiler-contract-bugfix-plan.md`

实现追踪：

| 缺陷 | 实现任务 | 必须出现的反例 |
|---|---|---|
| WP-01 | Task 1、3、4 | Developer 修改 `src/forbidden.c` |
| WP-02 | Task 2、3、4 | 实际改两个文件但只声明一个 |
| WP-03 | Task 1、4、5 | BuildFix 修改生产源码 |
| WP-04 | Task 1、4、5 | Requirement Analyst 覆盖 Contract |
| WP-05 | Task 2、4 | 一万个 ignored 文件不得被 Hash |
| WP-06 | Task 1、3、4 | Registry/generated 声明和实际修改均阻断 |
| WP-07 | Task 1、4、5 | TestWriter 写 `tests/other.test.js` |
| WP-08 | Task 1、4 | 五个画像文件通过，第六个失败 |

## 2. 安全不变量

### 2.1 路径集合

每轮 Agent 执行必须生成以下集合：

```text
D = completion result.changed_files 中的规范化路径
A = 本轮 Agent 子进程实际造成的仓库变化
R = Runner/Watchdog 本轮控制协议使用的精确路径
```

放行条件：

```text
D == A
D ⊆ role_authorized_paths
A ∩ sensitive_or_runtime_paths == ∅
R ∩ D == ∅
```

说明：

- `R` 不是目录前缀，而是本轮 `run_dir` 下由 Runner/Watchdog 创建或验证的已知控制文件集合。
- Registry、lock、operation 等共享状态文件不属于 `R`；Agent 子进程运行期间发现它们变化必须阻断并进入人工检查。
- ignored build output 不作为可声明交付物；Agent 在 `changed_files` 中声明 `build/`、`dist/`、`coverage/` 必须失败。
- 删除文件也属于 `A` 和 `D`，不得因文件不存在而跳过。

### 2.2 角色策略表

| Agent | 授权路径来源 |
|---|---|
| `developer` | 当前 ADU `allowed_write_paths`，支持精确文件和以 `/` 结尾的目录 |
| `buildfix-debugger` | `.ai-agent/runs/<ADU_ID>-validation-summary.md`；`verification-results.json` 属于控制协议文件，不属于 Agent 声明 |
| `testwriter` | `tests/ai-agent-mvp/<ADU_ID>-validation.md` |
| `requirement-analyst` | `.ai-agent/analysis/<ADU_ID>.md` |
| `context-pack` | `.ai-agent/context-packs/<ADU_ID>.md` |
| `detail-designer` | 当前 ADU detailed design 与 interfaces JSON |
| `contract` | 当前 ADU contract JSON、notes 与 validation 文档 |
| `code-reviewer` | 当前 ADU code-review JSON/Markdown |
| `acceptance-reviewer` | 当前 ADU acceptance-review JSON/Markdown |
| `rework-planner` | 当前 ADU rework-plan JSON |
| `evidence` | 当前 ADU evidence JSON/Markdown |
| `project-profiler` | 五个固定 `.agent-factory` 画像文件 |
| Epic Agents | 当前 `.ai-agent/epics/<EPIC_ID>/` 下由 `get_agent_target_files()` 返回的精确文件 |

未知 Agent、空目标集合、绝对路径、`..`、符号链接逃逸全部 fail closed。

## 3. 文件边界

**新增：**

- `scripts/agent_write_policy.py`：角色授权策略、路径规范化和集合核验。
- `scripts/test_agent_write_policy.py`：策略矩阵单元测试。
- `scripts/test_runner_delta_integrity.py`：真实 Git 仓库 Delta 集成测试。

**修改：**

- `scripts/run_file_snapshot.py`：Git-aware 基线与 Delta。
- `scripts/test_run_file_snapshot.py`：创建、修改、删除、预存 dirty、untracked 和 ignored 目标测试。
- `scripts/hermes_agent_run.py`：调用单一授权门禁并移除角色分支。
- `scripts/test_phase2_flow_integrity.py`：Runner 角色映射回归。
- `.ai-agent/prompts/buildfix-debugger-agent.md`：明确只诊断、不改生产代码。
- `.ai-agent/prompts/testwriter-agent.md`：明确唯一交付路径。
- `agent-factory-dashboard/backend/package.json`：注册专项回归命令。
- `docs/agent-factory/configuration.md`：记录写策略和 Delta 语义。

---

### Task 1: 固化角色策略矩阵

**Files:**
- Create: `scripts/agent_write_policy.py`
- Create: `scripts/test_agent_write_policy.py`

- [ ] **Step 1: 写失败测试**

测试必须使用表驱动覆盖所有 Agent：

```python
CASES = [
    ("requirement-analyst", ".ai-agent/analysis/ADU-1.md", True),
    ("requirement-analyst", ".ai-agent/contracts/ADU-1.json", False),
    ("context-pack", ".ai-agent/context-packs/ADU-1.md", True),
    ("context-pack", ".ai-agent/reviews/ADU-1-code-review.json", False),
    ("code-reviewer", ".ai-agent/reviews/ADU-1-code-review.json", True),
    ("code-reviewer", ".ai-agent/designs/ADU-1-detailed-design.md", False),
    ("acceptance-reviewer", ".ai-agent/acceptance/ADU-1-acceptance-review.json", True),
    ("acceptance-reviewer", ".ai-agent/analysis/ADU-1.md", False),
    ("testwriter", "tests/ai-agent-mvp/ADU-1-validation.md", True),
    ("testwriter", "tests/other.test.js", False),
    ("buildfix-debugger", ".ai-agent/runs/ADU-1-validation-summary.md", True),
    ("buildfix-debugger", "src/core.c", False),
    ("project-profiler", ".agent-factory/project-profile.json", True),
    ("project-profiler", ".agent-factory/config.json", False),
]
```

Developer 测试：

```python
policy = build_agent_write_policy(
    agent_name="developer",
    target_id="ADU-1",
    is_epic=False,
    adu_allowed_write_paths=["src/allowed.c", "include/feature/"],
    agent_target_files=[],
)
assert policy.allows("src/allowed.c")
assert policy.allows("include/feature/api.h")
assert not policy.allows("src/forbidden.c")
assert not policy.allows("include/feature-escape/api.h")
```

还必须测试未知 Agent、空白路径、绝对路径、`../`、`.git/`、`.ai-agent/registry/`、`build/`、`dist/` 和 `coverage/`。

- [ ] **Step 2: 运行并确认失败**

```bash
python3 scripts/test_agent_write_policy.py
```

Expected: FAIL with `ModuleNotFoundError: agent_write_policy`。

- [ ] **Step 3: 实现策略对象**

公开接口固定为：

```python
from dataclasses import dataclass

class WritePolicyError(ValueError):
    pass

@dataclass(frozen=True)
class AgentWritePolicy:
    agent_name: str
    exact_paths: frozenset[str]
    directory_prefixes: tuple[str, ...]

    def allows(self, path_value: str) -> bool:
        normalized = normalize_repo_path(path_value)
        return (
            normalized in self.exact_paths
            or any(normalized.startswith(prefix) for prefix in self.directory_prefixes)
        )

def normalize_repo_path(path_value: str) -> str:
    """Return a normalized repository-relative path or raise WritePolicyError."""

def build_agent_write_policy(
    agent_name: str,
    target_id: str,
    is_epic: bool,
    adu_allowed_write_paths: list[str],
    agent_target_files: list[str],
) -> AgentWritePolicy:
    """Build a fail-closed policy for one run."""
```

实现要求：

- `agent_target_files` 先由 Runner 转为仓库相对路径。
- 非 Developer Agent 的授权集合只能来自 `get_agent_target_files()`，不能接受 ADU 自带的扩大路径。
- Developer 只使用 `adu_allowed_write_paths`。
- `allowed_write_paths = ['.']` 对 Developer 视为非法配置，不代表全仓库。
- `.`、空集合或未知 Agent 抛 `WritePolicyError`。
- 目录权限只接受显式以 `/` 结尾的输入，使用路径组件边界比较。
- 敏感、Runtime、generated 前缀在 `allows()` 之前统一拒绝。

- [ ] **Step 4: 运行单元测试**

```bash
python3 scripts/test_agent_write_policy.py
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交策略模块**

```bash
git add scripts/agent_write_policy.py scripts/test_agent_write_policy.py
git commit -m "feat(agent-factory): define fail-closed agent write policies"
```

---

### Task 2: 用 Git-aware 快照替代全仓库递归 Hash

**Files:**
- Modify: `scripts/run_file_snapshot.py`
- Modify: `scripts/test_run_file_snapshot.py`

- [ ] **Step 1: 写失败测试**

在临时 Git 仓库覆盖：

测试逐项实现以下场景：

- `test_git_delta_detects_tracked_created_modified_deleted`：提交 `a.txt`、`b.txt` 后建立基线，再修改 `a.txt`、删除 `b.txt`、创建并 `git add` `c.txt`；断言三个集合各包含对应文件。
- `test_git_delta_detects_change_to_preexisting_dirty_file`：基线前先修改已跟踪文件，基线后再次修改；断言仍报告 `modified`。
- `test_git_delta_detects_untracked_file_created_or_modified`：分别验证基线后新增 untracked 和基线前已存在 untracked 的再次修改。
- `test_exact_ignored_target_is_snapshotted`：`.gitignore` 忽略 `.agent-factory/`，将 profile 路径作为精确目标传入，断言创建和修改均可检测。
- `test_ignored_node_modules_is_not_recursively_scanned`：创建一万个 ignored 文件并断言未调用其 Hash。
- `test_sensitive_registry_change_is_reported`：将 `.ai-agent/registry/adu.json` 作为 sensitive target，断言修改被 Delta 捕获。

性能反例创建 `node_modules/pkg-0..9999`，monkeypatch `hash_file()` 记录调用路径，断言没有任何 `node_modules/` 文件被 Hash。

- [ ] **Step 2: 运行并确认失败**

```bash
python3 scripts/test_run_file_snapshot.py
```

Expected: 至少全仓库 fallback、pre-dirty 或 ignored 精确目标测试失败。

- [ ] **Step 3: 实现仓库基线 API**

公开接口：

```python
def capture_repository_baseline(
    repo_root: Path,
    exact_ignored_targets: list[str],
    sensitive_targets: list[str],
) -> dict:
    """Capture Git state plus hashes for pre-dirty/untracked and exact targets."""

def calculate_repository_delta(repo_root: Path, baseline: dict) -> dict:
    """Return created, modified and deleted repository-relative paths."""
```

基线结构：

```json
{
  "git_root": "/repo",
  "head": "<commit-or-null>",
  "tracked_index": {"src/a.c": "<git-blob-id>"},
  "pre_dirty_hashes": {"src/dirty.c": "<sha256>"},
  "untracked_hashes": {"notes.txt": "<sha256>"},
  "exact_target_hashes": {".agent-factory/project-profile.json": null},
  "sensitive_hashes": {".ai-agent/registry/adu.json": "<sha256>"}
}
```

约束：

- 使用参数数组调用 `git`，禁止 shell 字符串。
- tracked 变化由 Git index/worktree 状态确定。
- pre-dirty 文件必须比较运行前后 SHA-256。
- untracked 使用 `git ls-files --others --exclude-standard -z`。
- ignored 仅 Hash `exact_ignored_targets` 和 `sensitive_targets`，禁止遍历 `node_modules/build/dist/coverage`。
- 无 commit 的新 Git 仓库必须可用。
- 非 Git 仓库 fail closed；注册项目本身要求 Git 根，不需要保留递归全目录 fallback。

- [ ] **Step 4: 删除 `['.']` fallback**

`hermes_agent_run.py` 后续调用不得再构造：

```python
adu.get("allowed_write_paths") or ["."]
```

Project Profiler、Epic 和普通 Agent 一律使用新基线 API。

- [ ] **Step 5: 运行快照测试**

```bash
python3 scripts/test_run_file_snapshot.py
```

Expected: 全部 PASS，性能反例 Hash 数量不随 `node_modules` 文件数增长。

- [ ] **Step 6: 提交 Delta 基础设施**

```bash
git add scripts/run_file_snapshot.py scripts/test_run_file_snapshot.py
git commit -m "fix(agent-factory): capture scalable repository deltas"
```

---

### Task 3: 强制声明与实际 Delta 双向一致

**Files:**
- Modify: `scripts/agent_write_policy.py`
- Modify: `scripts/test_agent_write_policy.py`

- [ ] **Step 1: 写集合核验失败测试**

```python
def test_undeclared_actual_change_is_rejected():
    result = authorize_declared_and_actual_changes(
        policy=developer_policy(["src/allowed.c", "src/hidden.c"]),
        declared_paths=["src/allowed.c"],
        actual_delta={"modified": ["src/allowed.c", "src/hidden.c"], "created": [], "deleted": []},
        runner_owned_paths=[],
    )
    assert result.error_code == "undeclared_actual_changes"
    assert result.undeclared_paths == ["src/hidden.c"]

```

另写六个完整测试，分别断言：声明但未变化返回 `unchanged_declarations`；已删除且已声明可通过；Registry 声明返回 `unauthorized_write_path`；generated 声明返回同一错误；Runner 精确文件可从 actual 集合核销；Agent 声明 Runner 文件返回 `agent_declared_runner_owned_path`。

- [ ] **Step 2: 运行并确认失败**

```bash
python3 scripts/test_agent_write_policy.py
```

Expected: FAIL，因为集合核验函数不存在。

- [ ] **Step 3: 实现双向门禁**

公开结果：

```python
@dataclass(frozen=True)
class WriteAuthorizationResult:
    allowed: bool
    error_code: str | None
    declared_paths: tuple[str, ...]
    actual_paths: tuple[str, ...]
    undeclared_paths: tuple[str, ...]
    unchanged_declarations: tuple[str, ...]
    unauthorized_paths: tuple[str, ...]

def authorize_declared_and_actual_changes(
    policy: AgentWritePolicy,
    declared_paths: list[str],
    actual_delta: dict,
    runner_owned_paths: list[str],
) -> WriteAuthorizationResult:
    declared = {normalize_repo_path(path) for path in declared_paths}
    actual = {
        normalize_repo_path(path)
        for key in ("created", "modified", "deleted")
        for path in actual_delta.get(key, [])
    }
    runner_owned = {normalize_repo_path(path) for path in runner_owned_paths}

    agent_declared_runner = declared & runner_owned
    agent_actual = actual - runner_owned
    unauthorized = {
        path for path in declared | agent_actual
        if not policy.allows(path)
    }
    undeclared = agent_actual - declared
    unchanged = declared - agent_actual

    error_code = None
    if agent_declared_runner:
        error_code = "agent_declared_runner_owned_path"
        unauthorized |= agent_declared_runner
    elif unauthorized:
        error_code = "unauthorized_write_path"
    elif undeclared:
        error_code = "undeclared_actual_changes"
    elif unchanged:
        error_code = "declared_changes_unverified"

    return WriteAuthorizationResult(
        allowed=error_code is None,
        error_code=error_code,
        declared_paths=tuple(sorted(declared)),
        actual_paths=tuple(sorted(agent_actual)),
        undeclared_paths=tuple(sorted(undeclared)),
        unchanged_declarations=tuple(sorted(unchanged)),
        unauthorized_paths=tuple(sorted(unauthorized)),
    )
```

算法顺序固定：

1. 规范化并去重声明路径。
2. 合并 actual `created/modified/deleted`。
3. 校验 `runner_owned_paths` 为精确路径，且 Agent 未声明它们。
4. 从 actual 集合移除 Runner 自有路径。
5. 检查 actual 与 declared 中的敏感/runtime/generated 路径。
6. 检查 declared 和 actual 均满足角色策略。
7. 计算 `actual - declared` 与 `declared - actual`。
8. 任一差集非空则失败。

不要再返回“runtime_managed_files”或“generated_files”作为成功分类。

- [ ] **Step 4: 运行策略测试**

```bash
python3 scripts/test_agent_write_policy.py
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交完整性门禁**

```bash
git add scripts/agent_write_policy.py scripts/test_agent_write_policy.py
git commit -m "fix(agent-factory): reject undeclared and unauthorized changes"
```

---

### Task 4: Runner 接入单一策略与 Delta 门禁

**Files:**
- Modify: `scripts/hermes_agent_run.py:1117-1195`
- Modify: `scripts/hermes_agent_run.py:1615-1645`
- Modify: `scripts/hermes_agent_run.py:1881-1902`
- Create: `scripts/test_runner_delta_integrity.py`

- [ ] **Step 1: 写真实 Runner 反例**

使用临时 Git 仓库和 mock Hermes 覆盖：

真实 Runner 测试必须实现以下九个场景：

- Developer 修改 `src/forbidden.c`，ADU 只授权 `src/allowed.c`，断言 `unauthorized_write_path`。
- Developer 同时修改两个文件但只声明一个，断言 `undeclared_actual_changes` 包含隐藏路径。
- BuildFix 修改源码并写验证摘要，断言源码路径被拒绝。
- Requirement Analyst 覆盖 Contract，断言角色越权。
- Profiler 只生成五个固定文件，断言成功。
- Profiler 额外生成 `.agent-factory/config.json`，断言失败。
- Epic Agent 在含一万个 ignored 文件的仓库运行，断言 Hash 记录不含这些文件。
- 任意 Agent 修改 Registry，断言失败。
- 任意 Agent 声明 generated 路径，断言失败。

每个测试必须检查 run record 的 `result`、`error_code` 和具体路径，不得只检查进程非零退出。

- [ ] **Step 2: 运行并确认旧实现失败**

```bash
python3 scripts/test_runner_delta_integrity.py
```

Expected: WP-01 至 WP-08 至少各有一个失败反例。

- [ ] **Step 3: 替换旧声明分类器**

删除：

```python
ALLOWED_WRITE_AGENTS
validate_agent_file_declarations
```

Runner 在子进程前：

```python
target_files = get_agent_target_files(args.agent, adu, project_repo_path)
relative_targets = to_repo_relative_paths(project_repo_path, target_files)
write_policy = agent_write_policy.build_agent_write_policy(
    agent_name=args.agent,
    target_id=adu["id"],
    is_epic=is_epic_run,
    adu_allowed_write_paths=adu.get("allowed_write_paths") or [],
    agent_target_files=relative_targets,
)
baseline = run_file_snapshot.capture_repository_baseline(
    project_repo_path,
    exact_ignored_targets=relative_targets,
    sensitive_targets=agent_write_policy.SENSITIVE_MONITORED_PATHS,
)
```

子进程结束后：

```python
delta = run_file_snapshot.calculate_repository_delta(project_repo_path, baseline)
authorization = agent_write_policy.authorize_declared_and_actual_changes(
    policy=write_policy,
    declared_paths=result.get("changed_files", []),
    actual_delta=delta,
    runner_owned_paths=relative_runner_owned_paths,
)
if not authorization.allowed:
    run_result = "failed"
    result.update({
        "result": "failed",
        "error_code": authorization.error_code,
        "undeclared_paths": list(authorization.undeclared_paths),
        "unchanged_declarations": list(authorization.unchanged_declarations),
        "unauthorized_paths": list(authorization.unauthorized_paths),
    })
```

- [ ] **Step 4: Runner 自有路径精确化**

`relative_runner_owned_paths` 只能来自本轮 `run_dir` 的以下控制文件；重试文件按实际 attempt 编号构造为精确路径，禁止使用目录前缀或 glob 放行：

```text
prompt.md
stdout.md
stderr.md
stdout_att<N>.md
stderr_att<N>.md
completion.json
file-snapshot-before.json
file-snapshot-after.json
file-delta.json
verification-results.json
quality-gate.md
```

Registry、lock、reviews、operations 不得加入该集合。

- [ ] **Step 5: 运行真实链路测试**

```bash
python3 scripts/test_runner_delta_integrity.py
python3 scripts/test_phase2_flow_integrity.py
python3 scripts/test_run_file_snapshot.py
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交 Runner 接入**

```bash
git add scripts/hermes_agent_run.py scripts/test_runner_delta_integrity.py
git commit -m "fix(agent-factory): enforce write policy against actual delta"
```

---

### Task 5: 对齐 BuildFix、TestWriter 与文档 Agent Prompt

**Files:**
- Modify: `.ai-agent/prompts/buildfix-debugger-agent.md`
- Modify: `.ai-agent/prompts/testwriter-agent.md`
- Modify: `.ai-agent/prompts/requirement-analyst-agent.md`
- Modify: `.ai-agent/prompts/context-pack-agent.md`
- Modify: `.ai-agent/prompts/detail-designer-agent.md`
- Modify: `.ai-agent/prompts/contract-agent.md`
- Modify: `.ai-agent/prompts/code-reviewer-agent.md`
- Modify: `.ai-agent/prompts/acceptance-reviewer-agent.md`
- Modify: `.ai-agent/prompts/rework-planner-agent.md`
- Modify: `.ai-agent/prompts/evidence-agent.md`
- Modify: `scripts/test_prompt_portability.py`

- [ ] **Step 1: 增加 Prompt 契约测试**

测试逐个读取 Prompt，断言包含唯一授权输出路径，且 BuildFix 包含：

```text
Do not modify production source code. Report required source changes to developer.
```

TestWriter 包含：

```text
The only writable deliverable is tests/ai-agent-mvp/{{ADU_ID}}-validation.md.
```

- [ ] **Step 2: 运行并确认失败**

```bash
python3 scripts/test_prompt_portability.py
```

Expected: BuildFix 或 TestWriter 约束断言失败。

- [ ] **Step 3: 修改 Prompt**

每个 Prompt 的 `Output Artifacts` 必须与 `get_agent_target_files()` 一致；不得出现“可写 `.ai-agent/`”或“可写 `tests/`”这种目录级宽泛描述。

BuildFix 发现源码问题时最终结果必须：

```json
{
  "result": "success",
  "next_state": "build_rework",
  "next_agent": "rework-planner",
  "changed_files": [".ai-agent/runs/{{ADU_ID}}-validation-summary.md"]
}
```

- [ ] **Step 4: 运行 Prompt 测试**

```bash
python3 scripts/test_prompt_portability.py
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交 Prompt 对齐**

```bash
git add .ai-agent/prompts scripts/test_prompt_portability.py
git commit -m "fix(agent-factory): align agent prompts with write policies"
```

---

### Task 6: 发布门禁与文档

**Files:**
- Modify: `agent-factory-dashboard/backend/package.json`
- Modify: `docs/agent-factory/configuration.md`

- [ ] **Step 1: 注册专项回归**

增加：

```json
"test:write-policy": "python3 ../../scripts/test_agent_write_policy.py && python3 ../../scripts/test_run_file_snapshot.py && python3 ../../scripts/test_runner_delta_integrity.py && python3 ../../scripts/test_phase2_flow_integrity.py"
```

- [ ] **Step 2: 更新配置文档**

文档必须列出完整角色策略表、集合等式、Runner-owned 精确文件、generated/Runtime 禁止声明规则，以及非 Git 项目 fail closed 的行为。

- [ ] **Step 3: 运行专项测试**

```bash
cd agent-factory-dashboard/backend
npm run test:write-policy
```

Expected: WP-01 至 WP-08 的正反例全部 PASS。

- [ ] **Step 4: 运行全量回归**

```bash
npm run test:adu-flow-reliability
npm run test:onboarding
npm run test:project-adu
npm run build
cd ../frontend && npm run build
cd ../../..
python3 scripts/agent_factory_doctor.py --skip-hermes
git diff --check
```

Expected: 构建和测试全部通过，Doctor 无错误/警告，格式检查无输出。

- [ ] **Step 5: 提交发布门禁**

```bash
git add agent-factory-dashboard/backend/package.json docs/agent-factory/configuration.md
git commit -m "test(agent-factory): gate write policy and delta integrity"
```

## 4. 验收清单

- [ ] Developer 修改白名单外文件必定失败。
- [ ] 实际修改但未声明必定失败。
- [ ] 声明但未修改必定失败。
- [ ] BuildFix 不能修改生产代码。
- [ ] 文档 Agent 不能覆盖其他 Agent 产物。
- [ ] TestWriter 只能写当前 ADU validation 文档。
- [ ] Project Profiler 只能写五个固定产物。
- [ ] Epic Agent 只能写当前 Epic 固定产物。
- [ ] Registry/runtime/generated 路径不能作为 Agent 声明绕过。
- [ ] 删除文件可被 Delta 和声明门正确核验。
- [ ] 预存 dirty 文件的二次修改可被识别。
- [ ] 不再对 `node_modules/build/dist/coverage` 或整个仓库递归 SHA-256。
- [ ] 所有失败结果包含稳定 `error_code` 和具体违规路径。

## 5. 禁止的快捷修复

- 禁止把 `project-profiler` 或其他文档 Agent 加入生产写 Agent 集合。
- 禁止用 `.agent-factory/`、`.ai-agent/` 或 `tests/` 整目录放行。
- 禁止保留 `allowed_write_paths or ['.']`。
- 禁止只验证 `declared ⊆ actual` 而不验证反方向。
- 禁止将 Registry/generated 声明分类为成功。
- 禁止通过全仓库递归 Hash 换取完整性。
- 禁止自动清理 Agent 的越权修改；必须保留现场并阻断。

## 6. 回滚策略

Task 1-3 只增加独立策略和 Delta 能力，可单独回滚。Task 4 接入后若出现误阻断，只允许回滚 Task 4，不得删除策略测试；利用失败 fixture 修正策略后再接入。任何回滚都不得恢复 `['.']` 全仓库扫描或 Runtime/generated 提前放行。

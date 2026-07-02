# Agent Factory Project Profile Contract Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Issue #10，建立版本化 Project Profile 契约，使 Python 画像落库与 Dashboard 解析一致、兼容旧画像，并确保 unsafe 命令不会进入推荐命令。

**Architecture:** 使用 JSON Schema 与跨语言共享 fixtures 定义 canonical v2；Python 在画像完成时规范化并原子落盘，TypeScript 通过唯一 parser 生成 `profile_summary`。本计划不负责 Runner 写权限，必须先完成关联的 Write Policy 计划。

**Tech Stack:** Python 3、TypeScript、Node.js、JSON Schema、现有 Project Onboarding API。

---

## 1. 计划关系与执行顺序

关联 Issue：<https://github.com/hillwang1983-web/agent-factory/issues/10>

前置计划：

`docs/superpowers/plans/2026-07-02-agent-factory-write-policy-and-delta-integrity-bugfix-plan.md`

必须先完成前置计划，因为画像 Agent 当前可能在产物校验阶段被误阻断。前置计划保证五个画像文件可安全写入；本计划只定义文件内容和解析语义。

## 2. 缺陷根因

当前三处代码各自解析画像：

- `scripts/hermes_project_profile.py`
- `agent-factory-dashboard/backend/src/infrastructure/file-project-repository.ts`
- `agent-factory-dashboard/backend/src/application/project-onboarding.ts`

旧解析器只支持扁平 `commands.build/test` 和顶层 `risk_level`。新画像可能生成 `commands.safe.*.command` 与 `risk_profile.risk_level`，导致命令为空、风险为 `unknown`。递归收集全部字符串不是合法修复，因为会把 deploy/migration 等 unsafe 命令显示为推荐命令。

## 3. Canonical v2

```json
{
  "schema_version": 2,
  "project_id": "sample-project",
  "project_type": "node-app",
  "detected_stack": [
    { "language": "typescript", "percentage": 100 }
  ],
  "commands": {
    "safe": {
      "build": [
        { "id": "build", "command": "npm run build", "source": "package.json" }
      ],
      "test": [
        { "id": "test_unit", "command": "npm test", "source": "package.json" }
      ]
    },
    "ambiguous": [],
    "unsafe": [
      { "id": "deploy", "command": "npm run deploy", "source": "package.json" }
    ]
  },
  "risk_profile": {
    "risk_level": "high",
    "reasons": ["deployment scripts are present"]
  },
  "scan_summary": {
    "total_files": 120,
    "lines_of_code": 9000
  }
}
```

不变量：

- v2 严格校验；legacy 无版本画像兼容读取。
- 推荐命令只来自 `commands.safe.build/test`。
- `ambiguous` 和 `unsafe` 永不进入 `profile_summary` 推荐命令。
- 命令必须为非空字符串，按首次出现顺序去重。
- `risk_level` 只允许 `low | medium | high | unknown`。
- 解析失败必须令画像进入 `profile_failed`。

## 4. 文件结构

**新增：**

- `.ai-agent/schemas/project-profile.schema.json`
- `tests/fixtures/project-profiles/canonical-v2.json`
- `tests/fixtures/project-profiles/legacy-flat.json`
- `tests/fixtures/project-profiles/unsafe-command.json`
- `scripts/project_profile_contract.py`
- `scripts/test_project_profile_contract.py`
- `agent-factory-dashboard/backend/src/application/project-profile-parser.ts`
- `agent-factory-dashboard/backend/tools/test-project-profile-parser.js`

**修改：**

- `.ai-agent/prompts/project-profiler-agent.md`
- `scripts/hermes_project_profile.py`
- `agent-factory-dashboard/backend/src/infrastructure/file-project-repository.ts`
- `agent-factory-dashboard/backend/src/application/project-onboarding.ts`
- `agent-factory-dashboard/backend/tools/test-project-onboarding.js`
- `agent-factory-dashboard/backend/package.json`
- `docs/agent-factory/configuration.md`

---

### Task 1: 建立 Schema 与共享 Fixtures

**Files:**
- Create: `.ai-agent/schemas/project-profile.schema.json`
- Create: `tests/fixtures/project-profiles/canonical-v2.json`
- Create: `tests/fixtures/project-profiles/legacy-flat.json`
- Create: `tests/fixtures/project-profiles/unsafe-command.json`

- [ ] **Step 1: 创建 v2 Schema**

使用 Draft 2020-12，要求 `schema_version = 2`，严格约束 `project_id/project_type/detected_stack/commands/risk_profile`。命令项定义为：

```json
{
  "$defs": {
    "command": {
      "type": "object",
      "required": ["id", "command", "source"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "command": { "type": "string", "minLength": 1 },
        "source": { "type": "string", "minLength": 1 }
      }
    },
    "commandList": {
      "type": "array",
      "items": { "$ref": "#/$defs/command" }
    }
  }
}
```

- [ ] **Step 2: 创建三份 fixture**

`canonical-v2.json` 包含 safe build、safe test、unsafe deploy 和 high risk。

`legacy-flat.json` 固定为：

```json
{
  "project_id": "legacy-project",
  "project_type": "node-app",
  "detected_stack": ["javascript"],
  "commands": {
    "build": "npm run build",
    "test": { "unit": "npm test", "e2e": "npm run test:e2e" }
  },
  "risk_level": "medium"
}
```

`unsafe-command.json` 的 safe build/test 为空，只包含 unsafe deploy。

- [ ] **Step 3: 验证 JSON**

```bash
python3 -m json.tool tests/fixtures/project-profiles/canonical-v2.json >/dev/null
python3 -m json.tool tests/fixtures/project-profiles/legacy-flat.json >/dev/null
python3 -m json.tool tests/fixtures/project-profiles/unsafe-command.json >/dev/null
```

Expected: exit code `0`。

- [ ] **Step 4: 提交**

```bash
git add .ai-agent/schemas/project-profile.schema.json tests/fixtures/project-profiles
git commit -m "test(agent-factory): define project profile contract fixtures"
```

---

### Task 2: 实现 Python 规范化器

**Files:**
- Create: `scripts/project_profile_contract.py`
- Create: `scripts/test_project_profile_contract.py`

- [ ] **Step 1: 写失败测试**

```python
def test_canonical_v2_extracts_only_safe_commands():
    summary = normalize_profile_summary(load_fixture("canonical-v2.json"))
    assert summary["build_commands"] == ["npm run build"]
    assert summary["test_commands"] == ["npm test"]
    assert summary["risk_level"] == "high"
    assert "npm run deploy" not in summary["build_commands"]

def test_legacy_flat_profile_remains_supported():
    summary = normalize_profile_summary(load_fixture("legacy-flat.json"))
    assert summary["build_commands"] == ["npm run build"]
    assert summary["test_commands"] == ["npm test", "npm run test:e2e"]
    assert summary["risk_level"] == "medium"

def test_unsafe_only_profile_has_no_recommendations():
    summary = normalize_profile_summary(load_fixture("unsafe-command.json"))
    assert summary["build_commands"] == []
    assert summary["test_commands"] == []
```

同时测试重复命令、空 command、非字符串 command、非法 risk level 和 v2 缺少 `commands.safe`。

- [ ] **Step 2: 确认失败**

Run: `python3 scripts/test_project_profile_contract.py`

Expected: FAIL with `ModuleNotFoundError`。

- [ ] **Step 3: 实现固定接口**

```python
class ProjectProfileContractError(ValueError):
    pass

def normalize_profile_summary(profile: dict) -> dict:
    """Return normalized profile_summary or raise ProjectProfileContractError."""

def normalize_profile_document(profile: dict) -> dict:
    """Return canonical v2 while preserving unsafe/ambiguous separation."""
```

实现顺序：

1. 根节点必须是 object。
2. v2 严格读取 `commands.safe.build/test[*].command`。
3. legacy 优先读取 `discovered_commands.build/test`，其次读取 `commands.build/test`。
4. legacy object 只接收直接 string value。
5. 风险优先读取 `risk_profile.risk_level`，其次顶层 `risk_level`，最后旧 risk map 推导。
6. 返回统一摘要字段。

- [ ] **Step 4: 验证并提交**

```bash
python3 scripts/test_project_profile_contract.py
git add scripts/project_profile_contract.py scripts/test_project_profile_contract.py
git commit -m "feat(agent-factory): normalize project profile contract"
```

Expected: 测试 PASS 后提交成功。

---

### Task 3: 接入 Python 画像落库与 Prompt

**Files:**
- Modify: `scripts/hermes_project_profile.py:208-279`
- Modify: `.ai-agent/prompts/project-profiler-agent.md`
- Modify: `scripts/test_project_profile_contract.py`

- [ ] **Step 1: 写落库集成测试**

将 canonical fixture 写入临时项目，调用提取后的 `finalize_project_profile()`，断言磁盘保留 v2，Registry 摘要只包含 safe 命令。

- [ ] **Step 2: 确认旧代码失败**

Run: `python3 scripts/test_project_profile_contract.py`

Expected: 命令为空或函数不存在。

- [ ] **Step 3: 增加原子写入**

```python
def write_json_atomic(path, data):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target.with_name(f"{target.name}.tmp-{os.getpid()}")
    try:
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, target)
    finally:
        if temp_path.exists():
            temp_path.unlink()
```

- [ ] **Step 4: 替换内联解析**

```python
canonical_profile = normalize_profile_document(profile_data)
summary = normalize_profile_summary(canonical_profile)
write_json_atomic(profile_json_path, canonical_profile)
project["profile_summary"] = summary
```

`ProjectProfileContractError` 必须设置 `profile_failed` 并非零退出。

- [ ] **Step 5: 固化 Prompt**

Prompt 必须包含完整 v2 示例，并明确只有 safe build/test 会显示为推荐命令；deploy、publish、migration、destructive、privileged 命令必须进入 unsafe 或 ambiguous。

- [ ] **Step 6: 验证并提交**

```bash
python3 scripts/test_project_profile_contract.py
python3 scripts/test_portability.py
git add scripts/hermes_project_profile.py scripts/test_project_profile_contract.py .ai-agent/prompts/project-profiler-agent.md
git commit -m "fix(agent-factory): persist canonical project profiles"
```

Expected: 两套测试 PASS。

---

### Task 4: 建立唯一 TypeScript Parser

**Files:**
- Create: `agent-factory-dashboard/backend/src/application/project-profile-parser.ts`
- Create: `agent-factory-dashboard/backend/tools/test-project-profile-parser.js`
- Modify: `agent-factory-dashboard/backend/package.json`

- [ ] **Step 1: 写共享 fixture 测试**

```javascript
const canonical = parseProjectProfileSummary(readFixture('canonical-v2.json'));
assert.deepStrictEqual(canonical.build_commands, ['npm run build']);
assert.deepStrictEqual(canonical.test_commands, ['npm test']);
assert.strictEqual(canonical.risk_level, 'high');
assert.ok(!canonical.build_commands.includes('npm run deploy'));

const legacy = parseProjectProfileSummary(readFixture('legacy-flat.json'));
assert.deepStrictEqual(legacy.build_commands, ['npm run build']);
assert.deepStrictEqual(legacy.test_commands, ['npm test', 'npm run test:e2e']);
assert.strictEqual(legacy.risk_level, 'medium');
```

增加 canonical 缺少 safe、非法 risk、非字符串命令反例。

- [ ] **Step 2: 确认失败**

```bash
cd agent-factory-dashboard/backend
npm run build
node tools/test-project-profile-parser.js
```

Expected: FAIL with missing module。

- [ ] **Step 3: 实现固定接口**

```typescript
export class ProjectProfileParseError extends Error {}

export function parseProjectProfileSummary(
  parsed: unknown
): AgentFactoryProject['profile_summary']
```

行为必须与 Python fixtures 一致：v2 严格、legacy 兼容、safe-only、稳定去重、非法类型 fail closed。

- [ ] **Step 4: 注册并运行测试**

```json
"test:project-profile-parser": "npm run build && node tools/test-project-profile-parser.js"
```

Run: `npm run test:project-profile-parser`

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/application/project-profile-parser.ts tools/test-project-profile-parser.js package.json
git commit -m "feat(dashboard): add canonical project profile parser"
```

---

### Task 5: 删除重复解析并恢复旧摘要

**Files:**
- Modify: `agent-factory-dashboard/backend/src/infrastructure/file-project-repository.ts:40-127`
- Modify: `agent-factory-dashboard/backend/src/infrastructure/file-project-repository.ts:179-203`
- Modify: `agent-factory-dashboard/backend/src/application/project-onboarding.ts:123-231`
- Modify: `agent-factory-dashboard/backend/tools/test-project-onboarding.js`

- [ ] **Step 1: 扩充集成测试**

Mock Profiler 生成 canonical fixture，画像完成后断言 build/test/risk 正确且不含 deploy。再创建 `status = profiled`、Registry 摘要为空、磁盘画像有效的项目，断言 `listProjects()` 自动恢复摘要。

- [ ] **Step 2: 确认失败**

Run: `node tools/test-project-onboarding.js`

Expected: 命令为空或风险为 unknown。

- [ ] **Step 3: Repository 改用唯一 Parser**

删除类内 parser，导入：

```typescript
import { parseProjectProfileSummary } from '../application/project-profile-parser';
```

恢复条件：

```typescript
function needsProfileSummaryRefresh(project: AgentFactoryProject): boolean {
  const summary = project.profile_summary;
  return !summary || (
    summary.risk_level === 'unknown' &&
    summary.build_commands.length === 0 &&
    summary.test_commands.length === 0
  );
}
```

只修改返回对象，不在缺少 Registry Lock 时隐式写文件。

- [ ] **Step 4: Onboarding 删除内联 Parser**

```typescript
const parsed = JSON.parse(profileContent);
updatedProject.profile_summary = parseProjectProfileSummary(parsed);
updatedProject.status = 'profiled';
updatedProject.last_profiled_at = new Date().toISOString();
```

解析异常时设置 `profile_failed`、清空摘要并记录路径和错误。

- [ ] **Step 5: 验证并提交**

```bash
npm run build
npm run test:project-profile-parser
node tools/test-project-onboarding.js
git add src/infrastructure/file-project-repository.ts src/application/project-onboarding.ts tools/test-project-onboarding.js
git commit -m "fix(dashboard): unify project profile summary parsing"
```

Expected: 全部 PASS。

---

### Task 6: 发布验收

**Files:**
- Modify: `agent-factory-dashboard/backend/package.json`
- Modify: `docs/agent-factory/configuration.md`

- [ ] **Step 1: 注册总入口**

```json
"test:project-profile-contract": "npm run test:project-profile-parser && python3 ../../scripts/test_project_profile_contract.py && node tools/test-project-onboarding.js"
```

- [ ] **Step 2: 更新文档**

记录 v2 Schema、legacy 兼容、safe/ambiguous/unsafe 语义、摘要恢复和 `profile_failed` 条件。

- [ ] **Step 3: 执行回归**

```bash
cd agent-factory-dashboard/backend
npm run test:project-profile-contract
npm run test:onboarding
npm run test:project-adu
npm run build
cd ../frontend && npm run build
cd ../../..
python3 scripts/agent_factory_doctor.py --skip-hermes
git diff --check
```

Expected: 测试和构建全部通过，Doctor 无错误/警告。

- [ ] **Step 4: 手工验收**

确认 Dashboard 显示 safe build/test 和嵌套 risk level，unsafe deploy 不显示；破坏 `commands.safe` 后项目进入 `profile_failed`。

- [ ] **Step 5: 提交**

```bash
git add agent-factory-dashboard/backend/package.json docs/agent-factory/configuration.md
git commit -m "test(agent-factory): gate project profile contract"
```

## 5. 验收清单

- [ ] canonical v2 与 legacy profile 均可解析。
- [ ] Python 和 TypeScript 使用同一批 fixtures。
- [ ] 嵌套 risk level 正确进入 Dashboard。
- [ ] 只有 safe build/test 进入推荐命令。
- [ ] unsafe/ambiguous 永不进入推荐命令。
- [ ] 两处 TypeScript 重复解析已删除。
- [ ] canonical 损坏时状态为 `profile_failed`。
- [ ] 已有项目空摘要可从磁盘恢复。
- [ ] 无需修改前端组件即可正确展示。

## 6. 禁止的快捷修复

- 禁止递归收集 `commands` 下全部字符串。
- 禁止只修 Repository 而遗漏 Python 和 Onboarding。
- 禁止直接修改现有 `projects.json` 伪造结果。
- 禁止删除 legacy 兼容。
- 禁止解析失败后返回空数组并标记 `profiled`。
- 禁止在本计划中再次修改 Runner 写权限。

## 7. 回滚策略

共享 fixtures 与测试契约必须保留。Parser 接入出现问题时，只回滚调用点，不删除契约模块；v2 保留 legacy 可读语义，因此回滚不会破坏已有画像文件。


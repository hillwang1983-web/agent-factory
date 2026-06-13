# Agent Factory Write Path Policy Engine 详细设计

## 1. 背景

当前 Agent Factory 使用 `allowed_write_paths` 作为 ADU 的硬写入边界。这个机制保证了 Agent 不会随意修改仓库文件，但在 Phase 3 Epic 拆分和真实需求开发中已经多次暴露出问题：

- Epic/ADU 拆分阶段无法一次性枚举所有必要文件。
- Contract 或 Detail Designer 发现合理新增文件后，只能失败，无法申请扩展。
- Developer 实际需要修改构建注册文件、聚合头文件、路由注册文件时，经常被路径限制卡住。
- Validator 只能返回 failed，页面上缺少“为什么要扩展写路径、是否可批准”的操作入口。

典型例子：`ADU-6603-001` 合理新增 `lib/app/device-bind.c/h` 后，还必须修改 `lib/app/meson.build` 和 `lib/app/ogs-app.h`，但这两个文件没有被 splitter 放入 `allowed_write_paths`，导致 contract 质量门失败。

本设计目标是保留安全边界，同时让合理的路径扩展自动化或可审核化。

## 2. 设计目标

1. `allowed_write_paths` 不再是一次性静态清单，而是“基线权限 + 自动推导权限 + 人工批准扩展”的组合。
2. 对低风险、可由规则明确推导的路径扩展自动批准。
3. 对中风险路径扩展进入 Dashboard 审核门，由用户确认。
4. 对敏感路径和高风险扩展直接拒绝。
5. Contract、Detail Designer、Developer、Validator 都使用同一套策略判断，避免多处口径不一致。
6. 页面上可看到每次扩展请求、批准/拒绝原因、来源 Agent、风险等级和最终写入 ADU 的路径。
7. 保持对已有 ADU 的向后兼容。

## 3. 非目标

- 不取消 `allowed_write_paths`。
- 不允许 Agent 任意扩大到目录级大权限，例如直接授权整个 `src/` 或 `lib/`。
- 不在本阶段实现复杂 RBAC 或多用户审批。
- 不改变代码沙箱本身的最终写入拦截职责。
- 不把所有扩展请求都自动批准。

## 4. 核心概念

### 4.1 Baseline Write Paths

ADU 创建、Intake、Epic Splitter 或人工注册时给出的初始写路径。

示例：

```json
[
  "lib/dbi/subscription.c",
  "lib/proto/types.h",
  "lib/app/device-bind.c",
  "lib/app/device-bind.h"
]
```

### 4.2 Derived Write Paths

系统根据规则从 baseline 或 requested paths 自动推导出来的伴随文件。

示例：

- 新增 `lib/app/*.c` → 可推导 `lib/app/meson.build`
- 新增 `lib/app/*.h` → 可推导 `lib/app/ogs-app.h`
- 新增 `webui/src/pages/*.tsx` → 可推导 WebUI 路由注册文件
- 新增 `agent-factory-dashboard/backend/src/interfaces/*controller.ts` → 可推导 `backend/src/index.ts` 或 router 注册文件

### 4.3 Expansion Request

Agent 或 Validator 发现 contract/design/code 需要额外写路径时，不直接失败，而是生成结构化扩展请求。

```json
{
  "request_id": "wpr-ADU-6603-001-20260612-001",
  "adu_id": "ADU-6603-001",
  "project_id": "open5gs",
  "source_agent": "contract",
  "source_stage": "contract_validation",
  "requested_paths": [
    "lib/app/meson.build",
    "lib/app/ogs-app.h"
  ],
  "reason": "新增 lib/app/device-bind.c/h 需要加入编译源列表和公共聚合头文件",
  "risk": "low",
  "decision": "pending",
  "created_at": "2026-06-12T00:00:00Z",
  "updated_at": "2026-06-12T00:00:00Z"
}
```

### 4.4 Decision

扩展请求的处理结果：

- `auto_approved`: 命中 derived rule，自动批准。
- `pending_human_approval`: 需要人工确认。
- `approved`: 人工批准。
- `rejected`: 人工拒绝。
- `blocked`: 命中敏感路径或安全策略，系统拒绝。

## 5. 数据模型

### 5.1 ADU 扩展字段

在 `.ai-agent/registry/adu.json` 的每个 ADU 中增加：

```json
{
  "allowed_write_paths": [],
  "write_path_policy": {
    "mode": "strict_with_expansion",
    "auto_approve_derived": true,
    "human_approval_required_for_medium_risk": true,
    "max_expansion_paths_per_request": 12
  },
  "write_path_expansions": [
    {
      "request_id": "wpr-ADU-6603-001-20260612-001",
      "source_agent": "contract",
      "requested_paths": ["lib/app/meson.build"],
      "approved_paths": ["lib/app/meson.build"],
      "decision": "auto_approved",
      "reason": "Derived from lib/app/device-bind.c",
      "created_at": "2026-06-12T00:00:00Z",
      "updated_at": "2026-06-12T00:00:00Z"
    }
  ]
}
```

兼容策略：

- 老 ADU 没有 `write_path_policy` 时，默认按 `strict_with_expansion` 处理。
- 老 ADU 没有 `write_path_expansions` 时，视为空数组。

### 5.2 独立注册表

新增：

```text
.ai-agent/registry/write-path-expansion-requests.json
```

结构：

```json
{
  "version": 1,
  "requests": []
}
```

该文件用于 Dashboard 列表和历史审计。ADU 内的 `write_path_expansions` 保存最终生效摘要。

### 5.3 派生规则配置

新增：

```text
.ai-agent/policies/path-derivation-rules.json
```

初始规则建议：

```json
{
  "version": 1,
  "rules": [
    {
      "id": "open5gs-lib-app-source-to-meson",
      "project_glob": "*",
      "when_requested_path_matches": ["lib/app/*.c", "lib/app/*.h"],
      "allow_derived_paths": ["lib/app/meson.build"],
      "risk": "low",
      "reason": "lib/app 新增 C/H 文件需要注册到 meson.build"
    },
    {
      "id": "open5gs-lib-app-header-to-aggregate",
      "project_glob": "*",
      "when_requested_path_matches": ["lib/app/*.h"],
      "allow_derived_paths": ["lib/app/ogs-app.h"],
      "risk": "low",
      "reason": "lib/app 公共头文件需要加入 ogs-app.h 聚合头"
    },
    {
      "id": "backend-controller-to-index",
      "project_glob": "*",
      "when_requested_path_matches": ["agent-factory-dashboard/backend/src/interfaces/*controller.ts"],
      "allow_derived_paths": ["agent-factory-dashboard/backend/src/index.ts"],
      "risk": "low",
      "reason": "新增 controller 需要在 index.ts 注册路由"
    }
  ],
  "blocked_paths": [
    ".git/",
    ".ai-agent/registry/projects.json",
    ".ai-agent/registry/agent-model-settings.json",
    "**/.env",
    "**/id_rsa",
    "**/secrets*"
  ],
  "high_risk_prefixes": [
    "lib/core/",
    "src/amf/",
    "src/smf/",
    "src/upf/",
    "src/mme/"
  ]
}
```

说明：

- `blocked_paths` 永远不能通过扩展请求批准。
- `high_risk_prefixes` 默认进入人工审批或拒绝，不能自动批准。
- Open5GS 项目可以先内置少量规则，后续通用 Git 仓库画像阶段可以生成项目级规则。

## 6. 策略引擎

### 6.1 新增脚本

新增：

```text
scripts/write_path_policy.py
```

职责：

1. 读取 ADU、项目 repo root、path derivation rules。
2. 校验 requested paths 是否安全。
3. 判断路径是否已在 ADU `allowed_write_paths` 中。
4. 对不在清单内的路径执行派生规则匹配。
5. 输出三态结果：

```json
{
  "result": "approved",
  "decision": "auto_approved",
  "approved_paths": ["lib/app/meson.build"],
  "pending_paths": [],
  "blocked_paths": [],
  "risk": "low",
  "reason": "Matched rule open5gs-lib-app-source-to-meson"
}
```

或：

```json
{
  "result": "pending",
  "decision": "pending_human_approval",
  "approved_paths": [],
  "pending_paths": ["src/amf/gmm-sm.c"],
  "blocked_paths": [],
  "risk": "high",
  "reason": "High risk prefix requires human approval"
}
```

或：

```json
{
  "result": "blocked",
  "decision": "blocked",
  "approved_paths": [],
  "pending_paths": [],
  "blocked_paths": [".git/config"],
  "risk": "critical",
  "reason": "Blocked sensitive path"
}
```

### 6.2 路径匹配规则

必须使用 repo-relative path，不允许：

- 绝对路径
- `..`
- 空路径
- NUL 字符
- `.git/`
- `.ai-agent/registry/` 中非允许文件
- shell pattern 注入

路径比较沿用现有 `validate_agent_contract.py` 的组件级比较方式，但要修正错误文案：

- 当前文案写 “broader than ADU allowed write paths”，实际是“not covered by ADU allowed write paths”。
- 新文案应清楚说明：路径未授权、是否可扩展、下一步怎么处理。

## 7. Validator 改造

### 7.1 validate_agent_contract.py

当前逻辑：

- contract scope.allowed_write_paths 超出 ADU allowed_write_paths → 直接 failed

新逻辑：

1. 找出 `contract.scope.allowed_write_paths` 中未被 ADU 覆盖的路径。
2. 调用 `write_path_policy.py evaluate`。
3. 如果全部 `auto_approved`：
   - 将路径写入 ADU `allowed_write_paths` 和 `allowed_read_paths`。
   - 记录 expansion request 为 `auto_approved`。
   - validator 继续通过。
4. 如果存在 `pending_human_approval`：
   - 写入 expansion request。
   - validator 返回特殊错误码 `20`。
   - runner 将 ADU 状态置为 `human_gate`，`pre_gate_state` 保持当前阶段。
5. 如果存在 `blocked`：
   - validator 返回 `1`。
   - runner 标记 failed。

### 7.2 validate_epic_split_plan.py

拆分计划生成 child ADU 时也应调用策略引擎：

- 对 child_def.allowed_write_paths 做安全校验。
- 对 obvious derived paths 自动补全。
- 对高风险路径保留在 child ADU，但设置 `risk: high`，保持人工审核门开启。

### 7.3 developer 写入前校验

如果执行器或后续文件写入代理有实际写文件拦截层，应统一调用策略引擎：

- 已授权路径：允许。
- 可自动派生路径：自动扩展并允许。
- 待审批路径：阻塞并生成 expansion request。
- blocked：拒绝。

## 8. Runner 和 Orchestrator 改造

### 8.1 hermes_agent_run.py

质量门失败处理从二态改为三态：

- `success`: 正常推进。
- `failed`: 真失败。
- `pending_write_path_approval`: 写路径扩展待审批。

当 validator 返回 `20` 时：

```json
{
  "result": "human_gate",
  "next_state": "human_gate",
  "gate_type": "write_path_expansion",
  "pre_gate_state": "designed",
  "artifacts": [".ai-agent/registry/write-path-expansion-requests.json"],
  "error": "Write path expansion requires approval"
}
```

Runner 必须把 validator stdout/stderr 写入 run 的 `stderr.md` 或 `quality-gate.md`，避免页面只显示 failed 但没有错误原因。

### 8.2 hermes_agent_orchestrator.py

当 ADU 进入 `human_gate` 且 `gate_type=write_path_expansion`：

- 不继续执行后续 Agent。
- Dashboard 显示待审批路径。
- 审批通过后恢复到 `pre_gate_state`。
- 用户点击继续后，从当前阶段重新执行或继续下一步。

建议状态扩展：

```json
{
  "state": "human_gate",
  "gate_type": "write_path_expansion",
  "pre_gate_state": "designed"
}
```

不建议新增大量状态枚举，避免 Timeline 爆炸。

## 9. 后端 API

### 9.1 查询扩展请求

```http
GET /api/agent-factory/adus/:aduId/write-path-expansions
```

响应：

```json
{
  "aduId": "ADU-6603-001",
  "requests": []
}
```

### 9.2 批准扩展请求

```http
POST /api/agent-factory/adus/:aduId/write-path-expansions/:requestId/approve
```

body:

```json
{
  "comment": "批准构建注册文件，属于新增 lib/app 源文件的必要伴随修改"
}
```

行为：

1. 校验请求存在且 `decision=pending_human_approval`。
2. 重新执行路径安全校验。
3. 将 approved paths 加入 ADU `allowed_write_paths`。
4. 同步加入 `allowed_read_paths`。
5. 更新 request decision 为 `approved`。
6. 如果 ADU 当前 `human_gate.gate_type=write_path_expansion`，可允许用户继续。

### 9.3 拒绝扩展请求

```http
POST /api/agent-factory/adus/:aduId/write-path-expansions/:requestId/reject
```

body:

```json
{
  "comment": "该路径应拆成单独 ADU，不属于当前基础层修改"
}
```

行为：

- request decision 变为 `rejected`。
- ADU 保持 human gate 或 failed。
- 页面提示需要拆分或返工。

## 10. Dashboard 设计

### 10.1 ADU 详情页新增面板

新增组件：

```text
WritePathExpansionPanel.tsx
```

显示内容：

- 请求路径
- 来源 Agent
- 来源阶段
- 风险等级
- 命中的派生规则
- 请求原因
- 当前决策
- 审批按钮

### 10.2 Orchestrator Control Panel 提示

如果 ADU `state=human_gate` 且 `gate_type=write_path_expansion`：

显示：

```text
当前流程暂停：存在写路径扩展请求需要确认。
批准后系统会把路径加入 ADU allowed_write_paths，再继续执行。
```

按钮：

- 查看扩展请求
- 批准全部低/中风险请求
- 拒绝并要求返工

### 10.3 Epic 页面联动

Epic DAG 中如果某个子 ADU 因写路径扩展阻塞：

- 子 ADU 状态显示为 `human_gate`
- 阻塞原因显示 `Write path expansion`
- 点击子 ADU 可跳转到 ADU 详情页的扩展请求面板

## 11. Agent Prompt 改造

### 11.1 detail-designer

新增要求：

- 必须列出 `required_write_paths` 和 `possible_derived_write_paths`。
- 如果发现当前 ADU allowed_write_paths 不足，输出 `write_path_expansion_request` JSON。
- 不得偷偷把新路径写入正文而不声明。

### 11.2 contract

新增要求：

- `scope.allowed_write_paths` 必须只包含本契约确实需要修改的路径。
- 如果包含 ADU 未授权路径，必须在 notes 中解释原因。
- contract JSON 可包含：

```json
{
  "write_path_expansion_requests": [
    {
      "path": "lib/app/meson.build",
      "reason": "新增 lib/app/device-bind.c 需要加入编译"
    }
  ]
}
```

### 11.3 developer

新增要求：

- 修改文件前先检查 `allowed_write_paths`。
- 如果需要额外文件，优先输出 expansion request，不要绕过。
- 被拒绝后应调整实现方案或请求拆分 ADU。

## 12. 测试方案

### 12.1 单元测试

新增：

```text
scripts/test_write_path_policy.py
```

覆盖：

1. 已授权路径直接通过。
2. `lib/app/device-bind.c` 自动推导 `lib/app/meson.build`。
3. `lib/app/device-bind.h` 自动推导 `lib/app/ogs-app.h`。
4. 绝对路径被拒绝。
5. `../` 被拒绝。
6. `.git/config` 被拒绝。
7. 高风险路径进入 pending。
8. 单次请求超过最大路径数被拒绝。

### 12.2 Contract Validator 回归

新增或扩展：

```text
agent-factory-dashboard/backend/tools/test-quality-gates.js
```

用例：

- contract 包含自动派生路径，validator 自动批准并通过。
- contract 包含中风险路径，validator 返回 pending，人审后再通过。
- contract 包含 blocked path，validator 失败。

### 12.3 API 测试

新增：

```text
agent-factory-dashboard/backend/tools/test-write-path-expansions.js
```

覆盖：

- 查询 pending request。
- approve 后 ADU 写路径更新。
- approve 后 read paths 同步更新。
- reject 后 ADU 不更新。
- 不存在 request 返回 404。
- blocked request 不能 approve。

### 12.4 E2E 场景

复现 `ADU-6603-001`：

1. child ADU baseline 只包含 `lib/app/device-bind.c/h`。
2. contract 声明需要 `lib/app/meson.build` 和 `lib/app/ogs-app.h`。
3. validator 自动批准这两个 derived paths。
4. ADU 状态推进到 `contracted`。
5. Dashboard 能看到 auto-approved 历史。

## 13. 迁移策略

### 13.1 已有 ADU

无需批量修改。读取时补默认：

```json
{
  "write_path_policy": {
    "mode": "strict_with_expansion",
    "auto_approve_derived": true
  },
  "write_path_expansions": []
}
```

### 13.2 当前运行中的 ADU

如果已经因为路径扩展失败：

- 可以人工补路径后继续。
- 新逻辑上线后，可重新跑 validator 自动生成扩展记录。

### 13.3 审计

所有自动批准也必须记录，不能静默修改 ADU。

## 14. 风险与防护

| 风险 | 防护 |
|---|---|
| 自动派生规则过宽导致越权 | 规则必须精确到文件或窄 glob，禁止 `src/**` 这类大范围规则 |
| Agent 编造扩展理由 | Validator 只看规则和安全策略，不直接信任理由 |
| 人工误批准高风险路径 | UI 标红风险，要求填写 comment |
| 多进程并发修改 adu.json | 沿用现有 registry 写入锁或增加原子写入 |
| 扩展路径导致 ADU 过大 | 单次最大 12 个路径，总扩展路径超过阈值建议拆分 ADU |

## 15. 验收标准

1. `ADU-6603-001` 类型场景不再因为 `lib/app/meson.build` / `lib/app/ogs-app.h` 漏配而失败。
2. 自动扩展路径必须写入 ADU 并记录 expansion history。
3. blocked path 不能通过 Agent、Validator 或 API 绕过。
4. Dashboard 能展示 pending/approved/rejected/auto-approved 扩展请求。
5. `contract` 质量门失败时，页面 stderr 或质量门详情必须显示 validator 原因。
6. 所有新增测试通过：
   - `python3 scripts/test_write_path_policy.py`
   - `npm run test:quality-gates`
   - `npm run test:write-path-expansions`
   - `npm run build` for backend and frontend

## 16. 建议实施顺序

1. 实现 `write_path_policy.py` 和规则文件。
2. 改造 `validate_agent_contract.py`，支持 auto approve / pending / blocked。
3. 改造 `hermes_agent_run.py`，支持 pending write path gate 和 stderr 可观测性。
4. 增加后端 Repository/API。
5. 增加 Dashboard `WritePathExpansionPanel`。
6. 改造 Epic child ADU materialization，预先应用 derived rules。
7. 更新 prompts。
8. 补齐测试。

## 17. 结论

`allowed_write_paths` 不应该取消，但必须从静态白名单升级为策略化授权系统。推荐采用：

```text
Baseline allowed_write_paths
  + deterministic derived paths
  + auditable human-approved expansion
  - blocked sensitive paths
```

这样可以同时满足安全、可落地开发和 Epic 大需求拆分的效率要求。

# Agent Factory Orchestrator 与模型选择补充设计

日期：2026-06-07

## 目标

在现有 Agent Factory 监控看板基础上，补充四项能力：

1. 增加“需求分析 Agent”和“详细设计 Agent”。
2. 每个 Agent 可以在看板上手工选择执行模型，模型列表从 Hermes 配置文件读取。
3. 升级真正的 Orchestrator，使看板可以一键启动指定需求的开发流程。
4. 增加 Token Budget、Token 用量监控和上下文分层治理，避免小需求出现 9M 级输入 Token 消耗。

完成后，看板不再只是监控界面，而是 Agent Factory 的运行控制台。

## Token 问题背景

“链路检测 ping 功能”完整流程消耗约：

```text
输入 Token：9,000,000
输出 Token：100,000
输入/输出比例：90:1
```

该比例说明主要成本来自输入上下文反复注入，而不是 Agent 输出过多。Agent Factory 后续必须把 Token 预算、上下文裁剪、按需读取和超预算告警作为一等能力，否则 Orchestrator 一键运行会放大无效上下文消耗。

目标水位：

```text
小需求输入 Token：1,000,000 - 2,500,000
小需求输出 Token：50,000 - 120,000
```

超过该范围不直接判定失败，但必须在看板标红，并能定位是哪个 Agent、哪次 run、哪类上下文造成的。

## 新工作流

建议将 ADU 状态机调整为：

```text
created
  -> requirement-analyst -> analyzed
  -> context-pack         -> contexted
  -> detail-designer      -> designed
  -> contract             -> contracted
  -> testwriter           -> test_red
  -> developer            -> implemented
  -> buildfix-debugger    -> debugged
  -> evidence             -> evidenced
```

安排原则：

- `requirement-analyst` 先基于 ADU 和原始需求材料完成范围拆解、边界确认、验收口径识别。
- `context-pack` 再补充代码、测试、模块依赖上下文。
- `detail-designer` 基于需求分析与代码上下文生成可实施的详细设计。
- `contract`、`testwriter`、`developer`、`buildfix-debugger`、`evidence` 继续沿用现有开发闭环。

## 新增 Agent

在 `.ai-agent/registry/agents.json` 中新增：

```json
{
  "id": "requirement-analyst",
  "name": "Requirement Analyst",
  "prompt": ".ai-agent/prompts/requirement-analyst-agent.md",
  "worktree": false
}
```

```json
{
  "id": "detail-designer",
  "name": "Detail Designer",
  "prompt": ".ai-agent/prompts/detail-designer-agent.md",
  "worktree": false
}
```

新增 Prompt：

```text
.ai-agent/prompts/requirement-analyst-agent.md
.ai-agent/prompts/detail-designer-agent.md
```

`requirement-analyst` 输出要求：

```json
{
  "status": "success",
  "next_state": "analyzed",
  "artifacts": [".ai-agent/analysis/REQ-xxx.md"],
  "risks": [],
  "clarification_questions": [],
  "next_agent": "context-pack"
}
```

`detail-designer` 输出要求：

```json
{
  "status": "success",
  "next_state": "designed",
  "artifacts": [".ai-agent/designs/REQ-xxx-detailed-design.md"],
  "affected_modules": [],
  "test_strategy": [],
  "next_agent": "contract"
}
```

## 新增产物目录

新增：

```text
.ai-agent/analysis/
.ai-agent/designs/
```

典型产物：

```text
.ai-agent/analysis/REQ-xxx.md
.ai-agent/designs/REQ-xxx-detailed-design.md
.ai-agent/designs/REQ-xxx-interfaces.json
```

后端 Artifact allowlist 需要同步增加：

```text
.ai-agent/analysis/
.ai-agent/designs/
```

## Hermes 模型列表读取

后端新增 Hermes 配置读取服务：

```text
open5gs-nms/backend/src/infrastructure/hermes/hermes-config-repository.ts
open5gs-nms/backend/src/application/use-cases/agent-model-settings.ts
```

主读取源：

```text
/Users/hill/.hermes/config.yaml
```

读取字段：

```yaml
model:
  default: ...
  provider: ...

providers:
  vertexai:
    models:
      google/gemini-3.1-pro-preview: {}
```

后端只返回 provider、model、label、default 标记，不返回 API key、token、proxy、credential 等敏感字段。

返回结构：

```ts
type HermesModelOption = {
  provider: string;
  model: string;
  label: string;
  isDefault: boolean;
  source: 'hermes-config';
};
```

## Agent 模型设置

模型设置保存到：

```text
.ai-agent/registry/agent-model-settings.json
```

示例：

```json
{
  "requirement-analyst": {
    "provider": "vertexai",
    "model": "google/gemini-3.1-pro-preview"
  },
  "developer": {
    "provider": "vertexai",
    "model": "google/gemini-3.1-pro-preview"
  }
}
```

新增 API：

```http
GET /api/agent-factory/hermes/models
GET /api/agent-factory/agents/model-settings
PUT /api/agent-factory/agents/:agentId/model
```

校验规则：

- `agentId` 必须存在于 `.ai-agent/registry/agents.json`。
- `provider + model` 必须存在于 Hermes 配置模型列表。
- 配置文件解析失败时，前端禁用模型选择并展示错误。
- 不允许前端直接写 Hermes 配置文件。

## Runner 模型注入

现有：

```text
scripts/hermes_agent_run.py
```

需要增加模型解析逻辑：

1. 读取 `.ai-agent/registry/agent-model-settings.json`。
2. 根据当前 Agent ID 获取模型覆盖配置。
3. 构造 Hermes 执行命令。
4. 将实际使用的 provider/model 记录到 `runs.json`。

建议新增封装：

```text
scripts/hermes_command.py
```

职责：

- 统一生成 Hermes CLI 参数。
- 屏蔽不同 Hermes 版本的模型参数差异。
- 开发时用 `hermes --help` 确认最终参数，例如 `--provider`、`--model` 或等价配置。

## Token Budget 与上下文治理

新增 Token Budget 配置：

```text
.ai-agent/registry/token-budget.json
```

示例：

```json
{
  "default": {
    "inputTokenLimit": 500000,
    "outputTokenLimit": 100000,
    "warnAtRatio": 0.8,
    "hardStop": false
  },
  "agents": {
    "requirement-analyst": {
      "inputTokenLimit": 150000,
      "outputTokenLimit": 30000,
      "contextLevels": ["L0"]
    },
    "context-pack": {
      "inputTokenLimit": 300000,
      "outputTokenLimit": 80000,
      "contextLevels": ["L0", "L1"]
    },
    "detail-designer": {
      "inputTokenLimit": 300000,
      "outputTokenLimit": 60000,
      "contextLevels": ["L0", "L1"]
    },
    "contract": {
      "inputTokenLimit": 200000,
      "outputTokenLimit": 50000,
      "contextLevels": ["L0", "L1"]
    },
    "testwriter": {
      "inputTokenLimit": 500000,
      "outputTokenLimit": 100000,
      "contextLevels": ["L0", "L1", "L2"]
    },
    "developer": {
      "inputTokenLimit": 800000,
      "outputTokenLimit": 120000,
      "contextLevels": ["L0", "L1", "L2"]
    },
    "buildfix-debugger": {
      "inputTokenLimit": 1000000,
      "outputTokenLimit": 120000,
      "contextLevels": ["L0", "L1", "L2", "L3"]
    },
    "evidence": {
      "inputTokenLimit": 150000,
      "outputTokenLimit": 50000,
      "contextLevels": ["L0", "L3"]
    }
  }
}
```

上下文分层定义：

```text
L0：ADU 摘要、需求分析摘要、验收目标。所有 Agent 可读。
L1：相关模块索引、接口关系、详细设计摘要。设计、契约、测试、开发 Agent 可读。
L2：具体源码片段、测试文件片段、允许修改文件内容。测试和开发 Agent 可读。
L3：构建日志、测试日志、diff、evidence。debug 和 evidence Agent 可读。
```

新增上下文清单文件：

```text
.ai-agent/context-packs/REQ-xxx-context-manifest.json
```

示例：

```json
{
  "aduId": "REQ-xxx",
  "levels": {
    "L0": [
      {
        "path": ".ai-agent/analysis/REQ-xxx.md",
        "maxBytes": 20000,
        "required": true
      }
    ],
    "L1": [
      {
        "path": ".ai-agent/designs/REQ-xxx-detailed-design.md",
        "maxBytes": 50000,
        "required": true
      }
    ],
    "L2": [
      {
        "path": "open5gs-nms/backend/src/interfaces/rest/link-diagnostics-controller.ts",
        "maxBytes": 30000,
        "required": false
      }
    ],
    "L3": [
      {
        "path": ".ai-agent/runs/REQ-xxx/latest/stderr.txt",
        "maxBytes": 50000,
        "required": false
      }
    ]
  }
}
```

Runner 构造 Prompt 时必须遵守：

- 不再把所有 ADU、历史 run、源码、日志全量注入每个 Agent。
- 按 Agent 的 `contextLevels` 从 manifest 选择文件。
- 每个文件按 `maxBytes` 截断。
- Prompt 中应优先传递文件路径、摘要和必要片段。
- 当上下文超过预算时，先丢弃 optional 文件，再压缩 L2/L3，最后进入 `human_gate`。

Token 估算与记录：

- 执行前使用本地估算器记录 `estimatedInputTokens`。
- 执行后从 Hermes stdout/stderr 或 run metadata 中解析真实用量；如果 Hermes 无法提供真实用量，则保留估算值并标记 `usageSource: "estimated"`。
- 每次 run 都必须写入 token usage。

`runs.json` 中新增字段：

```json
{
  "id": "run-xxx",
  "adu_id": "REQ-xxx",
  "agent_id": "developer",
  "token_usage": {
    "inputTokens": 730000,
    "outputTokens": 82000,
    "totalTokens": 812000,
    "estimatedInputTokens": 760000,
    "usageSource": "hermes",
    "budget": {
      "inputTokenLimit": 800000,
      "outputTokenLimit": 120000,
      "warnAtRatio": 0.8,
      "hardStop": false
    },
    "status": "warning"
  }
}
```

ADU 聚合新增字段：

```json
{
  "id": "REQ-xxx",
  "token_summary": {
    "inputTokens": 1900000,
    "outputTokens": 95000,
    "totalTokens": 1995000,
    "agentBreakdown": {
      "developer": {
        "inputTokens": 730000,
        "outputTokens": 82000,
        "status": "warning"
      }
    }
  }
}
```

Budget 状态规则：

```text
normal：低于 warnAtRatio。
warning：达到 input/output limit 的 warnAtRatio。
exceeded：超过 input/output limit，但 hardStop=false。
blocked：超过 input/output limit 且 hardStop=true，Orchestrator 停止并进入 human_gate。
unknown：没有 token usage，也无法估算。
```

Orchestrator 行为：

- 每个 Agent 执行前先计算预计输入 Token。
- 达到 warning 阈值时继续执行，但发送 WebSocket warning 事件。
- 达到 hardStop 阈值时不调用 Hermes，直接进入 `human_gate`，原因写入 `runs.json`。
- 每个 step 完成后汇总 ADU token summary。
- 一键运行时如果累计 Token 超过 ADU 级预算，可以暂停并要求人工确认继续。

建议新增 ADU 级预算：

```json
{
  "aduDefaults": {
    "small": {
      "inputTokenLimit": 2500000,
      "outputTokenLimit": 120000
    },
    "medium": {
      "inputTokenLimit": 6000000,
      "outputTokenLimit": 250000
    },
    "large": {
      "inputTokenLimit": 12000000,
      "outputTokenLimit": 500000
    }
  }
}
```

ADU 可增加规模字段：

```json
{
  "id": "REQ-xxx",
  "size": "small"
}
```

## Orchestrator 设计

新增：

```text
scripts/hermes_agent_orchestrator.py
```

命令形式：

```bash
python3 scripts/hermes_agent_orchestrator.py --adu REQ-xxx --mode continue --max-steps 20 --json-events
```

职责：

1. 接收指定 ADU ID。
2. 读取当前 ADU state。
3. 根据状态选择下一个 Agent。
4. 调用 `hermes_agent_run.py`。
5. 每一步结束后刷新 `adu.json`、`runs.json`。
6. 通过 NDJSON 输出执行事件。
7. 遇到 `evidenced`、`human_gate`、`failed`、`cancelled` 时停止。

运行状态保存：

```text
.ai-agent/registry/orchestrator-runs.json
.ai-agent/registry/orchestrator.lock
```

状态结构：

```json
{
  "run_id": "orch-20260607-001",
  "adu_id": "REQ-xxx",
  "status": "running",
  "current_agent": "developer",
  "current_state": "implemented",
  "started_at": "...",
  "updated_at": "...",
  "steps": []
}
```

并发规则：

- 同一个 ADU 同时只允许一个 active orchestrator run。
- 全局 registry 写入使用 lock 文件保护。
- cancel 时先发送 SIGTERM，超时后标记 cancelled。
- Orchestrator 异常退出后，后端重启时根据 heartbeat 将运行标记为 stale/failed。

## 后端 API

新增：

```http
POST /api/agent-factory/adus/:aduId/start
POST /api/agent-factory/orchestrator/:runId/cancel
POST /api/agent-factory/orchestrator/:runId/pause
GET  /api/agent-factory/orchestrator
GET  /api/agent-factory/orchestrator/:runId
GET  /api/agent-factory/token-budget
PUT  /api/agent-factory/token-budget
GET  /api/agent-factory/adus/:aduId/token-usage
GET  /api/agent-factory/runs/:runId/token-usage
```

`start` 请求：

```json
{
  "mode": "continue",
  "maxSteps": 20,
  "modelOverrides": {
    "developer": {
      "provider": "vertexai",
      "model": "google/gemini-3.1-pro-preview"
    }
  }
}
```

`start` 响应：

```json
{
  "runId": "orch-20260607-001",
  "aduId": "REQ-xxx",
  "status": "running"
}
```

WebSocket 事件：

```json
{
  "type": "agent_factory_orchestrator_event",
  "payload": {
    "runId": "orch-20260607-001",
    "aduId": "REQ-xxx",
    "agentId": "developer",
    "state": "implemented",
    "status": "step_completed",
    "message": "developer completed"
  }
}
```

Token warning WebSocket 事件：

```json
{
  "type": "agent_factory_token_warning",
  "payload": {
    "runId": "run-xxx",
    "aduId": "REQ-xxx",
    "agentId": "developer",
    "status": "warning",
    "inputTokens": 730000,
    "inputTokenLimit": 800000,
    "ratio": 0.91,
    "message": "developer input token usage reached 91% of budget"
  }
}
```

## 前端改造

改造位置：

```text
open5gs-nms/frontend/src/components/agent-factory/
open5gs-nms/frontend/src/stores/agentFactory.ts
open5gs-nms/frontend/src/api/agentFactory.ts
```

新增 UI：

1. ADU 操作区：
   - `Start`
   - `Continue`
   - `Run Next Step`
   - `Pause`
   - `Cancel`

2. Agent 模型配置区：
   - 每个 Agent 一张配置卡片。
   - 展示当前 provider/model。
   - 下拉选择 Hermes 模型。
   - 保存后调用 `PUT /api/agent-factory/agents/:agentId/model`。

3. Orchestrator 运行状态区：
   - 当前 ADU。
   - 当前 Agent。
   - 当前状态。
   - 最近事件。
   - 运行耗时。
   - human_gate / failed 原因。

4. Token 用量区：
   - 当前 ADU 总 input/output token。
   - 当前 Orchestrator run 总 input/output token。
   - 每个 Agent 的 token 消耗条形图。
   - input/output 比例。
   - 超过 warning 阈值的 Agent 标黄。
   - 超过 limit 的 Agent 标红。
   - 显示 usage source：`hermes` 或 `estimated`。

5. Token Budget 配置区：
   - 展示每个 Agent 的 input/output limit。
   - 展示每个 Agent 可读取的 context levels。
   - 支持编辑预算并保存到 `token-budget.json`。
   - `hardStop` 使用开关控件。

Workflow Timeline 新增节点：

```text
Requirement Analysis
Context Pack
Detail Design
Contract
Test
Develop
Debug
Evidence
```

## 测试要求

后端：

- 状态机测试：覆盖 `created -> analyzed -> contexted -> designed`。
- Hermes 配置解析测试：使用 fixture 验证模型列表读取。
- 模型设置 API 测试：非法 agent、非法模型、合法保存。
- Orchestrator dry-run 测试：使用 fake runner 验证多 step 推进。
- Artifact allowlist 测试：覆盖 `.ai-agent/analysis/` 和 `.ai-agent/designs/`。
- Token budget 解析测试：覆盖 default、agent override、ADU size budget。
- Context manifest 裁剪测试：验证不同 Agent 只能读取允许的 context levels。
- Token warning 测试：达到 `warnAtRatio` 时生成 warning 事件。
- Token hardStop 测试：超过预算且 `hardStop=true` 时不调用 Hermes，并进入 `human_gate`。

前端：

- `npm run build` 通过。
- 模型下拉框能显示 Hermes 配置模型。
- Start 按钮能触发指定 ADU。
- WebSocket 事件能刷新当前运行状态。
- Token 用量区能显示 ADU、run、Agent 三个层级的用量。
- Token warning 能在看板中标黄或标红。
- Token Budget 配置保存后刷新仍保留。

端到端验收：

1. 新建一个 ADU，初始状态为 `created`。
2. 在看板为每个 Agent 选择模型。
3. 点击 `Start`。
4. 看板依次显示：

```text
requirement-analyst -> context-pack -> detail-designer -> contract -> testwriter -> developer -> buildfix-debugger -> evidence
```

5. 最终 ADU 进入 `evidenced`，或在失败时进入 `human_gate` 并展示原因。
6. 看板展示该 ADU 的总 input/output token。
7. 看板展示每个 Agent 的 token 用量。
8. 人为降低某个 Agent 的 hardStop budget 后，Orchestrator 应停止在该 Agent 之前并进入 `human_gate`。

## 开发顺序

1. 扩展状态机和 Agent 注册。
2. 新增两个 Prompt 和产物目录。
3. 新增 Hermes 模型读取 API。
4. 新增 Agent 模型设置读写能力。
5. 改造 `hermes_agent_run.py` 支持模型覆盖。
6. 新增 `token-budget.json`、context manifest 和 token usage 记录。
7. 新增 `hermes_agent_orchestrator.py`。
8. 后端接入 Orchestrator API、Token API 和 WebSocket 事件。
9. 前端增加模型选择、一键启动控制、Token 用量区和 Token Budget 配置区。
10. 补充后端测试、前端构建验证和端到端 walkthrough。

## 验收标准

- 看板能显示需求分析和详细设计步骤。
- 每个 Agent 能独立选择 Hermes 配置中的模型。
- 点击指定 ADU 的 `Start` 后，无需手工执行 `python3 scripts/hermes_agent_next.py`。
- Orchestrator 能自动推进完整流程。
- human_gate、failed、cancelled 状态能准确显示。
- 不暴露 Hermes 配置中的敏感信息。
- 已有 ADU 的历史展示不受影响。
- 看板能显示 ADU、run、Agent 三个层级的 Token 用量。
- Token 用量超过 warning 阈值时能在看板标黄并发出 WebSocket 事件。
- Token 用量超过 hardStop 阈值时，Orchestrator 不继续调用 Hermes，并进入 `human_gate`。
- 小需求默认 Token 目标应控制在 1M - 2.5M input token；超过目标时必须能定位消耗来源。

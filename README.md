# Agent Factory

Agent Factory 是一套面向任意 Git 软件项目的多 Agent 需求开发与质量治理平台。它以 Hermes 作为 Agent 执行器，提供项目画像、需求接入、Epic/ADU 编排、人工质量门、证据治理、Token 成本统计和独立 Web 监控看板。

当前版本已支持从自然语言需求或需求文档开始，驱动完整的软件开发流水线：

```text
项目注册与画像
  -> 需求草案生成与澄清
  -> Epic 或 ADU 注册
  -> 需求分析
  -> 详细设计
  -> Contract
  -> 开发与构建修复
  -> Code Review
  -> Acceptance Review
  -> Evidence
```

## 核心能力

- **通用项目接入**：注册任意本地 Git 仓库并生成项目画像与知识包。
- **自然语言需求接入**：将文本或上传文档转换为可执行的 ADU/Epic 草案。
- **多 Agent 编排**：支持自动执行、继续执行、单步执行、暂停和取消。
- **Epic 拆分**：将跨模块需求拆分为带依赖关系的子 ADU。
- **人工审核与澄清**：支持需求分析、详细设计、环境验证和写路径扩展等人工质量门。
- **确定性质量门**：通过 Contract、可信命令记录、Code Review 事实门、Acceptance 和 Evidence Validator 阻止事实性假通过。
- **Operator Override**：对 Validator 误判提供可审计、幂等且经过二次校验的人工纠偏。
- **运行稳定性治理**：提供 Watchdog、显式完成信封、进程回收、跨进程 Registry Lock 和运行预算。
- **Token 治理**：按 ADU、Agent 和运行次数统计输入/输出 Token、成功次数和失败次数。
- **独立监控看板**：展示 ADU/Epic 状态、Agent 日志、工作流、质量报告、证据矩阵和人工门。

## 项目结构

```text
.
├── .ai-agent/
│   ├── prompts/                 # Agent Prompt
│   ├── registry/                # 配置与运行时注册表
│   └── policies/                # Agent 运行及安全策略
├── agent-factory-dashboard/
│   ├── backend/                 # Express + TypeScript API/WebSocket 服务
│   └── frontend/                # React + Vite 独立看板
├── scripts/
│   ├── hermes_agent_run.py      # Agent Runner
│   ├── hermes_agent_orchestrator.py
│   ├── hermes_epic_orchestrator.py
│   └── validate_*.py            # Contract、质量和证据 Validator
└── docs/                        # 设计、实施计划和调试记录
```

## 环境要求

- Git
- Python 3.10 或更高版本
- Node.js 20 或更高版本
- npm
- 可用的 Hermes CLI 与模型 Provider 配置

Hermes 配置文件默认位于：

```text
~/.hermes/config.yaml
```

也可以通过 `HERMES_CONFIG_PATH` 指定其他位置。

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/hillwang1983-web/agent-factory.git
cd agent-factory
```

### 2. 安装前后端依赖

```bash
cd agent-factory-dashboard/backend
npm install

cd ../frontend
npm install

cd ../..
```

### 3. 初始化运行环境

Bootstrap 会创建运行目录、空 Registry 和默认 Agent 运行策略，不会覆盖已有数据。

```bash
python3 scripts/agent_factory_bootstrap.py --workspace "$PWD"
```

### 4. 配置后端

```bash
cd agent-factory-dashboard/backend
cp .env.example .env
```

编辑 `.env`：

```dotenv
AGENT_FACTORY_WORKSPACE=/path/to/agent-factory
HERMES_CONFIG_PATH=/path/to/.hermes/config.yaml
PORT=3011
WS_PORT=3012
CORS_ORIGIN=http://localhost:5175
AGENT_FACTORY_ENABLE_CONTROL=true
```

`AGENT_FACTORY_ENABLE_CONTROL=false` 时，看板只能监控，不能启动或推进流程。

### 5. 配置前端

```bash
cd ../frontend
cp .env.example .env
```

默认配置：

```dotenv
VITE_API_BASE_URL=http://localhost:3011
VITE_WS_PORT=3012
VITE_API_PROXY_TARGET=http://localhost:3011
```

前端默认使用浏览器当前访问的主机建立 WebSocket。例如通过
`http://192.168.1.33:5175` 访问时，会连接
`ws://192.168.1.33:3012`，不会连接浏览器本机的 `localhost`。
只有在 WebSocket 使用独立域名或反向代理路径时才设置
`VITE_WS_URL`。

### 6. 运行 Doctor

```bash
cd ../backend
npm run doctor -- --skip-hermes
```

若需要同时检查 Hermes 配置：

```bash
npm run doctor
```

预期结果：

```json
{
  "errors": [],
  "warnings": []
}
```

### 7. 启动服务

终端一：

```bash
cd agent-factory-dashboard/backend
npm run build
npm run start
```

终端二：

```bash
cd agent-factory-dashboard/frontend
npm run dev
```

默认地址：

- Web Dashboard: <http://localhost:5175>
- Backend API: <http://localhost:3011>
- WebSocket: `ws://localhost:3012`

## 基本使用流程

### 注册项目

1. 在看板中进入项目页面。
2. 注册目标 Git 仓库的绝对路径。
3. 启动项目画像。
4. 确认项目状态变为 `profiled`。

未完成画像的项目不能启动需求开发流程。

### 创建需求

- 小型、单模块、依赖简单的需求：创建 **ADU**。
- 跨模块、需要拆分或存在依赖关系的需求：创建 **Epic**。

需求接入 Agent 会生成草案和澄清问题。所有阻塞问题必须回答、延期给需求分析 Agent，或明确排除在 MVP 范围之外，才能完成注册。

### 执行与审核

- 调试阶段推荐使用“单步执行”，逐步检查需求分析、详细设计、Contract 和质量报告。
- 流程稳定后可以使用“自动执行”或“继续自动”。
- 遇到 `human_gate` 时，在人工质量门页面处理对应问题，不应直接修改 Registry JSON。
- Validator 被确认误判时，使用 Operator Override，并保留充分的操作理由和校验证据。

## 测试与质量检查

### 核心构建

```bash
cd agent-factory-dashboard/backend
npm run build

cd ../frontend
npm run build
```

### Phase 3.7 回归

```bash
cd agent-factory-dashboard/backend
npm run test:phase37-regression
npm run test:operator
npm run test:adu1351-regressions
```

### 质量门与 Epic

```bash
npm run test:quality-gates
npm run test:epic-dag
```

### 移植性门禁

```bash
npm run check:portable
npm run doctor -- --skip-hermes
```

## 数据与安全边界

- `.ai-agent/registry/` 下的大部分 JSON 是主机本地运行态数据，已通过 `.gitignore` 排除。
- 不要提交 API Key、Hermes 配置、私钥、模型凭据或项目运行日志。
- Agent 只能在 ADU 和 Contract 授权的路径范围内修改文件。
- 写路径扩展必须经过策略引擎自动审批或人工审批。
- 可信命令由 Runner 执行，Agent 自报的 `commands_run` 不能作为独立验收证据。
- Operator Override 只能用于 Validator 误判纠偏，不能替代缺失的实现和测试。

提交前建议执行：

```bash
cd agent-factory-dashboard/backend
npm run check:portable
npm run doctor -- --skip-hermes
git diff --check
```

## 当前版本

当前主线覆盖 Phase 1 至 Phase 3.7：

- Phase 1：通用 Git 项目注册与画像
- Phase 2：基于项目画像的 ADU 开发流水线
- Phase 2.5：自然语言和文档需求接入
- Phase 3：Epic 拆分与依赖编排
- Phase 3.5：人工质量门、证据治理和 Token 治理
- Phase 3.6：移植性、自举与 Doctor
- Phase 3.7：Operator 控制层、运行稳定性和人工纠偏

详细设计和调试记录位于 `docs/superpowers/`。

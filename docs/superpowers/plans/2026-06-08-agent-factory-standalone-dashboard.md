# Agent Factory Standalone Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Agent Factory 从 Open5GS NMS 中解耦，形成一个独立运行的 Agent Factory 监控看板，只负责 Agent Factory 的状态监控、运行流转展示、Artifact 查看、模型配置展示、Token 用量展示。

**Architecture:** 新建独立应用 `agent-factory-dashboard/`，复用当前 NMS 中已经验证过的 Agent Factory 领域类型、文件仓储、监控聚合逻辑和前端组件，但不依赖 NMS 的认证、拓扑、配置管理、用户管理、Open5GS 服务控制、MongoDB、Prometheus 等模块。独立看板通过读取 `/Users/hill/open5gs/.ai-agent/`、`/Users/hill/open5gs/scripts/` 和 `/Users/hill/.hermes/config.yaml` 展示 Agent Factory 运行状态。

**Tech Stack:** Node.js + Express + TypeScript backend, React + Vite + Zustand frontend, file-based registry under `.ai-agent/`, WebSocket optional realtime refresh, Hermes config read-only integration.

---

## 1. 改造目标

当前 Agent Factory 看板嵌在：

```text
/Users/hill/open5gs/open5gs-nms/
```

它依赖 NMS 的：

```text
Express 主服务
Auth middleware
Layout 左侧导航
WebSocket hook
NMS UI token/CSS
Open5GS 业务页面
MongoDB / subscriber / config / service monitor 初始化
```

本次改造目标是新建独立工程：

```text
/Users/hill/open5gs/agent-factory-dashboard/
```

独立服务只负责：

```text
1. 读取 ADU registry
2. 读取 Agent registry
3. 读取 runs/evidence/artifacts
4. 展示当前需求处理状态
5. 展示各 Agent 状态
6. 展示 workflow timeline
7. 展示 run history
8. 展示 artifact 内容
9. 展示 token budget / token usage
10. 展示 Hermes 模型配置和每个 Agent 当前模型
```

明确不做：

```text
1. 不管理 Open5GS 服务
2. 不管理 NMS 用户
3. 不管理 Subscriber
4. 不管理 RAN/Topology
5. 不依赖 MongoDB
6. 不依赖 NMS 登录体系
7. MVP 阶段不提供 Orchestrator 启动/暂停/取消控制，只做监控
```

如果后续需要“控制台模式”，可以在独立看板中再打开 Start/Pause/Cancel 功能；本阶段应先保持只读监控，降低安全风险。

---

## 2. 目标目录结构

创建：

```text
agent-factory-dashboard/
  backend/
    package.json
    tsconfig.json
    src/
      index.ts
      config.ts
      domain/
        agent-factory.ts
        agent-factory-repository.ts
      infrastructure/
        file-agent-factory-repository.ts
        hermes-config-repository.ts
        agent-model-settings-repository.ts
        token-budget-repository.ts
      application/
        agent-factory-monitor.ts
      interfaces/
        agent-factory-controller.ts
      websocket/
        broadcaster.ts
  frontend/
    package.json
    index.html
    tsconfig.json
    vite.config.ts
    src/
      main.tsx
      App.tsx
      api/
        agentFactory.ts
      stores/
        agentFactory.ts
      types/
        agent-factory.ts
      components/
        agent-factory/
          AgentFactoryPage.tsx
          SummaryStrip.tsx
          AduQueuePanel.tsx
          WorkflowTimeline.tsx
          AgentLanePanel.tsx
          RunHistoryTable.tsx
          ArtifactDrawer.tsx
          TokenBudgetChart.tsx
          ModelSelectionCard.tsx
        common/
          HealthBadge.tsx
  README.md
```

---

## 3. 后端设计

### 3.1 配置

新增：

```text
agent-factory-dashboard/backend/src/config.ts
```

配置项：

```ts
export interface AppConfig {
  port: number;
  wsPort: number;
  workspaceRoot: string;
  registryRoot: string;
  hermesConfigPath: string;
  artifactMaxBytes: number;
  pollIntervalMs: number;
  corsOrigin: string;
}
```

默认值：

```text
PORT=3011
WS_PORT=3012
AGENT_FACTORY_WORKSPACE=/Users/hill/open5gs
HERMES_CONFIG_PATH=/Users/hill/.hermes/config.yaml
AGENT_FACTORY_ARTIFACT_MAX_BYTES=100000
AGENT_FACTORY_POLL_INTERVAL_MS=3000
CORS_ORIGIN=http://localhost:5175
```

### 3.2 后端只读原则

MVP 后端只允许写：

```text
无
```

MVP 后端只读：

```text
.ai-agent/registry/adu.json
.ai-agent/registry/agents.json
.ai-agent/registry/runs.json
.ai-agent/registry/token-budget.json
.ai-agent/registry/agent-model-settings.json
.ai-agent/context-packs/
.ai-agent/contracts/
.ai-agent/analysis/
.ai-agent/designs/
.ai-agent/evidence/
.ai-agent/runs/
tests/ai-agent-mvp/
/Users/hill/.hermes/config.yaml
```

Artifact API 必须保留 realpath + allowlist 防护。

### 3.3 API 设计

保留监控 API：

```http
GET /api/health
GET /api/agent-factory/dashboard
GET /api/agent-factory/adus
GET /api/agent-factory/adus/:id
GET /api/agent-factory/agents
GET /api/agent-factory/runs?aduId=&agent=&limit=
GET /api/agent-factory/artifacts?path=&maxBytes=
GET /api/agent-factory/hermes/models
GET /api/agent-factory/agents/model-settings
GET /api/agent-factory/token-budget?aduId=
```

移除或默认禁用控制 API：

```http
POST /api/agent-factory/adus/:aduId/start
POST /api/agent-factory/adus/:aduId/pause
POST /api/agent-factory/adus/:aduId/cancel
POST /api/agent-factory/adus/:aduId/continue
PUT  /api/agent-factory/agents/:agentId/model
```

如需保留代码，必须由环境变量显式开启：

```text
AGENT_FACTORY_ENABLE_CONTROL=false
```

当未开启时返回：

```json
{
  "success": false,
  "error": "Control API is disabled in monitoring-only mode"
}
```

### 3.4 WebSocket 设计

独立看板不需要直接消费 NMS 的 WebSocket。

MVP 采用两种刷新方式：

```text
1. 前端每 3 秒 REST polling。
2. 后端可选 polling registry 后广播 agent_factory_status。
```

WebSocket 事件：

```json
{
  "type": "agent_factory_status",
  "payload": {
    "generated_at": "...",
    "summary": {},
    "adus": [],
    "agents": [],
    "recent_runs": []
  }
}
```

---

## 4. 前端设计

### 4.1 页面目标

独立页面打开后第一屏就是 Agent Factory 看板，不再有 NMS 的 Dashboard、Topology、Subscribers、Services 等导航。

页面结构：

```text
Header
SummaryStrip
Main Grid
  Left:
    AduQueuePanel
    ModelSelectionCard(read-only)
  Right:
    Selected ADU Detail
    WorkflowTimeline
    TokenBudgetChart
    RunHistoryTable
AgentLanePanel
ArtifactDrawer
```

### 4.2 组件迁移

从 NMS 迁移：

```text
open5gs-nms/frontend/src/components/agent-factory/*
open5gs-nms/frontend/src/stores/agentFactory.ts
open5gs-nms/frontend/src/api/agentFactory.ts
open5gs-nms/frontend/src/types/agent-factory.ts
```

迁移后删除或替换对 NMS 的依赖：

```text
Layout
AuthContext
useWebSocket 中的 service_status
NMS 全局导航
NMS service/store index
```

### 4.3 UI 文字

建议改为中文监控语义：

```text
Agent Factory 监控看板
需求队列
当前需求
工作流状态
Agent 状态
执行记录
产物查看
Token 用量
模型配置
```

### 4.4 控制按钮处理

本阶段只做监控，因此 `OrchestratorControlPanel` 不迁移。

如果保留，应默认折叠并显示：

```text
当前为只读监控模式，控制功能未启用
```

---

## 5. 数据兼容设计

独立看板读取的 registry 仍然是：

```text
/Users/hill/open5gs/.ai-agent/registry/
```

因此不迁移现有 Agent Factory 数据。

必须兼容以下状态：

```text
created
analyzed
contexted
designed
contracted
test_red
implemented
debugged
evidenced
mvp_ready
human_gate
paused
canceled
```

必须兼容旧 run 记录没有 `token_usage` 的情况。

Token usage 汇总规则：

```text
1. run.token_usage 存在时使用真实/估算值。
2. run.token_usage 不存在时按 0 处理。
3. UI 应显示 usageSource：
   - hermes
   - estimated
   - missing
```

---

## 6. 实施任务

### Task 1: 创建独立工程骨架

**Files:**
- Create: `agent-factory-dashboard/backend/package.json`
- Create: `agent-factory-dashboard/backend/tsconfig.json`
- Create: `agent-factory-dashboard/frontend/package.json`
- Create: `agent-factory-dashboard/frontend/vite.config.ts`
- Create: `agent-factory-dashboard/frontend/index.html`

- [ ] 创建 backend/frontend 两个 package。
- [ ] backend 依赖只保留 `express`、`cors`、`compression`、`pino`、`ws`、`typescript`、`ts-node-dev`。
- [ ] frontend 依赖只保留 `react`、`react-dom`、`vite`、`zustand`、`lucide-react`。
- [ ] 不引入 NMS MongoDB/Auth/Open5GS service 依赖。

### Task 2: 迁移后端领域类型与仓储

**Files:**
- Create: `agent-factory-dashboard/backend/src/domain/agent-factory.ts`
- Create: `agent-factory-dashboard/backend/src/domain/agent-factory-repository.ts`
- Create: `agent-factory-dashboard/backend/src/infrastructure/file-agent-factory-repository.ts`

- [ ] 从 NMS 复制 Agent Factory 类型。
- [ ] 复制 File repository。
- [ ] 保留 artifact allowlist。
- [ ] 保留 `fs.realpath` 防 symlink 绕过。
- [ ] 删除所有 NMS 业务依赖。

### Task 3: 迁移监控聚合 Use Case

**Files:**
- Create: `agent-factory-dashboard/backend/src/application/agent-factory-monitor.ts`

- [ ] 复制 `AgentFactoryMonitorUseCase`。
- [ ] 保留 workflow timeline。
- [ ] 保留 `human_gate` blocked 渲染。
- [ ] 保留 `getAllRuns()`。
- [ ] 保留 terminal evidenced complete 逻辑。
- [ ] 增加 `paused/canceled` 状态展示。

### Task 4: 迁移 Hermes 与 Token 读取能力

**Files:**
- Create: `agent-factory-dashboard/backend/src/infrastructure/hermes-config-repository.ts`
- Create: `agent-factory-dashboard/backend/src/infrastructure/agent-model-settings-repository.ts`
- Create: `agent-factory-dashboard/backend/src/infrastructure/token-budget-repository.ts`

- [ ] Hermes config 只读。
- [ ] 模型设置只读。
- [ ] Token budget 只读。
- [ ] 所有路径基于 `AGENT_FACTORY_WORKSPACE` 或 `HERMES_CONFIG_PATH`。

### Task 5: 创建独立 REST API

**Files:**
- Create: `agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts`
- Create: `agent-factory-dashboard/backend/src/index.ts`
- Create: `agent-factory-dashboard/backend/src/config.ts`

- [ ] 实现只读 API。
- [ ] `/api/health` 返回服务状态与 workspace。
- [ ] `/api/agent-factory/dashboard` 返回完整看板数据。
- [ ] `/api/agent-factory/artifacts` 保留安全限制。
- [ ] `/api/agent-factory/token-budget?aduId=` 使用 all runs 汇总。
- [ ] 默认不注册控制 API。

### Task 6: 迁移前端 Agent Factory 页面

**Files:**
- Create: `agent-factory-dashboard/frontend/src/main.tsx`
- Create: `agent-factory-dashboard/frontend/src/App.tsx`
- Create: `agent-factory-dashboard/frontend/src/api/agentFactory.ts`
- Create: `agent-factory-dashboard/frontend/src/stores/agentFactory.ts`
- Create: `agent-factory-dashboard/frontend/src/types/agent-factory.ts`
- Create: `agent-factory-dashboard/frontend/src/components/agent-factory/*`

- [ ] 迁移 Agent Factory components。
- [ ] 删除 NMS Layout 依赖。
- [ ] 删除 Auth 依赖。
- [ ] 删除 service_status WebSocket 逻辑。
- [ ] 页面默认选中第一个 active ADU。
- [ ] Artifact drawer 可打开。
- [ ] Token chart 可显示真实/缺失用量。

### Task 7: UI 独立样式

**Files:**
- Create: `agent-factory-dashboard/frontend/src/index.css`

- [ ] 从 NMS 提取必要 CSS token。
- [ ] 保留深色运维风格。
- [ ] 页面不出现 NMS 导航项。
- [ ] 移动端布局可用。

### Task 8: 验证

**Commands:**

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm install
npm run build
```

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/frontend
npm install
npm run build
```

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run dev
```

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/frontend
npm run dev -- --host 0.0.0.0 --port 5175
```

验收地址：

```text
http://localhost:5175
```

---

## 7. 验收标准

必须满足：

```text
1. 不启动 open5gs-nms，也能打开独立 Agent Factory 看板。
2. 后端不连接 MongoDB。
3. 后端不初始化 Open5GS service monitor。
4. 前端不出现 NMS 导航和其他 NMS 页面。
5. 能读取现有 .ai-agent/registry/adu.json。
6. 能读取现有 runs.json。
7. 能展示 ADU 队列。
8. 能展示 workflow timeline。
9. 能展示 Agent 状态。
10. 能展示 run history。
11. 能打开 allowed artifact。
12. 不能读取 allowlist 外文件。
13. 能展示 Token budget 和 token usage。
14. 能展示 Hermes 模型列表。
15. 模型配置以只读方式展示。
16. build 全部通过。
```

明确不作为本次验收：

```text
1. 不要求从独立看板启动 Orchestrator。
2. 不要求修改 Agent 模型。
3. 不要求修改 token-budget.json。
4. 不要求登录认证。
5. 不要求多用户权限。
```

---

## 8. 推荐端口

```text
Standalone Agent Factory Backend: 3011
Standalone Agent Factory WebSocket: 3012
Standalone Agent Factory Frontend: 5175
Existing NMS Backend: 3001
Existing NMS WebSocket: 3002
Existing NMS Frontend: 5174/5173
```

---

## 9. 后续扩展

MVP 只读监控稳定后，再考虑：

```text
1. 启用控制模式：Start/Pause/Cancel/Continue。
2. 增加只读 token 报表。
3. 增加多需求并发视图。
4. 增加 per-ADU lock 状态展示。
5. 增加 Agent run log 实时 tail。
6. 增加 Basic Auth 或本机 token 认证。
7. 将 Agent Factory 做成可复用 npm/docker package。
```

---

## 10. 风险与约束

主要风险：

```text
1. 从 NMS 复制组件时带入无关依赖。
2. 复制 CSS 不完整导致页面样式破碎。
3. Artifact allowlist 回归。
4. Token usage 旧数据缺字段导致 UI 报错。
5. Hermes config YAML 解析不完整。
```

规避方式：

```text
1. 后端先跑 API，再接前端。
2. 前端组件迁移后立即 build。
3. Artifact 安全测试必须复制。
4. Token usage 字段全部做 optional fallback。
5. 只读模式禁止任何写操作。
```


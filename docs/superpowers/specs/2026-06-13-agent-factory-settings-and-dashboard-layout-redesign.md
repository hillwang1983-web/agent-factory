# Agent Factory Settings & Dashboard Layout Redesign 详细设计

**日期:** 2026-06-13
**主题:** Agent Factory 页面信息架构调整、模型设置独立页与任务看板布局优化
**适用范围:** 独立版 Agent Factory Dashboard 前端，不包含历史 NMS 集成版本
**目标读者:** Antigravity、前端、QA、后续接手 AI Agent
**状态:** Ready for implementation

---

## 1. 背景

Agent Factory 初期只有一个任务看板页面，因此模型配置、任务队列、ADU 详情、运行日志、Token 信息都被集中放在 `AgentFactoryPage` 中。随着 Phase 2、Phase 3、Phase 3.5 持续演进，系统已经新增 Projects、Epics、Human Gates、Evidence Matrix、Operation Timeline、Token Governance 等能力，原有单页布局已经开始影响使用体验。

当前最明显的问题：

1. `ModelSelectionCard` 放在任务看板左栏，占用了 ADU Queue 的主要空间。
2. 模型设置区域布局过窄，Agent 名称较长时会被截断或视觉上被 select 控件覆盖。
3. 模型配置是全局系统设置，不属于某个 ADU 的任务详情，不应长期放在任务看板中。
4. `TokenGovernancePanel` 是全局治理配置，目前挂在 ADU 详情页和 Epic 子 ADU 抽屉中，语义不清。
5. `AgentFactoryPage` 负担过重，用户进入任务看板时会看到过多非当前任务的配置项。

本设计目标是把 Agent Factory 的页面结构从“单任务看板承载所有功能”升级为“运行页面与设置页面分离”的更清晰信息架构。

---

## 2. 目标

本次 UI 改造必须实现：

1. 新增独立的 `系统设置` 页面。
2. 将 Agent 模型配置从任务看板移入系统设置页。
3. 将全局 Token Governance 配置从 ADU/Epic 详情区域移入系统设置页。
4. 重构模型配置布局，避免 Agent 名称被覆盖或截断到无法识别。
5. 保持任务看板聚焦 ADU 队列、当前 ADU 状态、运行流程和产物。
6. 不改变现有后端 API，不改变 Agent Runtime，不改变模型配置文件格式。

---

## 3. 非目标

本次改造不做：

1. 不修改后端模型配置 API。
2. 不修改 Hermes 配置读取逻辑。
3. 不新增模型推荐算法，只做静态 UI 展示与可选的推荐标签。
4. 不重写整套视觉系统。
5. 不调整 Projects、Epics、Human Gates 的业务逻辑。
6. 不处理移动端深度适配，只保证窄屏不遮挡、不溢出。

---

## 4. 当前代码入口

### 4.1 前端入口

```text
agent-factory-dashboard/frontend/src/App.tsx
agent-factory-dashboard/frontend/src/components/agent-factory/AgentFactoryPage.tsx
agent-factory-dashboard/frontend/src/components/agent-factory/ModelSelectionCard.tsx
agent-factory-dashboard/frontend/src/components/token/TokenGovernancePanel.tsx
agent-factory-dashboard/frontend/src/stores/agentFactory.ts
agent-factory-dashboard/frontend/src/api/agentFactory.ts
agent-factory-dashboard/frontend/src/types/agent-factory.ts
```

### 4.2 当前布局问题点

`AgentFactoryPage.tsx` 当前左栏：

```tsx
<div className="col-span-12 xl:col-span-4">
  <ModelSelectionCard />
  <AduQueuePanel />
</div>
```

问题：

- 模型配置是全局设置，却位于任务队列上方。
- 左栏宽度在 `xl:col-span-4` 下仍不足以舒适展示所有 Agent + model select。
- 长 Agent ID 只能 `w-32 truncate`，容易造成用户无法确认正在配置哪个 Agent。

`AgentFactoryPage.tsx` 当前右栏底部：

```tsx
<TokenBudgetChart aduId={selectedAdu.id} />
<TokenGovernancePanel />
```

问题：

- `TokenBudgetChart aduId` 是当前 ADU 局部消耗，保留合理。
- `TokenGovernancePanel` 是全局预算设置，放在 ADU 详情中不合理。

---

## 5. 新信息架构

### 5.1 顶部导航

当前导航：

```text
任务看板 | Epic 编排 | 人工质量门 | 项目管理
```

目标导航：

```text
任务看板 | Epic 编排 | 人工质量门 | 项目管理 | 系统设置
```

新增 `系统设置` 使用图标建议：

- `Settings`
- 或 `SlidersHorizontal`

来自 `lucide-react`。

### 5.2 页面职责

| 页面 | 职责 |
|---|---|
| 任务看板 | ADU 队列、单 ADU 运行状态、工作流、产物、质量报告、运行日志 |
| Epic 编排 | Epic 列表、DAG、子 ADU 状态、父级验收 |
| 人工质量门 | 所有 pending/resolved human gates 的统一处理 |
| 项目管理 | Git 仓库注册、画像、项目 ADU 创建 |
| 系统设置 | Agent 模型、Token 治理、后续策略配置、Hermes 状态 |

---

## 6. 系统设置页设计

### 6.1 新增组件结构

新增目录：

```text
agent-factory-dashboard/frontend/src/components/settings/
```

新增组件：

```text
SettingsPage.tsx
ModelSettingsPanel.tsx
SettingsSectionHeader.tsx
```

可选组件：

```text
HermesModelStatusPanel.tsx
FactoryPolicyPanel.tsx
```

### 6.2 SettingsPage

`SettingsPage` 负责设置页整体布局和 tab 状态。

建议 tabs：

```text
Agent 模型
Token 治理
运行策略
Hermes 状态
```

MVP 必须实现：

1. `Agent 模型`
2. `Token 治理`

`运行策略` 和 `Hermes 状态` 可以先显示 placeholder，但不能写“TODO”。建议使用“后续版本接入”文案。

### 6.3 SettingsPage 布局

建议布局：

```text
页面标题区域
  Agent Factory 系统设置
  管理 Agent 模型、Token 预算和运行治理策略

Tabs
  Agent 模型 | Token 治理 | 运行策略 | Hermes 状态

Content
  当前 tab 对应配置面板
```

样式约束：

- 不使用嵌套卡片堆叠。
- 页面主体使用单层 `nms-card` 或无框 section。
- tab 使用 segmented control 样式。
- 设置页适合横向扫描，优先使用表格和分组行。

---

## 7. Agent 模型配置面板

### 7.1 现有组件处理策略

当前 `ModelSelectionCard.tsx` 有两种选择：

1. 直接重构为表格版，并移动到 `components/settings/ModelSettingsPanel.tsx`。
2. 保留旧组件但不再在 `AgentFactoryPage` 中使用，新建表格版。

推荐 **方案 2**：

- 新建 `ModelSettingsPanel.tsx`。
- 保留 `ModelSelectionCard.tsx` 一段时间，避免影响旧引用或回滚。
- `AgentFactoryPage` 移除 `ModelSelectionCard` import 和渲染。

### 7.2 表格列设计

模型配置采用表格，不再使用窄卡片。

列：

```text
Agent
职责阶段
当前 Provider
当前 Model
推荐档位
模型选择
状态
```

字段说明：

- `Agent`: 完整显示 Agent ID，不截断。第二行可显示中文名或职责说明。
- `职责阶段`: 如 `需求分析`、`详细设计`、`代码实现`、`验收审查`。
- `当前 Provider`: 当前保存的 provider，默认显示 `default`。
- `当前 Model`: 当前保存的 model，默认显示 `default`。
- `推荐档位`: `Premium`、`Balanced`、`Cost`、`Deterministic`。
- `模型选择`: select 控件。
- `状态`: updating、只读模式、保存失败等。

### 7.3 Agent 职责映射

前端可定义静态映射：

```ts
const AGENT_ROLE_META: Record<string, {
  label: string;
  stage: string;
  recommendedTier: 'Premium' | 'Balanced' | 'Cost' | 'Deterministic';
  description: string;
}> = {
  'requirement-analyst': {
    label: '需求分析',
    stage: '需求澄清',
    recommendedTier: 'Premium',
    description: '负责理解需求、识别歧义和输出分析文档'
  },
  'detail-designer': {
    label: '详细设计',
    stage: '方案设计',
    recommendedTier: 'Premium',
    description: '负责模块设计、接口设计和修改范围判断'
  },
  'contract': {
    label: '契约生成',
    stage: '质量门定义',
    recommendedTier: 'Premium',
    description: '负责将设计固化为可校验断言'
  },
  'testwriter': {
    label: '测试编写',
    stage: '测试准备',
    recommendedTier: 'Balanced',
    description: '负责生成红灯测试或验证脚本'
  },
  'developer': {
    label: '代码实现',
    stage: '实现',
    recommendedTier: 'Balanced',
    description: '负责按契约和设计修改代码'
  },
  'code-reviewer': {
    label: '代码审查',
    stage: '审查',
    recommendedTier: 'Premium',
    description: '负责发现实现偏差和高风险缺陷'
  },
  'buildfix-debugger': {
    label: '编译修复',
    stage: '调试',
    recommendedTier: 'Cost',
    description: '负责构建、测试失败后的定位和修复'
  },
  'acceptance-reviewer': {
    label: '验收审查',
    stage: '验收',
    recommendedTier: 'Premium',
    description: '负责确认实现是否满足需求和契约'
  },
  'evidence': {
    label: '证据归档',
    stage: '归档',
    recommendedTier: 'Cost',
    description: '负责整理最终证据矩阵和交付材料'
  }
};
```

未知 Agent：

- `label`: 使用原始 Agent ID。
- `stage`: `自定义 Agent`。
- `recommendedTier`: `Balanced`。
- `description`: `未配置职责说明`。

### 7.4 表格布局细节

桌面端：

```text
Agent 列宽: minmax(220px, 1.2fr)
职责阶段: 120px
Provider: 140px
Model: minmax(220px, 1fr)
推荐档位: 120px
模型选择: minmax(280px, 1.4fr)
状态: 100px
```

实现建议：

- 使用 CSS grid 或 table。
- 如果使用 table，给 select 设置 `min-w-[260px]`。
- Agent ID 使用 `break-all` 或 `whitespace-normal`，不要单行截断。
- Model 名称允许换行或使用 title tooltip。

窄屏：

- 表格可横向滚动。
- 或在 `<768px` 下改为卡片式：

```text
Agent ID
中文职责 / 推荐档位
当前模型
[select]
状态
```

### 7.5 交互规则

1. 页面加载时并行读取：
   - `/api/agent-factory/agents/model-settings`
   - `/api/agent-factory/hermes/models`
   - dashboard agents 或 store 中的 agents。
2. 修改 select 后立即保存。
3. 保存中只禁用当前行，不禁用整表。
4. 保存失败时当前行显示错误，不只 `console.error`。
5. `default` 选项固定置顶。
6. 模型列表按 provider 分组显示，推荐使用 `<optgroup>`：

```tsx
<optgroup label="openai">
  <option value="openai/gpt-5">gpt-5</option>
</optgroup>
```

7. 只读模式时：
   - select 禁用。
   - 页面顶部显示只读提示。

---

## 8. Token 治理面板迁移

### 8.1 当前问题

`TokenGovernancePanel` 是全局配置，却在：

```text
AgentFactoryPage ADU 详情底部
EpicsPage 子 ADU 抽屉
```

重复出现。

### 8.2 目标位置

迁移到：

```text
SettingsPage -> Token 治理 tab
```

### 8.3 ADU 页面保留内容

`AgentFactoryPage` 中保留：

```tsx
<TokenBudgetChart aduId={selectedAdu.id} />
```

原因：

- 它展示当前 ADU 的 token 使用，是任务局部信息。

移除：

```tsx
<TokenGovernancePanel />
```

原因：

- 它是全局配置。

### 8.4 Epic 页面处理

`EpicsPage` 子 ADU 抽屉中也移除：

```tsx
<TokenGovernancePanel />
```

如需显示子 ADU token，可后续新增局部 `TokenBudgetChart`，但本阶段不做。

---

## 9. 任务看板布局调整

### 9.1 左栏调整

当前左栏：

```tsx
<ModelSelectionCard />
<AduQueuePanel />
```

目标左栏：

```tsx
<AduQueuePanel />
```

后续可加入轻量筛选条：

```text
项目 | 状态 | Agent | 搜索
```

本阶段不强制实现筛选条。

### 9.2 右栏调整

右栏保留当前 ADU 相关内容：

```text
OperationStatusBanner
ADU Details
WorkflowTimeline
EvidenceMatrixPanel
ProjectContextPanel
QualityReportPanel
ReviewGatePanel
WritePathExpansionPanel
RunHistoryTable
OperationEventTimeline
OrchestratorControlPanel
TokenBudgetChart
AgentLanePanel
```

移除：

```text
TokenGovernancePanel
```

### 9.3 页面标题调整

当前标题仍偏早期：

```text
5GC Agent Factory
Automated compliance-driven development and validation pipeline
```

建议改为：

```text
Agent Factory 任务看板
监控 ADU 执行状态、质量门、产物与运行日志
```

如果仍希望强调 Open5GS，可在项目卡片中体现，不建议写死在全局任务看板标题。

---

## 10. App.tsx 改造

### 10.1 View 类型

当前：

```ts
const [view, setView] = useState<'dashboard' | 'projects' | 'epics' | 'human-gates'>('dashboard');
```

目标：

```ts
const [view, setView] = useState<
  'dashboard' | 'projects' | 'epics' | 'human-gates' | 'settings'
>('dashboard');
```

### 10.2 导航按钮

新增：

```tsx
<button onClick={() => setView('settings')}>
  <Settings className="h-3.5 w-3.5" />
  系统设置
</button>
```

### 10.3 Main 渲染

目标：

```tsx
{view === 'dashboard' ? (
  <AgentFactoryPage />
) : view === 'epics' ? (
  <EpicsPage />
) : view === 'human-gates' ? (
  <HumanGateCenterPage />
) : view === 'settings' ? (
  <SettingsPage />
) : (
  <ProjectsPage />
)}
```

### 10.4 Header 右侧项目选择器

当前项目选择器只在 dashboard 显示：

```tsx
{view === 'dashboard' && (...)}
```

保持不变。本次不把项目选择器提升为全局选择器。

---

## 11. API 与 Store 设计

### 11.1 不新增后端 API

复用现有 API：

```text
GET /api/agent-factory/agents/model-settings
PUT /api/agent-factory/agents/:agentId/model
GET /api/agent-factory/hermes/models
GET /api/agent-factory/token-governance
PUT /api/agent-factory/token-governance
```

### 11.2 可选前端封装

当前 `ModelSelectionCard` 直接使用 `fetch`。建议迁移时改成 `agentFactoryApi` 方法：

```ts
fetchAgentModelSettings()
updateAgentModel(agentId, provider, model)
fetchHermesModels()
```

收益：

- 设置页和未来其它组件复用。
- 错误处理统一。

这属于 P2，不阻塞本次布局改造。

---

## 12. 文件改动清单

必须新增：

```text
agent-factory-dashboard/frontend/src/components/settings/SettingsPage.tsx
agent-factory-dashboard/frontend/src/components/settings/ModelSettingsPanel.tsx
agent-factory-dashboard/frontend/src/components/settings/SettingsSectionHeader.tsx
```

必须修改：

```text
agent-factory-dashboard/frontend/src/App.tsx
agent-factory-dashboard/frontend/src/components/agent-factory/AgentFactoryPage.tsx
agent-factory-dashboard/frontend/src/components/epics/EpicsPage.tsx
```

可选修改：

```text
agent-factory-dashboard/frontend/src/api/agentFactory.ts
agent-factory-dashboard/frontend/src/components/agent-factory/ModelSelectionCard.tsx
```

不建议删除：

```text
agent-factory-dashboard/frontend/src/components/agent-factory/ModelSelectionCard.tsx
```

理由：

- 保留旧组件便于回滚。
- 后续确认无引用后再清理。

---

## 13. 验收标准

完成后必须满足：

1. 顶部导航出现 `系统设置`。
2. 进入系统设置后默认展示 `Agent 模型` tab。
3. Agent 模型配置以表格或宽布局展示，长 Agent 名称不被覆盖。
4. 模型 select 可正常读取 Hermes 模型列表。
5. 修改单个 Agent 模型后能保存，并且只显示当前行 saving 状态。
6. 保存失败时 UI 显示错误。
7. 任务看板左栏只展示 ADU 队列，不再展示模型设置。
8. ADU 详情页不再展示全局 `TokenGovernancePanel`。
9. 系统设置的 `Token 治理` tab 展示 `TokenGovernancePanel`。
10. Epic 子 ADU 抽屉不再展示全局 `TokenGovernancePanel`。
11. 前端 `npm run build` 通过。
12. `git diff --check` 通过。

---

## 14. 手工验收步骤

1. 启动前端和后端。
2. 打开 Dashboard。
3. 确认顶部导航存在：

```text
任务看板 | Epic 编排 | 人工质量门 | 项目管理 | 系统设置
```

4. 进入任务看板：
   - 左栏只有 ADU 队列。
   - 模型设置不再出现。
   - ADU 详情仍能展示 workflow、evidence、run history、control panel。
5. 进入系统设置：
   - 默认 tab 是 Agent 模型。
   - 所有 Agent 名称完整可见。
   - 长 Agent 名称不会被 select 覆盖。
6. 修改一个非关键 Agent 的模型，例如 `evidence`：
   - 当前行显示保存中。
   - 保存后值保持。
   - 刷新页面后仍保持。
7. 切换到 Token 治理：
   - 能看到 TokenGovernancePanel。
8. 进入 Epic 子 ADU 抽屉：
   - 不再看到全局 TokenGovernancePanel。
9. 执行前端构建：

```bash
cd agent-factory-dashboard/frontend
npm run build
```

10. 执行格式检查：

```bash
git diff --check
```

---

## 15. 风险与控制

| 风险 | 影响 | 控制措施 |
|---|---|---|
| 设置页新增后导航过宽 | 小屏 header 拥挤 | nav 支持横向滚动或缩短文案 |
| 模型设置迁移导致旧入口消失 | 用户找不到配置 | 任务看板可加一个小链接“模型配置已移至系统设置” |
| 表格过宽 | 窄屏溢出 | 外层 `overflow-x-auto` |
| 保存失败只在 console 中出现 | 用户误以为保存成功 | 行内错误提示 |
| TokenGovernancePanel 被多个地方复用导致样式不一致 | 页面观感割裂 | 在 SettingsPage 外层提供统一宽度和标题 |

---

## 16. 建议实施顺序

1. 新增 `SettingsPage` 和 tab 框架。
2. 新增 `ModelSettingsPanel` 表格版模型配置。
3. 在 `App.tsx` 增加 `settings` view 和导航。
4. 从 `AgentFactoryPage` 移除 `ModelSelectionCard`。
5. 把 `TokenGovernancePanel` 移入 `SettingsPage`。
6. 从 `AgentFactoryPage` 和 `EpicsPage` 移除全局 `TokenGovernancePanel`。
7. 优化标题与空状态文案。
8. 跑前端 build 和 diff check。

---

## 17. 交付要求

Antigravity 完成后需要更新：

```text
task.md
walkthrough.md
```

walkthrough 至少说明：

1. 新增了哪些设置页组件。
2. 哪些旧页面移除了模型设置/Token 治理。
3. 模型设置长名称遮挡问题如何解决。
4. 前端构建结果。
5. 手工验收截图或操作说明。

本次改造的核心判断标准是：**任务看板只负责任务运行，系统设置负责全局配置。**

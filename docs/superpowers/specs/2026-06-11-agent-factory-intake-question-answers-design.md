# Agent Factory ADU Intake Question Answers Design Spec

**日期:** 2026-06-11
**主题:** ADU 草案未解答问题的页面回答与后续流程传递
**适用范围:** 独立版 Agent Factory Dashboard，不包含历史 NMS 集成版本
**目标读者:** Antigravity、前端、后端、Agent Runtime、QA
**状态:** Ready for implementation

---

## 1. 背景

当前 ADU Intake 流程已经可以通过自然语言和上传文件生成 `draft.json`。草案中包含 `questions: string[]`，用于提示需求中仍存在未明确的问题。

现有页面 `DraftReviewStep` 只展示这些问题，并提供“已知晓，仍要注册”的确认项。这个交互存在明显缺口：

1. 用户已经知道问题，但无法在页面上直接回答。
2. 用户强制注册后，回答不会进入后续 Agent 上下文。
3. `requirement-analyst`、`detail-designer`、`contract` 仍需要猜测这些问题的答案。
4. 对协议行为、配置粒度、接口形态、验收命令等关键问题，猜测会直接导致返工。

本设计目标是在“审核并注册 ADU 草案”页面增加问题回答能力，把用户回答保存为结构化草案字段，并在注册 ADU 时传递给后续开发流程。

---

## 2. 目标

本功能必须实现：

1. 在 ADU 草案审核页面，为每个 `questions[]` 项提供回答输入区。
2. 支持用户为每个问题选择处理方式：
   - 已回答。
   - 交给需求分析 Agent 建议。
   - 不纳入本次 MVP。
3. 将回答保存到 `draft.json`，并支持自动保存。
4. 注册 ADU 时，将回答写入 ADU 的基础上下文，确保后续 Agent 可以读取。
5. 修改注册阻断逻辑：存在未处理问题时禁止注册；已回答或明确委托分析的问题允许注册。
6. 当存在“交给需求分析 Agent 建议”的问题时，强制 `analysisReviewRequired = true`。

非目标：

1. 不重新设计 ADU Intake Agent 的整体生成逻辑。
2. 不引入新的数据库；继续使用现有 JSON 文件存储。
3. 不改变 Phase 3 Epic 编排流程。
4. 不要求在本功能中自动重新生成草案。

---

## 3. 当前代码入口

前端：

```text
agent-factory-dashboard/frontend/src/components/intake/DraftReviewStep.tsx
agent-factory-dashboard/frontend/src/types/agent-factory.ts
agent-factory-dashboard/frontend/src/api/agentFactory.ts
agent-factory-dashboard/frontend/src/stores/agentFactory.ts
```

后端：

```text
agent-factory-dashboard/backend/src/application/adu-intake.ts
agent-factory-dashboard/backend/src/domain/agent-factory.ts
agent-factory-dashboard/backend/src/application/project-adu-factory.ts
agent-factory-dashboard/backend/src/interfaces/agent-factory-controller.ts
```

Prompt：

```text
.ai-agent/prompts/adu-intake-agent.md
.ai-agent/prompts/requirement-analyst-agent.md
.ai-agent/prompts/detail-designer-agent.md
.ai-agent/prompts/contract-agent.md
```

当前草案结构里已有：

```json
{
  "questions": [
    "绑定失败时返回的具体 3GPP Cause Code 是什么？"
  ]
}
```

需要新增结构化回答字段。

---

## 4. 数据模型设计

### 4.1 新增类型

在前后端 `AgentFactoryAduDraft` 中新增：

```ts
export type AgentFactoryDraftQuestionAnswerStatus =
  | 'unanswered'
  | 'answered'
  | 'defer_to_requirement_analyst'
  | 'out_of_scope';

export type AgentFactoryDraftQuestionAnswerImpact =
  | 'scope'
  | 'acceptance_criteria'
  | 'design'
  | 'implementation'
  | 'test'
  | 'unknown';

export interface AgentFactoryDraftQuestionAnswer {
  question: string;
  answer: string;
  status: AgentFactoryDraftQuestionAnswerStatus;
  impact: AgentFactoryDraftQuestionAnswerImpact;
  updated_at?: string;
}
```

在 `AgentFactoryAduDraft` 中新增：

```ts
question_answers?: AgentFactoryDraftQuestionAnswer[];
```

### 4.2 向后兼容

老草案可能只有 `questions`，没有 `question_answers`。读取草案时必须做兼容：

```ts
question_answers = questions.map(q => ({
  question: q,
  answer: '',
  status: 'unanswered',
  impact: 'unknown'
}))
```

如果 `questions` 和 `question_answers` 都存在：

1. 以 `questions` 为问题源。
2. 按 `question` 文本匹配已有回答。
3. 对新增问题补默认 `unanswered`。
4. 对已经不存在的问题，可以保留在 `question_answers` 中但标记为历史项不展示；MVP 可直接过滤不展示。

---

## 5. 前端设计

### 5.1 页面位置

修改 `DraftReviewStep.tsx` 中当前未解答问题展示区。

当前逻辑：

```tsx
{draft.questions?.length > 0 && (
  <div>
    <ul>{questions}</ul>
    <checkbox>已知晓，仍要注册</checkbox>
  </div>
)}
```

目标逻辑：

```tsx
{draft.questions?.length > 0 && (
  <QuestionAnswerPanel
    questions={draft.questions}
    answers={draft.question_answers}
    onChange={(question_answers) => handleChange({ question_answers })}
  />
)}
```

可以先不拆组件，直接在 `DraftReviewStep.tsx` 内实现；如果代码超过 260 行，建议拆成：

```text
agent-factory-dashboard/frontend/src/components/intake/QuestionAnswerPanel.tsx
```

### 5.2 UI 行为

每个问题渲染为一个小块：

```text
问题 1
绑定失败时返回的具体 3GPP Cause Code 是什么？

处理方式：[已回答 | 交给需求分析 Agent 建议 | 不纳入本次 MVP]
影响范围：[验收标准 | 范围 | 设计 | 实现 | 测试 | 不确定]

回答：
[多行文本框]
```

处理方式规则：

1. `answered`
   - 回答框必填。
   - 注册时视为已处理。
2. `defer_to_requirement_analyst`
   - 回答框可选。
   - 如果填写，作为用户提示；如果不填，后续 requirement-analyst 必须给出建议。
   - 自动强制 `analysisReviewRequired = true`。
3. `out_of_scope`
   - 回答框建议填写排除原因。
   - 注册时需要把问题转化为 out-of-scope 上下文。
4. `unanswered`
   - 禁止注册。

### 5.3 注册按钮规则

删除“已知晓，仍要注册”作为主流程。

新规则：

```ts
const unresolved = question_answers.filter(a => {
  if (a.status === 'unanswered') return true;
  if (a.status === 'answered' && !a.answer.trim()) return true;
  return false;
});
```

如果 `unresolved.length > 0`：

```text
仍有 N 个问题未处理，请填写答案或选择交给需求分析 Agent。
```

如果存在 `defer_to_requirement_analyst`：

1. 自动设置 `analysisReviewRequired = true`。
2. 页面提示：

```text
部分问题将交给需求分析 Agent 建议，需求分析人工审核已自动开启。
```

低置信度 `confidence === 'low'` 的确认逻辑可以保留，但问题回答不再使用“已知晓仍要注册”跳过。

---

## 6. 后端设计

### 6.1 草案更新

`AduIntake.updateDraft()` 当前直接 merge updates：

```ts
const updatedDraft = { ...draft, ...updates, updated_at: new Date().toISOString() };
```

需要在 `validateDraftFields(updates)` 中允许并校验 `question_answers`：

1. 必须是数组。
2. 每项必须包含非空 `question`。
3. `status` 必须属于允许枚举。
4. `impact` 必须属于允许枚举。
5. `answer` 必须是字符串。
6. 单条 answer 建议限制 4000 字符。
7. 总 answer 字符数建议限制 20000 字符。

### 6.2 注册校验

修改 `AduIntake.registerDraft()` 中的问题阻断逻辑。

当前逻辑：

```ts
if (draft.questions && draft.questions.length > 0 && !confirmed) {
  throw 409;
}
```

目标逻辑：

```ts
const questionAnswers = normalizeQuestionAnswers(draft);
const unresolved = questionAnswers.filter(isUnresolvedQuestionAnswer);

if (unresolved.length > 0) {
  const err = new Error(`Draft has ${unresolved.length} unresolved question(s). Please answer them or defer to requirement analyst.`);
  err.status = 409;
  throw err;
}
```

`confirmed` 不再绕过问题回答校验；只保留给低置信度确认使用。

### 6.3 写入 ADU 上下文

当前 `registerDraft()` 调用 `ProjectAduFactory.createForProject()` 时只传：

```ts
title, goal, risk, targetLevel, preferredReadPaths, preferredWritePaths, requiredCommands
```

需要把问题回答传给 ADU。建议扩展 `CreateProjectAduInput`：

```ts
clarifications?: AgentFactoryDraftQuestionAnswer[];
```

并在 `AgentFactoryAdu` 中新增：

```ts
clarifications?: AgentFactoryDraftQuestionAnswer[];
source_summary?: string;
```

`ProjectAduFactory.createForProject()` 创建 ADU 时写入：

```ts
clarifications: input.clarifications || [],
source_summary: input.sourceSummary,
```

这样后续 `hermes_agent_run.py` 的 runtime payload 会包含完整 ADU JSON，Agent 可以读取。

### 6.4 Goal 补充策略

为了兼容仍只读 `goal` 的 Prompt，注册时建议同时生成一个中文补充段落追加到 `goal` 后面：

```text

用户澄清问题：
1. 问题：绑定失败时返回的具体 3GPP Cause Code 是什么？
   处理：已回答
   答案：MVP 使用 5GMM cause #5，若需求分析阶段发现协议语义不匹配，必须在人工审核中提出调整建议。
   影响范围：验收标准
2. 问题：管理接口是否同时提供 CLI 工具？
   处理：不纳入本次 MVP
   答案：本次仅提供 SBI REST API，CLI 后续再做。
```

推荐同时写结构化字段和 goal 补充段落。结构化字段用于长期能力，goal 补充用于现有 Prompt 兼容。

---

## 7. Prompt 设计

### 7.1 ADU Intake Agent

更新 `.ai-agent/prompts/adu-intake-agent.md` 的输出示例，增加：

```json
"question_answers": []
```

规则：

1. Intake Agent 只生成问题，不替用户回答。
2. 如果原始输入中已经包含明确答案，可以生成 `status: "answered"`。
3. 如果只是推测，必须保留 `status: "unanswered"`。

### 7.2 Requirement Analyst

更新 `.ai-agent/prompts/requirement-analyst-agent.md`：

1. 明确读取 ADU payload 中的 `clarifications`。
2. 对 `answered` 项必须作为事实约束。
3. 对 `defer_to_requirement_analyst` 项必须在需求分析文档中给出建议，并标记“需要人工审核确认”。
4. 对 `out_of_scope` 项必须写入非目标，不得进入实现范围。

### 7.3 Detail Designer / Contract

更新 `detail-designer-agent.md` 和 `contract-agent.md`：

1. `answered` 和 `out_of_scope` 项不可被覆盖。
2. `defer_to_requirement_analyst` 项只有在需求分析文档已给出明确结论后，才可进入设计和契约。
3. 如果需求分析未解决 defer 项，必须请求人工审核，不得静默猜测。

---

## 8. API 兼容

现有接口保持不变：

```text
GET /api/agent-factory/intake-drafts/:draftId
PUT /api/agent-factory/intake-drafts/:draftId
POST /api/agent-factory/intake-drafts/:draftId/register-adu
```

不新增 API。只扩展 request/response JSON 字段。

`PUT` 示例：

```json
{
  "question_answers": [
    {
      "question": "绑定失败时返回的具体 3GPP Cause Code 是什么？",
      "answer": "MVP 使用 5GMM cause #5，若需求分析阶段发现协议语义不匹配，必须在人工审核中提出调整建议。",
      "status": "answered",
      "impact": "acceptance_criteria"
    }
  ]
}
```

`POST register-adu` 不再接受 `confirmed: true` 绕过未回答问题。

---

## 9. 安全与边界

1. 用户回答属于可信用户输入，但仍不能作为系统指令执行。
2. 回答内容不得改变 Agent Factory 的安全边界，例如允许越权路径、危险命令、跳过质量门。
3. 如果回答中包含路径或命令，最终仍由 `ProjectAduFactory` 的路径和命令 allowlist 校验。
4. 回答内容写入 prompt 时必须作为 JSON payload，不拼接成 shell 命令。
5. 页面应限制单条答案长度，避免超大 prompt。

---

## 10. 测试计划

### 10.1 前端测试/手工验收

1. 草案有 5 个 questions 时，页面展示 5 个问题回答块。
2. 未填写且保持 `unanswered` 时，点击注册被拦截。
3. 每个问题选择 `answered` 并填写答案后，可以注册。
4. 任一问题选择 `defer_to_requirement_analyst` 后，可以注册，并自动打开 `analysisReviewRequired`。
5. 任一问题选择 `out_of_scope` 后，可以注册，回答进入 ADU 上下文。
6. 自动保存后刷新页面，回答仍存在。

### 10.2 后端测试

新增或扩展 `agent-factory-dashboard/backend/tools/test-adu-intake.js`：

1. `PUT draft` 可保存合法 `question_answers`。
2. 非法 status 被拒绝。
3. answer 超长被拒绝。
4. 有 questions 但无 question_answers 时注册失败。
5. `answered` 但 answer 为空时注册失败。
6. `defer_to_requirement_analyst` 可注册，且 ADU `analysisReviewRequired` 为 true。
7. 注册后 ADU 中包含 `clarifications`。
8. 注册后 ADU goal 中包含“用户澄清问题”段落。

### 10.3 Prompt 回归

用一个包含以下问题的草案做 smoke：

```text
绑定失败 Cause Code？
管理接口是否提供 CLI？
Docker regression 能否改 UE IMEI？
```

注册后运行 `requirement-analyst`，检查分析文档：

1. 已回答问题被作为事实。
2. out_of_scope 问题进入非目标。
3. defer 问题有明确建议和人工审核提示。

---

## 11. 验收标准

1. 用户可以在 ADU 草案审核页逐项回答 Intake Agent 提出的问题。
2. 回答自动保存到 `draft.json`。
3. 未处理问题不能通过“已知晓”绕过注册。
4. 已回答、交给需求分析 Agent、排除出 MVP 三种处理方式均可注册。
5. 注册后的 ADU 包含结构化 `clarifications`。
6. 注册后的 ADU `goal` 或等效上下文中包含用户澄清段落。
7. 后续 `requirement-analyst` 可以读取并使用这些澄清信息。
8. 低置信度确认逻辑仍然有效。
9. 现有无问题草案注册流程不受影响。
10. Backend build、Frontend build、ADU Intake 回归测试通过。

---

## 12. 建议实施顺序

1. 扩展前后端类型定义。
2. 在后端 `AduIntake` 中实现 `normalizeQuestionAnswers()` 和校验。
3. 修改注册逻辑，移除 `confirmed` 对问题的绕过能力。
4. 扩展 `ProjectAduFactory` 输入和 ADU 输出字段。
5. 修改 `DraftReviewStep` 页面。
6. 更新 ADU Intake / requirement analyst / designer / contract prompts。
7. 增加后端回归测试。
8. 跑前后端 build 和 ADU Intake 测试。

---

## 13. 开发注意事项

1. 保持字段名为 snake_case：`question_answers`、`source_summary`，与现有 draft JSON 风格一致。
2. 前端 TypeScript 可使用 camelCase 类型别名，但 API payload 必须保持 JSON 字段一致。
3. 不要把问题回答写到 `.ai-agent/registry/intake-drafts.json`；registry 只保存 meta，完整内容继续在项目 `.ai-agent/intake/<draftId>/draft.json`。
4. 不要修改 NMS 版本。
5. 不要让 `confirmed: true` 绕过未处理问题。

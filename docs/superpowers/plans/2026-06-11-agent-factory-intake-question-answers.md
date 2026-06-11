# Agent Factory ADU Intake Question Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the ability to answer Agent-generated questions directly in the ADU Draft Review UI and pass those answers seamlessly into the subsequent Epic orchestration contexts.

**Architecture:** 
- Add `question_answers` array structure to the draft domain model.
- Normalize legacy `questions` string array into the new `question_answers` format when loading a draft.
- Block registration if any questions remain `unanswered` (or are empty).
- Provide a `QuestionAnswerPanel` component in the frontend to handle user inputs for each question (Answered, Defer, Out of Scope).
- Inject resolved answers into the `CreateProjectAduInput` `clarifications` field and append a text summary to the `goal` field to ensure legacy prompt compatibility.

**Tech Stack:** TypeScript, Node.js (Express), React, TailwindCSS.

---

### Task 1: Domain Type Definitions

**Files:**
- Modify: `agent-factory-dashboard/backend/src/domain/agent-factory.ts`
- Modify: `agent-factory-dashboard/frontend/src/types/agent-factory.ts`

- [ ] **Step 1: Add types to Backend Domain**
Append the new types to `agent-factory-dashboard/backend/src/domain/agent-factory.ts`.

```typescript
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

Also, update `AgentFactoryAduDraft` interface to include the new field:

```typescript
// Add inside AgentFactoryAduDraft
  question_answers?: AgentFactoryDraftQuestionAnswer[];
```

Also, update `CreateProjectAduInput` to include the new field:

```typescript
// Add inside CreateProjectAduInput
  clarifications?: AgentFactoryDraftQuestionAnswer[];
  sourceSummary?: string;
```

Also, update `AgentFactoryAdu` to include the new field:

```typescript
// Add inside AgentFactoryAdu
  clarifications?: AgentFactoryDraftQuestionAnswer[];
  source_summary?: string;
```

- [ ] **Step 2: Sync Types to Frontend**
Apply the exact same additions to `agent-factory-dashboard/frontend/src/types/agent-factory.ts`.

- [ ] **Step 3: Commit**

```bash
git add agent-factory-dashboard/backend/src/domain/agent-factory.ts agent-factory-dashboard/frontend/src/types/agent-factory.ts
git commit -m "feat(domain): add ADU intake question answers types"
```

---

### Task 2: Backend AduIntake Logic Updates

**Files:**
- Modify: `agent-factory-dashboard/backend/src/application/adu-intake.ts`

- [ ] **Step 1: Implement `normalizeQuestionAnswers`**
Add a private helper method inside the `AduIntake` class to handle backward compatibility.

```typescript
  private normalizeQuestionAnswers(draft: any): AgentFactoryDraftQuestionAnswer[] {
    const questions: string[] = draft.questions || [];
    let answers: AgentFactoryDraftQuestionAnswer[] = draft.question_answers || [];

    // Migrate simple string questions into the answers array if they don't exist
    for (const q of questions) {
      if (!answers.find(a => a.question === q)) {
        answers.push({
          question: q,
          answer: '',
          status: 'unanswered',
          impact: 'unknown'
        });
      }
    }
    return answers;
  }
```

- [ ] **Step 2: Update `getDraft`**
Modify `getDraft` to always return normalized answers.

```typescript
  async getDraft(draftId: string): Promise<{ meta: any, draft: AgentFactoryAduDraft | null }> {
      // ... existing code ...
      let draft = null;
      try {
          draft = JSON.parse(await fs.readFile(path.join(meta.repo_path, meta.draft_path), 'utf-8'));
          draft.question_answers = this.normalizeQuestionAnswers(draft);
      } catch (e) {}

      return { meta, draft };
  }
```

- [ ] **Step 3: Update `registerDraft` validation**
Modify `registerDraft` to enforce question resolution and construct the payload.

```typescript
  async registerDraft(draftId: string): Promise<{ adu_id: string }> {
      const { meta, draft } = await this.getDraft(draftId);
      // ... existing checks ...

      const questionAnswers = this.normalizeQuestionAnswers(draft);
      const unresolved = questionAnswers.filter(a => {
        if (a.status === 'unanswered') return true;
        if (a.status === 'answered' && (!a.answer || !a.answer.trim())) return true;
        return false;
      });

      if (unresolved.length > 0) {
        const err = new Error(`Draft has ${unresolved.length} unresolved question(s). Please answer them or defer to requirement analyst.`);
        (err as any).status = 409;
        throw err;
      }

      // Check for deferrals to enforce analysisReviewRequired
      const hasDeferral = questionAnswers.some(a => a.status === 'defer_to_requirement_analyst');
      const analysisReviewRequired = draft.analysisReviewRequired || hasDeferral;

      // Construct Goal summary
      let finalGoal = draft.goal;
      if (questionAnswers.length > 0) {
        let summary = "\\n\\n用户澄清问题：\\n";
        questionAnswers.forEach((qa, idx) => {
          summary += `${idx + 1}. 问题：${qa.question}\\n   处理：${qa.status}\\n   答案：${qa.answer || '无'}\\n   影响范围：${qa.impact}\\n`;
        });
        finalGoal += summary;
      }

      const createdAdu = await this.aduFactory.createForProject(meta.project_id, {
          // ... existing fields ...
          goal: finalGoal,
          sourceSummary: draft.source_summary,
          clarifications: questionAnswers,
          analysisReviewRequired: analysisReviewRequired,
          // ...
      });
      // ... rest of existing code ...
```
*(Ensure you update the parameter passing inside the `createForProject` block to match this new structure.)*

- [ ] **Step 4: Commit**

```bash
git add agent-factory-dashboard/backend/src/application/adu-intake.ts
git commit -m "feat(application): handle question normalization and registration blocks"
```

---

### Task 3: Backend ProjectAduFactory Update

**Files:**
- Modify: `agent-factory-dashboard/backend/src/application/project-adu-factory.ts`

- [ ] **Step 1: Ensure new fields are mapped to created ADU**
Update `createForProject` to map `clarifications` and `sourceSummary` from input to the final ADU object.

```typescript
// Inside createForProject, where newAdu is constructed:
    const newAdu: AgentFactoryAdu = {
      // ... existing fields ...
      clarifications: input.clarifications || [],
      source_summary: input.sourceSummary || '',
      // ... existing fields ...
    };
```

- [ ] **Step 2: Commit**

```bash
git add agent-factory-dashboard/backend/src/application/project-adu-factory.ts
git commit -m "feat(application): map clarifications to created ADU"
```

---

### Task 4: Frontend Question Answer Panel Component

**Files:**
- Create: `agent-factory-dashboard/frontend/src/components/intake/QuestionAnswerPanel.tsx`

- [ ] **Step 1: Create Component**

```tsx
import React from 'react';
import { AgentFactoryDraftQuestionAnswer } from '../../types/agent-factory';

interface Props {
  answers: AgentFactoryDraftQuestionAnswer[];
  onChange: (answers: AgentFactoryDraftQuestionAnswer[]) => void;
}

export const QuestionAnswerPanel: React.FC<Props> = ({ answers, onChange }) => {
  if (!answers || answers.length === 0) return null;

  const handleUpdate = (index: number, updates: Partial<AgentFactoryDraftQuestionAnswer>) => {
    const newAnswers = [...answers];
    newAnswers[index] = { ...newAnswers[index], ...updates };
    onChange(newAnswers);
  };

  return (
    <div className="space-y-4 mt-6">
      <h3 className="text-md font-semibold text-slate-200">待解决的问题 ({answers.length})</h3>
      {answers.map((ans, idx) => (
        <div key={idx} className="p-4 border border-slate-700 rounded-lg bg-slate-800/50 space-y-3">
          <p className="text-sm font-medium text-indigo-300">问题 {idx + 1}: {ans.question}</p>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">处理方式</label>
              <select 
                className="w-full p-1.5 text-sm bg-slate-900 border border-slate-700 rounded text-slate-200"
                value={ans.status}
                onChange={e => handleUpdate(idx, { status: e.target.value as any })}
              >
                <option value="unanswered">未处理 (Unanswered)</option>
                <option value="answered">已回答 (Answered)</option>
                <option value="defer_to_requirement_analyst">交给需求分析 Agent 建议</option>
                <option value="out_of_scope">不纳入本次 MVP (Out of Scope)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">影响范围</label>
              <select 
                className="w-full p-1.5 text-sm bg-slate-900 border border-slate-700 rounded text-slate-200"
                value={ans.impact}
                onChange={e => handleUpdate(idx, { impact: e.target.value as any })}
              >
                <option value="unknown">不确定 (Unknown)</option>
                <option value="scope">范围 (Scope)</option>
                <option value="acceptance_criteria">验收标准 (Acceptance Criteria)</option>
                <option value="design">设计 (Design)</option>
                <option value="implementation">实现 (Implementation)</option>
                <option value="test">测试 (Test)</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400">回答 / 说明</label>
            <textarea 
              className="w-full p-2 text-sm bg-slate-900 border border-slate-700 rounded text-slate-200"
              rows={2}
              value={ans.answer}
              onChange={e => handleUpdate(idx, { answer: e.target.value })}
              placeholder={ans.status === 'answered' ? "请输入明确答案..." : "选填补充说明..."}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add agent-factory-dashboard/frontend/src/components/intake/QuestionAnswerPanel.tsx
git commit -m "feat(ui): create QuestionAnswerPanel component"
```

---

### Task 5: Frontend Draft Review Step Integration

**Files:**
- Modify: `agent-factory-dashboard/frontend/src/components/intake/DraftReviewStep.tsx`

- [ ] **Step 1: Integrate `QuestionAnswerPanel`**
Import the new component and render it if questions exist. Also implement local client-side validation mirroring the backend logic to prevent bad API calls.

```tsx
// Imports at the top
import { QuestionAnswerPanel } from './QuestionAnswerPanel';

// Inside the component, update error state logic
    const [error, setError] = useState<string | null>(null);

    const handleRegister = async () => {
        setError(null);
        // Client side validation
        const unresolved = draft?.question_answers?.filter(a => 
          a.status === 'unanswered' || (a.status === 'answered' && !a.answer.trim())
        ) || [];
        
        if (unresolved.length > 0) {
            setError(`仍有 ${unresolved.length} 个问题未处理或未填写答案，请完善。`);
            return;
        }

        try {
            const result = await registerIntakeDraft(draftId);
            onRegistered(result.adu.id);
        } catch (e: any) {
            setError(e.message);
        }
    };

// Inside the return block, before the Register button
            {draft.question_answers && draft.question_answers.length > 0 && (
                <QuestionAnswerPanel 
                    answers={draft.question_answers} 
                    onChange={(newAnswers) => handleUpdate({ question_answers: newAnswers })}
                />
            )}
            
            {error && <div className="text-red-500 text-sm">{error}</div>}
```

- [ ] **Step 2: Commit**

```bash
git add agent-factory-dashboard/frontend/src/components/intake/DraftReviewStep.tsx
git commit -m "feat(ui): integrate QuestionAnswerPanel into DraftReviewStep"
```

---

### Task 6: Prompt Updates

**Files:**
- Modify: `.ai-agent/prompts/adu-intake-agent.md`
- Modify: `.ai-agent/prompts/requirement-analyst-agent.md`
- Modify: `.ai-agent/prompts/detail-designer-agent.md`
- Modify: `.ai-agent/prompts/contract-agent.md`

- [ ] **Step 1: Update Intake Prompt**
In `.ai-agent/prompts/adu-intake-agent.md`, add `"question_answers": []` to the JSON output structure and explicitly forbid the agent from answering.

```markdown
// Inside the rules section
6. You only generate questions. Do not attempt to answer them.
7. Output newly generated questions into the `questions` array. Output `question_answers: []` as an empty array.

// Inside the json output block
    "questions": [],
    "question_answers": [],
    "split_suggestions": [],
```

- [ ] **Step 2: Update Analyst Prompt**
In `.ai-agent/prompts/requirement-analyst-agent.md`, add instructions for reading `clarifications`.

```markdown
// Under the [ADU PAYLOAD] section, add:
Pay special attention to `clarifications` if present.
- For `answered` status: treat the answer as a strict factual constraint.
- For `defer_to_requirement_analyst` status: you MUST provide a concrete recommendation for this question in your analysis document and flag it for human review.
- For `out_of_scope` status: add it strictly to the Non-Goals/Out of Scope section.
```

- [ ] **Step 3: Update Designer & Contract Prompts**
In `.ai-agent/prompts/detail-designer-agent.md` and `.ai-agent/prompts/contract-agent.md`, add constraint instructions.

```markdown
// Under the [ADU PAYLOAD] section, add:
Pay special attention to `clarifications` if present.
- `answered` and `out_of_scope` items are absolute constraints. Do not contradict them.
- If a question was marked `defer_to_requirement_analyst`, ensure the requirement analysis document provided a clear resolution before you incorporate it. Do not guess.
```

- [ ] **Step 4: Commit**

```bash
git add .ai-agent/prompts/
git commit -m "feat(prompts): update agents to handle QA clarifications"
```

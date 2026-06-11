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
              value={ans.answer || ''}
              onChange={e => handleUpdate(idx, { answer: e.target.value })}
              placeholder={ans.status === 'answered' ? "请输入明确答案..." : "选填补充说明..."}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

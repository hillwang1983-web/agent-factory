import { useState, useEffect } from 'react';
import { agentFactoryApi } from '../../api/agentFactory';
import type { AgentFactoryAduView, AgentFactoryOperatorOverride } from '../../types/agent-factory';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

interface Props {
  adu: AgentFactoryAduView | null;
  latestRun: any | null;
  onApplied: () => void;
}

const REASON_OPTIONS: { value: AgentFactoryOperatorOverride['reason_code']; label: string }[] = [
  { value: 'agent_declaration_mismatch', label: 'Agent 声明与事实不符' },
  { value: 'validator_false_negative', label: 'Validator 误判' },
  { value: 'environment_verified', label: '环境已验证' },
  { value: 'manual_evidence_accepted', label: '人工确认证据有效' },
];

const AGENT_STATE_MAP: Record<string, string> = {
  'code-reviewer': 'code_reviewed',
  'buildfix-debugger': 'debugged',
  'acceptance-reviewer': 'acceptance_reviewed',
  'evidence': 'evidenced',
};

export function OperatorOverridePanel({ adu, latestRun, onApplied }: Props) {
  const [existingOverride, setExistingOverride] = useState<AgentFactoryOperatorOverride | null>(null);
  const [comment, setComment] = useState('');
  const [reasonCode, setReasonCode] = useState<AgentFactoryOperatorOverride['reason_code']>('agent_declaration_mismatch');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const agent = latestRun?.agent || '';
  const eligible = latestRun && latestRun.result !== 'success' && AGENT_STATE_MAP[agent];

  useEffect(() => {
    if (adu?.id) {
      agentFactoryApi.getRunOverrides(adu.id).then(res => {
        const ov = (res.overrides || []).find(o => o.run_timestamp === latestRun?.timestamp);
        if (ov) setExistingOverride(ov);
      }).catch(() => {});
    }
  }, [adu?.id, latestRun?.timestamp]);

  if (!eligible && !existingOverride) return null;

  const handleSubmit = async () => {
    setError('');
    if (comment.length < 10) { setError('说明至少 10 个字符'); return; }
    setLoading(true);
    try {
      await agentFactoryApi.applyRunOverride(adu!.id, latestRun.timestamp, {
        operation: 'accept_validator_result',
        to_result: 'success',
        to_state: AGENT_STATE_MAP[agent],
        reason_code: reasonCode,
        comment,
      });
      setSuccess(true);
      onApplied();
    } catch (e: any) {
      setError(e.message || '提交失败');
    } finally {
      setLoading(false);
    }
  };

  if (existingOverride) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="h-4 w-4 text-green-400" />
          <span className="text-xs font-semibold text-green-400">已存在 Operator Override</span>
        </div>
        <div className="text-xs text-slate-400 space-y-1">
          <div><span className="text-slate-500">ID: </span>{existingOverride.override_id}</div>
          <div><span className="text-slate-500">原结果: </span>{existingOverride.from_result} → {existingOverride.to_result}</div>
          <div><span className="text-slate-500">原因: </span>{existingOverride.reason_code}</div>
          <div><span className="text-slate-500">说明: </span>{existingOverride.comment}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-amber-800/50 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-semibold text-amber-400">Operator Override</span>
        <span className="text-[10px] text-slate-500 ml-auto">{agent} / {latestRun?.result}</span>
      </div>

      {error && <div className="text-[10px] text-red-400 mb-2">{error}</div>}
      {success && <div className="text-[10px] text-green-400 mb-2">Override 已提交</div>}

      <div className="flex flex-col gap-2 text-xs">
        <div>
          <label className="text-slate-500">原结果</label>
          <div className="text-slate-300 bg-slate-800 rounded px-2 py-1 mt-0.5">{latestRun?.result} (只读)</div>
        </div>

        <div>
          <label className="text-slate-500">将推进至</label>
          <div className="text-cyan-300 bg-slate-800 rounded px-2 py-1 mt-0.5">{AGENT_STATE_MAP[agent]} (自动)</div>
        </div>

        <div>
          <label className="text-slate-500">原因</label>
          <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value as any)}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 mt-0.5">
            {REASON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <label className="text-slate-500">说明 (10-4000 字符)</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)}
            rows={2}
            className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 mt-0.5 resize-none" />
        </div>

        <button onClick={handleSubmit} disabled={loading || comment.length < 10}
          className="flex items-center justify-center gap-1 px-3 py-1.5 text-xs rounded bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 mt-1">
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          提交 Override
        </button>
      </div>
    </div>
  );
}

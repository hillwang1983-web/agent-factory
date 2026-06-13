import { useState } from 'react';
import { ShieldAlert, Check, Loader2 } from 'lucide-react';
import { agentFactoryApi } from '../../api/agentFactory';

interface WaiverDecisionPanelProps {
  gateId: string;
  affectedAssertions?: string[];
  onSuccess: () => void;
  onCancel: () => void;
}

export function WaiverDecisionPanel({ gateId, affectedAssertions = [], onSuccess, onCancel }: WaiverDecisionPanelProps) {
  const [selectedAssertions, setSelectedAssertions] = useState<string[]>(affectedAssertions);
  const [waiverType, setWaiverType] = useState('environment_unavailable');
  const [reason, setReason] = useState('');
  const [risk, setRisk] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [operator, setOperator] = useState('local-operator');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleAssertion = (assId: string) => {
    setSelectedAssertions((current) =>
      current.includes(assId)
        ? current.filter((id) => id !== assId)
        : [...current, assId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedAssertions.length === 0) {
      setError('Please select at least one assertion to waive.');
      return;
    }
    if (!reason.trim()) {
      setError('Please specify the reason for the waiver.');
      return;
    }
    if (!risk.trim()) {
      setError('Please document the potential risks of this waiver.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await agentFactoryApi.approveWaiver(gateId, {
        assertion_ids: selectedAssertions,
        waiver_type: waiverType,
        reason: reason.trim(),
        risk: risk.trim(),
        follow_up: followUp.trim(),
        operator: operator.trim() || 'local-operator'
      });
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Failed to approve waiver');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center gap-2 text-blue-400 border-b border-slate-800 pb-2 mb-2">
        <ShieldAlert className="h-5 w-5" />
        <h4 className="font-bold text-sm">批准环境/设计豁免 (Approve Waiver)</h4>
      </div>

      {error && (
        <div className="p-3 bg-red-950/40 border border-red-800/60 rounded text-red-400 text-xs font-semibold">
          {error}
        </div>
      )}

      {/* Assertion list selector */}
      {affectedAssertions.length > 0 && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-400">选择受影响的契约断言 (Waiver Assertions):</label>
          <div className="flex flex-wrap gap-2 pt-1">
            {affectedAssertions.map((assId) => {
              const isSelected = selectedAssertions.includes(assId);
              return (
                <button
                  type="button"
                  key={assId}
                  onClick={() => toggleAssertion(assId)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border font-mono font-bold transition-all ${
                    isSelected
                      ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                      : 'bg-slate-950 border-slate-800 text-slate-500 hover:bg-slate-900'
                  }`}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                  {assId}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">豁免类型 (Waiver Type):</label>
          <select
            value={waiverType}
            onChange={(e) => setWaiverType(e.target.value)}
            className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="environment_unavailable">环境缺失 (Environment Unavailable)</option>
            <option value="design_deviation">设计偏离 (Design Deviation)</option>
            <option value="dependency_blocked">外部依赖阻塞 (Dependency Blocked)</option>
            <option value="other">其他 (Other)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">执行人 (Operator):</label>
          <input
            type="text"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="local-operator"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-400">豁免原因 (Waiver Reason):</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          rows={2}
          className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          placeholder="说明为什么需要豁免此项测试或断言。例如：本机无 Docker 及网元模拟环境，已人工审查开发代码确保逻辑正确。"
        />
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-400">引入的风险评估 (Risk Assessment):</label>
        <textarea
          value={risk}
          onChange={(e) => setRisk(e.target.value)}
          required
          rows={2}
          className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          placeholder="豁免推进可能会带来哪些潜在缺陷或影响？"
        />
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-400">跟进计划与验证安排 (Follow-up Actions):</label>
        <textarea
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          rows={2}
          className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          placeholder="后续在何种环境或何时重新补齐该验证？例如：在 Staging 环境发布前跑集成单测。"
        />
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 border border-slate-800 bg-slate-950 text-slate-400 text-xs font-semibold rounded hover:bg-slate-900 transition-colors"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={loading || selectedAssertions.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded disabled:opacity-50 transition-colors shadow-lg shadow-blue-900/20"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span>确立豁免并提交</span>
          )}
        </button>
      </div>
    </form>
  );
}

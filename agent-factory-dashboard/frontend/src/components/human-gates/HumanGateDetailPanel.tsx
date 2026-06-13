import { useState } from 'react';
import { X, UserCheck, Calendar, FileCheck2, Loader2 } from 'lucide-react';
import type { HumanGate } from '../../types/agent-factory';
import { EnvironmentVerificationPanel } from './EnvironmentVerificationPanel';
import { agentFactoryApi } from '../../api/agentFactory';

interface HumanGateDetailPanelProps {
  gate: HumanGate;
  onClose: () => void;
  onRefresh: () => void;
}

export function HumanGateDetailPanel({ gate, onClose, onRefresh }: HumanGateDetailPanelProps) {
  const [loading, setLoading] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSimpleApprove = async () => {
    setLoading(true);
    setError(null);
    try {
      await agentFactoryApi.approveGate(gate.gate_id, comment.trim() || undefined);
      onRefresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to approve gate');
    } finally {
      setLoading(false);
    }
  };

  const handleSimpleCancel = async () => {
    setLoading(true);
    setError(null);
    try {
      await agentFactoryApi.cancelGate(gate.gate_id, comment.trim() || 'Canceled by user');
      onRefresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel gate');
    } finally {
      setLoading(false);
    }
  };

  const isEnvironmentGate = gate.gate_type === 'environment_verification_required';
  const isPending = gate.status === 'pending';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 relative">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition-colors"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="flex items-center gap-3 border-b border-slate-800 pb-4 mb-4">
        <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-amber-400">
          <UserCheck className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-white leading-tight">{gate.title}</h3>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400 font-medium">
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {new Date(gate.created_at).toLocaleString()}
            </span>
            <span>•</span>
            <span className="font-mono">{gate.gate_id}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-950/40 border border-red-800/60 rounded text-red-400 text-xs font-semibold mb-4">
          {error}
        </div>
      )}

      {/* Metadata grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-950/40 p-4 rounded-lg border border-slate-850 mb-6 text-xs">
        <div>
          <div className="text-slate-500 font-medium uppercase tracking-wider mb-1">控制范围</div>
          <div className="font-bold text-slate-200 capitalize">{gate.scope}</div>
        </div>
        <div>
          <div className="text-slate-500 font-medium uppercase tracking-wider mb-1">目标对象</div>
          <div className="font-mono font-bold text-indigo-400">{gate.target_id}</div>
        </div>
        <div>
          <div className="text-slate-500 font-medium uppercase tracking-wider mb-1">前置状态</div>
          <div className="font-mono font-bold text-pink-400">{gate.pre_gate_state}</div>
        </div>
        <div>
          <div className="text-slate-500 font-medium uppercase tracking-wider mb-1">当前状态</div>
          <div>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
              gate.status === 'pending'
                ? 'bg-amber-500/20 text-amber-300'
                : gate.status === 'approved' || gate.status === 'resolved'
                ? 'bg-emerald-500/20 text-emerald-300'
                : gate.status === 'waived'
                ? 'bg-blue-500/20 text-blue-300'
                : 'bg-slate-800 text-slate-400'
            }`}>
              {gate.status}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">门禁触发原因</h4>
          <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3 rounded border border-slate-800/80">
            {gate.reason}
          </p>
        </div>

        {gate.affected_assertions && gate.affected_assertions.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">受影响的规约断言</h4>
            <div className="flex flex-wrap gap-2">
              {gate.affected_assertions.map((ass) => (
                <span key={ass} className="px-2 py-1 rounded bg-slate-800/80 border border-slate-700 text-slate-300 font-mono text-[10px] font-bold">
                  {ass}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action Decision Form */}
      {isPending ? (
        <div className="border-t border-slate-800 pt-6">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4">决策处理中心</h4>
          {isEnvironmentGate ? (
            <EnvironmentVerificationPanel
              gateId={gate.gate_id}
              affectedAssertions={gate.affected_assertions}
              onSuccess={onRefresh}
              onCancel={onClose}
            />
          ) : (
            <div className="space-y-4 bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-400">处理备注 (Comment/Feedback):</label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded p-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                  placeholder="填写通过或驳回的审批意见。"
                />
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={handleSimpleCancel}
                  disabled={loading}
                  className="px-4 py-2 border border-slate-800 bg-slate-950 text-slate-400 text-xs font-semibold rounded hover:bg-slate-900 transition-colors"
                >
                  放弃/关闭 (Cancel)
                </button>
                <button
                  type="button"
                  onClick={handleSimpleApprove}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded disabled:opacity-50 transition-colors shadow-lg shadow-emerald-900/20"
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span>批准通过 (Approve)</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="border-t border-slate-800 pt-6 bg-slate-950/20 p-4 rounded-lg border border-dashed border-slate-800 text-xs text-slate-400 space-y-2">
          <div className="flex items-center gap-1.5 font-bold text-slate-300">
            <FileCheck2 className="h-4 w-4 text-emerald-400" />
            <span>此质量门已于 {gate.resolved_at ? new Date(gate.resolved_at).toLocaleString() : '未知时间'} 完成处置</span>
          </div>
          {gate.resolution && (
            <div className="font-mono bg-black/30 p-2.5 rounded border border-slate-900 overflow-x-auto">
              {JSON.stringify(gate.resolution, null, 2)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

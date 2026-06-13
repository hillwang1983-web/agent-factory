import { useEffect, useState } from 'react';
import { FolderInput, ShieldAlert, Check, X, Clock, AlertTriangle, MessageSquare } from 'lucide-react';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { agentFactoryApi } from '../../api/agentFactory';

interface WritePathExpansionPanelProps {
  aduId: string;
}

export function WritePathExpansionPanel({ aduId }: WritePathExpansionPanelProps): JSX.Element {
  const { dashboard, refresh } = useAgentFactoryStore();
  const controlEnabled = useAgentFactoryStore((s) => (s as any).controlEnabled !== false);

  const adu = dashboard?.adus.find((a) => a.id === aduId);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);

  const loadRequests = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentFactoryApi.fetchWritePathExpansions(aduId);
      setRequests(data.requests || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || '获取写入路径变更申请失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRequests();
  }, [aduId]);

  if (!adu) return <></>;

  const handleApprove = async (requestId: string) => {
    setActionId(requestId);
    setError(null);
    try {
      await agentFactoryApi.approveWritePathExpansion(aduId, requestId, comment);
      setComment('');
      await loadRequests();
      await refresh();
    } catch (err: any) {
      console.error(err);
      setError(err.message || '批准变更失败');
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (requestId: string) => {
    setActionId(requestId);
    setError(null);
    try {
      await agentFactoryApi.rejectWritePathExpansion(aduId, requestId, comment);
      setComment('');
      await loadRequests();
      await refresh();
    } catch (err: any) {
      console.error(err);
      setError(err.message || '拒绝变更失败');
    } finally {
      setActionId(null);
    }
  };

  const isWritePathGate = adu.state === 'human_gate' && adu.gate_type === 'write_path_expansion';
  const pendingRequests = requests.filter((r) => r.decision === 'pending_human_approval');
  const historyRequests = requests.filter((r) => r.decision !== 'pending_human_approval');

  return (
    <div className="space-y-6">
      {/* Human Gate Alert */}
      {isWritePathGate && (
        <div className="nms-card bg-nms-surface-1 border-amber-500/20 p-5 space-y-4 shadow-[0_0_15px_rgba(245,158,11,0.05)]">
          <div className="flex items-center gap-2 border-b border-nms-surface-2 pb-3">
            <ShieldAlert className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="text-sm font-bold text-nms-text">写入路径扩充审批门开启</h3>
              <p className="text-xs text-nms-text-dim mt-0.5">运行已暂停：开发 Agent 申请写入当前 ADU 范围外的文件路径</p>
            </div>
          </div>

          {error && <div className="text-xs text-red-400 font-semibold">{error}</div>}

          {pendingRequests.length === 0 ? (
            <div className="text-xs text-nms-text-dim">
              未找到挂起的变更申请。可能需要手动干预，或稍后重试。
            </div>
          ) : (
            <div className="space-y-4">
              {pendingRequests.map((req) => (
                <div key={req.request_id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs font-bold text-amber-300 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> 申请扩充写入路径（风险评级: {req.risk || 'medium'}）
                      </div>
                      <p className="text-[11px] text-nms-text-dim mt-1">
                        申请时间: {new Date(req.created_at).toLocaleString()} | 申请人/Agent: {req.source_agent}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-nms-text">申请扩充的路径列表：</div>
                    <div className="bg-nms-bg/50 p-2.5 rounded border border-nms-surface-2 font-mono text-[11px] text-nms-text-dim space-y-1">
                      {req.requested_paths.map((p: string) => (
                        <div key={p} className="flex items-center gap-1.5 text-amber-200">
                          <FolderInput className="w-3.5 h-3.5 shrink-0" /> {p}
                        </div>
                      ))}
                    </div>
                  </div>

                  {req.reason && (
                    <div className="text-xs text-nms-text leading-relaxed">
                      <span className="font-semibold">判定原因:</span> {req.reason}
                    </div>
                  )}

                  <div className="space-y-2.5 pt-2">
                    <div>
                      <label className="block text-xs font-semibold text-nms-text mb-1">
                        审批意见 (Comments)
                      </label>
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        className="w-full h-16 bg-nms-bg text-nms-text text-xs p-2.5 rounded-lg border border-nms-surface-2 focus:ring-1 focus:ring-nms-accent focus:outline-none resize-none leading-relaxed"
                        placeholder="请输入审批或拒绝意见..."
                      />
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={() => void handleApprove(req.request_id)}
                        disabled={loading || actionId !== null || !controlEnabled}
                        className="nms-btn-primary flex items-center gap-1.5 text-xs py-1.5 px-3.5"
                      >
                        <Check className="w-4 h-4" /> 批准通过 (Approve)
                      </button>
                      <button
                        onClick={() => void handleReject(req.request_id)}
                        disabled={loading || actionId !== null || !controlEnabled}
                        className="nms-btn-danger flex items-center gap-1.5 text-xs py-1.5 px-3.5"
                      >
                        <X className="w-4 h-4" /> 拒绝申请 (Reject)
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Requests History List */}
      <div className="nms-card bg-nms-surface-1 border-nms-surface-2 p-5 space-y-4">
        <div className="flex justify-between items-center border-b border-nms-surface-2 pb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-nms-text-dim" />
            <h3 className="text-sm font-semibold text-nms-text">写入路径扩充记录</h3>
          </div>
          <button
            onClick={() => void loadRequests()}
            disabled={loading}
            className="text-xs text-nms-accent hover:underline"
          >
            刷新记录
          </button>
        </div>

        {loading && requests.length === 0 ? (
          <div className="text-xs text-nms-text-dim text-center py-4">加载中...</div>
        ) : historyRequests.length === 0 ? (
          <div className="text-xs text-nms-text-dim text-center py-4">暂无路径扩充记录</div>
        ) : (
          <div className="space-y-4">
            {/* Active approved/other entries */}
            {historyRequests.map((req) => (
              <div key={req.request_id} className="text-xs border-b border-nms-surface-2/50 pb-3 last:border-0 last:pb-0 space-y-1.5">
                <div className="flex justify-between items-start">
                  <div className="font-semibold text-nms-text flex items-center gap-1.5">
                    {req.decision === 'approved' || req.decision === 'auto_approved' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-green-500/10 text-green-400 border border-green-500/20">
                        已批准
                      </span>
                    ) : req.decision === 'rejected' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 border border-red-500/20">
                        已拒绝
                      </span>
                    ) : req.decision === 'blocked' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-900/20 text-red-300 border border-red-900/40">
                        已阻断
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        待审批
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-nms-text-dim">ID: {req.request_id}</span>
                  </div>
                  <span className="text-[10px] text-nms-text-dim">
                    {new Date(req.created_at).toLocaleString()}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-nms-text-dim block text-[10px] font-semibold">请求的写入路径：</span>
                    <div className="bg-nms-bg/30 p-1.5 rounded font-mono text-[10px] space-y-0.5">
                      {req.requested_paths.map((p: string) => (
                        <div key={p} className="truncate">{p}</div>
                      ))}
                    </div>
                  </div>

                  {(req.decision === 'approved' || req.decision === 'auto_approved') && req.approved_paths?.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-green-400/80 block text-[10px] font-semibold">已批准写入路径：</span>
                      <div className="bg-green-500/5 p-1.5 rounded font-mono text-[10px] text-green-300/80 space-y-0.5 border border-green-500/10">
                        {req.approved_paths.map((p: string) => (
                          <div key={p} className="truncate">{p}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {req.reason && (
                  <div className="text-[11px] text-nms-text leading-relaxed">
                    <span className="text-nms-text-dim">判定原因:</span> {req.reason}
                  </div>
                )}

                {req.comment && (
                  <div className="text-[11px] text-nms-text bg-nms-bg/30 p-2 rounded-lg border border-nms-surface-2/65 flex gap-1.5 items-start mt-1">
                    <MessageSquare className="w-3.5 h-3.5 text-nms-text-dim shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-nms-text-dim">审批意见:</span> {req.comment}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

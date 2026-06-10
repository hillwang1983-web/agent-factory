import { useState } from 'react';
import { ShieldCheck, MessageSquare, CornerUpLeft, History, CheckCircle, AlertOctagon } from 'lucide-react';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { EditableArtifactTabs } from './EditableArtifactTabs';
import { MarkdownArtifactEditor } from './MarkdownArtifactEditor';

interface ReviewGatePanelProps {
  aduId: string;
}

export function ReviewGatePanel({ aduId }: ReviewGatePanelProps): JSX.Element {
  const {
    dashboard,
    reviews,
    approveReview,
    requestReviewRework
  } = useAgentFactoryStore();

  const controlEnabled = useAgentFactoryStore((s) => (s as any).controlEnabled !== false);

  const adu = dashboard?.adus.find((a) => a.id === aduId);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!adu) return <></>;

  const isReviewGate = adu.state === 'analysis_review' || adu.state === 'design_review';
  const gate: 'analysis' | 'design' = adu.state === 'analysis_review' ? 'analysis' : 'design';

  const handleApprove = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await approveReview(aduId, gate, comment);
      setComment('');
    } catch (e) {
      console.error(e);
      setError((e as Error).message || '审批通过失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRework = async () => {
    if (!comment.trim()) {
      setError('要求返工必须填写原因（comment）');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await requestReviewRework(aduId, gate, comment);
      setComment('');
    } catch (e) {
      console.error(e);
      setError((e as Error).message || '提交返工请求失败');
    } finally {
      setSubmitting(false);
    }
  };

  const gateLabel = gate === 'analysis' ? '需求分析审核' : '详细设计审核';

  return (
    <div className="space-y-6">
      {/* Document Edit & View Section */}
      <div className="nms-card bg-nms-surface-1 border-nms-surface-2 p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-nms-text">过程文档在线编辑与审核</h3>
          <p className="text-xs text-nms-text-dim mt-0.5">查看和修改当前 ADU 的需求规格及设计说明</p>
        </div>

        <EditableArtifactTabs />
        <MarkdownArtifactEditor aduId={aduId} />
      </div>

      {/* Review Gate Controls */}
      {isReviewGate && (
        <div className="nms-card bg-nms-surface-1 border-amber-500/20 p-5 space-y-4 shadow-[0_0_15px_rgba(245,158,11,0.05)]">
          <div className="flex items-center gap-2 border-b border-nms-surface-2 pb-3">
            <ShieldCheck className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="text-sm font-bold text-nms-text">{gateLabel}门已开启</h3>
              <p className="text-xs text-nms-text-dim mt-0.5">Orchestrator 暂停中，等待人工确认文档并批准</p>
            </div>
          </div>

          {error && <div className="text-xs text-red-400 font-semibold">{error}</div>}

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-nms-text mb-1">
                审核/返工意见 (Comments)
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full h-20 bg-nms-bg text-nms-text text-xs p-3 rounded-lg border border-nms-surface-2 focus:ring-1 focus:ring-nms-accent focus:outline-none resize-none leading-relaxed"
                placeholder={
                  gate === 'analysis'
                    ? "例如：需求分析确认无误，符合规范 / 边界条件缺失，请补充异常链路检测场景..."
                    : "例如：设计合理，契约定义清晰 / 接口参数命名不一致，请返工修正..."
                }
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => void handleApprove()}
                disabled={submitting || !controlEnabled}
                className="nms-btn-primary flex items-center gap-1.5 text-xs py-2 px-4"
              >
                <CheckCircle className="w-4 h-4" /> 批准通过 (Approve)
              </button>
              <button
                onClick={() => void handleRework()}
                disabled={submitting || !controlEnabled}
                className="nms-btn-danger flex items-center gap-1.5 text-xs py-2 px-4"
              >
                <CornerUpLeft className="w-4 h-4" /> 要求返工 (Request Rework)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Gate Audit Logs History */}
      {reviews.length > 0 && (
        <div className="nms-card bg-nms-surface-1 border-nms-surface-2 p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-nms-surface-2 pb-3">
            <History className="w-4 h-4 text-nms-text-dim" />
            <h3 className="text-sm font-semibold text-nms-text">审核与流转日志</h3>
          </div>

          <div className="flow-root">
            <ul className="-mb-8">
              {reviews.map((rev, revIdx) => {
                const isApproved = rev.status === 'approved';
                const statusBadgeClasses = isApproved
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                  : 'bg-red-500/10 border border-red-500/20 text-red-400';

                return (
                  <li key={rev.review_id}>
                    <div className="relative pb-8">
                      {revIdx !== reviews.length - 1 && (
                        <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-nms-surface-2" aria-hidden="true" />
                      )}
                      <div className="relative flex space-x-3 items-start">
                        <div>
                          <span className={`h-8 w-8 rounded-full flex items-center justify-center ring-4 ring-nms-bg ${
                            isApproved ? 'bg-emerald-500/20' : 'bg-red-500/20'
                          }`}>
                            {isApproved ? (
                              <CheckCircle className="h-4 w-4 text-emerald-400" />
                            ) : (
                              <AlertOctagon className="h-4 w-4 text-red-400" />
                            )}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-nms-text-dim flex items-center justify-between gap-2">
                            <div>
                              <span className="font-semibold text-nms-text">{rev.approved_by || 'Anonymous'}</span>
                              <span className="mx-1">在</span>
                              <span className="font-bold text-nms-accent">
                                {rev.gate === 'analysis' ? '需求门' : '设计门'}
                              </span>
                              <span className="mx-1">提交了状态</span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${statusBadgeClasses}`}>
                                {isApproved ? '已批准' : '要求返工'}
                              </span>
                            </div>
                            <span className="text-[10px] text-nms-text-dim/60 font-mono">
                              {new Date(rev.created_at).toLocaleString()}
                            </span>
                          </div>
                          {rev.comment && (
                            <div className="mt-2 text-xs text-nms-text bg-nms-surface-2/30 p-2.5 rounded border border-nms-surface-2 leading-relaxed">
                              <div className="text-[10px] uppercase font-bold text-nms-text-dim/60 mb-0.5 flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" /> 批注说明
                              </div>
                              {rev.comment}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

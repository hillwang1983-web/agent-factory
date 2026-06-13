import { useEffect, useState } from 'react';
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
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionSubmitting, setQuestionSubmitting] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (adu?.clarification_questions) {
      const initial: Record<string, string> = {};
      adu.clarification_questions.forEach((q) => {
        initial[q.id] = q.answer || '';
      });
      setAnswers(initial);
    }
  }, [adu]);

  if (!adu) return <></>;

  const isReviewGate = adu.state === 'analysis_review' || adu.state === 'design_review';
  const gate: 'analysis' | 'design' = adu.state === 'analysis_review' ? 'analysis' : 'design';

  const hasPendingBlockingQuestions = (adu.clarification_questions || []).some(
    (q: any) => q.blocking && q.status === 'pending'
  );

  const handleAnswerQuestion = async (qId: string, status: 'answered' | 'deferred' | 'pending') => {
    setQuestionSubmitting((prev) => ({ ...prev, [qId]: true }));
    setError(null);
    try {
      const answerText = answers[qId] || '';
      if (status === 'answered' && !answerText.trim()) {
        setError('回答内容不能为空');
        return;
      }
      await useAgentFactoryStore.getState().answerClarification(aduId, qId, answerText, status);
    } catch (e: any) {
      setError(e.message || '提交回答失败');
    } finally {
      setQuestionSubmitting((prev) => ({ ...prev, [qId]: false }));
    }
  };

  const handleApprove = async () => {
    if (gate === 'analysis' && hasPendingBlockingQuestions) {
      setError('存在未解答的阻塞性澄清问题，请先解答或延期。');
      return;
    }
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
      await requestReviewRework(aduId, gate, comment.trim());
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

          {gate === 'analysis' && adu.clarification_questions && adu.clarification_questions.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-4">
              <div>
                <div className="text-xs font-bold text-amber-300">检测到待澄清问题 (Clarification Questions)</div>
                <p className="text-[11px] text-nms-text-dim mt-1">
                  必须解决所有 [阻塞] 状态的问题，才能批准需求通过。您的回答将被持久化并在下次执行时作为 Agent 的上下文约束。
                </p>
              </div>
              <div className="space-y-4">
                {adu.clarification_questions.map((q: any) => {
                  const isPending = q.status === 'pending';
                  const isAnswered = q.status === 'answered';
                  const isDeferred = q.status === 'deferred';

                  return (
                    <div key={q.id} className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs text-slate-200 font-medium leading-relaxed">
                          <span className="font-mono text-cyan-400 mr-1.5">[{q.id}]</span>
                          {q.question}
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0">
                          {q.blocking && (
                            <span className="px-1.5 py-0.5 rounded bg-red-950/40 border border-red-500/20 text-red-400 text-[10px] font-semibold">
                              阻塞
                            </span>
                          )}
                          {!q.blocking && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 text-[10px]">
                              可选
                            </span>
                          )}
                          {isAnswered && (
                            <span className="px-1.5 py-0.5 rounded bg-green-950/40 border border-green-500/20 text-green-400 text-[10px] font-semibold">
                              已解答
                            </span>
                          )}
                          {isDeferred && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-500/20 text-amber-400 text-[10px] font-semibold">
                              已延期
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Editing / Answering field */}
                      {isPending ? (
                        <div className="space-y-2">
                          <textarea
                            value={answers[q.id] || ''}
                            onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                            className="w-full h-16 bg-slate-950 text-slate-100 text-xs p-2.5 rounded border border-slate-800 focus:ring-1 focus:ring-amber-500 focus:outline-none resize-none"
                            placeholder="请提供明确、具体的事实答案作为后续步骤的硬性约束..."
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              disabled={questionSubmitting[q.id]}
                              onClick={() => void handleAnswerQuestion(q.id, 'deferred')}
                              className="px-2.5 py-1 rounded border border-amber-500/30 text-amber-400 text-[10px] font-semibold hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                            >
                              延期处理 (Defer)
                            </button>
                            <button
                              disabled={questionSubmitting[q.id] || !(answers[q.id] || '').trim()}
                              onClick={() => void handleAnswerQuestion(q.id, 'answered')}
                              className="px-2.5 py-1 rounded bg-amber-600 text-white text-[10px] font-bold hover:bg-amber-500 transition-colors disabled:opacity-50"
                            >
                              {questionSubmitting[q.id] ? '提交中...' : '提交回答'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2 pt-1 border-t border-slate-800/40">
                          {q.answer && (
                            <blockquote className="border-l-2 border-slate-700 pl-2.5 py-0.5 text-xs text-slate-400 italic">
                              {q.answer}
                            </blockquote>
                          )}
                          <div className="flex justify-end">
                            <button
                              onClick={() => {
                                // Put back to pending state in UI so user can edit
                                void handleAnswerQuestion(q.id, 'pending');
                              }}
                              className="text-[10px] text-cyan-400 hover:text-cyan-300 font-semibold underline"
                            >
                              修改回答
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
                disabled={submitting || !controlEnabled || (gate === 'analysis' && hasPendingBlockingQuestions)}
                className="nms-btn-primary flex items-center gap-1.5 text-xs py-2 px-4 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CheckCircle className="w-4 h-4" /> 批准通过 (Approve)
              </button>
              <button
                onClick={() => void handleRework()}
                disabled={submitting || !controlEnabled}
                className="nms-btn-danger flex items-center gap-1.5 text-xs py-2 px-4"
              >
                <CornerUpLeft className="w-4 h-4" /> {(adu.clarification_questions || []).length > 0 ? '提交澄清并要求返工' : '要求返工 (Request Rework)'}
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

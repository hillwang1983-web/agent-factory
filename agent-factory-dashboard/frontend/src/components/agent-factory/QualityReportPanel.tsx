import { useState, useEffect } from 'react';
import type { AgentFactoryAduView } from '../../types/agent-factory';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { agentFactoryApi } from '../../api/agentFactory';
import { ShieldCheck, Code, Award, AlertTriangle, FileText, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface QualityReportPanelProps {
  adu: AgentFactoryAduView;
}

type TabType = 'contract' | 'code-review' | 'acceptance';

export function QualityReportPanel({ adu }: QualityReportPanelProps): JSX.Element {
  const { qualityReports, loadQualityReports } = useAgentFactoryStore();
  const [activeTab, setActiveTab] = useState<TabType>('contract');
  const [reportDetail, setReportDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Sync reports summary when ADU changes
  useEffect(() => {
    void loadQualityReports(adu.id);
    setReportDetail(null);
    setLoadError(null);
  }, [adu.id, loadQualityReports]);

  // Extract stable primitive values so the detail-loading effect only re-runs
  // when something actually changes — not on every poll cycle that creates a
  // new qualityReports object reference with identical content.
  const codeReviewExists = qualityReports?.codeReview.exists ?? false;
  const codeReviewPath = qualityReports?.codeReview.path ?? '';
  const acceptanceReviewExists = qualityReports?.acceptanceReview.exists ?? false;
  const acceptanceReviewPath = qualityReports?.acceptanceReview.path ?? '';

  // Load detailed json content depending on active tab
  useEffect(() => {
    let targetPath = '';
    if (activeTab === 'code-review' && codeReviewExists) {
      targetPath = codeReviewPath;
    } else if (activeTab === 'acceptance' && acceptanceReviewExists) {
      targetPath = acceptanceReviewPath;
    } else {
      setReportDetail(null);
      setLoadError(null);
      return;
    }

    let isSubscribed = true;
    const loadDetail = async () => {
      setLoadingDetail(true);
      setLoadError(null);
      try {
        // Pass adu.id so the backend resolves the path relative to the
        // project's repo_path instead of the global workspace root.
        const res = await agentFactoryApi.fetchAgentFactoryArtifact(targetPath, 200000, adu.id);
        if (isSubscribed) {
          try {
            const parsed = JSON.parse(res.content);
            setReportDetail(parsed);
          } catch {
            setLoadError('报告文件存在但 JSON 格式无效，请检查文件内容。');
            setReportDetail(null);
          }
        }
      } catch (err) {
        if (isSubscribed) {
          const msg = (err as Error).message ?? '';
          if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
            setLoadError('报告文件尚未生成或路径不存在，请等待对应 Agent 步骤完成后刷新。');
          } else {
            setLoadError(`未能读取报告数据：${msg}`);
          }
          setReportDetail(null);
        }
      } finally {
        if (isSubscribed) {
          setLoadingDetail(false);
        }
      }
    };

    void loadDetail();

    return () => {
      isSubscribed = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, adu.id, codeReviewExists, codeReviewPath, acceptanceReviewExists, acceptanceReviewPath]);

  if (!qualityReports) {
    return (
      <div className="nms-card bg-nms-surface-1 border-nms-surface-2 p-5 text-center text-xs text-nms-text-dim">
        正在拉取 ADU 质量报告概要...
      </div>
    );
  }

  const { contract, codeReview, acceptanceReview } = qualityReports;

  return (
    <div className="nms-card bg-nms-surface-1 border-nms-surface-2 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-nms-text">品质控制质量门 (Quality Gates)</h3>
          <p className="text-xs text-nms-text-dim mt-0.5">硬验收契约、双层 Agent 代码/最终验收评估结果</p>
        </div>

        {/* Rework indicators */}
        {(adu.state === 'code_rework' || adu.state === 'build_rework' || adu.state === 'acceptance_rework') && (
          <div className={`flex items-center gap-1.5 border px-2.5 py-1 rounded text-[10px] ${
            adu.health?.status === 'running'
              ? 'bg-blue-950/40 border-blue-500/30 text-blue-400 animate-pulse'
              : 'bg-amber-950/40 border-amber-500/30 text-amber-400'
          }`}>
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>
              {adu.health?.status === 'running'
                ? '整改执行中 (@developer)'
                : adu.state === 'build_rework'
                  ? '调试失败待整改 — 点击「单步执行」或「继续自动」触发 developer'
                  : '待整改 — 点击「单步执行」或「继续自动」触发 developer'}
            </span>
            {adu.review_counters && (
              <span className="font-mono ml-0.5">
                (重试: {adu.state === 'code_rework'
                  ? adu.review_counters.code_review_failures
                  : adu.state === 'build_rework'
                    ? (adu.review_counters.buildfix_failures ?? 0)
                    : adu.review_counters.acceptance_review_failures}/{adu.state === 'build_rework'
                  ? (adu.review_limits?.max_buildfix_failures ?? 5)
                  : adu.state === 'code_rework'
                    ? (adu.review_limits?.max_code_review_failures ?? 5)
                    : (adu.review_limits?.max_acceptance_review_failures ?? 5)})
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-nms-surface-3/30 gap-1">
        <button
          onClick={() => setActiveTab('contract')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 font-medium transition-colors ${
            activeTab === 'contract'
              ? 'border-nms-accent text-nms-accent font-semibold'
              : 'border-transparent text-nms-text-dim hover:text-nms-text hover:border-nms-surface-3'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>硬验收契约</span>
          <span className={`text-[9px] px-1 rounded-full ${contract.exists ? (contract.valid ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400') : 'bg-nms-surface-2 text-nms-text-dim/50'}`}>
            {contract.exists ? (contract.valid ? '有效' : '旧版') : '无'}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('code-review')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 font-medium transition-colors ${
            activeTab === 'code-review'
              ? 'border-nms-accent text-nms-accent font-semibold'
              : 'border-transparent text-nms-text-dim hover:text-nms-text hover:border-nms-surface-3'
          }`}
        >
          <Code className="w-3.5 h-3.5" />
          <span>代码评审 (CR)</span>
          <span className={`text-[9px] px-1 rounded-full ${
            codeReview.exists
              ? (codeReview.status === 'pass'
                  ? (codeReview.valid !== false ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400')
                  : 'bg-red-500/10 text-red-400')
              : 'bg-nms-surface-2 text-nms-text-dim/50'
          }`}>
            {codeReview.exists ? (codeReview.status === 'pass' ? (codeReview.valid !== false ? '通过' : '通过(无效)') : '未通过') : '无'}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('acceptance')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 font-medium transition-colors ${
            activeTab === 'acceptance'
              ? 'border-nms-accent text-nms-accent font-semibold'
              : 'border-transparent text-nms-text-dim hover:text-nms-text hover:border-nms-surface-3'
          }`}
        >
          <Award className="w-3.5 h-3.5" />
          <span>验收审计 (AR)</span>
          <span className={`text-[9px] px-1 rounded-full ${
            acceptanceReview.exists
              ? (acceptanceReview.status === 'pass'
                  ? (acceptanceReview.valid !== false ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400')
                  : 'bg-red-500/10 text-red-400')
              : 'bg-nms-surface-2 text-nms-text-dim/50'
          }`}>
            {acceptanceReview.exists ? (acceptanceReview.status === 'pass' ? (acceptanceReview.valid !== false ? '通过' : '通过(无效)') : '未通过') : '无'}
          </span>
        </button>
      </div>

      {/* Tab Contents */}
      <div className="min-h-[160px] pt-1">
        {/* CONTRACT TAB */}
        {activeTab === 'contract' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 bg-nms-surface-2/30 border border-nms-surface-3/20 p-3 rounded-lg">
              <FileText className="w-4 h-4 text-nms-accent flex-shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <div className="font-semibold text-nms-text">契约配置信息</div>
                <div className="text-nms-text-dim/80 font-mono text-[10px] break-all">路径: {contract.path}</div>
                <div className="text-nms-text-dim mt-2">
                  {contract.exists ? (
                    contract.valid ? (
                      <span className="text-emerald-400">已部署符合 v2 要求的硬验收契约。断言、负向阻断与自动化验证命令处于受控状态。</span>
                    ) : (
                      <span className="text-amber-400 font-medium">当前为 v1 简版契约。建议通过 contract Agent 重新运行以生成硬验收断言。</span>
                    )
                  ) : (
                    <span className="text-nms-text-dim/50">当前 ADU 尚未进入 contracted 阶段或未产出契约文件。</span>
                  )}
                </div>
              </div>
            </div>

            {contract.exists && (
              <div className="text-xs text-nms-text-dim bg-nms-surface-2/20 border border-nms-surface-3/10 p-3 rounded-lg">
                可前往 <span className="font-mono text-nms-text bg-nms-surface-3/40 px-1 py-0.5 rounded">Artifacts</span> 面板浏览完整的配置断言 JSON 及中文的 <span className="font-mono text-nms-text bg-nms-surface-3/40 px-1 py-0.5 rounded">{adu.id}-notes.md</span> 契约备忘说明。
              </div>
            )}
          </div>
        )}

        {/* LOADING DETAIL */}
        {loadingDetail && (
          <div className="flex flex-col items-center justify-center py-12 text-xs text-nms-text-dim space-y-2">
            <Loader2 className="w-5 h-5 text-nms-accent animate-spin" />
            <span>读取质量评审报告中...</span>
          </div>
        )}

        {/* LOAD ERROR */}
        {loadError && (
          <div className="flex items-center gap-2 bg-red-950/20 border border-red-500/20 p-4 rounded-lg text-xs text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {/* CODE REVIEW TAB */}
        {activeTab === 'code-review' && !loadingDetail && !loadError && (
          <div className="space-y-4">
            {!codeReview.exists ? (
              <div className="text-center py-10 text-xs text-nms-text-dim/50 border border-dashed border-nms-surface-3/20 rounded-lg">
                尚未生成代码审查报告。请等待管道流转到 implemented 后由 code-reviewer Agent 进行评估。
              </div>
            ) : (
              reportDetail && (
                <div className="space-y-4 text-xs">
                  {/* Status Banner */}
                  <div className={`flex items-center justify-between border px-3 py-2 rounded-lg ${
                    reportDetail.review_status === 'pass'
                      ? (codeReview.valid !== false
                          ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
                          : 'bg-amber-500/5 border-amber-500/20 text-amber-400')
                      : 'bg-red-500/5 border-red-500/20 text-red-400'
                  }`}>
                    <div className="flex items-center gap-1.5 font-semibold">
                      {reportDetail.review_status === 'pass'
                        ? (codeReview.valid !== false
                            ? <CheckCircle2 className="w-4 h-4" />
                            : <AlertTriangle className="w-4 h-4" />)
                        : <XCircle className="w-4 h-4" />
                      }
                      <span>代码评审结论：{reportDetail.review_status === 'pass' ? (codeReview.valid !== false ? '通过 (Pass)' : '无效通过 (Invalid Pass)') : '不通过 (Rework Required)'}</span>
                    </div>
                    <span className="text-[10px] font-mono text-nms-text-dim/60">Version {reportDetail.version || 1}</span>
                  </div>

                  {/* Chinese Summary */}
                  <div className="space-y-1 bg-nms-surface-2/20 border border-nms-surface-3/10 p-3 rounded-lg">
                    <div className="font-semibold text-nms-text">审查说明</div>
                    <p className="text-nms-text-dim leading-relaxed">{reportDetail.summary || '无详细总结。'}</p>
                  </div>

                  {/* Findings */}
                  {reportDetail.findings && reportDetail.findings.length > 0 && (
                    <div className="space-y-2">
                      <div className="font-semibold text-nms-text flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        <span>发现的缺陷及整改项 ({reportDetail.findings.length})</span>
                      </div>
                      <div className="space-y-2">
                        {reportDetail.findings.map((f: any, idx: number) => (
                          <div key={idx} className="bg-nms-surface-2/40 border border-nms-surface-3/30 p-3 rounded-lg space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-nms-text">{f.id || `CR-${idx + 1}`}: {f.title}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${f.severity === 'P1' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                                {f.severity || 'P2'}
                              </span>
                            </div>
                            <div className="text-[10px] text-nms-text-dim font-mono break-all">文件: {f.file}{f.line ? ` : L${f.line}` : ''}</div>
                            <div className="text-nms-text-dim/90">{f.detail}</div>
                            <div className="bg-red-950/20 border border-red-500/15 p-2 rounded text-red-400 text-[11px] leading-relaxed">
                              <span className="font-semibold">要求修复：</span>{f.required_fix}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Required Developer Actions */}
                  {reportDetail.required_developer_actions && reportDetail.required_developer_actions.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="font-semibold text-nms-text">开发者明确待办 (Actions)</div>
                      <ul className="list-disc pl-4 space-y-1 text-nms-text-dim">
                        {reportDetail.required_developer_actions.map((act: string, idx: number) => (
                          <li key={idx} className="leading-normal">{act}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Checked files */}
                  {reportDetail.checked_files && reportDetail.checked_files.length > 0 && (
                    <div className="space-y-1">
                      <div className="font-semibold text-nms-text-dim">被审计的文件列表</div>
                      <div className="flex flex-wrap gap-1">
                        {reportDetail.checked_files.map((file: string, idx: number) => (
                          <span key={idx} className="font-mono text-[9px] px-2 py-0.5 rounded bg-nms-surface-2 border border-nms-surface-3/30 text-nms-text-dim/80">
                            {file}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        )}

        {/* ACCEPTANCE REVIEW TAB */}
        {activeTab === 'acceptance' && !loadingDetail && !loadError && (
          <div className="space-y-4">
            {!acceptanceReview.exists ? (
              <div className="text-center py-10 text-xs text-nms-text-dim/50 border border-dashed border-nms-surface-3/20 rounded-lg">
                尚未生成最终验收审计报告。请等待调试（debugged）完成后由 acceptance-reviewer Agent 进行全断言确认。
              </div>
            ) : (
              reportDetail && (
                <div className="space-y-4 text-xs">
                  {/* Status Banner */}
                  <div className={`flex items-center justify-between border px-3 py-2 rounded-lg ${
                    reportDetail.acceptance_status === 'pass'
                      ? (acceptanceReview.valid !== false
                          ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400'
                          : 'bg-amber-500/5 border-amber-500/20 text-amber-400')
                      : 'bg-red-500/5 border-red-500/20 text-red-400'
                  }`}>
                    <div className="flex items-center gap-1.5 font-semibold">
                      {reportDetail.acceptance_status === 'pass'
                        ? (acceptanceReview.valid !== false
                            ? <CheckCircle2 className="w-4 h-4" />
                            : <AlertTriangle className="w-4 h-4" />)
                        : <XCircle className="w-4 h-4" />
                      }
                      <span>最终验收结论：{reportDetail.acceptance_status === 'pass' ? (acceptanceReview.valid !== false ? '通过 (Pass)' : '无效通过 (Invalid Pass)') : '拒绝 (Acceptance Failed)'}</span>
                    </div>
                    <span className="text-[10px] font-mono text-nms-text-dim/60">Version {reportDetail.version || 1}</span>
                  </div>

                  {/* Summary */}
                  <div className="space-y-1 bg-nms-surface-2/20 border border-nms-surface-3/10 p-3 rounded-lg">
                    <div className="font-semibold text-nms-text">验收审计总结</div>
                    <p className="text-nms-text-dim leading-relaxed">{reportDetail.summary || '无。'}</p>
                  </div>

                  {/* Assertion results */}
                  {reportDetail.assertion_results && reportDetail.assertion_results.length > 0 && (
                    <div className="space-y-2">
                      <div className="font-semibold text-nms-text">断言验证结果 (Assertions)</div>
                      <div className="space-y-1.5">
                        {reportDetail.assertion_results.map((ass: any, idx: number) => (
                          <div key={idx} className="flex items-start gap-2 bg-nms-surface-2/30 border border-nms-surface-3/20 p-2.5 rounded-lg">
                            <div className="mt-0.5 flex-shrink-0">
                              {ass.status === 'pass' ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              ) : (
                                <XCircle className="w-4 h-4 text-red-400" />
                              )}
                            </div>
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono font-semibold text-nms-text">{ass.assertion_id}</span>
                                <span className="text-[10px] text-nms-text-dim/80">{ass.verification_command || '人工验证'}</span>
                              </div>
                              {ass.observed_result && (
                                <div className="text-[10px] font-mono bg-nms-surface-3/20 border border-nms-surface-3/30 p-1.5 rounded text-nms-text-dim/90 break-all leading-normal">
                                  观测值: {ass.observed_result}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Negative assertion results */}
                  {reportDetail.negative_assertion_results && reportDetail.negative_assertion_results.length > 0 && (
                    <div className="space-y-2">
                      <div className="font-semibold text-nms-text">禁止断言验证结果 (Negative Assertions)</div>
                      <div className="space-y-1.5">
                        {reportDetail.negative_assertion_results.map((nass: any, idx: number) => (
                          <div key={idx} className="flex items-start gap-2 bg-nms-surface-2/30 border border-nms-surface-3/20 p-2.5 rounded-lg">
                            <div className="mt-0.5 flex-shrink-0">
                              {nass.status === 'pass' ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              ) : (
                                <XCircle className="w-4 h-4 text-red-400" />
                              )}
                            </div>
                            <div className="space-y-1 min-w-0">
                              <div className="font-mono font-semibold text-nms-text">{nass.assertion_id}</div>
                              <div className="text-[10px] text-nms-text-dim/80 font-normal leading-normal">{nass.observed_result}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Mismatch Findings */}
                  {reportDetail.mismatch_findings && reportDetail.mismatch_findings.length > 0 && (
                    <div className="space-y-2">
                      <div className="font-semibold text-nms-text flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                        <span className="text-red-400">开发与设计偏离缺陷 (Mismatches)</span>
                      </div>
                      <div className="space-y-2">
                        {reportDetail.mismatch_findings.map((f: any, idx: number) => (
                          <div key={idx} className="bg-red-950/20 border border-red-500/20 p-3 rounded-lg space-y-1">
                            <div className="font-semibold text-red-400">{f.id || `AR-${idx + 1}`}: {f.title}</div>
                            <div className="text-nms-text-dim/90">{f.detail}</div>
                            <div className="text-[11px] text-red-400/90 leading-relaxed font-medium mt-1">
                              <span className="font-semibold">要求修复：</span>{f.required_fix}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Missing Evidence */}
                  {reportDetail.missing_evidence && reportDetail.missing_evidence.length > 0 && (
                    <div className="space-y-2">
                      <div className="font-semibold text-nms-text flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-amber-400">缺失的验证证据 (Missing Evidence)</span>
                      </div>
                      <div className="space-y-1.5">
                        {reportDetail.missing_evidence.map((me: any, idx: number) => (
                          <div key={idx} className="bg-nms-surface-2/50 border border-nms-surface-3/30 p-2.5 rounded-lg">
                            <div className="font-mono text-[10px] text-nms-text">断言: {me.assertion_id}</div>
                            <div className="text-[10px] text-nms-text-dim/60 mt-0.5">期望文件: {me.required_artifact}</div>
                            <div className="text-red-400/80 mt-1">{me.detail}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

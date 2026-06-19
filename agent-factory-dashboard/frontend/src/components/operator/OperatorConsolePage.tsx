import { useEffect, useState } from 'react';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { fetchHandoff } from '../../api/agentFactory';
import { NextActionCard } from './NextActionCard';
import { RequirementWorkbench } from './RequirementWorkbench';
import { RefreshCw, Layout, Terminal, Shield, FileText, Flame } from 'lucide-react';

export function OperatorConsolePage(): JSX.Element {
  const { dashboard, refresh, selectAdu, selectedAduId } = useAgentFactoryStore();
  const [selectedTarget, setSelectedTarget] = useState<{ type: 'adu' | 'epic'; id: string } | null>(null);
  const [handoff, setHandoff] = useState<any | null>(null);
  const [loadingHandoff, setLoadingHandoff] = useState(false);
  const [activeTab, setActiveTab] = useState<'console' | 'intake'>('console');

  // Local audit logs mock/fetch state

  // Automatically select the active ADU from store if set
  useEffect(() => {
    if (selectedAduId) {
      setSelectedTarget({ type: 'adu', id: selectedAduId });
    } else if (dashboard?.adus && dashboard.adus.length > 0) {
      setSelectedTarget({ type: 'adu', id: dashboard.adus[0].id });
    }
  }, [selectedAduId, dashboard]);

  const loadHandoff = async () => {
    if (!selectedTarget) return;
    setLoadingHandoff(true);
    try {
      const res = await fetchHandoff(selectedTarget.type, selectedTarget.id);
      setHandoff(res);
    } catch {
      setHandoff(null);
    } finally {
      setLoadingHandoff(false);
    }
  };

  useEffect(() => {
    void loadHandoff();
  }, [selectedTarget]);

  const handleRefresh = async () => {
    await refresh();
    await loadHandoff();
  };

  const handleIntakeDone = (newId: string) => {
    void refresh();
    const isEpic = newId.startsWith('EPIC-');
    setSelectedTarget({ type: isEpic ? 'epic' : 'adu', id: newId });
    if (!isEpic) {
      selectAdu(newId);
    }
    setActiveTab('console');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold font-display text-nms-text">Operator Console 控制台</h1>
          <p className="text-sm text-nms-text-dim mt-1">
            通过统一控制平面和命令流驱动 Agent Factory 执行软件需求研发
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab(activeTab === 'console' ? 'intake' : 'console')}
            className={`nms-btn text-xs py-2 px-4 border ${
              activeTab === 'intake'
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            {activeTab === 'console' ? '准入新需求' : '回到操作台'}
          </button>
          <button
            onClick={() => void handleRefresh()}
            className="nms-btn-ghost flex items-center gap-2 text-xs text-slate-300 hover:text-nms-text"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            同步状态
          </button>
        </div>
      </div>

      {activeTab === 'intake' ? (
        <div className="max-w-4xl mx-auto">
          <RequirementWorkbench onIntakeCompleted={handleIntakeDone} />
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          {/* Left Panel: Target Selection */}
          <div className="col-span-12 lg:col-span-4 space-y-6">
            <div className="nms-card bg-slate-900/40 border-slate-800 p-4 rounded-xl flex flex-col max-h-[700px] overflow-hidden">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-indigo-400" /> 活动任务队列 (Targets)
              </h3>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {/* ADUs List */}
                <div className="space-y-1">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 py-1">
                    ADU 任务 ({dashboard?.adus.length || 0})
                  </div>
                  {dashboard?.adus.map((adu) => {
                    const isSelected = selectedTarget?.type === 'adu' && selectedTarget.id === adu.id;
                    return (
                      <button
                        key={adu.id}
                        onClick={() => {
                          setSelectedTarget({ type: 'adu', id: adu.id });
                          selectAdu(adu.id);
                        }}
                        className={`w-full text-left p-3 rounded-lg border text-xs transition-all flex items-start gap-2.5 ${
                          isSelected
                            ? 'bg-indigo-600/10 border-indigo-500 text-white'
                            : 'bg-slate-950/40 border-slate-800/60 text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
                        }`}
                      >
                        <Layout className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isSelected ? 'text-indigo-400' : 'text-slate-500'}`} />
                        <div className="overflow-hidden flex-1">
                          <div className="flex justify-between items-center">
                            <span className="font-mono font-bold text-[10px] text-indigo-400">{adu.id}</span>
                            <span className="text-[10px] text-slate-500">{adu.state}</span>
                          </div>
                          <p className="font-medium truncate mt-0.5">{adu.title}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel: Operator Actions and Context Handoff */}
          <div className="col-span-12 lg:col-span-8 space-y-6">
            {selectedTarget ? (
              <div className="space-y-6">
                {/* Next Action Recommendation Card */}
                <NextActionCard
                  targetType={selectedTarget.type}
                  targetId={selectedTarget.id}
                  onActionCompleted={handleRefresh}
                />

                {/* Handoff Context Summary Card */}
                <div className="nms-card bg-slate-900/40 border-slate-800 p-5 rounded-xl space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 border-b border-slate-800/60 pb-3">
                    <FileText className="w-4 h-4 text-indigo-400" /> 上下文快照 (Handoff Summary)
                  </h3>

                  {loadingHandoff ? (
                    <div className="flex items-center justify-center p-8 text-xs text-slate-400">
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" /> 正在获取快照...
                    </div>
                  ) : handoff ? (
                    <div className="space-y-4 text-xs animate-in fade-in duration-200">
                      <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800/40">
                        <div className="font-semibold text-slate-300">摘要描述:</div>
                        <p className="text-slate-400 mt-1.5 leading-relaxed">{handoff.summary}</p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-slate-950/30 p-3 rounded-lg border border-slate-800/30 space-y-2">
                          <div className="font-semibold text-slate-300 flex items-center gap-1">
                            <Shield className="w-3.5 h-3.5 text-cyan-400" /> 质量健康度
                          </div>
                          {handoff.quality_risks.length === 0 ? (
                            <div className="text-slate-500 italic">No active quality risks detected.</div>
                          ) : (
                            <ul className="space-y-1 text-slate-400 pl-1">
                              {handoff.quality_risks.map((risk: string, i: number) => (
                                <li key={i} className="flex items-start gap-1.5">
                                  <Flame className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
                                  <span>{risk}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="bg-slate-950/30 p-3 rounded-lg border border-slate-800/30 space-y-2">
                          <div className="font-semibold text-slate-300">已用 Token 汇总</div>
                          <div className="space-y-1.5 text-slate-400">
                            <div className="flex justify-between">
                              <span>总 Token 消耗:</span>
                              <span className="font-mono text-indigo-400 font-bold">
                                {handoff.token_summary?.totalTokens?.toLocaleString() || '0'}
                              </span>
                            </div>
                            <div className="flex justify-between text-[11px] text-slate-500">
                              <span>Input / Output:</span>
                              <span>
                                {handoff.token_summary?.inputTokens?.toLocaleString() || '0'} / {handoff.token_summary?.outputTokens?.toLocaleString() || '0'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {handoff.artifact_links.length > 0 && (
                        <div>
                          <div className="font-semibold text-slate-300 mb-2">生成产物路径:</div>
                          <div className="flex flex-wrap gap-2">
                            {handoff.artifact_links.map((link: string) => (
                              <span
                                key={link}
                                className="bg-slate-950 border border-slate-800/80 px-2.5 py-1 rounded-md font-mono text-[11px] text-slate-400"
                              >
                                {link}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 italic p-4 text-center">
                      未发现当前任务的 handoff 信息。
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="nms-card bg-slate-900/20 border-dashed border-slate-800 p-12 rounded-xl flex flex-col items-center justify-center text-center">
                <Terminal className="w-8 h-8 text-slate-600 mb-3" />
                <p className="text-sm text-slate-400">请在左侧任务队列中选择一个 ADU 或 Epic 进行管理操控。</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

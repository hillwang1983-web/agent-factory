import { useEffect, useState } from 'react';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { agentFactoryApi } from '../../api/agentFactory';
import { SummaryStrip } from './SummaryStrip';
import { AduQueuePanel } from './AduQueuePanel';
import { WorkflowTimeline } from './WorkflowTimeline';
import { AgentLanePanel } from './AgentLanePanel';
import { RunHistoryTable } from './RunHistoryTable';
import { ArtifactDrawer } from './ArtifactDrawer';
import { OrchestratorControlPanel } from './OrchestratorControlPanel';
import { TokenBudgetChart } from './TokenBudgetChart';
import { ReviewGatePanel } from './ReviewGatePanel';
import { WritePathExpansionPanel } from './WritePathExpansionPanel';
import { QualityReportBadge } from './QualityReportBadge';
import { QualityReportPanel } from './QualityReportPanel';
import { FileText, Shield, Terminal, RefreshCw, FolderOpen, Plus } from 'lucide-react';
import { ProjectContextPanel } from './ProjectContextPanel';
import { OperationStatusBanner } from '../operations/OperationStatusBanner';
import { OperationEventTimeline } from '../operations/OperationEventTimeline';
import { EvidenceMatrixPanel } from '../evidence/EvidenceMatrixPanel';


export function AgentFactoryPage(): JSX.Element {
  const {
    dashboard,
    selectedAduId,
    loading,
    error,
    refresh,
    openArtifact,
    qualityReports,
    activeOperations,
  } = useAgentFactoryStore();


  const [newWritePath, setNewWritePath] = useState('');
  const [addPathLoading, setAddPathLoading] = useState(false);
  const [addPathError, setAddPathError] = useState<string | null>(null);

  const handleAddWritePath = async (aduId: string) => {
    const p = newWritePath.trim();
    if (!p) return;
    setAddPathLoading(true);
    setAddPathError(null);
    try {
      await agentFactoryApi.appendAduPaths(aduId, [p], []);
      setNewWritePath('');
      await refresh();
    } catch (e: any) {
      setAddPathError(e?.message ?? '添加失败');
    } finally {
      setAddPathLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 5000); // Poll every 5s

    return () => clearInterval(interval);
  }, [refresh]);

  if (loading && !dashboard) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="text-sm text-nms-text-dim animate-pulse flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading Agent Factory...
        </div>
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div>
        <div className="nms-card border-red-500/20 bg-red-500/5 text-red-400 p-4">
          <h3 className="font-semibold text-sm">Failed to connect to Agent Factory</h3>
          <p className="text-xs mt-1 leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  const selectedAdu = dashboard?.adus.find((a) => a.id === selectedAduId) || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold font-display text-nms-text">Agent Factory 任务看板</h1>
          <p className="text-sm text-nms-text-dim mt-1">
            监控 ADU 执行状态、质量门、产物与运行日志
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="nms-btn-ghost flex items-center gap-2 text-xs text-slate-300 hover:text-nms-text"
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Force Sync
        </button>
      </div>

      {/* KPI Overview Strip */}
      <SummaryStrip dashboard={dashboard} />

      {/* Workspace Dashboard Layout */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Side: ADUs Queue */}
        <div className="col-span-12 xl:col-span-4">
          <AduQueuePanel />
        </div>

        {/* Right Side: Execution status, workflow and artifacts */}
        <div className="col-span-12 xl:col-span-8 space-y-6">
          {selectedAdu ? (
            <div className="space-y-6">
              <OperationStatusBanner targetType="adu" targetId={selectedAdu.id} />
              {/* Selected ADU details & workflow timeline */}

              <div className="nms-card bg-nms-surface-1 border-nms-surface-2 p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="font-mono text-xs font-bold text-nms-accent">{selectedAdu.id}</span>
                    <h2 className="text-base font-semibold text-nms-text mt-0.5">{selectedAdu.title}</h2>
                  </div>
                  <QualityReportBadge reports={qualityReports} />
                </div>

                <div className="text-xs text-nms-text-dim leading-relaxed bg-nms-surface-2/40 border border-nms-surface-3/50 p-3 rounded-lg">
                  <div className="font-semibold text-nms-text mb-1">Requirement Goal:</div>
                  {selectedAdu.goal}
                </div>

                {/* ADU Artifacts list */}
                <div>
                  <div className="text-xs font-semibold text-nms-text mb-2 flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5 text-nms-text-dim" /> Expected Artifacts
                  </div>
                  {selectedAdu.artifact_status.length === 0 ? (
                    <div className="text-[11px] text-nms-text-dim italic">No artifacts mapped for this ADU</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {selectedAdu.artifact_status.map((art) => (
                        <button
                          key={art.path}
                          onClick={() => art.exists && openArtifact(art.path)}
                          className={`px-2.5 py-1.5 text-[11px] rounded border flex items-center gap-1.5 transition-colors ${
                            art.exists
                              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                              : 'bg-nms-surface-2 border-nms-surface-3 text-nms-text-dim/40 cursor-not-allowed'
                          }`}
                          disabled={!art.exists}
                          title={art.exists ? `View ${art.path}` : `${art.path} is not yet created`}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          {art.path.split('/').pop()}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Scope & Restrictions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="bg-nms-surface-2/30 border border-nms-surface-3/50 p-3 rounded-lg space-y-1">
                    <div className="text-[10px] text-nms-text-dim uppercase font-bold flex items-center gap-1">
                      <Shield className="w-3 h-3 text-nms-accent" /> Allowed Write Paths
                    </div>
                    <ul className="text-[10px] text-nms-text font-mono list-disc list-inside">
                      {selectedAdu.allowed_write_paths.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                    {/* Inline add path — only available when ADU is not running/terminal */}
                    {!['evidenced', 'canceled'].includes(selectedAdu.state) &&
                      selectedAdu.health?.status !== 'running' && (
                      <div className="pt-1 space-y-1">
                        <div className="flex gap-1">
                          <input
                            type="text"
                            value={newWritePath}
                            onChange={(e) => { setNewWritePath(e.target.value); setAddPathError(null); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') void handleAddWritePath(selectedAdu.id); }}
                            placeholder="src/module/file.c"
                            className="flex-1 bg-nms-surface-1 border border-nms-surface-3 text-[10px] text-nms-text font-mono rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-nms-accent placeholder-nms-text-dim/40"
                          />
                          <button
                            onClick={() => void handleAddWritePath(selectedAdu.id)}
                            disabled={addPathLoading || !newWritePath.trim()}
                            className="flex items-center gap-0.5 px-1.5 py-0.5 bg-nms-accent/20 border border-nms-accent/40 rounded text-[10px] text-nms-accent hover:bg-nms-accent/30 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="添加到写权限路径"
                          >
                            <Plus className="w-2.5 h-2.5" />
                            {addPathLoading ? '…' : '添加'}
                          </button>
                        </div>
                        {addPathError && (
                          <div className="text-[10px] text-red-400">{addPathError}</div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="bg-nms-surface-2/30 border border-nms-surface-3/50 p-3 rounded-lg space-y-1">
                    <div className="text-[10px] text-nms-text-dim uppercase font-bold flex items-center gap-1">
                      <Terminal className="w-3 h-3 text-nms-accent" /> Required Validation Commands
                    </div>
                    <ul className="text-[10px] text-nms-text font-mono list-disc list-inside truncate">
                      {selectedAdu.required_commands.map((c) => (
                        <li key={c} title={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* Workflow Stepper */}
              <WorkflowTimeline adu={selectedAdu} />

              <EvidenceMatrixPanel aduId={selectedAdu.id} />

              {/* Project context (only for project-bound ADUs) */}
              {selectedAdu.project_id && (
                <ProjectContextPanel aduId={selectedAdu.id} />
              )}

              {/* Quality Gate review report panel */}
              <QualityReportPanel adu={selectedAdu} />

              {/* Review Gate panel (Editable docs & Approve actions) */}
              <ReviewGatePanel aduId={selectedAdu.id} />

              {/* Write Path Expansion approval panel */}
              <WritePathExpansionPanel aduId={selectedAdu.id} />

              {/* Run History Table */}
              <RunHistoryTable runs={selectedAdu.runs} />

              <OperationEventTimeline operationId={activeOperations[selectedAdu.id]?.operation_id || activeOperations[selectedAdu.id]?.id || null} />

              <OrchestratorControlPanel aduId={selectedAdu.id} />
              <TokenBudgetChart aduId={selectedAdu.id} />
            </div>

          ) : (
            <div className="nms-card p-12 text-center text-sm text-nms-text-dim">
              No ADUs selected.
            </div>
          )}

          {/* Agent lanes overview */}
          <AgentLanePanel dashboard={dashboard} />
        </div>
      </div>

      {/* Artifact Drawer */}
      <ArtifactDrawer />
    </div>
  );
}

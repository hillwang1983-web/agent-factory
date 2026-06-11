import { useEffect, useState } from 'react';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { CreateEpicModal } from './CreateEpicModal';
import { EpicDagView } from './EpicDagView';
import { EpicControlPanel } from './EpicControlPanel';
import { EpicChildAduTable } from './EpicChildAduTable';
import { EpicOverviewPanel } from './EpicOverviewPanel';
import { Layers, Plus } from 'lucide-react';

const EPIC_STATE_LABELS: Record<string, string> = {
  created: '已创建',
  flow_designed: '链路设计完成',
  split_decision: '拆分决策',
  single_adu_selected: '单ADU模式',
  split_required: '需要拆分',
  epic_planned: '已规划',
  child_adus_created: '子ADU已创建',
  child_adus_running: '子ADU运行中',
  child_adus_blocked: '子ADU阻塞',
  child_adus_evidenced: '子ADU已完成',
  epic_acceptance: '验收中',
  epic_evidenced: '已验证',
  epic_failed: '失败',
  human_gate: '需人工介入',
  canceled: '已取消',
};

export function EpicsPage() {
  const {
    projects, epics, selectedEpicId, epicDag,
    fetchEpics, selectEpic, createEpic, refresh,
  } = useAgentFactoryStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string>('');

  useEffect(() => {
    fetchEpics();
    refresh();
  }, []);

  const handleCreateEpic = async (projectId: string, input: any) => {
    await createEpic(projectId, input);
    setShowCreateModal(false);
  };

  const selectedEpic = epics.find(e => e.id === selectedEpicId) || null;
  const profiledProjects = projects.filter(p => p.status === 'profiled');

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Layers className="h-5 w-5 text-cyan-400" />
          <h2 className="text-lg font-bold text-white">Epic 编排</h2>
          <span className="text-xs text-slate-400">{epics.length} Epics</span>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-300"
          >
            <option value="">所有项目</option>
            {projects.map(p => (
              <option key={p.project_id} value={p.project_id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={profiledProjects.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-3.5 w-3.5" />
            创建 Epic
          </button>
        </div>
      </div>

      {/* Main layout: left list, center DAG, right details */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left: Epic List */}
        <div className="w-64 flex-shrink-0 bg-slate-900 border border-slate-800 rounded-lg overflow-y-auto">
          <div className="p-3 border-b border-slate-800 text-xs font-semibold text-slate-400">
            Epic 列表
          </div>
          {epics.filter(e => !selectedProject || e.project_id === selectedProject).map(epic => (
            <button
              key={epic.id}
              onClick={() => selectEpic(epic.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-slate-800/50 text-xs hover:bg-slate-800/50 transition-colors ${
                selectedEpicId === epic.id ? 'bg-cyan-900/30 border-l-2 border-l-cyan-400' : ''
              }`}
            >
              <div className="font-medium text-slate-200 truncate">{epic.title}</div>
              <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
                <span>{epic.id}</span>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                  epic.state === 'epic_evidenced' ? 'bg-green-400' :
                  epic.state === 'epic_failed' || epic.state === 'child_adus_blocked' ? 'bg-red-400' :
                  epic.state === 'child_adus_running' ? 'bg-amber-400 animate-pulse' :
                  'bg-slate-500'
                }`} />
                <span>{EPIC_STATE_LABELS[epic.state] || epic.state}</span>
              </div>
            </button>
          ))}
          {epics.length === 0 && (
            <div className="p-4 text-xs text-slate-600 text-center">暂无 Epic</div>
          )}
        </div>

        {/* Center: DAG + Child ADU Table */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          {selectedEpic ? (
            <>
              <EpicDagView epic={selectedEpic} dag={epicDag} />
              <EpicChildAduTable children={epicDag?.children || []} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
              选择一个 Epic 查看详情
            </div>
          )}
        </div>

        {/* Right: Overview + Controls */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-4">
          {selectedEpic ? (
            <>
              <EpicOverviewPanel epic={selectedEpic} />
              <EpicControlPanel epic={selectedEpic} />
            </>
          ) : null}
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateEpicModal
          projects={profiledProjects}
          selectedProjectId={selectedProject}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateEpic}
        />
      )}
    </div>
  );
}

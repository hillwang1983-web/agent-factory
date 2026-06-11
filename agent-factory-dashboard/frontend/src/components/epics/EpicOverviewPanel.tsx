import type { AgentFactoryEpic } from '../../types/agent-factory';

interface Props {
  epic: AgentFactoryEpic;
}

const STATE_LABELS: Record<string, string> = {
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

export function EpicOverviewPanel({ epic }: Props) {
  const summary = epic.summary;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="text-xs font-semibold text-slate-400 mb-3">Epic 概览</div>
      <div className="flex flex-col gap-2 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-500">ID</span>
          <span className="text-slate-300 font-mono">{epic.id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">状态</span>
          <span className="text-slate-300">{STATE_LABELS[epic.state] || epic.state}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">项目</span>
          <span className="text-slate-300">{epic.project_name || epic.project_id}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">风险</span>
          <span className={`${
            epic.risk === 'high' ? 'text-red-400' : epic.risk === 'medium' ? 'text-amber-400' : 'text-green-400'
          }`}>{epic.risk}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">语言</span>
          <span className="text-slate-300">{epic.language === 'zh' ? '中文' : 'English'}</span>
        </div>
        {summary && (
          <>
            <hr className="border-slate-800 my-1" />
            <div className="flex justify-between">
              <span className="text-slate-500">子ADU总数</span>
              <span className="text-slate-300">{summary.total_child_adus}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">已完成</span>
              <span className="text-green-400">{summary.evidenced_child_adus}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">运行中</span>
              <span className="text-amber-400">{summary.running_child_adus}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">阻塞</span>
              <span className="text-red-400">{summary.blocked_child_adus}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

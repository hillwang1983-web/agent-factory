import type { AgentFactoryEpicView } from '../../types/agent-factory';

interface Props {
  epic: AgentFactoryEpicView;
  dag: { epic: AgentFactoryEpicView | null; children: any[]; dependencies: any[] } | null;
}

const STATE_COLORS: Record<string, string> = {
  created: 'bg-slate-500',
  analysis_review: 'bg-purple-400',
  analyzed: 'bg-purple-500',
  contexted: 'bg-blue-500',
  design_review: 'bg-indigo-400',
  designed: 'bg-indigo-500',
  contracted: 'bg-teal-500',
  test_red: 'bg-yellow-500',
  implemented: 'bg-amber-500',
  code_reviewed: 'bg-orange-400',
  code_rework: 'bg-red-400',
  build_rework: 'bg-red-400',
  acceptance_rework: 'bg-red-400',
  debugged: 'bg-lime-500',
  acceptance_reviewed: 'bg-green-400',
  evidenced: 'bg-green-500',
  human_gate: 'bg-red-600',
  canceled: 'bg-slate-600',
};

const PHASES = [
  { id: 'flow', label: 'System Flow' },
  { id: 'split', label: 'Split Plan' },
  { id: 'child_adus', label: 'Child ADUs' },
  { id: 'epic_acceptance', label: 'Epic Acceptance' },
  { id: 'completed', label: 'Completed' },
];

export function EpicDagView({ epic, dag }: Props) {
  const children = dag?.children || [];
  const deps = dag?.dependencies || epic.dependencies || [];

  const progress = epic.progress || {
    current_phase: 'flow',
    completed_phases: [],
    child_summary: { total: 0, evidenced: 0, blocked: 0, running: 0 }
  };

  const emptyMessageByState: Record<string, string> = {
    created: '暂无子 ADU — 请先点击“启动”执行系统链路设计。',
    flow_designed: '系统链路设计已完成 — 请点击“单步执行”生成拆分方案。',
    split_decision: '拆分方案已生成 — 请点击“单步执行”确认拆分决策。',
    split_required: '拆分方案要求创建子 ADU — 请点击“生成子ADU”或“单步执行”。',
    epic_planned: 'Epic 已规划 — 正在等待子 ADU 创建结果刷新。',
    child_adus_created: '子 ADU 已创建 — 正在加载子 ADU DAG。',
    child_adus_running: '子 ADU 正在运行 — 正在等待状态刷新。',
    child_adus_blocked: '子 ADU 阻塞 — 请查看子 ADU 状态和审核门。',
  };

  // Build tree: find root nodes (no dependencies FROM other children to them)
  const depTargets = new Set(deps.map((d: any) => d.to));
  const roots = children.filter((c: any) => !depTargets.has(c.id));

  const getChildren = (parentId: string) => {
    const childIds = deps.filter((d: any) => d.from === parentId).map((d: any) => d.to);
    return children.filter((c: any) => childIds.includes(c.id));
  };

  const renderNode = (adu: any, depth: number = 0) => {
    const childNodes = getChildren(adu.id);
    const dotColor = STATE_COLORS[adu.state] || 'bg-slate-500';
    const stateLabel = adu.state || 'unknown';

    return (
      <div key={adu.id} style={{ marginLeft: depth * 24 }}>
        <div className="flex items-center gap-2 py-1.5 group">
          <span className={`inline-block w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} />
          <span className="text-xs font-mono text-slate-500 flex-shrink-0 w-20">{adu.id}</span>
          <span className="text-xs text-slate-300 flex-1 truncate">{adu.title || adu.scope || '—'}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            adu.state === 'evidenced' ? 'bg-green-900/50 text-green-400' :
            adu.state === 'human_gate' ? 'bg-red-900/50 text-red-400' :
            adu.state === 'canceled' ? 'bg-slate-800 text-slate-500' :
            'bg-slate-800 text-slate-400'
          }`}>
            {stateLabel}
          </span>
        </div>
        {childNodes.map((child: any) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      {/* Epic Progress Phases */}
      <div className="flex items-center justify-between gap-1 mb-6 bg-slate-950 p-2.5 rounded border border-slate-800/40">
        {PHASES.map((p, idx) => {
          const isCurrent = progress.current_phase === p.id;
          const isCompleted = progress.completed_phases.includes(p.id);
          const isFailed = progress.current_phase === 'failed';

          let statusColor = 'text-slate-500 border-slate-850 bg-slate-900/10';
          if (isCompleted) statusColor = 'text-green-400 border-green-500/30 bg-green-500/5';
          else if (isCurrent) {
            statusColor = isFailed ? 'text-red-400 border-red-500/30 bg-red-500/5' : 'text-cyan-400 border-cyan-500/30 bg-cyan-500/5 font-semibold';
          }

          return (
            <div key={p.id} className="flex-1 flex items-center gap-1 min-w-0">
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[9px] truncate ${statusColor}`}>
                <span className="font-mono text-[8px] opacity-75">{idx + 1}.</span>
                <span>{p.label}</span>
              </div>
              {idx < PHASES.length - 1 && (
                <span className="text-slate-700 text-[10px] font-mono select-none px-0.5">→</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="text-xs font-semibold text-slate-400 mb-3">Epic DAG</div>
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-block w-3 h-3 rounded bg-cyan-500" />
        <span className="text-xs font-medium text-cyan-400">{epic.id}</span>
        <span className="text-xs text-slate-400">— {epic.title}</span>
      </div>
      <div className="border-l border-slate-700 ml-1.5 pl-2">
        {roots.map((root: any) => renderNode(root))}
        {children.length === 0 && (
          <div className="text-xs text-slate-600 py-2">
            {epic.child_adus.length === 0 ? (emptyMessageByState[epic.state] || '暂无子 ADU') : '加载中...'}
          </div>
        )}
      </div>
    </div>
  );
}

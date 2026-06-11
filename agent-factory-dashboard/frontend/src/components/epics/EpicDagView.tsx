import type { AgentFactoryEpic } from '../../types/agent-factory';

interface Props {
  epic: AgentFactoryEpic;
  dag: { epic: AgentFactoryEpic | null; children: any[]; dependencies: any[] } | null;
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

export function EpicDagView({ epic, dag }: Props) {
  const children = dag?.children || [];
  const deps = dag?.dependencies || epic.dependencies || [];

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
            {epic.child_adus.length === 0 ? '暂无子 ADU — 请先启动 Epic 进行系统链路设计和拆分' : '加载中...'}
          </div>
        )}
      </div>
    </div>
  );
}

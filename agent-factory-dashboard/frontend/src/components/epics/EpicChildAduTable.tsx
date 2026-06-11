interface Props {
  children: any[];
}

export function EpicChildAduTable({ children }: Props) {
  if (children.length === 0) return null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <div className="text-xs font-semibold text-slate-400 p-3 border-b border-slate-800">子 ADU 列表</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-500">
              <th className="text-left p-2 font-medium">ID</th>
              <th className="text-left p-2 font-medium">标题</th>
              <th className="text-left p-2 font-medium">Scope</th>
              <th className="text-left p-2 font-medium">状态</th>
              <th className="text-left p-2 font-medium">依赖</th>
            </tr>
          </thead>
          <tbody>
            {children.map((adu: any) => (
              <tr key={adu.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                <td className="p-2 font-mono text-slate-400">{adu.id}</td>
                <td className="p-2 text-slate-200">{adu.title}</td>
                <td className="p-2 text-slate-400 max-w-48 truncate">{adu.scope || adu.integration_role || '—'}</td>
                <td className="p-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    adu.state === 'evidenced' ? 'bg-green-900/50 text-green-400' :
                    adu.state === 'human_gate' ? 'bg-red-900/50 text-red-400' :
                    adu.state === 'canceled' ? 'bg-slate-800 text-slate-500' :
                    'bg-slate-800 text-slate-400'
                  }`}>
                    {adu.state}
                  </span>
                </td>
                <td className="p-2 text-slate-500">
                  {(adu.depends_on || []).join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

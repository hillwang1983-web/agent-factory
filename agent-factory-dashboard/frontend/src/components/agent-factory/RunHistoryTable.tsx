import type { AgentFactoryRun } from '../../types/agent-factory';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { Terminal, FileText, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

interface RunHistoryTableProps {
  runs: AgentFactoryRun[];
}

export function RunHistoryTable({ runs }: RunHistoryTableProps): JSX.Element {
  const { openArtifact } = useAgentFactoryStore();

  const formatTimestamp = (ts: string) => {
    const m = ts.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
    if (!m) return ts;
    return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  };

  const getResultBadge = (result: string, code: number) => {
    let classes = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ';
    let icon = <CheckCircle2 className="w-3 h-3" />;

    if (code !== 0 || result === 'failed') {
      classes += 'bg-red-500/10 text-red-400 border-red-500/20';
      icon = <XCircle className="w-3 h-3" />;
    } else if (result === 'unstructured') {
      classes += 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      icon = <AlertCircle className="w-3 h-3" />;
    } else {
      classes += 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      icon = <CheckCircle2 className="w-3 h-3" />;
    }

    const label = result.charAt(0).toUpperCase() + result.slice(1);
    return (
      <span className={classes}>
        {icon} {label} {code !== 0 && `(Code ${code})`}
      </span>
    );
  };

  return (
    <div className="nms-card bg-nms-surface-1 border-nms-surface-2 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-nms-text">Agent Execution Logs</h3>
        <p className="text-xs text-nms-text-dim mt-0.5">Execution history, output directories, and status codes</p>
      </div>

      <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="border-b border-nms-surface-2 text-nms-text-dim font-semibold">
              <th className="py-2.5 px-3">Timestamp</th>
              <th className="py-2.5 px-3">ADU ID</th>
              <th className="py-2.5 px-3">Agent</th>
              <th className="py-2.5 px-3">Result</th>
              <th className="py-2.5 px-3 text-right">Logs / Shell Outputs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-nms-surface-2/60">
            {runs.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-nms-text-dim italic">
                  No execution runs found for this configuration
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr key={`${run.timestamp}-${run.agent}`} className="hover:bg-nms-surface-2/10">
                  <td className="py-2.5 px-3 font-mono text-nms-text-dim">
                    {formatTimestamp(run.timestamp)}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-nms-text font-bold">
                    {run.adu_id}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-nms-text">
                    {run.agent}
                  </td>
                  <td className="py-2.5 px-3">
                    {getResultBadge(run.result, run.effective_returncode ?? run.returncode)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => openArtifact(`${run.run_dir}/prompt.md`)}
                        className="nms-btn-ghost text-[10px] py-1 px-2 flex items-center gap-1 text-slate-300 hover:text-nms-text"
                        title="View rendered prompt sent to agent"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-400" /> Prompt
                      </button>
                      <button
                        onClick={() => openArtifact(`${run.run_dir}/stdout.md`)}
                        className="nms-btn-ghost text-[10px] py-1 px-2 flex items-center gap-1 text-slate-300 hover:text-nms-text"
                        title="View agent stdout execution logs"
                      >
                        <Terminal className="w-3.5 h-3.5 text-emerald-400" /> Stdout
                      </button>
                      <button
                        onClick={() => openArtifact(`${run.run_dir}/stderr.md`)}
                        className="nms-btn-ghost text-[10px] py-1 px-2 flex items-center gap-1 text-slate-300 hover:text-nms-text"
                        title="View agent stderr execution logs"
                      >
                        <Terminal className="w-3.5 h-3.5 text-red-400" /> Stderr
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

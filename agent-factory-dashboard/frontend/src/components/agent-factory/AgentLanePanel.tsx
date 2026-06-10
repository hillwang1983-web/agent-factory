import type { AgentFactoryDashboard } from '../../types/agent-factory';
import { Bot, Check, X, AlertTriangle } from 'lucide-react';

interface AgentLanePanelProps {
  dashboard: AgentFactoryDashboard | null;
}

export function AgentLanePanel({ dashboard }: AgentLanePanelProps): JSX.Element {
  if (!dashboard) {
    return (
      <div className="nms-card p-6 text-center text-sm text-nms-text-dim">
        Loading Agent lanes...
      </div>
    );
  }

  const { agents } = dashboard;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-nms-text">Agent Lanes Status</h3>
          <p className="text-xs text-nms-text-dim mt-0.5">Execution statistics and health for each factory role</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => {
          // Compute status class
          let borderClass = 'border-nms-surface-2';
          let statusLabelClass = 'text-[9px] px-1.5 py-0.5 rounded border border-slate-500/20 text-slate-400 bg-slate-500/5';
          let statusText = 'Idle';

          switch (agent.status) {
            case 'active':
              borderClass = 'border-nms-accent/40';
              statusLabelClass = 'text-[9px] px-1.5 py-0.5 rounded border border-nms-accent/20 text-nms-accent bg-nms-accent/5 animate-pulse';
              statusText = 'Active';
              break;
            case 'stale':
              borderClass = 'border-amber-500/40';
              statusLabelClass = 'text-[9px] px-1.5 py-0.5 rounded border border-amber-500/20 text-amber-400 bg-amber-500/5';
              statusText = 'Stale';
              break;
            case 'failed':
              borderClass = 'border-red-500/40';
              statusLabelClass = 'text-[9px] px-1.5 py-0.5 rounded border border-red-500/20 text-red-400 bg-red-500/5';
              statusText = 'Failed';
              break;
            case 'idle':
            default:
              borderClass = 'border-nms-surface-2';
              statusLabelClass = 'text-[9px] px-1.5 py-0.5 rounded border border-nms-surface-3 text-nms-text-dim bg-nms-surface-2';
              statusText = 'Idle';
          }

          return (
            <div key={agent.id} className={`nms-card bg-nms-surface-1 p-4 flex flex-col justify-between h-[190px] border ${borderClass}`}>
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bot className="w-5 h-5 text-nms-text-dim" />
                    <span className="font-mono text-xs font-bold text-nms-text">{agent.id}</span>
                  </div>
                  <span className={statusLabelClass}>{statusText}</span>
                </div>

                <p className="text-[11px] text-nms-text-dim line-clamp-2 leading-relaxed">
                  {agent.description}
                </p>
              </div>

              <div className="space-y-3 pt-3 border-t border-nms-surface-2/60">
                {/* Metrics */}
                <div className="grid grid-cols-3 text-center gap-1">
                  <div className="bg-nms-surface-2/30 rounded py-1 border border-nms-surface-3/50">
                    <div className="text-[9px] text-nms-text-dim flex items-center justify-center gap-0.5">
                      <Check className="w-2.5 h-2.5 text-emerald-400" /> Success
                    </div>
                    <div className="text-xs font-bold text-nms-text mt-0.5">{agent.success_runs}</div>
                  </div>
                  <div className="bg-nms-surface-2/30 rounded py-1 border border-nms-surface-3/50">
                    <div className="text-[9px] text-nms-text-dim flex items-center justify-center gap-0.5">
                      <X className="w-2.5 h-2.5 text-red-400" /> Failed
                    </div>
                    <div className="text-xs font-bold text-nms-text mt-0.5">{agent.failed_runs}</div>
                  </div>
                  <div className="bg-nms-surface-2/30 rounded py-1 border border-nms-surface-3/50">
                    <div className="text-[9px] text-nms-text-dim flex items-center justify-center gap-0.5">
                      <AlertTriangle className="w-2.5 h-2.5 text-amber-400" /> Format
                    </div>
                    <div className="text-xs font-bold text-nms-text mt-0.5">{agent.unstructured_runs}</div>
                  </div>
                </div>

                {/* Active ADUs list */}
                {agent.active_adu_ids.length > 0 ? (
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <span className="text-[9px] text-nms-text-dim flex-shrink-0">Working on:</span>
                    <div className="flex gap-1 overflow-x-auto no-scrollbar">
                      {agent.active_adu_ids.map((id) => (
                        <span key={id} className="text-[9px] bg-nms-accent/10 text-nms-accent font-mono px-1 rounded">
                          {id}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-[9px] text-nms-text-dim/60 italic">
                    No active tasks in queue
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

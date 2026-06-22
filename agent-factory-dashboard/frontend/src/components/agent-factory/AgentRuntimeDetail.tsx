import { AgentFactoryAgentView } from '../../types/agent-factory';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { PlayCircle, Clock, AlertOctagon, Activity } from 'lucide-react';

interface AgentRuntimeDetailProps {
  agent: AgentFactoryAgentView;
}

export function AgentRuntimeDetail({ agent }: AgentRuntimeDetailProps): JSX.Element {
  const { selectAdu } = useAgentFactoryStore();

  const handleTaskClick = (e: React.MouseEvent, targetType: string, targetId: string) => {
    e.stopPropagation();
    if (targetType === 'adu') {
      selectAdu(targetId);
      // scroll to top or specific element could go here
    } else {
      // For epic, a link to Epic dashboard could be used, assuming routing
      window.location.href = `/epics/${targetId}`;
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      
      {/* Column 1: Active & Queued Tasks */}
      <div className="space-y-4">
        <div>
          <h4 className="text-xs font-semibold text-nms-text mb-2 flex items-center gap-1.5">
            <PlayCircle className="w-3.5 h-3.5 text-nms-accent" /> Active Operations
          </h4>
          {agent.current_operations.length > 0 ? (
            <ul className="space-y-2">
              {agent.current_operations.map(op => (
                <li key={op.operation_id} className="bg-nms-surface-2/30 rounded p-2 text-xs border border-nms-surface-3">
                  <div className="flex justify-between items-start">
                    <button 
                      className="font-mono text-nms-accent hover:underline text-left"
                      onClick={(e) => handleTaskClick(e, op.target_type, op.target_id)}
                    >
                      {op.target_id}
                    </button>
                    <span className="text-[10px] text-nms-text-dim bg-nms-surface-2 px-1 rounded">{op.status}</span>
                  </div>
                  <div className="text-[10px] text-nms-text-dim mt-1">
                    {op.elapsed_seconds ? `Running for ${op.elapsed_seconds}s` : 'Starting...'}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-nms-text-dim italic">None</div>
          )}
        </div>

        <div>
          <h4 className="text-xs font-semibold text-nms-text mb-2 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-400" /> Queued Targets
          </h4>
          {agent.queued_targets.length > 0 ? (
            <ul className="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
              {agent.queued_targets.map(qt => (
                <li key={qt.target_id} className="bg-nms-surface-2/30 rounded p-2 text-xs border border-nms-surface-3">
                   <div className="flex justify-between items-start">
                    <button 
                      className="font-mono text-blue-400 hover:underline text-left truncate flex-1 pr-2"
                      onClick={(e) => handleTaskClick(e, qt.target_type, qt.target_id)}
                    >
                      {qt.target_id}
                    </button>
                    <span className="text-[10px] text-nms-text-dim bg-nms-surface-2 px-1 rounded shrink-0">{qt.state}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-nms-text-dim italic">Queue is empty</div>
          )}
        </div>
      </div>

      {/* Column 2: Attention Items */}
      <div className="space-y-4">
        <h4 className="text-xs font-semibold text-amber-400 mb-2 flex items-center gap-1.5">
          <AlertOctagon className="w-3.5 h-3.5" /> Needs Attention
        </h4>
        {agent.attention_items.length > 0 ? (
          <ul className="space-y-2">
            {agent.attention_items.map(item => (
              <li key={item.id} className="bg-amber-500/5 rounded p-2 text-xs border border-amber-500/20">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-amber-400">{item.kind.replace('_', ' ')}</span>
                  <button 
                    className="font-mono text-[10px] text-nms-accent hover:underline shrink-0"
                    onClick={(e) => handleTaskClick(e, item.target_type, item.target_id)}
                  >
                    {item.target_id}
                  </button>
                </div>
                <div className="text-nms-text-dim mt-1">{item.summary}</div>
                {item.recommended_action && (
                  <div className="text-[10px] text-amber-400/80 mt-1.5 pt-1.5 border-t border-amber-500/10">
                    Action: {item.recommended_action}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-xs text-nms-text-dim italic">All clear</div>
        )}
      </div>

      {/* Column 3: Run History & Stats */}
      <div className="space-y-4">
        <h4 className="text-xs font-semibold text-nms-text mb-2 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-slate-400" /> Statistics
        </h4>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="bg-nms-surface-2/30 rounded py-2 border border-nms-surface-3/50">
            <div className="text-[10px] text-nms-text-dim">Total Runs</div>
            <div className="text-sm font-bold text-nms-text mt-0.5">{agent.total_runs}</div>
          </div>
          <div className="bg-nms-surface-2/30 rounded py-2 border border-nms-surface-3/50">
            <div className="text-[10px] text-nms-text-dim">Success Rate</div>
            <div className="text-sm font-bold text-nms-text mt-0.5">{agent.success_rate !== null ? `${agent.success_rate}%` : '-'}</div>
          </div>
          <div className="bg-nms-surface-2/30 rounded py-2 border border-nms-surface-3/50">
            <div className="text-[10px] text-nms-text-dim">Format Errors</div>
            <div className="text-sm font-bold text-amber-400 mt-0.5">{agent.unstructured_runs}</div>
          </div>
          <div className="bg-nms-surface-2/30 rounded py-2 border border-nms-surface-3/50">
            <div className="text-[10px] text-nms-text-dim">Failed</div>
            <div className="text-sm font-bold text-red-400 mt-0.5">{agent.failed_runs}</div>
          </div>
        </div>
      </div>

    </div>
  );
}

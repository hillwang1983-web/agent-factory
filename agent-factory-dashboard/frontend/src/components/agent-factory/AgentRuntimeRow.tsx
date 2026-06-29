import { useState } from 'react';
import { AgentFactoryAgentView, AgentRuntimeStatus } from '../../types/agent-factory';
import { AgentRuntimeDetail } from './AgentRuntimeDetail';
import { ChevronDown, ChevronRight, Check, X, AlertTriangle, Bot, Activity } from 'lucide-react';

interface AgentRuntimeRowProps {
  agent: AgentFactoryAgentView;
}

const STATUS_CONFIG: Record<AgentRuntimeStatus, { label: string; dotClass: string }> = {
  running: { label: 'Running', dotClass: 'bg-emerald-400' },
  ready: { label: 'Ready', dotClass: 'bg-blue-400' },
  needs_attention: { label: 'Needs attention', dotClass: 'bg-amber-400' },
  idle: { label: 'Idle', dotClass: 'bg-slate-400' }
};

export function AgentRuntimeRow({ agent }: AgentRuntimeRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const statusCfg = STATUS_CONFIG[agent.runtime_status] || STATUS_CONFIG.idle;

  // Format "time ago" for last_run_at
  const timeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const ms = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const getResultIcon = (result: string | undefined) => {
    switch (result) {
      case 'success': return <Check className="w-3 h-3 text-emerald-400" />;
      case 'failed': return <X className="w-3 h-3 text-red-400" />;
      case 'human_gate': return <AlertTriangle className="w-3 h-3 text-amber-400" />;
      case 'unstructured': return <AlertTriangle className="w-3 h-3 text-amber-400" />;
      default: return <Activity className="w-3 h-3 text-slate-400" />;
    }
  };

  // Determine current/next task label
  let taskLabel = <span className="text-nms-text-dim italic">No active task</span>;
  if (agent.current_operations.length > 0) {
    const op = agent.current_operations[0];
    taskLabel = <span>Working on <span className="font-mono text-nms-accent bg-nms-accent/10 px-1 rounded">{op.target_id}</span></span>;
  } else if (agent.queued_targets.length > 0) {
    const qt = agent.queued_targets[0];
    const extra = agent.queued_targets.length > 1 ? ` (+${agent.queued_targets.length - 1} more)` : '';
    taskLabel = <span>Next: <span className="font-mono text-blue-400 bg-blue-400/10 px-1 rounded">{qt.target_id}</span>{extra}</span>;
  }

  return (
    <div className="group border-b border-nms-surface-2/20 last:border-0">
      {/* Desktop View */}
      <div
        className="hidden md:grid grid-cols-12 gap-4 p-4 hover:bg-nms-surface-2/30 cursor-pointer items-center transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="col-span-3 flex items-start gap-2">
          {expanded ? <ChevronDown className="w-4 h-4 text-nms-text-dim shrink-0 mt-0.5" /> : <ChevronRight className="w-4 h-4 text-nms-text-dim shrink-0 mt-0.5" />}
          <Bot className="w-4 h-4 text-nms-text-dim shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-nms-text break-words">{agent.id}</div>
            <div className="text-[10px] text-nms-text-dim truncate">{agent.description}</div>
          </div>
        </div>

        <div className="col-span-2 flex flex-col justify-center">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${statusCfg.dotClass} ${agent.runtime_status === 'running' && !agent.stale_warning.stale ? 'animate-pulse' : ''}`} />
            <span className="text-xs font-medium text-nms-text">{statusCfg.label}</span>
          </div>
          {agent.stale_warning.stale && (
            <div className="text-[10px] text-amber-400 mt-0.5 truncate">
              heartbeat delayed
            </div>
          )}
        </div>

        <div className="col-span-3 text-xs text-nms-text truncate">
          {taskLabel}
        </div>

        <div className="col-span-2 flex items-center gap-1.5 text-xs text-nms-text truncate">
          {agent.last_result ? (
            <>
              {getResultIcon(agent.last_result.result)}
              <span className="truncate">{agent.last_result.result}</span>
            </>
          ) : (
            <span className="text-nms-text-dim">None</span>
          )}
        </div>

        <div className="col-span-1 text-center">
          {agent.success_rate !== null ? (
            <div className="text-xs font-medium text-nms-text">
              {agent.success_rate}%
              <div className="text-[9px] text-nms-text-dim font-normal">
                {agent.success_runs} / {agent.total_runs}
              </div>
            </div>
          ) : (
            <span className="text-xs text-nms-text-dim">-</span>
          )}
        </div>

        <div className="col-span-1 text-right text-xs text-nms-text-dim" title={agent.last_run_at || 'Never'}>
          {timeAgo(agent.last_run_at)}
        </div>
      </div>

      {/* Mobile View */}
      <div
        className="md:hidden p-3 hover:bg-nms-surface-2/30 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex justify-between items-start mb-2 gap-2">
          <div className="flex items-start gap-2 flex-1">
            {expanded ? <ChevronDown className="w-4 h-4 text-nms-text-dim shrink-0 mt-0.5" /> : <ChevronRight className="w-4 h-4 text-nms-text-dim shrink-0 mt-0.5" />}
            <div>
              <div className="text-sm font-semibold text-nms-text break-words">{agent.id}</div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dotClass} ${agent.runtime_status === 'running' && !agent.stale_warning.stale ? 'animate-pulse' : ''}`} />
                <span className="text-xs text-nms-text-dim">{statusCfg.label}</span>
                {agent.stale_warning.stale && <span className="text-[10px] text-amber-400 ml-1">delayed</span>}
              </div>
            </div>
          </div>
          <div className="text-[10px] text-nms-text-dim whitespace-nowrap text-right">
            {timeAgo(agent.last_run_at)}
          </div>
        </div>

        <div className="flex flex-wrap justify-between items-end gap-2 text-xs pl-6">
          <div className="text-nms-text">
            {taskLabel}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-nms-text-dim">
              {getResultIcon(agent.last_result?.result)}
              {agent.last_result?.result || 'None'}
            </div>
            {agent.success_rate !== null && (
              <div className="text-nms-text-dim font-medium">
                {agent.success_rate}%
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Details Expansion */}
      {expanded && (
        <div className="px-4 pb-4 md:pl-11 md:pr-4">
          <div className="pt-3 border-t border-nms-surface-2/30">
            <AgentRuntimeDetail agent={agent} />
          </div>
        </div>
      )}
    </div>
  );
}

import type { AgentFactoryDashboard } from '../../types/agent-factory';
import { Bot, Workflow, Activity, CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react';

interface SummaryStripProps {
  dashboard: AgentFactoryDashboard | null;
}

export function SummaryStrip({ dashboard }: SummaryStripProps): JSX.Element {
  if (!dashboard) {
    return <div className="animate-pulse h-16 bg-nms-surface-2/20 rounded-lg" />;
  }

  const { summary, registry_valid } = dashboard;

  return (
    <div className="space-y-4">
      {/* Registry Health Banner */}
      {!registry_valid && (
        <div className="nms-card bg-red-500/10 border-red-500/20 text-red-400 p-3 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div className="text-xs font-semibold">
            Agent Factory Registry Error: One or more registry JSON files (.ai-agent/registry/*.json) are missing or invalid.
          </div>
        </div>
      )}

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Total ADUs */}
        <div className="nms-card p-4 flex items-center justify-between bg-nms-surface-1 border-nms-surface-2">
          <div>
            <div className="text-xs text-nms-text-dim">Total ADUs</div>
            <div className="text-xl font-bold mt-1 text-nms-text">{summary.total_adus}</div>
          </div>
          <Workflow className="w-8 h-8 text-nms-text-dim/30" />
        </div>

        {/* Active ADUs */}
        <div className="nms-card p-4 flex items-center justify-between bg-nms-surface-1 border-nms-surface-2">
          <div>
            <div className="text-xs text-nms-text-dim">Active ADUs</div>
            <div className="text-xl font-bold mt-1 text-nms-accent">{summary.active_adus}</div>
          </div>
          <Activity className="w-8 h-8 text-nms-accent/30" />
        </div>

        {/* Evidenced ADUs */}
        <div className="nms-card p-4 flex items-center justify-between bg-nms-surface-1 border-nms-surface-2">
          <div>
            <div className="text-xs text-nms-text-dim">Completed ADUs</div>
            <div className="text-xl font-bold mt-1 text-emerald-400">{summary.evidenced_adus}</div>
          </div>
          <CheckCircle className="w-8 h-8 text-emerald-400/30" />
        </div>

        {/* Human Gate */}
        <div className="nms-card p-4 flex items-center justify-between bg-nms-surface-1 border-nms-surface-2">
          <div>
            <div className="text-xs text-nms-text-dim">Human Gate</div>
            <div className="text-xl font-bold mt-1 text-amber-400">{summary.human_gate_adus}</div>
          </div>
          <AlertTriangle className="w-8 h-8 text-amber-400/30" />
        </div>

        {/* Total Runs */}
        <div className="nms-card p-4 flex items-center justify-between bg-nms-surface-1 border-nms-surface-2">
          <div>
            <div className="text-xs text-nms-text-dim">Total Agent Runs</div>
            <div className="text-xl font-bold mt-1 text-nms-text">{summary.total_runs}</div>
          </div>
          <Bot className="w-8 h-8 text-nms-text-dim/30" />
        </div>

        {/* Success Rate */}
        <div className="nms-card p-4 flex items-center justify-between bg-nms-surface-1 border-nms-surface-2">
          <div>
            <div className="text-xs text-nms-text-dim">Run Success Rate</div>
            <div className="text-xl font-bold mt-1 text-emerald-400">
              {summary.total_runs > 0
                ? `${Math.round((summary.success_runs / summary.total_runs) * 100)}%`
                : '100%'}
            </div>
          </div>
          <CheckCircle className="w-8 h-8 text-emerald-400/30" />
        </div>
      </div>
    </div>
  );
}

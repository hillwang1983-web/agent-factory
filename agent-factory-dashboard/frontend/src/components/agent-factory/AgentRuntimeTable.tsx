import { useState, useEffect, useCallback, useRef } from 'react';
import { agentFactoryApi } from '../../api/agentFactory';
import { AgentFactoryAgentView, AgentRuntimeStatus } from '../../types/agent-factory';
import { AgentRuntimeFilters } from './AgentRuntimeFilters';
import { AgentRuntimeRow } from './AgentRuntimeRow';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { useAgentFactoryStore } from '../../stores/agentFactory';

export function AgentRuntimeTable(): JSX.Element {
  const { selectedAduId, dashboard } = useAgentFactoryStore();
  const [scope, setScope] = useState<'global' | 'adu'>('global');
  const [statusFilter, setStatusFilter] = useState<AgentRuntimeStatus[]>([]);
  const [search, setSearch] = useState('');

  const [data, setData] = useState<{
    summary: any;
    agents: AgentFactoryAgentView[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // If no ADU is selected, scope must be global
  useEffect(() => {
    if (!selectedAduId && scope === 'adu') {
      setScope('global');
    }
  }, [selectedAduId, scope]);

  const requestCounter = useRef(0);

  const fetchData = useCallback(async (isPolling = false) => {
    const currentRequestId = ++requestCounter.current;
    if (!isPolling) setLoading(true);
    try {
      const res = await agentFactoryApi.fetchAgentRuntimeStatus({
        scope: selectedAduId ? scope : 'global',
        aduId: selectedAduId || undefined,
        status: statusFilter,
        search
      });
      // Ignore if a newer request has been initiated
      if (currentRequestId !== requestCounter.current) return;
      setData({ summary: res.summary, agents: res.agents });
      setError(null);
    } catch (err: any) {
      if (currentRequestId !== requestCounter.current) return;
      setError(err.message || 'Failed to load agent status');
    } finally {
      if (currentRequestId === requestCounter.current) {
        setLoading(false);
      }
    }
  }, [scope, selectedAduId, statusFilter, search]);

  // Fetch on mount, parameters change, or dashboard WebSocket update
  useEffect(() => {
    void fetchData(true); // use isPolling=true to avoid flashing the loading spinner on WS updates
  }, [fetchData, dashboard?.generated_at]);

  // Fallback 5s polling
  useEffect(() => {
    const interval = setInterval(() => void fetchData(true), 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div className="space-y-4">
      <AgentRuntimeFilters
        scope={scope}
        onScopeChange={setScope}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        search={search}
        onSearchChange={setSearch}
        hasSelectedAdu={!!selectedAduId}
        summary={data?.summary}
      />

      {error ? (
        <div className="nms-card border-red-500/20 bg-red-500/5 text-red-400 p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div className="text-sm">
            <h3 className="font-semibold">Error Loading Status</h3>
            <p className="mt-1">{error}</p>
          </div>
        </div>
      ) : loading && !data ? (
        <div className="nms-card p-12 flex flex-col items-center justify-center text-nms-text-dim">
          <RefreshCw className="w-6 h-6 animate-spin mb-4" />
          <p className="text-sm">Loading agent status...</p>
        </div>
      ) : data?.agents.length === 0 ? (
        <div className="nms-card p-12 text-center text-nms-text-dim border-dashed">
          <p className="text-sm">
            {search || statusFilter.length > 0
              ? 'No agents match your current filters.'
              : scope === 'adu'
                ? 'Current ADU does not involve any agents.'
                : 'No registered agents found.'}
          </p>
        </div>
      ) : (
        <div className="nms-card overflow-hidden">
          {/* Desktop Table Header */}
          <div className="hidden md:grid grid-cols-12 gap-4 p-4 border-b border-nms-surface-2/60 bg-nms-surface-2/20 text-xs font-semibold text-nms-text-dim">
            <div className="col-span-3">Agent</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-3">Current / Next Task</div>
            <div className="col-span-2">Last Result</div>
            <div className="col-span-1 text-center">Success</div>
            <div className="col-span-1 text-right">Updated</div>
          </div>

          <div className="divide-y divide-nms-surface-2/40">
            {data?.agents.map(agent => (
              <AgentRuntimeRow key={agent.id} agent={agent} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { useAgentFactoryStore } from '../../stores/agentFactory';
import { HealthBadge } from './HealthBadge';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { useState } from 'react';

export function AduQueuePanel(): JSX.Element {
  const { dashboard, selectedAduId, selectAdu, selectedProjectId } = useAgentFactoryStore();
  const [searchQuery, setSearchQuery] = useState('');

  if (!dashboard) {
    return (
      <div className="nms-card p-6 text-center text-sm text-nms-text-dim">
        Loading ADU Queue...
      </div>
    );
  }

  const { adus } = dashboard;

  const filteredAdus = adus.filter((adu) => {
    if (selectedProjectId && adu.project_id !== selectedProjectId) {
      return false;
    }
    const q = searchQuery.toLowerCase();
    return (
      adu.id.toLowerCase().includes(q) ||
      adu.title.toLowerCase().includes(q) ||
      adu.goal.toLowerCase().includes(q)
    );
  });

  return (
    <div className="nms-card bg-nms-surface-1 border-nms-surface-2 flex flex-col h-[650px]">
      <div className="p-4 border-b border-nms-surface-2">
        <h2 className="text-base font-semibold text-nms-text">ADU Requirements Queue</h2>
        <p className="text-xs text-nms-text-dim mt-0.5">Select a requirement to monitor its state</p>
        <div className="mt-3">
          <input
            type="text"
            placeholder="Search ADUs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs bg-nms-surface-2 border border-nms-surface-3 rounded px-2.5 py-1.5 text-nms-text placeholder-nms-text-dim/50 focus:outline-none focus:border-nms-accent"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-nms-surface-2">
        {filteredAdus.length === 0 ? (
          <div className="p-6 text-center text-xs text-nms-text-dim">
            No requirements match search.
          </div>
        ) : (
          filteredAdus.map((adu) => {
            const isSelected = adu.id === selectedAduId;
            return (
              <button
                key={adu.id}
                onClick={() => selectAdu(adu.id)}
                className={`w-full text-left p-4 transition-colors flex flex-col gap-2 hover:bg-nms-surface-2/40 ${
                  isSelected ? 'bg-nms-surface-2 border-l-2 border-nms-accent' : 'bg-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-nms-text">{adu.id}</span>
                  <HealthBadge status={adu.health.status} />
                </div>

                <h3 className="text-xs font-semibold text-nms-text line-clamp-1">{adu.title}</h3>

                <div className="flex items-center gap-3 text-[10px] text-nms-text-dim">
                  <span>Level: <strong className="text-nms-text">{adu.target_level}</strong></span>
                  <span>Risk: <strong className="text-nms-text uppercase">{adu.risk}</strong></span>
                  {adu.retry_count > 0 && (
                    <span className="flex items-center gap-0.5 text-amber-400">
                      <RotateCcw className="w-2.5 h-2.5" /> {adu.retry_count}/{adu.max_retries}
                    </span>
                  )}
                  {adu.display_status?.kind === 'blocked' && (
                    <span className="flex items-center gap-0.5 text-red-400" title={adu.display_status.reason}>
                      <AlertCircle className="w-2.5 h-2.5" /> Blocked
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

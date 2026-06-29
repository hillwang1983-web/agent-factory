import { Search } from 'lucide-react';
import { AgentRuntimeStatus } from '../../types/agent-factory';

interface AgentRuntimeFiltersProps {
  scope: 'global' | 'adu';
  onScopeChange: (scope: 'global' | 'adu') => void;
  statusFilter: AgentRuntimeStatus[];
  onStatusFilterChange: (status: AgentRuntimeStatus[]) => void;
  search: string;
  onSearchChange: (search: string) => void;
  hasSelectedAdu: boolean;
  summary?: any;
}

const STATUS_OPTIONS: { value: AgentRuntimeStatus; label: string; colorClass: string }[] = [
  { value: 'running', label: 'Running', colorClass: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  { value: 'ready', label: 'Ready', colorClass: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  { value: 'needs_attention', label: 'Needs Attention', colorClass: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  { value: 'idle', label: 'Idle', colorClass: 'text-slate-400 bg-slate-400/10 border-slate-400/20' },
];

export function AgentRuntimeFilters({
  scope,
  onScopeChange,
  statusFilter,
  onStatusFilterChange,
  search,
  onSearchChange,
  hasSelectedAdu,
  summary
}: AgentRuntimeFiltersProps): JSX.Element {

  const toggleStatus = (status: AgentRuntimeStatus) => {
    if (statusFilter.includes(status)) {
      onStatusFilterChange(statusFilter.filter(s => s !== status));
    } else {
      onStatusFilterChange([...statusFilter, status]);
    }
  };

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      {/* Scope Toggle */}
      <div className="flex items-center gap-1 bg-nms-surface-2 p-1 rounded-lg">
        <button
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            scope === 'global' ? 'bg-nms-surface-1 text-nms-text shadow-sm' : 'text-nms-text-dim hover:text-nms-text'
          }`}
          onClick={() => onScopeChange('global')}
        >
          Global
        </button>
        <button
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            !hasSelectedAdu ? 'opacity-50 cursor-not-allowed' : ''
          } ${
            scope === 'adu' ? 'bg-nms-surface-1 text-nms-text shadow-sm' : 'text-nms-text-dim hover:text-nms-text'
          }`}
          onClick={() => hasSelectedAdu && onScopeChange('adu')}
          title={!hasSelectedAdu ? "Select an ADU from the queue to filter by it" : "Show only agents involved in the current ADU"}
        >
          Current ADU
        </button>
      </div>

      <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
        {/* Status Filters */}
        <div className="flex items-center gap-2">
          {STATUS_OPTIONS.map(opt => {
            const isSelected = statusFilter.includes(opt.value);
            const count = summary ? summary[opt.value] || 0 : 0;
            return (
              <button
                key={opt.value}
                onClick={() => toggleStatus(opt.value)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded-full transition-all ${
                  isSelected
                    ? `border-opacity-100 ${opt.colorClass}`
                    : 'border-nms-surface-3 text-nms-text-dim hover:border-nms-surface-4'
                }`}
              >
                {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                {opt.label}
                <span className="opacity-60 ml-0.5">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-nms-text-dim" />
          <input
            type="text"
            placeholder="Search agents..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="nms-input pl-9 text-xs py-1.5 w-[200px]"
          />
        </div>
      </div>
    </div>
  );
}

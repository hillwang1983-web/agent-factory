import { useState, useEffect } from 'react';
import { Terminal, CheckCircle2, XCircle, Play, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface OperationEvent {
  timestamp?: string;
  created_at?: string;
  type: string;
  payload: any;
  stream?: 'stdout' | 'stderr' | 'system';
}

interface Operation {
  id: string;
  targetType: 'adu' | 'epic';
  targetId: string;
  mode: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
  startedAt: string;
  endedAt?: string;
  pid?: number;
  exitCode?: number | null;
  finalState?: string;
  error?: string;
  events: OperationEvent[];
}

interface Props {
  operation: Operation | null;
}

export function OperationStatusPanel({ operation }: Props): JSX.Element {
  const [showStderr, setShowStderr] = useState(false);

  // Auto-expand stderr on failure
  useEffect(() => {
    if (operation?.status === 'failed') {
      setShowStderr(true);
    } else {
      setShowStderr(false);
    }
  }, [operation?.status]);

  if (!operation) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 text-center text-xs text-slate-500 italic">
        No active execution operation
      </div>
    );
  }

  const durationSec = (() => {
    const start = new Date(operation.startedAt).getTime();
    const end = operation.endedAt ? new Date(operation.endedAt).getTime() : Date.now();
    return Math.max(0, Math.round((end - start) / 1000));
  })();

  // Filter stderr lines
  const stderrLines = operation.events
    .filter((e) => e.stream === 'stderr')
    .map((e) => e.payload.line || String(e.payload))
    .filter(Boolean);

  // Filter structured stdout/system events (keep latest 20)
  const displayEvents = operation.events
    .filter((e) => e.stream !== 'stderr')
    .slice(-20)
    .reverse();

  // Try to find the latest active agent in the event stream
  const activeAgent = (() => {
    for (let i = operation.events.length - 1; i >= 0; i--) {
      const ev = operation.events[i];
      if (ev.payload?.agent_id || ev.payload?.agent) {
        return ev.payload.agent_id || ev.payload.agent;
      }
    }
    return null;
  })();

  let statusBg = 'bg-slate-800/40 text-slate-400 border-slate-700';
  let statusIcon = <Play className="w-3.5 h-3.5 animate-pulse text-cyan-400" />;
  if (operation.status === 'completed') {
    statusBg = 'bg-green-500/10 text-green-400 border-green-500/20';
    statusIcon = <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />;
  } else if (operation.status === 'failed') {
    statusBg = 'bg-red-500/10 text-red-400 border-red-500/20';
    statusIcon = <XCircle className="w-3.5 h-3.5 text-red-400" />;
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
      {/* Header Info */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-300">
            Operation: <strong className="text-slate-100 font-mono text-[11px]">{operation.mode}</strong>
          </span>
          <span className="text-slate-600 text-xs">|</span>
          <span className="text-[10px] font-mono text-slate-500">ID: {operation.id}</span>
        </div>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] uppercase font-semibold ${statusBg}`}>
          {statusIcon}
          <span>{operation.status}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 bg-slate-950 p-2.5 rounded border border-slate-800/40 text-[10px]">
        <div className="text-center border-r border-slate-800">
          <div className="text-slate-500">Duration</div>
          <div className="font-mono text-slate-300 font-semibold mt-0.5">{durationSec}s</div>
        </div>
        <div className="text-center border-r border-slate-800">
          <div className="text-slate-500">PID</div>
          <div className="font-mono text-slate-300 font-semibold mt-0.5">{operation.pid || '—'}</div>
        </div>
        <div className="text-center">
          <div className="text-slate-500">Active Agent</div>
          <div className="font-mono text-cyan-400 font-semibold mt-0.5 truncate px-1">{activeAgent || '—'}</div>
        </div>
      </div>

      {/* Stderr display */}
      {stderrLines.length > 0 && (
        <div className="border border-red-950/40 rounded bg-red-950/5 overflow-hidden">
          <button
            onClick={() => setShowStderr(!showStderr)}
            className="w-full flex items-center justify-between px-3 py-1.5 bg-red-950/10 hover:bg-red-950/20 text-red-400 font-medium text-[10px]"
          >
            <span className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Shell Stderr ({stderrLines.length} lines)</span>
            </span>
            {showStderr ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          
          {showStderr && (
            <pre className="p-3 text-[10px] font-mono text-red-300/95 overflow-x-auto max-h-[160px] divide-y divide-red-955/10 bg-slate-950">
              {stderrLines.join('\n')}
            </pre>
          )}
        </div>
      )}

      {/* Events log list */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold text-slate-400">Stdout Event Stream</div>
        <div className="bg-slate-950 border border-slate-800/40 rounded p-2.5 max-h-[180px] overflow-y-auto space-y-1.5 font-mono text-[9px]">
          {displayEvents.length === 0 ? (
            <div className="text-slate-600 text-center py-2 italic">Waiting for events...</div>
          ) : (
            displayEvents.map((e, idx) => {
              const rawTime = e.created_at || e.timestamp;
              const dateStr = rawTime ? new Date(rawTime).toLocaleTimeString() : '—';
              const payloadStr = JSON.stringify(e.payload);
              return (
                <div key={idx} className="flex gap-2 text-slate-400 hover:text-slate-300">
                  <span className="text-slate-600 flex-shrink-0">{dateStr}</span>
                  <span className="text-cyan-600 flex-shrink-0">[{e.type}]</span>
                  <span className="text-slate-300 truncate" title={payloadStr}>
                    {e.payload?.message || e.payload?.event || payloadStr}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

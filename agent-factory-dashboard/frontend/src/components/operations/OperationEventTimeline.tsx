import { useEffect, useState } from 'react';
import { agentFactoryApi } from '../../api/agentFactory';
import { Terminal, BadgeInfo, Flame } from 'lucide-react';

interface OperationEventTimelineProps {
  operationId: string | null;
}

export function OperationEventTimeline({ operationId }: OperationEventTimelineProps) {
  const [events, setEvents] = useState<any[]>([]);


  useEffect(() => {
    if (!operationId) {
      setEvents([]);
      return;
    }

    let active = true;
    const loadEvents = async () => {
      try {
        const data = await agentFactoryApi.fetchOperationEvents(operationId);
        if (active) {
          setEvents(data);
        }
      } catch (_) {}
    };

    loadEvents();
    const timer = setInterval(loadEvents, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [operationId]);

  if (!operationId) return null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col h-[400px] overflow-hidden">
      <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
        <Terminal className="h-4 w-4 text-cyan-400" />
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Operation Event Timeline</h3>
        <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full ml-auto">
          {events.length} 个事件
        </span>
      </div>

      <div className="flex-1 overflow-y-auto pr-1 space-y-4">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 text-xs">
            <BadgeInfo className="h-8 w-8 mb-2 opacity-30" />
            暂无此操作的详细事件记录
          </div>
        ) : (
          events.map((evt, idx) => {
            const timeStr = new Date(evt.created_at || evt.timestamp).toLocaleTimeString();
            return (
              <div key={evt.event_id || idx} className="flex gap-3 text-xs">
                <div className="flex flex-col items-center">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center border ${
                    evt.severity === 'error'
                      ? 'bg-red-950/40 border-red-800/80 text-red-400'
                      : evt.severity === 'warning'
                      ? 'bg-amber-950/40 border-amber-800/80 text-amber-400'
                      : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}>
                    {evt.severity === 'error' ? (
                      <Flame className="h-3 w-3" />
                    ) : (
                      <Terminal className="h-3 w-3" />
                    )}
                  </div>
                  {idx < events.length - 1 && (
                    <div className="w-px flex-1 bg-slate-800 mt-2" />
                  )}
                </div>

                <div className="flex-1 bg-slate-950/40 border border-slate-800/60 rounded-lg p-3">
                  <div className="flex justify-between items-center gap-2">
                    <span className="font-bold text-slate-200">{evt.type}</span>
                    <span className="text-[10px] text-slate-500">{timeStr}</span>
                  </div>
                  {evt.message && (
                    <p className="text-slate-400 mt-1 font-medium">{evt.message}</p>
                  )}
                  {evt.payload && Object.keys(evt.payload).length > 0 && (
                    <pre className="text-[10px] text-slate-500 font-mono mt-2 bg-black/30 p-2 rounded border border-slate-900/60 overflow-x-auto max-w-full">
                      {JSON.stringify(evt.payload, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

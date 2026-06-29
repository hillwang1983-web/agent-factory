import { useEffect, useState } from 'react';
import { agentFactoryApi } from '../../api/agentFactory';
import { Loader2, AlertCircle, CheckCircle2, UserCheck } from 'lucide-react';

interface OperationStatusBannerProps {
  targetType: 'adu' | 'epic';
  targetId: string;
  onNavigateToGates?: () => void;
}

export function OperationStatusBanner({ targetType, targetId, onNavigateToGates }: OperationStatusBannerProps) {
  const [operation, setOperation] = useState<any | null>(null);

  useEffect(() => {
    let active = true;
    const loadOp = async () => {
      try {
        const op = await agentFactoryApi.getLatestOperation(targetType, targetId);
        if (active) {
          setOperation(op);
        }
      } catch (_) {}
    };

    loadOp();
    const timer = setInterval(loadOp, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [targetType, targetId]);

  if (!operation) return null;


  return (
    <div className={`mb-6 p-4 rounded-xl border transition-all ${
      operation.status === 'running' || operation.status === 'spawning'
        ? 'bg-blue-950/40 border-blue-800/60 shadow-[0_0_15px_rgba(59,130,246,0.1)]'
        : operation.status === 'waiting_human'
        ? 'bg-amber-950/40 border-amber-800/60 shadow-[0_0_15px_rgba(245,158,11,0.1)]'
        : operation.status === 'completed'
        ? 'bg-emerald-950/40 border-emerald-800/60 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
        : 'bg-slate-950/40 border-slate-800/60'
    }`}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {operation.status === 'running' || operation.status === 'spawning' ? (
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20 text-blue-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : operation.status === 'waiting_human' ? (
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-amber-400 animate-pulse">
              <UserCheck className="h-5 w-5" />
            </div>
          ) : operation.status === 'completed' ? (
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center border border-red-500/20 text-red-400">
              <AlertCircle className="h-5 w-5" />
            </div>
          )}

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">操作编号:</span>
              <code className="text-xs text-white font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                {operation.operation_id || operation.id}
              </code>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                operation.status === 'running' || operation.status === 'spawning'
                  ? 'bg-blue-500/20 text-blue-300'
                  : operation.status === 'waiting_human'
                  ? 'bg-amber-500/20 text-amber-300'
                  : operation.status === 'completed'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-red-500/20 text-red-300'
              }`}>
                {operation.status === 'running' ? '运行中 (Running)' :
                 operation.status === 'spawning' ? '启动中 (Spawning)' :
                 operation.status === 'waiting_human' ? '等待人工 (Waiting Human)' :
                 operation.status === 'completed' ? '执行完成 (Completed)' : '失败 (Failed)'}
              </span>
            </div>
            <p className="text-sm font-semibold text-white mt-1">
              动作: <span className="text-indigo-400 capitalize">{operation.action || operation.mode}</span>
              {operation.current_agent && (
                <>
                  <span className="mx-2 text-slate-600">|</span>
                  当前 Agent: <span className="text-cyan-400">{operation.current_agent}</span>
                </>
              )}
              {operation.current_state && (
                <>
                  <span className="mx-2 text-slate-600">|</span>
                  阶段: <span className="text-pink-400">{operation.current_state}</span>
                </>
              )}
            </p>
          </div>
        </div>

        {operation.status === 'waiting_human' && onNavigateToGates && (
          <button
            onClick={onNavigateToGates}
            className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-lg shadow-amber-900/20"
          >
            <UserCheck className="h-4 w-4" />
            前往人工处理中心 (Go to Human Gate)
          </button>
        )}
      </div>
    </div>
  );
}

import type { AgentFactoryEpic } from '../../types/agent-factory';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { Play, StepForward, FastForward, Pause, Square, PackagePlus } from 'lucide-react';
import { useState } from 'react';

interface Props {
  epic: AgentFactoryEpic;
}

export function EpicControlPanel({ epic }: Props) {
  const { startEpic, continueEpic, stepEpic, cancelEpic, pauseEpic, materializeChildAdus } = useAgentFactoryStore();
  const [busy, setBusy] = useState(false);

  const isTerminal = ['epic_evidenced', 'epic_failed', 'canceled'].includes(epic.state);
  const canMaterialize = epic.state === 'split_required' && epic.child_adus.length === 0;

  const doAction = async (fn: (id: string) => Promise<void>) => {
    setBusy(true);
    try { await fn(epic.id); } catch (e) { console.error(e); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="text-xs font-semibold text-slate-400 mb-3">控制面板</div>
      <div className="flex flex-wrap gap-2">
        {!isTerminal && epic.state === 'created' && (
          <button onClick={() => doAction(startEpic)} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50">
            <Play className="h-3 w-3" /> 启动
          </button>
        )}
        {!isTerminal && epic.state !== 'created' && (
          <button onClick={() => doAction(continueEpic)} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-500 disabled:opacity-50">
            <FastForward className="h-3 w-3" /> 继续自动
          </button>
        )}
        {!isTerminal && (
          <button onClick={() => doAction(stepEpic)} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50">
            <StepForward className="h-3 w-3" /> 单步执行
          </button>
        )}
        {!isTerminal && (
          <button onClick={() => doAction(pauseEpic)} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50">
            <Pause className="h-3 w-3" /> 暂停
          </button>
        )}
        {canMaterialize && (
          <button onClick={() => doAction(materializeChildAdus)} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50">
            <PackagePlus className="h-3 w-3" /> 生成子ADU
          </button>
        )}
        {!isTerminal && (
          <button onClick={() => doAction(cancelEpic)} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50">
            <Square className="h-3 w-3" /> 取消
          </button>
        )}
      </div>
      {isTerminal && (
        <div className="text-xs text-slate-600 mt-2">
          Epic 已终止（{epic.state}）
        </div>
      )}
    </div>
  );
}

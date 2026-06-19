import type { AgentFactoryEpic } from '../../types/agent-factory';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { Play, StepForward, FastForward, Pause, Square, PackagePlus } from 'lucide-react';
import { useState, useEffect } from 'react';
import { OperationStatusPanel } from '../shared/OperationStatusPanel';
import { agentFactoryApi } from '../../api/agentFactory';

interface Props {
  epic: AgentFactoryEpic;
}

export function EpicControlPanel({ epic }: Props) {
  const { startEpic, continueEpic, stepEpic, cancelEpic, pauseEpic, materializeChildAdus, activeOperations, pollOperation } = useAgentFactoryStore();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);

  const activeOp = activeOperations[epic.id] || null;

  useEffect(() => {
    let active = true;
    const fetchLatest = async () => {
      try {
        const op = await agentFactoryApi.getLatestOperation('epic', epic.id);
        if (!active) return;
        if (op) {
          const currentTracked = useAgentFactoryStore.getState().activeOperations[epic.id];
          if (currentTracked?.id === op.id) {
            return;
          }

          useAgentFactoryStore.setState((state) => ({
            activeOperations: {
              ...state.activeOperations,
              [epic.id]: op,
            },
          }));

          if (op.status === 'running' || op.status === 'queued') {
            pollOperation(op.id, 'epic', epic.id);
          }
        }
      } catch (e) {
        console.error('Failed to fetch latest operation for epic:', e);
      }
    };

    fetchLatest();

    return () => {
      active = false;
    };
  }, [epic.id, pollOperation]);

  const isTerminal = ['epic_evidenced', 'epic_failed', 'canceled'].includes(epic.state);
  const canMaterialize = ['split_decision', 'split_required'].includes(epic.state) && (!epic.child_adus || epic.child_adus.length === 0);

  const hasRunningChild = epic.child_adus?.some(childId => {
    const childOp = activeOperations[childId];
    return childOp && ['queued', 'spawning', 'running'].includes(childOp.status);
  }) || false;

  const isDisabled = busy || !!activeOp || hasRunningChild;
  const nextActionHint: Record<string, string> = {
    created: '下一步：启动 system-flow-designer，生成系统链路设计。',
    flow_designed: '下一步：单步执行 adu-splitter，生成拆分方案。',
    split_decision: '下一步：单步执行，确认拆分方案的决策结果。',
    split_required: '下一步：生成子ADU，将拆分方案物化为可执行需求。',
    child_adus_created: '下一步：继续自动或单步执行子 ADU 流程。',
    child_adus_running: '下一步：等待当前子 ADU 流转，或继续自动推进。',
    child_adus_blocked: '下一步：处理阻塞的子 ADU 审核/返工。',
  };

  const getErrorMessage = (error: unknown) => {
    const raw = error instanceof Error ? error.message : String(error);
    if (raw.includes('already running') || raw.includes('409')) {
      return '已有 Epic 编排任务正在运行，请等待当前 Agent 完成后再操作。';
    }
    return raw || '操作失败，请查看后端日志。';
  };

  const doAction = async (label: string, fn: (id: string) => Promise<void>) => {
    setBusy(true);
    setMessage({ type: 'info', text: `${label}请求已发送，正在等待后端响应...` });
    try {
      await fn(epic.id);
      setMessage({ type: 'success', text: `${label}请求已提交，页面会自动刷新执行状态。` });
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: getErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
      <div>
        <div className="text-xs font-semibold text-slate-400 mb-3">控制面板</div>
        {nextActionHint[epic.state] && (
          <div className="mb-3 rounded border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-300">
            {nextActionHint[epic.state]}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {!isTerminal && epic.state === 'created' && (
            <button onClick={() => doAction('启动', startEpic)} disabled={isDisabled}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50">
              <Play className="h-3 w-3" /> {busy ? '执行中...' : '启动'}
            </button>
          )}
          {!isTerminal && epic.state !== 'created' && (
            <button onClick={() => doAction('继续自动', continueEpic)} disabled={isDisabled}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-500 disabled:opacity-50">
              <FastForward className="h-3 w-3" /> {
                epic.state === 'child_adus_created'
                  ? '启动可运行子 ADU'
                  : (epic.state === 'child_adus_running'
                      ? `继续自动 (运行中: ${epic.summary?.running_child_adus || 0})`
                      : '继续自动')
              }
            </button>
          )}
          {!isTerminal && (
            <button onClick={() => doAction('单步执行', stepEpic)} disabled={isDisabled}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50">
              <StepForward className="h-3 w-3" /> 单步执行
            </button>
          )}
          {!isTerminal && (
            <button onClick={() => doAction('暂停', pauseEpic)} disabled={busy}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50">
              <Pause className="h-3 w-3" /> 暂停
            </button>
          )}
          {canMaterialize && (
            <button onClick={() => doAction('生成子ADU', materializeChildAdus)} disabled={isDisabled}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50">
              <PackagePlus className="h-3 w-3" /> 生成子ADU
            </button>
          )}
          {!isTerminal && (
            <button onClick={() => doAction('取消', cancelEpic)} disabled={busy}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50">
              <Square className="h-3 w-3" /> 取消
            </button>
          )}
        </div>
        {message && (
          <div className={`mt-3 rounded border px-3 py-2 text-xs space-y-1 ${
            message.type === 'error'
              ? 'border-red-800 bg-red-950/40 text-red-200'
              : message.type === 'success'
                ? 'border-green-800 bg-green-950/40 text-green-200'
                : 'border-cyan-800 bg-cyan-950/40 text-cyan-200'
          }`}>
            <div>{message.text}</div>
            {message.type === 'error' && (
              <div className="text-[10px] text-red-400">
                {message.text.includes('timeout') && '💡 [排查提示] 进程由于超时被终止。请检查执行计划是否过于复杂，或目标文件有无死循环依赖。如持续超时请考虑拆分需求，不要通过增大超时掩盖问题。'}
                {message.text.includes('already running') && '💡 [排查提示] 竞争锁冲突。另一个实例或进程正在独占此 Epic 编排任务。请等待其结束或在后台清理 PID 锁后重试。'}
                {message.text.includes('budget') && '💡 [排查提示] 溢出 Token 预算熔断。当前 prompt 大小或预计 token 超过限制，已安全熔断。请检查 Focused Payload Pruning 剪枝配置。'}
              </div>
            )}
          </div>
        )}
        {isTerminal && (
          <div className="text-xs text-slate-600 mt-2">
            Epic 已终止（{epic.state}）
          </div>
        )}
      </div>
      <div className="border-t border-slate-800 pt-4">
        <OperationStatusPanel operation={activeOp} />
      </div>
    </div>
  );
}

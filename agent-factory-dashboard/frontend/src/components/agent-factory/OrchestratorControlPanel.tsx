import { useState, useEffect } from 'react';
import { RefreshCw, Play, Pause, X, Lock, SkipForward, AlertTriangle } from 'lucide-react';
import { agentFactoryApi } from '../../api/agentFactory';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { HumanGateDispositionPanel } from './HumanGateDispositionPanel';

interface OrchestratorControlPanelProps {
  aduId?: string;
}

export function OrchestratorControlPanel({ aduId }: OrchestratorControlPanelProps): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<'start' | 'pause' | 'continue' | 'cancel' | 'step' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>('zh');

  const { controlEnabled, dashboard, activeOperations } = useAgentFactoryStore();
  const adu = dashboard?.adus.find((a) => a.id === aduId);
  const activeOp = aduId ? activeOperations[aduId] : null;

  useEffect(() => {
    if (adu?.language) {
      setLanguage(adu.language);
    }
  }, [aduId, adu?.language]);

  const handleAction = async (action: 'start' | 'pause' | 'continue' | 'cancel' | 'step') => {
    if (!controlEnabled) return;
    if (!aduId) return;
    setLoading(true);
    setPendingAction(action);
    setError(null);
    try {
      if (action === 'start') await agentFactoryApi.startOrchestrator(aduId, language);
      else if (action === 'pause') await agentFactoryApi.pauseAdu(aduId);
      else if (action === 'continue') await agentFactoryApi.continueAdu(aduId);
      else if (action === 'cancel') await agentFactoryApi.cancelAdu(aduId);
      else if (action === 'step') {
        const store = useAgentFactoryStore.getState();
        await store.runNextStep(aduId);
      }
      if (action !== 'step') {
        void useAgentFactoryStore.getState().refresh();
      }
    } catch (e) {
      console.error(e);
      setError((e as Error).message ?? '操作失败');
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  };

  if (!controlEnabled) {
    return (
      <div className="nms-card bg-nms-surface-1 border-nms-surface-2 p-4 space-y-2">
        <h2 className="text-base font-semibold text-nms-text">编排控制面板</h2>
        <div className="flex items-center gap-2 p-3 bg-nms-surface-2/40 border border-nms-border rounded-md text-xs text-nms-text-dim">
          <Lock className="w-4 h-4 text-nms-amber flex-shrink-0" />
          <span>当前为只读监控模式。要启动编排器、暂停或取消任务，请启动服务时传入环境变量 <code>AGENT_FACTORY_ENABLE_CONTROL=true</code>。</span>
        </div>
      </div>
    );
  }

  const isActionPending = loading || pendingAction !== null;
  const isRunning = adu?.health.status === 'running' || isActionPending || !!(activeOp && ['queued', 'spawning', 'running'].includes(activeOp.status));
  const isTerminal = adu?.state === 'evidenced' || adu?.state === 'mvp_ready';
  const isCanceled = adu?.state === 'canceled';
  const isReviewGate = adu?.state === 'analysis_review' || adu?.state === 'design_review';
  const isHumanGate = adu?.state === 'human_gate';

  const canStart = adu?.state === 'created' || adu?.state === 'canceled' || adu?.state === 'failed';
  const startButtonText = adu?.state === 'created' ? '自动执行' : '重新开始';
  const isStartDisabled = isActionPending || !adu || isRunning || isReviewGate || !canStart;
  const isPauseDisabled = isActionPending || !adu || !isRunning;
  const isContinueDisabled = isActionPending || !adu || isRunning || isTerminal || isReviewGate;
  const isStepDisabled = isActionPending || !adu || isRunning || isTerminal || isReviewGate;
  const isCancelDisabled = isActionPending || !adu || isCanceled || isTerminal;
  const actionLabel = pendingAction === 'step'
    ? '单步执行中...'
    : pendingAction === 'start'
      ? '启动中...'
      : pendingAction === 'continue'
        ? '继续执行中...'
        : pendingAction === 'pause'
          ? '暂停中...'
          : pendingAction === 'cancel'
            ? '取消中...'
            : null;

  return (
    <div className="nms-card bg-nms-surface-1 border-nms-surface-2 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-nms-text">编排控制面板</h2>
      </div>

      {isReviewGate && (
        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-xs text-amber-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">
              当前流程停在：{adu.state === 'analysis_review' ? '需求分析审核' : '详细设计审核'}。
            </span>
            <span>请在上方审核面板中检查、修改并批准该文档，然后方可继续执行后续步骤。</span>
          </div>
        </div>
      )}

      {isHumanGate && adu && (
        <HumanGateDispositionPanel adu={adu} />
      )}

      {error && (
        <div className="rounded border border-red-800 bg-red-950/40 p-3 text-xs text-red-200 space-y-1">
          <span className="font-bold">操作失败:</span> {error}
          <div className="text-[10px] text-red-400">
            {error.includes('timeout') && '💡 [排查提示] 进程由于超时被终止。请检查执行计划是否过于复杂，或目标文件有无死循环依赖。确认后重试。如持续超时请拆分需求。'}
            {error.includes('already being processed') && '💡 [排查提示] 该 ADU 当前已被锁定。另一个实例或进程正在独占此 ADU 运行锁。请等待其结束或在后台清理 PID 锁后重试。'}
            {error.includes('budget') && '💡 [排查提示] 溢出 Token 预算熔断。当前 prompt 大小或预计 token 超过限制，已安全熔断。请检查 Focused Payload Pruning 剪枝配置。'}
          </div>
        </div>
      )}
      {actionLabel && <div className="text-xs text-nms-text-dim">{actionLabel}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => void handleAction('start')}
            disabled={isStartDisabled}
            className="nms-btn-primary flex items-center gap-1 text-xs"
            title={isReviewGate ? '需要通过审核门' : startButtonText === '自动执行' ? '开始自动流转' : '重新开始执行整个进度'}
          >
            <Play className="w-3.5 h-3.5" /> {startButtonText}
          </button>

          <button
            onClick={() => void handleAction('step')}
            disabled={isStepDisabled}
            className="nms-btn-ghost border border-nms-surface-3 flex items-center gap-1 text-xs text-nms-text hover:bg-nms-surface-2"
            title={isReviewGate ? '需要通过审核门' : '只执行下一步'}
          >
            <SkipForward className="w-3.5 h-3.5" /> {pendingAction === 'step' ? '执行中...' : '单步执行'}
          </button>

          <button
            onClick={() => void handleAction('pause')}
            disabled={isPauseDisabled}
            className="nms-btn-ghost flex items-center gap-1 text-xs"
          >
            <Pause className="w-3.5 h-3.5" /> 暂停
          </button>

          <button
            onClick={() => void handleAction('continue')}
            disabled={isContinueDisabled}
            className="nms-btn-ghost flex items-center gap-1 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 继续自动
          </button>

          <button
            onClick={() => void handleAction('cancel')}
            disabled={isCancelDisabled}
            className="nms-btn-danger flex items-center gap-1 text-xs"
          >
            <X className="w-3.5 h-3.5" /> 取消
          </button>
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-nms-text-dim">文档语言:</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={loading || isRunning}
            className="bg-nms-surface-2 text-nms-text text-xs border border-nms-surface-3 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-nms-accent"
          >
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>
    </div>
  );
}

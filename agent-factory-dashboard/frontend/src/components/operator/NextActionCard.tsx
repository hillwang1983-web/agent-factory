import { useEffect, useState } from 'react';
import { fetchNextAction, executeOperatorAction } from '../../api/agentFactory';
import { OperatorNextAction } from '../../types/operator';
import { Play, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

interface NextActionCardProps {
  targetType: 'adu' | 'epic';
  targetId: string;
  onActionCompleted?: () => void;
}

export function NextActionCard({ targetType, targetId, onActionCompleted }: NextActionCardProps): JSX.Element {
  const [nextAction, setNextAction] = useState<OperatorNextAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, any>>({});

  const loadNextAction = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNextAction(targetType, targetId);
      setNextAction(res);
      // Initialize inputs
      const initVals: Record<string, any> = {};
      if (res?.required_inputs) {
        res.required_inputs.forEach((input: any) => {
          initVals[input.key] = '';
        });
      }
      setInputValues(initVals);
    } catch (e: any) {
      setError(e.message || 'Failed to load recommended action');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadNextAction();
  }, [targetType, targetId]);

  const handleInputChange = (key: string, value: any) => {
    setInputValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleExecute = async () => {
    if (!nextAction?.recommended_action) return;
    setExecuting(true);
    setError(null);
    try {
      const idempotencyKey = `op-action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await executeOperatorAction(targetType, targetId, {
        action: nextAction.recommended_action,
        idempotency_key: idempotencyKey,
        requested_by: 'human',
        payload: inputValues,
      });
      await loadNextAction();
      if (onActionCompleted) onActionCompleted();
    } catch (e: any) {
      setError(e.message || 'Failed to execute action');
    } finally {
      setExecuting(false);
    }
  };

  if (loading) {
    return (
      <div className="nms-card bg-slate-900/50 border-slate-800 flex items-center justify-center p-8">
        <Loader2 className="w-5 h-5 text-indigo-400 animate-spin mr-2" />
        <span className="text-xs text-slate-400">正在获取推荐操作...</span>
      </div>
    );
  }

  if (error && !nextAction) {
    return (
      <div className="nms-card border-red-500/20 bg-red-500/5 text-red-400 p-4">
        <div className="flex gap-2 items-center text-sm font-semibold">
          <AlertCircle className="w-4 h-4" /> Recommended Action Error
        </div>
        <p className="text-xs mt-1 leading-relaxed">{error}</p>
        <button onClick={() => void loadNextAction()} className="nms-btn bg-slate-800 text-slate-200 mt-2 text-xs py-1 hover:bg-slate-700">
          重试
        </button>
      </div>
    );
  }

  if (!nextAction || !nextAction.recommended_action) {
    return (
      <div className="nms-card bg-emerald-500/5 border-emerald-500/10 text-emerald-400 p-4 flex items-center gap-3">
        <CheckCircle2 className="w-5 h-5" />
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider">No Recommended Action</h4>
          <p className="text-xs text-slate-400 mt-0.5">该任务已顺利执行完毕或无需进一步干预。</p>
        </div>
      </div>
    );
  }

  const priorityColors = {
    required: 'border-red-500/30 bg-red-500/5 text-red-300',
    recommended: 'border-indigo-500/30 bg-indigo-500/5 text-indigo-300',
    optional: 'border-slate-800 bg-slate-900/40 text-slate-300',
    blocked: 'border-amber-500/20 bg-amber-500/5 text-amber-300',
  };

  return (
    <div className={`nms-card border p-5 space-y-4 rounded-xl ${priorityColors[nextAction.priority] || priorityColors.optional}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${
              nextAction.priority === 'required' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
              nextAction.priority === 'recommended' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' :
              'bg-slate-800 text-slate-400'
            }`}>
              {nextAction.priority}
            </span>
            <span className="text-xs font-mono text-slate-400">State: {nextAction.state}</span>
          </div>
          <h3 className="text-sm font-semibold text-white mt-1.5 flex items-center gap-1.5">
            推荐动作: <code className="bg-slate-950 px-1.5 py-0.5 rounded text-xs text-cyan-400">{nextAction.recommended_action}</code>
          </h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">{nextAction.reason}</p>
        </div>
      </div>

      {nextAction.blocking_reasons.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 p-3 rounded-lg text-xs space-y-1">
          <div className="font-semibold flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" /> 存在阻碍原因:
          </div>
          <ul className="list-disc pl-4 list-inside">
            {nextAction.blocking_reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {nextAction.required_inputs.length > 0 && (
        <div className="space-y-3 pt-2">
          {nextAction.required_inputs.map((input) => (
            <div key={input.key}>
              <label className="nms-label text-slate-400">{input.label}</label>
              {input.type === 'markdown' || input.type === 'text' ? (
                <textarea
                  value={inputValues[input.key] || ''}
                  onChange={(e) => handleInputChange(input.key, e.target.value)}
                  placeholder={`请输入 ${input.label}...`}
                  required={input.required}
                  className="nms-input min-h-[80px] font-sans"
                />
              ) : (
                <input
                  type="text"
                  value={inputValues[input.key] || ''}
                  onChange={(e) => handleInputChange(input.key, e.target.value)}
                  placeholder={`请输入 ${input.label}...`}
                  required={input.required}
                  className="nms-input"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400 bg-red-950/40 border border-red-900/50 p-2 rounded-lg leading-relaxed">
          {error}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button
          onClick={() => void handleExecute()}
          disabled={executing || nextAction.priority === 'blocked'}
          className="nms-btn-primary flex items-center gap-2 text-xs py-2 px-4 shadow-[0_0_15px_rgba(79,70,229,0.3)] bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400"
        >
          {executing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              正在执行中...
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              立即执行推荐操作
            </>
          )}
        </button>
      </div>
    </div>
  );
}

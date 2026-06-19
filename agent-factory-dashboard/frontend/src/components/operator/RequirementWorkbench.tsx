import { useState } from 'react';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { submitOperatorIntake, registerIntakeDraft } from '../../api/agentFactory';
import { Plus, Check, Loader2, FileText, ArrowRight, Layers, Layout } from 'lucide-react';

interface RequirementWorkbenchProps {
  onIntakeCompleted?: (targetId: string) => void;
}

export function RequirementWorkbench({ onIntakeCompleted }: RequirementWorkbenchProps): JSX.Element {
  const { projects } = useAgentFactoryStore();
  const [projectId, setProjectId] = useState('');
  const [rawRequirement, setRawRequirement] = useState('');
  const [granularity, setGranularity] = useState<'auto' | 'adu' | 'epic'>('auto');
  const [language, setLanguage] = useState('zh');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Intake result state
  const [result, setResult] = useState<{
    draft_id: string;
    recommended_target: 'adu' | 'epic';
    reason: string;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !rawRequirement.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await submitOperatorIntake({
        project_id: projectId,
        raw_requirement: rawRequirement,
        preferred_granularity: granularity,
        language
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message || 'Failed to analyze requirement');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmRegistration = async () => {
    if (!result) return;
    setConfirming(true);
    setError(null);
    try {
      const targetType = result.recommended_target || 'adu';
      const res = await registerIntakeDraft(result.draft_id, targetType, true);
      if (onIntakeCompleted) {
        onIntakeCompleted(res.epic?.id || res.adu?.id || res.epic_id || res.adu_id);
      }
      // Reset
      setResult(null);
      setRawRequirement('');
    } catch (e: any) {
      setError(e.message || 'Failed to register draft as active task');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="nms-card bg-slate-900/40 border-slate-800 p-6 rounded-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
        <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-400" /> 需求准入工作台 (Intake)
        </h2>

        {!result ? (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="nms-label">选择目标项目</label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  required
                  className="nms-input bg-slate-950 border-slate-800"
                >
                  <option value="">-- 请选择项目 --</option>
                  {projects.map((p) => (
                    <option key={p.project_id} value={p.project_id} disabled={p.status === 'disabled'}>
                      {p.name} {p.status === 'disabled' ? '(已停用)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="nms-label">粒度偏好</label>
                  <select
                    value={granularity}
                    onChange={(e) => setGranularity(e.target.value as any)}
                    className="nms-input bg-slate-950 border-slate-800"
                  >
                    <option value="auto">自动判定 (Auto)</option>
                    <option value="adu">单 ADU 任务</option>
                    <option value="epic">Epic 架构拆分</option>
                  </select>
                </div>
                <div>
                  <label className="nms-label">生成语言</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="nms-input bg-slate-950 border-slate-800"
                  >
                    <option value="zh">中文 (Chinese)</option>
                    <option value="en">英文 (English)</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="nms-label">原始需求描述 (Support Markdown)</label>
              <textarea
                value={rawRequirement}
                onChange={(e) => setRawRequirement(e.target.value)}
                required
                placeholder="在此粘入或描述您的软件研发需求，例如：'为 CAMEL 呼叫流程添加 IP 过滤逻辑，在 kamailio.cfg 中拦截非法 IP...'"
                className="nms-input bg-slate-950 border-slate-800 min-h-[160px] font-sans"
              />
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/50 p-3 rounded-lg leading-relaxed">
                {error}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={loading || !projectId || !rawRequirement.trim()}
                className="nms-btn-primary flex items-center gap-1.5 text-xs py-2 px-5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    正在分析评估中...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    智能评估并准入
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="border border-indigo-500/30 bg-indigo-500/5 p-4 rounded-lg space-y-3">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${result.recommended_target === 'epic' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-indigo-500/20 text-indigo-400'}`}>
                  {result.recommended_target === 'epic' ? <Layers className="w-5 h-5" /> : <Layout className="w-5 h-5" />}
                </div>
                <div>
                  <h4 className="text-xs text-slate-400 uppercase tracking-widest">推荐承载容器</h4>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {result.recommended_target === 'epic' ? 'Epic 架构拆分 (推荐)' : '单 ADU 最小开发单元'}
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3 rounded border border-slate-800/40">
                {result.reason}
              </p>
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/50 p-3 rounded-lg">
                {error}
              </div>
            )}

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => setResult(null)}
                className="nms-btn-ghost text-xs text-slate-400 hover:text-slate-200"
              >
                返回修改
              </button>

              <button
                onClick={() => void handleConfirmRegistration()}
                disabled={confirming}
                className="nms-btn-primary flex items-center gap-1.5 text-xs py-2 px-5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]"
              >
                {confirming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    正在注册激活中...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    确认推荐并激活任务
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

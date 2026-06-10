import React, { useState } from 'react';
import { X, Cpu, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { agentFactoryApi } from '../../api/agentFactory';

interface CreateProjectAduModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}

export const CreateProjectAduModal: React.FC<CreateProjectAduModalProps> = ({
  isOpen,
  onClose,
  projectId,
  projectName,
}) => {
  const [aduId, setAduId] = useState('');
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [risk, setRisk] = useState<'low' | 'medium' | 'high'>('medium');
  const [analysisReview, setAnalysisReview] = useState(true);
  const [designReview, setDesignReview] = useState(true);
  const [manualEvidence, setManualEvidence] = useState(false);
  const [commandsText, setCommandsText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  if (!isOpen) return null;

  const reset = () => {
    setAduId('');
    setTitle('');
    setGoal('');
    setRisk('medium');
    setAnalysisReview(true);
    setDesignReview(true);
    setManualEvidence(false);
    setCommandsText('');
    setError(null);
    setSuccessId(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('需求标题不能为空');
      return;
    }
    if (!goal.trim()) {
      setError('需求目标不能为空');
      return;
    }

    const requiredCommands = commandsText
      .split(/[\n,]+/)
      .map((c) => c.trim())
      .filter(Boolean);

    setIsSubmitting(true);
    try {
      const result = await agentFactoryApi.createProjectAdu(projectId, {
        aduId: aduId.trim() || undefined,
        title: title.trim(),
        goal: goal.trim(),
        risk,
        analysisReviewRequired: analysisReview,
        designReviewRequired: designReview,
        manualEvidenceMode: manualEvidence,
        requiredCommands: requiredCommands.length > 0 ? requiredCommands : undefined,
      });
      setSuccessId(result.adu.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || '创建失败，请检查输入');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-200 text-slate-100 flex flex-col items-center gap-4">
          <CheckCircle2 className="h-12 w-12 text-emerald-400" />
          <h3 className="text-lg font-bold text-white">ADU 创建成功</h3>
          <p className="text-sm text-slate-400 text-center">
            已成功为项目 <span className="text-white font-semibold">{projectName}</span> 创建 ADU：
          </p>
          <code className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-mono text-indigo-300">{successId}</code>
          <p className="text-xs text-slate-500 text-center">
            请前往 Agent Factory 主页查看并启动该 ADU 的编排流程。
          </p>
          <button
            onClick={handleClose}
            className="mt-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-6 py-2 text-sm font-semibold text-white transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-200 text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-5">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-indigo-400" />
            <div>
              <h3 className="text-base font-semibold tracking-tight text-white">新建项目 ADU</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">为 <span className="text-slate-300">{projectName}</span> 创建新的开发任务单元</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex gap-2 rounded-lg bg-red-950/50 border border-red-900/50 p-3 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* ADU ID (optional) */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              ADU ID (可选)
            </label>
            <input
              type="text"
              placeholder="例如: REQ-2026-0001 (留空则自动生成)"
              value={aduId}
              onChange={(e) => setAduId(e.target.value.replace(/[^A-Za-z0-9_.-]/g, ''))}
              className="w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              需求标题 *
            </label>
            <input
              type="text"
              placeholder="例如: 为 AMF 添加健康检查接口"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>

          {/* Goal */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              需求目标 *
            </label>
            <textarea
              placeholder="详细描述期望实现的功能或修复的问题..."
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              required
              rows={3}
              className="w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all resize-none"
            />
          </div>

          {/* Risk + Reviews row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">风险等级</label>
              <select
                value={risk}
                onChange={(e) => setRisk(e.target.value as 'low' | 'medium' | 'high')}
                className="w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
              >
                <option value="low">低 (Low)</option>
                <option value="medium">中 (Medium)</option>
                <option value="high">高 (High)</option>
              </select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">人工审查节点</label>
              <div className="flex items-center gap-4 h-[38px]">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={analysisReview}
                    onChange={(e) => setAnalysisReview(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
                  />
                  <span className="text-xs text-slate-300">分析审查</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={designReview}
                    onChange={(e) => setDesignReview(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
                  />
                  <span className="text-xs text-slate-300">设计审查</span>
                </label>
              </div>
            </div>
          </div>

          {/* Required commands */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              验证命令 (可选)
            </label>
            <textarea
              placeholder={'每行一条命令，例如:\nmeson test -C build\nninja -C build'}
              value={commandsText}
              onChange={(e) => setCommandsText(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-2 text-sm font-mono text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all resize-none"
            />
            <p className="text-[11px] text-slate-500">留空时将使用项目画像中扫描到的构建/测试命令</p>
          </div>

          {/* Manual evidence toggle */}
          <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-lg border border-slate-800 p-3">
            <input
              type="checkbox"
              checked={manualEvidence}
              onChange={(e) => setManualEvidence(e.target.checked)}
              className="mt-0.5 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
            />
            <div>
              <span className="text-xs font-semibold text-slate-300">手动验收模式</span>
              <p className="text-[11px] text-slate-500 mt-0.5">无可用验证命令时仍允许创建 ADU（适用于文档、设计类任务）</p>
            </div>
          </label>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t border-slate-800 pt-4 mt-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSubmitting ? '创建中...' : '创建 ADU'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

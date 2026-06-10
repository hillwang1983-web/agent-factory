import React, { useState } from 'react';
import { X, Folder, AlertTriangle } from 'lucide-react';
import { useAgentFactoryStore } from '../../stores/agentFactory';

interface RegisterProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RegisterProjectModal: React.FC<RegisterProjectModalProps> = ({ isOpen, onClose }) => {
  const { registerProject } = useAgentFactoryStore();
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!name.trim()) {
      setValidationError('项目名称不能为空');
      return;
    }
    if (!repoPath.trim()) {
      setValidationError('本地 Git 仓库路径不能为空');
      return;
    }

    setIsSubmitting(true);
    try {
      await registerProject({
        projectId: projectId.trim() || undefined,
        name: name.trim(),
        repoPath: repoPath.trim(),
        description: description.trim() || undefined,
      });
      // Clear fields
      setProjectId('');
      setName('');
      setRepoPath('');
      setDescription('');
      onClose();
    } catch (err: any) {
      setValidationError(err.message || '注册失败，请检查仓库路径是否合法且为 Git 仓库');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-200 text-slate-100">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Folder className="h-5 w-5 text-indigo-400" />
            <h3 className="text-lg font-semibold tracking-tight text-white">接入新 Git 仓库</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {validationError && (
            <div className="flex gap-2 rounded-lg bg-red-950/50 border border-red-900/50 p-3 text-sm text-red-400">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              项目 ID (可选)
            </label>
            <input
              type="text"
              placeholder="例如: open5gs-upf (留空则自动根据路径生成)"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              className="w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
            />
            <p className="text-[11px] text-slate-500">仅允许英文、数字、中划线和下划线。</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              项目显示名称 *
            </label>
            <input
              type="text"
              placeholder="例如: Open5GS UPF Component"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              本地 Git 仓库绝对路径 *
            </label>
            <input
              type="text"
              placeholder="例如: /Users/hill/open5gs"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
            />
            <p className="text-[11px] text-slate-500">
              必须是一个本地存在的 Git 仓库，且路径必须位于白名单允许的范围下。
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              项目描述
            </label>
            <textarea
              placeholder="对该仓库的用途或主要模块的简要说明..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-2 text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-800 pt-4 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSubmitting ? '注册中...' : '确认接入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

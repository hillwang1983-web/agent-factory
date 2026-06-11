import { useState } from 'react';
import type { AgentFactoryProject, CreateEpicInput } from '../../types/agent-factory';
import { X } from 'lucide-react';

interface Props {
  projects: AgentFactoryProject[];
  selectedProjectId: string;
  onClose: () => void;
  onCreate: (projectId: string, input: CreateEpicInput) => Promise<void>;
}

export function CreateEpicModal({ projects, selectedProjectId, onClose, onCreate }: Props) {
  const [projectId, setProjectId] = useState(selectedProjectId || projects[0]?.project_id || '');
  const [title, setTitle] = useState('');
  const [sourceRequirement, setSourceRequirement] = useState('');
  const [risk, setRisk] = useState('medium');
  const [targetLevel, setTargetLevel] = useState('mvp');
  const [language, setLanguage] = useState('zh');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    if (!title.trim() || !sourceRequirement.trim()) {
      setError('标题和原始需求不能为空');
      return;
    }
    if (!projectId) {
      setError('请选择项目');
      return;
    }
    setSubmitting(true);
    try {
      await onCreate(projectId, {
        title: title.trim(),
        source_requirement: sourceRequirement.trim(),
        risk,
        target_level: targetLevel,
        language,
      });
    } catch (e: any) {
      setError(e.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-lg w-[480px] max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white">创建 Epic</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">项目</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200"
            >
              {projects.map(p => (
                <option key={p.project_id} value={p.project_id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如: SIM 卡远程生命周期管理"
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">原始需求</label>
            <textarea
              value={sourceRequirement}
              onChange={(e) => setSourceRequirement(e.target.value)}
              placeholder="描述完整业务需求..."
              rows={4}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200 resize-none"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-slate-400 mb-1 block">风险等级</label>
              <select value={risk} onChange={(e) => setRisk(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200">
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-slate-400 mb-1 block">目标级别</label>
              <select value={targetLevel} onChange={(e) => setTargetLevel(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200">
                <option value="mvp">MVP</option>
                <option value="production">Production</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-slate-400 mb-1 block">语言</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-200">
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-slate-800">
          <button onClick={onClose}
            className="px-4 py-1.5 text-xs rounded bg-slate-800 text-slate-400 hover:bg-slate-700">
            取消
          </button>
          <button onClick={handleSubmit} disabled={submitting}
            className="px-4 py-1.5 text-xs rounded bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50">
            {submitting ? '创建中...' : '创建 Epic'}
          </button>
        </div>
      </div>
    </div>
  );
}

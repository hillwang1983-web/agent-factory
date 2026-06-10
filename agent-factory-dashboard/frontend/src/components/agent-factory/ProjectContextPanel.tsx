import React, { useState, useEffect } from 'react';
import {
  BookOpen, CheckCircle2, XCircle, Loader2, FolderOpen, Shield, Terminal, ChevronDown, ChevronRight
} from 'lucide-react';
import { agentFactoryApi } from '../../api/agentFactory';

interface ProjectContextPanelProps {
  aduId: string;
}

type Context = Awaited<ReturnType<typeof agentFactoryApi.getAduProjectContext>>;

export const ProjectContextPanel: React.FC<ProjectContextPanelProps> = ({ aduId }) => {
  const [ctx, setCtx] = useState<Context | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCtx(null);
    setError(null);
    if (!aduId) return;

    setLoading(true);
    agentFactoryApi.getAduProjectContext(aduId)
      .then((data) => { if (!cancelled) { setCtx(data); setExpanded(true); } })
      .catch(() => { if (!cancelled) setError(null); }) // 400/404 = not project ADU; silent
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [aduId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-nms-text-dim py-1">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading project context…
      </div>
    );
  }

  if (error || !ctx) return null;

  const knowledgeReady = ctx.knowledge.filter((k) => k.exists).length;
  const knowledgeTotal = ctx.knowledge.length;

  return (
    <div className="nms-card bg-nms-surface-1 border-nms-surface-2 overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-nms-surface-2/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="text-sm font-semibold text-nms-text">项目绑定上下文</span>
          <span className="rounded-full bg-indigo-950/60 border border-indigo-800/40 px-2 py-0.5 text-[10px] font-mono text-indigo-300">
            {ctx.project.project_id}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-semibold ${
            ctx.profile.exists && knowledgeReady === knowledgeTotal
              ? 'text-emerald-400'
              : 'text-amber-400'
          }`}>
            {ctx.profile.exists && knowledgeReady === knowledgeTotal
              ? '知识包就绪'
              : `知识包 ${knowledgeReady}/${knowledgeTotal}`}
          </span>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-nms-text-dim" />
          ) : (
            <ChevronRight className="w-4 h-4 text-nms-text-dim" />
          )}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-nms-surface-2">
          {/* Project info row */}
          <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-nms-surface-2/30 border border-nms-surface-3/50 rounded-lg p-3 space-y-1.5">
              <div className="text-[10px] font-bold text-nms-text-dim uppercase tracking-wider flex items-center gap-1">
                <FolderOpen className="w-3 h-3" /> 项目信息
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-nms-text-dim">名称</span>
                  <span className="text-[11px] text-nms-text font-semibold">{ctx.project.name}</span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] text-nms-text-dim shrink-0">路径</span>
                  <code className="text-[10px] text-slate-300 font-mono truncate text-right">{ctx.project.repo_path}</code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-nms-text-dim">画像状态</span>
                  <span className={`text-[11px] font-semibold ${
                    ctx.project.status === 'profiled' ? 'text-emerald-400' : 'text-amber-400'
                  }`}>
                    {ctx.project.status === 'profiled' ? '✓ 已完成' : ctx.project.status}
                  </span>
                </div>
              </div>
            </div>

            {/* Knowledge pack status */}
            <div className="bg-nms-surface-2/30 border border-nms-surface-3/50 rounded-lg p-3 space-y-1.5">
              <div className="text-[10px] font-bold text-nms-text-dim uppercase tracking-wider flex items-center gap-1">
                <BookOpen className="w-3 h-3" /> 知识包文件
              </div>
              <ul className="space-y-1">
                {ctx.knowledge.map((k) => (
                  <li key={k.name} className="flex items-center gap-1.5">
                    {k.exists ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 text-slate-600 shrink-0" />
                    )}
                    <code className={`text-[10px] font-mono ${k.exists ? 'text-slate-300' : 'text-slate-600'}`}>
                      {k.name}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Policies */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-nms-surface-2/30 border border-nms-surface-3/50 rounded-lg p-3 space-y-1.5">
              <div className="text-[10px] font-bold text-nms-text-dim uppercase tracking-wider flex items-center gap-1">
                <Shield className="w-3 h-3 text-nms-accent" /> 允许写入路径
              </div>
              <ul className="space-y-0.5 max-h-20 overflow-y-auto">
                {ctx.policies.allowed_write_paths.map((p) => (
                  <li key={p} className="text-[10px] font-mono text-nms-text">{p}</li>
                ))}
              </ul>
            </div>

            <div className="bg-nms-surface-2/30 border border-nms-surface-3/50 rounded-lg p-3 space-y-1.5">
              <div className="text-[10px] font-bold text-nms-text-dim uppercase tracking-wider flex items-center gap-1">
                <Terminal className="w-3 h-3 text-nms-accent" /> 验证命令
              </div>
              {ctx.policies.required_commands.length === 0 ? (
                <p className="text-[10px] text-nms-text-dim italic">继承自项目画像</p>
              ) : (
                <ul className="space-y-0.5 max-h-20 overflow-y-auto">
                  {ctx.policies.required_commands.map((c) => (
                    <li key={c} className="text-[10px] font-mono text-nms-text truncate" title={c}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

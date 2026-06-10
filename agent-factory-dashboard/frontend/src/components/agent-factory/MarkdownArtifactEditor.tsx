import { useState, useEffect } from 'react';
import { Save, AlertTriangle, RefreshCw, Eye, Edit3 } from 'lucide-react';
import { useAgentFactoryStore } from '../../stores/agentFactory';

// Simple self-contained regex-based markdown parser for preview
function renderSimpleMarkdown(md: string): string {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Fenced Code Blocks: ```lang ... ```
  html = html.replace(/```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)\n```/g, '<pre className="bg-nms-surface-2 p-3 rounded-md font-mono text-xs text-nms-text overflow-x-auto my-2 border border-nms-surface-3">$1</pre>');

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3 className="text-sm font-bold text-nms-text mt-4 mb-2 border-b border-nms-surface-2 pb-1">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 className="text-base font-bold text-nms-accent mt-5 mb-2 border-b border-nms-surface-2 pb-1">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 className="text-lg font-extrabold text-nms-text mt-6 mb-3 border-b border-nms-surface-2 pb-2">$1</h1>');

  // Blockquotes (GitHub alerts style)
  html = html.replace(/^&gt;\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n([\s\S]*?)(?=(?:\n\n|\n&gt;|\n\s*\n|$))/gim, (_, type, content) => {
    let classes = 'p-3 rounded-lg border my-3 text-xs leading-relaxed ';
    if (type === 'IMPORTANT' || type === 'WARNING' || type === 'CAUTION') {
      classes += 'bg-red-500/10 border-red-500/20 text-red-400';
    } else {
      classes += 'bg-nms-accent/10 border-nms-accent/20 text-nms-accent';
    }
    return `<div className="${classes}"><strong>[${type}]</strong><br/>${content.replace(/^\s*&gt;\s*/gm, '')}</div>`;
  });
  html = html.replace(/^&gt;\s*(.*$)/gim, '<blockquote className="border-l-4 border-nms-accent bg-nms-surface-2/40 px-3 py-2 my-2 text-xs italic text-nms-text-dim">$1</blockquote>');

  // Bullet Lists
  html = html.replace(/^\s*[-*+]\s+(.*$)/gim, '<li className="list-disc list-inside text-xs text-nms-text-dim ml-3 my-0.5">$1</li>');

  // Bold / Italics
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Inline Code
  html = html.replace(/`([^`]+)`/g, '<code className="bg-nms-surface-3 px-1.5 py-0.5 rounded text-[11px] font-mono text-nms-accent">$1</code>');

  // Paragraph breaks
  html = html.replace(/\n\n/g, '<div className="h-2"></div>');

  return html;
}

interface MarkdownArtifactEditorProps {
  aduId: string;
}

export function MarkdownArtifactEditor({ aduId }: MarkdownArtifactEditorProps): JSX.Element {
  const {
    activeArtifactPath,
    activeArtifactContent,
    activeArtifactSha256,
    activeArtifactLoading,
    saveArtifactContent,
    loadArtifactContent,
    editableArtifacts
  } = useAgentFactoryStore();

  const [localContent, setLocalContent] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [viewMode, setViewMode] = useState<'split' | 'edit' | 'preview'>('split');

  // Synchronize local state when active content updates from store
  useEffect(() => {
    setLocalContent(activeArtifactContent || '');
    setSaveStatus(null);
  }, [activeArtifactContent]);

  if (!activeArtifactPath) {
    return (
      <div className="p-8 text-center text-xs text-nms-text-dim italic bg-nms-surface-1/30 rounded-lg border border-dashed border-nms-surface-2">
        请在上方选择一份过程文档（如需求分析或详细设计说明书）进行查看与编辑。
      </div>
    );
  }

  if (activeArtifactLoading) {
    return (
      <div className="p-12 text-center text-xs text-nms-text-dim flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-nms-accent" />
        正在加载文档内容...
      </div>
    );
  }

  const currentArtInfo = editableArtifacts.find(a => a.path === activeArtifactPath);
  const isDocCreated = currentArtInfo?.exists ?? false;
  const kind = currentArtInfo?.kind || 'analysis';

  const handleSave = async () => {
    if (!activeArtifactSha256) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      await saveArtifactContent({
        aduId,
        gate: kind === 'analysis' ? 'analysis' : 'design',
        path: activeArtifactPath,
        content: localContent,
        baseSha256: activeArtifactSha256,
        changeReason: changeReason || '手动编辑更新'
      });
      setSaveStatus({ type: 'success', message: '保存草稿成功！' });
      setChangeReason('');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (e) {
      console.error(e);
      if ((e as Error).message === 'conflict') {
        setSaveStatus({
          type: 'error',
          message: '保存冲突：该文档在您加载后已被其他流程或人员修改。请刷新文档载入最新内容后重新编辑。'
        });
      } else {
        setSaveStatus({
          type: 'error',
          message: `保存失败: ${(e as Error).message}`
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Editor Header / Toolbars */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-nms-surface-2/60 p-2 rounded-t-lg border-b border-nms-surface-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-nms-text truncate max-w-[250px]" title={activeArtifactPath}>
            {activeArtifactPath.split('/').pop()}
          </span>
          {!isDocCreated && (
            <span className="bg-nms-surface-3 border border-nms-surface-4 text-[10px] text-nms-text-dim px-1.5 py-0.5 rounded">
              草稿未创建
            </span>
          )}
        </div>

        {/* Layout View Toggles */}
        <div className="flex items-center bg-nms-surface-3 rounded p-0.5 border border-nms-surface-4">
          <button
            onClick={() => setViewMode('split')}
            className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
              viewMode === 'split' ? 'bg-nms-accent text-white' : 'text-nms-text-dim hover:text-nms-text'
            }`}
          >
            分栏对比
          </button>
          <button
            onClick={() => setViewMode('edit')}
            className={`px-2.5 py-1 text-[11px] rounded transition-colors flex items-center gap-1 ${
              viewMode === 'edit' ? 'bg-nms-accent text-white' : 'text-nms-text-dim hover:text-nms-text'
            }`}
          >
            <Edit3 className="w-3 h-3" /> 编辑
          </button>
          <button
            onClick={() => setViewMode('preview')}
            className={`px-2.5 py-1 text-[11px] rounded transition-colors flex items-center gap-1 ${
              viewMode === 'preview' ? 'bg-nms-accent text-white' : 'text-nms-text-dim hover:text-nms-text'
            }`}
          >
            <Eye className="w-3 h-3" /> 预览
          </button>
        </div>

        <button
          onClick={() => void loadArtifactContent(activeArtifactPath)}
          className="text-xs text-nms-text-dim hover:text-nms-text flex items-center gap-1 px-2 py-1 rounded hover:bg-nms-surface-3 border border-transparent hover:border-nms-surface-4 transition-all"
          title="重新载入最新文档"
        >
          <RefreshCw className="w-3 h-3" /> 刷新
        </button>
      </div>

      {/* Editor Content Area */}
      <div className={`grid gap-4 ${viewMode === 'split' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
        {/* Editor Pane */}
        {(viewMode === 'split' || viewMode === 'edit') && (
          <div className="flex flex-col space-y-2">
            <textarea
              value={localContent}
              onChange={(e) => setLocalContent(e.target.value)}
              className="w-full h-[400px] bg-nms-bg text-nms-text font-mono text-xs p-4 rounded-lg border border-nms-surface-2 focus:ring-1 focus:ring-nms-accent focus:border-nms-accent focus:outline-none resize-y leading-relaxed"
              placeholder="在此输入 Markdown 原文内容..."
            />
          </div>
        )}

        {/* Preview Pane */}
        {(viewMode === 'split' || viewMode === 'preview') && (
          <div className="bg-nms-bg/40 rounded-lg border border-nms-surface-2 p-4 h-[400px] overflow-y-auto">
            {localContent ? (
              <div
                className="prose prose-invert prose-xs max-w-none text-nms-text leading-relaxed select-text"
                dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(localContent) }}
              />
            ) : (
              <div className="text-xs text-nms-text-dim italic text-center pt-20">
                无预览内容
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notification Banner */}
      {saveStatus && (
        <div
          className={`flex items-start gap-2 p-3 text-xs rounded-lg border ${
            saveStatus.type === 'error'
              ? 'bg-red-500/10 border-red-500/20 text-red-400'
              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
          }`}
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="font-semibold">{saveStatus.message}</div>
        </div>
      )}

      {/* Audit & Save Actions */}
      <div className="flex flex-wrap items-end gap-3 bg-nms-surface-1/40 p-3 rounded-lg border border-nms-surface-2">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] text-nms-text-dim uppercase font-bold mb-1">
            变更原因 (Audit Log Description)
          </label>
          <input
            type="text"
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            className="w-full bg-nms-bg border border-nms-surface-3 rounded px-2.5 py-1.5 text-xs text-nms-text placeholder-nms-text-dim/40 focus:outline-none focus:ring-1 focus:ring-nms-accent"
            placeholder="例如：补充验收边界和异常场景..."
          />
        </div>
        <button
          onClick={() => void handleSave()}
          disabled={saving || !activeArtifactSha256}
          className="nms-btn-primary flex items-center gap-1.5 text-xs py-1.5 h-[32px] justify-center"
        >
          {saving ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          保存草稿 (Save Draft)
        </button>
      </div>
    </div>
  );
}

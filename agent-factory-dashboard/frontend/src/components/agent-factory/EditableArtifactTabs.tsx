import { FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAgentFactoryStore } from '../../stores/agentFactory';

export function EditableArtifactTabs(): JSX.Element {
  const {
    editableArtifacts,
    activeArtifactPath,
    loadArtifactContent
  } = useAgentFactoryStore();

  if (editableArtifacts.length === 0) {
    return (
      <div className="text-xs text-nms-text-dim italic p-2">
        暂不可编辑过程文档
      </div>
    );
  }

  return (
    <div className="flex border-b border-nms-surface-2">
      {editableArtifacts.map((art) => {
        const isActive = activeArtifactPath === art.path;
        const displayName = art.kind === 'analysis' ? '需求分析说明书' : '详细设计说明书';
        const fileStateIcon = art.exists ? (
          <span title="文档已生成"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /></span>
        ) : (
          <span title="文档尚未生成"><AlertCircle className="w-3.5 h-3.5 text-nms-text-dim/40" /></span>
        );

        return (
          <button
            key={art.path}
            onClick={() => void loadArtifactContent(art.path)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
              isActive
                ? 'border-nms-accent text-nms-accent bg-nms-accent/5'
                : 'border-transparent text-nms-text-dim hover:text-nms-text hover:bg-nms-surface-2/30'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{displayName}</span>
            {fileStateIcon}
            {art.bytes > 0 && (
              <span className="text-[10px] text-nms-text-dim/60 font-mono">
                ({(art.bytes / 1024).toFixed(1)} KB)
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

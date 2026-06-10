import { useAgentFactoryStore } from '../../stores/agentFactory';
import { X, FileText, AlertTriangle, Copy, Check } from 'lucide-react';
import { useState } from 'react';

export function ArtifactDrawer(): JSX.Element | null {
  const { selectedArtifactPath, artifactContent, artifactTruncated, closeArtifact } = useAgentFactoryStore();
  const [copied, setCopied] = useState(false);

  if (!selectedArtifactPath) return null;

  const handleCopy = () => {
    if (!artifactContent) return;
    navigator.clipboard.writeText(artifactContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const basename = selectedArtifactPath.split('/').pop() || selectedArtifactPath;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
      {/* Backdrop */}
      <div 
        onClick={closeArtifact}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" 
      />

      {/* Drawer */}
      <div className="relative w-full max-w-3xl bg-nms-surface-1 border-l border-nms-surface-3 h-full flex flex-col shadow-2xl z-10 animate-slide-in">
        {/* Header */}
        <div className="p-4 border-b border-nms-surface-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-hidden">
            <FileText className="w-5 h-5 text-nms-accent flex-shrink-0" />
            <div className="overflow-hidden">
              <h3 className="text-sm font-semibold text-nms-text truncate">{basename}</h3>
              <p className="text-[10px] text-nms-text-dim truncate font-mono mt-0.5" title={selectedArtifactPath}>
                {selectedArtifactPath}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {artifactContent && (
              <button
                onClick={handleCopy}
                className="nms-btn-ghost p-2 text-slate-400 hover:text-nms-text"
                title="Copy content"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            )}
            <button
              onClick={closeArtifact}
              className="nms-btn-ghost p-2 text-slate-400 hover:text-nms-text"
              title="Close drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Warning if truncated */}
        {artifactTruncated && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 text-amber-400 p-2.5 px-4 flex items-center gap-2.5 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>Artifact content is truncated. Showing only the first 100KB of logs.</span>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-4 bg-nms-surface-2/20">
          {artifactContent === 'Loading...' ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-xs text-nms-text-dim animate-pulse">Loading artifact content...</div>
            </div>
          ) : (
            <pre className="text-xs font-mono p-4 bg-nms-surface-2 border border-nms-surface-3 rounded-lg overflow-x-auto text-nms-text leading-relaxed whitespace-pre-wrap max-h-[85vh]">
              {artifactContent}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

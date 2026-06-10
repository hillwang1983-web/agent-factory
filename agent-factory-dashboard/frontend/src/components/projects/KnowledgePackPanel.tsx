import React, { useEffect, useState } from 'react';
import { BookOpen, FileText, ChevronRight, Loader2, BookMarked } from 'lucide-react';
import { agentFactoryApi } from '../../api/agentFactory';

// Safe, lightweight Regex-based Markdown renderer to avoid DOMPurify/marked heavy package dependencies.
// It escapes HTML characters and renders clean React elements directly to prevent XSS.
const SafeMarkdown: React.FC<{ content: string }> = ({ content }) => {
  const escapeHtml = (text: string) => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const lines = content.split('\n');
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeLang = '';

  const renderedElements: React.ReactNode[] = [];

  const parseInlineStyles = (text: string) => {
    // Escape HTML first
    const escaped = escapeHtml(text);
    
    // Parse inline code: `code`
    let processed = escaped.replace(/`([^`]+)`/g, '<code class="bg-slate-950 px-1.5 py-0.5 rounded text-indigo-300 font-mono text-xs">$1</code>');
    
    // Parse bold: **text**
    processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-white">$1</strong>');
    
    // Parse links: [text](url)
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-400 hover:text-indigo-300 underline">$1</a>');

    return <span dangerouslySetInnerHTML={{ __html: processed }} />;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        inCodeBlock = false;
        renderedElements.push(
          <pre key={`code-${i}`} className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs overflow-x-auto my-3 text-indigo-200">
            {codeLang && <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-2">{codeLang}</div>}
            <code>{codeBlockLines.join('\n')}</code>
          </pre>
        );
        codeBlockLines = [];
        codeLang = '';
      } else {
        // Start of code block
        inCodeBlock = true;
        codeLang = line.trim().slice(3);
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    // Headers
    if (trimmed.startsWith('# ')) {
      renderedElements.push(<h1 key={i} className="text-xl font-bold text-white mt-6 mb-3 tracking-tight border-b border-slate-800 pb-2">{parseInlineStyles(trimmed.slice(2))}</h1>);
    } else if (trimmed.startsWith('## ')) {
      renderedElements.push(<h2 key={i} className="text-lg font-bold text-white mt-5 mb-2.5 tracking-tight">{parseInlineStyles(trimmed.slice(3))}</h2>);
    } else if (trimmed.startsWith('### ')) {
      renderedElements.push(<h3 key={i} className="text-base font-semibold text-slate-200 mt-4 mb-2">{parseInlineStyles(trimmed.slice(4))}</h3>);
    }
    // Blockquotes
    else if (trimmed.startsWith('> ')) {
      renderedElements.push(
        <blockquote key={i} className="border-l-4 border-indigo-500 pl-4 py-1.5 my-3 bg-slate-900/30 text-slate-400 italic rounded-r-lg text-sm">
          {parseInlineStyles(trimmed.slice(2))}
        </blockquote>
      );
    }
    // Lists
    else if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      renderedElements.push(
        <div key={i} className="flex items-start gap-2 text-sm text-slate-300 ml-4 my-1.5">
          <ChevronRight className="h-4 w-4 shrink-0 text-indigo-400 mt-0.5" />
          <div>{parseInlineStyles(trimmed.slice(2))}</div>
        </div>
      );
    }
    else if (/^\d+\.\s/.test(trimmed)) {
      const match = trimmed.match(/^(\d+)\.\s(.*)/);
      if (match) {
        renderedElements.push(
          <div key={i} className="flex items-start gap-2 text-sm text-slate-300 ml-4 my-1.5">
            <span className="font-mono text-indigo-400 text-xs shrink-0 mt-0.5">{match[1]}.</span>
            <div>{parseInlineStyles(match[2])}</div>
          </div>
        );
      }
    }
    // Divider
    else if (trimmed === '---') {
      renderedElements.push(<hr key={i} className="border-slate-800 my-6" />);
    }
    // Empty line
    else if (trimmed === '') {
      renderedElements.push(<div key={i} className="h-2" />);
    }
    // Paragraph
    else {
      renderedElements.push(<p key={i} className="text-sm text-slate-300 leading-relaxed my-2">{parseInlineStyles(line)}</p>);
    }
  }

  return <div className="space-y-1">{renderedElements}</div>;
};

interface KnowledgePackPanelProps {
  projectId: string;
}

export const KnowledgePackPanel: React.FC<KnowledgePackPanelProps> = ({ projectId }) => {
  const [docs, setDocs] = useState<string[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [docContent, setDocContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);

  useEffect(() => {
    const loadDocs = async () => {
      setLoading(true);
      try {
        const docList = await agentFactoryApi.fetchProjectKnowledgeList(projectId);
        const sorted = docList.sort();
        setDocs(sorted);
        if (sorted.length > 0) {
          setSelectedDoc(sorted[0]);
        } else {
          setSelectedDoc(null);
          setDocContent('');
        }
      } catch (e) {
        console.error('Failed to load project knowledge list', e);
      } finally {
        setLoading(false);
      }
    };
    loadDocs();
  }, [projectId]);

  useEffect(() => {
    if (!selectedDoc) return;
    const loadContent = async () => {
      setContentLoading(true);
      try {
        const content = await agentFactoryApi.fetchProjectKnowledgeDoc(projectId, selectedDoc);
        setDocContent(content);
      } catch (e) {
        setDocContent(`Failed to load knowledge content:\n${String(e)}`);
      } finally {
        setContentLoading(false);
      }
    };
    loadContent();
  }, [projectId, selectedDoc]);

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/20 p-8 text-center text-slate-400">
        <BookMarked className="h-8 w-8 text-slate-600 mb-2" />
        <p className="text-sm">暂未生成知识库文档</p>
        <p className="text-xs text-slate-500 mt-1">请先运行项目画像扫描，画像 Agent 会为您生成知识文档包。</p>
      </div>
    );
  }

  // Helper to get friendly names for default doc files
  const getDocLabel = (fileName: string) => {
    const mapping: Record<string, string> = {
      '01_codebase_guide.md': '工程主导手册',
      '02_domain_knowledge.md': '业务领域知识',
      '03_test_strategy.md': '自动化测试指南',
      '04_deployment_infra.md': '部署与基础设施',
    };
    return mapping[fileName] || fileName.replace('.md', '');
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-slate-300">
      {/* Doc selector tabs */}
      <div className="md:col-span-1 space-y-2">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2 mb-3 flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5" />
          知识文档目录
        </div>
        {docs.map((doc) => (
          <button
            key={doc}
            onClick={() => setSelectedDoc(doc)}
            className={`w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium border transition-all duration-150 ${
              selectedDoc === doc
                ? 'bg-indigo-950/40 border-indigo-500/40 text-white shadow-lg shadow-indigo-950/50'
                : 'bg-slate-900/30 border-slate-800/40 hover:bg-slate-800/30 hover:border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className={`h-4 w-4 shrink-0 ${selectedDoc === doc ? 'text-indigo-400' : 'text-slate-500'}`} />
            <span className="truncate">{getDocLabel(doc)}</span>
          </button>
        ))}
      </div>

      {/* Doc content reader */}
      <div className="md:col-span-3 rounded-xl border border-slate-800 bg-slate-900/20 p-6 backdrop-blur-md">
        {contentLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
          </div>
        ) : (
          <div className="max-w-none text-slate-300 prose prose-invert select-text">
            <SafeMarkdown content={docContent} />
          </div>
        )}
      </div>
    </div>
  );
};

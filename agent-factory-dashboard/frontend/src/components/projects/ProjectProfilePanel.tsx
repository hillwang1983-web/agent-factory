import React from 'react';
import { Terminal, Shield, Cpu, Code2, CheckCircle2 } from 'lucide-react';

interface ProjectProfilePanelProps {
  profile: any;
}

export const ProjectProfilePanel: React.FC<ProjectProfilePanelProps> = ({ profile }) => {
  if (!profile) return null;

  // Support both full project object (with profile_summary) and direct profile details
  const summary = profile.profile_summary || profile;

  // Helper to always retrieve an array of strings even if backend outputs dictionaries or single strings
  const getArray = (val: any): string[] => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'object') return Object.values(val) as string[];
    return [String(val)];
  };

  const stackBreakdown = summary.detected_stack || [];
  const buildCommands = getArray(summary.build_commands || summary.discovered_commands?.build);
  const testCommands = getArray(summary.test_commands || summary.discovered_commands?.test);
  const filesCount = summary.scan_summary?.total_files || 0;
  const loc = summary.scan_summary?.lines_of_code || 0;
  const riskLevel = summary.risk_level || 'unknown';
  const projectType = summary.project_type || 'unknown';

  // Helper to translate project types
  const formatProjectType = (type: string) => {
    switch (type.toLowerCase()) {
      case 'c-cpp-project':
        return 'C/C++ 工程';
      case 'web-frontend':
        return 'Web 前端工程';
      case 'node-app':
        return 'Node.js 应用工程';
      case 'python-project':
        return 'Python 工程';
      case 'go-project':
        return 'Go 工程';
      case 'rust-project':
        return 'Rust 工程';
      case 'generic':
        return '通用工程';
      case 'unknown':
        return '未知类型';
      default:
        return type;
    }
  };

  // Helper to translate risk levels
  const formatRiskLevel = (level: string) => {
    switch (level.toLowerCase()) {
      case 'low':
        return '低风险 (Low)';
      case 'medium':
        return '中风险 (Medium)';
      case 'high':
        return '高风险 (High)';
      case 'unknown':
        return '未知风险 (Unknown)';
      default:
        return level;
    }
  };

  // Helper to format language names nicely
  const formatLanguageName = (lang: string) => {
    const mapping: Record<string, string> = {
      'c': 'C',
      'cpp': 'C++',
      'javascript': 'JavaScript',
      'typescript': 'TypeScript',
      'python': 'Python',
      'go': 'Go',
      'rust': 'Rust',
      'yaml': 'YAML',
      'json': 'JSON',
      'html': 'HTML',
      'css': 'CSS',
      'markdown': 'Markdown',
      'make': 'Make',
      'xml': 'XML',
    };
    return mapping[lang.toLowerCase()] || lang;
  };

  // Helper to color risk levels
  const getRiskColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'low':
        return 'text-emerald-400 bg-emerald-950/30 border-emerald-900/30';
      case 'medium':
        return 'text-amber-400 bg-amber-950/30 border-amber-900/30';
      case 'high':
        return 'text-red-400 bg-red-950/30 border-red-900/30';
      default:
        return 'text-slate-400 bg-slate-800/30 border-slate-700/30';
    }
  };

  // Stack breakdown colors
  const getStackBarColor = (index: number) => {
    const colors = ['bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-pink-500', 'bg-rose-500'];
    return colors[index % colors.length];
  };

  return (
    <div className="space-y-6 text-slate-300">
      {/* Overview Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-950/50 text-indigo-400">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">工程类型</div>
            <div className="text-sm font-bold text-white">{formatProjectType(projectType)}</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-950/50 text-emerald-400">
            <Code2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">估计代码行数</div>
            <div className="text-sm font-bold text-white">{loc.toLocaleString()} 行</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-950/50 text-violet-400">
            <Terminal className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">扫描文件总数</div>
            <div className="text-sm font-bold text-white">{filesCount} 个</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-slate-950 text-slate-400">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase text-slate-500 tracking-wider">安全风险评级</div>
            <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border ${getRiskColor(riskLevel)}`}>
              {formatRiskLevel(riskLevel)}
            </span>
          </div>
        </div>
      </div>

      {/* Language / Stack breakdown progress bars */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-6">
        <h4 className="text-sm font-bold text-white mb-4 tracking-tight flex items-center gap-2">
          <Code2 className="h-4 w-4 text-indigo-400" />
          技术栈语言分布
        </h4>
        
        {/* Combined stacked progress bar */}
        <div className="h-4 w-full bg-slate-950 rounded-full overflow-hidden flex mb-4">
          {stackBreakdown.map((item: any, idx: number) => {
            const pct = parseFloat(item.percentage) || 0;
            if (pct <= 0) return null;
            return (
              <div
                key={item.language}
                style={{ width: `${pct}%` }}
                className={`${getStackBarColor(idx)} h-full transition-all`}
                title={`${formatLanguageName(item.language)}: ${pct}%`}
              />
            );
          })}
        </div>

        {/* Legend */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {stackBreakdown.map((item: any, idx: number) => (
            <div key={item.language} className="flex items-center gap-2">
              <span className={`h-3 w-3 rounded-full ${getStackBarColor(idx)} shrink-0`} />
              <div className="text-xs">
                <span className="font-semibold text-slate-200">{formatLanguageName(item.language)}</span>
                <span className="text-slate-500 ml-1.5">{item.percentage}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Build and Test Commands */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Build Commands */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-5">
          <h4 className="text-sm font-bold text-white mb-3 tracking-tight flex items-center gap-2">
            <Terminal className="h-4 w-4 text-indigo-400" />
            推荐编译构建指令 (Build)
          </h4>
          {buildCommands.length === 0 ? (
            <div className="text-xs text-slate-500 italic py-2">未检测到预定义编译指令</div>
          ) : (
            <div className="space-y-2">
              {buildCommands.map((cmd: string) => (
                <div key={cmd} className="rounded-lg bg-slate-950/80 border border-slate-900 p-2.5 font-mono text-xs text-indigo-300 flex items-center gap-2 select-text">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <code>{cmd}</code>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Test Commands */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-5">
          <h4 className="text-sm font-bold text-white mb-3 tracking-tight flex items-center gap-2">
            <Terminal className="h-4 w-4 text-indigo-400" />
            推荐测试验证指令 (Test)
          </h4>
          {testCommands.length === 0 ? (
            <div className="text-xs text-slate-500 italic py-2">未检测到预定义测试指令</div>
          ) : (
            <div className="space-y-2">
              {testCommands.map((cmd: string) => (
                <div key={cmd} className="rounded-lg bg-slate-950/80 border border-slate-900 p-2.5 font-mono text-xs text-indigo-300 flex items-center gap-2 select-text">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <code>{cmd}</code>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

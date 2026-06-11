import { useState } from 'react';
import { AgentFactoryPage } from './components/agent-factory/AgentFactoryPage';
import { ProjectsPage } from './components/projects/ProjectsPage';
import { EpicsPage } from './components/epics/EpicsPage';
import { useWebSocket } from './hooks/useWebSocket';
import { useAgentFactoryStore } from './stores/agentFactory';
import { LayoutDashboard, FolderGit2, Folder, Layers } from 'lucide-react';

function App() {
  // Enabled status web socket
  useWebSocket(true);

  const [view, setView] = useState<'dashboard' | 'projects' | 'epics'>('dashboard');
  const { projects, selectedProjectId, selectProject } = useAgentFactoryStore();

  return (
    <div className="min-h-screen bg-nms-bg text-nms-text flex flex-col font-sans">
      <header className="border-b border-nms-border bg-nms-surface px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-nms-accent flex items-center justify-center p-1.5 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
              <svg className="w-full h-full text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white">Agent Factory</h1>
              <p className="text-xs text-nms-text-dim">独立运行监控与代币预算看板</p>
            </div>
          </div>

          {/* View switcher navigation tabs */}
          <nav className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-lg border border-slate-800/40">
            <button
              onClick={() => setView('dashboard')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                view === 'dashboard'
                  ? 'bg-indigo-600 text-white shadow-md animate-in fade-in duration-150'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              任务看板
            </button>
            <button
              onClick={() => setView('epics')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                view === 'epics'
                  ? 'bg-cyan-600 text-white shadow-md animate-in fade-in duration-150'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Epic 编排
            </button>
            <button
              onClick={() => setView('projects')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                view === 'projects'
                  ? 'bg-indigo-600 text-white shadow-md animate-in fade-in duration-150'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderGit2 className="h-3.5 w-3.5" />
              项目管理
            </button>
          </nav>
        </div>

        {/* Global workspace switcher & Health indicator */}
        <div className="flex items-center gap-4">
          {view === 'dashboard' && (
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs">
              <Folder className="h-3.5 w-3.5 text-indigo-400" />
              <select
                value={selectedProjectId || ''}
                onChange={(e) => selectProject(e.target.value || null)}
                className="bg-transparent text-slate-300 border-none outline-none focus:ring-0 cursor-pointer font-medium"
              >
                <option value="" className="bg-slate-900 text-slate-300">所有本地项目 (ALL)</option>
                {projects.map((p) => (
                  <option key={p.project_id} value={p.project_id} className="bg-slate-900 text-slate-300">
                    {p.name} {p.status === 'disabled' ? '(已停用)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          
          <div className="text-xs text-nms-text-dim flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-nms-green animate-pulse" />
            服务监测正常
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 overflow-auto">
        {view === 'dashboard' ? <AgentFactoryPage /> : view === 'epics' ? <EpicsPage /> : <ProjectsPage />}
      </main>
    </div>
  );
}

export default App;

import React, { useState, useEffect } from 'react';
import { Plus, Power, Terminal, BookOpen, Cpu, ShieldAlert, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { RegisterProjectModal } from './RegisterProjectModal';
import { CreateProjectAduModal } from './CreateProjectAduModal';
import { AduIntakeWizard } from '../intake/AduIntakeWizard'; // Add this
import { ProjectProfilePanel } from './ProjectProfilePanel';
import { KnowledgePackPanel } from './KnowledgePackPanel';

export const ProjectsPage: React.FC = () => {
  const {
    projects,
    isProfiling,
    profilingLogs,
    runProjectProfiling,
    disableProject,
    refresh,
    loading
  } = useAgentFactoryStore();

  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [isCreateAduOpen, setIsCreateAduOpen] = useState(false);
  const [isIntakeWizardOpen, setIsIntakeWizardOpen] = useState(false); // Add this
  const [activeTab, setActiveTab] = useState<'profile' | 'knowledge'>('profile');
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (projects.length > 0 && !localSelectedId) {
      setLocalSelectedId(projects[0].project_id);
    }
  }, [projects, localSelectedId]);

  const currentProject = projects.find((p) => p.project_id === localSelectedId);

  const handleRunProfile = async (projectId: string) => {
    try {
      await runProjectProfiling(projectId);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDisable = async (projectId: string) => {
    if (confirm('确认停用该项目吗？停用后该项目下的所有 ADU 编排任务将被禁运并锁定为只读归档状态。')) {
      try {
        await disableProject(projectId);
      } catch (e) {
        alert('停用失败: ' + String(e));
      }
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'registered':
        return <span className=\"inline-flex items-center rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-300\">已注册</span>;
      case 'profiling':
        return (
          <span className=\"inline-flex items-center gap-1 rounded-full bg-indigo-950/50 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-semibold text-indigo-400\">
            <Loader2 className=\"h-2.5 w-2.5 animate-spin\" />
            画像中
          </span>
        );
      case 'profiled':
        return <span className=\"inline-flex items-center gap-1 rounded-full bg-emerald-950/50 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-400\"><CheckCircle2 className=\"h-2.5 w-2.5\" />已画像</span>;
      case 'profile_failed':
        return <span className=\"inline-flex items-center gap-1 rounded-full bg-red-950/50 border border-red-500/30 px-2 py-0.5 text-[10px] font-semibold text-red-400\"><AlertCircle className=\"h-2.5 w-2.5\" />画像失败</span>;
      case 'disabled':
        return <span className=\"inline-flex items-center gap-1 rounded-full bg-slate-950 border border-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-500\">已禁用</span>;
      default:
        return null;
    }
  };

  return (
    <div className=\"mx-auto max-w-7xl px-4 py-8 space-y-6 text-slate-100\">
      {/* Header bar */}
      <div className=\"flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-5\">
        <div>
          <h2 className=\"text-2xl font-bold tracking-tight text-white\">本地仓库与画像管理</h2>
          <p className=\"text-slate-400 text-sm mt-1\">接入并注册您本地的任意 Git 仓库，执行确定性扫描和画像 Agent 知识包提取。</p>
        </div>
        <button
          onClick={() => setIsRegisterOpen(true)}
          className=\"flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-950/50 hover:shadow-indigo-900/50 hover:-translate-y-0.5 transition-all\"
        >
          <Plus className=\"h-4.5 w-4.5\" />
          接入新项目
        </button>
      </div>

      <div className=\"grid grid-cols-1 lg:grid-cols-3 gap-6 items-start\">
        {/* Left Side: Projects List */}
        <div className=\"lg:col-span-1 space-y-4\">
          <div className=\"text-xs font-semibold text-slate-500 uppercase tracking-wider px-1\">
            已接入的项目 ({projects.length})
          </div>
          {projects.length === 0 && !loading ? (
            <div className=\"rounded-xl border border-dashed border-slate-800 bg-slate-900/10 p-8 text-center text-slate-500\">
              暂无已注册项目，请点击右上角按钮接入。
            </div>
          ) : (
            <div className=\"space-y-3\">
              {projects.map((project) => (
                <div
                  key={project.project_id}
                  onClick={() => setLocalSelectedId(project.project_id)}
                  className={`group relative rounded-xl border p-4 cursor-pointer backdrop-blur-md transition-all duration-200 ${
                    localSelectedId === project.project_id
                      ? 'bg-slate-900/60 border-indigo-500/50 shadow-lg shadow-indigo-950/30'
                      : 'bg-slate-900/20 border-slate-800/40 hover:bg-slate-900/40 hover:border-slate-800'
                  }`}
                >
                  <div className=\"flex items-start justify-between gap-2\">
                    <div className=\"space-y-1 truncate\">
                      <h4 className={`text-sm font-bold truncate transition-colors ${
                        localSelectedId === project.project_id ? 'text-white' : 'text-slate-300 group-hover:text-white'
                      }`}>
                        {project.name}
                      </h4>
                      <code className=\"block text-[10px] text-slate-500 font-mono truncate\">{project.repo_path}</code>
                    </div>
                    <div className=\"shrink-0\">
                      {getStatusBadge(isProfiling[project.project_id] ? 'profiling' : project.status)}
                    </div>
                  </div>
                  {project.description && (
                    <p className=\"text-xs text-slate-400 mt-2 truncate\">{project.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Side: Selected Project Detail Area */}
        <div className=\"lg:col-span-2 space-y-6\">
          {!currentProject ? (
            <div className=\"rounded-xl border border-slate-800 bg-slate-900/10 p-12 text-center text-slate-500\">
              请选择一个项目以查看其画像分析和架构文档。
            </div>
          ) : (
            <div className=\"space-y-6\">
              {/* Project Card Detail Header */}
              <div className=\"rounded-2xl border border-slate-800 bg-slate-900/30 p-6 backdrop-blur-md space-y-4\">
                <div className=\"flex flex-col sm:flex-row sm:items-center justify-between gap-4\">
                  <div className=\"space-y-1\">
                    <h3 className=\"text-lg font-bold text-white tracking-tight\">{currentProject.name}</h3>
                    <div className=\"flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500 font-mono\">
                      <span>ID: <b className=\"text-slate-300\">{currentProject.project_id}</b></span>
                      <span>PATH: <b className=\"text-slate-300\">{currentProject.repo_path}</b></span>
                    </div>
                  </div>

                  {/* Top action controls */}
                  <div className=\"flex items-center gap-2 flex-wrap\">
                    {currentProject.status === 'profiled' && (
                      <button
                        onClick={() => setIsCreateAduOpen(true)}
                        className=\"flex items-center gap-1.5 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-900/50 hover:bg-emerald-900/50 px-3.5 py-2 text-xs font-semibold transition-colors\"
                      >
                        <Plus className=\"h-4 w-4\" />
                        新建 ADU
                      </button>
                    )}
                    {currentProject.status === 'profiled' && (
                      <button
                        onClick={() => setIsIntakeWizardOpen(true)}
                        className=\"flex items-center gap-1.5 rounded-lg bg-amber-950 text-amber-400 border border-amber-900/50 hover:bg-amber-900/50 px-3.5 py-2 text-xs font-semibold transition-colors\"
                      >
                        <Plus className=\"h-4 w-4\" />
                        从原始需求创建 ADU
                      </button>
                    )}
                    {currentProject.status !== 'disabled' && (
                      <button
                        onClick={() => handleRunProfile(currentProject.project_id)}
                        disabled={isProfiling[currentProject.project_id] || currentProject.status === 'profiling'}
                        className=\"flex items-center gap-1.5 rounded-lg bg-indigo-950 text-indigo-400 border border-indigo-900/50 hover:bg-indigo-900/50 px-3.5 py-2 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors\"
                      >
                        <Terminal className=\"h-4 w-4\" />
                        {isProfiling[currentProject.project_id] ? '画像分析中...' : '运行画像 (Run Profile)'}
                      </button>
                    )}
                    {currentProject.status !== 'disabled' && currentProject.project_id !== 'default-open5gs' && (
                      <button
                        onClick={() => handleDisable(currentProject.project_id)}
                        className=\"flex items-center gap-1.5 rounded-lg bg-slate-950 text-slate-400 border border-slate-900 hover:bg-red-950 hover:text-red-400 hover:border-red-900/50 px-3.5 py-2 text-xs font-semibold transition-colors\"
                        title=\"禁用项目\"
                      >
                        <Power className=\"h-4 w-4\" />
                        禁用项目
                      </button>
                    )}
                  </div>
                </div>

                {currentProject.description && (
                  <p className=\"text-sm text-slate-400 border-t border-slate-800/60 pt-3\">{currentProject.description}</p>
                )}
              </div>

              {/* Tab Navigation */}
              <div className=\"flex border-b border-slate-800\">
                <button
                  onClick={() => setActiveTab('profile')}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-[2px] transition-all duration-150 ${
                    activeTab === 'profile'
                      ? 'border-indigo-500 text-white'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Cpu className=\"h-4 w-4\" />
                  项目画像 (Profile)
                </button>
                <button
                  onClick={() => setActiveTab('knowledge')}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-[2px] transition-all duration-150 ${
                    activeTab === 'knowledge'
                      ? 'border-indigo-500 text-white'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <BookOpen className=\"h-4 w-4\" />
                  架构知识库 (Knowledge Pack)
                </button>
              </div>

              {/* Tab Content Rendering */}
              {activeTab === 'profile' && (
                <div className=\"space-y-6\">
                  {/* Realtime profiling console output (displays if currently profiling or if failed) */}
                  {(isProfiling[currentProject.project_id] || (profilingLogs[currentProject.project_id] && profilingLogs[currentProject.project_id].length > 0)) && (
                    <div className=\"rounded-xl border border-slate-800 bg-slate-950/80 p-4 font-mono text-xs shadow-2xl backdrop-blur-md animate-in slide-in-from-top-4 duration-200\">
                      <div className=\"flex items-center justify-between border-b border-slate-800 pb-2 mb-3 text-slate-500\">
                        <div className=\"flex items-center gap-2\">
                          <Terminal className=\"h-4 w-4 text-indigo-400\" />
                          <span>项目画像执行日志终端</span>
                        </div>
                        {isProfiling[currentProject.project_id] && (
                          <span className=\"flex h-2 w-2 rounded-full bg-indigo-400 animate-ping\" />
                        )}
                      </div>
                      <pre className=\"max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text text-indigo-200/90 font-mono\">
                        {profilingLogs[currentProject.project_id]?.join('')}
                      </pre>
                    </div>
                  )}

                  {currentProject.status === 'registered' && !isProfiling[currentProject.project_id] && (
                    <div className=\"rounded-xl border border-slate-800 bg-slate-900/10 p-8 text-center text-slate-400 flex flex-col items-center justify-center\">
                      <ShieldAlert className=\"h-8 w-8 text-indigo-500/70 mb-2\" />
                      <p className=\"text-sm font-semibold text-white\">该项目尚未执行画像分析</p>
                      <p className=\"text-xs text-slate-500 mt-1 max-w-sm\">
                        请在右上角点击“运行画像 (Run Profile)”启动画像 Agent。Agent 会静静评估整个项目的架构模式，并自动提炼出四份中文知识说明包。
                      </p>
                    </div>
                  )}

                  {currentProject.status === 'profile_failed' && !isProfiling[currentProject.project_id] && (
                    <div className=\"rounded-xl border border-red-900/30 bg-red-950/10 p-8 text-center text-red-400 flex flex-col items-center justify-center\">
                      <ShieldAlert className=\"h-8 w-8 text-red-500/70 mb-2\" />
                      <p className=\"text-sm font-semibold text-white\">画像分析失败</p>
                      <p className=\"text-xs text-red-500/70 mt-1 max-w-sm\">
                        可能是画像 Agent 试图修改除 .agent-factory/ 外的文件被沙箱拦截，或是编译扫描出错。请阅读终端日志。
                      </p>
                    </div>
                  )}

                  {currentProject.status === 'disabled' && (
                    <div className=\"rounded-xl border border-slate-800 bg-slate-900/10 p-8 text-center text-slate-500 flex flex-col items-center justify-center\">
                      <ShieldAlert className=\"h-8 w-8 text-slate-600 mb-2\" />
                      <p className=\"text-sm font-semibold\">该项目已禁用</p>
                      <p className=\"text-xs mt-1\">项目目前锁定为只读归档状态，不允许继续启动编排运行或更新 Artifacts。</p>
                    </div>
                  )}

                  {currentProject.profile_summary && (
                    <ProjectProfilePanel profile={currentProject} />
                  )}
                </div>
              )}

              {activeTab === 'knowledge' && (
                <KnowledgePackPanel projectId={currentProject.project_id} />
              )}
            </div>
          )}
        </div>
      </div>

      <RegisterProjectModal isOpen={isRegisterOpen} onClose={() => setIsRegisterOpen(false)} />
      {currentProject && (
        <>
          <CreateProjectAduModal
            isOpen={isCreateAduOpen}
            onClose={() => setIsCreateAduOpen(false)}
            projectId={currentProject.project_id}
            projectName={currentProject.name}
          />
          <div className=\"fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm\" style={{display: isIntakeWizardOpen ? 'flex' : 'none'}}>
            <div className=\"bg-slate-900 rounded-2xl border border-slate-800 p-6 w-[800px] shadow-2xl\">
              <AduIntakeWizard projectId={currentProject.project_id} onClose={() => setIsIntakeWizardOpen(false)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
import { useState } from 'react';
import { Terminal, ShieldAlert, RotateCcw, Loader2 } from 'lucide-react';
import { agentFactoryApi } from '../../api/agentFactory';
import { WaiverDecisionPanel } from './WaiverDecisionPanel';


interface EnvironmentVerificationPanelProps {
  gateId: string;
  affectedAssertions?: string[];
  onSuccess: () => void;
  onCancel: () => void;
}

export function EnvironmentVerificationPanel({ gateId, affectedAssertions = [], onSuccess, onCancel }: EnvironmentVerificationPanelProps) {
  const [activeTab, setActiveTab] = useState<'submit' | 'waiver' | 'rework'>('submit');
  
  // Submit Results state
  const [command, setCommand] = useState('');
  const [exitCode, setExitCode] = useState<number>(0);
  const [output, setOutput] = useState('');
  
  // Rework state
  const [targetAgent, setTargetAgent] = useState<'developer' | 'rework-planner'>('developer');
  const [instruction, setInstruction] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmitResult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) {
      setError('Please specify the command that was run.');
      return;
    }
    if (!output.trim()) {
      setError('Please provide the command output logs.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await agentFactoryApi.submitRuntimeResult(gateId, {
        command: command.trim(),
        exitCode,
        output: output.trim()
      });
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit runtime result');
    } finally {
      setLoading(false);
    }
  };

  const handleRework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instruction.trim()) {
      setError('Please provide clear instructions for rework.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await agentFactoryApi.requestHumanGateRework(gateId, {
        targetAgent,
        instruction: instruction.trim()
      });

      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Failed to request rework');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Selector Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-900/60 p-1 rounded-lg">
        <button
          onClick={() => { setActiveTab('submit'); setError(null); }}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition-all flex-1 ${
            activeTab === 'submit'
              ? 'bg-indigo-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Terminal className="h-3.5 w-3.5" />
          手动提交测试结果
        </button>
        <button
          onClick={() => { setActiveTab('waiver'); setError(null); }}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition-all flex-1 ${
            activeTab === 'waiver'
              ? 'bg-blue-600/80 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          环境/测试豁免申请
        </button>
        <button
          onClick={() => { setActiveTab('rework'); setError(null); }}
          className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition-all flex-1 ${
            activeTab === 'rework'
              ? 'bg-amber-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          打回返工整改
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-950/40 border border-red-800/60 rounded text-red-400 text-xs font-semibold">
          {error}
        </div>
      )}

      {/* Tab 1: Submit Manual Output */}
      {activeTab === 'submit' && (
        <form onSubmit={handleSubmitResult} className="space-y-4 bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
            <Terminal className="h-4 w-4 text-indigo-400" />
            <h4 className="font-bold text-xs text-slate-300">提交本地运行控制台日志 (Submit Logs)</h4>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-400 mb-1">执行的测试命令 (Test Command):</label>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                required
                className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                placeholder="e.g. npm run test:project-adu"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">退出状态码 (Exit Code):</label>
              <input
                type="number"
                value={exitCode}
                onChange={(e) => setExitCode(Number(e.target.value))}
                required
                className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-400">输出控制台内容 (Stdout/Stderr output logs):</label>
            <textarea
              value={output}
              onChange={(e) => setOutput(e.target.value)}
              required
              rows={6}
              className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded p-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono resize-y"
              placeholder="请在此粘贴您的控制台输出，或者将本地测试跑出的结果文件内容粘贴进来。"
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 border border-slate-800 bg-slate-950 text-slate-400 text-xs font-semibold rounded hover:bg-slate-900 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !command.trim() || !output.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded disabled:opacity-50 transition-colors shadow-lg shadow-indigo-900/20"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <span>验证通过并继续</span>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Tab 2: Approve Waiver */}
      {activeTab === 'waiver' && (
        <WaiverDecisionPanel
          gateId={gateId}
          affectedAssertions={affectedAssertions}
          onSuccess={onSuccess}
          onCancel={onCancel}
        />
      )}

      {/* Tab 3: Request Rework */}
      {activeTab === 'rework' && (
        <form onSubmit={handleRework} className="space-y-4 bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
            <RotateCcw className="h-4 w-4 text-amber-400" />
            <h4 className="font-bold text-xs text-slate-300">打回进行代码或流程整改 (Request Rework)</h4>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">退回目标 (Target Agent):</label>
            <select
              value={targetAgent}
              onChange={(e) => setTargetAgent(e.target.value as any)}
              className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="developer">Developer Agent (直接打回修改代码)</option>
              <option value="rework-planner">Rework Planner (生成重新开发规划)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-400">整改指示与说明 (Rework Instructions):</label>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              required
              rows={4}
              className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded p-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none"
              placeholder="在此告知 Agent 应当修改的内容。例如：网元断言 A5 逻辑错误，请重写 tests/adu-xxx.js 的判断逻辑，并添加对 XXX 状态字段的覆盖。"
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 border border-slate-800 bg-slate-950 text-slate-400 text-xs font-semibold rounded hover:bg-slate-900 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !instruction.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded disabled:opacity-50 transition-colors shadow-lg shadow-amber-900/20"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <span>退回到开发态</span>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

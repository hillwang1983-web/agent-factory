import { useState } from 'react';
import { SlidersHorizontal, Coins, ShieldCheck, Cpu, Sliders } from 'lucide-react';
import { ModelSettingsPanel } from './ModelSettingsPanel';
import { TokenGovernancePanel } from '../token/TokenGovernancePanel';

export function SettingsPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<'models' | 'tokens' | 'policies' | 'hermes'>('models');

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Agent Factory 系统设置</h1>
          <p className="text-xs text-nms-text-dim mt-1">管理 Agent 模型分配、Token 预算及全局运行治理配置</p>
        </div>
      </div>

      {/* Segmented control tabs */}
      <div className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-lg border border-slate-800/40 w-fit">
        <button
          onClick={() => setActiveTab('models')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold transition-all ${
            activeTab === 'models'
              ? 'bg-indigo-600 text-white shadow-md animate-in fade-in duration-150'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Cpu className="h-3.5 w-3.5" />
          Agent 模型
        </button>
        <button
          onClick={() => setActiveTab('tokens')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold transition-all ${
            activeTab === 'tokens'
              ? 'bg-indigo-600 text-white shadow-md animate-in fade-in duration-150'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Coins className="h-3.5 w-3.5" />
          Token 治理
        </button>
        <button
          onClick={() => setActiveTab('policies')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold transition-all ${
            activeTab === 'policies'
              ? 'bg-indigo-600 text-white shadow-md animate-in fade-in duration-150'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          运行策略
        </button>
        <button
          onClick={() => setActiveTab('hermes')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold transition-all ${
            activeTab === 'hermes'
              ? 'bg-indigo-600 text-white shadow-md animate-in fade-in duration-150'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Hermes 状态
        </button>
      </div>

      <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-6 shadow-xl backdrop-blur-sm">
        {activeTab === 'models' && <ModelSettingsPanel />}
        {activeTab === 'tokens' && <TokenGovernancePanel />}
        {activeTab === 'policies' && (
          <div className="text-center py-12 text-slate-500 text-sm">
            <SlidersHorizontal className="h-10 w-10 mx-auto text-slate-600 mb-3" />
            运行策略配置模块（后续版本接入）
          </div>
        )}
        {activeTab === 'hermes' && (
          <div className="text-center py-12 text-slate-500 text-sm">
            <Cpu className="h-10 w-10 mx-auto text-slate-600 mb-3" />
            Hermes 运行状态及连接监测控制板（后续版本接入）
          </div>
        )}
      </div>
    </div>
  );
}

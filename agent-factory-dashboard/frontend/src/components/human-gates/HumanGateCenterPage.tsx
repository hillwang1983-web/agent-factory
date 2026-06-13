import { useEffect, useState } from 'react';
import { UserCheck, RefreshCw, Inbox, ArrowRight } from 'lucide-react';
import { agentFactoryApi } from '../../api/agentFactory';
import type { HumanGate } from '../../types/agent-factory';
import { HumanGateDetailPanel } from './HumanGateDetailPanel';

export function HumanGateCenterPage() {
  const [gates, setGates] = useState<HumanGate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'resolved'>('pending');
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null);

  const fetchGates = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      // Fetch all gates and filter locally or fetch based on filter status
      const data = await agentFactoryApi.fetchHumanGates();
      setGates(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch human gates');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchGates(true);
    const timer = setInterval(() => {
      void fetchGates(false);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleRefresh = () => {
    void fetchGates(true);
  };

  // Filter gates locally
  const filteredGates = gates.filter((g) => {
    if (filter === 'pending') return g.status === 'pending';
    if (filter === 'resolved') return g.status !== 'pending';
    return true;
  });

  const selectedGate = gates.find((g) => g.gate_id === selectedGateId) || null;

  const getGateTypeLabel = (type: string) => {
    switch (type) {
      case 'environment_verification_required':
        return '环境测试缺失';
      case 'analysis_review':
        return '需求评审确认';
      case 'design_review':
        return '设计评审确认';
      case 'clarification_required':
        return '未答澄清阻断';
      case 'write_path_expansion':
        return '写路径变更拓展';
      case 'token_budget_approval':
        return 'Token 预算超支';
      case 'command_policy_exception':
        return '命令安全审计';
      default:
        return type;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold font-display text-nms-text flex items-center gap-2">
            <UserCheck className="h-6 w-6 text-indigo-400" />
            人工干预与质量门控中心
          </h1>
          <p className="text-sm text-nms-text-dim mt-1">
            集中处置开发流程中的环境不可用例外、手工提交测试命令、契约豁免和代币溢出预算授权
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="nms-btn-ghost flex items-center gap-2 text-xs text-slate-300 hover:text-nms-text"
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新数据
        </button>
      </div>

      {error && (
        <div className="nms-card border-red-500/20 bg-red-500/5 text-red-400 p-4">
          <h3 className="font-semibold text-sm">Failed to sync human gates</h3>
          <p className="text-xs mt-1">{error}</p>
        </div>
      )}

      {/* Tabs bar */}
      <div className="flex border-b border-slate-800 pb-px gap-4">
        <button
          onClick={() => { setFilter('pending'); setSelectedGateId(null); }}
          className={`pb-3 text-xs font-bold transition-all relative ${
            filter === 'pending' ? 'text-indigo-400 font-extrabold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          待处理 (Pending)
          {filter === 'pending' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />}
        </button>
        <button
          onClick={() => { setFilter('resolved'); setSelectedGateId(null); }}
          className={`pb-3 text-xs font-bold transition-all relative ${
            filter === 'resolved' ? 'text-indigo-400 font-extrabold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          已处置 (Resolved)
          {filter === 'resolved' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />}
        </button>
        <button
          onClick={() => { setFilter('all'); setSelectedGateId(null); }}
          className={`pb-3 text-xs font-bold transition-all relative ${
            filter === 'all' ? 'text-indigo-400 font-extrabold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          全部纪录 (All)
          {filter === 'all' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-full" />}
        </button>
      </div>

      {/* Split screen layout */}
      <div className="grid grid-cols-12 gap-6">
        <div className={`col-span-12 transition-all duration-300 ${selectedGate ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            {filteredGates.length === 0 ? (
              <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
                <Inbox className="h-8 w-8 opacity-30 text-indigo-400" />
                <span className="text-xs">没有匹配的质量卡点门禁任务</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800/80 text-slate-400 font-semibold uppercase tracking-wider bg-slate-950/20">
                      <th className="py-3 px-4">门禁类型</th>
                      <th className="py-3 px-4">对象/任务</th>
                      <th className="py-3 px-4">阻断原因</th>
                      <th className="py-3 px-4">触发时间</th>
                      <th className="py-3 px-4">状态</th>
                      <th className="py-3 px-4 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {filteredGates.map((gate) => {
                      const isSelected = selectedGateId === gate.gate_id;
                      return (
                        <tr
                          key={gate.gate_id}
                          className={`transition-colors cursor-pointer hover:bg-slate-950/25 ${
                            isSelected ? 'bg-indigo-950/15 hover:bg-indigo-950/20' : ''
                          }`}
                          onClick={() => setSelectedGateId(gate.gate_id)}
                        >
                          <td className="py-3.5 px-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border capitalize ${
                              gate.gate_type === 'environment_verification_required'
                                ? 'bg-cyan-950/40 border-cyan-800/60 text-cyan-400'
                                : gate.gate_type === 'token_budget_approval'
                                ? 'bg-red-950/40 border-red-800/60 text-red-400'
                                : 'bg-slate-800/60 border-slate-700/60 text-slate-400'
                            }`}>
                              {getGateTypeLabel(gate.gate_type)}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-mono font-bold text-slate-200">
                            <div className="flex flex-col">
                              <span>{gate.target_id}</span>
                              {gate.epic_id && <span className="text-[10px] text-slate-500 font-normal">{gate.epic_id}</span>}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-slate-400 max-w-[200px] truncate" title={gate.reason}>
                            {gate.reason}
                          </td>
                          <td className="py-3.5 px-4 text-slate-400">
                            {new Date(gate.created_at).toLocaleString()}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                              gate.status === 'pending'
                                ? 'bg-amber-500/20 text-amber-300'
                                : gate.status === 'approved' || gate.status === 'resolved'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : gate.status === 'waived'
                                ? 'bg-blue-500/20 text-blue-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}>
                              {gate.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedGateId(gate.gate_id);
                              }}
                              className={`px-3 py-1 rounded text-[10px] font-bold flex items-center gap-1 mx-auto transition-all ${
                                gate.status === 'pending'
                                  ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-sm shadow-amber-900/10'
                                  : 'bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700'
                              }`}
                            >
                              <span>{gate.status === 'pending' ? '处理' : '查看'}</span>
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {selectedGate && (
          <div className="col-span-12 lg:col-span-5">
            <HumanGateDetailPanel
              gate={selectedGate}
              onClose={() => setSelectedGateId(null)}
              onRefresh={() => {
                setSelectedGateId(null);
                void fetchGates(true);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAgentFactoryStore } from '../../stores/agentFactory';
import { SettingsSectionHeader } from './SettingsSectionHeader';

interface HermesModelOption {
  provider: string;
  model: string;
  label: string;
  isDefault: boolean;
  source: string;
}

interface ModelSetting {
  agentId: string;
  provider?: string;
  model: string;
}

const AGENT_ROLE_META: Record<string, {
  label: string;
  stage: string;
  recommendedTier: 'Premium' | 'Balanced' | 'Cost' | 'Deterministic';
  description: string;
}> = {
  'requirement-analyst': {
    label: '需求分析',
    stage: '需求澄清',
    recommendedTier: 'Premium',
    description: '负责理解需求、识别歧义和输出分析文档'
  },
  'detail-designer': {
    label: '详细设计',
    stage: '方案设计',
    recommendedTier: 'Premium',
    description: '负责模块设计、接口设计和修改范围判断'
  },
  'contract': {
    label: '契约生成',
    stage: '质量门定义',
    recommendedTier: 'Premium',
    description: '负责将设计固化为可校验断言'
  },
  'testwriter': {
    label: '测试编写',
    stage: '测试准备',
    recommendedTier: 'Balanced',
    description: '负责生成红灯测试或验证脚本'
  },
  'developer': {
    label: '代码实现',
    stage: '实现',
    recommendedTier: 'Balanced',
    description: '负责按契约和设计修改代码'
  },
  'code-reviewer': {
    label: '代码审查',
    stage: '审查',
    recommendedTier: 'Premium',
    description: '负责发现实现偏差和高风险缺陷'
  },
  'buildfix-debugger': {
    label: '编译修复',
    stage: '调试',
    recommendedTier: 'Cost',
    description: '负责构建、测试失败后的定位和修复'
  },
  'acceptance-reviewer': {
    label: '验收审查',
    stage: '验收',
    recommendedTier: 'Premium',
    description: '负责确认实现是否满足需求和契约'
  },
  'evidence': {
    label: '证据归档',
    stage: '归档',
    recommendedTier: 'Cost',
    description: '负责整理最终证据矩阵和交付材料'
  }
};

const API_URL = import.meta.env.VITE_API_URL || '';

export function ModelSettingsPanel(): JSX.Element {
  const [settings, setSettings] = useState<ModelSetting[]>([]);
  const [models, setModels] = useState<HermesModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingRow, setUpdatingRow] = useState<string | null>(null);
  const [successRow, setSuccessRow] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const { dashboard, controlEnabled, refresh } = useAgentFactoryStore();
  const agents = dashboard?.agents || [];

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_URL}/api/agent-factory/agents/model-settings`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('加载模型设置失败');
      const data: Record<string, { model?: string; provider?: string }> = await res.json();
      const arr: ModelSetting[] = Object.entries(data).map(([agentId, cfg]) => ({
        agentId,
        provider: cfg.provider,
        model: cfg.model ?? 'default',
      }));
      setSettings(arr);
    } catch (err: any) {
      console.error(err);
    }
  };

  const fetchModels = async () => {
    try {
      const res = await fetch(`${API_URL}/api/agent-factory/hermes/models`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('加载 Hermes 模型选项失败');
      const data: HermesModelOption[] = await res.json();
      setModels(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  useEffect(() => {
    const promises: Promise<any>[] = [fetchSettings(), fetchModels()];
    if (!dashboard) {
      promises.push(refresh());
    }
    void Promise.all(promises).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleModelChange = async (agentId: string, e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!controlEnabled) return;
    const val = e.target.value;
    let provider = '';
    let model = 'default';
    if (val !== 'default') {
      const parts = val.split('/');
      provider = parts[0];
      model = parts.slice(1).join('/');
    }

    setUpdatingRow(agentId);
    setSuccessRow(null);
    setErrors(prev => ({ ...prev, [agentId]: null }));

    try {
      const res = await fetch(`${API_URL}/api/agent-factory/agents/${agentId}/model`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || '保存失败');
      }

      setSettings((prev) => {
        const existing = prev.find((s) => s.agentId === agentId);
        if (existing) {
          return prev.map((s) => (s.agentId === agentId ? { ...s, provider, model } : s));
        } else {
          return [...prev, { agentId, provider, model }];
        }
      });

      setSuccessRow(agentId);
      setTimeout(() => {
        setSuccessRow(prev => prev === agentId ? null : prev);
      }, 3000);
    } catch (err: any) {
      console.error(err);
      setErrors(prev => ({ ...prev, [agentId]: err.message || '网络或服务异常' }));
    } finally {
      setUpdatingRow(null);
    }
  };

  // Group models by provider
  const modelsByProvider = models.reduce((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider].push(m);
    return acc;
  }, {} as Record<string, HermesModelOption[]>);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center gap-2 text-sm text-nms-text-dim">
        <RefreshCw className="w-5 h-5 animate-spin text-indigo-500" /> 加载系统模型配置中…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SettingsSectionHeader
          title="Agent 模型分配"
          description="为不同开发阶段的 AI Agent 分配最合适的大语言模型。Premium 档位更智能但成本更高，Balanced 与 Cost 档位速度较快且成本低廉。"
        />
        {!controlEnabled && (
          <span className="flex items-center gap-1.5 text-xs text-nms-amber bg-nms-amber/10 border border-nms-amber/20 px-3 py-1 rounded-full font-semibold">
            <ShieldAlert className="w-3.5 h-3.5" /> 当前为只读模式
          </span>
        )}
      </div>

      <div className="overflow-x-auto border border-slate-800/80 rounded-lg bg-slate-950/20">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-400 font-semibold uppercase tracking-wider">
              <th className="px-4 py-3">Agent 角色</th>
              <th className="px-4 py-3">职责说明</th>
              <th className="px-4 py-3">推荐档位</th>
              <th className="px-4 py-3">模型分配</th>
              <th className="px-4 py-3 text-center">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {agents.map((agent) => {
              const meta = AGENT_ROLE_META[agent.id] || {
                label: agent.id,
                stage: '自定义',
                recommendedTier: 'Balanced',
                description: '未配置职责说明'
              };

              const setting = settings.find((s) => s.agentId === agent.id);
              const provider = setting?.provider;
              const model = setting?.model ?? 'default';
              const displayValue = provider && model && model !== 'default' ? `${provider}/${model}` : 'default';

              const isUpdating = updatingRow === agent.id;
              const isSuccess = successRow === agent.id;
              const rowError = errors[agent.id];

              let tierBadgeClass = '';
              if (meta.recommendedTier === 'Premium') {
                tierBadgeClass = 'text-purple-400 bg-purple-500/10 border-purple-500/20';
              } else if (meta.recommendedTier === 'Balanced') {
                tierBadgeClass = 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
              } else if (meta.recommendedTier === 'Cost') {
                tierBadgeClass = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
              } else {
                tierBadgeClass = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
              }

              return (
                <tr key={agent.id} className="hover:bg-slate-900/20 transition-colors">
                  <td className="px-4 py-3.5 font-semibold text-slate-200">
                    <div className="font-mono text-sm break-all">{agent.id}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{meta.label} ({meta.stage})</div>
                  </td>
                  <td className="px-4 py-3.5 text-slate-300 max-w-xs whitespace-normal">
                    {meta.description}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex px-2 py-0.5 border text-[10px] font-semibold rounded-full ${tierBadgeClass}`}>
                      {meta.recommendedTier}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <select
                      disabled={!controlEnabled || isUpdating}
                      value={displayValue}
                      onChange={(e) => handleModelChange(agent.id, e)}
                      className="w-full max-w-[280px] bg-slate-900 text-slate-200 text-xs border border-slate-800 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-nms-accent disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <option value="default">default (默认配置)</option>
                      {Object.entries(modelsByProvider).map(([prov, opts]) => (
                        <optgroup key={prov} label={prov.toUpperCase()} className="bg-slate-950 font-semibold text-slate-400">
                          {opts.map((m) => (
                            <option key={`${m.provider}/${m.model}`} value={`${m.provider}/${m.model}`} className="bg-slate-900 text-slate-200 font-normal">
                              {m.label}{m.isDefault ? ' (★ 缺省)' : ''}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <div className="flex items-center justify-center min-h-[24px]">
                      {isUpdating && (
                        <span className="flex items-center gap-1 text-[10px] text-slate-400">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" /> 保存中
                        </span>
                      )}
                      {isSuccess && (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> 已保存
                        </span>
                      )}
                      {rowError && (
                        <span className="flex items-center gap-1 text-[10px] text-rose-400 font-medium" title={rowError}>
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400" /> 失败
                        </span>
                      )}
                      {!isUpdating && !isSuccess && !rowError && (
                        <span className="text-[10px] text-slate-500">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

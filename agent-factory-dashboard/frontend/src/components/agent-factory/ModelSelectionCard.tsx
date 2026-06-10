import { useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { useAgentFactoryStore } from '../../stores/agentFactory';

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

const API_URL = import.meta.env.VITE_API_URL || '';

export function ModelSelectionCard(): JSX.Element {
  const [settings, setSettings] = useState<ModelSetting[]>([]);
  const [models, setModels] = useState<HermesModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const { dashboard, controlEnabled } = useAgentFactoryStore();
  const agents = dashboard?.agents || [];

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_URL}/api/agent-factory/agents/model-settings`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load model settings');
      const data: Record<string, { model?: string; provider?: string }> = await res.json();
      const arr: ModelSetting[] = Object.entries(data).map(([agentId, cfg]) => ({
        agentId,
        provider: cfg.provider,
        model: cfg.model ?? 'default',
      }));
      setSettings(arr);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchModels = async () => {
    try {
      const res = await fetch(`${API_URL}/api/agent-factory/hermes/models`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to load Hermes models');
      const data: HermesModelOption[] = await res.json();
      setModels(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    void Promise.all([fetchSettings(), fetchModels()]).finally(() => setLoading(false));
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
    setUpdating(agentId);
    try {
      await fetch(`${API_URL}/api/agent-factory/agents/${agentId}/model`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model }),
      });
      setSettings((prev) => {
        const existing = prev.find((s) => s.agentId === agentId);
        if (existing) {
          return prev.map((s) => (s.agentId === agentId ? { ...s, provider, model } : s));
        } else {
          return [...prev, { agentId, provider, model }];
        }
      });
    } catch (err) {
      console.error(err);
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="p-4 flex items-center gap-2 text-sm text-nms-text-dim animate-pulse bg-nms-surface-1 border border-nms-surface-2 rounded-lg">
        <RefreshCw className="w-4 h-4 animate-spin" /> 加载模型配置…
      </div>
    );
  }

  return (
    <div className="nms-card bg-nms-surface-1 border-nms-surface-2 p-4 space-y-4 mb-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-nms-text">模型选择</h2>
        {!controlEnabled && (
          <span className="flex items-center gap-1 text-[10px] text-nms-amber bg-nms-amber/10 border border-nms-amber/20 px-2 py-0.5 rounded-full font-medium">
            <ShieldAlert className="w-3 h-3" /> 只读模式
          </span>
        )}
      </div>

      {agents.length === 0 && (
        <div className="text-xs text-nms-text-dim">暂无可用 Agent 角色</div>
      )}

      <div className="space-y-3">
        {agents.map((agent) => {
          const setting = settings.find((s) => s.agentId === agent.id);
          const provider = setting?.provider;
          const model = setting?.model ?? 'default';
          const displayValue = provider && model && model !== 'default' ? `${provider}/${model}` : 'default';

          return (
            <div key={agent.id} className="flex items-center gap-3">
              <span className="text-sm w-32 text-nms-text-dim truncate font-mono" title={agent.id}>
                {agent.id}
              </span>
              <select
                disabled={!controlEnabled || updating === agent.id}
                value={displayValue}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleModelChange(agent.id, e)}
                className="flex-1 bg-nms-surface-2 text-nms-text text-xs border border-nms-surface-3 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-nms-accent disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="default">default</option>
                {models.map((m) => (
                  <option key={`${m.provider}/${m.model}`} value={`${m.provider}/${m.model}`}>
                    [{m.provider}] {m.label}{m.isDefault ? ' ★' : ''}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

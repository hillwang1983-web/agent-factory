import { useEffect, useState } from 'react';
import { agentFactoryApi } from '../../api/agentFactory';
import { Coins, Loader2, Save, Sparkles, CheckCircle2 } from 'lucide-react';

export function TokenGovernancePanel() {
  const [config, setConfig] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    const loadConfig = async () => {
      try {
        setLoading(true);
        const data = await agentFactoryApi.fetchTokenGovernance();
        if (active) {
          setConfig(data);
        }
      } catch (_) {}
      finally {
        if (active) setLoading(false);
      }
    };
    loadConfig();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    try {
      setSaving(true);
      await agentFactoryApi.updateTokenGovernance(config);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (_) {}
    finally {
      setSaving(false);
    }
  };

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center p-8 bg-slate-900 border border-slate-800 rounded-xl">
        <Loader2 className="h-6 w-6 text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-4 mb-6">
        <Coins className="h-5 w-5 text-indigo-400" />
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">代币成本治理 (Token Cost Governance)</h3>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">全局默认预算限制 (Global Defaults)</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  输入警告值 (Warning Input Tokens)
                </label>
                <input
                  type="number"
                  value={config.defaults.warning_input_tokens}
                  onChange={(e) => setConfig({
                    ...config,
                    defaults: { ...config.defaults, warning_input_tokens: parseInt(e.target.value, 10) }
                  })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-medium"
                />
              </div>
              
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  输入拦截值 (Hard Input Tokens)
                </label>
                <input
                  type="number"
                  value={config.defaults.hard_input_tokens}
                  onChange={(e) => setConfig({
                    ...config,
                    defaults: { ...config.defaults, hard_input_tokens: parseInt(e.target.value, 10) }
                  })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  输出警告值 (Warning Output Tokens)
                </label>
                <input
                  type="number"
                  value={config.defaults.warning_output_tokens}
                  onChange={(e) => setConfig({
                    ...config,
                    defaults: { ...config.defaults, warning_output_tokens: parseInt(e.target.value, 10) }
                  })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-medium"
                />
              </div>
              
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  输出拦截值 (Hard Output Tokens)
                </label>
                <input
                  type="number"
                  value={config.defaults.hard_output_tokens}
                  onChange={(e) => setConfig({
                    ...config,
                    defaults: { ...config.defaults, hard_output_tokens: parseInt(e.target.value, 10) }
                  })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-medium"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">裁剪策略配置 (Context Policy)</h4>
            
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  知识包加载方式 (Knowledge Pack Mode)
                </label>
                <select
                  value={config.context_policy.knowledge_pack_mode}
                  onChange={(e) => setConfig({
                    ...config,
                    context_policy: { ...config.context_policy, knowledge_pack_mode: e.target.value }
                  })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="selective">选择性注入 (Selective)</option>
                  <option value="full">完全载入 (Full)</option>
                  <option value="none">禁止注入 (None)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  运行历史压缩 (Run History Mode)
                </label>
                <select
                  value={config.context_policy.run_history_mode}
                  onChange={(e) => setConfig({
                    ...config,
                    context_policy: { ...config.context_policy, run_history_mode: e.target.value }
                  })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="summarized">注入概要 (Summarized)</option>
                  <option value="full">完全加载 (Full)</option>
                  <option value="last_only">仅载入最近一次 (Last Only)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 mt-6 border-t border-slate-800/80 pt-4">
          <div className="text-slate-500 text-xs flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            超限时，将会在 pipeline 中触发 `token_budget_approval` 审核门。
          </div>
          
          <button
            type="submit"
            disabled={saving}
            className="ml-auto flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-lg shadow-indigo-900/20"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : success ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 animate-in fade-in" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {success ? '已保存!' : '保存配置 (Save Configuration)'}
          </button>
        </div>
      </form>
    </div>
  );
}

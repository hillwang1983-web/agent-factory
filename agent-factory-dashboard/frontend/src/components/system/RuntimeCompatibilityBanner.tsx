import React from 'react';
import { AlertOctagon, RefreshCw } from 'lucide-react';

interface RuntimeCompatibilityBannerProps {
  reason: 'api_error' | 'phase_too_low' | 'control_disabled' | 'missing_capability';
  errorDetail?: string;
  onRetry: () => void;
}

export const RuntimeCompatibilityBanner: React.FC<RuntimeCompatibilityBannerProps> = ({
  reason,
  errorDetail,
  onRetry,
}) => {
  const getErrorMessage = () => {
    switch (reason) {
      case 'api_error':
        return {
          title: '无法连接到后端服务',
          desc: '前端控制台无法与后端 API 建立通信，可能后端未启动，或者接口已变更（返回了 404）。',
        };
      case 'phase_too_low':
        return {
          title: '后端运行版本不兼容 (Phase 过低)',
          desc: '检测到当前后端服务的运行阶段低于前端要求。控制台运行在 Phase 3.7，请升级后端系统。',
        };
      case 'control_disabled':
        return {
          title: '后端未启用控制模式',
          desc: '后端未设置 AGENT_FACTORY_ENABLE_CONTROL=true，导致所有控制与操作性 API 被禁用。',
        };
      case 'missing_capability':
        return {
          title: '缺少 Operator Control 运行能力',
          desc: '后端服务响应中未包含要求的 [operator-control] 核心服务能力。',
        };
      default:
        return {
          title: '未知系统兼容性冲突',
          desc: '系统环境校验未通过，请检查服务日志。',
        };
    }
  };

  const { title, desc } = getErrorMessage();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
      <div className="relative w-full max-w-xl bg-slate-900 border border-red-500/30 rounded-xl shadow-[0_0_50px_rgba(239,68,68,0.15)] overflow-hidden">
        {/* Top Accent Gradient Bar */}
        <div className="h-1.5 bg-gradient-to-r from-red-600 via-orange-500 to-red-600" />

        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-red-950/50 border border-red-500/20 flex items-center justify-center shrink-0">
              <AlertOctagon className="h-6 w-6 text-red-500 animate-pulse" />
            </div>

            <div className="flex-1 space-y-2">
              <h2 className="text-lg font-bold text-white tracking-tight">{title}</h2>
              <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>

              {errorDetail && (
                <div className="mt-4 p-3 bg-black/40 rounded border border-slate-800 font-mono text-xs text-red-400/90 break-all max-h-32 overflow-y-auto">
                  {errorDetail}
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-slate-850 pt-4">
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-red-950/50 hover:shadow-red-900/50 active:scale-95 transition-all"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重新检测兼容性
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

import { useEffect, useState } from 'react';
import { agentFactoryApi } from '../../api/agentFactory';

interface TokenBudgetChartProps {
  aduId?: string;
}

interface BudgetData {
  inputTokenLimit: number;
  outputTokenLimit: number;
  inputUsed: number;
  outputUsed: number;
  warnAtRatio: number;
}

export function TokenBudgetChart({ aduId }: TokenBudgetChartProps): JSX.Element {
  const [budget, setBudget] = useState<BudgetData | null>(null);

  useEffect(() => {
    if (!aduId) return;
    const fetchBudget = async () => {
      try {
        const data = await agentFactoryApi.fetchTokenBudget(aduId);
        const defaultCfg = data.limits?.default ?? data.default ?? {};
        const usage = data.usage ?? defaultCfg;
        setBudget({
          inputTokenLimit: defaultCfg.inputTokenLimit ?? 500000,
          outputTokenLimit: defaultCfg.outputTokenLimit ?? 100000,
          inputUsed: usage.inputTokens ?? usage.inputUsed ?? 0,
          outputUsed: usage.outputTokens ?? usage.outputUsed ?? 0,
          warnAtRatio: defaultCfg.warnAtRatio ?? 0.8,
        });
      } catch {
        // If fetch fails entirely, show defaults
        setBudget({
          inputTokenLimit: 500000,
          outputTokenLimit: 100000,
          inputUsed: 0,
          outputUsed: 0,
          warnAtRatio: 0.8,
        });
      }
    };
    void fetchBudget();
  }, [aduId]);

  if (!aduId) {
    return <div className="text-sm text-nms-text-dim">未选择 ADU</div>;
  }

  const inputPercent = budget && budget.inputTokenLimit > 0
    ? Math.min(100, (budget.inputUsed / budget.inputTokenLimit) * 100)
    : 0;
  const outputPercent = budget && budget.outputTokenLimit > 0
    ? Math.min(100, (budget.outputUsed / budget.outputTokenLimit) * 100)
    : 0;

  const getBarColor = (percent: number, warnAt: number): string => {
    if (percent >= 100) return 'bg-red-500';
    if (percent >= warnAt * 100) return 'bg-amber-500';
    return 'bg-nms-accent';
  };

  return (
    <div className="nms-card bg-nms-surface-1 border-nms-surface-2 p-4 space-y-3">
      <h2 className="text-base font-semibold text-nms-text">代币预算</h2>

      {/* Input tokens */}
      <div>
        <div className="flex justify-between text-xs text-nms-text-dim mb-1">
          <span>输入 Token</span>
          <span>
            {budget ? `${budget.inputUsed.toLocaleString()} / ${budget.inputTokenLimit.toLocaleString()}` : 'N/A'}
          </span>
        </div>
        <div className="bg-nms-surface-2 rounded-full h-2.5 overflow-hidden">
          <div
            className={`${getBarColor(inputPercent, budget?.warnAtRatio ?? 0.8)} h-full rounded-full transition-all`}
            style={{ width: `${inputPercent}%` }}
          />
        </div>
      </div>

      {/* Output tokens */}
      <div>
        <div className="flex justify-between text-xs text-nms-text-dim mb-1">
          <span>输出 Token</span>
          <span>
            {budget ? `${budget.outputUsed.toLocaleString()} / ${budget.outputTokenLimit.toLocaleString()}` : 'N/A'}
          </span>
        </div>
        <div className="bg-nms-surface-2 rounded-full h-2.5 overflow-hidden">
          <div
            className={`${getBarColor(outputPercent, budget?.warnAtRatio ?? 0.8)} h-full rounded-full transition-all`}
            style={{ width: `${outputPercent}%` }}
          />
        </div>
      </div>

      {budget && (
        <div className="text-[10px] text-nms-text-dim">
          警告阈值: {((budget.warnAtRatio) * 100).toFixed(0)}%
        </div>
      )}
    </div>
  );
}

import type { QualityReports } from '../../types/agent-factory';
import { ShieldCheck, Code, Award } from 'lucide-react';

interface QualityReportBadgeProps {
  reports: QualityReports | null;
}

export function QualityReportBadge({ reports }: QualityReportBadgeProps): JSX.Element {
  if (!reports) {
    return (
      <div className="flex gap-1.5 items-center">
        <span className="text-[10px] text-nms-text-dim/40 font-medium">无质量报告</span>
      </div>
    );
  }

  const { contract, codeReview, acceptanceReview } = reports;

  const getStatusStyle = (exists: boolean, status?: string | boolean, valid?: boolean) => {
    if (!exists) return 'bg-nms-surface-2 border-nms-surface-3/30 text-nms-text-dim/40';
    
    const isPassed = status === true || status === 'pass';
    if (isPassed) {
      if (valid === false) {
        return 'bg-amber-500/10 border-amber-500/20 text-amber-400 animate-pulse';
      }
      return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
    } else {
      return 'bg-red-500/10 border-red-500/20 text-red-400 animate-pulse';
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Contract Gate */}
      <div
        className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors duration-200 ${getStatusStyle(
          contract.exists,
          contract.valid
        )}`}
        title={contract.exists ? (contract.valid ? '硬验收契约：有效 (v2)' : '普通契约 (v1)') : '未签署契约'}
      >
        <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
        <span>契约</span>
      </div>

      {/* Code Review Gate */}
      <div
        className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors duration-200 ${getStatusStyle(
          codeReview.exists,
          codeReview.status,
          codeReview.valid
        )}`}
        title={
          codeReview.exists
            ? codeReview.status === 'pass'
              ? codeReview.valid !== false
                ? '代码审查：通过'
                : '代码审查：无效通过报告 (未通过校验)'
              : '代码审查：未通过'
            : '未启动代码审查'
        }
      >
        <Code className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          {codeReview.exists && codeReview.status === 'pass' && codeReview.valid === false
            ? '审查 (无效)'
            : '审查'}
        </span>
      </div>

      {/* Acceptance Gate */}
      <div
        className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors duration-200 ${getStatusStyle(
          acceptanceReview.exists,
          acceptanceReview.status,
          acceptanceReview.valid
        )}`}
        title={
          acceptanceReview.exists
            ? acceptanceReview.status === 'pass'
              ? acceptanceReview.valid !== false
                ? '验收审计：通过'
                : '验收审计：无效通过报告 (未通过校验)'
              : '验收审计：未通过'
            : '未启动验收审计'
        }
      >
        <Award className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          {acceptanceReview.exists && acceptanceReview.status === 'pass' && acceptanceReview.valid === false
            ? '验收 (无效)'
            : '验收'}
        </span>
      </div>
    </div>
  );
}

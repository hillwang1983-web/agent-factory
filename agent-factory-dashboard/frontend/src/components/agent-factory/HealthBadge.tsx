import type { AgentFactoryHealth } from '../../types/agent-factory';

interface HealthBadgeProps {
  status: AgentFactoryHealth;
}

export function HealthBadge({ status }: HealthBadgeProps): JSX.Element {
  let classes = 'px-2 py-0.5 text-xs font-semibold rounded-full border ';

  switch (status) {
    case 'healthy':
      classes += 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      break;
    case 'active':
      classes += 'bg-nms-accent/10 text-nms-accent border-nms-accent/20';
      break;
    case 'blocked':
      classes += 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      break;
    case 'running':
      classes += 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20 animate-pulse';
      break;
    case 'stale':
      classes += 'bg-slate-500/10 text-slate-300 border-slate-500/20';
      break;
    case 'failed':
      classes += 'bg-red-500/10 text-red-400 border-red-500/20';
      break;
    default:
      classes += 'bg-slate-500/10 text-slate-300 border-slate-500/20';
  }

  const label = status.charAt(0).toUpperCase() + status.slice(1);

  return <span className={classes}>{label}</span>;
}

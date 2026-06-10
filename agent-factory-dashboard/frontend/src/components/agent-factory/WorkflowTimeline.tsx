import type { AgentFactoryAduView, AgentFactoryWorkflowStep } from '../../types/agent-factory';
import { Check, Loader2, AlertCircle, ChevronRight, Play } from 'lucide-react';

interface WorkflowTimelineProps {
  adu: AgentFactoryAduView | null;
}

export function WorkflowTimeline({ adu }: WorkflowTimelineProps): JSX.Element {
  if (!adu) {
    return (
      <div className="nms-card p-6 text-center text-sm text-nms-text-dim">
        请选择一个需求以显示其工作流进度管道。
      </div>
    );
  }

  const { workflow } = adu;

  // Group steps into 3 stages
  const group1States = ['created', 'analysis_review', 'analyzed'];
  const group2States = ['contexted', 'design_review', 'designed', 'contracted'];

  const stepsPhase1 = workflow.filter(s => group1States.includes(s.state));
  const stepsPhase2 = workflow.filter(s => group2States.includes(s.state));
  const stepsPhase3 = workflow.filter(s => !group1States.includes(s.state) && !group2States.includes(s.state));

  // Determine stage status
  const getPhaseStatus = (steps: AgentFactoryWorkflowStep[], prevPhaseComplete = true) => {
    if (steps.length === 0) return 'pending';
    
    const isComplete = steps.every(
      s => s.status === 'complete' || 
      (s.status === 'current' && (adu.state === 'evidenced' || adu.state === 'mvp_ready') && s.state === 'evidenced')
    );
    if (isComplete) return 'complete';

    const hasActive = steps.some(s => s.status === 'current' || s.status === 'failed' || s.status === 'blocked');
    if (hasActive) return 'active';

    if (prevPhaseComplete && steps.some(s => s.status === 'pending')) {
      return 'active';
    }

    return 'pending';
  };

  const phase1Status = getPhaseStatus(stepsPhase1, true);
  const phase2Status = getPhaseStatus(stepsPhase2, phase1Status === 'complete');
  const phase3Status = getPhaseStatus(stepsPhase3, phase1Status === 'complete' && phase2Status === 'complete');

  const phases = [
    {
      id: 1,
      title: '需求定义与审核',
      subtitle: '需求分析与人工审批关卡',
      steps: stepsPhase1,
      status: phase1Status,
      colorClass: 'cyan',
      badgeText: 'Phase 1',
    },
    {
      id: 2,
      title: '系统设计与契约',
      subtitle: '系统设计审查与测试契约签署',
      steps: stepsPhase2,
      status: phase2Status,
      colorClass: 'purple',
      badgeText: 'Phase 2',
    },
    {
      id: 3,
      title: '编码实现与验证',
      subtitle: '功能编码实现、编译调试与证据收集',
      steps: stepsPhase3,
      status: phase3Status,
      colorClass: 'indigo',
      badgeText: 'Phase 3',
    },
  ];

  return (
    <div className="nms-card bg-nms-surface-1 border-nms-surface-2 p-6 space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-nms-text">需求开发进度编排管道</h3>
        <p className="text-xs text-nms-text-dim mt-0.5">流式编排的主干-分支工作流状态</p>
      </div>

      <div className="relative pl-1 pr-1">
        {/* Backbone Timeline */}
        <div className="space-y-8 relative">
          {phases.map((phase, phaseIdx) => {
            const isLastPhase = phaseIdx === phases.length - 1;
            const isPhaseActive = phase.status === 'active';
            const isPhaseComplete = phase.status === 'complete';

            // Determine line color between phase nodes
            let lineColorClass = 'bg-nms-surface-2';
            if (isPhaseComplete) {
              lineColorClass = 'bg-emerald-500/30';
            } else if (isPhaseActive) {
              lineColorClass = 'bg-gradient-to-b from-nms-accent/30 to-nms-surface-2';
            }

            // Phase Big Circle Classes
            let circleClasses = 'w-9 h-9 rounded-xl flex items-center justify-center border font-bold text-sm transition-all duration-300 z-10 ';
            let pulseRing = null;

            if (isPhaseComplete) {
              circleClasses += 'bg-emerald-950/40 border-emerald-500/50 text-emerald-400';
            } else if (isPhaseActive) {
              if (phase.colorClass === 'cyan') {
                circleClasses += 'bg-cyan-950/40 border-cyan-500 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.15)]';
              } else if (phase.colorClass === 'purple') {
                circleClasses += 'bg-purple-950/40 border-purple-500 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.15)]';
              } else {
                circleClasses += 'bg-indigo-950/40 border-indigo-500 text-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.15)]';
              }
              pulseRing = (
                <span className="absolute inline-flex h-9 w-9 rounded-xl bg-current opacity-10 animate-ping z-0" />
              );
            } else {
              circleClasses += 'bg-nms-surface-2 border-nms-surface-3 text-nms-text-dim/30';
            }

            return (
              <div key={phase.id} className="flex gap-5 relative items-start">
                {/* Vertical Backbone Track Segment */}
                <div className="flex flex-col items-center flex-shrink-0 relative">
                  <div className="relative flex items-center justify-center">
                    {pulseRing}
                    <div className={circleClasses}>
                      {isPhaseComplete ? <Check className="w-5 h-5" /> : `0${phase.id}`}
                    </div>
                  </div>
                  {!isLastPhase && (
                    <div className={`w-0.5 absolute top-10 bottom-0 left-1/2 -translate-x-1/2 -mb-8 z-0 ${lineColorClass}`} />
                  )}
                </div>

                {/* Right side Branch content */}
                <div className="flex-1 min-w-0 space-y-3">
                  {/* Phase Header Info */}
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                      isPhaseComplete 
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                        : isPhaseActive 
                          ? 'bg-nms-accent/15 border-nms-accent/30 text-nms-accent' 
                          : 'bg-nms-surface-2 border-nms-surface-3 text-nms-text-dim/40'
                    }`}>
                      {phase.badgeText}
                    </span>
                    <h4 className={`text-xs font-bold ${isPhaseActive ? 'text-nms-text font-semibold' : 'text-nms-text-dim/80'}`}>
                      {phase.title}
                    </h4>
                    <span className="text-[10px] text-nms-text-dim/40 font-normal hidden sm:inline">
                      {phase.subtitle}
                    </span>
                  </div>

                  {/* Horizontal Branch Step Grid/Flex */}
                  <div className="flex flex-wrap items-center gap-2 py-0.5">
                    {phase.steps.map((step, idx) => {
                      const isStepCurrent = step.status === 'current';
                      const isStepComplete = step.status === 'complete' || 
                        (step.status === 'current' && (adu.state === 'evidenced' || adu.state === 'mvp_ready') && step.state === 'evidenced');
                      const isStepFailed = step.status === 'failed';
                      const isStepBlocked = step.status === 'blocked';

                      // Step card classes
                      let cardBorder = 'border-nms-surface-3/30';
                      let cardBg = 'bg-nms-surface-2/20';
                      let circleColor = 'bg-nms-surface-3/40 border-nms-surface-3/60 text-nms-text-dim/40';
                      let textColor = 'text-nms-text-dim/60';
                      let stepIcon = <span className="text-[9px] font-mono leading-none">{idx + 1}</span>;

                      if (isStepComplete) {
                        cardBorder = 'border-emerald-500/15';
                        cardBg = 'bg-emerald-500/5';
                        circleColor = 'bg-emerald-950/30 border-emerald-500/40 text-emerald-400';
                        textColor = 'text-emerald-400/80';
                        stepIcon = <Check className="w-3 h-3" />;
                      } else if (isStepCurrent) {
                        cardBorder = 'border-nms-accent/30 shadow-[0_0_8px_rgba(6,182,212,0.05)]';
                        cardBg = 'bg-nms-accent/5';
                        circleColor = 'bg-nms-accent/10 border-nms-accent/40 text-nms-accent';
                        textColor = 'text-nms-accent font-semibold';
                        stepIcon = adu.health.status === 'running'
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Play className="w-2.5 h-2.5 text-nms-accent fill-nms-accent/20" />;
                      } else if (isStepFailed) {
                        cardBorder = 'border-red-500/20';
                        cardBg = 'bg-red-500/5';
                        circleColor = 'bg-red-950/30 border-red-500/40 text-red-400';
                        textColor = 'text-red-400/90';
                        stepIcon = <AlertCircle className="w-3 h-3" />;
                      } else if (isStepBlocked) {
                        cardBorder = 'border-amber-500/20';
                        cardBg = 'bg-amber-500/5';
                        circleColor = 'bg-amber-950/30 border-amber-500/40 text-amber-400';
                        textColor = 'text-amber-400/90';
                        stepIcon = <AlertCircle className="w-3 h-3" />;
                      }

                      const hasNext = idx < phase.steps.length - 1;
                      const nextStep = hasNext ? phase.steps[idx + 1] : null;
                      const isNextStepComplete = nextStep ? (
                        nextStep.status === 'complete' ||
                        (nextStep.status === 'current' && (adu.state === 'evidenced' || adu.state === 'mvp_ready') && nextStep.state === 'evidenced')
                      ) : false;

                      return (
                        <div key={step.state} className="flex items-center gap-2 flex-shrink-0">
                          {/* Step capsule card */}
                          <div className={`flex items-center gap-2 border ${cardBorder} ${cardBg} pl-2 pr-2.5 py-1.5 rounded-lg min-w-[125px] transition-colors duration-200`}>
                            {/* status dot/icon */}
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center border text-[9px] font-semibold flex-shrink-0 ${circleColor}`}>
                              {stepIcon}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className={`text-[10px] font-medium truncate leading-normal ${textColor}`}>
                                {step.label}
                              </span>
                              {step.agent && (
                                <span className="text-[8px] text-nms-text-dim/40 font-mono leading-none mt-0.5">
                                  @{step.agent}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Connecting Chevron */}
                          {hasNext && (
                            <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 ${
                              isNextStepComplete 
                                ? 'text-emerald-500/40' 
                                : isStepComplete 
                                  ? 'text-nms-accent/40' 
                                  : 'text-nms-surface-3'
                            }`} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import { AgentFactoryRepository } from '../domain/agent-factory-repository';
import { AgentFactoryEpic, AgentFactoryEpicState, AgentFactoryEpicView, AgentFactoryAduView } from '../domain/agent-factory';
import fs from 'fs';
import path from 'path';

const EPIC_STATE_LABELS: Record<string, string> = {
  created: 'Created',
  flow_designed: 'Flow Designed',
  split_decision: 'Split Decision',
  single_adu_selected: 'Single ADU',
  split_required: 'Split Required',
  epic_planned: 'Epic Planned',
  child_adus_created: 'Children Created',
  child_adus_running: 'Children Running',
  child_adus_blocked: 'Children Blocked',
  child_adus_evidenced: 'Children Evidenced',
  epic_acceptance: 'Acceptance',
  epic_evidenced: 'Epic Evidenced',
  epic_failed: 'Epic Failed',
  human_gate: 'Human Gate',
  canceled: 'Canceled',
};

export class EpicMonitor {
  constructor(private readonly repo: AgentFactoryRepository) {}

  async getEpicDashboard(): Promise<{
    epics: AgentFactoryEpicView[];
    summary: {
      total_epics: number;
      active_epics: number;
      evidenced_epics: number;
      blocked_epics: number;
    };
  }> {
    const epics = await this.repo.readEpics();

    const epicViews: AgentFactoryEpicView[] = [];
    let activeCount = 0;
    let evidencedCount = 0;
    let blockedCount = 0;

    for (const epic of epics) {
      // Aggregate state from child ADUs
      const aggregatedState = await this.aggregateEpicState(epic);
      if (aggregatedState !== epic.state) {
        epic.state = aggregatedState as AgentFactoryEpicState;
        await this.repo.saveEpic(epic);
      }

      // Fetch child ADU views
      const childAduViews: AgentFactoryAduView[] = [];
      for (const childId of epic.child_adus) {
        try {
          const adu = await this.repo.getAduById(childId);
          if (adu) {
            childAduViews.push({
              ...adu,
              next_agent: null,
              latest_run: null,
              runs: [],
              workflow: [],
              artifact_status: [],
              health: { status: 'active', reasons: [] },
              display_status: {
                kind: (adu.state === 'evidenced' || adu.state === 'mvp_ready') ? 'completed' :
                      (adu.state === 'human_gate') ? 'blocked' : 'active',
                label: (adu.state === 'evidenced' || adu.state === 'mvp_ready') ? 'Completed' :
                       (adu.state === 'human_gate') ? 'Blocked' : 'Active',
                reason: `ADU is in state ${adu.state}`
              }
            });
          }
        } catch (_) { /* skip missing */ }
      }

      // Health
      let healthStatus: AgentFactoryEpicView['health']['status'] = 'active';
      const reasons: string[] = [];

      const state = epic.state;
      if (state === 'epic_evidenced') {
        healthStatus = 'healthy';
        reasons.push('All child ADUs evidenced and Epic acceptance passed.');
      } else if (state === 'epic_failed') {
        healthStatus = 'failed';
        reasons.push('Epic acceptance failed.');
      } else if (state === 'child_adus_blocked' || state === 'human_gate') {
        healthStatus = 'blocked';
        reasons.push('One or more child ADUs are blocked.');
      } else if (state === 'child_adus_running' || state === 'child_adus_created') {
        healthStatus = 'running';
        reasons.push('Child ADUs are executing.');
      } else if (state === 'canceled') {
        healthStatus = 'stale';
        reasons.push('Epic was canceled.');
      } else {
        healthStatus = 'active';
        reasons.push(`Epic is in state: ${EPIC_STATE_LABELS[state] || state}`);
      }

      // Calculate progress
      let currentPhase: 'flow' | 'split' | 'child_adus' | 'epic_acceptance' | 'completed' | 'failed' = 'flow';
      const completedPhases: string[] = [];
      let nextAction: string | null = null;

      const epicState = epic.state;
      if (epicState === 'created') {
        currentPhase = 'flow';
        nextAction = 'Run system-flow-designer';
      } else if (epicState === 'flow_designed' || epicState === 'split_decision' || epicState === 'single_adu_selected' || epicState === 'split_required') {
        currentPhase = 'split';
        completedPhases.push('flow');
        nextAction = epicState === 'split_required' ? 'Materialize child ADUs' : 'Run adu-splitter';
      } else if (epicState === 'child_adus_running' || epicState === 'child_adus_created' || epicState === 'child_adus_blocked') {
        currentPhase = 'child_adus';
        completedPhases.push('flow', 'split');
        nextAction = 'Continue child ADU DAG';
      } else if (epicState === 'child_adus_evidenced' || epicState === 'epic_acceptance') {
        currentPhase = 'epic_acceptance';
        completedPhases.push('flow', 'split', 'child_adus');
        nextAction = 'Run epic-acceptance-reviewer';
      } else if (epicState === 'epic_evidenced') {
        currentPhase = 'completed';
        completedPhases.push('flow', 'split', 'child_adus', 'epic_acceptance');
        nextAction = 'None';
      } else {
        currentPhase = 'failed';
        if (epicState === 'epic_failed') {
          completedPhases.push('flow', 'split', 'child_adus', 'epic_acceptance');
          nextAction = 'Review epic acceptance findings';
        } else {
          nextAction = 'None';
        }
      }

      const childSummary = {
        total: childAduViews.length,
        evidenced: childAduViews.filter(c => c.state === 'evidenced' || c.state === 'mvp_ready').length,
        blocked: childAduViews.filter(c => c.display_status?.kind === 'blocked').length,
        running: childAduViews.filter(c => c.display_status?.kind === 'running').length,
      };

      // Counters
      if (state === 'epic_evidenced') evidencedCount++;
      else if (state === 'child_adus_blocked' || state === 'human_gate') blockedCount++;
      else if (state !== 'canceled' && state !== 'epic_failed') activeCount++;

      epicViews.push({
        ...epic,
        child_adu_views: childAduViews,
        next_agent: this.nextEpicAgent(state),
        health: { status: healthStatus, reasons },
        progress: {
          current_phase: currentPhase,
          completed_phases: completedPhases,
          current_agent: this.nextEpicAgent(state),
          next_action: nextAction,
          child_summary: childSummary,
        },
      });
    }

    return {
      epics: epicViews,
      summary: {
        total_epics: epics.length,
        active_epics: activeCount,
        evidenced_epics: evidencedCount,
        blocked_epics: blockedCount,
      },
    };
  }

  async getEpic(epicId: string): Promise<AgentFactoryEpicView | null> {
    const dashboard = await this.getEpicDashboard();
    return dashboard.epics.find(e => e.id === epicId) || null;
  }

  private async aggregateEpicState(epic: AgentFactoryEpic): Promise<string> {
    if (!epic.child_adus || epic.child_adus.length === 0) {
      return epic.state;
    }

    // Don't override terminal Epic states
    const manualStates = ['epic_evidenced', 'epic_failed', 'canceled', 'created', 'flow_designed',
                          'split_decision', 'single_adu_selected', 'split_required',
                          'epic_planned', 'epic_acceptance'];
    if (manualStates.includes(epic.state)) {
      return epic.state;
    }

    const childIds = epic.child_adus;
    let evidencedCount = 0;
    let blockedCount = 0;
    let runningCount = 0;
    let createdCount = 0;
    let anyProgress = false;
    const terminalStates = new Set(['evidenced', 'canceled']);

    for (const childId of childIds) {
      try {
        const adu = await this.repo.getAduById(childId);
        if (!adu) continue;

        const isEvidenced = adu.state === 'evidenced' || adu.state === 'mvp_ready';
        let isWaived = false;
        try {
          const waiversFile = path.join(this.repo.getWorkspaceRoot(), '.ai-agent', 'registry', 'evidence-waivers.json');
          if (fs.existsSync(waiversFile)) {
            const content = fs.readFileSync(waiversFile, 'utf-8');
            const waivers = JSON.parse(content).waivers || [];
            isWaived = waivers.some((w: any) => w.adu_id === childId);
          }
        } catch (_) {}

        if (isEvidenced || isWaived) {
          evidencedCount++;
        } else if (adu.state === 'human_gate') {
          blockedCount++;
        } else if (adu.state === 'created') {
          createdCount++;
          if ((adu.retry_count && adu.retry_count > 0) || (adu.artifacts && adu.artifacts.length > 0)) {
            anyProgress = true;
          }
        } else if (!terminalStates.has(adu.state)) {
          runningCount++;
          anyProgress = true;
        }
      } catch (_) { /* skip missing */ }
    }

    // Update summary: created (unstarted) children are NOT running
    epic.summary = {
      total_child_adus: childIds.length,
      evidenced_child_adus: evidencedCount,
      blocked_child_adus: blockedCount,
      running_child_adus: runningCount,
    };

    if (evidencedCount === childIds.length) return 'child_adus_evidenced';
    if (blockedCount > 0) return 'child_adus_blocked';

    const allCreated = (createdCount === (childIds.length - evidencedCount - blockedCount));
    if (allCreated && !anyProgress) {
      return 'child_adus_created';
    }

    if (runningCount > 0 || evidencedCount < childIds.length) return 'child_adus_running';

    return epic.state;
  }

  private nextEpicAgent(state: string): string | null {
    const mapping: Record<string, string | null> = {
      created: 'system-flow-designer',
      flow_designed: 'adu-splitter',
      split_required: null, // materialize step
      child_adus_created: null, // schedule children
      child_adus_running: null, // schedule children
      child_adus_evidenced: 'epic-acceptance-reviewer',
      epic_evidenced: null,
      epic_failed: null,
      human_gate: null,
      canceled: null,
    };
    return mapping[state] ?? null;
  }
}

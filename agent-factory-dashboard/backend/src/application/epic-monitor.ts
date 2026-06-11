import { AgentFactoryRepository } from '../domain/agent-factory-repository';
import { AgentFactoryEpic, AgentFactoryEpicState, AgentFactoryEpicView, AgentFactoryAduView } from '../domain/agent-factory';

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

      // Counters
      if (state === 'epic_evidenced') evidencedCount++;
      else if (state === 'child_adus_blocked' || state === 'human_gate') blockedCount++;
      else if (state !== 'canceled' && state !== 'epic_failed') activeCount++;

      epicViews.push({
        ...epic,
        child_adu_views: childAduViews,
        next_agent: this.nextEpicAgent(state),
        health: { status: healthStatus, reasons },
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
    const terminalStates = new Set(['evidenced', 'canceled']);

    for (const childId of childIds) {
      try {
        const adu = await this.repo.getAduById(childId);
        if (!adu) continue;
        if (adu.state === 'evidenced') evidencedCount++;
        else if (adu.state === 'human_gate') blockedCount++;
        else if (!terminalStates.has(adu.state)) runningCount++;
      } catch (_) { /* skip missing */ }
    }

    // Update summary
    epic.summary = {
      total_child_adus: childIds.length,
      evidenced_child_adus: evidencedCount,
      blocked_child_adus: blockedCount,
      running_child_adus: runningCount,
    };

    if (evidencedCount === childIds.length) return 'child_adus_evidenced';
    if (blockedCount > 0) return 'child_adus_blocked';
    if (runningCount > 0) return 'child_adus_running';

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

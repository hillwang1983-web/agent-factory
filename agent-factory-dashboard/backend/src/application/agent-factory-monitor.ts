import { AgentFactoryRepository } from '../domain/agent-factory-repository';
import {
  AgentFactoryDashboard,
  AgentFactoryAdu,
  AgentFactoryAduView,
  AgentFactoryAgentConfig,
  AgentFactoryAgentView,
  AgentFactoryRun,
  AgentFactoryWorkflowStep,
} from '../domain/agent-factory';

const WORKFLOW_STEPS_CONFIG = [
  { state: 'created', label: 'Created', agent: 'requirement-analyst' },
  { state: 'analysis_review', label: 'Analysis Review', agent: null },
  { state: 'analyzed', label: 'Analysis Approved', agent: 'context-pack' },
  { state: 'contexted', label: 'Contexted', agent: 'detail-designer' },
  { state: 'design_review', label: 'Design Review', agent: null },
  { state: 'designed', label: 'Design Approved', agent: 'contract' },
  { state: 'contracted', label: 'Contracted', agent: 'testwriter' },
  { state: 'test_red', label: 'Test Red', agent: 'developer' },
  { state: 'implemented', label: 'Implemented', agent: 'code-reviewer' },
  { state: 'code_reviewed', label: 'Code Reviewed', agent: 'buildfix-debugger' },
  { state: 'debugged', label: 'Debugged', agent: 'acceptance-reviewer' },
  { state: 'acceptance_reviewed', label: 'Acceptance Approved', agent: 'evidence' },
  { state: 'evidenced', label: 'Evidence', agent: null },
];

const STATE_ORDER = [
  'created',
  'analysis_review',
  'analyzed',
  'contexted',
  'design_review',
  'designed',
  'contracted',
  'test_red',
  'implemented',
  'code_reviewed',
  'debugged',
  'acceptance_reviewed',
  'evidenced',
  'mvp_ready',
];

export const NEXT_AGENT_BY_STATE: Record<string, string | null> = {
  created: 'requirement-analyst',
  analysis_review: null,
  analyzed: 'context-pack',
  contexted: 'detail-designer',
  design_review: null,
  designed: 'contract',
  contracted: 'testwriter',
  test_red: 'developer',
  code_rework: 'rework-planner',
  build_rework: 'rework-planner',
  acceptance_rework: 'rework-planner',
  implemented: 'code-reviewer',
  code_reviewed: 'buildfix-debugger',
  debugged: 'acceptance-reviewer',
  acceptance_reviewed: 'evidence',
  evidenced: null,
  mvp_ready: null,
  human_gate: null,
};

export class AgentFactoryMonitorUseCase {
  constructor(public readonly repo: AgentFactoryRepository) {}

  private parseTimestamp(ts: string): Date | null {
    const m = ts.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
    if (!m) return null;
    return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  }

  async getDashboard(activeOrchestrators?: Set<string>): Promise<AgentFactoryDashboard> {
    let adusRaw: AgentFactoryAdu[] = [];
    let agentsRaw: Record<string, AgentFactoryAgentConfig> = {};
    let runsRaw: AgentFactoryRun[] = [];
    let registryValid = true;

    try {
      const [adus, agents, runs] = await Promise.all([
        this.repo.readAdus(),
        this.repo.readAgents(),
        this.repo.readRuns(),
      ]);
      adusRaw = adus;
      agentsRaw = agents;
      runsRaw = runs;
    } catch (err) {
      registryValid = false;
    }

    const runs = runsRaw || [];
    const adus = adusRaw || [];
    const agents = agentsRaw || {};

    // Map ADUs to views
    const aduViews: AgentFactoryAduView[] = [];
    let totalMissingArtifacts = 0;

    for (const adu of adus) {
      const hasBlockingQuestions = adu.clarification_questions?.some(
        (q: any) => q.blocking && q.status === 'pending'
      );
      if (hasBlockingQuestions && adu.state !== 'created' && adu.state !== 'analysis_review') {
        adu.state = 'analysis_review';
      }

      const aduRuns = runs.filter((r) => r.adu_id === adu.id);
      const sortedAduRuns = [...aduRuns].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const latestRun = sortedAduRuns[0] || null;


      // Fetch artifact statuses
      const artifactsList = adu.artifacts && adu.artifacts.length > 0 ? adu.artifacts : (
        adu.project_id ? [
          `.ai-agent/analysis/${adu.id}.md`,
          `.ai-agent/designs/${adu.id}-detailed-design.md`,
          `.ai-agent/contracts/${adu.id}.json`,
          `.ai-agent/reviews/${adu.id}-code-review.json`,
          `.ai-agent/acceptance/${adu.id}-acceptance-review.json`,
          `.ai-agent/evidence/${adu.id}.md`
        ] : []
      );
      // Use project repo path for artifact resolution if it's a project ADU
      const artifactStatus = await this.repo.listArtifacts(artifactsList, adu.repo_path);
      const missingCount = artifactStatus.filter((a) => !a.exists).length;
      totalMissingArtifacts += missingCount;
      const isTerminal = adu.state === 'evidenced' || adu.state === 'mvp_ready';

      // Workflow Timeline
      const workflow: AgentFactoryWorkflowStep[] = WORKFLOW_STEPS_CONFIG.map((step) => {
        const stepOrderIndex = STATE_ORDER.indexOf(step.state);
        const orderState = adu.state === 'code_rework' || adu.state === 'acceptance_rework'
          ? 'test_red'
          : adu.state === 'build_rework'
            ? 'code_reviewed'
            : adu.state;
        const aduOrderIndex = STATE_ORDER.indexOf(orderState);

        let status: AgentFactoryWorkflowStep['status'] = 'pending';
        let run_timestamp: string | undefined;
        let result: string | undefined;

        // Find latest run for this step's agent
        const stepRun = step.agent ? sortedAduRuns.find((r) => r.agent === step.agent) : null;
        if (stepRun) {
          run_timestamp = stepRun.timestamp;
          result = stepRun.result;
        }

        if (isTerminal && (step.state === 'evidenced' || stepOrderIndex <= aduOrderIndex)) {
          status = 'complete';
        } else if (adu.state === 'human_gate') {
          const failedAgent = latestRun?.agent;
          const failedStep = failedAgent
            ? WORKFLOW_STEPS_CONFIG.find((s) => s.agent === failedAgent)
            : null;
          const failedStepOrderIndex = failedStep ? STATE_ORDER.indexOf(failedStep.state) : 0;

          if (failedStep) {
            if (step.agent && step.agent === failedAgent) {
              status = latestRun?.result === 'failed' ? 'failed' : 'blocked';
            } else if (stepOrderIndex < failedStepOrderIndex) {
              status = 'complete';
            } else {
              status = 'pending';
            }
          } else {
            status = 'pending';
          }
        } else if (adu.state === 'code_rework' && step.state === 'test_red') {
          status = 'failed';
        } else if (adu.state === 'build_rework' && step.state === 'code_reviewed') {
          status = 'failed';
        } else if (adu.state === 'acceptance_rework' && step.state === 'test_red') {
          status = 'failed';
        } else if (aduOrderIndex > stepOrderIndex) {
          status = 'complete';
        } else if (adu.state === step.state) {
          status = 'current';
        } else if (orderState === step.state) {
          status = 'current';
        }

        return {
          state: step.state,
          label: step.label,
          status,
          agent: step.agent,
          run_timestamp,
          result,
        };
      });

      // Only show the HumanGate workflow step when the ADU is genuinely blocked.
      // A terminal ADU (evidenced/mvp_ready) may still carry a stale
      // human_gate_required flag from an earlier failure run — ignore it there.
      if (adu.state === 'human_gate') {
        workflow.push({
          state: 'human_gate',
          label: 'Human Gate',
          status: 'blocked',
          agent: latestRun ? latestRun.agent : null,
          run_timestamp: latestRun?.timestamp,
          result: latestRun?.result || 'blocked',
        });
      }

      // Health Calculation
      let healthStatus: AgentFactoryAduView['health']['status'] = 'active';
      const reasons: string[] = [];

      if (activeOrchestrators && activeOrchestrators.has(adu.id)) {
        healthStatus = 'running';
        reasons.push('ADU is currently running/executing in the Agent factory.');
      } else if (isTerminal) {
        // Terminal check comes first: a stale human_gate_required flag must not
        // override a successfully completed ADU.
        healthStatus = 'healthy';
        reasons.push('All factory steps completed successfully. Evidence package created.');
      } else if (adu.state === 'human_gate') {
        healthStatus = 'blocked';
        reasons.push('Human gate triggered. Blocked due to execution failure or compliance rule.');
      } else if (
        latestRun &&
        (latestRun.result === 'failed' || latestRun.result === 'unstructured')
      ) {
        healthStatus = 'failed';
        reasons.push(
          `Latest execution run (${latestRun.agent}) failed or returned unstructured output.`,
        );
      } else {
        // Active or Stale
        if (latestRun) {
          const runDate = this.parseTimestamp(latestRun.timestamp);
          if (runDate) {
            const ageMs = Date.now() - runDate.getTime();
            if (ageMs > 30 * 60 * 1000) {
              healthStatus = 'stale';
              reasons.push('ADU is in progress but has not seen run activity for over 30 minutes.');
            } else {
              healthStatus = 'active';
              reasons.push('ADU is actively progressing through the Agent factory.');
            }
          }
        } else {
          healthStatus = 'active';
          reasons.push('ADU created. Waiting for first Agent pipeline execution.');
        }
      }

      aduViews.push({
        ...adu,
        next_agent: NEXT_AGENT_BY_STATE[adu.state] || null,
        latest_run: latestRun,
        runs: aduRuns,
        workflow,
        artifact_status: artifactStatus,
        health: {
          status: healthStatus,
          reasons,
        },
        display_status: this.computeAduDisplayStatus(adu, latestRun, activeOrchestrators),
      });
    }

    // Map Agents to views
    const agentViews: AgentFactoryAgentView[] = [];
    const agentKeys = Object.keys(agents);

    for (const key of agentKeys) {
      const config = agents[key];
      const agentRuns = runs.filter((r) => r.agent === key);
      const sortedAgentRuns = [...agentRuns].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const latestRun = sortedAgentRuns[0] || null;

      const total_runs = agentRuns.length;
      const success_runs = agentRuns.filter((r) => r.result === 'success').length;
      const failed_runs = agentRuns.filter(
        (r) => r.result === 'failed' || r.returncode !== 0,
      ).length;
      const unstructured_runs = agentRuns.filter((r) => r.result === 'unstructured').length;

      // Find active ADUs for this agent
      const active_adu_ids = aduViews
        .filter((av) => av.next_agent === key && av.health.status !== 'blocked')
        .map((av) => av.id);

      // Status Calculation
      let agentStatus: AgentFactoryAgentView['status'] = 'idle';
      if (active_adu_ids.length > 0) {
        if (latestRun) {
          const runDate = this.parseTimestamp(latestRun.timestamp);
          if (runDate && Date.now() - runDate.getTime() > 30 * 60 * 1000) {
            agentStatus = 'stale';
          } else {
            agentStatus = 'active';
          }
        } else {
          agentStatus = 'active';
        }
      } else if (latestRun && (latestRun.result === 'failed' || latestRun.returncode !== 0)) {
        agentStatus = 'failed';
      }

      agentViews.push({
        id: key,
        description: config.description,
        prompt: config.prompt,
        worktree: config.worktree,
        hermes_args: config.hermes_args,
        total_runs,
        success_runs,
        failed_runs,
        unstructured_runs,
        latest_run: latestRun,
        active_adu_ids,
        status: agentStatus,

        runtime_status: 'idle',
        current_operations: [],
        queued_targets: [],
        attention_items: [],
        last_result: latestRun ? {
          run_timestamp: latestRun.timestamp,
          target_id: latestRun.adu_id,
          result: latestRun.result,
          effective_returncode: latestRun.effective_returncode ?? latestRun.returncode,
          finished_at: latestRun.timestamp
        } : null,
        last_run_at: latestRun ? latestRun.timestamp : null,
        success_rate: total_runs > 0 ? Math.round((success_runs / total_runs) * 100) : null,
        stale_warning: { stale: false, reason: null, last_heartbeat_at: null, stale_after_seconds: 60 }
      });
    }

    // Recent runs
    const recentRuns = [...runs]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 50);

    // Summary calculations
    const total_adus = adus.length;
    const active_adus = aduViews.filter(
      (av) => av.health.status === 'active' || av.health.status === 'stale',
    ).length;
    const evidenced_adus = aduViews.filter(
      (av) => av.state === 'evidenced' || av.state === 'mvp_ready',
    ).length;
    const human_gate_adus = aduViews.filter(
      (av) => av.health.status === 'blocked',
    ).length;

    const total_runs = runs.length;
    const success_runs = runs.filter((r) => r.result === 'success').length;
    const failed_runs = runs.filter((r) => r.result === 'failed' || r.returncode !== 0).length;
    const unstructured_runs = runs.filter((r) => r.result === 'unstructured').length;

    return {
      generated_at: new Date().toISOString(),
      workspace: this.repo.getWorkspaceRoot(),
      registry_valid: registryValid,
      summary: {
        total_adus,
        active_adus,
        evidenced_adus,
        human_gate_adus,
        total_runs,
        success_runs,
        failed_runs,
        unstructured_runs,
        missing_artifacts: totalMissingArtifacts,
      },
      adus: aduViews,
      agents: agentViews,
      recent_runs: recentRuns,
    };
  }

  async getAdu(aduId: string, activeOrchestrators?: Set<string>): Promise<AgentFactoryAduView | null> {
    const dashboard = await this.getDashboard(activeOrchestrators);
    return dashboard.adus.find((av) => av.id === aduId) || null;
  }

  async getRuns(filter?: {
    aduId?: string;
    agent?: string;
    limit?: number;
  }): Promise<AgentFactoryRun[]> {
    const dashboard = await this.getDashboard();
    let results = dashboard.recent_runs;

    if (filter?.aduId) {
      results = results.filter((r) => r.adu_id === filter.aduId);
    }
    if (filter?.agent) {
      results = results.filter((r) => r.agent === filter.agent);
    }
    if (filter?.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async getAllRuns(filter?: {
    aduId?: string;
    agent?: string;
  }): Promise<AgentFactoryRun[]> {
    const runs = await this.repo.readRuns();
    let results = runs;

    if (filter?.aduId) {
      results = results.filter((r) => r.adu_id === filter.aduId);
    }
    if (filter?.agent) {
      results = results.filter((r) => r.agent === filter.agent);
    }

    return results;
  }

  async getArtifact(
    relativePath: string,
    maxBytes?: number,
  ): Promise<{ path: string; content: string; truncated: boolean }> {
    return this.repo.readTextArtifact(relativePath, maxBytes || 100000);
  }

  async updateAduLanguage(aduId: string, language: string): Promise<void> {
    await this.repo.updateAdus((adus) => {
      const adu = adus.find((a) => a.id === aduId);
      if (!adu) {
        throw new Error(`ADU ${aduId} not found`);
      }
      adu.language = language;
      return adus;
    });
  }

  async appendAduPaths(
    aduId: string,
    addWritePaths: string[],
    addReadPaths: string[],
  ): Promise<{ allowed_write_paths: string[]; allowed_read_paths: string[] }> {
    const BLOCKED_PREFIXES = [
      '.git/', '.agent-factory/', '~/', '/Users/', '/home/', '/etc/', '/tmp/', '/var/',
    ];

    const validate = (p: string, field: string): string => {
      const v = p.trim().replace(/\\/g, '/');
      if (!v) throw new Error(`${field}: path must not be empty`);
      if (v.startsWith('/')) throw new Error(`${field}: absolute path not allowed — got "${p}"`);
      if (v.includes('..')) throw new Error(`${field}: ".." not allowed — got "${p}"`);
      if (v.includes('\0')) throw new Error(`${field}: NUL bytes not allowed`);
      for (const prefix of BLOCKED_PREFIXES) {
        if (v.startsWith(prefix) || v === prefix.replace(/\/$/, ''))
          throw new Error(`${field}: blocked path "${p}"`);
      }
      return v;
    };

    const validatedWrite = addWritePaths.map((p) => validate(p, 'allowed_write_paths'));
    const validatedRead = addReadPaths.map((p) => validate(p, 'allowed_read_paths'));

    let resultPaths: { allowed_write_paths: string[]; allowed_read_paths: string[] } = { allowed_write_paths: [], allowed_read_paths: [] };
    await this.repo.updateAdus((adus) => {
      const adu = adus.find((a) => a.id === aduId);
      if (!adu) throw new Error(`ADU ${aduId} not found`);

      const TERMINAL = ['evidenced', 'canceled'];
      if (TERMINAL.includes(adu.state)) {
        throw Object.assign(new Error(`Cannot modify paths on a ${adu.state} ADU`), { forbidden: true });
      }

      adu.allowed_write_paths = adu.allowed_write_paths ?? [];
      adu.allowed_read_paths = adu.allowed_read_paths ?? [];

      for (const p of validatedWrite) {
        if (!adu.allowed_write_paths.includes(p)) adu.allowed_write_paths.push(p);
      }
      for (const p of validatedRead) {
        if (!adu.allowed_read_paths.includes(p)) adu.allowed_read_paths.push(p);
      }

      resultPaths = { allowed_write_paths: adu.allowed_write_paths, allowed_read_paths: adu.allowed_read_paths };
      return adus;
    });
    return resultPaths;
  }

  async pauseAdu(aduId: string): Promise<void> {
    await this.repo.updateAdus((adus) => {
      const adu = adus.find((a) => a.id === aduId);
      if (!adu) throw Object.assign(new Error(`ADU ${aduId} not found`), { notFound: true });
      if (['evidenced', 'canceled'].includes(adu.state)) {
        throw Object.assign(new Error(`Cannot pause a ${adu.state} ADU`), { forbidden: true });
      }
      (adu as any).paused = true;
      return adus;
    });
  }

  async cancelAdu(aduId: string): Promise<void> {
    await this.repo.updateAdus((adus) => {
      const adu = adus.find((a) => a.id === aduId);
      if (!adu) throw Object.assign(new Error(`ADU ${aduId} not found`), { notFound: true });
      if (adu.state === 'canceled') return adus;
      adu.state = 'canceled';
      (adu as any).paused = false;
      return adus;
    });
  }

  async waiveHumanGate(
    aduId: string,
    params: { reasonType: 'environment'; comment: string },
  ): Promise<{ state: string; waiver: Record<string, unknown> }> {
    const comment = params.comment.trim();
    if (!comment) {
      throw new Error('waiver comment is required');
    }

    let result: { state: string; waiver: Record<string, unknown> } | null = null;
    await this.repo.updateAdus((adus) => {
      const adu = adus.find((a) => a.id === aduId);
      if (!adu) throw Object.assign(new Error(`ADU ${aduId} not found`), { notFound: true });
      if (adu.state !== 'human_gate') {
        throw Object.assign(new Error(`ADU state must be human_gate to waive`), { forbidden: true });
      }

      const preGateState = (adu as any).pre_gate_state;
      let nextState: string;
      if (params.reasonType === 'environment' && preGateState === 'code_reviewed') {
        nextState = 'debugged';
      } else {
        throw Object.assign(
          new Error(`Unsupported waiver transition: reasonType=${params.reasonType}, pre_gate_state=${preGateState || 'none'}`),
          { forbidden: true },
        );
      }

      const waiver = {
        waiver_id: `waiver-${aduId}-${Date.now()}`,
        type: params.reasonType,
        from_state: adu.state,
        pre_gate_state: preGateState,
        to_state: nextState,
        comment,
        created_at: new Date().toISOString(),
        approved_by: 'local-user',
      };

      (adu as any).human_gate_waivers = [
        ...(((adu as any).human_gate_waivers as unknown[]) || []),
        waiver,
      ];
      adu.state = nextState;
      adu.human_gate_required = false;
      adu.retry_count = 0;
      delete (adu as any).pre_gate_state;
      if (adu.review_counters) {
        adu.review_counters.buildfix_failures = 0;
      }
      adu.updated_at = new Date().toISOString();

      result = { state: nextState, waiver };
      return adus;
    });

    if (!result) throw new Error('Failed to waive human gate');
    return result;
  }

  async disposeHumanGate(
    aduId: string,
    params: {
      disposition: 'environment_waiver' | 'accept_risk' | 'request_rework' | 'provide_missing_evidence' | 'external_dependency_block' | 'cancel_adu';
      comment: string;
      affectedAssertions?: string[];
    },
  ): Promise<{ state: string; disposition: Record<string, unknown> }> {
    const comment = params.comment.trim();
    if (!comment) {
      throw new Error('disposition comment is required');
    }

    let result: { state: string; disposition: Record<string, unknown> } | null = null;
    await this.repo.updateAdus((adus) => {
      const adu = adus.find((a) => a.id === aduId);
      if (!adu) throw Object.assign(new Error(`ADU ${aduId} not found`), { notFound: true });
      if (adu.state !== 'human_gate') {
        throw Object.assign(new Error(`ADU state must be human_gate to dispose`), { forbidden: true });
      }

      const preGateState = (adu as any).pre_gate_state;
      let nextState: string;

      if (params.disposition === 'environment_waiver') {
        if (preGateState === 'code_reviewed') {
          nextState = 'debugged';
        } else if (preGateState === 'debugged') {
          nextState = 'acceptance_reviewed';
        } else {
          throw Object.assign(
            new Error(`Unsupported environment waiver from pre_gate_state: ${preGateState || 'none'}`),
            { forbidden: true },
          );
        }
      } else if (params.disposition === 'request_rework') {
        nextState = 'rework_planned';
      } else if (params.disposition === 'provide_missing_evidence' || params.disposition === 'accept_risk') {
        nextState = preGateState || 'created';
      } else if (params.disposition === 'external_dependency_block') {
        nextState = 'human_gate';
      } else if (params.disposition === 'cancel_adu') {
        nextState = 'canceled';
      } else {
        throw Object.assign(new Error(`Unknown disposition: ${params.disposition}`), { forbidden: true });
      }

      const disposition = {
        disposition_id: `disp-${aduId}-${Date.now()}`,
        type: params.disposition,
        from_state: adu.state,
        pre_gate_state: preGateState,
        to_state: nextState,
        comment,
        created_at: new Date().toISOString(),
        approved_by: 'local-user',
        affected_assertions: params.affectedAssertions || [],
      };

      (adu as any).human_gate_dispositions = [
        ...(((adu as any).human_gate_dispositions as unknown[]) || []),
        disposition,
      ];
      // Keep waivers array populated for backward-compatibility
      (adu as any).human_gate_waivers = [
        ...(((adu as any).human_gate_waivers as unknown[]) || []),
        disposition,
      ];

      adu.state = nextState as any;
      if (nextState !== 'human_gate') {
        adu.human_gate_required = false;
        adu.retry_count = 0;
        delete (adu as any).pre_gate_state;
        if (adu.review_counters) {
          adu.review_counters.buildfix_failures = 0;
        }
      }

      adu.updated_at = new Date().toISOString();

      result = { state: nextState, disposition };
      return adus;
    });

    if (!result) throw new Error('Failed to dispose human gate');
    return result;
  }

  private computeAduDisplayStatus(
    adu: AgentFactoryAdu,
    latestRun: AgentFactoryRun | null,
    activeOrchestrators?: Set<string>
  ): {
    kind: 'completed' | 'running' | 'blocked' | 'failed' | 'active' | 'stale' | 'canceled';
    label: string;
    reason: string;
  } {
    if (adu.state === 'evidenced' || adu.state === 'mvp_ready') {
      return {
        kind: 'completed',
        label: 'Completed',
        reason: 'ADU has completed evidence generation.',
      };
    }
    if (adu.state === 'canceled') {
      return {
        kind: 'canceled',
        label: 'Canceled',
        reason: 'ADU was canceled.',
      };
    }
    if (activeOrchestrators?.has(adu.id)) {
      return {
        kind: 'running',
        label: 'Running',
        reason: 'An orchestrator is currently active.',
      };
    }
    if (adu.state === 'human_gate') {
      return {
        kind: 'blocked',
        label: 'Blocked',
        reason: 'ADU is waiting for human gate disposition.',
      };
    }
    if (latestRun && (latestRun.result === 'failed' || latestRun.result === 'unstructured' || latestRun.returncode !== 0)) {
      return {
        kind: 'failed',
        label: latestRun.result === 'unstructured' ? 'Invalid Output' : 'Failed',
        reason: `Latest run ${latestRun.agent} ended with ${latestRun.result || 'failed'} (code ${latestRun.effective_returncode ?? latestRun.returncode}).`,
      };
    }
    return {
      kind: 'active',
      label: 'Active',
      reason: `ADU is in state ${adu.state}.`,
    };
  }
}

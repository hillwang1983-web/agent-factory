import {
  AgentFactoryAgentView,
  AgentRuntimeStatus,
  AgentFactoryAgentOperationRef,
  AgentFactoryAgentQueuedTarget,
  AgentFactoryAgentAttentionItem,
  AgentFactoryAgentLastResult,
  AgentFactoryRun,
  AgentFactoryAduView,
} from '../domain/agent-factory';
import { OrchestrationOperation } from '../domain/orchestration-operation';
import { HumanGate } from '../domain/human-gate';

export interface DeriveAgentRuntimeViewParams {
  agent: AgentFactoryAgentView;
  runs: AgentFactoryRun[];
  aduViews: AgentFactoryAduView[];
  epicViews?: any[];
  operations: OrchestrationOperation[];
  humanGates: HumanGate[];
  qualityDecisions?: any[];
  reworkChains?: any[];
  now: number;
  staleAfterSeconds: number;
}

export function deriveAgentRuntimeView(params: DeriveAgentRuntimeViewParams): AgentFactoryAgentView {
  const { agent, runs, aduViews, operations, humanGates, now, staleAfterSeconds } = params;

  // 1. Current Operations
  const current_operations: AgentFactoryAgentOperationRef[] = operations
    .filter(op => (op.status === 'spawning' || op.status === 'running') && op.current_agent === agent.id)
    .map(op => ({
      operation_id: op.operation_id,
      target_type: (op.scope === 'epic' ? 'epic' : 'adu') as 'adu' | 'epic',
      target_id: op.target_id,
      status: op.status as 'spawning' | 'running',
      current_state: op.current_state || null,
      started_at: op.started_at || op.created_at || null,
      updated_at: op.last_progress_at || op.created_at || null,
      elapsed_seconds: op.started_at ? Math.floor((now - new Date(op.started_at).getTime()) / 1000) : null
    }));

  const isRunning = current_operations.length > 0;

  // 2. Queued Targets (Ready)
  const queued_targets: AgentFactoryAgentQueuedTarget[] = aduViews
    .filter(adu => 
      adu.next_agent === agent.id && 
      adu.state !== 'mvp_ready' && 
      adu.state !== 'human_gate' && 
      !operations.some(op => op.target_id === adu.id && ['spawning', 'running'].includes(op.status))
    )
    .map(adu => ({
      target_type: 'adu',
      target_id: adu.id,
      title: adu.title,
      state: adu.state,
      queued_since: adu.updated_at || null
    }));

  if (params.epicViews) {
    queued_targets.push(...params.epicViews
      .filter(epic => 
        epic.next_agent === agent.id &&
        epic.state !== 'epic_acceptance' &&
        epic.state !== 'epic_evidenced' &&
        epic.state !== 'epic_failed' &&
        epic.state !== 'human_gate' &&
        epic.state !== 'canceled' &&
        !operations.some(op => op.target_id === epic.id && ['spawning', 'running'].includes(op.status))
      )
      .map(epic => ({
        target_type: 'epic' as 'epic',
        target_id: epic.id,
        title: epic.title,
        state: epic.state,
        queued_since: epic.updated_at || null
      }))
    );
  }

  const isReady = queued_targets.length > 0;

  // 3. Attention Items (Needs Attention)
  const attention_items: AgentFactoryAgentAttentionItem[] = [];
  
  // 3.1 Human Gates
  humanGates.filter(hg => hg.status === 'pending' && hg.source_agent === agent.id).forEach(hg => {
    attention_items.push({
      id: hg.gate_id,
      target_type: (hg.scope === 'epic' ? 'epic' : 'adu') as 'adu' | 'epic',
      target_id: hg.target_id,
      kind: 'human_gate',
      severity: 'P1',
      summary: hg.title,
      recommended_action: hg.reason,
      created_at: hg.created_at
    });
  });

  // 3.2 Run Failed
  aduViews.forEach(adu => {
    if (adu.latest_run?.agent === agent.id) {
       const res = adu.latest_run.result;
       if (res !== 'success' && res !== 'human_gate' && adu.state !== 'mvp_ready') {
          attention_items.push({
            id: `run_failed_${adu.id}`,
            target_type: 'adu',
            target_id: adu.id,
            kind: 'run_failed',
            severity: 'P2',
            summary: `Run failed with return code ${adu.latest_run.returncode}`,
            recommended_action: 'Check logs or override',
            created_at: adu.latest_run.timestamp
          });
       }
    }
  });

  // 3.3 Quality Decisions (Reviews that require rework or are pending on this agent)
  if (params.qualityDecisions) {
    params.qualityDecisions.forEach((qd: any) => {
      let responsibleAgent = null;
      if (qd.state === 'analysis_review') {
        responsibleAgent = 'requirement-analyst';
      } else if (qd.state === 'design_review') {
        const isEpic = params.epicViews?.some((e: any) => e.id === qd.adu_id);
        responsibleAgent = isEpic ? 'system-flow-designer' : 'detail-designer';
      }

      if ((qd.status === 'rework_requested' || qd.status === 'pending') && responsibleAgent === agent.id) {
        attention_items.push({
          id: `quality_${qd.review_id}`,
          target_type: 'adu',
          target_id: qd.adu_id,
          kind: 'quality_decision',
          severity: 'P1',
          summary: `Quality review ${qd.status}`,
          recommended_action: 'Resolve feedback or wait for manual intervention',
          created_at: qd.updated_at || qd.created_at || new Date(now).toISOString()
        });
      }
    });
  }

  // 3.4 Rework Chains
  if (params.reworkChains) {
    params.reworkChains.forEach((rc: any) => {
      if (rc.agent === agent.id) {
        attention_items.push({
          id: `rework_${rc.id}`,
          target_type: 'adu',
          target_id: rc.target_id,
          kind: 'rework_required',
          severity: 'P1',
          summary: `Rework chain active`,
          recommended_action: 'Monitor rework progression',
          created_at: rc.created_at || new Date(now).toISOString()
        });
      }
    });
  }

  // 3.5 Failed Operations
  operations.filter(op => op.status === 'failed' && op.current_agent === agent.id).forEach(op => {
    // A failed operation only needs attention if it's the LATEST operation for this target AND the target is not terminal.
    const opsForTarget = operations
      .filter(o => o.target_id === op.target_id)
      .sort((a, b) => new Date(b.created_at || b.last_progress_at || 0).getTime() - new Date(a.created_at || a.last_progress_at || 0).getTime());
    
    const latestOpForTarget = opsForTarget[0];
    
    // Check if target is terminal
    const adu = aduViews.find(a => a.id === op.target_id);
    const epic = params.epicViews?.find((e: any) => e.id === op.target_id);
    const isTerminal = (adu && ['mvp_ready', 'evidenced', 'canceled'].includes(adu.state)) || (epic && ['epic_evidenced', 'canceled'].includes(epic.state));

    if (latestOpForTarget && latestOpForTarget.operation_id === op.operation_id && !isTerminal) {
      attention_items.push({
        id: `op_failed_${op.operation_id}`,
        target_type: (op.scope === 'epic' ? 'epic' : 'adu') as 'adu' | 'epic',
        target_id: op.target_id,
        kind: 'operation_failed',
        severity: 'P0',
        summary: `Operation failed`,
        recommended_action: 'Check orchestrator logs',
        created_at: op.last_progress_at || op.created_at || new Date(now).toISOString()
      });
    }
  });

  const needsAttention = attention_items.length > 0;

  // 4. Runtime Status
  let runtime_status: AgentRuntimeStatus = 'idle';
  if (isRunning) runtime_status = 'running';
  else if (needsAttention) runtime_status = 'needs_attention';
  else if (isReady) runtime_status = 'ready';

  // 5. Stale Warning
  let stale = false;
  let reason = null;
  let last_heartbeat_at = null;
  if (isRunning) {
    const activeOp = current_operations[0];
    last_heartbeat_at = activeOp.updated_at || activeOp.started_at;
    if (last_heartbeat_at) {
      const elapsed = Math.floor((now - new Date(last_heartbeat_at).getTime()) / 1000);
      if (elapsed > staleAfterSeconds) {
        stale = true;
        reason = `Heartbeat delayed by ${elapsed} seconds`;
      }
    }
  }

  // 6. Last Result & Success Rate
  let last_result: AgentFactoryAgentLastResult | null = null;
  let success_rate: number | null = null;
  
  const agentRuns = runs.filter(r => r.agent === agent.id).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  if (agentRuns.length > 0) {
    const latest = agentRuns[0];
    last_result = {
      run_timestamp: latest.timestamp,
      target_id: latest.adu_id,
      result: latest.result || 'unknown',
      effective_returncode: latest.effective_returncode ?? latest.returncode,
      finished_at: latest.timestamp
    };

    const terminalRuns = agentRuns.filter(r => r.result === 'success' || r.result === 'failed' || r.result === 'unstructured');
    if (terminalRuns.length > 0) {
      const successCount = terminalRuns.filter(r => r.result === 'success').length;
      success_rate = Math.round((successCount / terminalRuns.length) * 100);
    }
  }

  return {
    ...agent,
    runtime_status,
    current_operations,
    queued_targets,
    attention_items,
    last_result,
    last_run_at: agentRuns.length > 0 ? agentRuns[0].timestamp : null,
    success_rate,
    stale_warning: {
      stale,
      reason,
      last_heartbeat_at,
      stale_after_seconds: staleAfterSeconds
    }
  };
}

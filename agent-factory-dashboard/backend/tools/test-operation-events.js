#!/usr/bin/env node

const assert = require('assert');
const { mapOrchestratorEvent } = require('../dist/application/orchestration-operation-store');

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function runTests() {
  console.log("Running Operation Events Tests...");

  // T09
  console.log("🏃 Running T09 operation mapping tests...");

  // 1. Test agent_started
  const updates1 = mapOrchestratorEvent({
    event: 'agent_started',
    agent: 'Requirement Analyst',
    state: 'analyzed',
    timestamp: '2026-06-19T12:00:00Z'
  });
  eq(updates1.current_agent, 'Requirement Analyst', 'agent_started agent');
  eq(updates1.current_state, 'analyzed', 'agent_started state');
  eq(updates1.last_progress_at, '2026-06-19T12:00:00Z', 'agent_started progress timestamp');

  // 2. Test state_changed
  const updates2 = mapOrchestratorEvent({
    event: 'state_changed',
    state: 'designed',
    timestamp: '2026-06-19T12:05:00Z'
  });
  eq(updates2.current_state, 'designed', 'state_changed state');
  eq(updates2.last_progress_at, '2026-06-19T12:05:00Z', 'state_changed progress timestamp');

  // 3. Test artifact_written
  const updates3 = mapOrchestratorEvent({
    event: 'artifact_written',
    timestamp: '2026-06-19T12:10:00Z'
  });
  eq(updates3.last_progress_at, '2026-06-19T12:10:00Z', 'artifact_written timestamp');

  // 4. Test human_gate_opened
  const updates4 = mapOrchestratorEvent({
    event: 'human_gate_opened'
  });
  eq(updates4.status, 'waiting_human', 'human_gate_opened status');

  // 5. Test agent_failed
  const updates5 = mapOrchestratorEvent({
    event: 'agent_failed',
    error: 'Failed to build code'
  });
  eq(updates5.status, 'failed', 'agent_failed status');
  eq(updates5.result, 'failed', 'agent_failed result');
  eq(updates5.error, 'Failed to build code', 'agent_failed error message');

  // 6. Test additional fields (prompt_bytes, estimated_input_tokens)
  const updates6 = mapOrchestratorEvent({
    event: 'agent_started',
    agent: 'Developer',
    state: 'implemented',
    prompt_bytes: 4096,
    estimated_input_tokens: 1024,
    termination_reason: 'no_progress'
  });
  eq(updates6.prompt_bytes, 4096, 'prompt_bytes');
  eq(updates6.estimated_input_tokens, 1024, 'estimated_input_tokens');
  eq(updates6.termination_reason, 'no_progress', 'termination_reason');

  // ── Real ADU orchestrator format tests ──

  // 7. ADU orchestrator: wrapped in agent_factory_orchestrator_event
  const updates7 = mapOrchestratorEvent({
    type: 'agent_factory_orchestrator_event',
    payload: {
      event: 'step_completed',
      adu_id: 'ADU-001',
      agent_id: 'developer',
      from_state: 'test_red',
      to_state: 'implemented',
      result: 'success'
    }
  });
  eq(updates7.current_state, 'implemented', 'ADU step_completed extracts state from payload.action');
  eq(updates7.last_progress_at !== undefined, true, 'ADU step_completed sets progress timestamp');

  // 8. ADU orchestrator: state update with action field
  const updates8 = mapOrchestratorEvent({
    type: 'agent_factory_orchestrator_event',
    payload: {
      action: 'state_changed',
      adu: 'ADU-001',
      state: 'implemented'
    }
  });
  eq(updates8.current_state, 'implemented', 'ADU state_changed via action field');

  // 9. ADU orchestrator: agent_failed with progress update
  const updates9 = mapOrchestratorEvent({
    type: 'agent_factory_orchestrator_event',
    payload: {
      event: 'agent_failed',
      adu_id: 'ADU-001',
      agent_id: 'developer',
      stderr: 'Compilation failed'
    }
  });
  eq(updates9.status, 'failed', 'ADU agent_failed status');
  eq(updates9.result, 'failed', 'ADU agent_failed result');

  // 10. Epic orchestrator: epic_agent_started format
  const updates10 = mapOrchestratorEvent({
    type: 'epic_agent_started',
    payload: { epicId: 'EPIC-001', agent: 'system-flow-designer' }
  });
  eq(updates10.current_agent, 'system-flow-designer', 'Epic agent_started agent');

  // 11. Epic orchestrator: epic_state_changed format
  const updates11 = mapOrchestratorEvent({
    type: 'epic_state_changed',
    payload: { epicId: 'EPIC-001', state: 'flow_designed', action: 'child_failed_blocking_epic' }
  });
  eq(updates11.current_state, 'flow_designed', 'Epic state_changed state');

  // 12. WebSocket wrapped format: {type: "agentFactoryEvent", payload: {kind, action}}
  const updates12 = mapOrchestratorEvent({
    type: 'agentFactoryEvent',
    payload: {
      kind: 'epic',
      epicId: 'EPIC-001',
      action: 'epic_state_changed',
      state: 'child_adus_blocked'
    }
  });
  eq(updates12.current_state, 'child_adus_blocked', 'WebSocket wrapped state_changed');

  console.log("✅ T09 operation mapping tests passed!");
}

runTests().catch(err => {
  console.error("Test failed:", err.message);
  process.exit(1);
});

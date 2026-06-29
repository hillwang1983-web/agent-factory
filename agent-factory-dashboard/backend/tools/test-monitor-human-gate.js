#!/usr/bin/env node

const assert = require('assert');
const { AgentFactoryMonitorUseCase } = require('../dist/application/agent-factory-monitor');

class FakeRepo {
  constructor(adu, runs = []) {
    this.adu = adu;
    this.runs = runs;
  }

  getWorkspaceRoot() {
    return '/tmp';
  }

  async readAdus() {
    return [this.adu];
  }

  async readAgents() {
    return {};
  }

  async readRuns() {
    return this.runs;
  }

  async listArtifacts() {
    return [];
  }

  async updateAdus(mutator) {
    const next = mutator([this.adu]);
    this.adu = next[0];
    return next;
  }
}

async function runTests() {
  console.log("Running Monitor Human Gate Tests...");

  // Test Case 1: Stale human_gate_required flag when state is contracted
  console.log("🏃 Running stale human_gate_required test...");
  const staleFlagAdu = {
    id: 'ADU-STALE-GATE',
    state: 'contracted',
    human_gate_required: true,
    project_id: 'open5gs',
    repo_path: '/tmp/open5gs',
    artifacts: []
  };

  const monitor1 = new AgentFactoryMonitorUseCase(new FakeRepo(staleFlagAdu));
  const dashboard1 = await monitor1.getDashboard();
  const view1 = dashboard1.adus[0];

  // Assert that human_gate step is NOT in workflow
  const hasHumanGate1 = view1.workflow.some(step => step.state === 'human_gate');
  assert.strictEqual(hasHumanGate1, false, 'Should not render human_gate step when state is contracted');
  assert.notStrictEqual(view1.health.status, 'blocked', 'Health should not be blocked');

  // Test Case 2: Genuine Human Gate when state is human_gate
  console.log("🏃 Running genuine human_gate test...");
  const blockedAdu = {
    id: 'ADU-REAL-GATE',
    state: 'human_gate',
    human_gate_required: true,
    gate_type: 'environment_verification_required',
    project_id: 'open5gs',
    repo_path: '/tmp/open5gs',
    artifacts: []
  };

  const monitor2 = new AgentFactoryMonitorUseCase(new FakeRepo(blockedAdu));
  const dashboard2 = await monitor2.getDashboard();
  const view2 = dashboard2.adus[0];

  // Assert that human_gate step is in workflow
  const humanGateStep = view2.workflow.find(step => step.state === 'human_gate');
  assert.ok(humanGateStep, 'Should render human_gate step when state is human_gate');
  assert.strictEqual(humanGateStep.status, 'blocked', 'Human Gate step status should be blocked');
  assert.strictEqual(view2.health.status, 'blocked', 'Health should be blocked');

  // Test Case 3: Failed attempt at the current next agent remains retryable
  console.log("🏃 Running retryable failed attempt display test...");
  const retryableAdu = {
    id: 'ADU-RETRYABLE',
    state: 'contexted',
    human_gate_required: false,
    project_id: 'open5gs',
    repo_path: '/tmp/open5gs',
    artifacts: []
  };
  const retryableRuns = [{
    timestamp: '20260623-225454',
    adu_id: 'ADU-RETRYABLE',
    agent: 'detail-designer',
    returncode: 0,
    effective_returncode: 1,
    result: 'failed',
    parsed_result: {
      result: 'failed',
      error_code: 'EMPTY_HERMES_RESPONSE',
      error: 'Provider returned no output.'
    }
  }];

  const monitor3 = new AgentFactoryMonitorUseCase(new FakeRepo(retryableAdu, retryableRuns));
  const dashboard3 = await monitor3.getDashboard();
  const view3 = dashboard3.adus[0];

  assert.strictEqual(view3.next_agent, 'detail-designer', 'Next agent should remain detail-designer');
  assert.strictEqual(view3.display_status.kind, 'active', 'Retryable failed attempt should remain active');
  assert.strictEqual(view3.display_status.label, 'Retry Ready', 'Retryable failed attempt should show Retry Ready');
  assert.strictEqual(view3.health.status, 'active', 'Retryable failed attempt should not be a terminal failed health state');

  // Test Case 4: Disposing a human gate must clear paused so execution can continue
  console.log("🏃 Running human gate disposition unpauses ADU test...");
  const pausedGateAdu = {
    id: 'ADU-PAUSED-GATE',
    state: 'human_gate',
    pre_gate_state: 'implemented',
    paused: true,
    human_gate_required: true,
    gate_type: 'command_policy_exception',
    project_id: 'open5gs',
    repo_path: '/tmp/open5gs',
    artifacts: []
  };
  const repo4 = new FakeRepo(pausedGateAdu);
  const monitor4 = new AgentFactoryMonitorUseCase(repo4);
  const disposition = await monitor4.disposeHumanGate('ADU-PAUSED-GATE', {
    disposition: 'accept_risk',
    comment: 'approved command policy exception',
    affectedAssertions: []
  });
  assert.strictEqual(disposition.state, 'implemented', 'Disposition should return to pre-gate state');
  assert.strictEqual(repo4.adu.paused, false, 'Disposition should clear paused flag');
  assert.strictEqual(repo4.adu.human_gate_required, false, 'Disposition should clear human gate requirement');

  // Test Case 5: rework_planned must render as Phase 3 rework, not reset to Created
  console.log("🏃 Running rework_planned workflow placement test...");
  const reworkPlannedAdu = {
    id: 'ADU-REWORK-PLANNED',
    state: 'rework_planned',
    human_gate_required: false,
    project_id: 'open5gs',
    repo_path: '/tmp/open5gs',
    artifacts: []
  };
  const monitor5 = new AgentFactoryMonitorUseCase(new FakeRepo(reworkPlannedAdu));
  const dashboard5 = await monitor5.getDashboard();
  const view5 = dashboard5.adus[0];
  const createdStep = view5.workflow.find(step => step.state === 'created');
  const reworkStep = view5.workflow.find(step => step.state === 'rework_planned');

  assert.ok(reworkStep, 'Workflow should include rework_planned step');
  assert.strictEqual(reworkStep.status, 'current', 'rework_planned step should be current');
  assert.strictEqual(reworkStep.agent, 'developer', 'rework_planned should point to developer');
  assert.strictEqual(createdStep.status, 'complete', 'created should remain complete, not current');
  assert.strictEqual(view5.next_agent, 'developer', 'Next agent should be developer');

  // Test Case 6: Human Gate for Rework Plan Cleanup
  console.log("🏃 Running rework human gate cleanup rendering test...");
  const reworkCleanupGateAdu = {
    id: 'ADU-REWORK-CLEANUP',
    state: 'human_gate',
    pre_gate_state: 'rework_planned',
    gate_type: 'rework_requires_operator_cleanup',
    human_gate_required: true,
    project_id: 'open5gs',
    repo_path: '/tmp/open5gs',
    artifacts: []
  };

  const monitor6 = new AgentFactoryMonitorUseCase(new FakeRepo(reworkCleanupGateAdu));
  const dashboard6 = await monitor6.getDashboard();
  const view6 = dashboard6.adus[0];
  const reworkCleanupStep = view6.workflow.find(step => step.state === 'rework_planned');
  const testRedStep = view6.workflow.find(step => step.state === 'test_red');

  assert.ok(reworkCleanupStep, 'Workflow should include rework_planned step in cleanup gate');
  assert.strictEqual(reworkCleanupStep.status, 'blocked', 'rework_planned step should be blocked');
  assert.strictEqual(testRedStep.status, 'complete', 'preceding test_red step should be complete');

  console.log("✅ Monitor Human Gate Tests Passed!");
}

runTests().catch(err => {
  console.error("Test failed:", err.message);
  process.exit(1);
});

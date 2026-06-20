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

  console.log("✅ Monitor Human Gate Tests Passed!");
}

runTests().catch(err => {
  console.error("Test failed:", err.message);
  process.exit(1);
});

#!/usr/bin/env node
const express = require('express');
const { createAgentFactoryRouter } = require('../dist/interfaces/agent-factory-controller');
const { OrchestrationOperationStore } = require('../dist/application/orchestration-operation-store');
const { AgentFactoryMonitorUseCase } = require('../dist/application/agent-factory-monitor');

let passed = 0;
let failed = 0;

function assert(label, condition, details) {
  if (condition) {
    console.log(`✅  ${label}`);
    passed++;
  } else {
    console.error(`❌  ${label}`);
    if (details) console.error(details);
    failed++;
  }
}

async function testReworkAgentMapping() {
  console.log('\n--- Testing Rework Agent Mapping ---');
  // Initialize monitor with empty repo to just test NEXT_AGENT_BY_STATE indirectly or directly
  const { NEXT_AGENT_BY_STATE } = require('../dist/application/agent-factory-monitor');

  assert('code_rework maps to rework-planner', NEXT_AGENT_BY_STATE.code_rework === 'rework-planner');
  assert('build_rework maps to rework-planner', NEXT_AGENT_BY_STATE.build_rework === 'rework-planner');
  assert('acceptance_rework maps to rework-planner', NEXT_AGENT_BY_STATE.acceptance_rework === 'rework-planner');
  assert('rework_planned maps to developer', NEXT_AGENT_BY_STATE.rework_planned === 'developer');
}

async function testControllerIsolation() {
  console.log('\n--- Testing Controller Current ADU Data Isolation ---');

  // We mock the repository and monitor to provide global data
  const mockRepo = {
    readRuns: async () => [
      { timestamp: '1', adu_id: 'adu-A', agent: 'test-agent', result: 'failed', returncode: 1 },
      { timestamp: '2', adu_id: 'adu-B', agent: 'test-agent', result: 'success', returncode: 0 }
    ],
    readReviews: async () => [],
    readEpics: async () => []
  };

  const mockMonitor = {
    getDashboard: async () => ({
      generated_at: 'now',
      workspace: 'test',
      registry_valid: true,
      summary: {},
      agents: [{ id: 'test-agent' }],
      adus: [
        { id: 'adu-A', state: 'failed', workflow: [{state: 'test_red', agent: 'test-agent'}], latest_run: { agent: 'test-agent', result: 'failed', returncode: 1 } },
        { id: 'adu-B', state: 'implemented', workflow: [{state: 'test_red', agent: 'test-agent'}], next_agent: 'test-agent' }
      ],
      recent_runs: []
    })
  };

  const mockLogger = { info: () => {}, error: () => {}, warn: () => {} };

  // Mock Singletons
  const { HumanGateService } = require('../dist/application/human-gate-service');
  HumanGateService.getInstance = () => ({ listGates: async () => [] });

  const { OrchestrationOperationStore } = require('../dist/application/orchestration-operation-store');
  const originalGet = OrchestrationOperationStore.getInstance;
  OrchestrationOperationStore.getInstance = () => ({ getAllOperations: () => [] });

  const router = createAgentFactoryRouter(
    mockMonitor, // monitor
    null, // projectOnboarding
    null, // projectRepository
    mockRepo, // agentFactoryRepository
    mockLogger, // logger
    null, // aduIntake
    null  // epicFactory
  );

  const route = router.stack.find(r => r.route && r.route.path === '/agents/runtime-status');
  if (!route) {
    assert('Found runtime-status route', false);
    return;
  }

  const handler = route.route.stack[0].handle;

  let globalResBody = null;
  const reqGlobal = { query: { scope: 'global' }, params: {} };
  await new Promise((resolve) => {
    const resGlobal = {
      status: () => resGlobal,
      json: (body) => { globalResBody = body; resolve(); }
    };
    handler(reqGlobal, resGlobal, (err) => { if (err) console.error(err); resolve(); });
  });

  if (globalResBody && globalResBody.agents) {
    const globalAgent = globalResBody.agents.find(a => a.id === 'test-agent');
    assert('Global scope returns agent', globalAgent != null);
    assert('Global scope aggregates all data (Needs Attention from adu-A)', globalAgent.runtime_status === 'needs_attention', `Got ${globalAgent.runtime_status}`);
  } else {
    assert('Global response is not null and has agents', false);
  }

  let aduBResBody = null;
  const reqAduB = { query: { scope: 'adu', aduId: 'adu-B' }, params: {} };
  await new Promise((resolve) => {
    const resAduB = {
      status: () => resAduB,
      json: (body) => { aduBResBody = body; resolve(); }
    };
    handler(reqAduB, resAduB, (err) => { if (err) console.error(err); resolve(); });
  });

  if (aduBResBody && aduBResBody.agents) {
    const aduBAgent = aduBResBody.agents.find(a => a.id === 'test-agent');
    assert('ADU-B scope isolates data (adu-A failed run is ignored)', aduBAgent.runtime_status === 'ready' || aduBAgent.runtime_status === 'idle', `Got ${aduBAgent.runtime_status}`);
  } else {
    assert('ADU-B response is not null', false);
  }

  // Restore singletons just in case
  OrchestrationOperationStore.getInstance = originalGet;
}

async function runTests() {
  await testReworkAgentMapping();
  await testControllerIsolation();

  console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

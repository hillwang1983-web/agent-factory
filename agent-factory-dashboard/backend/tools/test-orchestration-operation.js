/**
 * Unit tests for OrchestrationOperationStore and metadata convergence
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-factory-ops-test-'));
process.env.AGENT_FACTORY_WORKSPACE = testWorkspace;

// Create dummy config.json / project registry to keep monitor config parser happy
const registryDir = path.join(testWorkspace, '.ai-agent', 'registry');
fs.mkdirSync(registryDir, { recursive: true });

const { OrchestrationOperationStore } = require('../dist/application/orchestration-operation-store');

let passed = 0;
let failed = 0;

function assert(label, fn) {
  try {
    fn();
    console.log(`✅  ${label}`);
    passed++;
  } catch (e) {
    console.error(`❌  ${label}: ${e.message}`);
    failed++;
  }
}

async function asyncAssert(label, fn) {
  try {
    await fn();
    console.log(`✅  ${label}`);
    passed++;
  } catch (e) {
    console.error(`❌  ${label}: ${e.message}`);
    failed++;
  }
}

async function main() {
  console.log('── Orchestration Operation Store Tests ──\n');

  const store = OrchestrationOperationStore.getInstance();

  // Test 1: Singleton instance
  assert('store is a singleton', () => {
    const store2 = OrchestrationOperationStore.getInstance();
    if (store !== store2) throw new Error('Expected instances to be identical');
  });

  // Test 2: Create operation
  assert('create operation registers a running operation', () => {
    store.clear();
    const op = store.createOperation({
      targetType: 'epic',
      targetId: 'EPIC-TEST-1',
      mode: 'continue'
    });

    if (!op.id.startsWith('op-EPIC-TEST-1-')) throw new Error(`Invalid id: ${op.id}`);
    if (op.status !== 'running') throw new Error('Expected status to be running');
    if (op.targetType !== 'epic') throw new Error('Expected targetType to be epic');
    if (op.targetId !== 'EPIC-TEST-1') throw new Error('Expected targetId to be EPIC-TEST-1');
    if (op.mode !== 'continue') throw new Error('Expected mode to be continue');
    if (op.events.length !== 0) throw new Error('Expected events to be empty');
  });

  // Test 3: Get latest operation for target
  assert('getLatestForTarget retrieves the most recent operation', () => {
    store.clear();
    const op1 = store.createOperation({ targetType: 'adu', targetId: 'ADU-X', mode: 'start' });
    const op2 = store.createOperation({ targetType: 'adu', targetId: 'ADU-X', mode: 'continue' });

    const latest = store.getLatestForTarget('adu', 'ADU-X');
    if (!latest) throw new Error('Expected to find latest operation');
    if (latest.id !== op2.id) throw new Error('Latest operation ID mismatch');
  });

  // Test 4: Add events and keep them capped
  assert('addEvent appends and caps events at 200', () => {
    store.clear();
    const op = store.createOperation({ targetType: 'adu', targetId: 'ADU-Y', mode: 'step' });

    for (let i = 0; i < 250; i++) {
      store.addEvent(op.id, {
        type: 'stdout_raw',
        payload: { text: `log line ${i}` },
        stream: 'stdout'
      });
    }

    const updated = store.getOperation(op.id);
    if (!updated) throw new Error('Operation not found');
    if (updated.events.length !== 200) {
      throw new Error(`Expected event length to be capped at 200, got: ${updated.events.length}`);
    }
    if (updated.events[199].payload.text !== 'log line 249') {
      throw new Error(`Expected last event payload to be log line 249, got: ${updated.events[199].payload.text}`);
    }
  });

  // Test 5: Update operation status
  assert('updateOperation updates fields and registers end timestamp', () => {
    store.clear();
    const op = store.createOperation({ targetType: 'epic', targetId: 'EPIC-TEST-2', mode: 'materialize' });

    if (op.endedAt) throw new Error('Expected endedAt to be undefined initially');

    store.updateOperation(op.id, {
      status: 'completed',
      exitCode: 0,
      finalState: 'epic_evidenced'
    });

    const updated = store.getOperation(op.id);
    if (!updated) throw new Error('Operation not found');
    if (updated.status !== 'completed') throw new Error('Status not updated');
    if (updated.exitCode !== 0) throw new Error('Exit code not updated');
    if (updated.finalState !== 'epic_evidenced') throw new Error('Final state not updated');
    if (!updated.endedAt) throw new Error('Expected endedAt to be populated');
  });

  // Test 6: stale running operation with a dead PID must not block retries
  assert('getActiveOperation finalizes dead-PID running operations', () => {
    store.clear();
    const op = store.createOperation({ targetType: 'adu', targetId: 'ADU-DEAD-PID', mode: 'continue' });
    store.updateOperation(op.id, { pid: 99999999 });

    const active = store.getActiveOperation('ADU-DEAD-PID');
    if (active) throw new Error('Expected dead PID operation not to be returned as active');

    const updated = store.getOperation(op.id);
    if (!updated) throw new Error('Operation not found after dead PID finalization');
    if (updated.status !== 'failed') throw new Error(`Expected status failed, got ${updated.status}`);
    if (updated.result !== 'failed') throw new Error(`Expected result failed, got ${updated.result}`);
    if (!String(updated.error || '').includes('stale active operation')) {
      throw new Error(`Expected stale active operation error, got ${updated.error}`);
    }
    if (!updated.endedAt) throw new Error('Expected stale operation to receive endedAt');
  });

  // Test 7: ADU latest metadata and operation final state convergence (Real Registry-based Test)
  await asyncAssert('ADU latest metadata and operation state converges', async () => {
    store.clear();

    // 1. Write the initial mock files under the active test registry
    fs.writeFileSync(
      path.join(registryDir, 'adu.json'),
      JSON.stringify({
        version: 1,
        adus: [
          {
            id: 'ADU-CONVERGE',
            state: 'evidenced',
            project_id: 'default-open5gs',
            repo_path: '/tmp',
            artifacts: [],
            latest_agent: 'acceptance-reviewer',
            latest_run_timestamp: '20260621-110000'
          }
        ]
      }, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(registryDir, 'runs.json'),
      JSON.stringify({
        version: 1,
        runs: [
          {
            timestamp: '20260621-120000',
            adu_id: 'ADU-CONVERGE',
            agent: 'evidence',
            result: 'success',
            returncode: 0
          }
        ]
      }, null, 2) + '\n'
    );

    // 2. Create the operation and set its terminal status in the store
    const op = store.createOperation({
      targetType: 'adu',
      targetId: 'ADU-CONVERGE',
      mode: 'continue',
    });

    store.updateOperation(op.id, {
      status: 'completed',
      finalState: 'evidenced',
      exitCode: 0,
    });

    // 3. Load the monitor and check that the ADU metadata converges with the latest run
    const { FileAgentFactoryRepository } = require('../dist/infrastructure/file-agent-factory-repository');
    const { AgentFactoryMonitorUseCase } = require('../dist/application/agent-factory-monitor');
    const pino = require('pino');
    const logger = pino({ level: 'silent' });
    const repo = new FileAgentFactoryRepository(testWorkspace, 100000, logger);
    const monitor = new AgentFactoryMonitorUseCase(repo);

    const dashboard = await monitor.getDashboard();
    const aduView = dashboard.adus.find(a => a.id === 'ADU-CONVERGE');

    if (!aduView) throw new Error('Expected to find ADU-CONVERGE in dashboard');
    if (aduView.state !== 'evidenced') {
      throw new Error(`Expected ADU state to converge to evidenced, got: ${aduView.state}`);
    }
    if (aduView.latest_agent !== 'evidence') {
      throw new Error(`Expected ADU latest_agent to converge to evidence, got: ${aduView.latest_agent}`);
    }
    if (aduView.latest_run_timestamp !== '20260621-120000') {
      throw new Error(`Expected ADU latest_run_timestamp to converge to 20260621-120000, got: ${aduView.latest_run_timestamp}`);
    }

    const updatedOp = store.getOperation(op.id);
    if (updatedOp.status !== 'completed') throw new Error('Expected operation status to be completed');
    if (updatedOp.finalState !== 'evidenced') throw new Error('Expected operation finalState to be evidenced');

    // Wait a short duration for the async write back to disk to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify adu.json on disk contains the converged values
    const updatedDiskAdu = JSON.parse(fs.readFileSync(path.join(registryDir, 'adu.json'), 'utf8'));
    const diskAdu = updatedDiskAdu.adus.find(a => a.id === 'ADU-CONVERGE');
    if (!diskAdu) throw new Error('Expected to find ADU-CONVERGE in adu.json on disk');
    if (diskAdu.latest_agent !== 'evidence') {
      throw new Error(`Expected disk ADU latest_agent to be evidence, got: ${diskAdu.latest_agent}`);
    }
    if (diskAdu.latest_run_timestamp !== '20260621-120000') {
      throw new Error(`Expected disk ADU latest_run_timestamp to be 20260621-120000, got: ${diskAdu.latest_run_timestamp}`);
    }
  });

  try {
    fs.rmSync(testWorkspace, { recursive: true, force: true });
  } catch (_) {}

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

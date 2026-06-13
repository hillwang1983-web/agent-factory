/**
 * Unit tests for OrchestrationOperationStore
 */
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

function main() {
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
    // Simulate delay
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
    // Check that the last events are preserved
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

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  process.exit(failed > 0 ? 1 : 0);
}

main();

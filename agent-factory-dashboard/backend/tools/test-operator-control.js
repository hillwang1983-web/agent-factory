#!/usr/bin/env node
const { OperatorControl } = require('../dist/application/operator/operator-control');

let passed = 0;
let failed = 0;

async function assertAsync(label, fn) {
  try {
    await fn();
    console.log(`✅  ${label}`);
    passed++;
  } catch (e) {
    console.error(`❌  ${label}: ${e.message}`);
    failed++;
  }
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`);
}

class MockOperatorRepository {
  constructor() {
    this.actions = [];
    this.logs = [];
  }
  async saveAction(a) { this.actions.push(a); }
  async getActions() { return this.actions; }
  async getActionByIdempotencyKey(key) {
    return this.actions.find(a => a.idempotency_key === key) || null;
  }
  async saveAuditLog(l) { this.logs.push(l); }
  async getAuditLogs() { return this.logs; }
}

class MockLockService {
  constructor() {
    this.locked = false;
  }
  isLocked() { return this.locked; }
  acquireLock() {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }
  releaseLock() { this.locked = false; }
}

class MockOperationStore {
  constructor() {
    this.ops = [];
  }
  getLatestForTarget() {
    return this.ops[this.ops.length - 1] || null;
  }
  createOperation(op) {
    const newOp = { operation_id: 'OP-123', status: 'running', ...op };
    this.ops.push(newOp);
    return newOp;
  }
}

class MockRunnerDelegate {
  constructor() {
    this.spawnedAdu = [];
    this.spawnedEpic = [];
  }
  async spawnAduOrchestrator(aduId, mode) {
    this.spawnedAdu.push({ aduId, mode });
    return { success: true, operation_id: 'OP-123' };
  }
  async spawnEpicOrchestrator(epicId, mode) {
    this.spawnedEpic.push({ epicId, mode });
    return { success: true, operation_id: 'OP-123' };
  }
}

async function runTests() {
  const mockMonitor = { repo: { getAduById: async () => ({ id: 'ADU-1', project_id: 'p1' }) } };
  const mockEpicMonitor = {};

  await assertAsync('OperatorControl runs action successfully', async () => {
    const repo = new MockOperatorRepository();
    const lock = new MockLockService();
    const store = new MockOperationStore();
    const runner = new MockRunnerDelegate();

    const control = new OperatorControl(mockMonitor, mockEpicMonitor, repo, lock, store, runner);

    const res = await control.executeAction({
      id: 'ACT-1',
      target: { type: 'adu', id: 'ADU-1' },
      action: 'start',
      requested_by: 'codex',
      idempotency_key: 'key-1',
      created_at: new Date().toISOString()
    });

    eq(res.success, true);
    eq(runner.spawnedAdu.length, 1);
    eq(runner.spawnedAdu[0].aduId, 'ADU-1');
    eq(runner.spawnedAdu[0].mode, 'start');
    eq(repo.actions.length, 1);
    eq(repo.logs.length, 1);
    eq(repo.logs[0].status, 'success');
  });

  await assertAsync('OperatorControl respects active locks', async () => {
    const repo = new MockOperatorRepository();
    const lock = new MockLockService();
    const store = new MockOperationStore();
    const runner = new MockRunnerDelegate();

    lock.locked = true; // Set lock as active

    const control = new OperatorControl(mockMonitor, mockEpicMonitor, repo, lock, store, runner);

    let threw = false;
    try {
      await control.executeAction({
        id: 'ACT-2',
        target: { type: 'adu', id: 'ADU-1' },
        action: 'start',
        requested_by: 'codex',
        idempotency_key: 'key-2',
        created_at: new Date().toISOString()
      });
    } catch (err) {
      threw = true;
      eq(err.conflict, true);
    }
    eq(threw, true);
    eq(runner.spawnedAdu.length, 0);
  });

  await assertAsync('OperatorControl handles idempotency keys', async () => {
    const repo = new MockOperatorRepository();
    const lock = new MockLockService();
    const store = new MockOperationStore();
    const runner = new MockRunnerDelegate();

    const control = new OperatorControl(mockMonitor, mockEpicMonitor, repo, lock, store, runner);

    // Pre-insert an action with key-1
    await repo.saveAction({
      id: 'ACT-1',
      target: { type: 'adu', id: 'ADU-1' },
      action: 'start',
      requested_by: 'codex',
      idempotency_key: 'key-1',
      created_at: new Date().toISOString()
    });
    // Mock stored latest operation
    store.ops.push({ operation_id: 'OP-123', status: 'completed' });

    const res = await control.executeAction({
      id: 'ACT-2',
      target: { type: 'adu', id: 'ADU-1' },
      action: 'start',
      requested_by: 'codex',
      idempotency_key: 'key-1', // Same key
      created_at: new Date().toISOString()
    });

    eq(res.operation_id, 'OP-123');
    eq(res.status, 'completed');
    eq(runner.spawnedAdu.length, 0); // No new subprocess run
  });

  console.log(`\nOperatorControl tests completed: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});

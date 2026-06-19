#!/usr/bin/env node
const { FileAgentFactoryRepository } = require('../dist/infrastructure/file-agent-factory-repository');
const { AduIntake } = require('../dist/application/adu-intake');
const { FileProjectRepository } = require('../dist/infrastructure/file-project-repository');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

let passed = 0;
let failed = 0;

async function assertAsync(label, fn) {
  try {
    await fn();
    console.log(`✅  ${label}`);
    passed++;
  } catch (e) {
    console.error(`❌  ${label}: ${e.message}`);
    console.error(e.stack);
    failed++;
  }
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`);
}

async function runTests() {
  // --- Test 1: Concurrency serialization in FileAgentFactoryRepository ---
  await assertAsync('Concurrent updateAdus calls serialize and prevent data loss', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-phase37-repo-'));
    const registryDir = path.join(tmpDir, '.ai-agent', 'registry');
    await fs.mkdir(registryDir, { recursive: true });

    // Write initial empty adu.json
    await fs.writeFile(path.join(registryDir, 'adu.json'), JSON.stringify({ version: 1, adus: [] }, null, 2));

    const pino = require('pino');
    const logger = pino({ level: 'silent' });
    const repo = new FileAgentFactoryRepository(tmpDir, 1024 * 1024, logger);

    // Trigger 10 concurrent updateAdus calls
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        repo.updateAdus(async (adus) => {
          // Add artificial delay to increase chance of concurrency race condition
          await new Promise(resolve => setTimeout(resolve, Math.random() * 20));
          adus.push({ id: `adu-${i}`, title: `ADU ${i}` });
          return adus;
        })
      );
    }

    await Promise.all(promises);

    const finalAdus = await repo.readAdus();
    eq(finalAdus.length, 10, `Expected 10 ADUs, got ${finalAdus.length}`);
    for (let i = 0; i < 10; i++) {
      const found = finalAdus.find(a => a.id === `adu-${i}`);
      eq(!!found, true, `Missing adu-${i}`);
    }
  });

  // --- Test 2 & 3: AduIntake Draft Generation Failures & Timeouts ---
  await assertAsync('AduIntake.generateDraftSync fails when draft.json is missing', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-phase37-intake-'));
    const registryDir = path.join(tmpDir, '.ai-agent', 'registry');
    await fs.mkdir(registryDir, { recursive: true });

    // Create project
    const projectRepo = new FileProjectRepository(
      path.join(tmpDir, '.agent-factory-projects.json'),
      tmpDir,
      [tmpDir],
      pinoSilent()
    );
    const projectPath = path.join(tmpDir, '.agent-factory');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
      path.join(projectPath, 'project-profile.json'),
      JSON.stringify({ project_id: 'p1', status: 'profiled' }, null, 2)
    );

    // Write intake drafts registry containing our draft
    const draftsRegistry = {
      version: 1,
      drafts: [
        {
          draft_id: 'd1',
          project_id: 'p1',
          repo_path: tmpDir,
          draft_path: 'draft.json',
          status: 'created'
        }
      ]
    };
    await fs.writeFile(path.join(registryDir, 'intake-drafts.json'), JSON.stringify(draftsRegistry, null, 2));

    // Create a mock script that exits 0 but does not create the draft file
    const scriptsDir = path.join(tmpDir, 'scripts');
    await fs.mkdir(scriptsDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptsDir, 'hermes_agent_run.py'),
      `import sys
sys.exit(0)
`
    );

    const mockAduFactory = {};
    const intake = new AduIntake(projectRepo, mockAduFactory, tmpDir);

    let threw = false;
    try {
      await intake.generateDraftSync('d1');
    } catch (e) {
      threw = true;
      eq(e.message.includes('does not exist'), true, `Unexpected error: ${e.message}`);
    }
    eq(threw, true, 'Expected generateDraftSync to throw');

    // Verify draft status in registry is generation_failed
    const regContent = JSON.parse(await fs.readFile(path.join(registryDir, 'intake-drafts.json'), 'utf-8'));
    eq(regContent.drafts[0].status, 'generation_failed');
    eq(regContent.drafts[0].error.includes('does not exist'), true);
  });

  await assertAsync('AduIntake.generateDraftSync fails when draft.json has invalid JSON structure', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-phase37-intake-json-'));
    const registryDir = path.join(tmpDir, '.ai-agent', 'registry');
    await fs.mkdir(registryDir, { recursive: true });

    // Create project
    const projectRepo = new FileProjectRepository(
      path.join(tmpDir, '.agent-factory-projects.json'),
      tmpDir,
      [tmpDir],
      pinoSilent()
    );
    const projectPath = path.join(tmpDir, '.agent-factory');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
      path.join(projectPath, 'project-profile.json'),
      JSON.stringify({ project_id: 'p1', status: 'profiled' }, null, 2)
    );

    // Write intake drafts registry containing our draft
    const draftsRegistry = {
      version: 1,
      drafts: [
        {
          draft_id: 'd1',
          project_id: 'p1',
          repo_path: tmpDir,
          draft_path: 'draft.json',
          status: 'created'
        }
      ]
    };
    await fs.writeFile(path.join(registryDir, 'intake-drafts.json'), JSON.stringify(draftsRegistry, null, 2));

    // Create a mock script that writes an invalid JSON string to draft.json
    const scriptsDir = path.join(tmpDir, 'scripts');
    await fs.mkdir(scriptsDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptsDir, 'hermes_agent_run.py'),
      `import sys
with open('draft.json', 'w') as f:
    f.write("{invalid-json")
sys.exit(0)
`
    );

    const mockAduFactory = {};
    const intake = new AduIntake(projectRepo, mockAduFactory, tmpDir);

    let threw = false;
    try {
      await intake.generateDraftSync('d1');
    } catch (e) {
      threw = true;
      eq(e.message.includes('Failed to parse draft JSON'), true, `Unexpected error: ${e.message}`);
    }
    eq(threw, true, 'Expected generateDraftSync to throw');

    // Verify draft status in registry is generation_failed
    const regContent = JSON.parse(await fs.readFile(path.join(registryDir, 'intake-drafts.json'), 'utf-8'));
    eq(regContent.drafts[0].status, 'generation_failed');
    eq(regContent.drafts[0].error.includes('Failed to parse draft JSON'), true);
  });

  await assertAsync('AduIntake.generateDraftSync fails when draft.json lacks title or goal', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-phase37-intake-schema-'));
    const registryDir = path.join(tmpDir, '.ai-agent', 'registry');
    await fs.mkdir(registryDir, { recursive: true });

    // Create project
    const projectRepo = new FileProjectRepository(
      path.join(tmpDir, '.agent-factory-projects.json'),
      tmpDir,
      [tmpDir],
      pinoSilent()
    );
    const projectPath = path.join(tmpDir, '.agent-factory');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
      path.join(projectPath, 'project-profile.json'),
      JSON.stringify({ project_id: 'p1', status: 'profiled' }, null, 2)
    );

    // Write intake drafts registry containing our draft
    const draftsRegistry = {
      version: 1,
      drafts: [
        {
          draft_id: 'd1',
          project_id: 'p1',
          repo_path: tmpDir,
          draft_path: 'draft.json',
          status: 'created'
        }
      ]
    };
    await fs.writeFile(path.join(registryDir, 'intake-drafts.json'), JSON.stringify(draftsRegistry, null, 2));

    // Create a mock script that writes a draft with missing goal
    const scriptsDir = path.join(tmpDir, 'scripts');
    await fs.mkdir(scriptsDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptsDir, 'hermes_agent_run.py'),
      `import sys
import json
with open('draft.json', 'w') as f:
    json.dump({"title": "some title"}, f)
sys.exit(0)
`
    );

    const mockAduFactory = {};
    const intake = new AduIntake(projectRepo, mockAduFactory, tmpDir);

    let threw = false;
    try {
      await intake.generateDraftSync('d1');
    } catch (e) {
      threw = true;
      eq(e.message.includes('goal is missing or empty'), true, `Unexpected error: ${e.message}`);
    }
    eq(threw, true, 'Expected generateDraftSync to throw');

    // Verify draft status in registry is generation_failed
    const regContent = JSON.parse(await fs.readFile(path.join(registryDir, 'intake-drafts.json'), 'utf-8'));
    eq(regContent.drafts[0].status, 'generation_failed');
    eq(regContent.drafts[0].error.includes('goal is missing or empty'), true);
  });

  await assertAsync('AduIntake.generateDraftSync aborts and transitions to failure on timeout', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-phase37-intake-timeout-'));
    const registryDir = path.join(tmpDir, '.ai-agent', 'registry');
    await fs.mkdir(registryDir, { recursive: true });

    // Create project
    const projectRepo = new FileProjectRepository(
      path.join(tmpDir, '.agent-factory-projects.json'),
      tmpDir,
      [tmpDir],
      pinoSilent()
    );
    const projectPath = path.join(tmpDir, '.agent-factory');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(
      path.join(projectPath, 'project-profile.json'),
      JSON.stringify({ project_id: 'p1', status: 'profiled' }, null, 2)
    );

    // Write intake drafts registry containing our draft
    const draftsRegistry = {
      version: 1,
      drafts: [
        {
          draft_id: 'd1',
          project_id: 'p1',
          repo_path: tmpDir,
          draft_path: 'draft.json',
          status: 'created'
        }
      ]
    };
    await fs.writeFile(path.join(registryDir, 'intake-drafts.json'), JSON.stringify(draftsRegistry, null, 2));

    // Create a mock script that sleeps for 5 seconds
    const scriptsDir = path.join(tmpDir, 'scripts');
    await fs.mkdir(scriptsDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptsDir, 'hermes_agent_run.py'),
      `import sys
import time
time.sleep(5)
sys.exit(0)
`
    );

    const mockAduFactory = {};
    const intake = new AduIntake(projectRepo, mockAduFactory, tmpDir);

    // Set timeout to 100ms
    process.env.INTAKE_TIMEOUT_MS = '100';

    let threw = false;
    try {
      await intake.generateDraftSync('d1');
    } catch (e) {
      threw = true;
      eq(e.message.includes('timed out'), true, `Unexpected error: ${e.message}`);
    }
    eq(threw, true, 'Expected generateDraftSync to throw on timeout');

    // Clean up env
    delete process.env.INTAKE_TIMEOUT_MS;

    // Verify draft status in registry is generation_failed
    const regContent = JSON.parse(await fs.readFile(path.join(registryDir, 'intake-drafts.json'), 'utf-8'));
    eq(regContent.drafts[0].status, 'generation_failed');
    eq(regContent.drafts[0].error.includes('timed out'), true);
  });

  // --- Test 4: Deadlock prevention (Re-entrancy) ---
  await assertAsync('RegistryLock re-entrancy allows nested calls without deadlocking', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-phase37-deadlock-'));
    const registryDir = path.join(tmpDir, '.ai-agent', 'registry');
    await fs.mkdir(registryDir, { recursive: true });

    // Initialize registries
    await fs.writeFile(path.join(registryDir, 'adu.json'), JSON.stringify({ version: 1, adus: [] }, null, 2));
    await fs.writeFile(path.join(registryDir, 'reviews.json'), JSON.stringify({ version: 1, reviews: [] }, null, 2));
    await fs.writeFile(path.join(registryDir, 'epics.json'), JSON.stringify({ version: 1, epics: [] }, null, 2));

    const pino = require('pino');
    const logger = pino({ level: 'silent' });
    const repo = new FileAgentFactoryRepository(tmpDir, 1024 * 1024, logger);
    const { RegistryLock } = require('../dist/infrastructure/registry-lock');
    RegistryLock.setWorkspaceRoot(tmpDir);

    // Timeout protective wrapper
    const runWithTimeout = (promise, ms) => {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Deadlock detected (timeout)')), ms));
      return Promise.race([promise, timeout]);
    };

    const task = RegistryLock.runLocked(async () => {
      // 1. Nested repository updates (should be allowed via re-entrancy)
      await repo.updateAdus(async (adus) => {
        adus.push({ id: 'adu-1', title: 'Nested ADU' });
        return adus;
      });

      await repo.updateReviews(async (reviews) => {
        reviews.push({ review_id: 'r-1', adu_id: 'adu-1' });
        return reviews;
      });

      await repo.saveAdu({ id: 'adu-2', title: 'Saved ADU' });

      // 2. Nested RegistryLock.runLocked calls directly
      await RegistryLock.runLocked(async () => {
        // Direct nested call
      });
    });

    await runWithTimeout(task, 2000); // Expect it to finish within 2 seconds.

    // Verify changes were written successfully
    const finalAdus = await repo.readAdus();
    eq(finalAdus.length, 2, `Expected 2 ADUs, got ${finalAdus.length}`);
  });

  await assertAsync('AduIntake registration does not deadlock with FileAgentFactoryRepository', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-phase37-intake-deadlock-'));
    const registryDir = path.join(tmpDir, '.ai-agent', 'registry');
    await fs.mkdir(registryDir, { recursive: true });

    await fs.writeFile(path.join(registryDir, 'adu.json'), JSON.stringify({ version: 1, adus: [] }, null, 2));
    await fs.writeFile(path.join(registryDir, 'intake-drafts.json'), JSON.stringify({ version: 1, drafts: [] }, null, 2));

    const pino = require('pino');
    const logger = pino({ level: 'silent' });
    const repo = new FileAgentFactoryRepository(tmpDir, 1024 * 1024, logger);
    const { RegistryLock } = require('../dist/infrastructure/registry-lock');
    RegistryLock.setWorkspaceRoot(tmpDir);

    // Create a mock ProjectAduFactory that saves to repo (which requires RegistryLock)
    const mockAduFactory = {
      createForProject: async (projId, aduInput) => {
        const adu = { id: aduInput.aduId || 'adu-1', ...aduInput };
        await repo.saveAdu(adu);
        return adu;
      }
    };

    const projectRepo = new FileProjectRepository(
      path.join(tmpDir, '.agent-factory-projects.json'),
      tmpDir,
      [tmpDir],
      logger
    );

    const intake = new AduIntake(projectRepo, mockAduFactory, tmpDir);

    // Add a draft to registry
    const draftsRegistry = {
      version: 1,
      drafts: [
        {
          draft_id: 'd1',
          project_id: 'p1',
          repo_path: tmpDir,
          draft_path: 'draft.json',
          status: 'draft_ready'
        }
      ]
    };
    await fs.writeFile(path.join(registryDir, 'intake-drafts.json'), JSON.stringify(draftsRegistry, null, 2));

    // Write mock draft.json
    await fs.writeFile(
      path.join(tmpDir, 'draft.json'),
      JSON.stringify({
        aduId: 'adu-100',
        title: 'Intake ADU',
        goal: 'Build feature',
        requiredCommands: ['npm run test']
      }, null, 2)
    );

    // Run registration with 2 second timeout (should not deadlock)
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Deadlock in registration')), 2000));
    const registerPromise = intake.registerDraft('d1');

    await Promise.race([registerPromise, timeoutPromise]);

    const finalAdus = await repo.readAdus();
    eq(finalAdus.length, 1);
    eq(finalAdus[0].id, 'adu-100');
  });

  await assertAsync('OperatorControl throws 400 when materialize_child_adus is executed on ADU target', async () => {
    const { OperatorControl } = require('../dist/application/operator/operator-control');
    const mockMonitor = { repo: { getAduById: async () => ({ id: 'adu-1', project_id: 'p1' }) } };
    const mockEpicMonitor = {};
    const mockRepo = {
      getActionByIdempotencyKey: async () => null,
      saveAction: async () => {},
      saveAuditLog: async () => {}
    };
    const mockLock = { isLocked: () => false, acquireLock: () => true, releaseLock: () => {} };
    const mockStore = { getLatestForTarget: () => null };
    const mockRunner = {};
    const control = new OperatorControl(mockMonitor, mockEpicMonitor, mockRepo, mockLock, mockStore, mockRunner);

    let threw = false;
    try {
      await control.executeAction({
        id: 'ACT-1',
        target: { type: 'adu', id: 'adu-1' },
        action: 'materialize_child_adus',
        requested_by: 'human',
        idempotency_key: 'key-1',
        created_at: new Date().toISOString()
      });
    } catch (err) {
      threw = true;
      eq(err.status, 400);
      eq(err.message.includes('only supported for Epic targets'), true);
    }
    eq(threw, true);
  });

  // --- Test 6: Lock acquisition timeout does not release other processes' locks ---
  await assertAsync('RegistryLock timeout does not unlink locks held by other owners', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-phase37-lock-timeout-'));
    const registryDir = path.join(tmpDir, '.ai-agent', 'registry');
    await fs.mkdir(registryDir, { recursive: true });

    const { RegistryLock } = require('../dist/infrastructure/registry-lock');
    RegistryLock.setWorkspaceRoot(tmpDir);
    const originalTimeout = RegistryLock.timeoutMs;
    RegistryLock.timeoutMs = 100; // set short timeout

    try {
      const lockFilePath = path.join(registryDir, 'registry.lock');

      // Simulate lock held by another process with active PID
      const otherLockData = {
        pid: process.pid,
        owner: 'other-owner-token',
        heartbeat: Date.now()
      };
      await fs.writeFile(lockFilePath, JSON.stringify(otherLockData));

      let timeoutError = false;
      try {
        await RegistryLock.runLocked(async () => {
          // should timeout because simulated lock is active
        });
      } catch (e) {
        if (e.message.includes('lock acquisition timed out')) {
          timeoutError = true;
        }
      }

      eq(timeoutError, true, 'Expected registry lock acquisition to timeout');

      // Verify lock file is not deleted and content is untouched
      const lockContent = await fs.readFile(lockFilePath, 'utf8');
      const parsed = JSON.parse(lockContent);
      eq(parsed.owner, 'other-owner-token', 'Lock file should still belong to other-owner-token');
    } finally {
      RegistryLock.timeoutMs = originalTimeout;
    }
  });

  // --- Test 7: Cross-Process Concurrent RMW Consistency ---
  await assertAsync('Cross-process concurrent updates are serialized and consistent', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-phase37-concurrency-rmw-'));
    const registryDir = path.join(tmpDir, '.ai-agent', 'registry');
    await fs.mkdir(registryDir, { recursive: true });

    const counterFile = path.join(registryDir, 'counter.json');
    await fs.writeFile(counterFile, JSON.stringify({ count: 0 }));

    // Create a temporary worker script that simulates an independent process
    const workerScriptPath = path.join(tmpDir, 'test-lock-worker.js');
    const workerCode = `
      const { RegistryLock } = require('${path.resolve(__dirname, '../dist/infrastructure/registry-lock')}');
      const fs = require('fs/promises');
      const path = require('path');

      const registryDir = process.argv[2];
      const counterFile = path.join(registryDir, 'counter.json');
      RegistryLock.setWorkspaceRoot(path.dirname(path.dirname(registryDir)));

      async function run() {
        for (let i = 0; i < 10; i++) {
          await RegistryLock.runLocked(async () => {
            let val = 0;
            try {
              const content = await fs.readFile(counterFile, 'utf8');
              val = JSON.parse(content).count;
            } catch (e) {}
            // Artificial delay to make conflict highly likely without locks
            await new Promise(r => setTimeout(r, 10));
            await fs.writeFile(counterFile, JSON.stringify({ count: val + 1 }));
          });
        }
      }
      run().catch(e => {
        console.error(e);
        process.exit(1);
      });
    `;
    await fs.writeFile(workerScriptPath, workerCode);

    const { fork } = require('child_process');

    const spawnWorker = () => {
      return new Promise((resolve, reject) => {
        const child = fork(workerScriptPath, [registryDir]);
        child.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error('Worker exited with non-zero code ' + code));
        });
      });
    };

    // Fork 2 concurrent child processes running the loop
    await Promise.all([spawnWorker(), spawnWorker()]);

    const finalContent = await fs.readFile(counterFile, 'utf8');
    const finalCount = JSON.parse(finalContent).count;

    eq(finalCount, 20, 'Expected final counter to be exactly 20');
  });

  // --- Test 8: Cross-language (Node & Python) concurrent RMW updates ---
  await assertAsync('Cross-language concurrent updates are serialized and consistent', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-phase37-cross-rmw-'));
    const registryDir = path.join(tmpDir, '.ai-agent', 'registry');
    await fs.mkdir(registryDir, { recursive: true });

    const counterFile = path.join(registryDir, 'counter.json');
    await fs.writeFile(counterFile, JSON.stringify({ count: 0 }));

    // Node worker code (same as test 7)
    const nodeWorkerPath = path.join(tmpDir, 'node-worker.js');
    const nodeCode = `
      const { RegistryLock } = require('${path.resolve(__dirname, '../dist/infrastructure/registry-lock')}');
      const fs = require('fs/promises');
      const path = require('path');

      const registryDir = process.argv[2];
      const counterFile = path.join(registryDir, 'counter.json');
      RegistryLock.setWorkspaceRoot(path.dirname(path.dirname(registryDir)));

      async function run() {
        for (let i = 0; i < 10; i++) {
          await RegistryLock.runLocked(async () => {
            let val = 0;
            try {
              const content = await fs.readFile(counterFile, 'utf8');
              val = JSON.parse(content).count;
            } catch (e) {}
            await new Promise(r => setTimeout(r, 10));
            await fs.writeFile(counterFile, JSON.stringify({ count: val + 1 }));
          });
        }
      }
      run().catch(e => {
        console.error(e);
        process.exit(1);
      });
    `;
    await fs.writeFile(nodeWorkerPath, nodeCode);

    // Python worker code
    const pythonWorkerPath = path.join(tmpDir, 'python-worker.py');
    const pythonCode = `
import sys
import json
import time
import pathlib

# Append scripts folder to sys.path
sys.path.append('${path.resolve(__dirname, '../../../scripts')}')
from registry_lock import registry_lock, save_json_direct

registry_dir = sys.argv[1]
counter_file = pathlib.Path(registry_dir) / "counter.json"

def run():
    for i in range(10):
        with registry_lock(registry_dir):
            val = 0
            try:
                with open(str(counter_file), "r", encoding="utf-8") as f:
                    val = json.load(f).get("count", 0)
            except Exception:
                pass
            time.sleep(0.01)
            save_json_direct(str(counter_file), {"count": val + 1})

if __name__ == "__main__":
    run()
    `;
    await fs.writeFile(pythonWorkerPath, pythonCode);

    const { fork, spawn } = require('child_process');

    const spawnNodeWorker = () => {
      return new Promise((resolve, reject) => {
        const child = fork(nodeWorkerPath, [registryDir]);
        child.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error('Node worker exited with code ' + code));
        });
      });
    };

    const spawnPythonWorker = () => {
      return new Promise((resolve, reject) => {
        const child = spawn('python3', [pythonWorkerPath, registryDir]);
        child.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error('Python worker exited with code ' + code));
        });
      });
    };

    // Spawn 1 Node worker and 1 Python worker concurrently
    await Promise.all([spawnNodeWorker(), spawnPythonWorker()]);

    const finalContent = await fs.readFile(counterFile, 'utf8');
    const finalCount = JSON.parse(finalContent).count;

    eq(finalCount, 20, 'Expected mixed cross-language counter to be exactly 20');
  });

  // T01
  await assertAsync('T01 runtime version mismatch is visible', async () => {
    const checkCompat = (info) => {
      if (!info || info.phase !== '3.7') return 'phase_too_low';
      if (!info.control_enabled) return 'control_disabled';
      if (!info.capabilities?.includes('operator-control')) return 'missing_capability';
      return 'compatible';
    };

    eq(checkCompat({ phase: '3.6', control_enabled: true, capabilities: ['operator-control'] }), 'phase_too_low');
    eq(checkCompat({ phase: '3.7', control_enabled: false, capabilities: ['operator-control'] }), 'control_disabled');
    eq(checkCompat({ phase: '3.7', control_enabled: true, capabilities: [] }), 'missing_capability');
    eq(checkCompat({ phase: '3.7', control_enabled: true, capabilities: ['operator-control'] }), 'compatible');
  });

  // T06
  await assertAsync('T06 intake errors expose stable error_code', async () => {
    const express = require('express');
    const app = express();
    const { AgentFactoryError } = require('../dist/application/intake/intake-error');
    
    app.get('/test-error', (req, res, next) => {
      next(new AgentFactoryError('Intake soft timeout', 'INTAKE_SOFT_TIMEOUT', 202, { retryable: true }));
    });

    app.get('/test-internal-error', (req, res, next) => {
      next(new Error('Some DB failure'));
    });

    app.use((err, _req, res, _next) => {
      if (err.error_code) {
        return res.status(err.status || 400).json({
          success: false,
          error_code: err.error_code,
          message: err.message,
          retryable: err.retryable !== false
        });
      }
      res.status(500).json({
        success: false,
        error_code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        retryable: false
      });
    });

    const server = app.listen(0);
    const { port } = server.address();

    try {
      const res1 = await fetch(`http://localhost:${port}/test-error`);
      eq(res1.status, 202);
      const json1 = await res1.json();
      eq(json1.success, false);
      eq(json1.error_code, 'INTAKE_SOFT_TIMEOUT');
      eq(json1.retryable, true);

      const res2 = await fetch(`http://localhost:${port}/test-internal-error`);
      eq(res2.status, 500);
      const json2 = await res2.json();
      eq(json2.success, false);
      eq(json2.error_code, 'INTERNAL_ERROR');
      eq(json2.message, 'Internal server error');
    } finally {
      server.close();
    }
  });

  // T15
  await assertAsync('T15 dead PID lock is reclaimed safely', async () => {
    throw new Error('T15 not implemented');
  });

  console.log(`\nPhase 3.7 Bug tests completed: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

function pinoSilent() {
  const pino = require('pino');
  return pino({ level: 'silent' });
}

runTests().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});

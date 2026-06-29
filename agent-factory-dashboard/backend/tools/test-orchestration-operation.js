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

  // Test 7: ADU latest metadata and operation final state convergence (E2E Process Integration)
  await asyncAssert('ADU latest metadata and operation state converges via E2E Orchestrator subprocess', async () => {
    store.clear();

    const aduId = 'ADU-CONVERGE-E2E';

    // 1. Setup paths
    const runScriptPath = path.join(__dirname, '..', '..', '..', 'scripts', 'hermes_agent_run.py');
    const runScriptBakPath = runScriptPath + '.bak';

    // 2. Initialize mock files under the active test registry
    fs.writeFileSync(
      path.join(registryDir, 'adu.json'),
      JSON.stringify({
        version: 1,
        adus: [
          {
            id: aduId,
            state: 'created',
            project_id: 'smoke-proj',
            repo_path: testWorkspace,
            artifacts: [],
            latest_agent: 'requirement-analyst',
            latest_run_timestamp: '20260621-110000'
          }
        ]
      }, null, 2) + '\n'
    );

    fs.writeFileSync(
      path.join(registryDir, 'agents.json'),
      JSON.stringify({
        agents: {
          'requirement-analyst': {
            description: 'Requirement analyst agent',
            prompt: '.ai-agent/prompts/analyst.md'
          }
        }
      }, null, 2) + '\n'
    );

    fs.writeFileSync(
      path.join(registryDir, 'runs.json'),
      JSON.stringify({
        version: 1,
        runs: []
      }, null, 2) + '\n'
    );

    // Create prompt file in repo
    const promptsDir = path.join(testWorkspace, '.ai-agent', 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, 'analyst.md'), 'Mock prompt template', 'utf8');

    // 3. Create the operation in the store
    const op = store.createOperation({
      targetType: 'adu',
      targetId: aduId,
      mode: 'step',
    });

    // 4. Back up and replace hermes_agent_run.py
    fs.renameSync(runScriptPath, runScriptBakPath);

    try {
      const mockRunCode = `#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
reg_dir_env = os.environ.get("AGENT_FACTORY_REGISTRY_DIR")
if not reg_dir_env:
    sys.exit("AGENT_FACTORY_REGISTRY_DIR not set")
reg_dir = Path(reg_dir_env).resolve()

# Update adu.json to simulated converged state
adu_path = reg_dir / "adu.json"
adu_data = json.loads(adu_path.read_text(encoding="utf-8"))
for adu in adu_data.get("adus", []):
    if adu["id"] == "ADU-CONVERGE-E2E":
        adu["state"] = "analysis_review"
        adu["latest_agent"] = "requirement-analyst"
        adu["latest_run_timestamp"] = "20260621-120000"
        adu["last_result"] = "success"
adu_path.write_text(json.dumps(adu_data, indent=2), encoding="utf-8")

# Write to runs.json
runs_path = reg_dir / "runs.json"
runs_data = {"version": 1, "runs": [{
    "timestamp": "20260621-120000",
    "adu_id": "ADU-CONVERGE-E2E",
    "agent": "requirement-analyst",
    "result": "success",
    "returncode": 0
}]}
runs_path.write_text(json.dumps(runs_data, indent=2), encoding="utf-8")

# Print success JSON expected by orchestrator
print(json.dumps({
    "result": "success",
    "next_state": "analysis_review",
    "token_usage": {"inputTokens": 100, "outputTokens": 50}
}))
`;
      fs.writeFileSync(runScriptPath, mockRunCode, { mode: 0o755, encoding: 'utf8' });

      // 5. Spawn the orchestrator process
      const { spawn } = require('child_process');
      const orchestratorScriptPath = path.join(__dirname, '..', '..', '..', 'scripts', 'hermes_agent_orchestrator.py');
      const env = { ...process.env, AGENT_FACTORY_REGISTRY_DIR: registryDir };

      const child = spawn('python3', [
        orchestratorScriptPath,
        '--adu', aduId,
        '--mode', 'step',
        '--operation-id', op.id,
        '--project', 'smoke-proj',
        '--repo-root', testWorkspace
      ], { env });

      let lockFileCreatedDuringExecution = false;
      const lockFilePath = path.join(registryDir, 'registry.lock');

      // Check lock file existence periodically
      const lockCheckInterval = setInterval(() => {
        if (fs.existsSync(lockFilePath)) {
          lockFileCreatedDuringExecution = true;
        }
      }, 5);

      let stdoutData = '';
      child.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
        let idx = stdoutData.indexOf('\n');
        while (idx !== -1) {
          const line = stdoutData.substring(0, idx).trim();
          stdoutData = stdoutData.substring(idx + 1);
          if (line) {
            try {
              const parsed = JSON.parse(line);
              store.addEvent(op.id, {
                type: parsed.event || parsed.type || 'orchestrator_event',
                payload: parsed,
                stream: 'stdout',
                message: parsed.message || ''
              });
              const updates = mapOrchestratorEvent(parsed);
              if (Object.keys(updates).length > 0) {
                store.updateOperation(op.id, updates);
              }
            } catch (_) {}
          }
          idx = stdoutData.indexOf('\n');
        }
      });

      child.stderr.on('data', (chunk) => {
        console.error(`Orchestrator stderr: ${chunk.toString()}`);
      });

      const exitCode = await new Promise((resolve) => {
        child.on('close', (code) => {
          clearInterval(lockCheckInterval);
          resolve(code);
        });
      });

      // Update operation status to match close handler logic
      const { FileAgentFactoryRepository } = require('../dist/infrastructure/file-agent-factory-repository');
      const { AgentFactoryMonitorUseCase } = require('../dist/application/agent-factory-monitor');
      const pino = require('pino');
      const logger = pino({ level: 'silent' });
      const repo = new FileAgentFactoryRepository(testWorkspace, 100000, logger);
      const monitor = new AgentFactoryMonitorUseCase(repo);

      let finalState = 'created';
      try {
        const updatedAdu = await repo.getAduById(aduId);
        if (updatedAdu) finalState = updatedAdu.state;
      } catch (_) {}

      store.updateOperation(op.id, {
        status: exitCode === 0 ? 'completed' : 'failed',
        result: exitCode === 0 ? 'success' : 'failed',
        exitCode,
        finalState
      });

      // 6. Assertions
      if (exitCode !== 0) {
        throw new Error(`Orchestrator process exited with non-zero code ${exitCode}`);
      }

      // Assert lock was unlinked
      if (fs.existsSync(lockFilePath)) {
        throw new Error('Expected registry.lock file to be unlinked after execution');
      }

      // Assert operation store updated correctly
      const finalOp = store.getOperation(op.id);
      if (finalOp.status !== 'completed') {
        throw new Error(`Expected operation status completed, got: ${finalOp.status}`);
      }
      if (finalOp.result !== 'success') {
        throw new Error(`Expected operation result success, got: ${finalOp.result}`);
      }
      if (finalOp.finalState !== 'analysis_review') {
        throw new Error(`Expected operation finalState analysis_review, got: ${finalOp.finalState}`);
      }

      // Assert ADU metadata converged in returned view
      const dashboard = await monitor.getDashboard();
      const aduView = dashboard.adus.find(a => a.id === aduId);
      if (!aduView) throw new Error('Expected to find converged ADU in dashboard view');
      if (aduView.state !== 'analysis_review') {
        throw new Error(`Expected ADU state analysis_review, got: ${aduView.state}`);
      }
      if (aduView.latest_agent !== 'requirement-analyst') {
        throw new Error(`Expected ADU latest_agent requirement-analyst, got: ${aduView.latest_agent}`);
      }
      if (aduView.latest_run_timestamp !== '20260621-120000') {
        throw new Error(`Expected ADU latest_run_timestamp 20260621-120000, got: ${aduView.latest_run_timestamp}`);
      }
    } finally {
      // 7. Clean up bak file and restore original hermes_agent_run.py
      try {
        if (fs.existsSync(runScriptBakPath)) {
          if (fs.existsSync(runScriptPath)) {
            fs.unlinkSync(runScriptPath);
          }
          fs.renameSync(runScriptBakPath, runScriptPath);
        }
      } catch (_) {}
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

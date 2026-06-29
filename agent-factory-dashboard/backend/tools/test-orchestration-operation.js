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

    // 1. Setup E2E isolated scripts directory
    const testScriptsDir = path.join(testWorkspace, 'scripts');
    fs.mkdirSync(testScriptsDir, { recursive: true });

    // Copy production scripts needed by test workspace
    const prodScriptsDir = path.join(__dirname, '..', '..', '..', 'scripts');
    fs.copyFileSync(
      path.join(prodScriptsDir, 'hermes_agent_orchestrator.py'),
      path.join(testScriptsDir, 'hermes_agent_orchestrator.py')
    );
    fs.copyFileSync(
      path.join(prodScriptsDir, 'registry_lock.py'),
      path.join(testScriptsDir, 'registry_lock.py')
    );
    fs.copyFileSync(
      path.join(prodScriptsDir, 'context_budget.py'),
      path.join(testScriptsDir, 'context_budget.py')
    );

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

    // 4. Write mock hermes_agent_run.py to testScriptsDir
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
    fs.writeFileSync(path.join(testScriptsDir, 'hermes_agent_run.py'), mockRunCode, { mode: 0o755, encoding: 'utf8' });

    // 5. Spawn the orchestrator process from testScriptsDir
    const { spawn } = require('child_process');
    const orchestratorScriptPath = path.join(testScriptsDir, 'hermes_agent_orchestrator.py');
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
    const runLockFilePath = path.join(testWorkspace, '.ai-agent', 'locks', 'smoke-proj__ADU-CONVERGE-E2E.lock');

    // Check lock file existence periodically during run
    const lockCheckInterval = setInterval(() => {
      if (fs.existsSync(runLockFilePath)) {
        lockFileCreatedDuringExecution = true;
      }
    }, 5);

    const {
      handleOrchestratorStdoutLine,
      handleOrchestratorStderrLine,
      handleOrchestratorProcessClose
    } = require('../dist/application/orchestration-operation-store');

    let stdoutData = '';
    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
      let idx = stdoutData.indexOf('\n');
      while (idx !== -1) {
        const line = stdoutData.substring(0, idx).trim();
        stdoutData = stdoutData.substring(idx + 1);
        if (line) {
          handleOrchestratorStdoutLine(op.id, line, store);
        }
        idx = stdoutData.indexOf('\n');
      }
    });

    let stderrData = '';
    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
      let idx = stderrData.indexOf('\n');
      while (idx !== -1) {
        const line = stderrData.substring(0, idx).trim();
        stderrData = stderrData.substring(idx + 1);
        if (line) {
          handleOrchestratorStderrLine(op.id, line, store);
        }
        idx = stderrData.indexOf('\n');
      }
    });

    const exitCode = await new Promise((resolve) => {
      child.on('close', (code) => {
        clearInterval(lockCheckInterval);
        resolve(code);
      });
    });

    // 6. Flush remaining buffers using the shared production handlers
    if (stdoutData.trim()) {
      handleOrchestratorStdoutLine(op.id, stdoutData.trim(), store);
    }
    if (stderrData.trim()) {
      handleOrchestratorStderrLine(op.id, stderrData.trim(), store);
    }

    // Call production process close handler
    const { FileAgentFactoryRepository } = require('../dist/infrastructure/file-agent-factory-repository');
    const { AgentFactoryMonitorUseCase } = require('../dist/application/agent-factory-monitor');
    const pino = require('pino');
    const logger = pino({ level: 'silent' });
    const repo = new FileAgentFactoryRepository(testWorkspace, 100000, logger);
    const monitor = new AgentFactoryMonitorUseCase(repo);

    await handleOrchestratorProcessClose(op.id, exitCode, aduId, repo, store);

    // 7. Assertions
    const finalOp = store.getOperation(op.id);
    const dashboard = await monitor.getDashboard();

    if (exitCode !== 0) {
      throw new Error(`Orchestrator process exited with non-zero code ${exitCode}`);
    }

    // Assert lock was created during run
    if (!lockFileCreatedDuringExecution) {
      throw new Error('Expected Orchestrator run lock to be created during execution');
    }

    // Assert lock was unlinked
    if (fs.existsSync(runLockFilePath)) {
      throw new Error('Expected Orchestrator run lock to be unlinked after execution');
    }

    // Assert operation store updated correctly using shared production rules
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
  });

  // Test 8: Monitor does not roll back ADU view when runs snapshot is older than ADU timestamp
  await asyncAssert('Monitor does not roll back ADU view for stale run snapshot', async () => {
    // 1. Setup mock registry files with ADU having a newer timestamp than the run
    fs.writeFileSync(
      path.join(registryDir, 'adu.json'),
      JSON.stringify({
        version: 1,
        adus: [
          {
            id: 'ADU-STALE-RUN',
            state: 'implemented',
            project_id: 'default-open5gs',
            repo_path: '/tmp',
            artifacts: [],
            latest_agent: 'developer',
            latest_run_timestamp: '20260621-150000',
            last_result: 'success'
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
            timestamp: '20260621-120000', // Older than ADU
            adu_id: 'ADU-STALE-RUN',
            agent: 'testwriter',
            result: 'success',
            returncode: 0
          }
        ]
      }, null, 2) + '\n'
    );

    const { FileAgentFactoryRepository } = require('../dist/infrastructure/file-agent-factory-repository');
    const { AgentFactoryMonitorUseCase } = require('../dist/application/agent-factory-monitor');
    const pino = require('pino');
    const logger = pino({ level: 'silent' });
    const repo = new FileAgentFactoryRepository(testWorkspace, 100000, logger);
    const monitor = new AgentFactoryMonitorUseCase(repo);

    const dashboard = await monitor.getDashboard();
    const aduView = dashboard.adus.find(a => a.id === 'ADU-STALE-RUN');
    if (!aduView) throw new Error('Expected to find ADU-STALE-RUN in dashboard');

    // Assert it kept the ADU metadata and did not roll back to the run
    if (aduView.latest_agent !== 'developer') {
      throw new Error(`Expected latest_agent to remain developer, got: ${aduView.latest_agent}`);
    }
    if (aduView.latest_run_timestamp !== '20260621-150000') {
      throw new Error(`Expected latest_run_timestamp to remain 20260621-150000, got: ${aduView.latest_run_timestamp}`);
    }
    if (aduView.last_result !== 'success') {
      throw new Error(`Expected last_result to remain success, got: ${aduView.last_result}`);
    }
  });

  // Test 9: Shared handleOrchestratorProcessClose branch coverage
  await asyncAssert('handleOrchestratorProcessClose updates operation correctly across all exit status scenarios', async () => {
    const { handleOrchestratorProcessClose } = require('../dist/application/orchestration-operation-store');

    // Mock repository matching the signature needed by the close handler
    const mockRepo = {
      stateMap: new Map(),
      async getAduById(id) {
        return this.stateMap.has(id) ? { state: this.stateMap.get(id) } : null;
      }
    };

    // Scenario A: code = 20 (waiting_human status)
    {
      const op = store.createOperation({ targetType: 'adu', targetId: 'ADU-C1', mode: 'step' });
      mockRepo.stateMap.set('ADU-C1', 'analyzed');
      await handleOrchestratorProcessClose(op.id, 20, 'ADU-C1', mockRepo, store);
      const updated = store.getOperation(op.id);
      if (updated.status !== 'waiting_human') throw new Error(`Code 20: expected status waiting_human, got ${updated.status}`);
      if (updated.result !== 'human_gate') throw new Error(`Code 20: expected result human_gate, got ${updated.result}`);
      if (updated.exitCode !== 20) throw new Error(`Code 20: expected exitCode 20, got ${updated.exitCode}`);
      if (updated.finalState !== 'analyzed') throw new Error(`Code 20: expected finalState analyzed, got ${updated.finalState}`);
    }

    // Scenario B: finalState = 'human_gate' (waiting_human status)
    {
      const op = store.createOperation({ targetType: 'adu', targetId: 'ADU-C2', mode: 'step' });
      mockRepo.stateMap.set('ADU-C2', 'human_gate');
      await handleOrchestratorProcessClose(op.id, 0, 'ADU-C2', mockRepo, store);
      const updated = store.getOperation(op.id);
      if (updated.status !== 'waiting_human') throw new Error(`finalState human_gate: expected status waiting_human, got ${updated.status}`);
      if (updated.result !== 'human_gate') throw new Error(`finalState human_gate: expected result human_gate, got ${updated.result}`);
      if (updated.exitCode !== 0) throw new Error(`finalState human_gate: expected exitCode 0, got ${updated.exitCode}`);
      if (updated.finalState !== 'human_gate') throw new Error(`finalState human_gate: expected finalState human_gate, got ${updated.finalState}`);
    }

    // Scenario C: non-zero code (failed status)
    {
      const op = store.createOperation({ targetType: 'adu', targetId: 'ADU-C3', mode: 'step' });
      mockRepo.stateMap.set('ADU-C3', 'created');
      await handleOrchestratorProcessClose(op.id, 1, 'ADU-C3', mockRepo, store);
      const updated = store.getOperation(op.id);
      if (updated.status !== 'failed') throw new Error(`Non-zero code: expected status failed, got ${updated.status}`);
      if (updated.result !== 'failed') throw new Error(`Non-zero code: expected result failed, got ${updated.result}`);
      if (updated.exitCode !== 1) throw new Error(`Non-zero code: expected exitCode 1, got ${updated.exitCode}`);
    }

    // Scenario D: null code (failed status with fallback exitCode -1)
    {
      const op = store.createOperation({ targetType: 'adu', targetId: 'ADU-C4', mode: 'step' });
      mockRepo.stateMap.set('ADU-C4', 'created');
      await handleOrchestratorProcessClose(op.id, null, 'ADU-C4', mockRepo, store);
      const updated = store.getOperation(op.id);
      if (updated.status !== 'failed') throw new Error(`Null code: expected status failed, got ${updated.status}`);
      if (updated.result !== 'failed') throw new Error(`Null code: expected result failed, got ${updated.result}`);
      if (updated.exitCode !== -1) throw new Error(`Null code: expected exitCode -1, got ${updated.exitCode}`);
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

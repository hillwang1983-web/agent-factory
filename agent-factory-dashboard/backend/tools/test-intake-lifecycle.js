#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { IntakeGenerationService } = require('../dist/application/intake/intake-generation-service');

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

async function setupWorkspace() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-intake-lifecycle-'));
  const registryDir = path.join(tmpDir, '.ai-agent', 'registry');
  await fs.mkdir(registryDir, { recursive: true });

  const draftsRegistry = {
    version: 1,
    drafts: []
  };
  await fs.writeFile(path.join(registryDir, 'intake-drafts.json'), JSON.stringify(draftsRegistry, null, 2));
  await fs.writeFile(path.join(registryDir, 'intake-operations.json'), JSON.stringify({ version: 1, operations: [] }, null, 2));

  const scriptsDir = path.join(tmpDir, 'scripts');
  await fs.mkdir(scriptsDir, { recursive: true });

  const getRegistryPath = async () => path.join(registryDir, 'intake-drafts.json');
  const getOpsPath = () => path.join(registryDir, 'intake-operations.json');

  const service = new IntakeGenerationService(tmpDir, getRegistryPath, getOpsPath);

  return { tmpDir, registryDir, scriptsDir, service, getRegistryPath, getOpsPath };
}

async function addDraftMeta(registryDir, draftId, repoPath) {
  const regPath = path.join(registryDir, 'intake-drafts.json');
  const reg = JSON.parse(await fs.readFile(regPath, 'utf-8'));
  reg.drafts.push({
    draft_id: draftId,
    project_id: 'p1',
    repo_path: repoPath,
    draft_path: `.ai-agent/intake/${draftId}/draft.json`,
    report_path: `.ai-agent/intake/${draftId}/intake-report.md`,
    status: 'created',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  await fs.writeFile(regPath, JSON.stringify(reg, null, 2), 'utf-8');
}

async function runTests() {
  console.log('Running Unified Intake Lifecycle Tests...');

  // T02 & T03: Soft timeout & process completed but hangs, resulting in draft_ready
  await assertAsync('T02 & T03: soft timeout lets process continue, completed draft ready despite hanging process', async () => {
    const { tmpDir, registryDir, scriptsDir, service, getRegistryPath, getOpsPath } = await setupWorkspace();
    const draftId = 'DRAFT-t02t03';
    await addDraftMeta(registryDir, draftId, tmpDir);

    // Mock script: writes draft.json and intake-report.md in 200ms, then sleeps forever
    const intakeDir = path.join(tmpDir, '.ai-agent', 'intake', draftId);
    await fs.mkdir(intakeDir, { recursive: true });

    await fs.writeFile(
      path.join(scriptsDir, 'hermes_agent_run.py'),
      `import sys
import time
import json
import pathlib

# sleep a bit
time.sleep(0.2)

# write files
intake_dir = pathlib.Path(".ai-agent/intake/${draftId}")
(intake_dir / "draft.json").write_text(json.dumps({"title": "Mock Title", "goal": "Mock Goal"}), encoding="utf-8")
(intake_dir / "intake-report.md").write_text("Mock Report", encoding="utf-8")

# sleep forever
time.sleep(10)
sys.exit(0)
`
    );

    // Set short soft timeout
    process.env.INTAKE_TIMEOUT_MS = '100'; // 100ms
    process.env.INTAKE_HARD_TIMEOUT_MS = '1000'; // 1s

    const op = await service.start(draftId);
    eq(op.status, 'generating');

    let threw = false;
    try {
      // wait with short timeout
      await service.wait(draftId, 100);
    } catch (err) {
      threw = true;
      eq(err.error_code, 'INTAKE_SOFT_TIMEOUT');
    }
    eq(threw, true, 'Expected wait to throw INTAKE_SOFT_TIMEOUT');

    // Wait for the hard timeout to trigger validation and terminate process
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const finalOp = await service.wait(draftId, 2000).then(() => service.start(draftId)).catch(() => service.start(draftId));
    eq(finalOp.status, 'draft_ready');
    eq(finalOp.title, 'Mock Title');

    // Clean env
    delete process.env.INTAKE_TIMEOUT_MS;
    delete process.env.INTAKE_HARD_TIMEOUT_MS;
  });

  // T04: Hard timeout reaches, no files, transitions to generation_failed
  await assertAsync('T04: hard timeout triggers SIGTERM/SIGKILL and fails the operation', async () => {
    const { tmpDir, registryDir, scriptsDir, service } = await setupWorkspace();
    const draftId = 'DRAFT-t04';
    await addDraftMeta(registryDir, draftId, tmpDir);

    await fs.writeFile(
      path.join(scriptsDir, 'hermes_agent_run.py'),
      `import time
import sys
time.sleep(10)
sys.exit(0)
`
    );

    process.env.INTAKE_TIMEOUT_MS = '50';
    process.env.INTAKE_HARD_TIMEOUT_MS = '150';

    await service.start(draftId);

    // Wait for hard timeout to kill and validate
    await new Promise((resolve) => setTimeout(resolve, 500));

    const record = await service.start(draftId);
    eq(record.status, 'generation_failed');
    eq(record.error_code, 'INTAKE_OUTPUT_INVALID');

    delete process.env.INTAKE_TIMEOUT_MS;
    delete process.env.INTAKE_HARD_TIMEOUT_MS;
  });

  // T05: Terminal state protection (immutable draft_ready)
  await assertAsync('T05: late error or timeout cannot overwrite draft_ready terminal state', async () => {
    const { tmpDir, registryDir, scriptsDir, service } = await setupWorkspace();
    const draftId = 'DRAFT-t05';
    await addDraftMeta(registryDir, draftId, tmpDir);

    // Mock script: writes files immediately and exits
    const intakeDir = path.join(tmpDir, '.ai-agent', 'intake', draftId);
    await fs.mkdir(intakeDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptsDir, 'hermes_agent_run.py'),
      `import json
import pathlib
intake_dir = pathlib.Path(".ai-agent/intake/${draftId}")
(intake_dir / "draft.json").write_text(json.dumps({"title": "Mock Title", "goal": "Mock Goal"}), encoding="utf-8")
(intake_dir / "intake-report.md").write_text("Mock Report", encoding="utf-8")
`
    );

    await service.start(draftId);
    await service.wait(draftId, 2000);

    const recordBefore = await service.start(draftId);
    eq(recordBefore.status, 'draft_ready');

    // Attempting CAS update with an error state (mimicking a late process exit error)
    let threw = false;
    try {
      await service['updateStatus'](draftId, 'generation_failed', { error_message: 'Late error' });
    } catch (e) {
      threw = true;
    }
    // Note: in our implementation, if current is draft_ready and nextStatus is not draft_ready,
    // we return current without throwing, maintaining terminal status. Let's assert status remains draft_ready.
    const recordAfter = await service.start(draftId);
    eq(recordAfter.status, 'draft_ready');
  });

  // T06: Input validation - Invalid JSON
  await assertAsync('Input Validation: invalid JSON output results in INTAKE_OUTPUT_INVALID', async () => {
    const { tmpDir, registryDir, scriptsDir, service } = await setupWorkspace();
    const draftId = 'DRAFT-invalid-json';
    await addDraftMeta(registryDir, draftId, tmpDir);

    const intakeDir = path.join(tmpDir, '.ai-agent', 'intake', draftId);
    await fs.mkdir(intakeDir, { recursive: true });
    await fs.writeFile(
      path.join(scriptsDir, 'hermes_agent_run.py'),
      `import pathlib
intake_dir = pathlib.Path(".ai-agent/intake/${draftId}")
(intake_dir / "draft.json").write_text("{invalid-json", encoding="utf-8")
(intake_dir / "intake-report.md").write_text("Mock Report", encoding="utf-8")
`
    );

    await service.start(draftId);
    try {
      await service.wait(draftId, 2000);
    } catch (e) {}

    const record = await service.start(draftId);
    eq(record.status, 'generation_failed');
  });

  // Concurrency: Multiple start calls on same Draft ID spawns only one process
  await assertAsync('Idempotency: concurrent starts return same operation and do not spawn duplicate processes', async () => {
    const { tmpDir, registryDir, scriptsDir, service } = await setupWorkspace();
    const draftId = 'DRAFT-concurrent';
    await addDraftMeta(registryDir, draftId, tmpDir);

    await fs.writeFile(
      path.join(scriptsDir, 'hermes_agent_run.py'),
      `import time
time.sleep(2)
`
    );

    const op1 = await service.start(draftId);
    const op2 = await service.start(draftId);

    eq(op1.pid, op2.pid);
    eq(op1.started_at, op2.started_at);
  });

  // Recovery: Stale generating recovered properly
  await assertAsync('Recovery: dead processes in generating status are repaired during recover', async () => {
    const { tmpDir, registryDir, scriptsDir, service, getOpsPath } = await setupWorkspace();
    const draftId = 'DRAFT-recover-dead';
    await addDraftMeta(registryDir, draftId, tmpDir);

    const intakeDir = path.join(tmpDir, '.ai-agent', 'intake', draftId);
    await fs.mkdir(intakeDir, { recursive: true });
    await fs.writeFile(path.join(intakeDir, 'draft.json'), JSON.stringify({ title: 'Recovered Title', goal: 'Recovered Goal' }));
    await fs.writeFile(path.join(intakeDir, 'intake-report.md'), 'Recovered report');

    // Simulate operations entry in registry representing a dead PID
    const opsPath = getOpsPath();
    const opsReg = {
      version: 1,
      operations: [
        {
          draft_id: draftId,
          project_id: 'p1',
          status: 'generating',
          pid: 99999, // dummy dead pid
          process_group_id: 99999,
          started_at: new Date(Date.now() - 10000).toISOString(),
          last_progress_at: new Date().toISOString(),
          soft_deadline_at: null,
          hard_deadline_at: null,
          finished_at: null,
          artifact_completed_at: null,
          termination_reason: null,
          error_code: null,
          error_message: null
        }
      ]
    };
    await fs.writeFile(opsPath, JSON.stringify(opsReg, null, 2));

    // Force drafts status to generating
    const regPath = path.join(registryDir, 'intake-drafts.json');
    const draftsReg = JSON.parse(await fs.readFile(regPath, 'utf-8'));
    draftsReg.drafts[0].status = 'generating';
    await fs.writeFile(regPath, JSON.stringify(draftsReg, null, 2));

    await service.recover();

    const record = await service.start(draftId);
    eq(record.status, 'draft_ready');
    eq(record.title, 'Recovered Title');
  });

  console.log(`\nIntake Lifecycle tests completed: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});

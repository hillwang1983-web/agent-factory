#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const { OperatorOverrideService } = require('../dist/application/operator-override-service');

const ROOT = path.resolve(__dirname, '..', '..', '..');

let passed = 0, failed = 0;

async function assert(label, fn) {
  try { await fn(); console.log(`✅  ${label}`); passed++; }
  catch (e) { console.error(`❌  ${label}: ${e.message}`); failed++; }
}
async function assertThrows(label, fn, check) {
  await assert(label, async () => {
    let threw = null;
    try { await fn(); } catch (e) { threw = e; }
    if (!threw) throw new Error('Expected error but none thrown');
    if (check && !check(threw)) throw new Error(`Error mismatch: ${threw.message} (status=${threw.status})`);
  });
}

function setupTempWorkspace(options = {}) {
  const tmp = fs.mkdtempSync('/tmp/override-test-');
  const registry = path.join(tmp, '.ai-agent', 'registry');
  fs.mkdirSync(registry, { recursive: true });
  fs.writeFileSync(path.join(registry, 'adu.json'), JSON.stringify({ version: 1, adus: [{
    id: 'ADU-TEST', title: 'Test', goal: 'Test', state: 'acceptance_reviewed',
    repo_path: ROOT,
    retry_count: 0, max_retries: 3, risk: 'low', target_level: 'mvp',
    allowed_read_paths: [], allowed_write_paths: [], required_commands: [],
    required_evidence: [], artifacts: [], language: 'zh',
  }]}));
  fs.writeFileSync(path.join(registry, 'runs.json'), JSON.stringify({ version: 1, runs: [{
    timestamp: '20260621-102439', adu_id: 'ADU-TEST', agent: 'evidence',
    returncode: 1, result: 'failed', run_dir: '.ai-agent/runs/run-001',
    parsed_result: { result: 'failed', error: 'changed_files includes registry paths' },
    token_usage: { inputTokens: 5000, outputTokens: 300, totalTokens: 5300 },
  }]}));
  // Create a mock validator script that always exits 0
  const scriptsDir = path.join(tmp, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const mkMock = (name, code) => {
    const p = path.join(scriptsDir, name);
    fs.writeFileSync(p, '#!/usr/bin/env python3\nimport sys\n' + (code ? `print("${code}")\nsys.exit(0)` : 'sys.exit(0)'));
    fs.chmodSync(p, 0o755);
  };
  const sleepSeconds = Number(options.validatorSleepSeconds || 0);
  const evidenceScript = path.join(scriptsDir, 'validate_evidence_package.py');
  fs.writeFileSync(
    evidenceScript,
    '#!/usr/bin/env python3\nimport sys, time\n' +
      `time.sleep(${sleepSeconds})\n` +
      'print("PASS: mock evidence validator")\nsys.exit(0)\n',
  );
  fs.chmodSync(evidenceScript, 0o755);
  mkMock('validate_quality_report.py', 'PASS: mock quality report');
  // Also a mock that always fails for negative testing
  fs.writeFileSync(path.join(scriptsDir, 'validate_evidence_package_fail.py'),
    '#!/usr/bin/env python3\nimport sys\nprint("FAIL: mock validator")\nsys.exit(1)\n');
  fs.chmodSync(path.join(scriptsDir, 'validate_evidence_package_fail.py'), 0o755);
  return tmp;
}
function teardown(tmp) { fs.rmSync(tmp, { recursive: true, force: true }); }

function mutateAduFromAnotherProcess(tmp, delayMs, mutationSource) {
  const aduPath = path.join(tmp, '.ai-agent', 'registry', 'adu.json');
  const script = [
    `const fs = require('fs');`,
    `setTimeout(() => {`,
    `  const file = ${JSON.stringify(aduPath)};`,
    `  const data = JSON.parse(fs.readFileSync(file, 'utf8'));`,
    `  const adu = data.adus.find((item) => item.id === 'ADU-TEST');`,
    `  ${mutationSource}`,
    `  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\\n');`,
    `}, ${delayMs});`,
  ].join('\n');
  return spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mutation child exited ${code}`));
    });
  });
}

async function main() {
  console.log('── Operator Override Tests ──\n');

  await assertThrows('ADU not found returns 404', async () => {
    const tmp = setupTempWorkspace(); const svc = new OperatorOverrideService(tmp);
    try { await svc.applyOverride('ADU-MISSING', '20260621-102439', { operation: 'accept_validator_result', to_result: 'success', to_state: 'evidenced', reason_code: 'agent_declaration_mismatch', comment: 'x'.repeat(10) });
    } finally { teardown(tmp); }
  }, (e) => e.status === 404);

  await assertThrows('run not found returns 404', async () => {
    const tmp = setupTempWorkspace(); const svc = new OperatorOverrideService(tmp);
    try { await svc.applyOverride('ADU-TEST', 'MISSING-RUN', { operation: 'accept_validator_result', to_result: 'success', to_state: 'evidenced', reason_code: 'agent_declaration_mismatch', comment: 'x'.repeat(10) });
    } finally { teardown(tmp); }
  }, (e) => e.status === 404);

  await assert('validator failure returns 422 without registry mutation', async () => {
    const tmp = setupTempWorkspace(); const svc = new OperatorOverrideService(tmp);
    // Replace the mock validator with one that fails
    const scriptsDir = path.join(tmp, 'scripts');
    const failScript = path.join(scriptsDir, 'validate_evidence_package.py');
    fs.writeFileSync(failScript,
      '#!/usr/bin/env python3\nimport sys\nprint("FAIL: mock validator")\nsys.exit(1)\n');
    fs.chmodSync(failScript, 0o755);
    const registry = path.join(tmp, '.ai-agent', 'registry');
    const beforeAdu = fs.readFileSync(path.join(registry, 'adu.json'), 'utf-8');
    const beforeRuns = fs.readFileSync(path.join(registry, 'runs.json'), 'utf-8');
    try {
      let error = null;
      try {
        await svc.applyOverride('ADU-TEST', '20260621-102439', {
          operation: 'accept_validator_result',
          to_result: 'success',
          to_state: 'evidenced',
          reason_code: 'agent_declaration_mismatch',
          comment: 'x'.repeat(10),
        });
      } catch (caught) {
        error = caught;
      }
      if (!error || error.status !== 422) throw new Error('Expected validator failure with status 422');
      if (fs.readFileSync(path.join(registry, 'adu.json'), 'utf-8') !== beforeAdu) {
        throw new Error('ADU registry changed after validator failure');
      }
      if (fs.readFileSync(path.join(registry, 'runs.json'), 'utf-8') !== beforeRuns) {
        throw new Error('Runs registry changed after validator failure');
      }
      if (fs.existsSync(path.join(registry, 'operator-overrides.json'))) {
        throw new Error('Override audit was written after validator failure');
      }
    } finally {
      teardown(tmp);
    }
  });

  await assertThrows('run already success returns 409', async () => {
    const tmp = setupTempWorkspace();
    const registry = path.join(tmp, '.ai-agent', 'registry');
    const runs = JSON.parse(fs.readFileSync(path.join(registry, 'runs.json'), 'utf-8'));
    runs.runs[0].result = 'success';
    fs.writeFileSync(path.join(registry, 'runs.json'), JSON.stringify(runs));
    const svc = new OperatorOverrideService(tmp);
    try { await svc.applyOverride('ADU-TEST', '20260621-102439', { operation: 'accept_validator_result', to_result: 'success', to_state: 'evidenced', reason_code: 'agent_declaration_mismatch', comment: 'x'.repeat(10) });
    } finally { teardown(tmp); }
  }, (e) => e.status === 409);

  await assertThrows('invalid to_state returns 400', async () => {
    const tmp = setupTempWorkspace(); const svc = new OperatorOverrideService(tmp);
    try { await svc.applyOverride('ADU-TEST', '20260621-102439', { operation: 'accept_validator_result', to_result: 'success', to_state: 'created', reason_code: 'agent_declaration_mismatch', comment: 'x'.repeat(10) });
    } finally { teardown(tmp); }
  }, (e) => e.status === 400);

  await assert('successful override updates ADU, preserves original, writes audit', async () => {
    const tmp = setupTempWorkspace(); const svc = new OperatorOverrideService(tmp);
    const result = await svc.applyOverride('ADU-TEST', '20260621-102439', { operation: 'accept_validator_result', to_result: 'success', to_state: 'evidenced', reason_code: 'agent_declaration_mismatch', comment: 'x'.repeat(10) });
    if (!result.override_id) throw new Error('override_id not generated');
    if (result.adu_id !== 'ADU-TEST') throw new Error('adu_id mismatch');
    if (result.from_result !== 'failed') throw new Error('from_result not preserved');
    if (result.to_result !== 'success') throw new Error('to_result not success');
    if (result.actor !== 'operator') throw new Error('actor should be operator');
    const adus = JSON.parse(fs.readFileSync(path.join(tmp, '.ai-agent', 'registry', 'adu.json'), 'utf-8'));
    if (adus.adus.find(a => a.id === 'ADU-TEST').state !== 'evidenced') throw new Error('ADU state not updated');
    const runs = JSON.parse(fs.readFileSync(path.join(tmp, '.ai-agent', 'registry', 'runs.json'), 'utf-8'));
    const run = runs.runs.find(r => r.timestamp === '20260621-102439');
    if (run.original_result !== 'failed') throw new Error('original result not preserved');
    if (run.operator_override_id !== result.override_id) throw new Error('override_id not linked');
    const overrides = JSON.parse(fs.readFileSync(path.join(tmp, '.ai-agent', 'registry', 'operator-overrides.json'), 'utf-8'));
    if (overrides.overrides.length !== 1) throw new Error(`Expected 1 override`);
    // Verify validator was auto-executed (has real command and exit_code)
    const ov = overrides.overrides[0];
    if (!ov.validator || !ov.validator.command) throw new Error('validator command should be auto-populated');
    if (ov.validator.exit_code !== 0) throw new Error(`validator exit_code should be 0, got ${ov.validator.exit_code}`);
    teardown(tmp);
  });

  await assert('idempotent request returns existing override', async () => {
    const tmp = setupTempWorkspace(); const svc = new OperatorOverrideService(tmp);
    const r1 = await svc.applyOverride('ADU-TEST', '20260621-102439', { operation: 'accept_validator_result', to_result: 'success', to_state: 'evidenced', reason_code: 'agent_declaration_mismatch', comment: 'x'.repeat(10) });
    const r2 = await svc.applyOverride('ADU-TEST', '20260621-102439', { operation: 'accept_validator_result', to_result: 'success', to_state: 'evidenced', reason_code: 'agent_declaration_mismatch', comment: 'x'.repeat(10) });
    if (r1.override_id !== r2.override_id) throw new Error('Idempotent request should return same override');
    const overrides = JSON.parse(fs.readFileSync(path.join(tmp, '.ai-agent', 'registry', 'operator-overrides.json'), 'utf-8'));
    if (overrides.overrides.length !== 1) throw new Error(`Expected 1 override`);
    teardown(tmp);
  });

  await assert('concurrent identical requests create one override', async () => {
    const tmp = setupTempWorkspace({ validatorSleepSeconds: 0.15 });
    const svc = new OperatorOverrideService(tmp);
    const input = {
      operation: 'accept_validator_result',
      to_result: 'success',
      to_state: 'evidenced',
      reason_code: 'agent_declaration_mismatch',
      comment: 'x'.repeat(10),
    };
    const [first, second] = await Promise.all([
      svc.applyOverride('ADU-TEST', '20260621-102439', input),
      svc.applyOverride('ADU-TEST', '20260621-102439', input),
    ]);
    if (first.override_id !== second.override_id) {
      throw new Error('Concurrent idempotent requests returned different overrides');
    }
    const overrides = JSON.parse(
      fs.readFileSync(path.join(tmp, '.ai-agent', 'registry', 'operator-overrides.json'), 'utf-8'),
    );
    if (overrides.overrides.length !== 1) {
      throw new Error(`Expected one override, got ${overrides.overrides.length}`);
    }
    teardown(tmp);
  });

  await assert('concurrent unrelated ADU update is preserved after validator', async () => {
    const tmp = setupTempWorkspace({ validatorSleepSeconds: 0.25 });
    const svc = new OperatorOverrideService(tmp);
    const child = mutateAduFromAnotherProcess(
      tmp,
      50,
      `adu.concurrent_marker = 'preserve-me';`,
    );
    const childDone = waitForChild(child);
    try {
      await svc.applyOverride('ADU-TEST', '20260621-102439', {
        operation: 'accept_validator_result',
        to_result: 'success',
        to_state: 'evidenced',
        reason_code: 'agent_declaration_mismatch',
        comment: 'x'.repeat(10),
      });
      await childDone;
      const adus = JSON.parse(
        fs.readFileSync(path.join(tmp, '.ai-agent', 'registry', 'adu.json'), 'utf-8'),
      );
      const adu = adus.adus.find((item) => item.id === 'ADU-TEST');
      if (adu.concurrent_marker !== 'preserve-me') {
        throw new Error('Concurrent ADU update was overwritten by stale snapshot');
      }
    } finally {
      teardown(tmp);
    }
  });

  await assertThrows('target ADU state change during validation returns 409', async () => {
    const tmp = setupTempWorkspace({ validatorSleepSeconds: 0.25 });
    const svc = new OperatorOverrideService(tmp);
    const child = mutateAduFromAnotherProcess(
      tmp,
      50,
      `adu.state = 'human_gate';`,
    );
    const childDone = waitForChild(child);
    try {
      await svc.applyOverride('ADU-TEST', '20260621-102439', {
        operation: 'accept_validator_result',
        to_result: 'success',
        to_state: 'evidenced',
        reason_code: 'agent_declaration_mismatch',
        comment: 'x'.repeat(10),
      });
      await childDone;
    } finally {
      teardown(tmp);
    }
  }, (e) => e.status === 409);

  await assert('GET overrides returns filtered list', async () => {
    const tmp = setupTempWorkspace(); const svc = new OperatorOverrideService(tmp);
    await svc.applyOverride('ADU-TEST', '20260621-102439', { operation: 'accept_validator_result', to_result: 'success', to_state: 'evidenced', reason_code: 'agent_declaration_mismatch', comment: 'x'.repeat(10) });
    const overrides = await svc.getOverrides('ADU-TEST');
    if (overrides.length !== 1) throw new Error(`Expected 1 override`);
    teardown(tmp);
  });

  // ── Multi-agent tests ──
  function makeAgentWorkspace(agent) {
    const tmp = fs.mkdtempSync('/tmp/override-agent-');
    const registry = path.join(tmp, '.ai-agent', 'registry');
    fs.mkdirSync(registry, { recursive: true });
    const aduId = 'ADU-' + agent.toUpperCase().replace(/[^A-Z]/g, '');
    const toState = agent === 'code-reviewer' ? 'code_reviewed'
      : agent === 'acceptance-reviewer' ? 'acceptance_reviewed'
      : agent === 'buildfix-debugger' ? 'debugged'
      : agent === 'evidence' ? 'evidenced' : 'evidenced';
    fs.writeFileSync(path.join(registry, 'adu.json'), JSON.stringify({ version: 1, adus: [{
      id: aduId, title: 'Test ' + agent, goal: 'Test', state: agent === 'code-reviewer' ? 'implemented' : agent === 'acceptance-reviewer' ? 'debugged' : agent === 'buildfix-debugger' ? 'code_reviewed' : 'acceptance_reviewed',
      repo_path: tmp,
      retry_count: 0, max_retries: 3, risk: 'low', target_level: 'mvp',
      allowed_read_paths: [], allowed_write_paths: [], required_commands: ['echo ok'],
      required_evidence: [], artifacts: [], language: 'zh',
    }]}));
    const runDir = '.ai-agent/runs/run-' + agent;
    const fullRunDir = path.join(tmp, runDir);
    fs.mkdirSync(fullRunDir, { recursive: true });
    fs.writeFileSync(path.join(registry, 'runs.json'), JSON.stringify({ version: 1, runs: [{
      timestamp: '20260621-102439', adu_id: aduId, agent: agent,
      returncode: 1, result: 'failed', run_dir: runDir,
      parsed_result: { result: 'failed', error: 'quality gate rejected' },
      token_usage: { inputTokens: 5000, outputTokens: 300, totalTokens: 5300 },
    }]}));
    // Mock scripts
    const scriptsDir = path.join(tmp, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    const mkMock = (name) => {
      const p = path.join(scriptsDir, name);
      fs.writeFileSync(p, '#!/usr/bin/env python3\nimport sys\nprint("PASS: mock ' + name + '")\nsys.exit(0)\n');
      fs.chmodSync(p, 0o755);
    };
    mkMock('validate_quality_report.py');
    mkMock('validate_evidence_package.py');
    // For code-reviewer and buildfix: create verification-results.json
    if (agent === 'code-reviewer' || agent === 'buildfix-debugger') {
      const verDir = path.join(tmp, runDir);
      fs.writeFileSync(path.join(verDir, 'verification-results.json'),
        JSON.stringify({ version: 1, adu_id: aduId, run_id: 'run-' + agent,
          generated_by: 'agent-factory-runner',
          commands: [{ command: 'echo ok', policy_decision: 'allowed', exit_code: 0 }]
        }));
    }
    return { tmp, aduId, toState };
  }

  await assert('code-reviewer override runs quality gate with --run-dir', async () => {
    const { tmp, aduId, toState } = makeAgentWorkspace('code-reviewer'); const svc = new OperatorOverrideService(tmp);
    const r = await svc.applyOverride(aduId, '20260621-102439', { operation: 'accept_validator_result', to_result: 'success', to_state: toState, reason_code: 'agent_declaration_mismatch', comment: 'x'.repeat(10) });
    if (r.validator.exit_code !== 0) throw new Error(`code-reviewer validator exit ${r.validator.exit_code}`);
    if (!r.validator.command.includes('--run-dir')) throw new Error(`code-reviewer command missing --run-dir: ${r.validator.command}`);
    teardown(tmp);
  });

  await assert('acceptance-reviewer override runs quality gate', async () => {
    const { tmp, aduId, toState } = makeAgentWorkspace('acceptance-reviewer'); const svc = new OperatorOverrideService(tmp);
    const r = await svc.applyOverride(aduId, '20260621-102439', { operation: 'accept_validator_result', to_result: 'success', to_state: toState, reason_code: 'agent_declaration_mismatch', comment: 'x'.repeat(10) });
    if (r.validator.exit_code !== 0) throw new Error(`acceptance-reviewer validator exit ${r.validator.exit_code}`);
    teardown(tmp);
  });

  await assert('buildfix-debugger override reads verification-results.json', async () => {
    const { tmp, aduId, toState } = makeAgentWorkspace('buildfix-debugger'); const svc = new OperatorOverrideService(tmp);
    const r = await svc.applyOverride(aduId, '20260621-102439', { operation: 'accept_validator_result', to_result: 'success', to_state: toState, reason_code: 'agent_declaration_mismatch', comment: 'x'.repeat(10) });
    if (r.validator.exit_code !== 0) throw new Error(`buildfix validator exit ${r.validator.exit_code}`);
    if (!r.validator.output.includes('all 1 commands passed')) throw new Error(`buildfix output mismatch: ${r.validator.output}`);
    teardown(tmp);
  });

  await assertThrows('code-reviewer without verification-results.json returns 422', async () => {
    const { tmp, aduId, toState } = makeAgentWorkspace('code-reviewer');
    fs.unlinkSync(path.join(tmp, '.ai-agent', 'runs', 'run-code-reviewer', 'verification-results.json'));
    const svc = new OperatorOverrideService(tmp);
    try {
      await svc.applyOverride(aduId, '20260621-102439', {
        operation: 'accept_validator_result',
        to_result: 'success',
        to_state: toState,
        reason_code: 'agent_declaration_mismatch',
        comment: 'x'.repeat(10),
      });
    } finally {
      teardown(tmp);
    }
  }, (e) => e.status === 422);

  await assertThrows('buildfix-debugger without adu_id returns 422', async () => {
    const { tmp, aduId, toState } = makeAgentWorkspace('buildfix-debugger');
    const vrPath = path.join(tmp, '.ai-agent', 'runs', 'run-buildfix-debugger', 'verification-results.json');
    const vr = JSON.parse(fs.readFileSync(vrPath, 'utf-8'));
    delete vr.adu_id;
    fs.writeFileSync(vrPath, JSON.stringify(vr));
    const svc = new OperatorOverrideService(tmp);
    try {
      await svc.applyOverride(aduId, '20260621-102439', {
        operation: 'accept_validator_result',
        to_result: 'success',
        to_state: toState,
        reason_code: 'agent_declaration_mismatch',
        comment: 'x'.repeat(10),
      });
    } finally {
      teardown(tmp);
    }
  }, (e) => e.status === 422);

  await assertThrows('buildfix-debugger with empty commands returns 422', async () => {
    const { tmp, aduId, toState } = makeAgentWorkspace('buildfix-debugger');
    const vrPath = path.join(tmp, '.ai-agent', 'runs', 'run-buildfix-debugger', 'verification-results.json');
    const vr = JSON.parse(fs.readFileSync(vrPath, 'utf-8'));
    vr.commands = [];
    fs.writeFileSync(vrPath, JSON.stringify(vr));
    const svc = new OperatorOverrideService(tmp);
    try {
      await svc.applyOverride(aduId, '20260621-102439', {
        operation: 'accept_validator_result',
        to_result: 'success',
        to_state: toState,
        reason_code: 'agent_declaration_mismatch',
        comment: 'x'.repeat(10),
      });
    } finally {
      teardown(tmp);
    }
  }, (e) => e.status === 422);

  function makeDeveloperWorkspace(options = {}) {
    const tmp = fs.mkdtempSync('/tmp/override-developer-');
    const registry = path.join(tmp, '.ai-agent', 'registry');
    fs.mkdirSync(registry, { recursive: true });
    const aduId = 'ADU-DEV';
    fs.writeFileSync(path.join(registry, 'adu.json'), JSON.stringify({ version: 1, adus: [{
      id: aduId, title: 'Test Developer', goal: 'Test', state: 'designed',
      repo_path: tmp,
      retry_count: 0, max_retries: 3, risk: 'low', target_level: 'mvp',
      allowed_read_paths: ['webui/'], allowed_write_paths: ['webui/'], required_commands: [],
      required_evidence: [], artifacts: [], language: 'zh',
    }]}));
    const runDir = '.ai-agent/runs/run-developer';
    const fullRunDir = path.join(tmp, runDir);
    fs.mkdirSync(fullRunDir, { recursive: true });

    const deltaData = {
      created: ['webui/server/index.js'],
      modified: ['webui/client/app.js'],
      deleted: []
    };
    const deltaContent = JSON.stringify(deltaData);
    const crypto = require('crypto');
    const file_delta_sha256 = crypto.createHash('sha256').update(deltaContent).digest('hex');

    // Write run record
    fs.writeFileSync(path.join(registry, 'runs.json'), JSON.stringify({ version: 1, runs: [{
      timestamp: '20260621-102439', adu_id: aduId, agent: 'developer',
      returncode: 1, result: options.runResult || 'failed', run_dir: runDir,
      file_delta_sha256,
      parsed_result: {
        result: options.runResult || 'failed',
        error_code: options.errorCode || 'declared_changes_unverified',
        error: 'mtime mismatch'
      },
      token_usage: { inputTokens: 5000, outputTokens: 300, totalTokens: 5300 },
    }]}));

    // Write file-delta.json
    fs.writeFileSync(path.join(fullRunDir, 'file-delta.json'), deltaContent);

    return { tmp, aduId };
  }

  await assertThrows('amend with file not in delta returns 422', async () => {
    const { tmp, aduId } = makeDeveloperWorkspace();
    const svc = new OperatorOverrideService(tmp);
    try {
      await svc.applyOverride(aduId, '20260621-102439', {
        operation: 'amend_file_declaration',
        changed_files: ['webui/not-in-delta.js'],
        comment: 'x'.repeat(10)
      });
    } finally { teardown(tmp); }
  }, (e) => e.status === 422);

  await assertThrows('amend run with other error returns 409', async () => {
    const { tmp, aduId } = makeDeveloperWorkspace({ errorCode: 'something_else' });
    const svc = new OperatorOverrideService(tmp);
    try {
      await svc.applyOverride(aduId, '20260621-102439', {
        operation: 'amend_file_declaration',
        changed_files: ['webui/server/index.js'],
        comment: 'x'.repeat(10)
      });
    } finally { teardown(tmp); }
  }, (e) => e.status === 409);

  await assertThrows('amend already successful run returns 409', async () => {
    const { tmp, aduId } = makeDeveloperWorkspace({ runResult: 'success' });
    const svc = new OperatorOverrideService(tmp);
    try {
      await svc.applyOverride(aduId, '20260621-102439', {
        operation: 'amend_file_declaration',
        changed_files: ['webui/server/index.js'],
        comment: 'x'.repeat(10)
      });
    } finally { teardown(tmp); }
  }, (e) => e.status === 409);

  await assertThrows('amend without comment returns 400', async () => {
    const { tmp, aduId } = makeDeveloperWorkspace();
    const svc = new OperatorOverrideService(tmp);
    try {
      await svc.applyOverride(aduId, '20260621-102439', {
        operation: 'amend_file_declaration',
        changed_files: ['webui/server/index.js'],
        comment: ''
      });
    } finally { teardown(tmp); }
  }, (e) => e.status === 400);

  await assert('successful amend updates ADU, updates run changed_files and status to success', async () => {
    const { tmp, aduId } = makeDeveloperWorkspace();
    const svc = new OperatorOverrideService(tmp);
    try {
      const r = await svc.applyOverride(aduId, '20260621-102439', {
        operation: 'amend_file_declaration',
        changed_files: ['webui/server/index.js'],
        comment: 'comment text'
      });
      if (r.operation !== 'amend_file_declaration') throw new Error('operation mismatch');
      if (r.to_state !== 'implemented') throw new Error('to_state should be implemented');
      const adus = JSON.parse(fs.readFileSync(path.join(tmp, '.ai-agent', 'registry', 'adu.json'), 'utf-8'));
      if (adus.adus[0].state !== 'implemented') throw new Error('ADU state should be implemented');
      const runs = JSON.parse(fs.readFileSync(path.join(tmp, '.ai-agent', 'registry', 'runs.json'), 'utf-8'));
      if (runs.runs[0].result !== 'success') throw new Error('run result should be success');
      if (runs.runs[0].changed_files[0] !== 'webui/server/index.js') throw new Error('run changed_files should be updated');
    } finally { teardown(tmp); }
  });

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });

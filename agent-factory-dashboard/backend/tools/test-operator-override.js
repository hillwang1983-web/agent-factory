#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const pino = require('pino');

const { OperatorOverrideService } = require('../dist/application/operator-override-service');
const { FileAgentFactoryRepository } = require('../dist/infrastructure/file-agent-factory-repository');

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
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-operator-override-'));
  process.env.AGENT_FACTORY_WORKSPACE = tmpDir;

  const registryDir = path.join(tmpDir, '.ai-agent', 'registry');
  await fs.mkdir(registryDir, { recursive: true });

  const aduList = [
    {
      id: 'adu-1',
      title: 'Test ADU 1',
      state: 'human_gate',
      current_step: 3,
      current_phase: 'detail-designer',
      token_budget: {
        warning_ratio: 0.8,
        hard_limit: 100000
      }
    }
  ];

  await fs.writeFile(path.join(registryDir, 'adu.json'), JSON.stringify({ version: 1, adus: aduList }, null, 2));

  // --- Test 1: FORCE_STEP override ---
  await assertAsync('FORCE_STEP override updates state and records override', async () => {
    const service = OperatorOverrideService.getInstance();
    await service.applyOverride({
      adu_id: 'adu-1',
      action: 'FORCE_STEP',
      approved_by: 'admin-user',
      override_notes: 'Bypass design review',
      timestamp: new Date().toISOString(),
      payload: {
        target_state: 'designed',
        target_step: 4
      }
    });

    const repo = new FileAgentFactoryRepository(tmpDir, 1024 * 1024, pino({ level: 'silent' }));
    const adus = await repo.readAdus();
    const adu = adus.find(a => a.id === 'adu-1');
    eq(adu.state, 'designed', 'State should be updated to designed');
    eq(adu.current_step, 4, 'Current step should be 4');
    eq(adu.pre_gate_state, undefined, 'pre_gate_state should be cleared');

    // Verify operator-overrides.json was created and has the override
    const overridesPath = path.join(tmpDir, '.ai-agent', 'registry', 'operator-overrides.json');
    const overridesContent = JSON.parse(await fs.readFile(overridesPath, 'utf8'));
    eq(overridesContent.overrides.length, 1);
    eq(overridesContent.overrides[0].action, 'FORCE_STEP');
  });

  // --- Test 2: RESET_BUDGET override ---
  await assertAsync('RESET_BUDGET override updates token budget limit', async () => {
    const service = OperatorOverrideService.getInstance();
    await service.applyOverride({
      adu_id: 'adu-1',
      action: 'RESET_BUDGET',
      approved_by: 'admin-user',
      override_notes: 'Increase token budget',
      timestamp: new Date().toISOString(),
      payload: {
        warning_ratio: 0.9,
        hard_limit: 500000
      }
    });

    const repo = new FileAgentFactoryRepository(tmpDir, 1024 * 1024, pino({ level: 'silent' }));
    const adus = await repo.readAdus();
    const adu = adus.find(a => a.id === 'adu-1');
    eq(adu.token_budget.warning_ratio, 0.9, 'Warning ratio should be 0.9');
    eq(adu.token_budget.hard_limit, 500000, 'Hard limit should be 500000');
  });

  // Clean up
  await fs.rm(tmpDir, { recursive: true, force: true });

  console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

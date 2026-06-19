#!/usr/bin/env node
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ORCHESTRATOR = path.join(ROOT, 'scripts', 'hermes_epic_orchestrator.py');

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function runOrchestrator(epicId, mode, repoRoot, registryDir) {
  try {
    execFileSync('python3', [
      ORCHESTRATOR,
      '--epic', epicId,
      '--mode', mode,
      '--project', 'test-project',
      '--repo-root', repoRoot
    ], {
      env: {
        ...process.env,
        AGENT_FACTORY_REGISTRY_DIR: registryDir
      },
      stdio: 'pipe'
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, stderr: e.stderr?.toString() || e.stdout?.toString() || e.message };
  }
}

function main() {
  console.log('── Epic State Semantics and Materialization Tests ──\n');

  // Setup temporary directories
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-semantics-'));
  const registryDir = path.join(tmpBase, 'registry');
  const repoRoot = path.join(tmpBase, 'repo');

  fs.mkdirSync(registryDir, { recursive: true });
  fs.mkdirSync(repoRoot, { recursive: true });

  const epicId = 'EPIC-TEST-1';

  // 1. Write initial epics.json
  const initialEpics = {
    epics: [
      {
        id: epicId,
        project_id: 'test-project',
        state: 'split_required',
        created_at: new Date().toISOString()
      }
    ]
  };
  writeJSON(path.join(registryDir, 'epics.json'), initialEpics);

  // 2. Write split-plan.json in repo
  const splitPlan = {
    version: 1,
    epic_id: epicId,
    decision: 'split_required',
    reason: 'Test materialization',
    child_adus: [
      {
        id: 'ADU-TEST-101',
        title: 'Module A',
        goal: 'implement A',
        scope: 'src/module_a',
        allowed_write_paths: ['src/module_a/file.c'],
        required_commands: [],
        acceptance_summary: 'OK'
      },
      {
        id: 'ADU-TEST-102',
        title: 'Module B',
        goal: 'implement B',
        scope: 'src/module_b',
        allowed_write_paths: ['src/module_b/file.c'],
        required_commands: [],
        acceptance_summary: 'OK'
      }
    ],
    dependencies: [
      {
        from: 'ADU-TEST-101',
        to: 'ADU-TEST-102',
        semantics: 'prerequisite_to_dependent',
        reason: 'B depends on A'
      }
    ],
    acceptance_coverage: [
      { acceptance_id: 'OK', covered_by: ['ADU-TEST-102'] }
    ]
  };
  writeJSON(path.join(repoRoot, '.ai-agent', 'epics', epicId, 'split-plan.json'), splitPlan);

  // Test 1: Run orchestrator with --mode materialize
  assert('orchestrator materialize mode creates child ADUs and exits', () => {
    const res = runOrchestrator(epicId, 'materialize', repoRoot, registryDir);
    if (!res.ok) {
      throw new Error(`Orchestrator failed in materialize mode: ${res.stderr}`);
    }

    // Check adu.json
    const aduData = JSON.parse(fs.readFileSync(path.join(registryDir, 'adu.json'), 'utf-8'));
    if (aduData.adus.length !== 2) {
      throw new Error(`Expected 2 child ADUs to be materialized, got: ${aduData.adus.length}`);
    }

    const adu101 = aduData.adus.find(a => a.id === 'ADU-TEST-101');
    const adu102 = aduData.adus.find(a => a.id === 'ADU-TEST-102');

    if (!adu101 || !adu102) {
      throw new Error('Could not find materialized child ADUs in registry');
    }

    // Verify depends_on propagation
    if (!adu102.depends_on.includes('ADU-TEST-101')) {
      throw new Error(`Expected depends_on of ADU-TEST-102 to contain ADU-TEST-101, got: ${JSON.stringify(adu102.depends_on)}`);
    }

    // Check Epic state in registry is child_adus_created (NOT running!)
    const epicsData = JSON.parse(fs.readFileSync(path.join(registryDir, 'epics.json'), 'utf-8'));
    const epic = epicsData.epics.find(e => e.id === epicId);
    if (epic.state !== 'child_adus_created') {
      throw new Error(`Expected Epic state to be child_adus_created, got: ${epic.state}`);
    }
  });

  // Test 2: When ADUs are all created but no progress, aggregate returns child_adus_created
  assert('aggregate returns child_adus_created when child states are created with 0 runs', () => {
    // Run an inline python script to trigger aggregate_epic_state
    const pyScript = `
import sys
from pathlib import Path
sys.path.append('${path.join(ROOT, 'scripts')}')
import hermes_epic_orchestrator

import os
os.environ["AGENT_FACTORY_REGISTRY_DIR"] = '${registryDir}'
hermes_epic_orchestrator.REGISTRY = Path('${registryDir}')

epics_data = hermes_epic_orchestrator.load_json(Path('${registryDir}/epics.json'))
epic = epics_data["epics"][0]
new_state = hermes_epic_orchestrator.aggregate_epic_state(epic)
print(new_state)
`;
    const out = execFileSync('python3', ['-c', pyScript], { stdio: 'pipe' }).toString().trim();
    if (out !== 'child_adus_created') {
      throw new Error(`Expected aggregated state to be child_adus_created, got: ${out}`);
    }
  });

  // Test 3: When at least one ADU transitions out of created, state becomes child_adus_running
  assert('aggregate returns child_adus_running when a child transitions out of created', () => {
    // Manually modify adu.json to transition ADU-TEST-101 to 'analyzed'
    const aduPath = path.join(registryDir, 'adu.json');
    const aduData = JSON.parse(fs.readFileSync(aduPath, 'utf-8'));
    const adu101 = aduData.adus.find(a => a.id === 'ADU-TEST-101');
    adu101.state = 'analyzed';
    fs.writeFileSync(aduPath, JSON.stringify(aduData, null, 2));

    const pyScript = `
import sys
from pathlib import Path
sys.path.append('${path.join(ROOT, 'scripts')}')
import hermes_epic_orchestrator

import os
os.environ["AGENT_FACTORY_REGISTRY_DIR"] = '${registryDir}'
hermes_epic_orchestrator.REGISTRY = Path('${registryDir}')

epics_data = hermes_epic_orchestrator.load_json(Path('${registryDir}/epics.json'))
epic = epics_data["epics"][0]
new_state = hermes_epic_orchestrator.aggregate_epic_state(epic)
print(new_state)
`;
    const out = execFileSync('python3', ['-c', pyScript], { stdio: 'pipe' }).toString().trim();
    if (out !== 'child_adus_running') {
      throw new Error(`Expected aggregated state to be child_adus_running, got: ${out}`);
    }
  });

  // Clean up
  fs.rmSync(tmpBase, { recursive: true, force: true });

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  process.exit(failed > 0 ? 1 : 0);
}

main();

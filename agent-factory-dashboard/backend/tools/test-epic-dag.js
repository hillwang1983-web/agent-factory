#!/usr/bin/env node
/**
 * Integration tests for Epic DAG validation.
 * Tests split-plan validation and Epic state aggregation logic.
 */
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
const VALIDATE_SPLIT = path.join(ROOT, 'scripts', 'validate_epic_split_plan.py');
const VALIDATE_FLOW = path.join(ROOT, 'scripts', 'validate_epic_flow.py');
const VALIDATE_ACCEPTANCE = path.join(ROOT, 'scripts', 'validate_epic_acceptance.py');

function runValidator(script, jsonPath) {
  try {
    execFileSync('python3', [script, jsonPath], { stdio: 'pipe' });
    return { ok: true };
  } catch (e) {
    return { ok: false, stderr: e.stderr?.toString() || '' };
  }
}

function writeTempJSON(filename, data) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-dag-test-'));
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return { dir: tmpDir, path: filePath };
}

function cleanup(temp) {
  fs.rmSync(temp.dir, { recursive: true, force: true });
}

async function main() {
  console.log('── Epic DAG Tests ──\n');

  // Test 1: Valid split-plan passes
  assert('valid split-plan passes', () => {
    const plan = {
      version: 1,
      epic_id: 'EPIC-2026-0001',
      decision: 'split_required',
      reason: 'Cross-module requirement',
      child_adus: [
        { id: 'ADU-001', title: 'DBI', goal: 'Add model', scope: 'DBI only',
          allowed_write_paths: ['lib/dbi/file.c', 'lib/dbi/meson.build'], required_commands: ['make'], acceptance_summary: 'Tests pass' },
        { id: 'ADU-002', title: 'CLI', goal: 'Add CLI', scope: 'CLI only',
          allowed_write_paths: ['src/cli/'], required_commands: ['make'], acceptance_summary: 'CLI works' },
      ],
      dependencies: [{ from: 'ADU-001', to: 'ADU-002', semantics: 'prerequisite_to_dependent', reason: 'CLI needs DBI' }],
      acceptance_coverage: [
        { acceptance_id: 'CLI works', covered_by: ['ADU-002'] }
      ]
    };
    const tmp = writeTempJSON('split-plan.json', plan);
    const result = runValidator(VALIDATE_SPLIT, tmp.path);
    cleanup(tmp);
    if (!result.ok) throw new Error(`Expected pass, got: ${result.stderr}`);
  });

  // Test 2: Split-plan with cycle fails
  assert('split-plan with cycle fails', () => {
    const plan = {
      version: 1, epic_id: 'EPIC-X', decision: 'split_required',
      reason: 'Test', child_adus: [
        { id: 'A', title: 'A', goal: 'A', scope: 'A', allowed_write_paths: ['a/'], required_commands: ['make'], acceptance_summary: 'ok' },
        { id: 'B', title: 'B', goal: 'B', scope: 'B', allowed_write_paths: ['b/'], required_commands: ['make'], acceptance_summary: 'ok' },
      ],
      dependencies: [
        { from: 'A', to: 'B', reason: 'A->B' },
        { from: 'B', to: 'A', reason: 'B->A' },
      ],
    };
    const tmp = writeTempJSON('split-plan.json', plan);
    const result = runValidator(VALIDATE_SPLIT, tmp.path);
    cleanup(tmp);
    if (result.ok) throw new Error('Expected fail for cycle, but passed');
  });

  // Test 3: Dependency ref to non-existent ADU fails
  assert('dependency to non-existent child ADU fails', () => {
    const plan = {
      version: 1, epic_id: 'EPIC-X', decision: 'split_required',
      reason: 'Test', child_adus: [
        { id: 'A', title: 'A', goal: 'A', scope: 'A', allowed_write_paths: ['a/'], required_commands: ['make'], acceptance_summary: 'ok' },
      ],
      dependencies: [{ from: 'NONEXISTENT', to: 'A', reason: 'bad ref' }],
    };
    const tmp = writeTempJSON('split-plan.json', plan);
    const result = runValidator(VALIDATE_SPLIT, tmp.path);
    cleanup(tmp);
    if (result.ok) throw new Error('Expected fail for bad reference, but passed');
  });

  // Test 4: single_adu with >1 child fails
  assert('single_adu with >1 child ADU fails', () => {
    const plan = {
      version: 1, epic_id: 'EPIC-X', decision: 'single_adu',
      reason: 'Test', child_adus: [
        { id: 'A', title: 'A', goal: 'A', scope: 'A', allowed_write_paths: ['a/'], required_commands: ['make'], acceptance_summary: 'ok' },
        { id: 'B', title: 'B', goal: 'B', scope: 'B', allowed_write_paths: ['b/'], required_commands: ['make'], acceptance_summary: 'ok' },
      ],
      dependencies: [],
    };
    const tmp = writeTempJSON('split-plan.json', plan);
    const result = runValidator(VALIDATE_SPLIT, tmp.path);
    cleanup(tmp);
    if (result.ok) throw new Error('Expected fail for single_adu with 2 children, but passed');
  });

  // Test 5: split_required with <2 children fails
  assert('split_required with only 1 child fails', () => {
    const plan = {
      version: 1, epic_id: 'EPIC-X', decision: 'split_required',
      reason: 'Test', child_adus: [
        { id: 'A', title: 'A', goal: 'A', scope: 'A', allowed_write_paths: ['a/'], required_commands: ['make'], acceptance_summary: 'ok' },
      ],
      dependencies: [],
    };
    const tmp = writeTempJSON('split-plan.json', plan);
    const result = runValidator(VALIDATE_SPLIT, tmp.path);
    cleanup(tmp);
    if (result.ok) throw new Error('Expected fail for split_required with 1 child, but passed');
  });

  // Test 6: Valid system-flow passes
  assert('valid system-flow passes', () => {
    const flow = {
      version: 1, epic_id: 'EPIC-X',
      business_operations: [
        { id: 'OP-1', name: 'Suspend', entrypoints: ['CLI'], state_changes: ['DB update'], runtime_effects: ['Reject reg'] },
        { id: 'OP-QUERY', name: '查询状态', entrypoints: ['GET /status'], state_changes: [], runtime_effects: ['Return current status'] },
      ],
      module_flows: [
        { operation_id: 'OP-1', steps: [{ order: 1, module: 'DBI', path_candidates: ['lib/dbi/'], responsibility: 'Persist' }] },
      ],
      acceptance_points: ['Registration is rejected'],
      open_questions: [],
    };
    const tmp = writeTempJSON('system-flow.json', flow);
    const result = runValidator(VALIDATE_FLOW, tmp.path);
    cleanup(tmp);
    if (!result.ok) throw new Error(`Expected pass, got: ${result.stderr}`);
  });

  // Test 7: Empty business_operations fails
  assert('empty business_operations fails', () => {
    const flow = {
      version: 1, epic_id: 'EPIC-X',
      business_operations: [],
      acceptance_points: ['something'],
    };
    const tmp = writeTempJSON('system-flow.json', flow);
    const result = runValidator(VALIDATE_FLOW, tmp.path);
    cleanup(tmp);
    if (result.ok) throw new Error('Expected fail for empty business_operations, but passed');
  });

  // Test 8: Epic acceptance pass with all children evidenced
  assert('epic acceptance pass validated', () => {
    const acceptance = {
      version: 1, epic_id: 'EPIC-X',
      epic_acceptance_status: 'pass',
      evidenced_child_adus: ['ADU-001', 'ADU-002'],
      required_child_adus: ['ADU-001', 'ADU-002'],
      acceptance_points_covered: [{ point: 'Works', status: 'pass', evidence: 'test' }],
      unresolved_findings: [],
    };
    const tmp = writeTempJSON('epic-acceptance.json', acceptance);
    const result = runValidator(VALIDATE_ACCEPTANCE, tmp.path);
    cleanup(tmp);
    if (!result.ok) throw new Error(`Expected pass, got: ${result.stderr}`);
  });

  // Test 9: Pass with unresolved P1 fails
  assert('pass with unresolved P1 fails', () => {
    const acceptance = {
      version: 1, epic_id: 'EPIC-X',
      epic_acceptance_status: 'pass',
      evidenced_child_adus: ['ADU-001'],
      required_child_adus: ['ADU-001'],
      acceptance_points_covered: [{ point: 'Works', status: 'pass', evidence: 'test' }],
      unresolved_findings: [{ severity: 'P1', description: 'not fixed' }],
    };
    const tmp = writeTempJSON('epic-acceptance.json', acceptance);
    const result = runValidator(VALIDATE_ACCEPTANCE, tmp.path);
    cleanup(tmp);
    if (result.ok) throw new Error('Expected fail for pass with P1, but passed');
  });

  // Test 10 + 11: Run Python integration tests for orchestration closure
  // These exercise run_child_adu failure detection, step_epic blocked return,
  // and runner artifact-gating (not just direct validator calls).
  assert('orchestrator integration: child failure detected, artifact gating works', () => {
    const { execFileSync } = require('child_process');
    const integTest = path.join(ROOT, 'scripts', 'test_epic_orchestrator_integration.py');
    try {
      const out = execFileSync('python3', [integTest], {
        stdio: 'pipe',
        timeout: 30000,
      }).toString();
      if (!out.includes('Results: 4 passed, 0 failed')) {
        throw new Error(`Integration tests did not all pass:\n${out}`);
      }
    } catch (e) {
      if (e.stdout) throw new Error(e.stdout.toString());
      throw e;
    }
  });

  // Test 12: epic split pre-derivation rule matching multiple derived paths logs unique audits
  assert('epic split pre-derivation rule matching multiple derived paths logs unique audits', () => {
    const rules = {
      version: 1,
      rules: [
        {
          id: "multi-derive-rule",
          project_glob: "*",
          when_requested_path_matches: ["lib/app/*.c"],
          allow_derived_paths: ["lib/app/meson.build", "lib/app/ogs-app.h"],
          risk: "low",
          reason: "Multi-derived path test"
        }
      ]
    };
    const rulesTemp = writeTempJSON('path-derivation-rules.json', rules);

    const plan = {
      version: 1,
      epic_id: 'EPIC-MULTI-TEST',
      decision: 'split_required',
      reason: 'Multi-derived test',
      child_adus: [
        {
          id: 'ADU-001',
          title: 'Test',
          goal: 'Test multiple derived paths',
          scope: 'Testing scope',
          allowed_write_paths: ['lib/app/main.c'],
          allowed_read_paths: ['lib/app/meson.build'],
          required_commands: [],
          acceptance_summary: 'OK'
        },
        {
          id: 'ADU-002',
          title: 'Dummy',
          goal: 'Dummy goal',
          scope: 'Dummy scope',
          allowed_write_paths: ['lib/other/file.c'],
          allowed_read_paths: ['lib/other/meson.build'],
          required_commands: [],
          acceptance_summary: 'OK'
        }
      ],
      dependencies: [],
      acceptance_coverage: [
        { acceptance_id: 'OK', covered_by: ['ADU-001'] }
      ]
    };
    const planTemp = writeTempJSON('split-plan.json', plan);

    try {
      // Run validator with AGENT_FACTORY_RULES_PATH
      execFileSync('python3', [VALIDATE_SPLIT, planTemp.path], {
        env: {
          ...process.env,
          AGENT_FACTORY_RULES_PATH: rulesTemp.path
        },
        stdio: 'pipe'
      });

      // Load written back plan
      const updatedPlan = JSON.parse(fs.readFileSync(planTemp.path, 'utf-8'));
      const adu = updatedPlan.child_adus.find((a) => a.id === 'ADU-001');
      if (!adu) throw new Error('Child ADU-001 not found in updated plan');

      const expansions = adu.write_path_expansions || [];
      if (expansions.length !== 2) {
        throw new Error(`Expected exactly 2 write_path_expansions, got ${expansions.length}: ${JSON.stringify(expansions)}`);
      }

      // Check unique request IDs
      const reqIds = expansions.map((e) => e.request_id);
      const uniqueReqIds = [...new Set(reqIds)];
      if (uniqueReqIds.length !== 2) {
        throw new Error(`Expected request_ids to be unique, got: ${JSON.stringify(reqIds)}`);
      }

      // Check paths
      const paths = expansions.map((e) => e.requested_paths[0]);
      if (!paths.includes('lib/app/meson.build') || !paths.includes('lib/app/ogs-app.h')) {
        throw new Error(`Expected derived paths meson.build and ogs-app.h, got: ${JSON.stringify(paths)}`);
      }
    } finally {
      cleanup(rulesTemp);
      cleanup(planTemp);
    }
  });

  assert('epic split derives project-scoped paths from repository location', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-project-scope-'));
    const repoRoot = path.join(tempRoot, 'project-b');
    const planDir = path.join(repoRoot, '.ai-agent', 'epics', 'EPIC-SCOPE');
    fs.mkdirSync(planDir, { recursive: true });
    const planPath = path.join(planDir, 'split-plan.json');
    const rulesPath = path.join(tempRoot, 'rules.json');
    fs.writeFileSync(rulesPath, JSON.stringify({
      version: 1,
      rules: [{
        id: 'project-b-build-rule',
        project_glob: 'project-b',
        when_requested_path_matches: ['src/module/*.c'],
        allow_derived_paths: ['src/module/build.file'],
        risk: 'low',
        reason: 'Project B build registration',
      }],
    }));
    fs.writeFileSync(planPath, JSON.stringify({
      version: 1,
      epic_id: 'EPIC-SCOPE',
      decision: 'split_required',
      reason: 'Project-scoped derivation',
      child_adus: [
        {
          id: 'ADU-SCOPE-1',
          title: 'Scoped child',
          goal: 'Verify scoped derivation',
          scope: 'Module',
          allowed_write_paths: ['src/module/main.c'],
          allowed_read_paths: ['src/module/main.c'],
          required_commands: [],
          acceptance_summary: 'Derived build path is present',
        },
        {
          id: 'ADU-SCOPE-2',
          title: 'Sibling',
          goal: 'Keep split valid',
          scope: 'Sibling',
          allowed_write_paths: ['src/sibling/file.c'],
          allowed_read_paths: ['src/sibling/file.c'],
          required_commands: [],
          acceptance_summary: 'Sibling remains unchanged',
        },
      ],
      dependencies: [],
      acceptance_coverage: [
        { acceptance_id: 'Derived build path is present', covered_by: ['ADU-SCOPE-1'] },
      ],
    }));
    try {
      execFileSync('python3', [VALIDATE_SPLIT, planPath], {
        cwd: ROOT,
        env: { ...process.env, AGENT_FACTORY_RULES_PATH: rulesPath },
        stdio: 'pipe',
      });
      const updated = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
      const child = updated.child_adus.find((item) => item.id === 'ADU-SCOPE-1');
      if (!child.allowed_write_paths.includes('src/module/build.file')) {
        throw new Error(`Project-scoped derived path missing: ${JSON.stringify(child.allowed_write_paths)}`);
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

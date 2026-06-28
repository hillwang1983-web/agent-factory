const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const tests = [
  ['python3', ['scripts/test_agent_run_policy.py']],
  ['python3', ['scripts/test_command_policy.py']],
  ['python3', ['scripts/test_code_review_fact_gate.py']],
  ['python3', ['scripts/test_trusted_verification_policy.py']],
  ['python3', ['scripts/test_token_ledger.py']],
  ['python3', ['scripts/test_validate_rework_plan.py']],
  ['node', ['agent-factory-dashboard/backend/tools/test-operator-overrides.js']],
  ['node', ['agent-factory-dashboard/backend/tools/test-orchestration-operation.js']],
];

for (const [command, args] of tests) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env },
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('[PASS] ADU-1351 residual regression suite');

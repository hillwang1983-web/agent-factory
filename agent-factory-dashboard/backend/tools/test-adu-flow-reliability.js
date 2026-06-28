const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const checks = [
  ['completion', 'python3', ['scripts/test_agent_run_policy.py']],
  ['snapshot', 'python3', ['scripts/test_run_file_snapshot.py']],
  ['retry', 'python3', ['scripts/test_runner_retry.py']],
  ['flow', 'python3', ['scripts/test_phase2_flow_integrity.py']],
  ['monitor', 'node', ['agent-factory-dashboard/backend/tools/test-monitor-human-gate.js']],
  ['operation', 'node', ['agent-factory-dashboard/backend/tools/test-orchestration-operation.js']],
  ['override', 'node', ['agent-factory-dashboard/backend/tools/test-operator-overrides.js']],
];

for (const [name, command, args] of checks) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[FAIL] ${name}`);
    process.exit(result.status || 1);
  }
  console.log(`[PASS] ${name}`);
}

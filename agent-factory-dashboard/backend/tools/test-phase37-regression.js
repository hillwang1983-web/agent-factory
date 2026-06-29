const { spawnSync } = require('child_process');
const path = require('path');

const commands = [
  ['node', ['tools/test-phase37-bugs.js']],
  ['node', ['tools/test-intake-lifecycle.js']],
  ['node', ['tools/test-operation-events.js']],
  ['node', ['tools/test-monitor-human-gate.js']],
  ['node', ['tools/test-runtime-contract.js']],
  ['node', ['tools/test-epic-state-semantics.js']],
  ['python3', [path.resolve(__dirname, '../../../scripts/test_phase2_flow_integrity.py')]],
  ['python3', [path.resolve(__dirname, '../../../scripts/test_agent_run_policy.py')]],
  ['python3', [path.resolve(__dirname, '../../../scripts/test_context_payload_builder.py')]],
  ['python3', [path.resolve(__dirname, '../../../scripts/test_provider_auth_failure.py')]],
];

let failed = false;

for (const [command, args] of commands) {
  console.log(`\n🏃 Running: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
  if (result.status !== 0) {
    console.error(`❌ Command failed with code ${result.status}`);
    failed = true;
    process.exit(result.status || 1);
  }
}

if (failed) {
  console.error('\n❌ Some tests failed.');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed successfully!');
  process.exit(0);
}

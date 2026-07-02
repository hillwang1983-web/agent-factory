#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const backendRoot = path.resolve(__dirname, '..');
const generator = path.join(__dirname, 'generate-build-info.js');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-factory-build-info-'));
const outputPath = path.join(tempDir, 'build-info.json');
const expectedCommit = '0123456789abcdef0123456789abcdef01234567';

try {
  const result = spawnSync(process.execPath, [generator], {
    cwd: backendRoot,
    env: {
      ...process.env,
      AGENT_FACTORY_BUILD_COMMIT: expectedCommit,
      AGENT_FACTORY_BUILD_INFO_PATH: outputPath,
    },
    encoding: 'utf8',
  });

  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  assert.ok(fs.existsSync(outputPath), 'generator must create build-info.json');

  const info = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.strictEqual(info.build_commit, expectedCommit);
  assert.strictEqual(typeof info.build_time, 'string');
  assert.ok(!Number.isNaN(Date.parse(info.build_time)), 'build_time must be ISO-8601');
  assert.strictEqual(typeof info.dirty, 'boolean');

  console.log('[PASS] build info generator writes valid isolated metadata');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

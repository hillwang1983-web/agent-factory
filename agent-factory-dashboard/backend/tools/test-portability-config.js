const assert = require('assert');
const path = require('path');
const os = require('os');

process.env.AGENT_FACTORY_WORKSPACE = '';
process.env.AGENT_FACTORY_ALLOWED_PROJECT_ROOTS = '';
process.env.HERMES_CONFIG_PATH = '';

const { loadAppConfig } = require('../dist/config');

const config = loadAppConfig();

// Assert workspace root is dynamically discovered relative to backend project root
const expectedRoot = path.resolve(__dirname, '../../..');
assert.strictEqual(config.workspaceRoot, expectedRoot, `workspaceRoot must be dynamically discovered as: ${expectedRoot}`);

// Assert hermesConfigPath dynamically resolves using the current user homedir
const expectedHermesPath = path.join(os.homedir(), '.hermes', 'config.yaml');
assert.strictEqual(config.hermesConfigPath, expectedHermesPath);

// Assert allowProjectPaths defaults only to the resolved workspaceRoot
assert.deepStrictEqual(config.allowProjectPaths, [config.workspaceRoot]);

// Assert file-project-repository.ts does not hardcode specific user paths
const fs = require('fs');
const repoSource = fs.readFileSync(
  path.resolve(__dirname, '../src/infrastructure/file-project-repository.ts'),
  'utf-8'
);
const targetUserHome = '/Users/' + 'hill';
assert(!repoSource.includes(targetUserHome + '/.ssh'), 'file-project-repository must not hardcode ' + targetUserHome + '/.ssh');
assert(!repoSource.includes(targetUserHome + '/.hermes'), 'file-project-repository must not hardcode ' + targetUserHome + '/.hermes');
assert(!repoSource.includes(targetUserHome + '/.codex'), 'file-project-repository must not hardcode ' + targetUserHome + '/.codex');

console.log('[PASS] portability config defaults are host-neutral');

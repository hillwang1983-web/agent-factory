#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const backendRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(backendRoot, '..', '..');
const outputPath = process.env.AGENT_FACTORY_BUILD_INFO_PATH
  ? path.resolve(process.env.AGENT_FACTORY_BUILD_INFO_PATH)
  : path.join(backendRoot, 'build-info.json');

function runGit(args) {
  return execFileSync('git', args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function resolveCommit() {
  const override = (process.env.AGENT_FACTORY_BUILD_COMMIT || '').trim();
  if (override) return override;
  try {
    return runGit(['rev-parse', 'HEAD']);
  } catch (_) {
    return 'unknown';
  }
}

function resolveDirty() {
  try {
    return runGit(['status', '--porcelain']).length > 0;
  } catch (_) {
    return false;
  }
}

const info = {
  build_commit: resolveCommit(),
  build_time: new Date().toISOString(),
  dirty: resolveDirty(),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const tempPath = `${outputPath}.${process.pid}.tmp`;
fs.writeFileSync(tempPath, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
fs.renameSync(tempPath, outputPath);

console.log(`[build-info] ${info.build_commit}${info.dirty ? ' (dirty)' : ''}`);

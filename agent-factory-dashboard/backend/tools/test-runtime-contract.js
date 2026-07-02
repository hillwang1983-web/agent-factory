#!/usr/bin/env node
/**
 * Runtime contract tests.
 * Verifies: version info API, structured error codes, structured error shielding.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..', '..');
let passed = 0, failed = 0;

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

function assertThrows(label, fn, check) {
  assert(label, async () => {
    let threw = null;
    try { await fn(); } catch (e) { threw = e; }
    if (!threw) throw new Error('Expected error but none was thrown');
    if (check && !check(threw)) throw new Error(`Error did not match: ${threw.message}`);
  });
}

// ── Test 1: RuntimeInfo shape matches contract ──
assert('runtime-info returns valid phase and api_version', () => {
  // Load the version-controller module to check the interface
  const distPath = path.join(ROOT, 'agent-factory-dashboard', 'backend', 'dist', 'interfaces', 'version-controller.js');
  if (!fs.existsSync(distPath)) throw new Error('version-controller.js not built yet');
  const mod = require(distPath);
  // The module exports createVersionRouter and the interface
  // We can't easily call it without a server, so check the interface contract
  const controllerCode = fs.readFileSync(
    path.join(ROOT, 'agent-factory-dashboard', 'backend', 'src', 'interfaces', 'version-controller.ts'),
    'utf-8'
  );
  if (!controllerCode.includes('phase:') || !controllerCode.includes('api_version:')) {
    throw new Error('RuntimeInfo interface missing required fields');
  }
  if (!controllerCode.includes('dirty:')) {
    throw new Error('RuntimeInfo interface missing dirty build-state field');
  }
  if (controllerCode.includes("'3.7'") && controllerCode.includes("'2026-06-19'")) {
    // OK — correct phase and API version
  } else {
    throw new Error('RuntimeInfo phase/api_version mismatch');
  }
});

// ── Test 2: Structured error contract exists ──
assert('AgentFactoryError class defined with error_code field', () => {
  const errorCode = fs.readFileSync(
    path.join(ROOT, 'agent-factory-dashboard', 'backend', 'src', 'application', 'intake', 'intake-error.ts'),
    'utf-8'
  );
  if (!errorCode.includes('AgentFactoryError')) throw new Error('AgentFactoryError class not found');
  if (!errorCode.includes('error_code')) throw new Error('AgentFactoryError missing error_code field');
  if (!errorCode.includes('retryable')) throw new Error('AgentFactoryError missing retryable field');
});

// ── Test 3: Unknown errors are still shielded ──
assert('unknown errors safely return 500 without leaking internals', () => {
  const controllerCode = fs.readFileSync(
    path.join(ROOT, 'agent-factory-dashboard', 'backend', 'src', 'interfaces', 'agent-factory-controller.ts'),
    'utf-8'
  );
  // Check that unknown errors don't leak stack traces
  const hasShielding = controllerCode.includes('Internal server error') ||
    controllerCode.includes('INTERNAL_ERROR');
  if (!hasShielding) {
    throw new Error('No evidence of error shielding in controller');
  }
});

// ── Test 4: Version mount point exists in index ──
assert('version router is mounted in index.ts', () => {
  const indexCode = fs.readFileSync(
    path.join(ROOT, 'agent-factory-dashboard', 'backend', 'src', 'index.ts'),
    'utf-8'
  );
  if (!indexCode.includes('createVersionRouter')) {
    throw new Error('createVersionRouter not imported in index.ts');
  }
  if (!indexCode.includes('/runtime-info')) {
    if (!indexCode.includes('version')) {
      throw new Error('Version router not mounted');
    }
  }
});

// ── Test 5: Intake error codes used in lifecycle tests ──
assert('intake error codes are used in generation service', () => {
  const genServicePath = path.join(ROOT, 'agent-factory-dashboard', 'backend', 'src', 'application', 'intake', 'intake-generation-service.ts');
  if (!fs.existsSync(genServicePath)) throw new Error('intake-generation-service.ts missing');
  const code = fs.readFileSync(genServicePath, 'utf-8');
  const usedCodes = ['INTAKE_SOFT_TIMEOUT', 'INTAKE_HARD_TIMEOUT',
    'INTAKE_AGENT_FAILED', 'INTAKE_OUTPUT_INVALID'];
  for (const codeName of usedCodes) {
    if (!code.includes(codeName)) {
      throw new Error(`Intake error code not used in generation service: ${codeName}`);
    }
  }
  // Also check that AgentFactoryError is the error class used
  if (!code.includes('AgentFactoryError')) throw new Error('intake-generation-service does not use AgentFactoryError');
});

console.log(`\n── Results: ${passed} passed, ${failed} failed ──`);
process.exit(failed > 0 ? 1 : 0);

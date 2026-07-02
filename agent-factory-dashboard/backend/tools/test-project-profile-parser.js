const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Path to compiled JS output of the parser
// The backend project builds typescript to dist/ directory
const backendDir = path.resolve(__dirname, '..');
const parserPath = path.join(backendDir, 'dist', 'application', 'project-profile-parser.js');

if (!fs.existsSync(parserPath)) {
  console.error(`Compiled parser not found at ${parserPath}. Please run npm run build first.`);
  process.exit(1);
}

const { parseProjectProfileSummary, ProjectProfileParseError } = require(parserPath);

function readFixture(name) {
  const filePath = path.join(backendDir, '..', '..', 'tests', 'fixtures', 'project-profiles', name);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

console.log('── Running Project Profile Parser Tests ──\n');

try {
  // 1. Test Canonical V2
  console.log('Testing canonical-v2.json...');
  const canonicalData = readFixture('canonical-v2.json');
  const canonical = parseProjectProfileSummary(canonicalData);
  
  assert.deepStrictEqual(canonical.build_commands, ['npm run build']);
  assert.deepStrictEqual(canonical.test_commands, ['npm test']);
  assert.strictEqual(canonical.risk_level, 'high');
  assert.ok(!canonical.build_commands.includes('npm run deploy'));
  assert.ok(!canonical.test_commands.includes('npm run deploy'));
  console.log('OK  canonical-v2.json');

  // 2. Test Legacy Flat
  console.log('Testing legacy-flat.json...');
  const legacyData = readFixture('legacy-flat.json');
  const legacy = parseProjectProfileSummary(legacyData);
  
  assert.deepStrictEqual(legacy.build_commands, ['npm run build']);
  assert.deepStrictEqual(legacy.test_commands, ['npm test', 'npm run test:e2e']);
  assert.strictEqual(legacy.risk_level, 'medium');
  console.log('OK  legacy-flat.json');

  // 3. Test Unsafe Command only
  console.log('Testing unsafe-command.json...');
  const unsafeData = readFixture('unsafe-command.json');
  const unsafe = parseProjectProfileSummary(unsafeData);
  
  assert.deepStrictEqual(unsafe.build_commands, []);
  assert.deepStrictEqual(unsafe.test_commands, []);
  console.log('OK  unsafe-command.json');

  // 4. Test Invalid V2 command format (should throw)
  console.log('Testing invalid commands format throwing...');
  const badData = JSON.parse(JSON.stringify(canonicalData));
  badData.commands.safe.build = "not an array";
  
  assert.throws(() => {
    parseProjectProfileSummary(badData);
  }, ProjectProfileParseError);
  console.log('OK  invalid v2 commands checks');

  console.log('\n── Results: All 4 parser tests passed ──');
  process.exit(0);
} catch (err) {
  console.error('\nFAIL:', err);
  process.exit(1);
}

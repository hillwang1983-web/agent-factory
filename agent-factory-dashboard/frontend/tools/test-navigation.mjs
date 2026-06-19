import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const appSource = await readFile(path.resolve(toolsDir, '../src/App.tsx'), 'utf8');

assert.doesNotMatch(
  appSource,
  /OperatorConsolePage|setView\('operator'\)|操作控制台/,
  'Operator Console must remain hidden from the application shell',
);
assert.match(
  appSource,
  /useState<[^>]+>\('dashboard'\)/,
  'Task Dashboard must be the default application view',
);

console.log('[PASS] Operator Console is hidden and Task Dashboard is the default view');

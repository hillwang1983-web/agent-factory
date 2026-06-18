# Agent Factory Phase 3.6 Portability & First-Run Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent Factory portable across machines after a GitHub clone by removing hardcoded local paths, adding first-run bootstrap/doctor checks, and preventing machine-local runtime data from leaking into versioned files.

**Architecture:** Treat Agent Factory as a distributable standalone product instead of a single-machine experiment. Runtime paths must be resolved from explicit environment variables, repository-relative defaults, or the current OS user home; all host-specific state must stay in ignored runtime registries; startup must fail fast with actionable diagnostics when required configuration is missing.

**Tech Stack:** Node.js/TypeScript Express backend, Vite/React frontend, Python runtime scripts, Hermes CLI, JSON registry files under `.ai-agent/registry`, shell/npm developer workflows.

---

## 1. Current Version Portrait

Phase 3.5 already provides:

- Standalone Agent Factory dashboard under `agent-factory-dashboard/`.
- Universal project registration and project profiling.
- Project-aware ADU development.
- Epic orchestration with child ADU materialization.
- Human gates for review, environment verification, write path expansion, and evidence waivers.
- Evidence governance and runtime assertion validation.
- Token/model settings and dashboard layout separation.

The current weakness is not Agent capability. The weakness is operational productization:

- A fresh clone on another host may still resolve `/Users/hill/open5gs`.
- Some tracked seed config contains absolute local paths.
- There is no canonical `.env.example`.
- There is no first-run doctor command to explain missing Hermes/config/registry problems.
- Runtime registries are ignored, but there is no guard preventing future accidental path leakage.

This phase must make the project safe to clone, configure, diagnose, and run on a new host.

## 2. Confirmed Portability Defects

### P1: Backend Defaults Hardcode One Machine

Current examples:

- `agent-factory-dashboard/backend/src/config.ts`
  - `AGENT_FACTORY_WORKSPACE || '/Users/hill/open5gs'`
  - `AGENT_FACTORY_ALLOWED_PROJECT_ROOTS || '/Users/hill,/Users/hill/Desktop,...'`
  - `HERMES_CONFIG_PATH || '/Users/hill/.hermes/config.yaml'`

Required behavior:

- Default workspace should be discovered from the Git repository root or `process.cwd()` lineage.
- Allowed project roots should default to the workspace root only, plus optional env overrides.
- Hermes config should default to `${os.homedir()}/.hermes/config.yaml`, not a specific user.

### P1: Tracked Agent Registry Contains Local CWD

Current example:

- `.ai-agent/registry/agents.json`
  - `"default_cwd": "/Users/hill/open5gs"`

Required behavior:

- Use `"default_cwd": "${AGENT_FACTORY_WORKSPACE}"`.
- Runtime code must expand `${AGENT_FACTORY_WORKSPACE}` before invoking Hermes.
- Validator/doctor must reject literal `/Users/hill`, `file:///Users/hill`, or other machine-specific values in tracked seed config.

### P1: Profiling Script Defaults to One Machine

Current example:

- `scripts/hermes_project_profile.py`
  - `os.environ.get("AGENT_FACTORY_WORKSPACE", "/Users/hill/open5gs")`

Required behavior:

- Resolve workspace root from:
  1. `AGENT_FACTORY_WORKSPACE`
  2. parent directory of the current script (`scripts/..`)
- Never default to a named user path.

### P2: Host-Specific Security Denylist

Current example:

- `file-project-repository.ts`
  - `/Users/hill/.ssh`
  - `/Users/hill/.hermes`
  - `/Users/hill/.codex`

Required behavior:

- Use `os.homedir()` to derive:
  - `${HOME}/.ssh`
  - `${HOME}/.hermes`
  - `${HOME}/.codex`
- Keep system-level paths such as `/System`, `/Library`, `/Applications`, `/etc`, `/var`, `/tmp` as platform-aware blocked roots.

### P2: Frontend and Test Examples Contain Local Paths

Current examples:

- `RegisterProjectModal.tsx` placeholder: `/Users/hill/open5gs`
- Test defaults such as `WORKSPACE_ROOT || '/Users/hill/open5gs'`

Required behavior:

- Frontend placeholder should be generic: `/path/to/local/git-repo`.
- Tests should derive workspace from the repository root or require explicit env.

### P2: Missing First-Run Documentation and Templates

Required behavior:

- Add backend and frontend `.env.example`.
- Add a root-level Agent Factory quick-start document.
- Add `npm run doctor` or `npm run check:portable`.

## 3. File Structure

### Backend Configuration

- Modify: `agent-factory-dashboard/backend/src/config.ts`
  - Resolve portable workspace, Hermes config, allowed roots.
  - Export helper functions for testability.

- Create: `agent-factory-dashboard/backend/src/config-paths.ts`
  - Owns root discovery, env parsing, token expansion, and path normalization.

- Test: `agent-factory-dashboard/backend/tools/test-portability-config.js`
  - Verifies no `/Users/hill` fallback remains.

### Project Repository Security

- Modify: `agent-factory-dashboard/backend/src/infrastructure/file-project-repository.ts`
  - Replace hardcoded home denylist with OS-derived denylist.

- Test: `agent-factory-dashboard/backend/tools/test-portability-config.js`
  - Includes denylist checks using current `HOME`.

### Python Runtime Portability

- Modify: `scripts/hermes_project_profile.py`
  - Resolve workspace from env or script parent.

- Modify: `scripts/hermes_agent_run.py`
  - Expand `${AGENT_FACTORY_WORKSPACE}` in `agents.json` fields before use.
  - Preserve existing project-specific `--repo-root` behavior.

- Modify: `scripts/hermes_agent_orchestrator.py`
  - Ensure child processes receive `AGENT_FACTORY_WORKSPACE` explicitly.

- Test: `scripts/test_portability.py`
  - Validates workspace discovery and token expansion without calling Hermes.

### Seed Config and Runtime State

- Modify: `.ai-agent/registry/agents.json`
  - Change `default_cwd` to `${AGENT_FACTORY_WORKSPACE}`.

- Verify: `.gitignore`
  - Ensure runtime registries stay ignored:
    - `.ai-agent/registry/adu.json`
    - `.ai-agent/registry/runs.json`
    - `.ai-agent/registry/projects.json`
    - `.ai-agent/registry/operations.json`
    - `.ai-agent/registry/intake-drafts.json`
    - `.ai-agent/registry/epics.json`

### Doctor and Bootstrap

- Create: `scripts/agent_factory_doctor.py`
  - Checks environment, paths, Hermes config, registry writability, tracked path leaks.

- Create: `scripts/agent_factory_bootstrap.py`
  - Creates missing runtime registry files with empty schemas.
  - Never overwrites existing registry files.

- Modify: `agent-factory-dashboard/backend/package.json`
  - Add scripts:
    - `doctor`
    - `bootstrap`
    - `test:portability`

### Env Templates and Docs

- Create: `agent-factory-dashboard/backend/.env.example`
- Create: `agent-factory-dashboard/frontend/.env.example`
- Create: `docs/agent-factory/quick-start.md`
- Create: `docs/agent-factory/configuration.md`

### Frontend UX

- Modify: `agent-factory-dashboard/frontend/vite.config.ts`
  - Use `VITE_API_PROXY_TARGET || 'http://localhost:3011'`.

- Modify: `agent-factory-dashboard/frontend/src/components/projects/RegisterProjectModal.tsx`
  - Replace local placeholder.

## 4. Runtime Configuration Contract

### Backend Environment Variables

```bash
AGENT_FACTORY_WORKSPACE=/absolute/path/to/agent-factory-workspace
AGENT_FACTORY_ALLOWED_PROJECT_ROOTS=/absolute/path/to/repos,/another/repo/root
AGENT_FACTORY_PROJECTS_REGISTRY=/absolute/path/to/workspace/.ai-agent/registry/projects.json
AGENT_FACTORY_REGISTRY_DIR=/absolute/path/to/workspace/.ai-agent/registry
HERMES_CONFIG_PATH=$HOME/.hermes/config.yaml
PORT=3011
WS_PORT=3012
CORS_ORIGIN=http://localhost:5175
AGENT_FACTORY_ENABLE_CONTROL=true
```

Rules:

- `AGENT_FACTORY_WORKSPACE` is optional for local development only. If missing, backend discovers the Git root above `agent-factory-dashboard/backend`.
- `HERMES_CONFIG_PATH` is optional. If missing, backend uses `${HOME}/.hermes/config.yaml`.
- `AGENT_FACTORY_ALLOWED_PROJECT_ROOTS` is optional. If missing, only `AGENT_FACTORY_WORKSPACE` is allowed.
- `AGENT_FACTORY_PROJECTS_REGISTRY` is optional. If missing, use `${AGENT_FACTORY_WORKSPACE}/.ai-agent/registry/projects.json`.

### Frontend Environment Variables

```bash
VITE_API_BASE_URL=http://localhost:3011
VITE_WS_URL=ws://localhost:3012
VITE_API_PROXY_TARGET=http://localhost:3011
```

Rules:

- In local dev, frontend may use Vite proxy.
- In production, frontend must call the configured backend URL.

## 5. Runtime Data Policy

### Tracked Seed Files

Allowed tracked files:

- `.ai-agent/registry/agents.json`
- `.ai-agent/registry/agent-model-settings.json`
- `.ai-agent/prompts/*.md`

Tracked files must not contain:

- `/Users/hill`
- `file:///Users/hill`
- `/private/tmp/`
- absolute repo paths in sample data
- absolute runtime registry paths

### Ignored Runtime Files

These are host-local and must remain ignored:

- `.ai-agent/registry/adu.json`
- `.ai-agent/registry/runs.json`
- `.ai-agent/registry/reviews.json`
- `.ai-agent/registry/projects.json`
- `.ai-agent/registry/operations.json`
- `.ai-agent/registry/epics.json`
- `.ai-agent/registry/intake-drafts.json`
- `.ai-agent/context-packs/`
- `.ai-agent/contracts/`
- `.ai-agent/evidence/`
- `.ai-agent/runs/`
- `.ai-agent/locks/`
- `.agent-factory/` inside target repositories

Doctor must warn if any ignored runtime file is staged.

## 6. Bootstrap File Schemas

`scripts/agent_factory_bootstrap.py` must create these files if missing:

```json
{
  "adu.json": { "version": 1, "adus": [] },
  "runs.json": { "version": 1, "runs": [] },
  "reviews.json": { "version": 1, "reviews": [] },
  "projects.json": { "version": 1, "projects": [] },
  "operations.json": { "version": 1, "operations": [] },
  "epics.json": { "version": 1, "epics": [] },
  "intake-drafts.json": { "version": 1, "drafts": [] },
  "events.json": { "version": 1, "events": [] },
  "evidence-waivers.json": { "version": 1, "waivers": [] },
  "write-path-expansion-requests.json": { "version": 1, "requests": [] }
}
```

Bootstrap must:

- Create `.ai-agent/registry/` if missing.
- Create `.ai-agent/runs/`, `.ai-agent/locks/`, `.ai-agent/evidence/`, `.ai-agent/context-packs/`, `.ai-agent/contracts/`.
- Never overwrite existing JSON.
- Validate existing JSON and fail with a clear message if malformed.

## 7. Doctor Checks

`scripts/agent_factory_doctor.py` must return:

- exit `0` when all required checks pass
- exit `1` for blocking errors
- exit `2` for warnings only when called with `--strict`

### Required Checks

1. Workspace root exists and is writable.
2. `.ai-agent/registry` exists or can be created.
3. `agents.json` exists and is valid JSON.
4. `agents.json.default_cwd` is either `${AGENT_FACTORY_WORKSPACE}` or a path under the resolved workspace.
5. Hermes config path exists, unless `--skip-hermes` is passed.
6. Backend port and WebSocket port are valid integers.
7. No tracked file contains local path leak patterns.
8. No ignored runtime registry file is currently staged in Git.
9. Python scripts can locate workspace without `/Users/hill` defaults.
10. Frontend env or proxy target is configured.

### Path Leak Patterns

Doctor must scan tracked files with these patterns:

```python
LEAK_PATTERNS = [
    "/Users/hill",
    "file:///Users/hill",
    "/private/tmp/",
    "e598a519-c339-45f3-b355-069de5537fd5"
]
```

Ignore historical design docs only when they are under:

```text
docs/superpowers/plans/
docs/superpowers/specs/
```

Do not ignore source files, prompts, seed registries, frontend code, backend code, scripts, or env templates.

## 8. Implementation Tasks

### Task 1: Add Portable Config Path Helpers

**Files:**

- Create: `agent-factory-dashboard/backend/src/config-paths.ts`
- Modify: `agent-factory-dashboard/backend/src/config.ts`
- Test: `agent-factory-dashboard/backend/tools/test-portability-config.js`

- [ ] **Step 1: Write the failing config test**

Create `agent-factory-dashboard/backend/tools/test-portability-config.js`:

```javascript
const assert = require('assert');
const path = require('path');
const os = require('os');

process.env.AGENT_FACTORY_WORKSPACE = '';
process.env.AGENT_FACTORY_ALLOWED_PROJECT_ROOTS = '';
process.env.HERMES_CONFIG_PATH = '';

const { loadAppConfig } = require('../dist/config');

function assertNoHillPath(value, label) {
  assert(!String(value).includes('/Users/hill'), `${label} leaked /Users/hill: ${value}`);
}

const config = loadAppConfig();

assert(path.isAbsolute(config.workspaceRoot), 'workspaceRoot must be absolute');
assertNoHillPath(config.workspaceRoot, 'workspaceRoot');
assertNoHillPath(config.hermesConfigPath, 'hermesConfigPath');
assert(config.hermesConfigPath === path.join(os.homedir(), '.hermes', 'config.yaml'));
assert(config.allowProjectPaths.includes(config.workspaceRoot), 'workspace root must be allowed by default');
assert(!config.allowProjectPaths.includes('/Users/hill'), 'allowed roots must not include /Users/hill');

console.log('[PASS] portability config defaults are host-neutral');
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run build
node tools/test-portability-config.js
```

Expected before implementation:

```text
AssertionError: workspaceRoot leaked /Users/hill
```

- [ ] **Step 3: Implement config path helpers**

Create `agent-factory-dashboard/backend/src/config-paths.ts`:

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';

export function findWorkspaceRoot(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(current, '.git')) ||
      fs.existsSync(path.join(current, '.ai-agent')) ||
      fs.existsSync(path.join(current, 'agent-factory-dashboard'))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

export function resolveWorkspaceRoot(envValue: string | undefined, startDir: string): string {
  if (envValue && envValue.trim()) {
    return path.resolve(envValue.trim());
  }
  return findWorkspaceRoot(startDir);
}

export function resolveHermesConfigPath(envValue: string | undefined): string {
  if (envValue && envValue.trim()) {
    return path.resolve(envValue.trim());
  }
  return path.join(os.homedir(), '.hermes', 'config.yaml');
}

export function parseAllowedProjectRoots(envValue: string | undefined, workspaceRoot: string): string[] {
  const roots = [workspaceRoot];
  if (envValue && envValue.trim()) {
    for (const item of envValue.split(',')) {
      const trimmed = item.trim();
      if (trimmed) {
        roots.push(path.resolve(trimmed));
      }
    }
  }
  return Array.from(new Set(roots.map((root) => path.resolve(root))));
}
```

- [ ] **Step 4: Refactor backend config**

Modify `agent-factory-dashboard/backend/src/config.ts`:

```typescript
import path from 'path';
import {
  parseAllowedProjectRoots,
  resolveHermesConfigPath,
  resolveWorkspaceRoot,
} from './config-paths';

export interface AppConfig {
  port: number;
  wsPort: number;
  workspaceRoot: string;
  hermesConfigPath: string;
  artifactMaxBytes: number;
  pollIntervalMs: number;
  corsOrigin: string;
  enableControl: boolean;
  projectsRegistryPath: string;
  allowProjectPaths: string[];
}

export function loadAppConfig(): AppConfig {
  const workspaceRoot = resolveWorkspaceRoot(
    process.env.AGENT_FACTORY_WORKSPACE,
    path.resolve(__dirname, '..', '..')
  );
  const projectsRegistryPath =
    process.env.AGENT_FACTORY_PROJECTS_REGISTRY ||
    path.join(workspaceRoot, '.ai-agent', 'registry', 'projects.json');
  const allowProjectPaths = parseAllowedProjectRoots(
    process.env.AGENT_FACTORY_ALLOWED_PROJECT_ROOTS,
    workspaceRoot
  );

  return {
    port: parseInt(process.env.PORT || '3011', 10),
    wsPort: parseInt(process.env.WS_PORT || '3012', 10),
    workspaceRoot,
    hermesConfigPath: resolveHermesConfigPath(process.env.HERMES_CONFIG_PATH),
    artifactMaxBytes: parseInt(process.env.AGENT_FACTORY_ARTIFACT_MAX_BYTES || '100000', 10),
    pollIntervalMs: parseInt(process.env.AGENT_FACTORY_POLL_INTERVAL_MS || '3000', 10),
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5175',
    enableControl: process.env.AGENT_FACTORY_ENABLE_CONTROL === 'true',
    projectsRegistryPath,
    allowProjectPaths,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run build
node tools/test-portability-config.js
```

Expected:

```text
[PASS] portability config defaults are host-neutral
```

- [ ] **Step 6: Commit**

```bash
git add agent-factory-dashboard/backend/src/config.ts agent-factory-dashboard/backend/src/config-paths.ts agent-factory-dashboard/backend/tools/test-portability-config.js
git commit -m "fix(agent-factory): make backend config host portable"
```

### Task 2: Remove Host-Specific Paths from Project Registration Security

**Files:**

- Modify: `agent-factory-dashboard/backend/src/infrastructure/file-project-repository.ts`
- Modify: `agent-factory-dashboard/backend/tools/test-portability-config.js`

- [ ] **Step 1: Extend the failing test**

Append to `agent-factory-dashboard/backend/tools/test-portability-config.js`:

```javascript
const source = require('fs').readFileSync(
  path.resolve(__dirname, '../src/infrastructure/file-project-repository.ts'),
  'utf-8'
);
assert(!source.includes('/Users/hill/.ssh'), 'file-project-repository must not hardcode /Users/hill/.ssh');
assert(!source.includes('/Users/hill/.hermes'), 'file-project-repository must not hardcode /Users/hill/.hermes');
assert(!source.includes('/Users/hill/.codex'), 'file-project-repository must not hardcode /Users/hill/.codex');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
node tools/test-portability-config.js
```

Expected:

```text
AssertionError: file-project-repository must not hardcode /Users/hill/.ssh
```

- [ ] **Step 3: Replace hardcoded denylist**

Modify `agent-factory-dashboard/backend/src/infrastructure/file-project-repository.ts`:

```typescript
import os from 'os';
```

Replace `forbiddenPrefixes` with:

```typescript
  private readonly forbiddenPrefixes = [
    '/',
    '/System',
    '/Library',
    '/Applications',
    '/etc',
    '/tmp',
    '/var',
    path.join(os.homedir(), '.ssh'),
    path.join(os.homedir(), '.hermes'),
    path.join(os.homedir(), '.codex'),
  ];
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run build
node tools/test-portability-config.js
npm run test:onboarding
```

Expected:

```text
[PASS] portability config defaults are host-neutral
```

- [ ] **Step 5: Commit**

```bash
git add agent-factory-dashboard/backend/src/infrastructure/file-project-repository.ts agent-factory-dashboard/backend/tools/test-portability-config.js
git commit -m "fix(agent-factory): derive protected home paths from current user"
```

### Task 3: Make Python Workspace Resolution Portable

**Files:**

- Modify: `scripts/hermes_project_profile.py`
- Create: `scripts/test_portability.py`

- [ ] **Step 1: Write failing Python test**

Create `scripts/test_portability.py`:

```python
#!/usr/bin/env python3
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

def read_text(path):
    return pathlib.Path(path).read_text(encoding="utf-8")

def assert_no_hill_default(path):
    text = read_text(path)
    bad = '"/Users/hill/open5gs"'
    if bad in text or "'/Users/hill/open5gs'" in text:
        raise AssertionError(f"{path} still contains hardcoded /Users/hill/open5gs default")

def test_no_hill_defaults():
    assert_no_hill_default(ROOT / "scripts" / "hermes_project_profile.py")

def test_profile_help_runs_without_workspace_env():
    env = os.environ.copy()
    env.pop("AGENT_FACTORY_WORKSPACE", None)
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "hermes_project_profile.py"), "--help"],
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(result.stderr)

if __name__ == "__main__":
    test_no_hill_defaults()
    test_profile_help_runs_without_workspace_env()
    print("[PASS] python portability checks")
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/hill/open5gs
python3 scripts/test_portability.py
```

Expected:

```text
AssertionError: ... still contains hardcoded /Users/hill/open5gs default
```

- [ ] **Step 3: Implement portable resolution**

Modify `scripts/hermes_project_profile.py` near workspace resolution:

```python
def resolve_workspace_root():
    env_value = os.environ.get("AGENT_FACTORY_WORKSPACE")
    if env_value and env_value.strip():
        return os.path.abspath(env_value.strip())
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
```

Then replace:

```python
workspace_root = os.environ.get("AGENT_FACTORY_WORKSPACE", "/Users/hill/open5gs")
```

with:

```python
workspace_root = resolve_workspace_root()
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/hill/open5gs
python3 scripts/test_portability.py
python3 -m py_compile scripts/hermes_project_profile.py
```

Expected:

```text
[PASS] python portability checks
```

- [ ] **Step 5: Commit**

```bash
git add scripts/hermes_project_profile.py scripts/test_portability.py
git commit -m "fix(agent-factory): make project profiling workspace portable"
```

### Task 4: Make `agents.json` CWD Tokenized

**Files:**

- Modify: `.ai-agent/registry/agents.json`
- Modify: `scripts/hermes_agent_run.py`
- Modify: `scripts/test_portability.py`

- [ ] **Step 1: Add failing test for tracked seed config**

Append to `scripts/test_portability.py`:

```python
def test_agents_json_uses_workspace_token():
    agents_path = ROOT / ".ai-agent" / "registry" / "agents.json"
    text = agents_path.read_text(encoding="utf-8")
    if '"/Users/hill/open5gs"' in text:
        raise AssertionError("agents.json must not contain literal /Users/hill/open5gs")
    if '"default_cwd": "${AGENT_FACTORY_WORKSPACE}"' not in text:
        raise AssertionError("agents.json default_cwd must use ${AGENT_FACTORY_WORKSPACE}")
```

Update the `__main__` block:

```python
if __name__ == "__main__":
    test_no_hill_defaults()
    test_profile_help_runs_without_workspace_env()
    test_agents_json_uses_workspace_token()
    print("[PASS] python portability checks")
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/hill/open5gs
python3 scripts/test_portability.py
```

Expected:

```text
AssertionError: agents.json must not contain literal /Users/hill/open5gs
```

- [ ] **Step 3: Tokenize `agents.json`**

Modify `.ai-agent/registry/agents.json`:

```json
{
  "version": 1,
  "hermes_bin": "hermes",
  "default_cwd": "${AGENT_FACTORY_WORKSPACE}",
  "default_toolsets": "hermes-cli",
  "default_model": "",
  "agents": {}
}
```

Keep the existing `agents` object unchanged; only change `default_cwd`.

- [ ] **Step 4: Add token expansion helper to runner**

In `scripts/hermes_agent_run.py`, add:

```python
def expand_runtime_path(value, workspace_root):
    if not isinstance(value, str):
        return value
    return (
        value
        .replace("${AGENT_FACTORY_WORKSPACE}", str(workspace_root))
        .replace("$AGENT_FACTORY_WORKSPACE", str(workspace_root))
    )
```

Where `default_cwd` is read from `agents.json`, wrap it:

```python
default_cwd = expand_runtime_path(agents_config.get("default_cwd", str(workspace_root)), workspace_root)
```

Use `default_cwd` exactly as before after expansion.

- [ ] **Step 5: Run tests**

Run:

```bash
cd /Users/hill/open5gs
python3 scripts/test_portability.py
python3 -m py_compile scripts/hermes_agent_run.py
```

Expected:

```text
[PASS] python portability checks
```

- [ ] **Step 6: Commit**

```bash
git add .ai-agent/registry/agents.json scripts/hermes_agent_run.py scripts/test_portability.py
git commit -m "fix(agent-factory): tokenize agent default cwd"
```

### Task 5: Add Bootstrap Script for Runtime Registries

**Files:**

- Create: `scripts/agent_factory_bootstrap.py`
- Modify: `agent-factory-dashboard/backend/package.json`
- Modify: `scripts/test_portability.py`

- [ ] **Step 1: Add bootstrap test**

Append to `scripts/test_portability.py`:

```python
import json
import tempfile

def test_bootstrap_creates_runtime_registry_files():
    with tempfile.TemporaryDirectory() as tmp:
        workspace = pathlib.Path(tmp)
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "agent_factory_bootstrap.py"),
                "--workspace",
                str(workspace),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise AssertionError(result.stderr)

        registry = workspace / ".ai-agent" / "registry"
        expected_files = [
            "adu.json",
            "runs.json",
            "reviews.json",
            "projects.json",
            "operations.json",
            "epics.json",
            "intake-drafts.json",
            "events.json",
            "evidence-waivers.json",
            "write-path-expansion-requests.json",
        ]
        for name in expected_files:
            path = registry / name
            if not path.exists():
                raise AssertionError(f"missing bootstrap file: {path}")
            json.loads(path.read_text(encoding="utf-8"))
```

Update `__main__` to call `test_bootstrap_creates_runtime_registry_files()`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/hill/open5gs
python3 scripts/test_portability.py
```

Expected:

```text
can't open file ... agent_factory_bootstrap.py
```

- [ ] **Step 3: Implement bootstrap**

Create `scripts/agent_factory_bootstrap.py`:

```python
#!/usr/bin/env python3
import argparse
import json
import pathlib
import sys

RUNTIME_FILES = {
    "adu.json": {"version": 1, "adus": []},
    "runs.json": {"version": 1, "runs": []},
    "reviews.json": {"version": 1, "reviews": []},
    "projects.json": {"version": 1, "projects": []},
    "operations.json": {"version": 1, "operations": []},
    "epics.json": {"version": 1, "epics": []},
    "intake-drafts.json": {"version": 1, "drafts": []},
    "events.json": {"version": 1, "events": []},
    "evidence-waivers.json": {"version": 1, "waivers": []},
    "write-path-expansion-requests.json": {"version": 1, "requests": []},
}

RUNTIME_DIRS = [
    ".ai-agent/registry",
    ".ai-agent/runs",
    ".ai-agent/locks",
    ".ai-agent/evidence",
    ".ai-agent/context-packs",
    ".ai-agent/contracts",
    ".ai-agent/reviews",
    ".ai-agent/analysis",
    ".ai-agent/designs",
    ".ai-agent/acceptance",
]

def validate_json(path):
    try:
        json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Existing JSON is malformed: {path}: {exc}") from exc

def main():
    parser = argparse.ArgumentParser(description="Bootstrap Agent Factory runtime directories and registry files")
    parser.add_argument("--workspace", default=None, help="Agent Factory workspace root")
    args = parser.parse_args()

    workspace = pathlib.Path(args.workspace).expanduser().resolve() if args.workspace else pathlib.Path(__file__).resolve().parents[1]

    for rel_dir in RUNTIME_DIRS:
        (workspace / rel_dir).mkdir(parents=True, exist_ok=True)

    registry = workspace / ".ai-agent" / "registry"
    created = []
    for name, payload in RUNTIME_FILES.items():
        path = registry / name
        if path.exists():
            validate_json(path)
            continue
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        created.append(str(path))

    print(json.dumps({"workspace": str(workspace), "created": created}, indent=2))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
```

- [ ] **Step 4: Add npm script**

Modify `agent-factory-dashboard/backend/package.json`:

```json
{
  "scripts": {
    "bootstrap": "python3 ../../scripts/agent_factory_bootstrap.py",
    "test:portability": "python3 ../../scripts/test_portability.py && node tools/test-portability-config.js"
  }
}
```

Keep existing scripts unchanged and add these keys.

- [ ] **Step 5: Run tests**

Run:

```bash
cd /Users/hill/open5gs
python3 scripts/test_portability.py
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run test:portability
```

Expected:

```text
[PASS] python portability checks
[PASS] portability config defaults are host-neutral
```

- [ ] **Step 6: Commit**

```bash
git add scripts/agent_factory_bootstrap.py scripts/test_portability.py agent-factory-dashboard/backend/package.json
git commit -m "feat(agent-factory): add first-run bootstrap"
```

### Task 6: Add Doctor Command

**Files:**

- Create: `scripts/agent_factory_doctor.py`
- Modify: `agent-factory-dashboard/backend/package.json`
- Modify: `scripts/test_portability.py`

- [ ] **Step 1: Add doctor test**

Append to `scripts/test_portability.py`:

```python
def test_doctor_detects_tracked_path_leaks():
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "agent_factory_doctor.py"),
            "--workspace",
            str(ROOT),
            "--skip-hermes",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(result.stdout + result.stderr)
```

Update `__main__` to call `test_doctor_detects_tracked_path_leaks()`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/hill/open5gs
python3 scripts/test_portability.py
```

Expected:

```text
can't open file ... agent_factory_doctor.py
```

- [ ] **Step 3: Implement doctor**

Create `scripts/agent_factory_doctor.py`:

```python
#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import subprocess
import sys

LEAK_PATTERNS = [
    "/Users/hill",
    "file:///Users/hill",
    "/private/tmp/",
    "e598a519-c339-45f3-b355-069de5537fd5",
]

DOC_EXEMPT_PREFIXES = (
    "docs/superpowers/plans/",
    "docs/superpowers/specs/",
)

RUNTIME_REGISTRY_NAMES = {
    ".ai-agent/registry/adu.json",
    ".ai-agent/registry/runs.json",
    ".ai-agent/registry/reviews.json",
    ".ai-agent/registry/projects.json",
    ".ai-agent/registry/operations.json",
    ".ai-agent/registry/epics.json",
    ".ai-agent/registry/intake-drafts.json",
}

def run_git(workspace, args):
    result = subprocess.run(
        ["git", *args],
        cwd=str(workspace),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []
    return [line for line in result.stdout.splitlines() if line.strip()]

def check_json(path, errors):
    try:
        json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"Invalid JSON: {path}: {exc}")

def check_path_leaks(workspace, errors):
    tracked = run_git(workspace, ["ls-files"])
    for rel in tracked:
        if rel.startswith(DOC_EXEMPT_PREFIXES):
            continue
        path = workspace / rel
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for pattern in LEAK_PATTERNS:
            if pattern in text:
                errors.append(f"Tracked file leaks local path pattern {pattern}: {rel}")

def check_staged_runtime_files(workspace, errors):
    staged = run_git(workspace, ["diff", "--cached", "--name-only"])
    for rel in staged:
        if rel in RUNTIME_REGISTRY_NAMES:
            errors.append(f"Runtime registry file is staged and must remain host-local: {rel}")

def main():
    parser = argparse.ArgumentParser(description="Check Agent Factory portability and first-run configuration")
    parser.add_argument("--workspace", default=None)
    parser.add_argument("--skip-hermes", action="store_true")
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()

    workspace = pathlib.Path(args.workspace).expanduser().resolve() if args.workspace else pathlib.Path(__file__).resolve().parents[1]
    errors = []
    warnings = []

    if not workspace.exists():
        errors.append(f"Workspace does not exist: {workspace}")
    elif not os.access(workspace, os.W_OK):
        errors.append(f"Workspace is not writable: {workspace}")

    registry = workspace / ".ai-agent" / "registry"
    if not registry.exists():
        warnings.append(f"Registry directory does not exist yet: {registry}; run bootstrap")
    else:
        agents = registry / "agents.json"
        if not agents.exists():
            errors.append(f"Missing agents.json: {agents}")
        else:
            check_json(agents, errors)
            try:
                parsed = json.loads(agents.read_text(encoding="utf-8"))
                default_cwd = parsed.get("default_cwd", "")
                if default_cwd not in ("${AGENT_FACTORY_WORKSPACE}", str(workspace)):
                    errors.append(f"agents.json default_cwd must be tokenized or workspace-local: {default_cwd}")
            except Exception:
                pass

    hermes_config = pathlib.Path(os.environ.get("HERMES_CONFIG_PATH", pathlib.Path.home() / ".hermes" / "config.yaml")).expanduser()
    if not args.skip_hermes and not hermes_config.exists():
        errors.append(f"Hermes config not found: {hermes_config}")

    check_path_leaks(workspace, errors)
    check_staged_runtime_files(workspace, errors)

    payload = {
        "workspace": str(workspace),
        "errors": errors,
        "warnings": warnings,
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))

    if errors:
        sys.exit(1)
    if warnings and args.strict:
        sys.exit(2)
    sys.exit(0)

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Add npm script**

Modify `agent-factory-dashboard/backend/package.json`:

```json
{
  "scripts": {
    "doctor": "python3 ../../scripts/agent_factory_doctor.py"
  }
}
```

Keep existing scripts unchanged.

- [ ] **Step 5: Run doctor**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run doctor -- --skip-hermes
```

Expected:

```json
{
  "errors": []
}
```

- [ ] **Step 6: Commit**

```bash
git add scripts/agent_factory_doctor.py scripts/test_portability.py agent-factory-dashboard/backend/package.json
git commit -m "feat(agent-factory): add portability doctor"
```

### Task 7: Add Env Templates and Quick Start Docs

**Files:**

- Create: `agent-factory-dashboard/backend/.env.example`
- Create: `agent-factory-dashboard/frontend/.env.example`
- Create: `docs/agent-factory/quick-start.md`
- Create: `docs/agent-factory/configuration.md`

- [ ] **Step 1: Create backend env example**

Create `agent-factory-dashboard/backend/.env.example`:

```bash
# Agent Factory workspace root. Defaults to the repository root when omitted.
AGENT_FACTORY_WORKSPACE=/absolute/path/to/agent-factory-workspace

# Optional comma-separated roots that may be registered as managed Git projects.
# If omitted, only AGENT_FACTORY_WORKSPACE is allowed.
AGENT_FACTORY_ALLOWED_PROJECT_ROOTS=/absolute/path/to/repos

# Optional explicit registry locations.
AGENT_FACTORY_REGISTRY_DIR=/absolute/path/to/agent-factory-workspace/.ai-agent/registry
AGENT_FACTORY_PROJECTS_REGISTRY=/absolute/path/to/agent-factory-workspace/.ai-agent/registry/projects.json

# Hermes config. Defaults to $HOME/.hermes/config.yaml when omitted.
HERMES_CONFIG_PATH=/absolute/path/to/.hermes/config.yaml

PORT=3011
WS_PORT=3012
CORS_ORIGIN=http://localhost:5175
AGENT_FACTORY_ENABLE_CONTROL=true
AGENT_FACTORY_ARTIFACT_MAX_BYTES=100000
AGENT_FACTORY_POLL_INTERVAL_MS=3000
```

- [ ] **Step 2: Create frontend env example**

Create `agent-factory-dashboard/frontend/.env.example`:

```bash
VITE_API_BASE_URL=http://localhost:3011
VITE_WS_URL=ws://localhost:3012
VITE_API_PROXY_TARGET=http://localhost:3011
```

- [ ] **Step 3: Create quick start**

Create `docs/agent-factory/quick-start.md`:

```markdown
# Agent Factory Quick Start

## 1. Install Dependencies

```bash
cd agent-factory-dashboard/backend
npm install

cd ../frontend
npm install
```

## 2. Configure Backend

```bash
cd agent-factory-dashboard/backend
cp .env.example .env
```

Edit `.env` and set:

- `AGENT_FACTORY_WORKSPACE`
- `AGENT_FACTORY_ALLOWED_PROJECT_ROOTS`
- `HERMES_CONFIG_PATH`

## 3. Bootstrap Runtime Registry

```bash
cd agent-factory-dashboard/backend
npm run bootstrap
```

## 4. Run Doctor

```bash
npm run doctor -- --skip-hermes
```

Remove `--skip-hermes` after Hermes is installed and configured.

## 5. Start Backend

```bash
AGENT_FACTORY_ENABLE_CONTROL=true npm run dev
```

## 6. Start Frontend

```bash
cd ../frontend
cp .env.example .env
npm run dev
```

Open `http://localhost:5175`.
```
```

- [ ] **Step 4: Create configuration reference**

Create `docs/agent-factory/configuration.md`:

```markdown
# Agent Factory Configuration

Agent Factory separates versioned seed configuration from host-local runtime state.

## Versioned Seed Configuration

- `.ai-agent/registry/agents.json`
- `.ai-agent/registry/agent-model-settings.json`
- `.ai-agent/prompts/*.md`

These files may be committed.

## Host-Local Runtime State

- `.ai-agent/registry/adu.json`
- `.ai-agent/registry/runs.json`
- `.ai-agent/registry/projects.json`
- `.ai-agent/registry/operations.json`
- `.ai-agent/registry/epics.json`
- `.ai-agent/runs/`
- `.ai-agent/locks/`
- `.ai-agent/evidence/`

These files must not be committed.

## Required Commands

```bash
cd agent-factory-dashboard/backend
npm run bootstrap
npm run doctor
```

## Path Rules

Use absolute paths in local `.env` files and project registration.
Do not commit absolute local paths in tracked seed files.
Use `${AGENT_FACTORY_WORKSPACE}` in tracked config when a workspace path is needed.
```

- [ ] **Step 5: Run doc leak check**

Run:

```bash
cd /Users/hill/open5gs
rg "/Users/hill" agent-factory-dashboard/backend/.env.example agent-factory-dashboard/frontend/.env.example docs/agent-factory
```

Expected:

```text
no output
```

- [ ] **Step 6: Commit**

```bash
git add agent-factory-dashboard/backend/.env.example agent-factory-dashboard/frontend/.env.example docs/agent-factory/quick-start.md docs/agent-factory/configuration.md
git commit -m "docs(agent-factory): add portable first-run guide"
```

### Task 8: Make Frontend Dev Proxy and Project Placeholder Portable

**Files:**

- Modify: `agent-factory-dashboard/frontend/vite.config.ts`
- Modify: `agent-factory-dashboard/frontend/src/components/projects/RegisterProjectModal.tsx`

- [ ] **Step 1: Update Vite proxy**

Modify `agent-factory-dashboard/frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3011',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 2: Update project path placeholder**

Modify `agent-factory-dashboard/frontend/src/components/projects/RegisterProjectModal.tsx`:

```tsx
placeholder="例如: /path/to/local/git-repo"
```

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/frontend
npm run build
```

Expected:

```text
✓ built
```

- [ ] **Step 4: Commit**

```bash
git add agent-factory-dashboard/frontend/vite.config.ts agent-factory-dashboard/frontend/src/components/projects/RegisterProjectModal.tsx
git commit -m "fix(agent-factory): remove local path examples from frontend"
```

### Task 9: Harden Tests Against Local Path Defaults

**Files:**

- Modify: `agent-factory-dashboard/backend/tools/test-quality-gates.js`
- Modify: `agent-factory-dashboard/backend/tools/test-review-gate.js`
- Modify: `agent-factory-dashboard/backend/tools/test-write-path-expansions.js`
- Modify: `agent-factory-dashboard/backend/tools/test-phase35-bugfixes.js`
- Modify: `agent-factory-dashboard/backend/tools/test-clarification-questions.js`
- Modify: `agent-factory-dashboard/backend/tools/test-project-adu.js`

- [ ] **Step 1: Replace hardcoded workspace defaults**

Use this helper pattern in each affected Node test:

```javascript
const path = require('path');

function resolveWorkspaceRoot() {
  return process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../../..');
}

const workspaceRoot = resolveWorkspaceRoot();
```

Do not use:

```javascript
'/Users/hill/open5gs'
```

- [ ] **Step 2: Replace hardcoded base URL where missing**

Use:

```javascript
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3011';
```

This is acceptable because it is a local service endpoint, not a machine-specific file path.

- [ ] **Step 3: Replace symlink security test target**

In `test-project-onboarding.js`, replace:

```javascript
fs.symlinkSync('/Users/hill/.ssh', symlinkPath);
```

with:

```javascript
fs.symlinkSync(path.join(os.homedir(), '.ssh'), symlinkPath);
```

Add:

```javascript
const os = require('os');
```

- [ ] **Step 4: Run source leak scan**

Run:

```bash
cd /Users/hill/open5gs
rg "/Users/hill/open5gs|/Users/hill/\\.ssh|/Users/hill/\\.hermes|/Users/hill/\\.codex" agent-factory-dashboard/backend/tools
```

Expected:

```text
no output
```

- [ ] **Step 5: Run backend tests**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run build
npm run test:portability
npm run test:project-adu
npm run test:adu-intake
npm run test:quality-gates
```

Expected:

```text
all tests pass
```

- [ ] **Step 6: Commit**

```bash
git add agent-factory-dashboard/backend/tools
git commit -m "test(agent-factory): remove machine-specific test defaults"
```

### Task 10: Add Final Portable Release Gate

**Files:**

- Modify: `agent-factory-dashboard/backend/package.json`
- Create: `scripts/check_tracked_path_leaks.py`

- [ ] **Step 1: Create tracked path leak checker**

Create `scripts/check_tracked_path_leaks.py`:

```python
#!/usr/bin/env python3
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATTERNS = ["/Users/hill", "file:///Users/hill", "/private/tmp/"]
EXEMPT_PREFIXES = ("docs/superpowers/plans/", "docs/superpowers/specs/")

def main():
    result = subprocess.run(["git", "ls-files"], cwd=str(ROOT), capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        return 1

    failures = []
    for rel in result.stdout.splitlines():
        if rel.startswith(EXEMPT_PREFIXES):
            continue
        path = ROOT / rel
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for pattern in PATTERNS:
            if pattern in text:
                failures.append(f"{rel}: contains {pattern}")

    if failures:
        print("Tracked local path leaks detected:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print("[PASS] no tracked local path leaks")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Register release gate script**

Modify `agent-factory-dashboard/backend/package.json`:

```json
{
  "scripts": {
    "check:portable": "python3 ../../scripts/check_tracked_path_leaks.py && python3 ../../scripts/test_portability.py && node tools/test-portability-config.js"
  }
}
```

Keep existing scripts unchanged.

- [ ] **Step 3: Run final gate**

Run:

```bash
cd /Users/hill/open5gs/agent-factory-dashboard/backend
npm run check:portable
npm run build
cd ../frontend
npm run build
cd /Users/hill/open5gs
git diff --check
```

Expected:

```text
[PASS] no tracked local path leaks
[PASS] python portability checks
[PASS] portability config defaults are host-neutral
```

- [ ] **Step 4: Commit**

```bash
git add scripts/check_tracked_path_leaks.py agent-factory-dashboard/backend/package.json
git commit -m "chore(agent-factory): add portable release gate"
```

## 9. Acceptance Criteria

Phase 3.6 is complete only when all criteria below pass:

1. A clean clone can run `npm run bootstrap` without manually creating `.ai-agent/registry`.
2. A clean clone can run `npm run doctor -- --skip-hermes` and receive actionable output.
3. No tracked source/config file outside historical docs contains `/Users/hill`.
4. `.ai-agent/registry/agents.json` uses `${AGENT_FACTORY_WORKSPACE}` for `default_cwd`.
5. Backend config has no user-specific default path.
6. Python profiling has no user-specific default path.
7. Project registration denylist uses the current OS user home.
8. Runtime registry files remain ignored and are not staged.
9. Frontend build passes.
10. Backend build passes.
11. Existing critical tests still pass:
    - `npm run test:project-adu`
    - `npm run test:adu-intake`
    - `npm run test:quality-gates`
    - `npm run test:epic-dag`
12. New portability tests pass:
    - `npm run test:portability`
    - `npm run check:portable`

## 10. Manual Cross-Host Smoke Test

Run this test on a second machine or a temporary clone directory:

```bash
git clone <repo-url> agent-factory-portability-smoke
cd agent-factory-portability-smoke/agent-factory-dashboard/backend
npm install
cp .env.example .env
npm run bootstrap
npm run doctor -- --skip-hermes
npm run build
```

Expected:

- No path references to `/Users/hill`.
- `.ai-agent/registry/*.json` files are created locally.
- Doctor reports no blocking errors except Hermes when `--skip-hermes` is not used.

Then run frontend:

```bash
cd ../frontend
npm install
cp .env.example .env
npm run build
```

Expected:

- Frontend build succeeds.
- Project registration placeholder is generic.

## 11. Rollback Plan

If Phase 3.6 breaks local development:

1. Restore only `config.ts` behavior temporarily by setting:

```bash
export AGENT_FACTORY_WORKSPACE=/Users/hill/open5gs
export AGENT_FACTORY_ALLOWED_PROJECT_ROOTS=/Users/hill,/Users/hill/Desktop,/Users/hill/open5gs
export HERMES_CONFIG_PATH=/Users/hill/.hermes/config.yaml
```

2. Do not revert registry `.gitignore` or runtime data isolation.
3. Do not restore literal `/Users/hill` into tracked seed config.
4. Fix the missing env/bootstrap issue and re-run:

```bash
cd agent-factory-dashboard/backend
npm run check:portable
```

## 12. Self-Review

Spec coverage:

- Hardcoded backend defaults covered by Task 1.
- Hardcoded project security paths covered by Task 2.
- Python workspace hardcoding covered by Task 3.
- Tracked `agents.json.default_cwd` covered by Task 4.
- First-run bootstrap covered by Task 5.
- Doctor diagnostics covered by Task 6.
- Env templates and docs covered by Task 7.
- Frontend UX portability covered by Task 8.
- Test path portability covered by Task 9.
- Release guard covered by Task 10.

Placeholder scan:

- No `TBD`, `TODO`, or unspecified test steps remain.
- Every task has exact files and commands.

Type consistency:

- Backend helpers are exported from `config-paths.ts` and imported by `config.ts`.
- Python tests call scripts by stable repository-relative paths.
- NPM scripts use paths relative to `agent-factory-dashboard/backend`.

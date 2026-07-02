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

## Project Profile Contract (v2)

Agent Factory enforces a project profile contract schema defining how repositories are profiled:

- **Version 2 Canonical Schema**: Under `.ai-agent/schemas/project-profile.schema.json`, defining canonical JSON layout for commands (`safe`, `ambiguous`, `unsafe`), `detected_stack` structures, and nested `risk_profile`.
- **Legacy Compatibility**: Automatically parses flat legacy profiles by upgrading them inline into the v2 structure.
- **Command Categories**:
  - `safe`: Recommended build/test commands only.
  - `ambiguous` and `unsafe` (e.g. `deploy` or destructive commands): Blocked from recommended commands.
- **Fail-Closed Verification**: Any profiling run producing invalid schemas or illegal commands results in a `profile_failed` status.
- **Automatic Summary Recovery**: When a project is listed via `listProjects()` and contains an empty registry summary but valid profile file on disk, the system automatically rebuilds and caches the summary.

## Agent Write Policy and Delta Integrity

To prevent unauthorized file writes and bypasses, Agent Factory enforces a strict role-based write policy and Git-aware repository delta verification.

### Role Authorization Policy Matrix

| Agent | Authorized Paths Source / Rules |
|---|---|
| `developer` | Current ADU `allowed_write_paths`. Supports exact files and folders (ending in `/`). |
| `buildfix-debugger` | `.ai-agent/runs/<ADU_ID>-validation-summary.md` |
| `testwriter` | `tests/ai-agent-mvp/<ADU_ID>-validation.md` |
| `requirement-analyst` | `.ai-agent/analysis/<ADU_ID>.md` |
| `context-pack` | `.ai-agent/context-packs/<ADU_ID>.md` |
| `detail-designer` | Current ADU detailed design and interfaces JSON files |
| `contract` | Current ADU contract JSON, notes, and validation documents |
| `code-reviewer` | Current ADU code-review JSON/Markdown |
| `acceptance-reviewer` | Current ADU acceptance-review JSON/Markdown |
| `rework-planner` | Current ADU rework-plan JSON |
| `evidence` | Current ADU evidence JSON/Markdown |
| `project-profiler` | Exactly the 5 `.agent-factory/` profiling files |
| Epic Agents | Current `.ai-agent/epics/<EPIC_ID>/` files returned by `get_agent_target_files()` |

- Unknown agents, absolute paths, directory traversals (`..`), or symlink escapes result in an immediate fail-closed rejection.

### Path Collection and Verification Equations

Each agent run evaluates the following sets:
* $D$: Normalized paths declared in `completion_result.changed_files`.
* $A$: Actual changes detected in the workspace root by Git.
* $R$: Runner-owned control files (e.g., execution logs, prompts, or completion descriptors).

The verification passes if and only if:
1. $D == A$ (Strict equivalence of declared and actual modifications).
2. $D \subseteq \text{role\_authorized\_paths}$ (All declared changes are authorized for the role).
3. $A \cap \text{sensitive\_or\_runtime\_paths} == \emptyset$ (No changes to sensitive directories/databases).
4. $R \cap D == \emptyset$ (Agent cannot declare runner-owned control files).

### Runner-Owned Control Files

Control files are strictly verified as exact paths inside the current run directory:
* `prompt.md`, `stdout.md`, `stderr.md` (and their `_att<N>.md` variants).
* `completion.json`, `file-snapshot-before.json`, `file-snapshot-after.json`, `file-delta.json`.
* `verification-results.json`, `quality-gate.md`.

Sensitive registry files, lock files, and databases must never be declared by an agent or modified during execution.

### Non-Git Repository Verification

Since integrity verification relies on Git plumbing, any workspace root without an initialized Git repository will fail closed.

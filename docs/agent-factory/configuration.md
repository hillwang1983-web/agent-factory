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

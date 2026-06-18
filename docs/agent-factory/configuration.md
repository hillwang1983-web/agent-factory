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

# Agent Factory Phase 2: Project-Aware ADU Development Design Spec

**Date:** 2026-06-09
**Topic:** Agent Factory Phase 2 Project-Aware ADU Implementation
**Author:** AI Agent
**Status:** Approved

## 1. Overview and Purpose
This document specifies the design for Phase 2 of the Agent Factory. The goal is to extend the existing standalone Agent Factory so that Agentic Development Units (ADUs) can be explicitly bound to profiled Git repositories. This enables Agents to execute against a specific project's isolated directory, utilizing the project's profile and knowledge pack for context, while strictly enforcing sandbox and execution boundaries.

## 2. Architecture & Data Flow

### 2.1 Storage Layout
- **Global Metadata:** `projects.json`, `adu.json`, and `runs.json` remain in `/Users/hill/open5gs/.ai-agent/registry/` for central orchestration.
- **Project Isolation:** All development artifacts for a project-aware ADU (analysis, designs, contracts, runs, reviews, acceptance, evidence) will be routed to the target project's local directory: `<target-repo>/.ai-agent/`.

### 2.2 ADU Schema Extensions
The global ADU schema is extended to include:
- `project_id`, `project_name`, `repo_path`, `artifact_root`, `profile_path`, `knowledge_dir`
- `review_policy` (booleans for analysis and design review requirements)
- `command_policy` (an allowlist mode with explicitly permitted commands and a denylist of shell patterns)

## 3. Core Subsystem Design

### 3.1 Backend API & Domain (TypeScript)
- **ProjectAduFactory:** A new use case responsible for creating ADUs bound to a specific project. It merges user inputs with the project's profile (e.g., test/build commands) to formulate safe execution constraints.
- **Artifact Path Sandbox:** `file-agent-factory-repository.ts` will strictly enforce `fs.realpath` checks. It will resolve paths against `<target-repo>` for project ADUs, preventing directory traversal (`../../`) and cross-project contamination.
- **New API Routes:**
  - `POST /api/agent-factory/projects/:projectId/adus`
  - `GET /api/agent-factory/projects/:projectId/adus`
  - `GET /api/agent-factory/adus/:aduId/project-context`

### 3.2 Python Orchestrator & Agents Control Flow
- **Execution Handshake:** The backend Express controller will reject spawning Python if the ADU's project is not in a `profiled` state.
- **Orchestrator Arguments:** The backend will spawn Python with `--project <projectId> --repo-root <targetRepoPath>`.
- **`hermes_agent_orchestrator.py`:** Will parse these new arguments, apply a project-local locking mechanism to prevent race conditions on the same repo, and orchestrate the state machine.
- **`hermes_agent_run.py` (Payload Assembly):** This script will load the project profile and knowledge pack (truncating knowledge files over 80KB to prevent context bloat). It injects these, along with the strict path and command policies, into a unified JSON context for the LLM.

### 3.3 Prompt & AI Agent Constraints
- All 10 Agent prompts (e.g., `developer-agent.md`, `contract-agent.md`) will be updated to:
  - Treat the provided project profile and knowledge pack as the absolute source of truth.
  - Strictly adhere to `allowed_write_paths` and `command_policy`.
  - Continue emitting deterministic machine-readable JSON blocks.
  - Process text in Chinese, while keeping identifiers, paths, and commands in English.

### 3.4 Frontend UI (React + Zustand)
- **Entry Point:** A new "Create ADU" action attached to profiled project cards in `ProjectsPage.tsx`.
- **Creation Modal:** `CreateProjectAduModal.tsx` handles requirement input, enforcing relative paths against the project root.
- **Context Awareness:** `ProjectContextPanel.tsx` added to the Agent Factory execution view to display the active project's profile, applied knowledge packs, and security policies alongside the ADU state machine.

## 4. Security & Quality Gates
- **Denylist First:** Commands matching blocked patterns (e.g., `rm -rf`, `sudo`, `> /dev/`) are hard-rejected during ADU creation.
- **Execution Isolation:** `validate_agent_contract.py` and `validate_quality_report.py` will read from the project-local `.ai-agent` directory and assert that target write paths fall completely within `allowed_write_paths`.
- **Legacy Compatibility:** Existing global ADUs (without a `project_id`) will remain untouched and gracefully degraded (project-aware controls disabled).

## 5. Implementation & Testing Strategy
We will use a sequential, bottom-up approach to guarantee contract stability:
1. **Domain & API (Backend/Frontend Types):** Establish data models and `ProjectAduFactory`.
2. **Backend Security & Sandbox:** Implement path resolving and command filtering. Verify with `npm run test:project-adu`. **(Hard Gate: Do not proceed until tests pass).**
3. **Python Runtime:** Modify the orchestrator, runner, and prompts to consume the new project context.
4. **Frontend UI:** Build the React components and Zustand state logic to wire the user experience together.

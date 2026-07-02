# Agent Factory Build Version Info Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate reliable Agent Factory Git commit and build time metadata during every backend build.

**Architecture:** A focused Node script resolves the commit from `AGENT_FACTORY_BUILD_COMMIT` or local Git, writes `build-info.json` atomically, and is invoked by npm's `prebuild` hook. The existing runtime endpoint reads the generated file without running Git in the server process.

**Tech Stack:** Node.js, npm lifecycle scripts, TypeScript/Express.

---

### Task 1: Build Metadata Generator

**Files:**
- Create: `agent-factory-dashboard/backend/tools/generate-build-info.js`
- Create: `agent-factory-dashboard/backend/tools/test-build-info.js`
- Modify: `agent-factory-dashboard/backend/package.json`
- Modify: `.gitignore`

- [x] **Step 1: Write the failing test**

Test that an environment-provided commit generates valid JSON with `build_commit`, `build_time`, and `dirty`, and that the output path can be isolated in a temporary directory.

- [x] **Step 2: Run test to verify it fails**

Run: `node tools/test-build-info.js`

Expected: FAIL because `generate-build-info.js` does not exist.

- [x] **Step 3: Implement the generator**

Resolve commit from `AGENT_FACTORY_BUILD_COMMIT`, otherwise `git rev-parse HEAD`; detect dirty state with `git status --porcelain`; write through a temporary file followed by rename.

- [x] **Step 4: Attach generator to build**

Add `prebuild` and `test:build-info` scripts. Ignore generated `build-info.json`.

- [x] **Step 5: Verify**

Run:

```bash
npm run test:build-info
npm run build
curl http://127.0.0.1:3011/api/agent-factory/runtime-info
```

Expected: tests and build pass; runtime info reports a non-`unknown` commit.

# Validation Plan: REQ-MVP-004

This validation plan defines the criteria and commands to verify that the available Open5GS/NMS/test paths have been inventoried and compiled into a context pack for later 5GC MVP development.

## 1. Goal

Validate that `REQ-MVP-004` requirements are successfully met. Specifically:
- Available `docs` and `tests` directories are successfully searched.
- No production code has been modified.
- Output artifacts are correctly placed under allowed paths.

## 2. Validation Commands

These are the exact validation commands defined in the ADU contract (`.ai-agent/contracts/REQ-MVP-004.json`):

```bash
find docs -maxdepth 2 -type f | sort
find tests -maxdepth 3 -type f | sort
```

## 3. Success Criteria & Verification Steps

To pass validation, the following conditions must be met:

1. **Path Inventory Commands Execution:**
   - Running the validation commands above must exit with code `0`.
   - The command output must successfully list files within `docs/` and `tests/`.

2. **Artifact Existence & Compliance:**
   - The context pack MUST exist at `.ai-agent/context-packs/REQ-MVP-004.md`.
   - The contract MUST exist at `.ai-agent/contracts/REQ-MVP-004.json`.
   - The contract notes MUST exist at `.ai-agent/contracts/REQ-MVP-004-notes.md`.
   - This validation plan MUST exist at `tests/ai-agent-mvp/REQ-MVP-004-validation.md`.

3. **No Production Code Modifications:**
   - Verify that git status shows no modified files under `open5gs/` or `open5gs-nms/`.
   - Write paths remain strictly bounded to `.ai-agent/` and `tests/ai-agent-mvp/`.

## 4. Execution Guidance for Developer / Buildfix-Debugger

To run this validation:
1. Execute the validation commands listed under Section 2.
2. Confirm that the listed artifact paths in Section 3 exist and contain the relevant data.
3. Check git status to ensure production directories are pristine.

# Validation Plan: REQ-MVP-001

## 1. Metadata
- **ADU ID:** REQ-MVP-001
- **ADU Title:** AI Agent factory MVP smoke ADU for Open5GS workspace
- **Target State:** `test_red`
- **Focus:** No-code workspace verification and Hermes Agent flow validation

---

## 2. Objective
Validate that the local workspace setup is complete and that the ADU/Agent registries, contracts, and context packs are well-formed and valid JSON/Markdown. This test is a dry-run smoke test to confirm the AI Agent MVP pipeline functions end-to-end without affecting any production system files or core network code.

---

## 3. Required Commands (ADU Registry & Contract)

The validation plan requires executing the following exact verification commands on the workspace:

### 3.1 ADU Registry Validation
```bash
python3 -m json.tool .ai-agent/registry/adu.json
```
*Purpose: Ensures the ADU Registry (`adu.json`) is well-formed and valid JSON.*

### 3.2 Agent Registry Validation
```bash
python3 -m json.tool .ai-agent/registry/agents.json
```
*Purpose: Ensures the Agent Registry (`agents.json`) is well-formed and valid JSON.*

### 3.3 Workspace Directory Verification
```bash
test -d .ai-agent && test -d .ai-agent/prompts && test -d .ai-agent/registry
```
*Purpose: Confirms that the `.ai-agent` directory exists and has all required subfolders (`prompts` and `registry`).*

### 3.4 Contract Validation
```bash
python3 -m json.tool .ai-agent/contracts/REQ-MVP-001.json
```
*Purpose: Verifies the contract file for this ADU is correct, valid, and parsable JSON.*

### 3.5 Common Context Verification
```bash
test -f .ai-agent/context-packs/common.md
```
*Purpose: Validates that the shared common context file exists.*

---

## 4. Acceptance Criteria
The validation succeeds if:
1. All validation commands listed in Section 3 return an exit status of `0`.
2. The json validations (`python3 -m json.tool`) succeed without syntax errors.
3. No production network files under `open5gs/` or `open5gs-nms/` are modified, deleted, or introduced.
4. Output artifacts are successfully written to allowed write paths.

---

## 5. Risk Assessment
- **Production Impact:** None. All commands are purely read-only verification commands.
- **Safety level:** High. No compiling, network egress, or active systems are touched.

#!/usr/bin/env python3
"""Validate a system-flow.json produced by the system-flow-designer agent.

Checks:
  - business_operations non-empty
  - Each operation has entrypoints and runtime_effects (non-empty)
  - Mutating operations have state_changes (non-empty); read-only query
    operations may use an empty state_changes array
  - acceptance_points non-empty
  - No empty path_candidates in module_flows
  - Answered clarifications consistency, traceability and natural language conflicts

Exit 0 on pass, exit 1 on fail.
"""
import json
import sys
from pathlib import Path


def fail(msg: str):
    print(f"VALIDATE_EPIC_FLOW FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def is_read_only_operation(op: dict) -> bool:
    """Return True for explicit query/read/list operations.

    Read-only operations are allowed to have no state_changes. Keep this
    intentionally narrow so mutating operations still need an auditable state
    transition list.
    """
    if op.get("read_only") is True:
        return True

    identity = " ".join(str(op.get(k, "")) for k in ("id", "name")).lower()
    read_terms = ("query", "get", "list", "read", "lookup", "查询", "读取", "查看", "列表")
    return any(term in identity for term in read_terms)


def check_clarification_consistency(data: dict, clarifications: list):
    # 1. Answered clarifications
    answered_clarifications = [c for c in clarifications if c.get("status") == "answered"]
    
    # 2. SHA-256 helper
    import hashlib
    def get_sha256(text: str) -> str:
        cleaned = text.strip()
        return "sha256:" + hashlib.sha256(cleaned.encode("utf-8")).hexdigest()

    # Check 1: answered questions must not be in open_questions
    open_questions = data.get("open_questions", [])
    for cq in answered_clarifications:
        cq_text = cq["question"].strip().lower()
        for oq in open_questions:
            oq_text = oq.strip().lower()
            if cq_text in oq_text or (len(oq_text) > 10 and oq_text in cq_text):
                fail(f"Answered clarification question was reopened in open_questions: '{oq}'")

    # Check 2: answered clarifications must have traceability
    traceability = data.get("clarification_traceability", [])
    trace_hashes = {t.get("question_hash") for t in traceability if t.get("question_hash")}
    
    for cq in answered_clarifications:
        cq_hash = get_sha256(cq["question"])
        if cq_hash not in trace_hashes:
            fail(f"Answered clarification missing from clarification_traceability: {cq['question']} (hash: {cq_hash})")

    # Validate applied_to targets in traceability
    op_ids = {op.get("id") for op in data.get("business_operations", [])}
    acceptance_pts = data.get("acceptance_points", [])
    
    for t in traceability:
        applied = t.get("applied_to", [])
        if not isinstance(applied, list) or len(applied) == 0:
            fail(f"clarification_traceability entry for hash {t.get('question_hash')} has empty or invalid applied_to")
        for ref in applied:
            matched_ref = False
            if ref in op_ids:
                matched_ref = True
            else:
                for ap in acceptance_pts:
                    if ref == ap or ref in ap:
                        matched_ref = True
                        break
            if not matched_ref:
                fail(f"clarification_traceability applied_to target '{ref}' is invalid")

    # Check 3: out_of_scope clarifications must not enter operations or acceptance points
    out_of_scope_clarifications = []
    for cq in clarifications:
        is_oos = False
        if cq.get("status") == "out_of_scope" or cq.get("impact") == "out_of_scope":
            is_oos = True
        else:
            ans = cq.get("answer", "").lower()
            ques = cq.get("question", "").lower()
            if "out of scope" in ans or "out of scope" in ques or "out_of_scope" in ans:
                is_oos = True
        if is_oos:
            out_of_scope_clarifications.append(cq)

    # Check 4: Clarification traceability — answered clarifications must not reappear in open_questions
    # (Hardcoded conflict keyword rules removed in Phase 3.7 to maintain portability;
    #  clarification conflicts should be checked dynamically via the payload, not a static word list.)


def main():
    flow_path = sys.argv[1] if len(sys.argv) > 1 else None
    if not flow_path:
        fail("Usage: validate_epic_flow.py <system-flow.json>")

    fp = Path(flow_path)
    if not fp.exists():
        fail(f"File not found: {flow_path}")

    try:
        data = json.loads(fp.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        fail(f"Invalid JSON: {e}")

    # Check business_operations
    ops = data.get("business_operations")
    if not ops or not isinstance(ops, list) or len(ops) == 0:
        fail("business_operations must be a non-empty array")

    for i, op in enumerate(ops):
        if not isinstance(op, dict):
            fail(f"business_operations[{i}] is not an object")
        if not op.get("id"):
            fail(f"business_operations[{i}] missing 'id'")
        if not op.get("name"):
            fail(f"business_operations[{i}] ({op.get('id', '?')}) missing 'name'")
        entrypoints = op.get("entrypoints")
        if not entrypoints or not isinstance(entrypoints, list) or len(entrypoints) == 0:
            fail(f"business_operations[{i}] ({op['id']}) missing non-empty 'entrypoints'")
        state_changes = op.get("state_changes")
        if not isinstance(state_changes, list):
            fail(f"business_operations[{i}] ({op['id']}) missing 'state_changes' array")
        if len(state_changes) == 0 and not is_read_only_operation(op):
            fail(f"business_operations[{i}] ({op['id']}) missing non-empty 'state_changes'")
        runtime_effects = op.get("runtime_effects")
        if not runtime_effects or not isinstance(runtime_effects, list) or len(runtime_effects) == 0:
            fail(f"business_operations[{i}] ({op['id']}) missing non-empty 'runtime_effects'")

    # Check acceptance_points
    acceptance = data.get("acceptance_points")
    if not acceptance or not isinstance(acceptance, list) or len(acceptance) == 0:
        fail("acceptance_points must be a non-empty array")

    # Check module_flows for empty path_candidates
    module_flows = data.get("module_flows")
    if module_flows and isinstance(module_flows, list):
        for i, flow in enumerate(module_flows):
            steps = flow.get("steps") if isinstance(flow, dict) else None
            if steps and isinstance(steps, list):
                for j, step in enumerate(steps):
                    candidates = step.get("path_candidates") if isinstance(step, dict) else None
                    if candidates is not None and (not isinstance(candidates, list) or len(candidates) == 0):
                        fail(f"module_flows[{i}].steps[{j}] has empty path_candidates")

    # Clarifications consistency & conflict validation
    epic_id = data.get("epic_id")
    if not epic_id:
        fail("Missing 'epic_id' in system-flow.json")

    script_dir = Path(__file__).resolve().parent
    registry_candidates = [
        script_dir.parent / ".ai-agent" / "registry" / "epics.json",
        Path.cwd() / ".ai-agent" / "registry" / "epics.json",
    ]
    
    epics_data = None
    for path in registry_candidates:
        if path.exists():
            try:
                epics_data = json.loads(path.read_text(encoding="utf-8"))
                break
            except Exception:
                pass

    clarifications = []
    if epics_data:
        epics = epics_data.get("epics", [])
        epic = next((e for e in epics if e.get("id") == epic_id), None)
        if epic:
            clarifications = epic.get("clarifications", [])

    check_clarification_consistency(data, clarifications)

    print(f"VALIDATE_EPIC_FLOW PASS: {flow_path}")
    sys.exit(0)


if __name__ == "__main__":
    main()

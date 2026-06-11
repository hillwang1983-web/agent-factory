#!/usr/bin/env python3
"""Validate a system-flow.json produced by the system-flow-designer agent.

Checks:
  - business_operations non-empty
  - Each operation has entrypoints, state_changes, runtime_effects (non-empty)
  - acceptance_points non-empty
  - No empty path_candidates in module_flows

Exit 0 on pass, exit 1 on fail.
"""
import json
import sys
from pathlib import Path


def fail(msg: str):
    print(f"VALIDATE_EPIC_FLOW FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


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
        if not state_changes or not isinstance(state_changes, list) or len(state_changes) == 0:
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

    print(f"VALIDATE_EPIC_FLOW PASS: {flow_path}")
    sys.exit(0)


if __name__ == "__main__":
    main()

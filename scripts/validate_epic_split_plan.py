#!/usr/bin/env python3
"""Validate a split-plan.json produced by the adu-splitter agent.

Checks:
  - Child ADU IDs are unique
  - Dependencies form a DAG (no cycles)
  - All depends_on references exist in child ADU list
  - Each child ADU has scope, goal, allowed_write_paths, acceptance_summary
  - decision == 'single' => exactly 1 child ADU
  - decision == 'split_required' => at least 2 child ADUs

Exit 0 on pass, exit 1 on fail.
"""
import json
import sys
from pathlib import Path


def fail(msg: str):
    print(f"VALIDATE_EPIC_SPLIT_PLAN FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def has_cycle_dfs(node: str, adj: dict, visited: set, rec_stack: set) -> bool:
    visited.add(node)
    rec_stack.add(node)
    for neighbor in adj.get(node, []):
        if neighbor not in visited:
            if has_cycle_dfs(neighbor, adj, visited, rec_stack):
                return True
        elif neighbor in rec_stack:
            return True
    rec_stack.discard(node)
    return False


def main():
    plan_path = sys.argv[1] if len(sys.argv) > 1 else None
    if not plan_path:
        fail("Usage: validate_epic_split_plan.py <split-plan.json>")

    fp = Path(plan_path)
    if not fp.exists():
        fail(f"File not found: {plan_path}")

    try:
        data = json.loads(fp.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        fail(f"Invalid JSON: {e}")

    decision = data.get("decision")
    if decision not in ("single_adu", "split_required"):
        fail(f"decision must be 'single_adu' or 'split_required', got: {decision}")

    child_adus = data.get("child_adus")
    if not child_adus or not isinstance(child_adus, list):
        fail("child_adus must be a non-empty array")

    # Validate child ADU fields
    adu_ids = set()
    for i, adu in enumerate(child_adus):
        if not isinstance(adu, dict):
            fail(f"child_adus[{i}] is not an object")
        adu_id = adu.get("id")
        if not adu_id:
            fail(f"child_adus[{i}] missing 'id'")
        if adu_id in adu_ids:
            fail(f"Duplicate child ADU id: {adu_id}")
        adu_ids.add(adu_id)
        if not adu.get("title"):
            fail(f"child ADU {adu_id} missing 'title'")
        if not adu.get("goal"):
            fail(f"child ADU {adu_id} missing 'goal'")
        if not adu.get("scope"):
            fail(f"child ADU {adu_id} missing 'scope'")
        write_paths = adu.get("allowed_write_paths")
        if not write_paths or not isinstance(write_paths, list):
            fail(f"child ADU {adu_id} missing or empty 'allowed_write_paths'")
        if not adu.get("acceptance_summary"):
            fail(f"child ADU {adu_id} missing 'acceptance_summary'")

    # Check decision vs child count
    if decision == "single_adu" and len(child_adus) != 1:
        fail(f"decision is 'single_adu' but found {len(child_adus)} child ADUs (expected 1)")
    if decision == "split_required" and len(child_adus) < 2:
        fail(f"decision is 'split_required' but found only {len(child_adus)} child ADUs (need >= 2)")

    # Validate dependencies
    deps = data.get("dependencies") or []
    if not isinstance(deps, list):
        fail("dependencies must be an array")

    dep_ids = set()
    adj = {}
    for i, dep in enumerate(deps):
        if not isinstance(dep, dict):
            fail(f"dependencies[{i}] is not an object")
        frm = dep.get("from")
        to = dep.get("to")
        if not frm:
            fail(f"dependencies[{i}] missing 'from'")
        if not to:
            fail(f"dependencies[{i}] missing 'to'")
        if frm not in adu_ids:
            fail(f"dependency 'from' references unknown child ADU: {frm}")
        if to not in adu_ids:
            fail(f"dependency 'to' references unknown child ADU: {to}")
        if frm == to:
            fail(f"Self-dependency not allowed: {frm} -> {to}")
        dep_ids.add(f"{frm}->{to}")
        if frm not in adj:
            adj[frm] = []
        adj[frm].append(to)

    # Check for cycles
    visited = set()
    for node in adu_ids:
        if node not in visited:
            if has_cycle_dfs(node, adj, visited, set()):
                fail("Dependency graph contains a cycle")

    print(f"VALIDATE_EPIC_SPLIT_PLAN PASS: {plan_path} (decision={decision}, {len(child_adus)} child ADUs, {len(deps)} deps)")
    sys.exit(0)


if __name__ == "__main__":
    main()

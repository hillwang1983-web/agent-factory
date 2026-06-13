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

    # Pre-apply path derivation rules
    import fnmatch
    import os
    rules_env = os.environ.get("AGENT_FACTORY_RULES_PATH")
    if rules_env:
        rules_path = Path(rules_env)
    else:
        rules_path = Path(__file__).resolve().parents[1] / ".ai-agent" / "policies" / "path-derivation-rules.json"
    if rules_path.exists():
        try:
            rules_data = json.loads(rules_path.read_text(encoding="utf-8"))
            rules = rules_data.get("rules", [])

            def matches_glob_list(path, glob_list):
                for glob in glob_list:
                    if glob.endswith('/') and (path.startswith(glob) or path + '/' == glob):
                        return True
                    if fnmatch.fnmatch(path, glob):
                        return True
                    if glob.startswith("**/"):
                        base_glob = glob[3:]
                        if fnmatch.fnmatch(path, base_glob) or fnmatch.fnmatch(path, "*/" + base_glob):
                            return True
                    if fnmatch.fnmatch(path, '*/' + glob):
                        return True
                return False

            if rules:
                for adu in child_adus:
                    write_paths = adu.get("allowed_write_paths", [])
                    if not isinstance(write_paths, list):
                        continue

                    read_paths = adu.get("allowed_read_paths", [])

                    changed = True
                    while changed:
                        changed = False
                        for rule in rules:
                            when_patterns = rule.get("when_requested_path_matches", [])
                            derived_patterns = rule.get("allow_derived_paths", [])

                            has_match = False
                            for wp in write_paths:
                                if matches_glob_list(wp, when_patterns):
                                    has_match = True
                                    break

                            if has_match:
                                for dp in derived_patterns:
                                    dp_added = False
                                    if dp not in write_paths:
                                        write_paths.append(dp)
                                        changed = True
                                        dp_added = True
                                    if read_paths and dp not in read_paths:
                                        read_paths.append(dp)
                                        changed = True
                                        dp_added = True

                                    if dp_added:
                                        if "write_path_expansions" not in adu:
                                            adu["write_path_expansions"] = []
                                        import hashlib
                                        path_hash = hashlib.md5(dp.encode('utf-8')).hexdigest()[:8]
                                        req_id = f"auto-{rule.get('id')}-{path_hash}"
                                        exists = any(exp.get("request_id") == req_id for exp in adu["write_path_expansions"])
                                        if not exists:
                                            import datetime
                                            now_str = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
                                            adu["write_path_expansions"].append({
                                                "request_id": req_id,
                                                "source_agent": "epic_splitter",
                                                "requested_paths": [dp],
                                                "approved_paths": [dp],
                                                "decision": "auto_approved",
                                                "reason": f"Epic split pre-derivation rule {rule.get('id')}: {rule.get('reason', '')}",
                                                "created_at": now_str,
                                                "updated_at": now_str
                                            })

                    adu["allowed_write_paths"] = write_paths
                    if read_paths:
                        adu["allowed_read_paths"] = read_paths

            # Write back the expanded split-plan
            fp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            print(f"VALIDATE_EPIC_SPLIT_PLAN WARNING: Failed to pre-apply derivation rules: {e}", file=sys.stderr)

    print(f"VALIDATE_EPIC_SPLIT_PLAN PASS: {plan_path} (decision={decision}, {len(child_adus)} child ADUs, {len(deps)} deps)")
    sys.exit(0)


if __name__ == "__main__":
    main()

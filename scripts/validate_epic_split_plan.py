#!/usr/bin/env python3
"""Validate a split-plan.json produced by the adu-splitter agent.

Checks:
  - Child ADU IDs are unique
  - Dependencies form a DAG (no cycles)
  - All depends_on references exist in child ADU list
  - Each child ADU has scope, goal, allowed_write_paths, acceptance_summary
  - decision == 'single' => exactly 1 child ADU
  - decision == 'split_required' => at least 2 child ADUs
  - semantics must be 'prerequisite_to_dependent'
  - Epic-level acceptance points covered by child ADUs
  - High risk paths must have risk_justification
  - Verify path in required_commands is in allowed paths

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


def check_split_semantics(data: dict, profile_data: dict, system_flow_data: dict):
    child_adus = data.get("child_adus") or []
    adu_ids = {adu.get("id") for adu in child_adus if adu.get("id")}

    # 1. Dependency semantics validation
    deps = data.get("dependencies") or []
    for i, dep in enumerate(deps):
        semantics = dep.get("semantics")
        if not semantics:
            fail(f"dependencies[{i}] missing 'semantics'")
        if semantics != "prerequisite_to_dependent":
            fail(f"dependencies[{i}] semantics must be 'prerequisite_to_dependent'")

    # 2. Acceptance coverage validation
    coverage = data.get("acceptance_coverage", [])
    if not isinstance(coverage, list):
        fail("acceptance_coverage must be an array")
        
    covered_ids = set()
    for idx, cov in enumerate(coverage):
        acc_id = cov.get("acceptance_id")
        covered_by = cov.get("covered_by", [])
        if not acc_id:
            fail(f"acceptance_coverage[{idx}] missing 'acceptance_id'")
        if not covered_by or not isinstance(covered_by, list):
            fail(f"acceptance_coverage[{idx}] missing or empty 'covered_by'")
        for adu_id in covered_by:
            if adu_id not in adu_ids:
                fail(f"acceptance_coverage[{idx}] references unknown child ADU: {adu_id}")
        covered_ids.add(acc_id)
        
    if system_flow_data:
        sf_pts = system_flow_data.get("acceptance_points", [])
        for pt in sf_pts:
            matched = False
            for acc_id in covered_ids:
                if acc_id == pt or acc_id in pt or pt in acc_id:
                    matched = True
                    break
            if not matched:
                fail(f"Epic acceptance point '{pt}' is not covered by any child ADU in acceptance_coverage")

    # 3. Verify path in required_commands is in allowed paths
    for adu in child_adus:
        req_cmds = adu.get("required_commands", [])
        allowed_paths = adu.get("allowed_write_paths", []) + adu.get("allowed_read_paths", [])
        for cmd in req_cmds:
            words = cmd.split()
            for w in words:
                w_clean = w.strip("'\"(),")
                if "/" in w_clean or w_clean.endswith((".c", ".py", ".js", ".ts", ".sh")):
                    if "test" in w_clean or w_clean.startswith(("./", "lib/")):
                        matched_path = False
                        for ap in allowed_paths:
                            if w_clean == ap or w_clean.startswith(ap) or ap.startswith(w_clean):
                                matched_path = True
                                break
                        if not matched_path:
                            fail(f"child ADU {adu['id']} required command '{cmd}' references path '{w_clean}' which is not in allowed_read_paths or allowed_write_paths")

    # 4. WebUI requirement checks (both frontend and backend paths)
    for adu in child_adus:
        title_goal = (adu.get("title", "") + " " + adu.get("goal", "")).lower()
        write_paths_str = " ".join(adu.get("allowed_write_paths", [])).lower()
        if "webui" in title_goal or "ui" in title_goal or "webui" in write_paths_str:
            has_frontend = False
            has_backend = False
            for wp in adu.get("allowed_write_paths", []):
                wp_lower = wp.lower()
                if "webui" in wp_lower or "frontend" in wp_lower or "src/pages" in wp_lower:
                    has_frontend = True
                if "backend" in wp_lower or "server" in wp_lower or "routes" in wp_lower or "api" in wp_lower:
                    has_backend = True
            if not has_frontend or not has_backend:
                fail(f"child ADU {adu['id']} has UI requirements but allowed_write_paths is missing either frontend or backend paths")

    # 5. Public library changes check (must include build manifest)
    for adu in child_adus:
        has_lib_change = any(wp.startswith("lib/") for wp in adu.get("allowed_write_paths", []))
        if has_lib_change:
            has_build_manifest = False
            all_paths = adu.get("allowed_write_paths", []) + adu.get("allowed_read_paths", [])
            for p in all_paths:
                if "meson.build" in p or "makefile" in p.lower() or "package.json" in p:
                    has_build_manifest = True
                    break
            if not has_build_manifest:
                fail(f"child ADU {adu['id']} modifies public library in lib/ but lacks a build manifest (e.g. meson.build)")

    # 6. High risk paths check
    if profile_data:
        risk_paths = profile_data.get("risk_paths", {})
        for adu in child_adus:
            write_paths = adu.get("allowed_write_paths", [])
            hit_risk = False
            hit_risk_path = ""
            for wp in write_paths:
                for rp in risk_paths:
                    if wp.startswith(rp) or rp.startswith(wp):
                        hit_risk = True
                        hit_risk_path = rp
                        break
                if hit_risk:
                    break
                    
            if hit_risk:
                justification = adu.get("risk_justification")
                if not justification or justification.strip() == "":
                    fail(f"child ADU {adu['id']} modifies high-risk path '{hit_risk_path}' but missing 'risk_justification'")


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

    # Load system-flow.json and project-profile.json for semantic quality gates
    system_flow_data = None
    system_flow_path = fp.parent / "system-flow.json"
    if system_flow_path.exists():
        try:
            system_flow_data = json.loads(system_flow_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    profile_data = {}
    script_dir = Path(__file__).resolve().parent
    profile_candidates = [
        script_dir.parent / ".agent-factory" / "project-profile.json",
        Path.cwd() / ".agent-factory" / "project-profile.json",
    ]
    for path in profile_candidates:
        if path.exists():
            try:
                profile_data = json.loads(path.read_text(encoding="utf-8"))
                break
            except Exception:
                pass

    check_split_semantics(data, profile_data, system_flow_data)

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

            def rule_applies_to_project(rule):
                project_glob = rule.get("project_glob")
                if not project_glob or project_glob == "*":
                    return True
                patterns = project_glob if isinstance(project_glob, list) else [project_glob]
                identifiers = {
                    str(data.get("project_id") or ""),
                    str(profile_data.get("project_id") or ""),
                    str(profile_data.get("name") or ""),
                    fp.parents[3].name if len(fp.parents) > 3 else "",
                    Path.cwd().name,
                }
                return any(
                    identifier and fnmatch.fnmatch(identifier.lower(), str(pattern).lower())
                    for identifier in identifiers
                    for pattern in patterns
                )

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
                            if not rule_applies_to_project(rule):
                                continue
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

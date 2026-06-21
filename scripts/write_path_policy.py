#!/usr/bin/env python3
import argparse
import json
import os
import sys
import fnmatch
from pathlib import Path

def clean_and_validate_path(p):
    p = p.strip().replace('\\', '/')
    if not p:
        raise ValueError("Path must not be empty")
    if p.startswith('/'):
        raise ValueError(f"Path must not start with '/' — got '{p}'")
    if '..' in p.split('/'):
        raise ValueError(f"Path must not contain '..' — got '{p}'")
    if '\0' in p:
        raise ValueError("Path contains NUL bytes")
    return os.path.normpath(p).replace('\\', '/')

def is_path_covered(path, allowed_paths):
    path_parts = Path(os.path.normpath(path)).parts
    for ap in allowed_paths:
        ap_parts = Path(os.path.normpath(ap)).parts
        if len(path_parts) >= len(ap_parts) and path_parts[:len(ap_parts)] == ap_parts:
            return True
    return False

def matches_glob_list(path, glob_list):
    for glob in glob_list:
        if glob.endswith('/') and (path.startswith(glob) or path + '/' == glob):
            return True
        if fnmatch.fnmatch(path, glob):
            return True
        if "**/ " not in glob and glob.startswith("**/"):
            base_glob = glob[3:]
            if fnmatch.fnmatch(path, base_glob) or fnmatch.fnmatch(path, "*/" + base_glob):
                return True
        if fnmatch.fnmatch(path, '*/' + glob):
            return True
    return False

def rule_applies_to_project(rule, adu_entry, repo_root):
    project_glob = rule.get("project_glob")
    if not project_glob or project_glob == "*":
        return True
    patterns = project_glob if isinstance(project_glob, list) else [project_glob]
    identifiers = {
        str(adu_entry.get("project_id") or ""),
        str(adu_entry.get("project_name") or ""),
        Path(repo_root).name,
    }
    return any(
        identifier and fnmatch.fnmatch(identifier.lower(), str(pattern).lower())
        for identifier in identifiers
        for pattern in patterns
    )

def main():
    parser = argparse.ArgumentParser(description="Evaluate ADU write path expansions")
    parser.add_argument("--adu", required=True, help="ADU ID")
    parser.add_argument("--requested-paths", required=True, help="Comma-separated paths or JSON string array")
    parser.add_argument("--repo-root", help="Repository root path")
    parser.add_argument("--rules", help="Custom path-derivation-rules.json path")
    parser.add_argument("--registry-dir", help="Global registry directory path")
    args = parser.parse_args()

    adu_id = args.adu
    if args.repo_root:
        root = Path(args.repo_root).resolve()
    else:
        root = Path(__file__).resolve().parents[1]

    # Resolve paths to evaluate
    raw_req = args.requested_paths.strip()
    if raw_req.startswith('[') and raw_req.endswith(']'):
        try:
            req_list = json.loads(raw_req)
        except Exception as e:
            print(f"Error parsing requested paths JSON: {e}", file=sys.stderr)
            return 1
    else:
        req_list = [p.strip() for p in raw_req.split(',') if p.strip()]

    cleaned_requests = []
    for p in req_list:
        try:
            cleaned_requests.append(clean_and_validate_path(p))
        except ValueError as e:
            # Output critical error result if any path validation fails
            print(json.dumps({
                "result": "blocked",
                "decision": "blocked",
                "approved_paths": [],
                "pending_paths": [],
                "blocked_paths": [p],
                "risk": "critical",
                "reason": f"Path validation error: {str(e)}"
            }, ensure_ascii=False, indent=2))
            return 0

    # Load ADU registry to check current allowed write paths
    if args.registry_dir:
        global_registry = Path(args.registry_dir).resolve()
    else:
        registry_dir_env = os.environ.get("AGENT_FACTORY_REGISTRY_DIR")
        if registry_dir_env:
            global_registry = Path(registry_dir_env).resolve()
        else:
            projects_registry_env = os.environ.get("AGENT_FACTORY_PROJECTS_REGISTRY")
            if projects_registry_env:
                global_registry = Path(projects_registry_env).parent.resolve()
            else:
                global_registry = root / ".ai-agent" / "registry"

    adu_json_path = global_registry / "adu.json"
    if not adu_json_path.exists():
        print(f"Error: ADU registry does not exist at {adu_json_path}", file=sys.stderr)
        return 1

    try:
        adu_registry = json.loads(adu_json_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"Error parsing ADU registry: {e}", file=sys.stderr)
        return 1

    adu_entry = None
    for item in adu_registry.get("adus", []):
        if item.get("id") == adu_id:
            adu_entry = item
            break

    if not adu_entry:
        print(f"Error: ADU {adu_id} not found in registry", file=sys.stderr)
        return 1

    adu_allowed_paths = adu_entry.get("allowed_write_paths", [])

    # Load rules
    rules_data = {}
    if args.rules:
        rules_path = Path(args.rules)
    else:
        rules_path = root / ".ai-agent" / "policies" / "path-derivation-rules.json"

    if rules_path.exists():
        try:
            rules_data = json.loads(rules_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    # Default rules fallback
    blocked_patterns = rules_data.get("blocked_paths", [
        ".git/",
        ".ai-agent/registry/projects.json",
        ".ai-agent/registry/agent-model-settings.json",
        ".ai-agent/registry/adu.json",
        ".ai-agent/registry/runs.json",
        ".ai-agent/registry/epics.json",
        ".ai-agent/registry/token-budget.json",
        ".ai-agent/registry/write-path-expansion-requests.json",
        "**/.env",
        ".env",
        "*.env",
        "**/id_rsa",
        "**/secrets*",
        "secrets*"
    ])
    high_risk_prefixes = rules_data.get("high_risk_prefixes", [
        "src/security/",
        "src/auth/",
        "migrations/",
        "infrastructure/"
    ])
    rules = rules_data.get("rules", [])

    approved = []
    pending = []
    blocked = []
    reasons = []
    max_risk = "low"

    for rp in cleaned_requests:
        # 1. Check if already covered
        if is_path_covered(rp, adu_allowed_paths):
            approved.append(rp)
            continue

        # 2. Check if blocked
        if matches_glob_list(rp, blocked_patterns):
            blocked.append(rp)
            reasons.append(f"Blocked sensitive path: {rp}")
            max_risk = "critical"
            continue

        # 3. Check derivation rules
        matched_rule = None
        for rule in rules:
            if not rule_applies_to_project(rule, adu_entry, root):
                continue
            derived_patterns = rule.get("allow_derived_paths", [])
            if matches_glob_list(rp, derived_patterns):
                when_patterns = rule.get("when_requested_path_matches", [])
                # Does the ADU have baseline paths matching "when_requested_path_matches"
                if any(matches_glob_list(ap, when_patterns) for ap in adu_allowed_paths):
                    matched_rule = rule
                    break

        if matched_rule:
            approved.append(rp)
            reasons.append(f"Matched rule {matched_rule['id']}: {matched_rule.get('reason', '')}")
            continue

        # 4. Not derived, check risk
        if any(rp.startswith(prefix) for prefix in high_risk_prefixes):
            pending.append(rp)
            reasons.append(f"High risk path prefix: {rp}")
            if max_risk != "critical":
                max_risk = "high"
        else:
            pending.append(rp)
            reasons.append(f"Medium risk path: {rp}")
            if max_risk not in ("critical", "high"):
                max_risk = "medium"

    # Evaluate final result
    if blocked:
        result = "blocked"
        decision = "blocked"
    elif pending:
        result = "pending"
        decision = "pending_human_approval"
    else:
        result = "approved"
        decision = "auto_approved"

    output = {
        "result": result,
        "decision": decision,
        "approved_paths": approved,
        "pending_paths": pending,
        "blocked_paths": blocked,
        "risk": max_risk,
        "reason": "; ".join(reasons) if reasons else "All paths already covered"
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
import sys
import json
import argparse
from pathlib import Path

def normalize_repo_relative_path(path_str):
    if not path_str:
        return ""
    p = path_str.replace("\\", "/").strip()
    # Remove leading dots/slashes
    while p.startswith("./") or p.startswith("/") or p.startswith("../"):
        if p.startswith("./"):
            p = p[2:]
        elif p.startswith("/"):
            p = p[1:]
        elif p.startswith("../"):
            p = p[3:]
    return p.strip()

def is_path_allowed_by_allowlist(path_value, allowed_paths):
    normalized = normalize_repo_relative_path(path_value)
    if not normalized:
        return False
    for allowed in allowed_paths or []:
        allowed_normalized = normalize_repo_relative_path(allowed)
        if not allowed_normalized:
            continue
        if allowed_normalized.endswith("/"):
            if normalized.startswith(allowed_normalized):
                return True
        elif normalized == allowed_normalized:
            return True
    return False

def main():
    parser = argparse.ArgumentParser(description="Validate rework plan schema and permissions.")
    parser.add_argument("--plan-path", required=True, help="Path to rework plan JSON")
    parser.add_argument("--allowed-paths", default="", help="Comma-separated allowed write paths")
    args = parser.parse_args()

    plan_path = Path(args.plan_path)
    allowed_list = [p.strip() for p in args.allowed_paths.split(",") if p.strip()]

    if not plan_path.is_file():
        print(f"FAIL: Rework plan file does not exist at {plan_path}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(plan_path, "r", encoding="utf-8") as f:
            plan = json.load(f)
    except Exception as e:
        print(f"FAIL: Failed to parse rework plan JSON: {e}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(plan, dict):
        print("FAIL: Rework plan must be a JSON object.", file=sys.stderr)
        sys.exit(1)

    # 1. Validate Schema
    must_fix = plan.get("must_fix_now")
    if not isinstance(must_fix, list):
        print("FAIL: 'must_fix_now' field is missing or not a list.", file=sys.stderr)
        sys.exit(1)

    requested_paths = []

    # Check additional_write_paths
    additional = plan.get("additional_write_paths", [])
    if not isinstance(additional, list):
        print("FAIL: 'additional_write_paths' must be a list of paths.", file=sys.stderr)
        sys.exit(1)
    for p in additional:
        if not isinstance(p, str):
            print(f"FAIL: additional_write_paths item {p} is not a string.", file=sys.stderr)
            sys.exit(1)
        requested_paths.append(p)

    for idx, item in enumerate(must_fix):
        if not isinstance(item, dict):
            print(f"FAIL: must_fix_now item at index {idx} is not a JSON object.", file=sys.stderr)
            sys.exit(1)

        affected = item.get("affected_paths")
        if not isinstance(affected, list):
            print(f"FAIL: must_fix_now item at index {idx} is missing 'affected_paths' or it is not a list.", file=sys.stderr)
            sys.exit(1)
        if len(affected) == 0:
            print(f"FAIL: must_fix_now item at index {idx} has an empty 'affected_paths' list.", file=sys.stderr)
            sys.exit(1)

        for p in affected:
            if not isinstance(p, str):
                print(f"FAIL: affected_paths item {p} in must_fix_now item {idx} is not a string.", file=sys.stderr)
                sys.exit(1)
            requested_paths.append(p)

    # 2. Check path permissions (allowed paths)
    blocked_paths = []
    for path_value in requested_paths:
        normalized = normalize_repo_relative_path(path_value)
        if normalized and not is_path_allowed_by_allowlist(normalized, allowed_list):
            blocked_paths.append(normalized)

    if blocked_paths:
        blocked_str = ",".join(blocked_paths)
        print(f"HUMAN_GATE: Rework plan contains write paths outside allowed_write_paths. blocked paths: {blocked_str}", file=sys.stderr)
        sys.exit(20)

    print("PASS: Rework plan validated successfully.")
    sys.exit(0)

if __name__ == "__main__":
    main()

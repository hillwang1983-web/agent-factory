#!/usr/bin/env python3
import sys
import json
import argparse
from pathlib import Path

def validate_raw_path(path_str):
    if not isinstance(path_str, str):
        raise ValueError("Path must be a string.")

    # 1. Blank string
    if not path_str.strip():
        raise ValueError("Path must not be empty or whitespace-only.")

    # 2. NUL character
    if "\x00" in path_str:
        raise ValueError("Path must not contain NUL characters.")

    p = path_str.replace("\\", "/").strip()

    # 3. Absolute path
    if p.startswith("/"):
        raise ValueError(f"Path '{path_str}' must not be an absolute path.")
    if len(p) >= 2 and p[0].isalpha() and p[1] == ":":
        raise ValueError(f"Path '{path_str}' must not be an absolute path.")

    # Allow a single trailing slash, but reject trailing double slashes
    if p.endswith("/") and not p.endswith("//"):
        p_for_parts = p[:-1]
    elif p.endswith("//"):
        raise ValueError(f"Path '{path_str}' must not end with multiple slashes.")
    else:
        p_for_parts = p

    # 4. Traversal components and empty/dot components
    parts = p_for_parts.split("/")
    if ".." in parts:
        raise ValueError(f"Path '{path_str}' must not contain path traversal components ('..').")
    if "." in parts:
        raise ValueError(f"Path '{path_str}' must not contain '.' components.")
    if "" in parts:
        raise ValueError(f"Path '{path_str}' must not contain empty components.")

def normalize_repo_relative_path(path_str):
    validate_raw_path(path_str)
    return path_str.replace("\\", "/").strip()

def is_path_allowed_by_allowlist(normalized_path, allowed_paths):
    if not normalized_path:
        return False
    for allowed in allowed_paths or []:
        allowed_normalized = allowed.replace("\\", "/").strip()
        if not allowed_normalized:
            continue
        if allowed_normalized.endswith("/"):
            if normalized_path.startswith(allowed_normalized):
                return True
        elif normalized_path == allowed_normalized:
            return True
    return False

def main():
    parser = argparse.ArgumentParser(description="Validate rework plan schema and permissions.")
    parser.add_argument("--plan-path", required=True, help="Path to rework plan JSON")
    parser.add_argument("--allowed-paths", default="", help="Comma-separated allowed write paths")
    parser.add_argument("--adu", required=True, help="ADU ID to match against plan adu_id")
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
    # adu_id matching
    if plan.get("adu_id") != args.adu:
        print(f"FAIL: Rework plan adu_id '{plan.get('adu_id')}' does not match expected ADU ID '{args.adu}'.", file=sys.stderr)
        sys.exit(1)

    # version check
    if plan.get("version") != 1:
        print(f"FAIL: Rework plan version '{plan.get('version')}' must be 1.", file=sys.stderr)
        sys.exit(1)

    # source validation
    source = plan.get("source")
    valid_sources = {"code-review", "buildfix", "acceptance-review"}
    if source not in valid_sources:
        print(f"FAIL: Rework plan 'source' field '{source}' is invalid. Must be one of {valid_sources}.", file=sys.stderr)
        sys.exit(1)

    # return_to validation
    return_to = plan.get("return_to")
    if return_to != "developer":
        print(f"FAIL: Rework plan 'return_to' field '{return_to}' is invalid. Must be 'developer'.", file=sys.stderr)
        sys.exit(1)

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
        try:
            validate_raw_path(p)
        except ValueError as e:
            print(f"FAIL: Invalid path '{p}' in additional_write_paths: {e}", file=sys.stderr)
            sys.exit(1)
        requested_paths.append(p)

    for idx, item in enumerate(must_fix):
        if not isinstance(item, dict):
            print(f"FAIL: must_fix_now item at index {idx} is not a JSON object.", file=sys.stderr)
            sys.exit(1)

        # Validate mandatory fields in each must_fix_now item
        for field in ("finding_id", "severity", "developer_action", "verification_command"):
            val = item.get(field)
            if not isinstance(val, str) or not val.strip():
                print(f"FAIL: must_fix_now item at index {idx} has missing or empty field '{field}'.", file=sys.stderr)
                sys.exit(1)

        severity = item.get("severity")
        valid_severities = {"P0", "P1", "P2", "P3"}
        if severity not in valid_severities:
            print(f"FAIL: must_fix_now item at index {idx} has invalid severity '{severity}'. Must be one of {valid_severities}.", file=sys.stderr)
            sys.exit(1)

        affected = item.get("affected_paths")
        if not isinstance(affected, list):
            print(f"FAIL: must_fix_now item at index {idx} is missing 'affected_paths' or it is not a list.", file=sys.stderr)
            sys.exit(1)
        if len(affected) == 0:
            print(f"FAIL: must_fix_now item at index {idx} has an empty 'affected_paths' list.", file=sys.stderr)
            sys.exit(1)

        for p in affected:
            try:
                validate_raw_path(p)
            except ValueError as e:
                print(f"FAIL: Invalid path '{p}' in affected_paths of item {idx}: {e}", file=sys.stderr)
                sys.exit(1)
            requested_paths.append(p)

    # 2. Check path permissions (allowed paths)
    blocked_paths = []
    for path_value in requested_paths:
        # At this point all paths have been verified as valid, so normalize_repo_relative_path won't throw
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

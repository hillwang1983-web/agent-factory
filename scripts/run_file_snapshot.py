#!/usr/bin/env python3
import os
import json
import hashlib
import argparse
from pathlib import Path

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return ""

def expand_allowed_files(repo_root: Path, allowed_paths: list[str]) -> list[tuple[str, Path]]:
    results = []
    for allowed in allowed_paths:
        allowed = allowed.replace("\\", "/").strip()
        if not allowed:
            continue
        parts = allowed.split("/")
        if ".." in parts or allowed.startswith("/"):
            # Reject absolute paths and path traversal to prevent escape
            continue
        
        full_path = repo_root / allowed
        if full_path.is_file():
            results.append((allowed, full_path))
        elif full_path.is_dir():
            for root, dirs, files in os.walk(full_path):
                for file in files:
                    file_path = Path(root) / file
                    try:
                        relative = str(file_path.relative_to(repo_root)).replace("\\", "/")
                        results.append((relative, file_path))
                    except ValueError:
                        pass
    return results

def snapshot_allowed_files(repo_root: Path, allowed_paths: list[str]) -> dict[str, dict]:
    results = {}
    for relative, path in expand_allowed_files(repo_root, allowed_paths):
        if path.is_file():
            sha = sha256_file(path)
            if sha:
                results[relative] = {"sha256": sha, "exists": True}
    return results

def diff_snapshots(before: dict, after: dict) -> dict[str, list[str]]:
    keys = set(before) | set(after)
    created = []
    modified = []
    deleted = []
    for k in keys:
        b_exists = before.get(k, {}).get("exists", False)
        a_exists = after.get(k, {}).get("exists", False)
        if not b_exists and a_exists:
            created.append(k)
        elif b_exists and not a_exists:
            deleted.append(k)
        elif b_exists and a_exists:
            if before[k]["sha256"] != after[k]["sha256"]:
                modified.append(k)
    return {
        "created": sorted(created),
        "modified": sorted(modified),
        "deleted": sorted(deleted),
    }

def main():
    parser = argparse.ArgumentParser(description="Create or diff repo file snapshots.")
    parser.add_argument("--repo-root", required=True, help="Path to repo root")
    parser.add_argument("--allowed-paths", required=True, help="Comma-separated allowed write paths")
    parser.add_argument("--before", help="Path to before snapshot JSON to create or load")
    parser.add_argument("--after", help="Path to after snapshot JSON to create")
    parser.add_argument("--diff", help="Path to diff JSON to save")
    args = parser.parse_args()

    repo_root = Path(args.repo_root)
    allowed_paths = [p.strip() for p in args.allowed_paths.split(",") if p.strip()]

    if args.before and not args.after and not args.diff:
        # Just create the before snapshot
        snapshot = snapshot_allowed_files(repo_root, allowed_paths)
        with open(args.before, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"Created snapshot at {args.before}")
    elif args.before and args.after and args.diff:
        # Create after snapshot and compute diff
        before_path = Path(args.before)
        if not before_path.is_file():
            print(f"Error: Before snapshot file not found at {before_path}")
            sys.exit(1)
        with open(before_path, "r", encoding="utf-8") as f:
            before = json.load(f)

        after = snapshot_allowed_files(repo_root, allowed_paths)
        with open(args.after, "w", encoding="utf-8") as f:
            json.dump(after, f, ensure_ascii=False, indent=2)
            f.write("\n")

        diff = diff_snapshots(before, after)
        with open(args.diff, "w", encoding="utf-8") as f:
            json.dump(diff, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"Created diff at {args.diff}")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import os
import sys
import json
import hashlib
import argparse
import subprocess
from pathlib import Path

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def normalize_repo_path(p: str) -> str:
    return os.path.normpath(p.replace("\\", "/")).replace("\\", "/")

def run_git(args: list[str], cwd: Path) -> str:
    res = subprocess.run(["git"] + args, cwd=str(cwd), capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Git command failed: {res.stderr}")
    return res.stdout

def get_git_root(repo_root: Path) -> Path:
    try:
        out = run_git(["rev-parse", "--show-toplevel"], repo_root)
        return Path(out.strip())
    except Exception as e:
        raise RuntimeError(f"Not a git repository: {e}")

def parse_porcelain_status(status_out: str) -> tuple[set[tuple[str, str]], set[str]]:
    entries = status_out.split("\x00") if status_out else []
    dirty_tracked = set()
    untracked = set()

    idx = 0
    while idx < len(entries):
        entry = entries[idx]
        if not entry:
            idx += 1
            continue
        xy = entry[:2]
        path_str = entry[3:]

        # If renamed/copied
        if "R" in xy or "C" in xy:
            idx += 1
            if idx < len(entries):
                dest_path = entries[idx]
                dirty_tracked.add((xy, dest_path))
            dirty_tracked.add((xy, path_str))
        elif xy == "??":
            untracked.add(path_str)
        elif xy == "!!":
            # Only monitor ignored files in .agent-factory/ or .ai-agent/ to prevent scanning node_modules/build/dist
            if path_str.startswith(".agent-factory/") or path_str.startswith(".ai-agent/"):
                untracked.add(path_str)
        else:
            dirty_tracked.add((xy, path_str))
        idx += 1
    return dirty_tracked, untracked

def capture_repository_baseline(
    repo_root: Path,
    exact_ignored_targets: list[str],
    sensitive_targets: list[str],
) -> dict:
    git_root = get_git_root(repo_root)

    try:
        head = run_git(["rev-parse", "HEAD"], repo_root).strip()
    except Exception:
        head = None

    status_out = run_git(["status", "--porcelain", "--ignored", "-uall", "-z"], repo_root)
    dirty_tracked_entries, untracked_entries = parse_porcelain_status(status_out)

    pre_dirty_hashes = {}
    for xy, p in dirty_tracked_entries:
        full_path = repo_root / p
        if full_path.is_file() and not full_path.is_symlink():
            pre_dirty_hashes[p] = sha256_file(full_path)

    untracked_hashes = {}
    for p in untracked_entries:
        full_path = repo_root / p
        if full_path.is_file() and not full_path.is_symlink():
            untracked_hashes[p] = sha256_file(full_path)

    exact_target_hashes = {}
    for p in exact_ignored_targets:
        norm_p = normalize_repo_path(p)
        full_path = repo_root / norm_p
        if full_path.is_file() and not full_path.is_symlink():
            exact_target_hashes[norm_p] = sha256_file(full_path)
        else:
            exact_target_hashes[norm_p] = None

    sensitive_hashes = {}
    for p in sensitive_targets:
        norm_p = normalize_repo_path(p)
        full_path = repo_root / norm_p
        if full_path.is_file() and not full_path.is_symlink():
            sensitive_hashes[norm_p] = sha256_file(full_path)
        else:
            sensitive_hashes[norm_p] = None

    return {
        "git_root": str(git_root),
        "head": head,
        "pre_dirty_hashes": pre_dirty_hashes,
        "untracked_hashes": untracked_hashes,
        "exact_target_hashes": exact_target_hashes,
        "sensitive_hashes": sensitive_hashes
    }

def calculate_repository_delta(repo_root: Path, baseline: dict) -> dict:
    status_out = run_git(["status", "--porcelain", "--ignored", "-uall", "-z"], repo_root)
    dirty_tracked_entries, untracked_entries = parse_porcelain_status(status_out)

    created = set()
    modified = set()
    deleted = set()

    # Tracked files handling
    pre_dirty_hashes = baseline.get("pre_dirty_hashes", {})

    # We also keep track of what files were seen in git status
    seen_in_status = set()

    for xy, p in dirty_tracked_entries:
        seen_in_status.add(p)
        full_path = repo_root / p

        if "D" in xy:
            deleted.add(p)
        elif "A" in xy:
            if full_path.is_file() and not full_path.is_symlink():
                created.add(p)
        else:
            # M, R, C, etc.
            if p in pre_dirty_hashes:
                if full_path.is_file() and not full_path.is_symlink():
                    current_hash = sha256_file(full_path)
                    if current_hash != pre_dirty_hashes[p]:
                        modified.add(p)
                else:
                    deleted.add(p)
            else:
                if full_path.is_file() and not full_path.is_symlink():
                    # It was clean tracked before and is now modified/created
                    modified.add(p)
                else:
                    deleted.add(p)

    # Check if any pre_dirty_hashes are now deleted (not in status but no longer exists)
    for p in pre_dirty_hashes:
        if p not in seen_in_status:
            full_path = repo_root / p
            if not full_path.exists():
                deleted.add(p)

    # Untracked files handling
    untracked_hashes = baseline.get("untracked_hashes", {})
    seen_untracked = set()

    for p in untracked_entries:
        seen_untracked.add(p)
        full_path = repo_root / p
        if not full_path.is_file() or full_path.is_symlink():
            continue
        if p in untracked_hashes:
            current_hash = sha256_file(full_path)
            if current_hash != untracked_hashes[p]:
                modified.add(p)
        else:
            created.add(p)

    for p in untracked_hashes:
        if p not in seen_untracked:
            full_path = repo_root / p
            if not full_path.exists():
                deleted.add(p)

    # Exact ignored targets handling
    exact_target_hashes = baseline.get("exact_target_hashes", {})
    for p, old_hash in exact_target_hashes.items():
        full_path = repo_root / p
        if full_path.is_file() and not full_path.is_symlink():
            current_hash = sha256_file(full_path)
            if old_hash is None:
                created.add(p)
            elif current_hash != old_hash:
                modified.add(p)
        else:
            if old_hash is not None:
                deleted.add(p)

    # Sensitive targets handling
    sensitive_hashes = baseline.get("sensitive_hashes", {})
    for p, old_hash in sensitive_hashes.items():
        full_path = repo_root / p
        if full_path.is_file() and not full_path.is_symlink():
            current_hash = sha256_file(full_path)
            if old_hash is None:
                created.add(p)
            elif current_hash != old_hash:
                modified.add(p)
        else:
            if old_hash is not None:
                deleted.add(p)

    return {
        "created": sorted(list(created)),
        "modified": sorted(list(modified)),
        "deleted": sorted(list(deleted))
    }

def main():
    # Keep main CLI signature for compatibility or print warning
    parser = argparse.ArgumentParser(description="Create or diff repo file snapshots.")
    parser.add_argument("--repo-root", required=True, help="Path to repo root")
    parser.add_argument("--allowed-paths", required=True, help="Comma-separated allowed write paths")
    parser.add_argument("--before", help="Path to before snapshot JSON to create or load")
    parser.add_argument("--after", help="Path to after snapshot JSON to create")
    parser.add_argument("--diff", help="Path to diff JSON to save")
    args = parser.parse_args()

    # Fallback simulation of old behavior
    repo_root = Path(args.repo_root)
    allowed_paths = [p.strip() for p in args.allowed_paths.split(",") if p.strip()]

    if args.before and not args.after and not args.diff:
        baseline = capture_repository_baseline(repo_root, allowed_paths, [])
        with open(args.before, "w", encoding="utf-8") as f:
            json.dump(baseline, f, ensure_ascii=False, indent=2)
            f.write("\n")
    elif args.before and args.after and args.diff:
        before_path = Path(args.before)
        with open(before_path, "r", encoding="utf-8") as f:
            before = json.load(f)
        delta = calculate_repository_delta(repo_root, before)
        with open(args.after, "w", encoding="utf-8") as f:
            json.dump(capture_repository_baseline(repo_root, allowed_paths, []), f, indent=2)
            f.write("\n")
        with open(args.diff, "w", encoding="utf-8") as f:
            json.dump(delta, f, indent=2)
            f.write("\n")

if __name__ == "__main__":
    main()

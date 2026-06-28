import hashlib
from pathlib import Path

def sha256_file(filepath: Path) -> str:
    h = hashlib.sha256()
    try:
        with open(filepath, "rb") as f:
            while chunk := f.read(8192):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return ""

def normalize_repo_relative_path(path_value: str) -> str:
    if not isinstance(path_value, str):
        return ""
    p = path_value.strip().replace("\\", "/")
    parts = []
    for part in p.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            return ""
        parts.append(part)
    return "/".join(parts)

def expand_allowed_files(repo_root: Path, allowed_paths: list[str]) -> list[tuple[str, Path]]:
    expanded = []
    for allowed in allowed_paths or []:
        normalized = normalize_repo_relative_path(allowed)
        full_path = repo_root / normalized
        if full_path.is_file():
            expanded.append((normalized, full_path))
        elif full_path.is_dir():
            # Recursively walk directories, excluding .git and .ai-agent
            for path in full_path.rglob("*"):
                if path.is_file():
                    # Check if path is in .git or .ai-agent
                    rel_parts = path.relative_to(repo_root).parts
                    if ".git" in rel_parts or ".ai-agent" in rel_parts:
                        continue
                    rel_str = "/".join(path.relative_to(repo_root).parts)
                    expanded.append((rel_str, path))
    return expanded

def snapshot_allowed_files(repo_root: Path, allowed_paths: list[str]) -> dict[str, dict]:
    snapshot = {}
    expanded = expand_allowed_files(repo_root, allowed_paths)
    for rel_path, full_path in expanded:
        sha = sha256_file(full_path)
        if sha:
            snapshot[rel_path] = {"sha256": sha, "exists": True}
    return snapshot

def diff_snapshots(before: dict, after: dict) -> dict[str, list[str]]:
    before_keys = set(before.keys())
    after_keys = set(after.keys())
    all_keys = before_keys | after_keys

    created = []
    modified = []
    deleted = []

    for k in all_keys:
        in_before = k in before_keys
        in_after = k in after_keys
        if in_after and not in_before:
            created.append(k)
        elif in_before and not in_after:
            deleted.append(k)
        else:
            if before[k].get("sha256") != after[k].get("sha256"):
                modified.append(k)

    return {
        "created": sorted(created),
        "modified": sorted(modified),
        "deleted": sorted(deleted),
    }

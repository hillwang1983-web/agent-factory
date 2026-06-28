#!/usr/bin/env python3
import sys
import tempfile
import json
from pathlib import Path

# Add scripts directory to path to locate snapshot functions
scripts_dir = Path(__file__).parent.resolve()
sys.path.append(str(scripts_dir))
import run_file_snapshot

passed = 0
failed = 0

def assert_test(label, fn):
    global passed, failed
    try:
        fn()
        print(f"OK  {label}")
        passed += 1
    except Exception as e:
        print(f"FAIL  {label}: {e}")
        failed += 1

def test_diff_detects_created_modified_deleted_files():
    before = {
        "src/main.c": {"sha256": "aaaa", "exists": True},
        "src/old.c": {"sha256": "bbbb", "exists": True}
    }
    after = {
        "src/main.c": {"sha256": "cccc", "exists": True}, # modified
        # src/old.c deleted
        "src/new.c": {"sha256": "dddd", "exists": True}   # created
    }
    diff = run_file_snapshot.diff_snapshots(before, after)
    assert diff["created"] == ["src/new.c"], f"expected ['src/new.c'], got {diff['created']}"
    assert diff["modified"] == ["src/main.c"], f"expected ['src/main.c'], got {diff['modified']}"
    assert diff["deleted"] == ["src/old.c"], f"expected ['src/old.c'], got {diff['deleted']}"

def test_unchanged_file_is_not_reported():
    before = {"src/main.c": {"sha256": "aaaa", "exists": True}}
    after = {"src/main.c": {"sha256": "aaaa", "exists": True}}
    diff = run_file_snapshot.diff_snapshots(before, after)
    assert not diff["created"]
    assert not diff["modified"]
    assert not diff["deleted"]

def test_snapshot_rejects_path_escape():
    with tempfile.TemporaryDirectory() as tmp_dir:
        repo_root = Path(tmp_dir)
        # Create a file outside or trying to traverse
        allowed = ["../outside.c", "/absolute.c", "src/"]
        expanded = run_file_snapshot.expand_allowed_files(repo_root, allowed)
        # Should filter out absolute/traversal paths
        for rel, path in expanded:
            assert not rel.startswith("../")
            assert not rel.startswith("/")

def test_expand_allowed_files_finds_nested_files():
    with tempfile.TemporaryDirectory() as tmp_dir:
        repo_root = Path(tmp_dir)
        (repo_root / "src").mkdir()
        (repo_root / "src" / "nested").mkdir()
        (repo_root / "src" / "main.c").write_text("main", encoding="utf-8")
        (repo_root / "src" / "nested" / "helper.h").write_text("helper", encoding="utf-8")
        (repo_root / "webui").mkdir()
        (repo_root / "webui" / "index.js").write_text("index", encoding="utf-8")

        expanded = run_file_snapshot.expand_allowed_files(repo_root, ["src/", "webui/index.js"])
        rel_paths = {rel for rel, p in expanded}
        assert rel_paths == {"src/main.c", "src/nested/helper.h", "webui/index.js"}, f"got {rel_paths}"

def main():
    print("── File Snapshot Tests ──\n")
    assert_test("diff detects created/modified/deleted files", test_diff_detects_created_modified_deleted_files)
    assert_test("unchanged file is not reported", test_unchanged_file_is_not_reported)
    assert_test("snapshot rejects path escape", test_snapshot_rejects_path_escape)
    assert_test("expand allowed files finds nested files", test_expand_allowed_files_finds_nested_files)

    print(f"\n── Results: {passed} passed, {failed} failed ──")
    sys.exit(0 if failed == 0 else 1)

if __name__ == "__main__":
    main()

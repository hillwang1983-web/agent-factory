#!/usr/bin/env python3
import unittest
import tempfile
import json
from pathlib import Path

import run_file_snapshot as snapshot

class TestRunFileSnapshot(unittest.TestCase):
    def test_diff_detects_created_modified_deleted_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)

            # Setup initial files
            f1 = tmp_path / "modified.txt"
            f1.write_text("initial", encoding="utf-8")

            f2 = tmp_path / "deleted.txt"
            f2.write_text("to be deleted", encoding="utf-8")

            # Snap before
            before = snapshot.snapshot_allowed_files(tmp_path, ["."])

            # Apply changes
            f1.write_text("changed", encoding="utf-8")
            f2.unlink()

            f3 = tmp_path / "created.txt"
            f3.write_text("new file", encoding="utf-8")

            # Snap after
            after = snapshot.snapshot_allowed_files(tmp_path, ["."])

            diff = snapshot.diff_snapshots(before, after)

            self.assertEqual(diff["created"], ["created.txt"])
            self.assertEqual(diff["modified"], ["modified.txt"])
            self.assertEqual(diff["deleted"], ["deleted.txt"])

    def test_unchanged_file_is_not_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            f = tmp_path / "unchanged.txt"
            f.write_text("same content", encoding="utf-8")

            before = snapshot.snapshot_allowed_files(tmp_path, ["."])
            after = snapshot.snapshot_allowed_files(tmp_path, ["."])

            diff = snapshot.diff_snapshots(before, after)
            self.assertEqual(diff["created"], [])
            self.assertEqual(diff["modified"], [])
            self.assertEqual(diff["deleted"], [])

    def test_snapshot_rejects_path_escape(self):
        # normalize_repo_relative_path should reject escape sequences like ".."
        self.assertEqual(snapshot.normalize_repo_relative_path("../outside.txt"), "")
        self.assertEqual(snapshot.normalize_repo_relative_path("a/../../outside.txt"), "")
        self.assertEqual(snapshot.normalize_repo_relative_path("a/b/c"), "a/b/c")

    def test_declared_files_must_equal_or_be_subset_of_actual_delta(self):
        # Simulator logic: check if declared changed_files is subset of actual delta (created + modified)
        before = {
            "file1.txt": {"sha256": "111"},
            "file2.txt": {"sha256": "222"}
        }
        after = {
            "file1.txt": {"sha256": "111_new"}, # modified
            "file2.txt": {"sha256": "222"},     # unchanged
            "file3.txt": {"sha256": "333"}      # created
        }
        diff = snapshot.diff_snapshots(before, after)
        actual_delta = set(diff["created"] + diff["modified"])

        # Scenario A: declared subset -> OK
        declared_ok = ["file1.txt"]
        self.assertTrue(set(declared_ok).issubset(actual_delta))

        # Scenario B: declared exact -> OK
        declared_exact = ["file1.txt", "file3.txt"]
        self.assertTrue(set(declared_exact).issubset(actual_delta))

        # Scenario C: declared not in delta -> False
        declared_bad = ["file1.txt", "file2.txt"]
        self.assertFalse(set(declared_bad).issubset(actual_delta))

if __name__ == "__main__":
    unittest.main()

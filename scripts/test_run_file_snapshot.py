#!/usr/bin/env python3
import sys
import tempfile
import json
import os
import subprocess
import unittest
from pathlib import Path

# Add scripts directory to path to locate snapshot functions
scripts_dir = Path(__file__).parent.resolve()
sys.path.append(str(scripts_dir))
import run_file_snapshot

class TestRunFileSnapshot(unittest.TestCase):

    def setUp(self):
        # We create a temporary Git repository for each test
        self.tmpdir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.tmpdir.name)

        # Initialize Git repo
        subprocess.run(["git", "init"], cwd=str(self.repo_root), capture_output=True)
        # Git config
        subprocess.run(["git", "config", "user.name", "Test User"], cwd=str(self.repo_root), capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=str(self.repo_root), capture_output=True)

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_git_delta_detects_tracked_created_modified_deleted(self):
        # 1. Create and commit some initial files
        a_file = self.repo_root / "a.txt"
        b_file = self.repo_root / "b.txt"
        a_file.write_text("initial a", encoding="utf-8")
        b_file.write_text("initial b", encoding="utf-8")

        subprocess.run(["git", "add", "a.txt", "b.txt"], cwd=str(self.repo_root), capture_output=True)
        subprocess.run(["git", "commit", "-m", "initial"], cwd=str(self.repo_root), capture_output=True)

        # 2. Capture baseline
        baseline = run_file_snapshot.capture_repository_baseline(self.repo_root, [], [])

        # 3. Perform modifications (modify a, delete b, create c)
        a_file.write_text("modified a", encoding="utf-8")
        b_file.unlink()

        c_file = self.repo_root / "c.txt"
        c_file.write_text("created c", encoding="utf-8")
        subprocess.run(["git", "add", "c.txt"], cwd=str(self.repo_root), capture_output=True)

        # 4. Calculate delta
        delta = run_file_snapshot.calculate_repository_delta(self.repo_root, baseline)

        self.assertEqual(delta["created"], ["c.txt"])
        self.assertEqual(delta["modified"], ["a.txt"])
        self.assertEqual(delta["deleted"], ["b.txt"])

    def test_git_delta_detects_change_to_preexisting_dirty_file(self):
        # 1. Create and commit initial
        a_file = self.repo_root / "a.txt"
        a_file.write_text("initial a", encoding="utf-8")
        subprocess.run(["git", "add", "a.txt"], cwd=str(self.repo_root), capture_output=True)
        subprocess.run(["git", "commit", "-m", "initial"], cwd=str(self.repo_root), capture_output=True)

        # 2. Make it dirty before baseline
        a_file.write_text("dirty a", encoding="utf-8")

        # 3. Capture baseline
        baseline = run_file_snapshot.capture_repository_baseline(self.repo_root, [], [])
        self.assertIn("a.txt", baseline["pre_dirty_hashes"])

        # 4. Make it dirty again
        a_file.write_text("very dirty a", encoding="utf-8")

        # 5. Calculate delta - should detect as modified since its hash changed from baseline
        delta = run_file_snapshot.calculate_repository_delta(self.repo_root, baseline)
        self.assertEqual(delta["modified"], ["a.txt"])

        # 6. If we did NOT modify it during the run (remains "dirty a")
        a_file.write_text("dirty a", encoding="utf-8")
        delta_unchanged = run_file_snapshot.calculate_repository_delta(self.repo_root, baseline)
        self.assertNotIn("a.txt", delta_unchanged["modified"])

    def test_git_delta_detects_untracked_file_created_or_modified(self):
        # 1. Capture baseline (empty repo)
        baseline = run_file_snapshot.capture_repository_baseline(self.repo_root, [], [])

        # 2. Create untracked file
        untracked_file = self.repo_root / "untracked.txt"
        untracked_file.write_text("untracked content", encoding="utf-8")

        # 3. Calculate delta
        delta = run_file_snapshot.calculate_repository_delta(self.repo_root, baseline)
        self.assertEqual(delta["created"], ["untracked.txt"])

    def test_exact_ignored_target_is_snapshotted(self):
        # 1. Setup gitignore to ignore .agent-factory/
        gitignore = self.repo_root / ".gitignore"
        gitignore.write_text(".agent-factory/\n", encoding="utf-8")

        subprocess.run(["git", "add", ".gitignore"], cwd=str(self.repo_root), capture_output=True)
        subprocess.run(["git", "commit", "-m", "ignore agent-factory"], cwd=str(self.repo_root), capture_output=True)

        target = ".agent-factory/project-profile.json"

        # 2. Capture baseline with target specified
        baseline = run_file_snapshot.capture_repository_baseline(self.repo_root, [target], [])
        self.assertIn(target, baseline["exact_target_hashes"])
        self.assertIsNone(baseline["exact_target_hashes"][target])

        # 3. Create the ignored target
        target_path = self.repo_root / target
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_text("profile", encoding="utf-8")

        # 4. Calculate delta
        delta = run_file_snapshot.calculate_repository_delta(self.repo_root, baseline)
        self.assertEqual(delta["created"], [target])

    def test_ignored_node_modules_is_not_recursively_scanned(self):
        # 1. Create gitignore
        gitignore = self.repo_root / ".gitignore"
        gitignore.write_text("node_modules/\n", encoding="utf-8")
        subprocess.run(["git", "add", ".gitignore"], cwd=str(self.repo_root), capture_output=True)
        subprocess.run(["git", "commit", "-m", "ignore node_modules"], cwd=str(self.repo_root), capture_output=True)

        # 2. Create 1000 node_modules files
        nm_dir = self.repo_root / "node_modules"
        nm_dir.mkdir()
        for i in range(100):
            sub_dir = nm_dir / f"pkg-{i}"
            sub_dir.mkdir()
            (sub_dir / "index.js").write_text("console.log()", encoding="utf-8")

        # 3. Monkeypatch sha256_file to track calls
        original_sha = run_file_snapshot.sha256_file
        called_paths = []
        def mock_sha(path):
            called_paths.append(str(path))
            return original_sha(path)

        run_file_snapshot.sha256_file = mock_sha
        try:
            # 4. Capture baseline
            baseline = run_file_snapshot.capture_repository_baseline(self.repo_root, [], [])
            # Should not call sha256_file on any node_modules path
            for path in called_paths:
                self.assertNotIn("node_modules", path)
        finally:
            run_file_snapshot.sha256_file = original_sha

    def test_sensitive_registry_change_is_reported(self):
        # 1. Create registry file
        reg_file = self.repo_root / ".ai-agent" / "registry" / "adus.json"
        reg_file.parent.mkdir(parents=True, exist_ok=True)
        reg_file.write_text("{}", encoding="utf-8")

        subprocess.run(["git", "add", ".ai-agent/registry/adus.json"], cwd=str(self.repo_root), capture_output=True)
        subprocess.run(["git", "commit", "-m", "init registry"], cwd=str(self.repo_root), capture_output=True)

        target = ".ai-agent/registry/adus.json"

        # 2. Capture baseline
        baseline = run_file_snapshot.capture_repository_baseline(self.repo_root, [], [target])
        self.assertIn(target, baseline["sensitive_hashes"])

        # 3. Modify registry file
        reg_file.write_text('{"changed": true}', encoding="utf-8")

        # 4. Calculate delta
        delta = run_file_snapshot.calculate_repository_delta(self.repo_root, baseline)
        self.assertEqual(delta["modified"], [target])

if __name__ == "__main__":
    unittest.main()

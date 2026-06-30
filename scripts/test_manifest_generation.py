#!/usr/bin/env python3
"""
Unit tests for ADU delivery manifest generation in scripts/hermes_agent_run.py.
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
passed = 0
failed = 0


def ok(label):
    global passed
    print(f"✅  {label}")
    passed += 1


def fail(label, reason=""):
    global failed
    print(f"❌  {label}" + (f": {reason}" if reason else ""))
    failed += 1


def load_run_module():
    spec = importlib.util.spec_from_file_location(
        "hermes_agent_run",
        ROOT / "scripts" / "hermes_agent_run.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_git(cmd, cwd):
    return subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, check=True)


print("Running ADU Manifest Generation unit tests...\n")

# Setup the module
mod = load_run_module()

# Test 1: Generate manifest from scratch in a mock git repo
with tempfile.TemporaryDirectory() as tmp:
    repo = Path(tmp) / "repo"
    repo.mkdir()

    # Initialize a git repo and make initial commit
    run_git(["git", "init", "-b", "main"], repo)
    run_git(["git", "config", "user.name", "Test User"], repo)
    run_git(["git", "config", "user.email", "test@example.com"], repo)
    
    file_a = repo / "file_a.txt"
    file_a.write_text("Hello from File A", encoding="utf-8")
    run_git(["git", "add", "file_a.txt"], repo)
    run_git(["git", "commit", "-m", "Initial commit"], repo)
    
    # Get initial HEAD commit
    proc_head = run_git(["git", "rev-parse", "HEAD"], repo)
    base_commit = proc_head.stdout.strip()
    
    # Make a change: modify file_a and create file_b, and delete file_c (after committing it)
    file_c = repo / "file_c.txt"
    file_c.write_text("Delete me", encoding="utf-8")
    run_git(["git", "add", "file_c.txt"], repo)
    run_git(["git", "commit", "-m", "Add file C"], repo)
    
    # Update base commit
    proc_head = run_git(["git", "rev-parse", "HEAD"], repo)
    base_commit = proc_head.stdout.strip()
    
    # Bootstrap a draft manifest with the base commit
    adu = {"id": "ADU-101"}
    manifest_path = repo / ".ai-agent" / "evidence" / "ADU-101-manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({"adu_id": adu["id"], "base_commit": base_commit}, f, indent=2)
        
    # Make modifications
    file_a.write_text("Modified File A", encoding="utf-8")
    file_b = repo / "file_b.txt"
    file_b.write_text("New File B", encoding="utf-8")
    run_git(["git", "rm", "file_c.txt"], repo)
    run_git(["git", "add", "file_a.txt", "file_b.txt"], repo)
    run_git(["git", "commit", "-m", "Modifications"], repo)
    
    proc_head = run_git(["git", "rev-parse", "HEAD"], repo)
    delivery_commit = proc_head.stdout.strip()

    # Generate ADU manifest
    mod.generate_adu_manifest(adu, repo)
    
    # Check if the manifest was created and has the correct fields
    if not manifest_path.exists():
        fail("T01: Manifest file creation", "Manifest file does not exist")
    else:
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
                
            expected_keys = {
                "adu_id", "base_commit", "delivery_commit", "branch",
                "required_outputs", "outputs_hash", "created_files",
                "modified_files", "deleted_files", "generated_at"
            }
            if not expected_keys.issubset(manifest.keys()):
                fail("T01: Manifest file format", f"Missing keys in: {list(manifest.keys())}")
            elif manifest["adu_id"] != "ADU-101":
                fail("T01: Manifest file format", f"Wrong adu_id: {manifest['adu_id']}")
            elif manifest["base_commit"] != base_commit:
                fail("T01: Manifest file format", f"Wrong base_commit: expected {base_commit}, got {manifest['base_commit']}")
            elif manifest["delivery_commit"] != delivery_commit:
                fail("T01: Manifest file format", f"Wrong delivery_commit: expected {delivery_commit}, got {manifest['delivery_commit']}")
            elif manifest["branch"] != "main":
                fail("T01: Manifest file format", f"Wrong branch: expected 'main', got {manifest['branch']}")
            elif manifest["created_files"] != ["file_b.txt"]:
                fail("T01: Manifest file format", f"Wrong created_files: {manifest['created_files']}")
            elif manifest["modified_files"] != ["file_a.txt"]:
                fail("T01: Manifest file format", f"Wrong modified_files: {manifest['modified_files']}")
            elif manifest["deleted_files"] != ["file_c.txt"]:
                fail("T01: Manifest file format", f"Wrong deleted_files: {manifest['deleted_files']}")
            elif manifest["required_outputs"] != ["file_a.txt", "file_b.txt"]:
                fail("T01: Manifest file format", f"Wrong required_outputs: {manifest['required_outputs']}")
            elif "file_a.txt" not in manifest["outputs_hash"] or "file_b.txt" not in manifest["outputs_hash"]:
                fail("T01: Manifest file format", f"Missing hashes: {manifest['outputs_hash']}")
            else:
                import hashlib
                expected_hash_b = hashlib.sha256(b"New File B").hexdigest()
                if manifest["outputs_hash"]["file_b.txt"] != expected_hash_b:
                    fail("T01: Manifest file format", "Incorrect SHA-256 for file_b.txt")
                else:
                    ok("T01: generate_adu_manifest creates correct manifest from pre-existing base_commit")
        except Exception as e:
            fail("T01: Manifest file parsing", str(e))

# Test 2: Fallback when manifest does not exist
with tempfile.TemporaryDirectory() as tmp:
    repo = Path(tmp) / "repo"
    repo.mkdir()

    run_git(["git", "init", "-b", "dev-branch"], repo)
    run_git(["git", "config", "user.name", "Test User"], repo)
    run_git(["git", "config", "user.email", "test@example.com"], repo)
    
    file_x = repo / "file_x.txt"
    file_x.write_text("Hello from File X", encoding="utf-8")
    run_git(["git", "add", "file_x.txt"], repo)
    run_git(["git", "commit", "-m", "First commit"], repo)
    
    proc_head1 = run_git(["git", "rev-parse", "HEAD"], repo)
    commit_1 = proc_head1.stdout.strip()
    
    file_y = repo / "file_y.txt"
    file_y.write_text("Hello from File Y", encoding="utf-8")
    run_git(["git", "add", "file_y.txt"], repo)
    run_git(["git", "commit", "-m", "Second commit"], repo)
    
    proc_head2 = run_git(["git", "rev-parse", "HEAD"], repo)
    commit_2 = proc_head2.stdout.strip()

    adu = {"id": "ADU-202"}
    
    # Generate manifest without prior draft (expects base_commit to fallback to HEAD~1, i.e., commit_1)
    mod.generate_adu_manifest(adu, repo)
    
    manifest_path = repo / ".ai-agent" / "evidence" / "ADU-202-manifest.json"
    if not manifest_path.exists():
        fail("T02: Manifest file creation", "Manifest file does not exist")
    else:
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            
            if manifest["base_commit"] != commit_1:
                fail("T02: Fallback base_commit", f"Expected {commit_1}, got {manifest['base_commit']}")
            elif manifest["delivery_commit"] != commit_2:
                fail("T02: Fallback delivery_commit", f"Expected {commit_2}, got {manifest['delivery_commit']}")
            elif manifest["branch"] != "dev-branch":
                fail("T02: Fallback branch", f"Expected 'dev-branch', got {manifest['branch']}")
            else:
                ok("T02: generate_adu_manifest correctly falls back to HEAD~1 base_commit")
        except Exception as e:
            fail("T02: Manifest file parsing", str(e))

if failed > 0:
    print(f"\n❌ {failed} tests failed.")
    sys.exit(1)
else:
    print("\nAll tests passed successfully!")
    sys.exit(0)

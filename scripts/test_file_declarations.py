#!/usr/bin/env python3
"""Tests for validate_agent_file_declarations in hermes_agent_run.py."""
import json
import sys
import time
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hermes_agent_run import validate_agent_file_declarations, normalize_repo_relative_path

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


def make_repo():
    tmp = Path(tempfile.mkdtemp(prefix="file-decl-test-"))
    src = tmp / "src" / "license.c"
    src.parent.mkdir(parents=True)
    src.write_text("int f(void) { return 0; }\n")

    ev_dir = tmp / ".ai-agent" / "evidence"
    ev_dir.mkdir(parents=True)
    (ev_dir / "ADU-TEST.json").write_text(json.dumps({"status": "pass"}))

    reg_file = tmp / ".ai-agent" / "registry" / "adu.json"
    reg_file.parent.mkdir(parents=True)
    reg_file.write_text(json.dumps({"adus": []}))

    build_file = tmp / "build" / "build.ninja"
    build_file.parent.mkdir(parents=True)
    build_file.write_text("build rule\n")

    profiler_files = [
        ".agent-factory/project-profile.json",
        ".agent-factory/knowledge/project-summary.md",
        ".agent-factory/knowledge/module-map.md",
        ".agent-factory/knowledge/test-strategy.md",
        ".agent-factory/knowledge/risk-map.md",
        ".agent-factory/config.json",
    ]
    for relative_path in profiler_files:
        profiler_file = tmp / relative_path
        profiler_file.parent.mkdir(parents=True, exist_ok=True)
        profiler_file.write_text("{}\n" if profiler_file.suffix == ".json" else "# Test\n")

    return tmp


def teardown(repo_path):
    import shutil
    shutil.rmtree(repo_path, ignore_errors=True)


def test_evidence_source_path():
    """Evidence declaring source path produces error."""
    repo = make_repo()
    now_ns = time.time_ns()
    result = {"changed_files": ["src/license.c"]}
    decl = validate_agent_file_declarations("evidence", result, repo, now_ns)
    has_error = any("evidence_agent_declared_source_change" in e for e in decl.get("errors", []))
    teardown(repo)
    if not has_error:
        raise AssertionError(f"Expected evidence_agent_declared_source_change, got: {decl}")


def test_evidence_evidence_path():
    """Evidence declaring evidence path is valid."""
    repo = make_repo()
    now_ns = time.time_ns()
    time.sleep(0.01)
    (repo / ".ai-agent" / "evidence" / "ADU-TEST.json").touch()
    result = {"changed_files": [".ai-agent/evidence/ADU-TEST.json"]}
    decl = validate_agent_file_declarations("evidence", result, repo, now_ns)
    teardown(repo)
    if decl.get("errors"):
        raise AssertionError(f"Expected no errors, got: {decl['errors']}")
    if ".ai-agent/evidence/ADU-TEST.json" not in decl.get("valid_changed_files", []):
        raise AssertionError(f"Evidence path should be valid: {decl}")


def test_registry_runtime_managed():
    """Registry path is runtime_managed."""
    repo = make_repo()
    now_ns = time.time_ns()
    (repo / ".ai-agent" / "registry" / "adu.json").touch()
    result = {"changed_files": [".ai-agent/registry/adu.json"]}
    decl = validate_agent_file_declarations("code-reviewer", result, repo, now_ns)
    teardown(repo)
    if ".ai-agent/registry/adu.json" not in decl.get("runtime_managed_files", []):
        raise AssertionError(f"Registry path should be runtime_managed: {decl}")


def test_build_generated():
    """Build path is generated."""
    repo = make_repo()
    now_ns = time.time_ns()
    result = {"changed_files": ["build/build.ninja"]}
    decl = validate_agent_file_declarations("developer", result, repo, now_ns)
    teardown(repo)
    if "build/build.ninja" not in decl.get("generated_files", []):
        raise AssertionError(f"Build path should be generated: {decl}")


def test_mixed_declarations():
    """Mixed declarations classified correctly."""
    repo = make_repo()
    now_ns = time.time_ns()
    time.sleep(0.01)
    (repo / ".ai-agent" / "registry" / "adu.json").touch()
    result = {
        "changed_files": [
            ".ai-agent/evidence/ADU-TEST.json",
            ".ai-agent/registry/adu.json",
            "build/build.ninja",
            "nonexistent/file.c",
        ]
    }
    decl = validate_agent_file_declarations("evidence", result, repo, now_ns)
    teardown(repo)
    non_existent_errors = [e for e in decl.get("errors", []) if "nonexistent" in e]
    if not non_existent_errors:
        raise AssertionError(f"Expected error for nonexistent file: {decl}")


def test_evidence_registry_no_error():
    """Evidence declaring runtime managed file is classified, not error."""
    repo = make_repo()
    now_ns = time.time_ns()
    (repo / ".ai-agent" / "registry" / "adu.json").touch()
    result = {"changed_files": [".ai-agent/registry/adu.json"]}
    decl = validate_agent_file_declarations("evidence", result, repo, now_ns)
    teardown(repo)
    if decl.get("errors"):
        raise AssertionError(f"Registry path should not be error: {decl}")
    if ".ai-agent/registry/adu.json" not in decl.get("runtime_managed_files", []):
        raise AssertionError(f"Registry should be runtime_managed: {decl}")


def test_evidence_only_no_errors():
    """Evidence declaring only evidence paths has no errors."""
    repo = make_repo()
    now_ns = time.time_ns()
    time.sleep(0.01)
    (repo / ".ai-agent" / "evidence" / "ADU-TEST.json").touch()
    result = {"changed_files": [".ai-agent/evidence/ADU-TEST.json"]}
    decl = validate_agent_file_declarations("evidence", result, repo, now_ns)
    teardown(repo)
    if decl.get("errors"):
        raise AssertionError(f"Evidence-only should have no errors: {decl}")


def test_project_profiler_exact_artifacts_are_valid():
    """Project profiler may declare exactly its five contract artifacts."""
    repo = make_repo()
    paths = [
        ".agent-factory/project-profile.json",
        ".agent-factory/knowledge/project-summary.md",
        ".agent-factory/knowledge/module-map.md",
        ".agent-factory/knowledge/test-strategy.md",
        ".agent-factory/knowledge/risk-map.md",
    ]
    now_ns = time.time_ns()
    time.sleep(0.01)
    for relative_path in paths:
        (repo / relative_path).touch()
    decl = validate_agent_file_declarations(
        "project-profiler", {"changed_files": paths}, repo, now_ns
    )
    teardown(repo)
    if decl.get("errors"):
        raise AssertionError(f"Profiler contract artifacts should be valid: {decl}")
    if sorted(decl.get("valid_changed_files", [])) != sorted(paths):
        raise AssertionError(f"Expected all profiler artifacts to be valid: {decl}")


def test_project_profiler_extra_artifact_is_rejected():
    """Project profiler cannot expand its write contract."""
    repo = make_repo()
    now_ns = time.time_ns()
    time.sleep(0.01)
    (repo / ".agent-factory" / "config.json").touch()
    decl = validate_agent_file_declarations(
        "project-profiler",
        {"changed_files": [".agent-factory/config.json"]},
        repo,
        now_ns,
    )
    teardown(repo)
    if not any("illegal_write_path_escape" in error for error in decl.get("errors", [])):
        raise AssertionError(f"Unexpected profiler file should be rejected: {decl}")


def main():
    print("── Evidence File Declaration Tests ──\n")
    assert_test("evidence source path → evidence_agent_declared_source_change", test_evidence_source_path)
    assert_test("evidence evidence path → valid", test_evidence_evidence_path)
    assert_test("registry path → runtime_managed", test_registry_runtime_managed)
    assert_test("build path → generated", test_build_generated)
    assert_test("mixed → correct classification", test_mixed_declarations)
    assert_test("evidence + registry → runtime_managed no error", test_evidence_registry_no_error)
    assert_test("evidence only → no errors", test_evidence_only_no_errors)
    assert_test("project profiler exact artifacts → valid", test_project_profiler_exact_artifacts_are_valid)
    assert_test("project profiler extra artifact → rejected", test_project_profiler_extra_artifact_is_rejected)
    print(f"\n── Results: {passed} passed, {failed} failed ──")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()

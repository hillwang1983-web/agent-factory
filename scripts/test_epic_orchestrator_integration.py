#!/usr/bin/env python3
"""Integration tests for Epic orchestrator and runner quality gates.

Covers:
  Test A: run_child_adu detects non-zero exit code as failure
  Test B: step_epic returns blocked when run_child_adu fails
  Test C: Runner quality gate fails when artifact file is missing after agent success
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"

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


def setup_temp_registry():
    """Create an isolated temp registry with mock epics.json and adu.json."""
    tmp = tempfile.mkdtemp(prefix="epic-integ-test-")
    registry = Path(tmp) / "registry"
    registry.mkdir(parents=True)

    # Write epics.json with a test Epic
    epics_data = {
        "version": 1,
        "epics": [{
            "id": "EPIC-TEST-0001",
            "project_id": "test-project",
            "project_name": "Test Project",
            "repo_path": str(tmp),
            "title": "Test Epic",
            "source_requirement": "Test requirement",
            "state": "created",
            "risk": "low",
            "target_level": "mvp",
            "language": "zh",
            "child_adus": [],
            "dependencies": [],
            "created_at": "2026-06-11T00:00:00.000Z",
            "updated_at": "2026-06-11T00:00:00.000Z",
        }]
    }
    (registry / "epics.json").write_text(json.dumps(epics_data, indent=2))

    # Write adu.json with a mock child ADU
    adu_data = {
        "version": 1,
        "adus": [{
            "id": "ADU-TEST-001",
            "project_id": "test-project",
            "repo_path": str(tmp),
            "title": "Test Child ADU",
            "goal": "Test",
            "state": "created",
            "retry_count": 0,
            "max_retries": 3,
            "risk": "low",
            "target_level": "mvp",
            "allowed_read_paths": [".ai-agent/"],
            "allowed_write_paths": [".ai-agent/analysis/", ".ai-agent/evidence/"],
            "required_commands": ["echo ok"],
            "required_evidence": [".ai-agent/evidence/ADU-TEST-001.md"],
            "artifacts": [],
            "human_gate_required": True,
            "language": "zh",
            "parent_epic_id": "EPIC-TEST-0001",
            "depends_on": [],
            "review_counters": {"code_review_failures": 0, "acceptance_review_failures": 0},
            "review_limits": {"max_code_review_failures": 5, "max_acceptance_review_failures": 5},
        }]
    }
    (registry / "adu.json").write_text(json.dumps(adu_data, indent=2))

    # Write runs.json
    (registry / "runs.json").write_text(json.dumps({"version": 1, "runs": []}))

    # Write agents.json with mock agents
    agents_data = {
        "version": 1,
        "hermes_bin": str(Path(tmp) / "mock-hermes.sh"),
        "agents": {
            "system-flow-designer": {
                "description": "Test",
                "prompt": "test-prompt.md",
                "worktree": False,
                "hermes_args": []
            },
            "requirement-analyst": {
                "description": "Test",
                "prompt": "test-prompt.md",
                "worktree": False,
                "hermes_args": []
            }
        }
    }
    (registry / "agents.json").write_text(json.dumps(agents_data, indent=2))

    # Create mock project profile
    profile_dir = Path(tmp) / ".agent-factory"
    profile_dir.mkdir(parents=True)
    (profile_dir / "project-profile.json").write_text(json.dumps({
        "project_type": "test", "risk_level": "low",
        "build_commands": ["echo build"], "test_commands": ["echo test"]
    }))

    # Create mock knowledge dir
    knowledge_dir = profile_dir / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / "project-summary.md").write_text("# Test Summary")

    # Create project registry
    projects_path = registry / "projects.json"
    projects_data = {
        "version": 1,
        "projects": [{
            "project_id": "test-project",
            "name": "Test Project",
            "repo_path": str(tmp),
            "status": "profiled",
            "profile_path": str(profile_dir / "project-profile.json"),
            "knowledge_dir": str(knowledge_dir),
        }]
    }
    projects_path.write_text(json.dumps(projects_data, indent=2))

    # Create a mock hermes binary that outputs success JSON but creates NO artifact files
    mock_hermes = Path(tmp) / "mock-hermes.sh"
    mock_hermes.write_text("""#!/bin/bash
cat <<'JSONEOF'
```json
{
  "result": "success",
  "next_state": "flow_designed",
  "changed_files": [
    ".ai-agent/epics/EPIC-TEST-0001/system-flow.md",
    ".ai-agent/epics/EPIC-TEST-0001/system-flow.json"
  ],
  "artifacts": [
    ".ai-agent/epics/EPIC-TEST-0001/system-flow.md",
    ".ai-agent/epics/EPIC-TEST-0001/system-flow.json"
  ],
  "risks": [],
  "next_agent": "adu-splitter"
}
```
JSONEOF
exit 0
""")
    mock_hermes.chmod(0o755)

    # Create mock prompt (runner resolves relative to ROOT, which is the open5gs dir)
    mock_prompt_path = ROOT / "test-prompt.md"
    mock_prompt_path.write_text("You are a test agent. Output the required JSON.")

    return tmp, registry


def teardown_temp(tmp_dir):
    import shutil
    shutil.rmtree(tmp_dir, ignore_errors=True)
    # Clean up mock prompt created at ROOT level
    mock_prompt = ROOT / "test-prompt.md"
    if mock_prompt.exists():
        mock_prompt.unlink()


def test_a_child_failure_detection():
    """run_child_adu returns failed on non-zero exit."""
    import importlib.util as iu

    spec = iu.spec_from_file_location(
        "hermes_epic_orchestrator",
        str(SCRIPTS / "hermes_epic_orchestrator.py")
    )
    orch = iu.module_from_spec(spec)

    original_run = subprocess.run

    class FakeCompleted:
        returncode = 1
        stdout = ""
        stderr = "simulated failure"

    def fake_run(*args, **kwargs):
        cmd_args = args[0] if args else kwargs.get("args", [])
        if any("--adu" in str(a) for a in cmd_args):
            return FakeCompleted()
        return original_run(*args, **kwargs)

    subprocess.run = fake_run
    try:
        tmp_dir, registry = setup_temp_registry()
        os.environ["AGENT_FACTORY_REGISTRY_DIR"] = str(registry)
        os.environ["AGENT_FACTORY_PROJECTS_REGISTRY"] = str(registry / "projects.json")

        spec.loader.exec_module(orch)

        result = orch.run_child_adu("ADU-TEST-001", "step", "test-project", tmp_dir)
        assert result.get("result") == "failed", \
            f"Expected {{result: failed}}, got: {result}"

        teardown_temp(tmp_dir)
    finally:
        subprocess.run = original_run
        os.environ.pop("AGENT_FACTORY_REGISTRY_DIR", None)
        os.environ.pop("AGENT_FACTORY_PROJECTS_REGISTRY", None)


def test_b_step_epic_blocked_on_failure():
    """step_epic returns blocked when run_child_adu fails."""
    import importlib.util as iu

    spec = iu.spec_from_file_location(
        "hermes_epic_orchestrator",
        str(SCRIPTS / "hermes_epic_orchestrator.py")
    )
    orch = iu.module_from_spec(spec)

    original_run = subprocess.run

    class FakeCompleted:
        returncode = 1
        stdout = ""
        stderr = "simulated failure"

    def fake_run(*args, **kwargs):
        cmd_args = args[0] if args else kwargs.get("args", [])
        if any("--adu" in str(a) for a in cmd_args):
            return FakeCompleted()
        return original_run(*args, **kwargs)

    subprocess.run = fake_run
    try:
        tmp_dir, registry = setup_temp_registry()
        os.environ["AGENT_FACTORY_REGISTRY_DIR"] = str(registry)
        os.environ["AGENT_FACTORY_PROJECTS_REGISTRY"] = str(registry / "projects.json")

        spec.loader.exec_module(orch)

        epic = {
            "id": "EPIC-TEST-0001",
            "project_id": "test-project",
            "repo_path": tmp_dir,
            "state": "child_adus_running",
            "child_adus": ["ADU-TEST-001"],
            "dependencies": [],
            "title": "Test",
            "source_requirement": "Test",
            "risk": "low",
            "target_level": "mvp",
            "language": "zh",
            "created_at": "2026-06-11T00:00:00.000Z",
            "updated_at": "2026-06-11T00:00:00.000Z",
        }

        result = orch.step_epic(epic, "test-project", tmp_dir)
        assert result.get("result") == "blocked", \
            f"Expected blocked when child fails, got: {result}"
        assert epic.get("state") == "child_adus_blocked", \
            f"Expected epic state child_adus_blocked, got: {epic.get('state')}"

        teardown_temp(tmp_dir)
    finally:
        subprocess.run = original_run
        os.environ.pop("AGENT_FACTORY_REGISTRY_DIR", None)
        os.environ.pop("AGENT_FACTORY_PROJECTS_REGISTRY", None)


def test_c_runner_artifact_gating():
    """Runner fails when agent reports success but artifact file is missing."""
    tmp_dir, registry = setup_temp_registry()

    env = os.environ.copy()
    env["AGENT_FACTORY_REGISTRY_DIR"] = str(registry)
    env["AGENT_FACTORY_PROJECTS_REGISTRY"] = str(registry / "projects.json")

    result = subprocess.run(
        [sys.executable, str(SCRIPTS / "hermes_agent_run.py"),
         "--epic", "EPIC-TEST-0001",
         "--agent", "system-flow-designer",
         "--project", "test-project",
         "--repo", tmp_dir],
        cwd=tmp_dir,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # The runner should have marked the run as failed because artifact is missing
    runs_data = json.loads((registry / "runs.json").read_text())
    last_run = runs_data.get("runs", [])[-1] if runs_data.get("runs") else {}
    run_result = last_run.get("result", "unknown")

    assert run_result == "failed", \
        f"Expected run result 'failed' when artifact missing, got: '{run_result}'.\n" \
        f"STDOUT: {result.stdout[:500]}\nSTDERR: {result.stderr[:500]}\n" \
        f"exit code: {result.returncode}"

    teardown_temp(tmp_dir)


def main():
    print("── Epic Orchestrator Integration Tests ──\n")

    assert_test("run_child_adu returns failed on non-zero exit", test_a_child_failure_detection)
    assert_test("step_epic returns blocked on child ADU failure", test_b_step_epic_blocked_on_failure)
    assert_test("runner fails when agent success but artifact missing", test_c_runner_artifact_gating)

    print(f"\n── Results: {passed} passed, {failed} failed ──")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()

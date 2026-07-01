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
        "hermes_bin": str(Path(tmp) / "mock-hermes.py"),
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
    mock_hermes = Path(tmp) / "mock-hermes.py"
    mock_hermes.write_text("""#!/usr/bin/env python3
import json
import pathlib
import re
import sys

result = {
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
    "commands_run": [],
    "risks": [],
    "next_agent": "adu-splitter"
}
prompt = sys.argv[-1] if len(sys.argv) > 1 else ""
match = re.search(r'"completion_file"\\s*:\\s*"([^"]+)"', prompt)
if match:
    completion = pathlib.Path.cwd() / match.group(1)
    completion.parent.mkdir(parents=True, exist_ok=True)
    temporary = completion.with_name(completion.name + ".tmp")
    temporary.write_text(json.dumps({
        "version": 1,
        "status": "success",
        "result": result,
    }), encoding="utf-8")
    temporary.replace(completion)
print("```json")
print(json.dumps(result))
print("```")
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

    import sys
    sys.modules.pop("hermes_epic_orchestrator", None)
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


def setup_temp_registry_with_running_child():
    """Create registry with a child ADU in a running (implemented) state."""
    tmp = tempfile.mkdtemp(prefix="epic-running-test-")
    registry = Path(tmp) / "registry"
    registry.mkdir(parents=True)

    epics_data = {
        "version": 1,
        "epics": [{
            "id": "EPIC-TEST-0001",
            "project_id": "test-project",
            "repo_path": str(tmp),
            "title": "Test Epic",
            "source_requirement": "Test requirement",
            "state": "child_adus_running",
            "risk": "low",
            "target_level": "mvp",
            "language": "zh",
            "child_adus": ["ADU-TEST-001"],
            "dependencies": [],
            "created_at": "2026-06-11T00:00:00.000Z",
            "updated_at": "2026-06-11T00:00:00.000Z",
        }]
    }
    (registry / "epics.json").write_text(json.dumps(epics_data, indent=2))

    # Child ADU in a real running state (implemented), not created
    adu_data = {
        "version": 1,
        "adus": [{
            "id": "ADU-TEST-001",
            "project_id": "test-project",
            "repo_path": str(tmp),
            "title": "Test Child ADU",
            "goal": "Test",
            "state": "implemented",
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
    (registry / "runs.json").write_text(json.dumps({"version": 1, "runs": []}))

    agents_data = {
        "version": 1,
        "hermes_bin": str(Path(tmp) / "mock-hermes.sh"),
        "agents": {"system-flow-designer": {"description": "Test", "prompt": "test-prompt.md", "worktree": False, "hermes_args": []}}
    }
    (registry / "agents.json").write_text(json.dumps(agents_data, indent=2))

    profile_dir = Path(tmp) / ".agent-factory"
    profile_dir.mkdir(parents=True)
    (profile_dir / "project-profile.json").write_text(json.dumps({"project_type": "test"}))
    knowledge_dir = profile_dir / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / "project-summary.md").write_text("# Test")

    projects_path = registry / "projects.json"
    projects_data = {"version": 1, "projects": [{"project_id": "test-project", "name": "Test", "repo_path": str(tmp), "status": "profiled"}]}
    projects_path.write_text(json.dumps(projects_data, indent=2))

    return tmp, registry


def test_b_step_epic_blocked_on_failure():
    """step_epic returns blocked when run_child_adu fails."""
    import importlib.util as iu

    import sys
    sys.modules.pop("hermes_epic_orchestrator", None)
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
        tmp_dir, registry = setup_temp_registry_with_running_child()
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


def setup_dependency_registry():
    """Create temp registry with ADU-TEST-001 (evidenced) and ADU-TEST-002 (created, depending on 001)."""
    tmp = tempfile.mkdtemp(prefix="epic-dep-test-")
    registry = Path(tmp) / "registry"
    registry.mkdir(parents=True)

    epics_data = {
        "version": 1,
        "epics": [{
            "id": "EPIC-TEST-0001",
            "project_id": "test-project",
            "repo_path": str(tmp),
            "state": "child_adus_running",
            "child_adus": ["ADU-TEST-001", "ADU-TEST-002"],
            "dependencies": [{"from": "ADU-TEST-001", "to": "ADU-TEST-002"}],
            "created_at": "2026-06-11T00:00:00.000Z",
            "updated_at": "2026-06-11T00:00:00.000Z",
        }]
    }
    (registry / "epics.json").write_text(json.dumps(epics_data, indent=2))

    adu_data = {
        "version": 1,
        "adus": [
            {
                "id": "ADU-TEST-001",
                "project_id": "test-project",
                "repo_path": str(tmp),
                "state": "evidenced",
                "goal": "Test 1",
                "depends_on": [],
                "retry_count": 0,
                "max_retries": 3,
                "artifacts": []
            },
            {
                "id": "ADU-TEST-002",
                "project_id": "test-project",
                "repo_path": str(tmp),
                "state": "created",
                "goal": "Test 2",
                "depends_on": ["ADU-TEST-001"],
                "retry_count": 0,
                "max_retries": 3,
                "artifacts": []
            }
        ]
    }
    (registry / "adu.json").write_text(json.dumps(adu_data, indent=2))
    (registry / "runs.json").write_text(json.dumps({"version": 1, "runs": []}))

    # Initialize a dummy git repository in tmp
    subprocess.run(["git", "init"], cwd=tmp, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=tmp, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test User"], cwd=tmp, capture_output=True)

    # Create a dummy commit so rev-parse HEAD works
    dummy_file = Path(tmp) / "dummy.txt"
    dummy_file.write_text("initial commit")
    subprocess.run(["git", "add", "dummy.txt"], cwd=tmp, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial commit"], cwd=tmp, capture_output=True)

    return tmp, registry


def test_d_dependency_drift_blocks_execution():
    """step_epic blocks execution and transitions to human_gate when dependency manifest is missing."""
    tmp_dir, registry = setup_dependency_registry()
    os.environ["AGENT_FACTORY_REGISTRY_DIR"] = str(registry)
    os.environ["AGENT_FACTORY_PROJECTS_REGISTRY"] = str(registry / "projects.json")

    import sys
    sys.modules.pop("hermes_epic_orchestrator", None)
    import importlib.util as iu
    spec = iu.spec_from_file_location("hermes_epic_orchestrator", str(SCRIPTS / "hermes_epic_orchestrator.py"))
    orch = iu.module_from_spec(spec)
    spec.loader.exec_module(orch)

    try:
        epic = {
            "id": "EPIC-TEST-0001",
            "project_id": "test-project",
            "repo_path": tmp_dir,
            "state": "child_adus_running",
            "child_adus": ["ADU-TEST-001", "ADU-TEST-002"],
            "dependencies": [{"from": "ADU-TEST-001", "to": "ADU-TEST-002"}],
        }

        result = orch.step_epic(epic, "test-project", tmp_dir)
        assert result.get("result") == "blocked", f"Expected blocked status, got: {result}"
        assert epic.get("state") == "child_adus_blocked", f"Expected epic state child_adus_blocked, got: {epic.get('state')}"

        # Child ADU 2 should have transitioned to human_gate with dependency_delivery_missing
        adu_data = json.loads((registry / "adu.json").read_text())
        child2 = next(a for a in adu_data["adus"] if a["id"] == "ADU-TEST-002")
        assert child2.get("state") == "human_gate", f"Expected child state human_gate, got: {child2.get('state')}"
        assert child2.get("gate_type") == "dependency_delivery_missing", f"Expected gate_type dependency_delivery_missing, got: {child2.get('gate_type')}"

    finally:
        teardown_temp(tmp_dir)
        os.environ.pop("AGENT_FACTORY_REGISTRY_DIR", None)
        os.environ.pop("AGENT_FACTORY_PROJECTS_REGISTRY", None)


def test_e_dependency_delivery_verification():
    """test_e verifies healthy, missing file, hash mismatch, unreachable commit, and missing output in outputs_hash."""
    tmp_dir, registry = setup_dependency_registry()
    os.environ["AGENT_FACTORY_REGISTRY_DIR"] = str(registry)
    os.environ["AGENT_FACTORY_PROJECTS_REGISTRY"] = str(registry / "projects.json")

    import sys
    sys.modules.pop("hermes_epic_orchestrator", None)
    import importlib.util as iu
    spec = iu.spec_from_file_location("hermes_epic_orchestrator", str(SCRIPTS / "hermes_epic_orchestrator.py"))
    orch = iu.module_from_spec(spec)
    spec.loader.exec_module(orch)

    try:
        # Create a deliverable file
        deliverable = Path(tmp_dir) / "output.txt"
        deliverable.write_text("hello world")

        # Git commit deliverable to HEAD
        subprocess.run(["git", "add", "output.txt"], cwd=tmp_dir, capture_output=True)
        subprocess.run(["git", "commit", "-m", "deliverable commit"], cwd=tmp_dir, capture_output=True)

        proc = subprocess.run(["git", "rev-parse", "HEAD"], cwd=tmp_dir, capture_output=True, text=True)
        delivery_commit = proc.stdout.strip()

        # Create manifest
        manifest_dir = Path(tmp_dir) / ".ai-agent" / "evidence"
        manifest_dir.mkdir(parents=True)
        import hashlib
        h = hashlib.sha256()
        h.update(b"hello world")
        expected_hash = h.hexdigest()

        manifest = {
            "adu_id": "ADU-TEST-001",
            "base_commit": delivery_commit,
            "delivery_commit": delivery_commit,
            "required_outputs": ["output.txt"],
            "outputs_hash": {"output.txt": expected_hash}
        }
        (manifest_dir / "ADU-TEST-001-manifest.json").write_text(json.dumps(manifest))

        epic = {
            "id": "EPIC-TEST-0001",
            "project_id": "test-project",
            "repo_path": tmp_dir,
            "state": "child_adus_running",
            "child_adus": ["ADU-TEST-001", "ADU-TEST-002"],
            "dependencies": [{"from": "ADU-TEST-001", "to": "ADU-TEST-002"}],
        }

        # Mock run_child_adu to verify it gets scheduled
        original_run_child = orch.run_child_adu
        run_called = []
        def fake_run_child(adu_id, mode, project_id, repo_root):
            run_called.append(adu_id)
            return {"result": "success"}
        orch.run_child_adu = fake_run_child

        # Run step - should schedule ADU-TEST-002
        result = orch.step_epic(epic, "test-project", tmp_dir)
        assert "ADU-TEST-002" in run_called, "Expected ADU-TEST-002 to be scheduled"
        orch.run_child_adu = original_run_child

        # Reset registry to created for ADU-TEST-002
        adu_data = json.loads((registry / "adu.json").read_text())
        for a in adu_data["adus"]:
            if a["id"] == "ADU-TEST-002":
                a["state"] = "created"
        (registry / "adu.json").write_text(json.dumps(adu_data))
        epic["state"] = "child_adus_running"

        # 2. Missing File Scenario
        deliverable.unlink()
        result = orch.step_epic(epic, "test-project", tmp_dir)
        assert result.get("result") == "blocked", "Expected blocked due to missing file"

        # Reset ADU-TEST-002 to created
        adu_data = json.loads((registry / "adu.json").read_text())
        for a in adu_data["adus"]:
            if a["id"] == "ADU-TEST-002":
                a["state"] = "created"
        (registry / "adu.json").write_text(json.dumps(adu_data))
        epic["state"] = "child_adus_running"

        # 3. Hash Mismatch Scenario
        deliverable.write_text("changed content")
        result = orch.step_epic(epic, "test-project", tmp_dir)
        assert result.get("result") == "blocked", "Expected blocked due to hash mismatch"

        # Reset ADU-TEST-002 to created
        adu_data = json.loads((registry / "adu.json").read_text())
        for a in adu_data["adus"]:
            if a["id"] == "ADU-TEST-002":
                a["state"] = "created"
        (registry / "adu.json").write_text(json.dumps(adu_data))
        epic["state"] = "child_adus_running"

        # Restore correct content
        deliverable.write_text("hello world")

        # 4. Unreachable Commit Scenario
        # Edit manifest to use a non-existent commit hash
        manifest["delivery_commit"] = "a" * 40
        (manifest_dir / "ADU-TEST-001-manifest.json").write_text(json.dumps(manifest))
        result = orch.step_epic(epic, "test-project", tmp_dir)
        assert result.get("result") == "blocked", "Expected blocked due to unreachable commit"

        # Reset ADU-TEST-002 to created
        adu_data = json.loads((registry / "adu.json").read_text())
        for a in adu_data["adus"]:
            if a["id"] == "ADU-TEST-002":
                a["state"] = "created"
        (registry / "adu.json").write_text(json.dumps(adu_data))
        epic["state"] = "child_adus_running"

        # 5. Missing Expected Output in outputs_hash (Subset Check)
        manifest["delivery_commit"] = delivery_commit
        manifest["required_outputs"] = ["output.txt", "missing-output.txt"]
        manifest["outputs_hash"] = {"output.txt": expected_hash} # missing-output.txt is NOT in outputs_hash
        (manifest_dir / "ADU-TEST-001-manifest.json").write_text(json.dumps(manifest))
        result = orch.step_epic(epic, "test-project", tmp_dir)
        assert result.get("result") == "blocked", "Expected blocked due to subset check failure"

        # Verify the gate reason mentions outputs_hash missing
        adu_data = json.loads((registry / "adu.json").read_text())
        child2 = next(a for a in adu_data["adus"] if a["id"] == "ADU-TEST-002")
        assert child2.get("state") == "human_gate", f"Expected child state human_gate, got: {child2.get('state')}"
        assert child2.get("gate_type") == "dependency_delivery_missing", f"Expected gate_type dependency_delivery_missing, got: {child2.get('gate_type')}"

        # 6. Canceled Dependency Scenario (dependency_blocked)
        # Reset ADU-TEST-002 to created
        adu_data = json.loads((registry / "adu.json").read_text())
        for a in adu_data["adus"]:
            if a["id"] == "ADU-TEST-002":
                a["state"] = "created"
            elif a["id"] == "ADU-TEST-001":
                a["state"] = "canceled"
        (registry / "adu.json").write_text(json.dumps(adu_data))
        epic["state"] = "child_adus_running"

        result = orch.step_epic(epic, "test-project", tmp_dir)
        assert result.get("result") == "blocked", "Expected blocked due to canceled dependency"

        # Verify the gate reason and check that available_actions contains ONLY cancel
        adu_data = json.loads((registry / "adu.json").read_text())
        child2 = next(a for a in adu_data["adus"] if a["id"] == "ADU-TEST-002")
        assert child2.get("state") == "human_gate", f"Expected child state human_gate, got: {child2.get('state')}"
        assert child2.get("gate_type") == "dependency_blocked", f"Expected gate_type dependency_blocked, got: {child2.get('gate_type')}"

        # Check human-gates.json entry
        gates_data = json.loads((Path(registry) / "human-gates.json").read_text())
        pending_gate = next((g for g in gates_data.get("gates", []) if g.get("target_id") == "ADU-TEST-002" and g.get("gate_type") == "dependency_blocked" and g.get("status") == "pending"), None)
        assert pending_gate is not None, "Expected pending gate in human-gates.json"
        assert pending_gate.get("gate_type") == "dependency_blocked", f"Expected gate type dependency_blocked, got: {pending_gate.get('gate_type')}"
        assert pending_gate.get("available_actions") == ["cancel"], f"Expected available_actions to be ['cancel'], got: {pending_gate.get('available_actions')}"

    finally:
        teardown_temp(tmp_dir)
        os.environ.pop("AGENT_FACTORY_REGISTRY_DIR", None)
        os.environ.pop("AGENT_FACTORY_PROJECTS_REGISTRY", None)


def test_f_generate_adu_manifest_aggregation():
    """test_f verifies that generate_adu_manifest properly aggregates file changes from previous runs, normalizes paths safely, and fails when delta file is corrupted or missing."""
    import importlib.util as iu
    import hashlib
    spec = iu.spec_from_file_location("hermes_agent_run", str(SCRIPTS / "hermes_agent_run.py"))
    run_mod = iu.module_from_spec(spec)
    spec.loader.exec_module(run_mod)

    tmp_dir, registry = setup_dependency_registry()
    os.environ["AGENT_FACTORY_REGISTRY_DIR"] = str(registry)
    os.environ["AGENT_FACTORY_PROJECTS_REGISTRY"] = str(registry / "projects.json")

    try:
        # Create allowed write paths in contract
        contract_path = Path(tmp_dir) / ".ai-agent" / "contracts" / "ADU-TEST-001.json"
        contract_path.parent.mkdir(parents=True, exist_ok=True)
        contract_path.write_text(json.dumps({
            "version": 2,
            "adu_id": "ADU-TEST-001",
            "scope": {
                "allowed_write_paths": ["lib/dbi/subscription.c", "lib/dbi/subscription.h", ".ai-agent/evidence/"]
            }
        }))

        # Mock previous runs in runs.json
        run1_dir = Path(tmp_dir) / ".ai-agent" / "runs" / "run1"
        run1_dir.mkdir(parents=True, exist_ok=True)
        # run1 modified subscription.c
        (run1_dir / "file-delta.json").write_text(json.dumps({
            "created": ["lib/dbi/subscription.c"],
            "modified": [],
            "deleted": []
        }))
        # Create the file on disk
        sub_c = Path(tmp_dir) / "lib/dbi/subscription.c"
        sub_c.parent.mkdir(parents=True, exist_ok=True)
        sub_c.write_text("dbi code")

        run2_dir = Path(tmp_dir) / ".ai-agent" / "runs" / "run2"
        run2_dir.mkdir(parents=True, exist_ok=True)
        # run2 modified subscription.h
        (run2_dir / "file-delta.json").write_text(json.dumps({
            "created": [],
            "modified": ["lib/dbi/subscription.h"],
            "deleted": []
        }))
        # Create the file on disk
        sub_h = Path(tmp_dir) / "lib/dbi/subscription.h"
        sub_h.write_text("dbi headers")

        runs_data = {
            "version": 1,
            "runs": [
                {
                    "adu_id": "ADU-TEST-001",
                    "run_dir": ".ai-agent/runs/run1",
                    "agent": "developer",
                    "result": "success"
                },
                {
                    "adu_id": "ADU-TEST-001",
                    "run_dir": ".ai-agent/runs/run2",
                    "agent": "developer",
                    "result": "success"
                }
            ]
        }
        (registry / "runs.json").write_text(json.dumps(runs_data, indent=2))

        # Current evidence run directory
        current_run_dir = Path(tmp_dir) / ".ai-agent" / "runs" / "run3"
        current_run_dir.mkdir(parents=True, exist_ok=True)
        # current run modified evidence file
        (current_run_dir / "file-delta.json").write_text(json.dumps({
            "created": [".ai-agent/evidence/ADU-TEST-001.md"],
            "modified": [],
            "deleted": []
        }))
        # Create evidence file on disk
        ev_md = Path(tmp_dir) / ".ai-agent/evidence/ADU-TEST-001.md"
        ev_md.parent.mkdir(parents=True, exist_ok=True)
        ev_md.write_text("evidence content")

        adu = {
            "id": "ADU-TEST-001",
            "allowed_write_paths": ["lib/dbi/subscription.c", "lib/dbi/subscription.h", ".ai-agent/evidence/"],
            "required_evidence": [".ai-agent/evidence/ADU-TEST-001.md"]
        }

        # Call generator
        run_mod.generate_adu_manifest(adu, Path(tmp_dir), current_run_dir, Path(registry))

        # Verify manifest contents
        manifest_path = Path(tmp_dir) / ".ai-agent" / "evidence" / "ADU-TEST-001-manifest.json"
        assert manifest_path.exists(), "Manifest should have been generated"
        manifest = json.loads(manifest_path.read_text())

        required = manifest.get("required_outputs", [])
        assert "lib/dbi/subscription.c" in required, "subscription.c should be in manifest"
        assert "lib/dbi/subscription.h" in required, "subscription.h should be in manifest"
        assert ".ai-agent/evidence/ADU-TEST-001.md" in required, "ADU-TEST-001.md should be in manifest"

        # Verify actual file hashes are calculated
        hashes = manifest.get("outputs_hash", {})
        assert len(hashes) == 3, "Hashes for all 3 deliverables should be calculated"
        assert hashes.get("lib/dbi/subscription.c") == hashlib.sha256(b"dbi code").hexdigest()

        # Restore current delta for subsequent tests
        current_delta_content = json.dumps({"created": [".ai-agent/evidence/ADU-TEST-001.md"], "modified": [], "deleted": []})
        (current_run_dir / "file-delta.json").write_text(current_delta_content)

        # Verify error handling: P1 fail-closed on missing file-delta.json
        (current_run_dir / "file-delta.json").unlink()
        try:
            run_mod.generate_adu_manifest(adu, Path(tmp_dir), current_run_dir, Path(registry))
            assert False, "Should have raised exception due to missing file-delta.json"
        except RuntimeError as e:
            assert "missing" in str(e).lower(), f"Expected missing delta file error, got: {e}"

        # Verify error handling: P1 fail-closed on corrupted file-delta.json
        (current_run_dir / "file-delta.json").write_text("{invalid json")
        try:
            run_mod.generate_adu_manifest(adu, Path(tmp_dir), current_run_dir, Path(registry))
            assert False, "Should have raised exception due to corrupted file-delta.json"
        except RuntimeError as e:
            assert "failed to parse" in str(e).lower(), f"Expected failed to parse error, got: {e}"

        # Restore current delta
        (current_run_dir / "file-delta.json").write_text(current_delta_content)

        # Verify error handling: P0 fail-closed on missing runs.json
        runs_file_path = Path(registry) / "runs.json"
        runs_backup = runs_file_path.read_text()
        runs_file_path.unlink()
        try:
            run_mod.generate_adu_manifest(adu, Path(tmp_dir), current_run_dir, Path(registry))
            assert False, "Should have raised exception due to missing runs.json"
        except RuntimeError as e:
            assert "runs.json is missing" in str(e).lower(), f"Expected missing runs.json error, got: {e}"

        # Verify error handling: P0 fail-closed on corrupted runs.json
        runs_file_path.write_text("{invalid runs")
        try:
            run_mod.generate_adu_manifest(adu, Path(tmp_dir), current_run_dir, Path(registry))
            assert False, "Should have raised exception due to corrupted runs.json"
        except RuntimeError as e:
            assert "failed to parse runs.json" in str(e).lower(), f"Expected corrupted runs.json error, got: {e}"

        # Restore runs.json
        runs_file_path.write_text(runs_backup)

        # Verify error handling: P0 fail-closed on missing historical production file-delta.json
        hist_delta_path = run1_dir / "file-delta.json"
        hist_delta_backup = hist_delta_path.read_text()
        hist_delta_path.unlink()
        try:
            run_mod.generate_adu_manifest(adu, Path(tmp_dir), current_run_dir, Path(registry))
            assert False, "Should have raised exception due to missing historical production file-delta.json"
        except RuntimeError as e:
            assert "file-delta.json is missing in production" in str(e).lower(), f"Expected missing historical delta error, got: {e}"

        # Verify error handling: P0 fail-closed on corrupted historical production file-delta.json
        hist_delta_path.write_text("{corrupt delta")
        try:
            run_mod.generate_adu_manifest(adu, Path(tmp_dir), current_run_dir, Path(registry))
            assert False, "Should have raised exception due to corrupted historical production file-delta.json"
        except RuntimeError as e:
            assert "failed to parse file-delta.json in" in str(e).lower(), f"Expected corrupted historical delta error, got: {e}"

        # Restore historical delta
        hist_delta_path.write_text(hist_delta_backup)

        # Verify error handling: P0 fail-closed on successful production run but empty delta
        (run1_dir / "file-delta.json").write_text(json.dumps({
            "created": [],
            "modified": [],
            "deleted": []
        }))
        (run2_dir / "file-delta.json").write_text(json.dumps({
            "created": [],
            "modified": [],
            "deleted": []
        }))
        try:
            run_mod.generate_adu_manifest(adu, Path(tmp_dir), current_run_dir, Path(registry))
            assert False, "Should have raised exception due to empty production required_outputs for code-based ADU"
        except RuntimeError as e:
            assert "empty" in str(e).lower() or "no production files" in str(e).lower(), f"Expected empty deliverables error, got: {e}"

        # Verify: if ADU is explicitly codeless, it passes even with empty production delta
        codeless_adu = {
            "id": "ADU-TEST-001",
            "codeless": True,
            "allowed_write_paths": ["lib/dbi/subscription.c", "lib/dbi/subscription.h", ".ai-agent/evidence/"],
            "required_evidence": [".ai-agent/evidence/ADU-TEST-001.md"]
        }
        run_mod.generate_adu_manifest(codeless_adu, Path(tmp_dir), current_run_dir, Path(registry))

        # Restore historical deltas
        (run1_dir / "file-delta.json").write_text(hist_delta_backup)
        (run2_dir / "file-delta.json").write_text(json.dumps({
            "created": [],
            "modified": ["lib/dbi/subscription.h"],
            "deleted": []
        }))

        # Verify error handling: P2 repository boundary validation traversal failure
        runs_data["runs"][0]["run_dir"] = "../../outer"
        (registry / "runs.json").write_text(json.dumps(runs_data, indent=2))
        try:
            run_mod.generate_adu_manifest(adu, Path(tmp_dir), current_run_dir, Path(registry))
            assert False, "Should have raised exception due to directory traversal in run_dir"
        except RuntimeError as e:
            assert "traversal" in str(e).lower() or "invalid run_dir" in str(e).lower(), f"Expected traversal error, got: {e}"

        # Verify: required_deliverables checks.
        # If required_deliverables has three files, but the developer only created two, it must fail.
        runs_data["runs"][0]["run_dir"] = ".ai-agent/runs/run1"
        (registry / "runs.json").write_text(json.dumps(runs_data, indent=2))
        (run1_dir / "file-delta.json").write_text(hist_delta_backup)

        # Delete the old contract so it doesn't cause a contract validation error
        old_contract = Path(tmp_dir) / ".ai-agent" / "contracts" / "ADU-TEST-001.json"
        if old_contract.exists():
            old_contract.unlink()

        adu_with_deliverables = {
            "id": "ADU-TEST-001",
            "allowed_write_paths": ["lib/dbi/subscription.c", "lib/dbi/subscription.h", "lib/dbi/never_created.c", ".ai-agent/evidence/"],
            "required_evidence": [".ai-agent/evidence/ADU-TEST-001.md"],
            "required_deliverables": [
                "lib/dbi/subscription.c",
                "lib/dbi/subscription.h",
                "lib/dbi/never_created.c" # This file does not exist on disk!
            ]
        }
        try:
            run_mod.generate_adu_manifest(adu_with_deliverables, Path(tmp_dir), current_run_dir, Path(registry))
            assert False, "Should have raised exception because required deliverable file never_created.c was never created"
        except RuntimeError as e:
            assert "never_created.c" in str(e) or "missing from disk" in str(e), f"Expected missing deliverable file error, got: {e}"

        # Verify P1: required deliverable exists on disk but was not modified by the ADU
        never_created_c = Path(tmp_dir) / "lib/dbi/never_created.c"
        never_created_c.parent.mkdir(parents=True, exist_ok=True)
        never_created_c.write_text("already exists on disk")
        try:
            run_mod.generate_adu_manifest(adu_with_deliverables, Path(tmp_dir), current_run_dir, Path(registry))
            assert False, "Should have raised exception because never_created.c exists but was not modified by the ADU"
        except RuntimeError as e:
            assert "was not created or modified by this ADU" in str(e), f"Expected not created/modified error, got: {e}"
        never_created_c.unlink()

        # Verify: codeless cannot be bypassed by Agent writing "codeless": true in contract (only trusted ADU list)
        (Path(tmp_dir) / ".ai-agent" / "contracts").mkdir(parents=True, exist_ok=True)
        contract_path = Path(tmp_dir) / ".ai-agent" / "contracts" / "ADU-TEST-001.json"
        contract_path.write_text(json.dumps({
            "codeless": True,
            "required_deliverables": ["lib/dbi/subscription.c", "lib/dbi/subscription.h", "lib/dbi/never_created.c"],
            "scope": {
                "allowed_write_paths": ["lib/dbi/subscription.c", "lib/dbi/subscription.h", "lib/dbi/never_created.c"]
            }
        }))

        # This should still fail closed for code-based ADU (ignoring the contract's codeless bypass)
        try:
            run_mod.generate_adu_manifest(adu_with_deliverables, Path(tmp_dir), current_run_dir, Path(registry))
            assert False, "Should have raised exception because contract's codeless bypass must be ignored"
        except RuntimeError as e:
            assert "never_created.c" in str(e) or "missing from disk" in str(e), f"Expected missing deliverable file error, got: {e}"

        # Clean up the contract file
        if contract_path.exists():
            contract_path.unlink()

    finally:
        teardown_temp(tmp_dir)
        os.environ.pop("AGENT_FACTORY_REGISTRY_DIR", None)
        os.environ.pop("AGENT_FACTORY_PROJECTS_REGISTRY", None)


def test_g_e2e_split_materialize_missing_deliverable_block():
    """test_g verifies the E2E chain: split plan validation -> materialization -> manifest blocking when a required deliverable is missing."""
    tmp_dir, registry = setup_dependency_registry()
    os.environ["AGENT_FACTORY_REGISTRY_DIR"] = str(registry)
    os.environ["AGENT_FACTORY_PROJECTS_REGISTRY"] = str(registry / "projects.json")

    import sys
    sys.modules.pop("hermes_epic_orchestrator", None)
    import importlib.util as iu
    spec = iu.spec_from_file_location("hermes_epic_orchestrator", str(SCRIPTS / "hermes_epic_orchestrator.py"))
    orch = iu.module_from_spec(spec)
    spec.loader.exec_module(orch)

    # pop run_mod to get fresh module
    sys.modules.pop("hermes_agent_run", None)
    run_spec = iu.spec_from_file_location("hermes_agent_run", str(SCRIPTS / "hermes_agent_run.py"))
    run_mod = iu.module_from_spec(run_spec)
    run_mod.REGISTRY = registry
    run_spec.loader.exec_module(run_mod)

    try:
        epic = {
            "id": "EPIC-TEST-0001",
            "project_id": "test-project",
            "repo_path": tmp_dir,
            "state": "flow_designed"
        }

        # 1. Write split plan json with child adu specifying allowed_write_paths and required_deliverables
        epics_dir = Path(tmp_dir) / ".ai-agent" / "epics" / epic["id"]
        epics_dir.mkdir(parents=True, exist_ok=True)
        split_plan_file = epics_dir / "split-plan.json"

        split_plan_data = {
            "version": 1,
            "epic_id": epic["id"],
            "decision": "split_required",
            "reason": "Detailed splitting decision",
            "child_adus": [
                {
                    "id": "ADU-CHILD-001",
                    "title": "Child 1",
                    "goal": "Goal 1",
                    "scope": "Scope 1",
                    "allowed_write_paths": ["src/module1/file.c", "src/module1/file.h"],
                    "required_deliverables": ["src/module1/file.c", "src/module1/file.h"],
                    "required_commands": ["meson compile"],
                    "acceptance_summary": "Summary 1"
                },
                {
                    "id": "ADU-CHILD-002",
                    "title": "Child 2",
                    "goal": "Goal 2",
                    "scope": "Scope 2",
                    "allowed_write_paths": ["src/module2/file.c"],
                    "required_deliverables": ["src/module2/file.c"],
                    "required_commands": ["meson compile"],
                    "acceptance_summary": "Summary 2"
                }
            ],
            "dependencies": [
                {
                    "from": "ADU-CHILD-001",
                    "to": "ADU-CHILD-002",
                    "semantics": "prerequisite_to_dependent",
                    "reason": "child 2 depends on child 1"
                }
            ],
            "acceptance_coverage": []
        }
        split_plan_file.write_text(json.dumps(split_plan_data, indent=2))

        # Run validate_epic_split_plan.py directly
        import subprocess
        val_cmd = [sys.executable, str(SCRIPTS / "validate_epic_split_plan.py"), str(split_plan_file)]
        val_proc = subprocess.run(val_cmd, capture_output=True, text=True)
        assert val_proc.returncode == 0, f"split-plan validation failed: {val_proc.stderr}"

        # 2. Materialize child ADUs
        res = orch.materialize_child_adus(epic, tmp_dir)
        assert res.get("result") == "success", f"Materialization failed: {res}"

        # Check registry state
        adu_data = json.loads((registry / "adu.json").read_text())
        child1 = next(a for a in adu_data["adus"] if a["id"] == "ADU-CHILD-001")
        assert child1.get("codeless") is False
        assert child1.get("required_deliverables") == ["src/module1/file.c", "src/module1/file.h"]

        # 3. Simulate Developer run and Manifest Generation
        # Seed runs.json and file-delta.json
        runs_file = registry / "runs.json"
        run_id = "run-dev-001"
        runs_data = {
            "version": 1,
            "runs": [
                {
                    "adu_id": "ADU-CHILD-001",
                    "run_dir": f".ai-agent/runs/{run_id}",
                    "agent": "developer",
                    "result": "success"
                }
            ]
        }
        runs_file.write_text(json.dumps(runs_data, indent=2))

        run_dir = Path(tmp_dir) / ".ai-agent" / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        # Only created one file: file.c (file.h is missing!)
        (run_dir / "file-delta.json").write_text(json.dumps({
            "created": ["src/module1/file.c"],
            "modified": [],
            "deleted": []
        }))

        # Create file.c on disk
        file_c = Path(tmp_dir) / "src/module1/file.c"
        file_c.parent.mkdir(parents=True, exist_ok=True)
        file_c.write_text("content c")

        # Now, calling generate_adu_manifest should FAIL because file.h is missing!
        current_run_dir = Path(tmp_dir) / ".ai-agent" / "runs" / "run-ev-001"
        current_run_dir.mkdir(parents=True, exist_ok=True)
        (current_run_dir / "file-delta.json").write_text(json.dumps({
            "created": [".ai-agent/evidence/ADU-CHILD-001.md"],
            "modified": [],
            "deleted": []
        }))

        # Create evidence file
        ev_file = Path(tmp_dir) / ".ai-agent" / "evidence" / "ADU-CHILD-001.md"
        ev_file.parent.mkdir(parents=True, exist_ok=True)
        ev_file.write_text("evidence content")

        try:
            run_mod.generate_adu_manifest(child1, Path(tmp_dir), current_run_dir, Path(registry))
            assert False, "Should have raised exception because file.h was never created/delivered"
        except RuntimeError as e:
            assert "file.h" in str(e) or "missing from disk" in str(e), f"Expected missing deliverable error, got: {e}"

    finally:
        teardown_temp(tmp_dir)
        os.environ.pop("AGENT_FACTORY_REGISTRY_DIR", None)
        os.environ.pop("AGENT_FACTORY_PROJECTS_REGISTRY", None)


def main():
    print("── Epic Orchestrator Integration Tests ──\n")

    assert_test("run_child_adu returns failed on non-zero exit", test_a_child_failure_detection)
    assert_test("step_epic returns blocked on child ADU failure", test_b_step_epic_blocked_on_failure)
    assert_test("runner fails when agent success but artifact missing", test_c_runner_artifact_gating)
    assert_test("dependency drift blocks child ADU execution", test_d_dependency_drift_blocks_execution)
    assert_test("dependency delivery verification handles drift scenarios", test_e_dependency_delivery_verification)
    assert_test("generate_adu_manifest aggregates and validates file delta", test_f_generate_adu_manifest_aggregation)
    assert_test("e2e split plan validate to materialize and missing deliverable block", test_g_e2e_split_materialize_missing_deliverable_block)

    print(f"\n── Results: {passed} passed, {failed} failed ──")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()

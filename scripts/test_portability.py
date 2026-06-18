#!/usr/bin/env python3
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

def read_text(path):
    return pathlib.Path(path).read_text(encoding="utf-8")

def assert_no_hill_default(path):
    text = read_text(path)
    hill_prefix = "/Users/" + "hill"
    bad_double = f'"{hill_prefix}/open5gs"'
    bad_single = f"'{hill_prefix}/open5gs'"
    if bad_double in text or bad_single in text:
        raise AssertionError(f"{path} still contains hardcoded {hill_prefix}/open5gs default")

def test_no_hill_defaults():
    assert_no_hill_default(ROOT / "scripts" / "hermes_project_profile.py")

def test_profile_help_runs_without_workspace_env():
    env = os.environ.copy()
    env.pop("AGENT_FACTORY_WORKSPACE", None)
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "hermes_project_profile.py"), "--help"],
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(result.stderr)

def test_agents_json_uses_workspace_token():
    agents_path = ROOT / ".ai-agent" / "registry" / "agents.json"
    text = agents_path.read_text(encoding="utf-8")
    hill_prefix = "/Users/" + "hill"
    bad_pattern = f'"{hill_prefix}/open5gs"'
    if bad_pattern in text:
        raise AssertionError(f"agents.json must not contain literal {bad_pattern}")
    if '"default_cwd": "${PROJECT_REPO_ROOT}"' not in text:
        raise AssertionError("agents.json default_cwd must use ${PROJECT_REPO_ROOT}")

import json
import tempfile

def test_bootstrap_creates_runtime_registry_files():
    with tempfile.TemporaryDirectory() as tmp:
        workspace = pathlib.Path(tmp)
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "agent_factory_bootstrap.py"),
                "--workspace",
                str(workspace),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise AssertionError(result.stderr)

        registry = workspace / ".ai-agent" / "registry"
        expected_files = [
            "adu.json",
            "runs.json",
            "reviews.json",
            "projects.json",
            "operations.json",
            "epics.json",
            "intake-drafts.json",
            "events.json",
            "evidence-waivers.json",
            "write-path-expansion-requests.json",
        ]
        for name in expected_files:
            path = registry / name
            if not path.exists():
                raise AssertionError(f"missing bootstrap file: {path}")
            json.loads(path.read_text(encoding="utf-8"))

def test_doctor_detects_tracked_path_leaks():
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "agent_factory_doctor.py"),
            "--workspace",
            str(ROOT),
            "--skip-hermes",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(result.stdout + result.stderr)

def test_expand_runtime_path():
    import importlib.util
    spec = importlib.util.spec_from_file_location("hermes_agent_run", str(ROOT / "scripts" / "hermes_agent_run.py"))
    hermes_agent_run = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hermes_agent_run)
    res = hermes_agent_run.expand_runtime_path("${AGENT_FACTORY_WORKSPACE}/subdir", "/my/root")
    if res != "/my/root/subdir":
        raise AssertionError(f"Expected /my/root/subdir but got {res}")
    project_res = hermes_agent_run.expand_runtime_path("${PROJECT_REPO_ROOT}/subdir", "/factory/root", "/project/root")
    if project_res != "/project/root/subdir":
        raise AssertionError(f"Expected /project/root/subdir but got {project_res}")

def test_project_adu_default_cwd_uses_project_repo_root():
    import importlib.util
    spec = importlib.util.spec_from_file_location("hermes_agent_run", str(ROOT / "scripts" / "hermes_agent_run.py"))
    hermes_agent_run = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hermes_agent_run)

    factory_root = pathlib.Path("/factory/root")
    project_root = pathlib.Path("/project/root")
    cwd = hermes_agent_run.resolve_agent_cwd("${PROJECT_REPO_ROOT}", factory_root, project_root)
    if cwd != project_root:
        raise AssertionError(f"Project ADU default cwd must be {project_root}, got {cwd}")

    explicit_project_cwd = hermes_agent_run.resolve_agent_cwd("${PROJECT_REPO_ROOT}/subdir", factory_root, project_root)
    if explicit_project_cwd != project_root / "subdir":
        raise AssertionError(f"Expected project-relative cwd, got {explicit_project_cwd}")

    factory_cwd = hermes_agent_run.resolve_agent_cwd("${AGENT_FACTORY_WORKSPACE}/tools", factory_root, project_root)
    if factory_cwd != factory_root / "tools":
        raise AssertionError(f"Expected factory-relative cwd, got {factory_cwd}")

if __name__ == "__main__":
    test_no_hill_defaults()
    test_profile_help_runs_without_workspace_env()
    test_agents_json_uses_workspace_token()
    test_bootstrap_creates_runtime_registry_files()
    test_doctor_detects_tracked_path_leaks()
    test_expand_runtime_path()
    test_project_adu_default_cwd_uses_project_repo_root()
    print("[PASS] python portability checks")

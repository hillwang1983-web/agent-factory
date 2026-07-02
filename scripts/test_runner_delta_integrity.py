#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

# Ensure scripts directory is in path
sys.path.insert(0, str(Path(__file__).resolve().parent))

class TestRunnerDeltaIntegrity(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.workspace_root = Path(self.tmpdir.name)

        # Initialize Git repo
        subprocess.run(["git", "init"], cwd=str(self.workspace_root), capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test User"], cwd=str(self.workspace_root), capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=str(self.workspace_root), capture_output=True)

        # Create Registry dir
        self.registry_dir = self.workspace_root / ".ai-agent" / "registry"
        self.registry_dir.mkdir(parents=True)

        # Copy real registry config to mock
        real_registry = Path(__file__).resolve().parents[1] / ".ai-agent" / "registry"
        for f in real_registry.iterdir():
            if f.is_file() and f.name != "projects.json":
                shutil.copy(str(f), str(self.registry_dir / f.name))

        # Setup blank project
        self.projects_data = {
            "version": 1,
            "projects": [
                {
                    "project_id": "test-proj",
                    "repo_path": str(self.workspace_root),
                    "status": "created"
                }
            ]
        }
        self.save_registry("projects.json", self.projects_data)

        # Setup adu
        self.adus_data = {
            "version": 1,
            "adus": [
                {
                    "id": "ADU-1",
                    "state": "created",
                    "project_id": "test-proj",
                    "allowed_write_paths": ["src/allowed.c", "include/"]
                }
            ]
        }
        self.save_registry("adu.json", self.adus_data)

        # Setup initial empty runs
        self.save_registry("runs.json", {"version": 1, "runs": []})

        # Add initial clean files to git to track them
        src_dir = self.workspace_root / "src"
        src_dir.mkdir(exist_ok=True)
        allowed_file = src_dir / "allowed.c"
        allowed_file.write_text("// initial allowed", encoding="utf-8")

        subprocess.run(["git", "add", "src/allowed.c"], cwd=str(self.workspace_root), capture_output=True)
        subprocess.run(["git", "commit", "-m", "initial commit"], cwd=str(self.workspace_root), capture_output=True)

        self.bin_dir = Path(self.tmpdir.name) / "bin"
        self.bin_dir.mkdir(parents=True, exist_ok=True)

        mock_hermes_content = """#!/usr/bin/env python3
import os
import sys
import json
from pathlib import Path

repo_path = Path(os.getcwd())
runs_dir = repo_path / ".ai-agent" / "runs"
latest_run_dir = None
if runs_dir.exists():
    subdirs = [d for d in runs_dir.iterdir() if d.is_dir()]
    if subdirs:
        latest_run_dir = max(subdirs, key=lambda d: d.stat().st_mtime)

mock_comp_env = os.environ.get("MOCK_COMPLETION_RESULT")
mock_touch_env = os.environ.get("MOCK_TOUCH_FILES")

if latest_run_dir:
    if mock_comp_env:
        completion_result = json.loads(mock_comp_env)
        completion_data = {
            "version": 1,
            "status": completion_result.get("status") or completion_result.get("result") or "success",
            "result": completion_result
        }
    else:
        completion_data = {
            "version": 1,
            "status": "success",
            "result": {
                "result": "success",
                "next_state": "implemented",
                "changed_files": [],
                "artifacts": [],
                "next_agent": None,
                "commands_run": [],
                "risks": []
            }
        }

    if completion_data["status"] == "success":
        res_obj = completion_data["result"]
        res_obj.setdefault("result", "success")
        res_obj.setdefault("next_state", "implemented")
        res_obj.setdefault("changed_files", [])
        res_obj.setdefault("artifacts", [])
        res_obj.setdefault("next_agent", None)
        res_obj.setdefault("commands_run", [])
        res_obj.setdefault("risks", [])

    completion_file = latest_run_dir / "completion_att1.json"
    with open(completion_file, "w", encoding="utf-8") as f:
        json.dump(completion_data, f, indent=2)

    files_to_touch = []
    if mock_touch_env:
        files_to_touch = json.loads(mock_touch_env)
    elif mock_comp_env:
        files_to_touch = completion_data["result"].get("changed_files", [])

    for f in files_to_touch:
        p = repo_path / f
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("mock content created by mock hermes", encoding="utf-8")

sys.exit(0)
"""
        mock_file = self.bin_dir / "hermes"
        mock_file.write_text(mock_hermes_content, encoding="utf-8")
        mock_file.chmod(0o755)

    def tearDown(self):
        self.tmpdir.cleanup()

    def save_registry(self, name, data):
        path = self.registry_dir / name
        with path.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def run_runner(self, agent_name, completion_result, actual_files_to_touch=None):
        script_path = Path(__file__).resolve().parent / "hermes_agent_run.py"

        env = os.environ.copy()
        env["AGENT_FACTORY_PROJECTS_REGISTRY"] = str(self.registry_dir / "projects.json")
        env["AGENT_FACTORY_WORKSPACE"] = str(self.workspace_root)
        env["MOCK_COMPLETION_RESULT"] = json.dumps(completion_result)
        env["PATH"] = str(self.bin_dir) + os.path.pathsep + env.get("PATH", "")

        if actual_files_to_touch:
            env["MOCK_TOUCH_FILES"] = json.dumps(actual_files_to_touch)

        res = subprocess.run([
            sys.executable, str(script_path),
            "--project", "test-proj",
            "--repo", str(self.workspace_root),
            "--agent", agent_name,
            "--adu", "ADU-1"
        ], env=env, capture_output=True, text=True)
        return res

    def get_last_run_record(self):
        runs_path = self.registry_dir / "runs.json"
        with runs_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data["runs"][-1] if data["runs"] else None

    def test_developer_writes_unauthorized_file_fails(self):
        completion = {
            "result": "success",
            "next_state": "implemented",
            "changed_files": ["src/forbidden.c"],
            "artifacts": ["src/forbidden.c"]
        }
        res = self.run_runner("developer", completion)
        self.assertNotEqual(res.returncode, 0)

        record = self.get_last_run_record()
        self.assertEqual(record["result"], "failed")
        self.assertEqual(record["parsed_result"]["error_code"], "unauthorized_write_path")

    def test_developer_undeclared_actual_changes_fails(self):
        completion = {
            "result": "success",
            "next_state": "implemented",
            "changed_files": ["src/allowed.c"],
            "artifacts": ["src/allowed.c"]
        }
        # Developer declared src/allowed.c, but also modified include/header.h (which is authorized by include/ prefix but undeclared)
        res = self.run_runner("developer", completion, actual_files_to_touch=["include/header.h"])
        self.assertNotEqual(res.returncode, 0)

        record = self.get_last_run_record()
        self.assertEqual(record["result"], "failed")
        self.assertEqual(record["parsed_result"]["error_code"], "undeclared_actual_changes")
        self.assertIn("include/header.h", record["parsed_result"]["undeclared_paths"])

    def test_buildfix_modifies_source_code_fails(self):
        # Buildfix debugger attempts to modify src/allowed.c
        completion = {
            "result": "success",
            "next_state": "implemented",
            "changed_files": [".ai-agent/runs/ADU-1-validation-summary.md", "src/allowed.c"],
            "artifacts": [".ai-agent/runs/ADU-1-validation-summary.md", "src/allowed.c"]
        }
        res = self.run_runner("buildfix-debugger", completion)
        self.assertNotEqual(res.returncode, 0)

        record = self.get_last_run_record()
        self.assertEqual(record["result"], "failed")
        self.assertEqual(record["parsed_result"]["error_code"], "unauthorized_write_path")

    def test_requirement_analyst_overwrites_contract_fails(self):
        # Requirement analyst attempts to write contract path
        completion = {
            "result": "success",
            "next_state": "implemented",
            "changed_files": [".ai-agent/contracts/ADU-1.json"],
            "artifacts": [".ai-agent/contracts/ADU-1.json"]
        }
        res = self.run_runner("requirement-analyst", completion)
        self.assertNotEqual(res.returncode, 0)

        record = self.get_last_run_record()
        self.assertEqual(record["result"], "failed")
        self.assertEqual(record["parsed_result"]["error_code"], "unauthorized_write_path")

    def test_profiler_five_files_success(self):
        completion = {
            "result": "success",
            "next_state": "project_profiled",
            "changed_files": [
                ".agent-factory/project-profile.json",
                ".agent-factory/knowledge/project-summary.md",
                ".agent-factory/knowledge/module-map.md",
                ".agent-factory/knowledge/test-strategy.md",
                ".agent-factory/knowledge/risk-map.md"
            ],
            "artifacts": [
                ".agent-factory/project-profile.json",
                ".agent-factory/knowledge/project-summary.md",
                ".agent-factory/knowledge/module-map.md",
                ".agent-factory/knowledge/test-strategy.md",
                ".agent-factory/knowledge/risk-map.md"
            ]
        }
        res = self.run_runner("project-profiler", completion)
        self.assertEqual(res.returncode, 0)

        record = self.get_last_run_record()
        self.assertEqual(record["result"], "success")

    def test_profiler_extra_file_fails(self):
        completion = {
            "result": "success",
            "next_state": "project_profiled",
            "changed_files": [
                ".agent-factory/project-profile.json",
                ".agent-factory/knowledge/project-summary.md",
                ".agent-factory/knowledge/module-map.md",
                ".agent-factory/knowledge/test-strategy.md",
                ".agent-factory/knowledge/risk-map.md",
                ".agent-factory/config.json"
            ],
            "artifacts": [
                ".agent-factory/project-profile.json",
                ".agent-factory/knowledge/project-summary.md",
                ".agent-factory/knowledge/module-map.md",
                ".agent-factory/knowledge/test-strategy.md",
                ".agent-factory/knowledge/risk-map.md",
                ".agent-factory/config.json"
            ]
        }
        res = self.run_runner("project-profiler", completion)
        self.assertNotEqual(res.returncode, 0)

        record = self.get_last_run_record()
        self.assertEqual(record["result"], "failed")
        self.assertEqual(record["parsed_result"]["error_code"], "unauthorized_write_path")

    def test_modify_registry_fails(self):
        completion = {
            "result": "success",
            "next_state": "implemented",
            "changed_files": [".ai-agent/registry/adus.json"],
            "artifacts": [".ai-agent/registry/adus.json"]
        }
        res = self.run_runner("developer", completion)
        self.assertNotEqual(res.returncode, 0)

    def test_declare_generated_path_fails(self):
        completion = {
            "result": "success",
            "next_state": "implemented",
            "changed_files": ["build/output.o"],
            "artifacts": ["build/output.o"]
        }
        res = self.run_runner("developer", completion)
        self.assertNotEqual(res.returncode, 0)

if __name__ == "__main__":
    unittest.main()

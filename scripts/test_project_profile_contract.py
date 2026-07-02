#!/usr/bin/env python3
import json
import os
import unittest
from pathlib import Path

# Try to import from project_profile_contract
try:
    from project_profile_contract import (
        normalize_profile_summary,
        normalize_profile_document,
        ProjectProfileContractError
    )
except ImportError:
    # Fail fallback during TDD step 2
    ProjectProfileContractError = ValueError
    def normalize_profile_summary(p): raise ModuleNotFoundError("project_profile_contract")
    def normalize_profile_document(p): raise ModuleNotFoundError("project_profile_contract")

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "project-profiles"

def load_fixture(name: str) -> dict:
    path = FIXTURES_DIR / name
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

class TestProjectProfileContract(unittest.TestCase):

    def test_canonical_v2_extracts_only_safe_commands(self):
        profile = load_fixture("canonical-v2.json")
        summary = normalize_profile_summary(profile)
        self.assertEqual(summary["build_commands"], ["npm run build"])
        self.assertEqual(summary["test_commands"], ["npm test"])
        self.assertEqual(summary["risk_level"], "high")
        self.assertNotIn("npm run deploy", summary["build_commands"])
        self.assertNotIn("npm run deploy", summary["test_commands"])

    def test_legacy_flat_profile_remains_supported(self):
        profile = load_fixture("legacy-flat.json")
        summary = normalize_profile_summary(profile)
        self.assertEqual(summary["build_commands"], ["npm run build"])
        self.assertEqual(summary["test_commands"], ["npm test", "npm run test:e2e"])
        self.assertEqual(summary["risk_level"], "medium")

    def test_unsafe_only_profile_has_no_recommendations(self):
        profile = load_fixture("unsafe-command.json")
        summary = normalize_profile_summary(profile)
        self.assertEqual(summary["build_commands"], [])
        self.assertEqual(summary["test_commands"], [])
        self.assertEqual(summary["risk_level"], "medium")

    def test_invalid_types_raise_contract_error(self):
        with self.assertRaises(ProjectProfileContractError):
            normalize_profile_summary([])
        with self.assertRaises(ProjectProfileContractError):
            normalize_profile_summary(None)

    def test_illegal_risk_level_normalizes_to_unknown(self):
        profile = {
            "project_id": "test",
            "project_type": "node-app",
            "risk_level": "super-high",
            "commands": {}
        }
        summary = normalize_profile_summary(profile)
        self.assertEqual(summary["risk_level"], "unknown")

    def test_deduplicates_commands(self):
        # Test command deduplication while keeping ordering
        profile = {
            "schema_version": 2,
            "project_id": "test",
            "project_type": "node-app",
            "detected_stack": [],
            "commands": {
                "safe": {
                    "build": [
                        {"id": "b1", "command": "npm run build", "source": "package.json"},
                        {"id": "b2", "command": "npm run build", "source": "another.json"}
                    ],
                    "test": [
                        {"id": "t1", "command": "npm test", "source": "package.json"},
                        {"id": "t2", "command": "npm test", "source": "package.json"}
                    ]
                },
                "ambiguous": [],
                "unsafe": []
            },
            "risk_profile": {
                "risk_level": "low",
                "reasons": []
            }
        }
        summary = normalize_profile_summary(profile)
        self.assertEqual(summary["build_commands"], ["npm run build"])
        self.assertEqual(summary["test_commands"], ["npm test"])

    def test_legacy_unusual_types_in_commands(self):
        # Commands builds/tests containing list or invalid dicts in legacy profile
        profile = {
            "project_id": "test",
            "commands": {
                "build": ["npm run build", 123, None], # lists should be skipped or only strings accepted
                "test": "npm test" # string should be converted to single item list
            }
        }
        summary = normalize_profile_summary(profile)
        self.assertEqual(summary["build_commands"], ["npm run build"])
        self.assertEqual(summary["test_commands"], ["npm test"])

    def test_normalize_profile_document_v2(self):
        v2_raw = load_fixture("canonical-v2.json")
        normalized = normalize_profile_document(v2_raw)
        self.assertEqual(normalized["schema_version"], 2)
        self.assertEqual(normalized["project_id"], "canonical-project")
        self.assertEqual(normalized["risk_profile"]["risk_level"], "high")

    def test_normalize_profile_document_v2_invalid(self):
        with self.assertRaises(ProjectProfileContractError):
            normalize_profile_document({"schema_version": 2})

    def test_normalize_profile_document_legacy(self):
        legacy_raw = load_fixture("legacy-flat.json")
        normalized = normalize_profile_document(legacy_raw)
        # Should be converted to v2 layout!
        self.assertEqual(normalized["schema_version"], 2)
        self.assertEqual(normalized["project_id"], "legacy-project")
        self.assertEqual(normalized["risk_profile"]["risk_level"], "medium")
        self.assertEqual(len(normalized["commands"]["safe"]["build"]), 1)
        self.assertEqual(normalized["commands"]["safe"]["build"][0]["command"], "npm run build")
        self.assertEqual(len(normalized["commands"]["safe"]["test"]), 2)

    def test_hermes_project_profile_integration(self):
        import tempfile
        import sys
        import subprocess

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            # Create repo structure
            repo_dir = tmp_path / "repo"
            repo_dir.mkdir()
            import subprocess
            subprocess.run(["git", "init"], cwd=str(repo_dir), capture_output=True)

            agent_factory_dir = repo_dir / ".agent-factory"
            agent_factory_dir.mkdir()

            # Write canonical-v2.json to project-profile.json
            profile_json_path = agent_factory_dir / "project-profile.json"
            v2_fixture = load_fixture("canonical-v2.json")
            with profile_json_path.open("w", encoding="utf-8") as f:
                json.dump(v2_fixture, f)

            # Create projects registry
            registry_dir = tmp_path / "registry"
            registry_dir.mkdir()
            projects_json_path = registry_dir / "projects.json"

            # Copy all files from real .ai-agent/registry/ to tmp registry
            real_workspace = Path(__file__).resolve().parents[1]
            real_registry = real_workspace / ".ai-agent" / "registry"
            if real_registry.exists():
                import shutil
                for f in real_registry.iterdir():
                    if f.is_file() and f.name != "projects.json":
                        shutil.copy(str(f), str(registry_dir / f.name))

            # Set up matching project in projects.json
            registry_data = {
                "version": 1,
                "projects": [
                    {
                        "project_id": "canonical-project",
                        "repo_path": str(repo_dir),
                        "status": "created"
                    }
                ]
            }
            # Create a bin folder with mock hermes script
            bin_dir = tmp_path / "bin"
            bin_dir.mkdir()
            mock_hermes_path = bin_dir / "hermes"

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

if latest_run_dir:
    completion_data = {
        "version": 1,
        "status": "success",
        "result": {
            "result": "success",
            "next_state": "project_profiled",
            "changed_files": [
                ".agent-factory/project-profile.json",
                ".agent-factory/knowledge/project-summary.md",
                ".agent-factory/knowledge/module-map.md",
                ".agent-factory/knowledge/test-strategy.md",
                ".agent-factory/knowledge/risk-map.md"
            ],
            "artifacts": [],
            "next_agent": None,
            "commands_run": [],
            "risks": []
        }
    }
    with open(latest_run_dir / "completion_att1.json", "w", encoding="utf-8") as f:
        json.dump(completion_data, f, indent=2)

    profile_data = json.loads(os.environ.get("MOCK_PROFILE_DATA", "{}"))
    p_path = repo_path / ".agent-factory" / "project-profile.json"
    p_path.parent.mkdir(parents=True, exist_ok=True)
    with open(p_path, "w", encoding="utf-8") as f:
        json.dump(profile_data, f, indent=2)

    k_dir = repo_path / ".agent-factory" / "knowledge"
    k_dir.mkdir(parents=True, exist_ok=True)
    for doc in ["project-summary.md", "module-map.md", "test-strategy.md", "risk-map.md"]:
        (k_dir / doc).write_text("mock document", encoding="utf-8")

sys.exit(0)
"""
            mock_hermes_path.write_text(mock_hermes_content, encoding="utf-8")
            mock_hermes_path.chmod(0o755)

            with projects_json_path.open("w", encoding="utf-8") as f:
                json.dump(registry_data, f)

            # Run hermes_project_profile.py as a subprocess
            script_path = Path(__file__).resolve().parent / "hermes_project_profile.py"
            real_workspace = Path(__file__).resolve().parents[1]
            env = os.environ.copy()
            env["AGENT_FACTORY_PROJECTS_REGISTRY"] = str(projects_json_path)
            env["AGENT_FACTORY_WORKSPACE"] = str(real_workspace)
            env["MOCK_PROFILE_DATA"] = json.dumps(v2_fixture)
            env["PATH"] = str(bin_dir) + os.path.pathsep + env.get("PATH", "")

            res = subprocess.run(
                [sys.executable, str(script_path), "--project", "canonical-project"],
                env=env,
                capture_output=True,
                text=True
            )
            self.assertEqual(res.returncode, 0, f"Script failed: {res.stderr}\n{res.stdout}")

            # Assert registry updated
            with projects_json_path.open("r", encoding="utf-8") as f:
                updated_registry = json.load(f)

            project = updated_registry["projects"][0]
            self.assertEqual(project["status"], "profiled")
            summary = project["profile_summary"]
            self.assertEqual(summary["build_commands"], ["npm run build"])
            self.assertEqual(summary["test_commands"], ["npm test"])
            self.assertEqual(summary["risk_level"], "high")

            # Assert project-profile.json on disk is canonicalized V2 and contains schema_version 2
            with profile_json_path.open("r", encoding="utf-8") as f:
                disk_profile = json.load(f)
            self.assertEqual(disk_profile["schema_version"], 2)
            self.assertEqual(disk_profile["project_id"], "canonical-project")

if __name__ == "__main__":
    unittest.main()

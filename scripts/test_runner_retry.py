#!/usr/bin/env python3
import os
import sys
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Set up paths so we can import the scripts
ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT / "scripts"))

import run_file_snapshot

class MockControlledProcessResult:
    def __init__(self, stdout, stderr, returncode, completion_result=None, completion_status="not_expected", termination_reason=None, pid=None, target_files_changed=False):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode
        self.completion_result = completion_result
        self.completion_status = completion_status
        self.termination_reason = termination_reason
        self.pid = pid
        self.target_files_changed = target_files_changed

class TestRunnerRetry(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.tmp_dir.name) / "repo"
        self.repo_root.mkdir()

        # Create allowed directory
        (self.repo_root / "webui").mkdir()

        # Create prompts directory and a dummy prompt file inside our temp repo
        prompts_dir = self.repo_root / ".ai-agent" / "prompts"
        prompts_dir.mkdir(parents=True)
        (prompts_dir / "evidence-agent.md").write_text("Mock Prompt template: completion.json", encoding="utf-8")

        self.registry_dir = Path(self.tmp_dir.name) / "registry"
        self.registry_dir.mkdir()

        # Set up dynamic registry environment variable before importing hermes_agent_run
        os.environ["AGENT_FACTORY_REGISTRY_DIR"] = str(self.registry_dir)
        os.environ["AGENT_FACTORY_WORKSPACE"] = str(self.repo_root)

        # Write registry files
        self.agents_config = {
            "version": 1,
            "agents": {
                "developer": {
                  "prompt": ".ai-agent/prompts/evidence-agent.md",
                  "default_cwd": "${PROJECT_REPO_ROOT}"
                }
            }
        }
        with open(self.registry_dir / "agents.json", "w", encoding="utf-8") as f:
            json.dump(self.agents_config, f, indent=2)

        self.adu_config = {
            "version": 1,
            "adus": [
                {
                    "id": "REQ-RETRY-001",
                    "project_id": "test-project",
                    "repo_path": str(self.repo_root),
                    "state": "test_red",
                    "allowed_write_paths": ["webui/"]
                }
            ]
        }
        with open(self.registry_dir / "adu.json", "w", encoding="utf-8") as f:
            json.dump(self.adu_config, f, indent=2)

        self.projects_config = {
            "version": 1,
            "projects": [
                {
                    "project_id": "test-project",
                    "repo_path": str(self.repo_root)
                }
            ]
        }
        with open(self.registry_dir / "projects.json", "w", encoding="utf-8") as f:
            json.dump(self.projects_config, f, indent=2)

        with open(self.registry_dir / "runs.json", "w", encoding="utf-8") as f:
            json.dump({"runs": []}, f, indent=2)

    def tearDown(self):
        self.tmp_dir.cleanup()
        if "AGENT_FACTORY_REGISTRY_DIR" in os.environ:
            del os.environ["AGENT_FACTORY_REGISTRY_DIR"]
        if "AGENT_FACTORY_WORKSPACE" in os.environ:
            del os.environ["AGENT_FACTORY_WORKSPACE"]

    def test_retry_once_on_no_progress_timeout_no_delta(self):
        if "hermes_agent_run" in sys.modules:
            import importlib
            run_mod = importlib.reload(sys.modules["hermes_agent_run"])
        else:
            import hermes_agent_run as run_mod

        # Mock policy
        mock_policy = MagicMock()
        mock_policy.no_progress_max_attempts = 2
        mock_policy.retry_backoff_seconds = 0.01
        mock_policy.max_duration_seconds = 10
        mock_policy.no_progress_timeout_seconds = 5
        mock_policy.termination_grace_seconds = 1
        mock_policy.max_prompt_bytes = 1000
        mock_policy.max_estimated_input_tokens = 1000

        with patch("hermes_agent_run.agent_run_policy.load_policy", return_value=mock_policy):
            res1 = MockControlledProcessResult(
                stdout="Attempt 1 output",
                stderr="",
                returncode=1,
                completion_result=None,
                completion_status="missing",
                termination_reason="no_progress_timeout",
                pid=123,
                target_files_changed=False
            )

            res2 = MockControlledProcessResult(
                stdout="Attempt 2 output",
                stderr="",
                returncode=0,
                completion_result={"result": "success", "next_state": "implemented", "changed_files": []},
                completion_status="valid",
                termination_reason="process_exit",
                pid=124,
                target_files_changed=False
            )

            with patch("hermes_agent_run.agent_run_policy.execute_controlled_process") as mock_execute:
                mock_execute.side_effect = [res1, res2]

                # Set sys.argv and call main()
                test_args = ["hermes_agent_run.py", "--adu", "REQ-RETRY-001", "--agent", "developer"]
                with patch.object(sys, "argv", test_args):
                    try:
                        run_mod.main()
                    except SystemExit:
                        pass

                self.assertEqual(mock_execute.call_count, 2)

            with open(self.registry_dir / "runs.json", "r", encoding="utf-8") as f:
                runs_data = json.load(f)
            self.assertEqual(len(runs_data["runs"]), 1)
            self.assertEqual(runs_data["runs"][0]["result"], "success")

    def test_no_retry_on_no_progress_timeout_with_delta(self):
        if "hermes_agent_run" in sys.modules:
            import importlib
            run_mod = importlib.reload(sys.modules["hermes_agent_run"])
        else:
            import hermes_agent_run as run_mod

        # Mock policy
        mock_policy = MagicMock()
        mock_policy.no_progress_max_attempts = 2
        mock_policy.retry_backoff_seconds = 0.01
        mock_policy.max_duration_seconds = 10
        mock_policy.no_progress_timeout_seconds = 5
        mock_policy.termination_grace_seconds = 1
        mock_policy.max_prompt_bytes = 1000
        mock_policy.max_estimated_input_tokens = 1000

        with patch("hermes_agent_run.agent_run_policy.load_policy", return_value=mock_policy):
            res1 = MockControlledProcessResult(
                stdout="Attempt 1 output",
                stderr="",
                returncode=1,
                completion_result=None,
                completion_status="missing",
                termination_reason="no_progress_timeout",
                pid=125,
                target_files_changed=False
            )

            with patch("hermes_agent_run.agent_run_policy.execute_controlled_process") as mock_execute:
                def write_file_side_effect(*args, **kwargs):
                    (self.repo_root / "webui" / "index.js").write_text("console.log('modified');", encoding="utf-8")
                    return res1

                mock_execute.side_effect = write_file_side_effect

                test_args = ["hermes_agent_run.py", "--adu", "REQ-RETRY-001", "--agent", "developer"]
                with patch.object(sys, "argv", test_args):
                    try:
                        run_mod.main()
                    except SystemExit:
                        pass

                self.assertEqual(mock_execute.call_count, 1)

    def test_accumulated_delta_is_not_lost(self):
        if "hermes_agent_run" in sys.modules:
            import importlib
            run_mod = importlib.reload(sys.modules["hermes_agent_run"])
        else:
            import hermes_agent_run as run_mod

        mock_policy = MagicMock()
        mock_policy.no_progress_max_attempts = 2
        mock_policy.retry_backoff_seconds = 0.01
        mock_policy.max_duration_seconds = 10
        mock_policy.no_progress_timeout_seconds = 5
        mock_policy.termination_grace_seconds = 1
        mock_policy.max_prompt_bytes = 1000
        mock_policy.max_estimated_input_tokens = 1000

        with patch("hermes_agent_run.agent_run_policy.load_policy", return_value=mock_policy):
            res1 = MockControlledProcessResult(
                stdout="Attempt 1 output",
                stderr="",
                returncode=1,
                completion_result=None,
                completion_status="missing",
                termination_reason="no_progress_timeout",
                pid=126,
                target_files_changed=False
            )
            res2 = MockControlledProcessResult(
                stdout="Attempt 2 output",
                stderr="",
                returncode=0,
                completion_result={"result": "success", "next_state": "implemented", "changed_files": ["webui/file1.js", "webui/file2.js"]},
                completion_status="valid",
                termination_reason="process_exit",
                pid=127,
                target_files_changed=False
            )

            with patch("hermes_agent_run.agent_run_policy.execute_controlled_process") as mock_execute:
                calls = []
                def execute_side_effect(*args, **kwargs):
                    calls.append(len(calls) + 1)
                    if len(calls) == 1:
                        (self.repo_root / "webui" / "file1.js").write_text("file1", encoding="utf-8")
                        return res1
                    else:
                        (self.repo_root / "webui" / "file2.js").write_text("file2", encoding="utf-8")
                        return res2

                mock_execute.side_effect = execute_side_effect

                original_diff = run_file_snapshot.diff_snapshots
                def mock_diff(before, after):
                    if len(calls) == 1:
                        return {"created": [], "modified": [], "deleted": []}
                    return original_diff(before, after)

                with patch.object(run_file_snapshot, "diff_snapshots", mock_diff):
                    test_args = ["hermes_agent_run.py", "--adu", "REQ-RETRY-001", "--agent", "developer"]
                    with patch.object(sys, "argv", test_args):
                        try:
                            run_mod.main()
                        except SystemExit:
                            pass

                self.assertEqual(mock_execute.call_count, 2)

            with open(self.registry_dir / "runs.json", "r", encoding="utf-8") as f:
                runs_data = json.load(f)
            run_dir = self.repo_root / runs_data["runs"][0]["run_dir"]

            with open(run_dir / "file-delta.json", "r", encoding="utf-8") as f:
                final_delta = json.load(f)

            self.assertIn("webui/file1.js", final_delta["created"])
            self.assertIn("webui/file2.js", final_delta["created"])

    def test_no_retry_on_provider_auth_error(self):
        if "hermes_agent_run" in sys.modules:
            import importlib
            run_mod = importlib.reload(sys.modules["hermes_agent_run"])
        else:
            import hermes_agent_run as run_mod

        # Mock policy
        mock_policy = MagicMock()
        mock_policy.no_progress_max_attempts = 2
        mock_policy.retry_backoff_seconds = 0.01
        mock_policy.max_duration_seconds = 10
        mock_policy.no_progress_timeout_seconds = 5
        mock_policy.termination_grace_seconds = 1
        mock_policy.max_prompt_bytes = 1000
        mock_policy.max_estimated_input_tokens = 1000

        with patch("hermes_agent_run.agent_run_policy.load_policy", return_value=mock_policy):
            res1 = MockControlledProcessResult(
                stdout="",
                stderr="",
                returncode=1,
                completion_result=None,
                completion_status="missing",
                termination_reason="no_progress_timeout",
                pid=128,
                target_files_changed=False
            )

            with patch("hermes_agent_run.extract_provider_error") as mock_extract:
                mock_extract.return_value = {
                    "result": "failed",
                    "error_code": "PROVIDER_AUTHENTICATION_FAILED",
                    "error": "Authentication failed"
                }

                with patch("hermes_agent_run.agent_run_policy.execute_controlled_process", return_value=res1) as mock_execute:
                    # Mock _find_and_parse_hermes_diagnostic to return a dummy dict so extract_provider_error is called
                    with patch("hermes_agent_run._find_and_parse_hermes_diagnostic", return_value={"dummy": "value"}):
                        test_args = ["hermes_agent_run.py", "--adu", "REQ-RETRY-001", "--agent", "developer"]
                        with patch.object(sys, "argv", test_args):
                            try:
                                run_mod.main()
                            except SystemExit:
                                pass

                    # Should NOT retry! So execute call count should be 1
                    self.assertEqual(mock_execute.call_count, 1)

    def test_no_retry_on_provider_auth_error_with_output(self):
        if "hermes_agent_run" in sys.modules:
            import importlib
            run_mod = importlib.reload(sys.modules["hermes_agent_run"])
        else:
            import hermes_agent_run as run_mod

        # Mock policy
        mock_policy = MagicMock()
        mock_policy.no_progress_max_attempts = 2
        mock_policy.retry_backoff_seconds = 0.01
        mock_policy.max_duration_seconds = 10
        mock_policy.no_progress_timeout_seconds = 5
        mock_policy.termination_grace_seconds = 1
        mock_policy.max_prompt_bytes = 1000
        mock_policy.max_estimated_input_tokens = 1000

        with patch("hermes_agent_run.agent_run_policy.load_policy", return_value=mock_policy):
            res1 = MockControlledProcessResult(
                stdout="Some stdout text",
                stderr="raise openai.AuthenticationError('Incorrect API key provided')",
                returncode=1,
                completion_result=None,
                completion_status="missing",
                termination_reason="no_progress_timeout",
                pid=129,
                target_files_changed=False
            )

            with patch("hermes_agent_run.agent_run_policy.execute_controlled_process", return_value=res1) as mock_execute:
                with patch("hermes_agent_run._find_and_parse_hermes_diagnostic", return_value=None):
                    test_args = ["hermes_agent_run.py", "--adu", "REQ-RETRY-001", "--agent", "developer"]
                    with patch.object(sys, "argv", test_args):
                        try:
                            run_mod.main()
                        except SystemExit:
                            pass

                # Should NOT retry because of detected provider auth failure signature in stderr!
                self.assertEqual(mock_execute.call_count, 1)

    def test_no_retry_on_provider_rate_limit_error_with_output(self):
        if "hermes_agent_run" in sys.modules:
            import importlib
            run_mod = importlib.reload(sys.modules["hermes_agent_run"])
        else:
            import hermes_agent_run as run_mod

        # Mock policy
        mock_policy = MagicMock()
        mock_policy.no_progress_max_attempts = 2
        mock_policy.retry_backoff_seconds = 0.01
        mock_policy.max_duration_seconds = 10
        mock_policy.no_progress_timeout_seconds = 5
        mock_policy.termination_grace_seconds = 1
        mock_policy.max_prompt_bytes = 1000
        mock_policy.max_estimated_input_tokens = 1000

        with patch("hermes_agent_run.agent_run_policy.load_policy", return_value=mock_policy):
            res1 = MockControlledProcessResult(
                stdout="Some stdout text",
                stderr="openai.RateLimitError: rate limit exceeded on status code 429",
                returncode=1,
                completion_result=None,
                completion_status="missing",
                termination_reason="no_progress_timeout",
                pid=130,
                target_files_changed=False
            )

            with patch("hermes_agent_run.agent_run_policy.execute_controlled_process", return_value=res1) as mock_execute:
                with patch("hermes_agent_run._find_and_parse_hermes_diagnostic", return_value=None):
                    test_args = ["hermes_agent_run.py", "--adu", "REQ-RETRY-001", "--agent", "developer"]
                    with patch.object(sys, "argv", test_args):
                        try:
                            run_mod.main()
                        except SystemExit:
                            pass

                # Should NOT retry because of detected rate limit signature in stderr!
                self.assertEqual(mock_execute.call_count, 1)

    def test_retry_on_normal_401_or_auth_text_in_business_output(self):
        if "hermes_agent_run" in sys.modules:
            import importlib
            run_mod = importlib.reload(sys.modules["hermes_agent_run"])
        else:
            import hermes_agent_run as run_mod

        # Mock policy allowing 2 attempts
        mock_policy = MagicMock()
        mock_policy.no_progress_max_attempts = 2
        mock_policy.retry_backoff_seconds = 0.01
        mock_policy.max_duration_seconds = 10
        mock_policy.no_progress_timeout_seconds = 5
        mock_policy.termination_grace_seconds = 1
        mock_policy.max_prompt_bytes = 1000
        mock_policy.max_estimated_input_tokens = 1000

        with patch("hermes_agent_run.agent_run_policy.load_policy", return_value=mock_policy):
            # Normal business output mentioning a 401 code from an API call
            res1 = MockControlledProcessResult(
                stdout="We tested the login endpoint and it correctly returns HTTP 401 Unauthorized for bad credentials",
                stderr="All ok",
                returncode=1,
                completion_result=None,
                completion_status="missing",
                termination_reason="no_progress_timeout",
                pid=131,
                target_files_changed=False
            )

            res2 = MockControlledProcessResult(
                stdout="Done",
                stderr="",
                returncode=0,
                completion_result={"result": "success", "next_state": "implemented", "changed_files": []},
                completion_status="valid",
                termination_reason="process_exit",
                pid=132,
                target_files_changed=False
            )

            with patch("hermes_agent_run.agent_run_policy.execute_controlled_process") as mock_execute:
                mock_execute.side_effect = [res1, res2]
                with patch("hermes_agent_run._find_and_parse_hermes_diagnostic", return_value=None):
                    test_args = ["hermes_agent_run.py", "--adu", "REQ-RETRY-001", "--agent", "developer"]
                    with patch.object(sys, "argv", test_args):
                        try:
                            run_mod.main()
                        except SystemExit:
                            pass

                # SHOULD retry because normal business text does not match precise provider signatures!
                self.assertEqual(mock_execute.call_count, 2)

    def test_retry_on_business_http_client_401_output(self):
        if "hermes_agent_run" in sys.modules:
            import importlib
            run_mod = importlib.reload(sys.modules["hermes_agent_run"])
        else:
            import hermes_agent_run as run_mod

        # Mock policy allowing 2 attempts
        mock_policy = MagicMock()
        mock_policy.no_progress_max_attempts = 2
        mock_policy.retry_backoff_seconds = 0.01
        mock_policy.max_duration_seconds = 10
        mock_policy.no_progress_timeout_seconds = 5
        mock_policy.termination_grace_seconds = 1
        mock_policy.max_prompt_bytes = 1000
        mock_policy.max_estimated_input_tokens = 1000

        with patch("hermes_agent_run.agent_run_policy.load_policy", return_value=mock_policy):
            res1 = MockControlledProcessResult(
                stdout="Python requests client received HTTP 401 Unauthorized as expected",
                stderr="All ok",
                returncode=1,
                completion_result=None,
                completion_status="missing",
                termination_reason="no_progress_timeout",
                pid=133,
                target_files_changed=False
            )

            res2 = MockControlledProcessResult(
                stdout="Done",
                stderr="",
                returncode=0,
                completion_result={"result": "success", "next_state": "implemented", "changed_files": []},
                completion_status="valid",
                termination_reason="process_exit",
                pid=134,
                target_files_changed=False
            )

            with patch("hermes_agent_run.agent_run_policy.execute_controlled_process") as mock_execute:
                mock_execute.side_effect = [res1, res2]
                with patch("hermes_agent_run._find_and_parse_hermes_diagnostic", return_value=None):
                    test_args = ["hermes_agent_run.py", "--adu", "REQ-RETRY-001", "--agent", "developer"]
                    with patch.object(sys, "argv", test_args):
                        try:
                            run_mod.main()
                        except SystemExit:
                            pass

                # SHOULD retry because requests library is not in LLM provider signatures list!
                self.assertEqual(mock_execute.call_count, 2)

if __name__ == "__main__":
    unittest.main()

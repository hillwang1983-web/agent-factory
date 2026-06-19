#!/usr/bin/env python3
import json
import os
import pathlib
import sys
import tempfile
import shutil
import unittest
from unittest.mock import patch, MagicMock

# Import the main script's classes/functions
import agent_factory_operator

class TestAgentFactoryOperator(unittest.TestCase):
    def test_get_adu_next_action_created(self):
        adu = {"id": "ADU-1", "state": "created", "project_id": "p1"}
        res = agent_factory_operator.get_adu_next_action(adu)
        self.assertEqual(res["recommended_action"], "start")
        self.assertEqual(res["priority"], "required")

    def test_get_adu_next_action_review(self):
        adu = {"id": "ADU-1", "state": "analysis_review", "project_id": "p1"}
        res = agent_factory_operator.get_adu_next_action(adu)
        self.assertEqual(res["recommended_action"], "approve_review")
        self.assertEqual(res["priority"], "required")

    def test_get_adu_next_action_design(self):
        adu = {"id": "ADU-1", "state": "designed", "project_id": "p1"}
        res = agent_factory_operator.get_adu_next_action(adu)
        self.assertEqual(res["recommended_action"], "step")
        self.assertEqual(res["priority"], "recommended")

    def test_get_epic_next_action_created(self):
        epic = {"id": "EPIC-1", "state": "created", "project_id": "p1"}
        res = agent_factory_operator.get_epic_next_action(epic)
        self.assertEqual(res["recommended_action"], "start")
        self.assertEqual(res["priority"], "required")

    def test_get_epic_next_action_split(self):
        epic = {"id": "EPIC-1", "state": "split_required", "project_id": "p1"}
        res = agent_factory_operator.get_epic_next_action(epic)
        self.assertEqual(res["recommended_action"], "materialize_child_adus")
        self.assertEqual(res["priority"], "required")


class TestAgentFactoryOperatorAdvanced(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.registry_dir = os.path.join(self.tmp_dir, ".ai-agent", "registry")
        os.makedirs(self.registry_dir, exist_ok=True)
        # set up mock env workspace
        self.old_workspace = agent_factory_operator.WORKSPACE
        agent_factory_operator.WORKSPACE = self.tmp_dir

    def tearDown(self):
        agent_factory_operator.WORKSPACE = self.old_workspace
        shutil.rmtree(self.tmp_dir)

    @patch('subprocess.run')
    def test_local_intake_spawns_subproc(self, mock_run):
        # Setup mock projects.json
        projects_data = {
            "projects": [
                {
                    "project_id": "proj-1",
                    "repo_path": self.tmp_dir
                }
            ]
        }
        agent_factory_operator.save_json(os.path.join(self.registry_dir, "projects.json"), projects_data)

        # Setup requirement file
        req_file = os.path.join(self.tmp_dir, "req.md")
        pathlib.Path(req_file).write_text("Test requirements for epic draft", encoding="utf-8")

        # Mock successful subprocess execution
        mock_run.return_value = MagicMock(returncode=0)

        # Setup scripts folder and mock hermes_agent_run.py path
        scripts_dir = os.path.join(self.tmp_dir, "scripts")
        os.makedirs(scripts_dir, exist_ok=True)
        pathlib.Path(os.path.join(scripts_dir, "hermes_agent_run.py")).touch()

        # Run intake via args
        args = MagicMock()
        args.project = "proj-1"
        args.requirement_file = req_file
        args.preferred_granularity = "epic"
        args.language = "zh"

        # Mock printing to prevent stdout clutter
        with patch('builtins.print'):
            agent_factory_operator.local_intake(args)
            self.assertTrue(mock_run.called)
            args_list = mock_run.call_args[0][0]
            self.assertIn("python3", args_list)
            self.assertIn("--project", args_list)
            self.assertIn("proj-1", args_list)

    @patch('subprocess.run')
    def test_local_act_resolves_project_and_repo_root(self, mock_run):
        # Setup mock projects.json
        projects_data = {
            "projects": [
                {
                    "project_id": "proj-1",
                    "repo_path": "/fake/repo/path"
                }
            ]
        }
        agent_factory_operator.save_json(os.path.join(self.registry_dir, "projects.json"), projects_data)

        # Setup mock adu.json
        adus_data = {
            "adus": [
                {
                    "id": "ADU-1",
                    "project_id": "proj-1"
                }
            ]
        }
        agent_factory_operator.save_json(os.path.join(self.registry_dir, "adu.json"), adus_data)

        # Mock successful subprocess execution
        mock_run.return_value = MagicMock(returncode=0)

        # Setup scripts folder and mock hermes_agent_orchestrator.py path
        scripts_dir = os.path.join(self.tmp_dir, "scripts")
        os.makedirs(scripts_dir, exist_ok=True)
        pathlib.Path(os.path.join(scripts_dir, "hermes_agent_orchestrator.py")).touch()

        # Run act via args
        args = MagicMock()
        args.adu = "ADU-1"
        args.epic = None
        args.action = "start"
        args.idempotency_key = "key-unique"
        args.requested_by = "codex"

        with patch('builtins.print'):
            agent_factory_operator.local_act(args)

        self.assertTrue(mock_run.called)
        args_list = mock_run.call_args[0][0]
        self.assertIn("--project", args_list)
        self.assertIn("proj-1", args_list)
        self.assertIn("--repo-root", args_list)
        self.assertIn("/fake/repo/path", args_list)


if __name__ == "__main__":
    unittest.main()

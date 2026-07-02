#!/usr/bin/env python3
import unittest
from agent_write_policy import (
    normalize_repo_path,
    build_agent_write_policy,
    authorize_declared_and_actual_changes,
    WritePolicyError
)

class TestAgentWritePolicy(unittest.TestCase):

    def test_normalize_repo_path(self):
        self.assertEqual(normalize_repo_path("src/allowed.c"), "src/allowed.c")
        self.assertEqual(normalize_repo_path("src\\allowed.c"), "src/allowed.c")
        
        with self.assertRaises(WritePolicyError):
            normalize_repo_path("/src/allowed.c")
        with self.assertRaises(WritePolicyError):
            normalize_repo_path("src/../allowed.c")
        with self.assertRaises(WritePolicyError):
            normalize_repo_path(".")
        with self.assertRaises(WritePolicyError):
            normalize_repo_path("")

    def test_cases_matrix(self):
        # Table driven tests
        CASES = [
            ("requirement-analyst", ".ai-agent/analysis/ADU-1.md", True),
            ("requirement-analyst", ".ai-agent/contracts/ADU-1.json", False),
            ("context-pack", ".ai-agent/context-packs/ADU-1.md", True),
            ("context-pack", ".ai-agent/reviews/ADU-1-code-review.json", False),
            ("code-reviewer", ".ai-agent/reviews/ADU-1-code-review.json", True),
            ("code-reviewer", ".ai-agent/designs/ADU-1-detailed-design.md", False),
            ("acceptance-reviewer", ".ai-agent/acceptance/ADU-1-acceptance-review.json", True),
            ("acceptance-reviewer", ".ai-agent/analysis/ADU-1.md", False),
            ("testwriter", "tests/ai-agent-mvp/ADU-1-validation.md", True),
            ("testwriter", "tests/other.test.js", False),
            ("buildfix-debugger", ".ai-agent/runs/ADU-1-validation-summary.md", True),
            ("buildfix-debugger", "src/core.c", False),
            ("project-profiler", ".agent-factory/project-profile.json", True),
            ("project-profiler", ".agent-factory/config.json", False),
        ]

        for agent, path, expected in CASES:
            # We mock the get_agent_target_files output as a list of correct paths
            targets = []
            if agent == "requirement-analyst":
                targets = [".ai-agent/analysis/ADU-1.md"]
            elif agent == "context-pack":
                targets = [".ai-agent/context-packs/ADU-1.md"]
            elif agent == "code-reviewer":
                targets = [".ai-agent/reviews/ADU-1-code-review.json"]
            elif agent == "acceptance-reviewer":
                targets = [".ai-agent/acceptance/ADU-1-acceptance-review.json"]
            elif agent == "testwriter":
                targets = ["tests/ai-agent-mvp/ADU-1-validation.md"]
            elif agent == "buildfix-debugger":
                targets = [".ai-agent/runs/ADU-1-validation-summary.md"]
            elif agent == "project-profiler":
                targets = [
                    ".agent-factory/project-profile.json",
                    ".agent-factory/knowledge/project-summary.md"
                ]

            policy = build_agent_write_policy(
                agent_name=agent,
                target_id="ADU-1",
                is_epic=False,
                adu_allowed_write_paths=[],
                agent_target_files=targets
            )
            self.assertEqual(policy.allows(path), expected, f"Agent {agent} on path {path} failed: expected {expected}")

    def test_developer_policy(self):
        policy = build_agent_write_policy(
            agent_name="developer",
            target_id="ADU-1",
            is_epic=False,
            adu_allowed_write_paths=["src/allowed.c", "include/feature/"],
            agent_target_files=[]
        )
        self.assertTrue(policy.allows("src/allowed.c"))
        self.assertTrue(policy.allows("include/feature/api.h"))
        self.assertFalse(policy.allows("src/forbidden.c"))
        self.assertFalse(policy.allows("include/feature-escape/api.h"))

    def test_forbidden_developer_paths(self):
        # ['.'] or empty paths for developer
        with self.assertRaises(WritePolicyError):
            build_agent_write_policy("developer", "ADU-1", False, [], [])
        with self.assertRaises(WritePolicyError):
            build_agent_write_policy("developer", "ADU-1", False, ["."], [])

    def test_forbidden_registry_paths(self):
        policy = build_agent_write_policy(
            agent_name="developer",
            target_id="ADU-1",
            is_epic=False,
            adu_allowed_write_paths=["src/allowed.c", ".ai-agent/registry/adus.json"],
            agent_target_files=[]
        )
        # Even if developer declares registry paths, the policy should reject them in allows
        self.assertFalse(policy.allows(".ai-agent/registry/adus.json"))
        self.assertFalse(policy.allows(".git/config"))
        self.assertFalse(policy.allows("build/output.o"))

    def test_undeclared_actual_change_is_rejected(self):
        policy = build_agent_write_policy(
            agent_name="developer",
            target_id="ADU-1",
            is_epic=False,
            adu_allowed_write_paths=["src/allowed.c", "src/hidden.c"],
            agent_target_files=[]
        )
        result = authorize_declared_and_actual_changes(
            policy=policy,
            declared_paths=["src/allowed.c"],
            actual_delta={"modified": ["src/allowed.c", "src/hidden.c"], "created": [], "deleted": []},
            runner_owned_paths=[],
        )
        self.assertFalse(result.allowed)
        self.assertEqual(result.error_code, "undeclared_actual_changes")
        self.assertEqual(result.undeclared_paths, ("src/hidden.c",))

    def test_agent_declared_runner_owned_rejected(self):
        policy = build_agent_write_policy(
            agent_name="developer",
            target_id="ADU-1",
            is_epic=False,
            adu_allowed_write_paths=["src/allowed.c", ".ai-agent/runs/ADU-1/prompt.md"],
            agent_target_files=[]
        )
        result = authorize_declared_and_actual_changes(
            policy=policy,
            declared_paths=["src/allowed.c", ".ai-agent/runs/ADU-1/prompt.md"],
            actual_delta={"modified": ["src/allowed.c", ".ai-agent/runs/ADU-1/prompt.md"], "created": [], "deleted": []},
            runner_owned_paths=[".ai-agent/runs/ADU-1/prompt.md"],
        )
        self.assertFalse(result.allowed)
        self.assertEqual(result.error_code, "agent_declared_runner_owned_path")

    def test_declared_unchanged_rejected(self):
        policy = build_agent_write_policy(
            agent_name="developer",
            target_id="ADU-1",
            is_epic=False,
            adu_allowed_write_paths=["src/allowed.c"],
            agent_target_files=[]
        )
        result = authorize_declared_and_actual_changes(
            policy=policy,
            declared_paths=["src/allowed.c"],
            actual_delta={"modified": [], "created": [], "deleted": []},
            runner_owned_paths=[],
        )
        self.assertFalse(result.allowed)
        self.assertEqual(result.error_code, "declared_changes_unverified")

    def test_deleted_and_declared_allowed(self):
        policy = build_agent_write_policy(
            agent_name="developer",
            target_id="ADU-1",
            is_epic=False,
            adu_allowed_write_paths=["src/allowed.c"],
            agent_target_files=[]
        )
        result = authorize_declared_and_actual_changes(
            policy=policy,
            declared_paths=["src/allowed.c"],
            actual_delta={"modified": [], "created": [], "deleted": ["src/allowed.c"]},
            runner_owned_paths=[],
        )
        self.assertTrue(result.allowed)

if __name__ == "__main__":
    unittest.main()

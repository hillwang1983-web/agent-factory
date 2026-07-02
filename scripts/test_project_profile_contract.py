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

if __name__ == "__main__":
    unittest.main()

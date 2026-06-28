#!/usr/bin/env python3
import sys
import unittest
import json
from pathlib import Path

# Add scripts directory to path to import compiler
sys.path.insert(0, str(Path(__file__).parent))
import evidence_package_compiler as compiler

class TestEvidencePackageCompiler(unittest.TestCase):
    def setUp(self):
        self.contract = {
            "adu_id": "ADU-X",
            "title": "Test ADU",
            "acceptance_assertions": [
                {
                    "id": "A1",
                    "title": "Startup validation",
                    "verification_type": "automated_test",
                    "verification_command": "node tests/a.js"
                },
                {
                    "id": "A2",
                    "title": "Manual inspection",
                    "verification_type": "manual_review"
                }
            ],
            "negative_assertions": [
                {
                    "id": "N1",
                    "title": "No unexpected files"
                }
            ],
            "evidence_requirements": [
                {
                    "id": "E1",
                    "assertion_id": "A1",
                    "required_fields": [
                        "assertions.A1.status",
                        "assertions.A1.command",
                        "assertions.A1.observed_result"
                    ]
                }
            ]
        }
        self.acceptance_report = {
            "acceptance_status": "pass",
            "assertion_results": [
                {
                    "assertion_id": "A1",
                    "status": "passed",
                    "observed_result": "Automated test review passed."
                },
                {
                    "assertion_id": "A2",
                    "status": "passed",
                    "observed_result": "Manual check completed, verified App.js renders correctly."
                }
            ],
            "negative_assertion_results": [
                {
                    "assertion_id": "N1",
                    "status": "passed",
                    "observed_result": "git diff shows no C files modified."
                }
            ]
        }
        self.verification_results = {
            "commands": [
                {
                    "command": "node tests/a.js",
                    "exit_code": 0,
                    "stdout": "scenario 1 passed\nscenario 2 passed"
                }
            ]
        }
        self.runtime_records = []

    def test_runtime_assertion_requires_matching_trusted_command(self):
        # 1. Standard success case
        package = compiler.compile_evidence(
            self.contract, self.acceptance_report, self.verification_results, self.runtime_records
        )
        self.assertEqual(package["assertions"]["A1"]["status"], "pass")
        self.assertEqual(package["assertions"]["A1"]["command"], "node tests/a.js")
        self.assertEqual(package["assertions"]["A1"]["exit_code"], 0)
        self.assertEqual(package["assertions"]["A1"]["observed_result"], "scenario 1 passed\nscenario 2 passed")

        # 2. Command exits with non-zero code -> fails or pending
        self.verification_results["commands"][0]["exit_code"] = 1
        package = compiler.compile_evidence(
            self.contract, self.acceptance_report, self.verification_results, self.runtime_records
        )
        self.assertEqual(package["assertions"]["A1"]["status"], "pending_environment_verification")

    def test_manual_assertion_compiles_from_acceptance_result(self):
        package = compiler.compile_evidence(
            self.contract, self.acceptance_report, self.verification_results, self.runtime_records
        )
        self.assertEqual(package["assertions"]["A2"]["status"], "pass")
        self.assertEqual(package["assertions"]["A2"]["observed_result"], "Manual check completed, verified App.js renders correctly.")

    def test_negative_assertions_are_preserved(self):
        package = compiler.compile_evidence(
            self.contract, self.acceptance_report, self.verification_results, self.runtime_records
        )
        self.assertIn("N1", package["negative_assertions"])
        self.assertEqual(package["negative_assertions"]["N1"]["status"], "pass")
        self.assertEqual(package["negative_assertions"]["N1"]["observed_result"], "git diff shows no C files modified.")

    def test_missing_runtime_result_becomes_pending_environment_verification(self):
        # Empty verification results commands list
        package = compiler.compile_evidence(
            self.contract, self.acceptance_report, {"commands": []}, self.runtime_records
        )
        self.assertEqual(package["assertions"]["A1"]["status"], "pending_environment_verification")
        self.assertNotIn("exit_code", package["assertions"]["A1"])

    def test_required_fields_exist_in_compiled_package(self):
        package = compiler.compile_evidence(
            self.contract, self.acceptance_report, self.verification_results, self.runtime_records
        )
        # Should not raise any validation error
        compiler.validate_compiled_package(package, self.contract)

        # Remove A1.status to trigger error
        del package["assertions"]["A1"]["status"]
        with self.assertRaises(ValueError):
            compiler.validate_compiled_package(package, self.contract)

    def test_a1_does_not_match_a12(self):
        # Ensure that A1 does not match command for A12, or record for A12
        # Let's add a record for A12 to runtime_records
        self.runtime_records.append({
            "assertion_id": "A12",
            "command": "node tests/a.js",
            "exit_code": 0,
            "stdout": "scenario A12"
        })
        # Empty verification results command to trigger runtime record lookup
        package = compiler.compile_evidence(
            self.contract, self.acceptance_report, {"commands": []}, self.runtime_records
        )
        self.assertEqual(package["assertions"]["A1"]["status"], "pending_environment_verification")
        self.assertNotEqual(package["assertions"]["A1"].get("observed_result"), "scenario A12")

    def test_acceptance_failure_ignored_causes_fail(self):
        # 1. Acceptance status failed should result in fail/pending
        self.acceptance_report["acceptance_status"] = "fail"
        package = compiler.compile_evidence(
            self.contract, self.acceptance_report, self.verification_results, self.runtime_records
        )
        self.assertEqual(package["assertions"]["A1"]["status"], "fail")

        # 2. Individual assertion review failed should result in fail
        self.acceptance_report["acceptance_status"] = "pass"
        self.acceptance_report["assertion_results"][0]["status"] = "fail"
        package = compiler.compile_evidence(
            self.contract, self.acceptance_report, self.verification_results, self.runtime_records
        )
        self.assertEqual(package["assertions"]["A1"]["status"], "fail")

    def test_missing_negative_assertion_does_not_default_to_pass(self):
        # Remove negative_assertion_results to simulate missing review
        self.acceptance_report["negative_assertion_results"] = []
        package = compiler.compile_evidence(
            self.contract, self.acceptance_report, self.verification_results, self.runtime_records
        )
        self.assertEqual(package["negative_assertions"]["N1"]["status"], "pending_manual_review")

    def test_runtime_record_requires_command(self):
        # 1. Record without command must not satisfy assertion
        self.runtime_records.append({
            "assertion_id": "A1",
            "command": "",
            "exit_code": 0,
            "stdout": "pass"
        })
        package = compiler.compile_evidence(
            self.contract, self.acceptance_report, {"commands": []}, self.runtime_records
        )
        self.assertEqual(package["assertions"]["A1"]["status"], "pending_environment_verification")

    def test_top_level_acceptance_failure_affects_manual_and_negative_assertions(self):
        self.acceptance_report["acceptance_status"] = "fail"
        package = compiler.compile_evidence(
            self.contract, self.acceptance_report, self.verification_results, self.runtime_records
        )
        self.assertEqual(package["assertions"]["A2"]["status"], "fail")
        self.assertEqual(package["negative_assertions"]["N1"]["status"], "fail")

    def test_explicit_negative_assertion_failure_keeps_fail(self):
        self.acceptance_report["negative_assertion_results"][0]["status"] = "failed"
        package = compiler.compile_evidence(
            self.contract, self.acceptance_report, self.verification_results, self.runtime_records
        )
        self.assertEqual(package["negative_assertions"]["N1"]["status"], "fail")

if __name__ == "__main__":
    unittest.main()

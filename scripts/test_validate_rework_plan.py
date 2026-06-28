#!/usr/bin/env python3
import sys
import os
import json
import tempfile
import subprocess
from pathlib import Path

# Add scripts directory to path to locate script under test
scripts_dir = Path(__file__).parent.resolve()
validator_script = scripts_dir / "validate_rework_plan.py"

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

def run_validator(plan_dict, adu_id="ADU-123", allowed_paths="webui/,src/"):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(plan_dict, f, ensure_ascii=False, indent=2)
        plan_path = f.name

    try:
        cmd = [
            sys.executable,
            str(validator_script),
            "--plan-path", plan_path,
            "--allowed-paths", allowed_paths,
            "--adu", adu_id
        ]
        proc = subprocess.run(cmd, text=True, capture_output=True)
        return proc.returncode, proc.stdout, proc.stderr
    finally:
        if os.path.exists(plan_path):
            os.unlink(plan_path)

def make_valid_plan():
    return {
        "version": 1,
        "adu_id": "ADU-123",
        "source": "code-review",
        "return_to": "developer",
        "must_fix_now": [
            {
                "finding_id": "CR-1",
                "severity": "P1",
                "developer_action": "Fix memory leak",
                "verification_command": "make test",
                "affected_paths": ["src/main.c"]
            }
        ],
        "additional_write_paths": ["webui/server.js"]
    }

def test_valid_plan_passes():
    plan = make_valid_plan()
    code, out, err = run_validator(plan)
    assert code == 0, f"Expected code 0, got {code}. Stderr: {err}"

def test_trailing_slash_directory_passes():
    plan = make_valid_plan()
    plan["additional_write_paths"] = ["webui/components/"]
    code, out, err = run_validator(plan)
    assert code == 0, f"Expected code 0, got {code}. Stderr: {err}"

def test_trailing_double_slash_rejected():
    plan = make_valid_plan()
    plan["additional_write_paths"] = ["webui/components//"]
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "must not end with multiple slashes" in err

def test_internal_double_slash_rejected():
    plan = make_valid_plan()
    plan["additional_write_paths"] = ["webui//components"]
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "must not contain empty components" in err

def test_out_of_bounds_path_opens_gate():
    plan = make_valid_plan()
    plan["additional_write_paths"] = ["outside/path.js"]
    code, out, err = run_validator(plan)
    assert code == 20, f"Expected code 20, got {code}. Stderr: {err}"
    assert "blocked paths" in err, f"Expected blocked paths message, got {err}"

def test_absolute_path_unix_rejected():
    plan = make_valid_plan()
    plan["additional_write_paths"] = ["/webui/server.js"]
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "must not be an absolute path" in err or "must not be an absolute path" in out

def test_absolute_path_windows_rejected():
    plan = make_valid_plan()
    plan["additional_write_paths"] = ["C:/webui/server.js"]
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "must not be an absolute path" in err

def test_path_traversal_rejected():
    plan = make_valid_plan()
    plan["additional_write_paths"] = ["../webui/server.js"]
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "must not contain path traversal" in err

def test_empty_path_rejected():
    plan = make_valid_plan()
    plan["additional_write_paths"] = [""]
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "must not be empty" in err

def test_whitespace_path_rejected():
    plan = make_valid_plan()
    plan["additional_write_paths"] = ["   "]
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "must not be empty" in err

def test_nul_character_rejected():
    plan = make_valid_plan()
    plan["additional_write_paths"] = ["webui/\x00server.js"]
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "must not contain NUL" in err

def test_mismatched_adu_id_rejected():
    plan = make_valid_plan()
    code, out, err = run_validator(plan, adu_id="ADU-WRONG")
    assert code == 1, f"Expected code 1, got {code}"
    assert "does not match expected ADU ID" in err

def test_mismatched_version_rejected():
    plan = make_valid_plan()
    plan["version"] = 2
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "version" in err

def test_missing_source_rejected():
    plan = make_valid_plan()
    del plan["source"]
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "source" in err

def test_invalid_source_enum_rejected():
    plan = make_valid_plan()
    plan["source"] = "invalid-source"
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "source" in err

def test_missing_return_to_rejected():
    plan = make_valid_plan()
    plan["return_to"] = "   "
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "return_to" in err

def test_invalid_return_to_enum_rejected():
    plan = make_valid_plan()
    plan["return_to"] = "evidence"
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "return_to" in err

def test_missing_must_fix_now_fields_rejected():
    for field in ("finding_id", "severity", "developer_action", "verification_command"):
        plan = make_valid_plan()
        del plan["must_fix_now"][0][field]
        code, out, err = run_validator(plan)
        assert code == 1, f"Expected code 1 for missing {field}, got {code}"
        assert field in err

def test_invalid_severity_enum_rejected():
    plan = make_valid_plan()
    plan["must_fix_now"][0]["severity"] = "NOT-A-SEVERITY"
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "severity" in err

def test_empty_affected_paths_rejected():
    plan = make_valid_plan()
    plan["must_fix_now"][0]["affected_paths"] = []
    code, out, err = run_validator(plan)
    assert code == 1, f"Expected code 1, got {code}"
    assert "empty 'affected_paths'" in err

def main():
    print("── Rework Validator Tests ──\n")
    assert_test("valid plan passes", test_valid_plan_passes)
    assert_test("trailing slash directory passes", test_trailing_slash_directory_passes)
    assert_test("trailing double slash rejected", test_trailing_double_slash_rejected)
    assert_test("internal double slash rejected", test_internal_double_slash_rejected)
    assert_test("out of bounds path opens human gate", test_out_of_bounds_path_opens_gate)
    assert_test("absolute UNIX path rejected", test_absolute_path_unix_rejected)
    assert_test("absolute Windows path rejected", test_absolute_path_windows_rejected)
    assert_test("path traversal rejected", test_path_traversal_rejected)
    assert_test("empty path rejected", test_empty_path_rejected)
    assert_test("whitespace path rejected", test_whitespace_path_rejected)
    assert_test("NUL character path rejected", test_nul_character_rejected)
    assert_test("mismatched ADU ID rejected", test_mismatched_adu_id_rejected)
    assert_test("mismatched version rejected", test_mismatched_version_rejected)
    assert_test("missing source rejected", test_missing_source_rejected)
    assert_test("invalid source enum rejected", test_invalid_source_enum_rejected)
    assert_test("missing return_to rejected", test_missing_return_to_rejected)
    assert_test("invalid return_to enum rejected", test_invalid_return_to_enum_rejected)
    assert_test("missing must_fix_now item fields rejected", test_missing_must_fix_now_fields_rejected)
    assert_test("invalid severity enum rejected", test_invalid_severity_enum_rejected)
    assert_test("empty affected_paths rejected", test_empty_affected_paths_rejected)

    print(f"\n── Results: {passed} passed, {failed} failed ──")
    sys.exit(0 if failed == 0 else 1)

if __name__ == "__main__":
    main()

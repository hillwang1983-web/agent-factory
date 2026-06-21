#!/usr/bin/env python3
import sys
from code_review_fact_gate import validate_fact_consistency

def test_matching_commands_pass():
    res = validate_fact_consistency(
        {"commands": [{"command": "meson test -C build unit", "exit_code": 0}]},
        {"commands_run": ["meson test -C build unit"]},
    )
    assert res["valid"], f"Expected True, got {res}"

def test_missing_declaration_fails():
    res = validate_fact_consistency(
        {"commands": [{"command": "meson test -C build unit", "exit_code": 0}]},
        {"commands_run": []},
    )
    assert not res["valid"], f"Expected False, got {res}"

def test_extra_declaration_fails():
    res = validate_fact_consistency(
        {"commands": []},
        {"commands_run": ["meson test -C build unit"]},
    )
    assert not res["valid"], f"Expected False, got {res}"

def run_tests():
    test_matching_commands_pass()
    test_missing_declaration_fails()
    test_extra_declaration_fails()
    print("✅ All code review fact gate tests passed!")

if __name__ == "__main__":
    try:
        run_tests()
    except AssertionError as e:
        print(f"Assertion failed: {e}", file=sys.stderr)
        sys.exit(1)

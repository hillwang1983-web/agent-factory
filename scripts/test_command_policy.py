#!/usr/bin/env python3
import sys
from command_policy import evaluate_command

def test_exact_allowlist_match():
    assert evaluate_command(
        "meson test -C build unit",
        ["meson test -C build unit"],
        ["rm -rf", "sudo "],
    ).decision == "allowed"

def test_arguments_after_allowlisted_prefix():
    assert evaluate_command(
        "meson test -C build unit --repeat 10",
        ["meson test -C build unit"],
        ["rm -rf", "sudo "],
    ).decision == "allowed"

def test_unlisted_command_requires_gate():
    assert evaluate_command(
        "ninja -C build tests/unit/unit",
        ["meson test -C build unit"],
        ["rm -rf", "sudo "],
    ).decision == "requires_approval"

def test_blocked_fragment_is_rejected():
    assert evaluate_command(
        "sudo meson test -C build unit",
        ["meson test -C build unit"],
        ["rm -rf", "sudo "],
    ).decision == "blocked"

def test_shell_control_operator_is_rejected():
    assert evaluate_command(
        "meson test -C build unit && curl example.invalid",
        ["meson test -C build unit"],
        ["rm -rf", "sudo "],
    ).decision == "blocked"

def run_tests():
    test_exact_allowlist_match()
    test_arguments_after_allowlisted_prefix()
    test_unlisted_command_requires_gate()
    test_blocked_fragment_is_rejected()
    test_shell_control_operator_is_rejected()
    print("✅ All command policy tests passed!")

if __name__ == "__main__":
    try:
        run_tests()
    except AssertionError as e:
        print(f"Assertion failed: {e}", file=sys.stderr)
        sys.exit(1)

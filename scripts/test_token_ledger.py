#!/usr/bin/env python3
"""Tests for token_ledger.aggregate_adu_tokens.

Covers: per-agent accumulation, runCount, success/failure counts,
budget threshold status, no-token runs, empty ADU filter.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from token_ledger import aggregate_adu_tokens

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


def run(agent, inp, out, result, adu_id="ADU-TEST"):
    return {
        "adu_id": adu_id,
        "agent": agent,
        "result": result,
        "token_usage": {"inputTokens": inp, "outputTokens": out},
    }


def test_accumulates_single_run():
    r = [run("requirement-analyst", 1000, 100, "success")]
    s = aggregate_adu_tokens(r, "ADU-TEST", {})
    assert s["inputTokens"] == 1000, f"inputTokens={s['inputTokens']}"
    assert s["outputTokens"] == 100, f"outputTokens={s['outputTokens']}"
    assert s["runCount"] == 1
    assert s["agentBreakdown"]["requirement-analyst"]["runCount"] == 1
    assert s["agentBreakdown"]["requirement-analyst"]["successCount"] == 1


def test_accumulates_repeated_agent():
    r = [
        run("code-reviewer", 1000, 100, "success"),
        run("code-reviewer", 1200, 120, "success"),
    ]
    s = aggregate_adu_tokens(r, "ADU-TEST", {})
    assert s["inputTokens"] == 2200
    assert s["runCount"] == 2
    assert s["agentBreakdown"]["code-reviewer"]["runCount"] == 2
    assert s["agentBreakdown"]["code-reviewer"]["inputTokens"] == 2200


def test_split_by_adu_id():
    r = [run("dev", 100, 10, "success", adu_id="ADU-A"), run("dev", 200, 20, "success", adu_id="ADU-B")]
    s = aggregate_adu_tokens(r, "ADU-A", {})
    assert s["inputTokens"] == 100
    assert s["runCount"] == 1


def test_failure_and_success_counts():
    r = [
        run("evidence", 800, 80, "failed"),
        run("evidence", 900, 90, "success"),
    ]
    s = aggregate_adu_tokens(r, "ADU-TEST", {})
    assert s["agentBreakdown"]["evidence"]["successCount"] == 1
    assert s["agentBreakdown"]["evidence"]["failureCount"] == 1
    assert s["agentBreakdown"]["evidence"]["runCount"] == 2
    assert s["agentBreakdown"]["evidence"]["inputTokens"] == 1700


def test_no_token_usage_still_counts_run():
    r = [{"adu_id": "ADU-TEST", "agent": "code-reviewer", "result": "success"}]
    s = aggregate_adu_tokens(r, "ADU-TEST", {})
    assert s["runCount"] == 1
    assert s["inputTokens"] == 0
    assert s["outputTokens"] == 0


def test_empty_adu_returns_empty():
    s = aggregate_adu_tokens([], "ADU-TEST", {})
    assert s["runCount"] == 0
    assert s["inputTokens"] == 0


def test_budget_status_warning():
    r = [run("code-reviewer", 4500, 100, "success")]
    budget = {"default": {"inputTokenLimit": 5000, "warnAtRatio": 0.8, "outputTokenLimit": 10000}}
    s = aggregate_adu_tokens(r, "ADU-TEST", budget)
    # 4500 / 5000 = 0.9 > 0.8 → warning
    assert s["agentBreakdown"]["code-reviewer"]["status"] == "warning"


def test_budget_status_exceeded():
    r = [run("code-reviewer", 6000, 100, "success")]
    budget = {"default": {"inputTokenLimit": 5000, "warnAtRatio": 0.8, "outputTokenLimit": 10000}}
    s = aggregate_adu_tokens(r, "ADU-TEST", budget)
    assert s["agentBreakdown"]["code-reviewer"]["status"] == "exceeded"


def test_total_tokens():
    r = [run("dev", 100, 10, "success"), run("reviewer", 200, 20, "success")]
    s = aggregate_adu_tokens(r, "ADU-TEST", {})
    assert s["totalTokens"] == 330  # 110 + 220


def test_snake_case_keys_and_warnings():
    r = [run("dev", 100, 10, "success"), run("reviewer", 4500, 100, "success")]
    budget = {"default": {"inputTokenLimit": 5000, "warnAtRatio": 0.8, "outputTokenLimit": 10000}}
    s = aggregate_adu_tokens(r, "ADU-TEST", budget_limits=budget)
    assert s["total_input_tokens"] == 4600
    assert s["total_output_tokens"] == 110
    assert s["total_tokens"] == 4710
    assert s["warnings_triggered"] is True


def main():
    print("── Token Ledger Tests ──\n")
    assert_test("single run accumulates correctly", test_accumulates_single_run)
    assert_test("repeated agent accumulates", test_accumulates_repeated_agent)
    assert_test("filtered by ADU id", test_split_by_adu_id)
    assert_test("failure and success counts", test_failure_and_success_counts)
    assert_test("missing token_usage still counts run", test_no_token_usage_still_counts_run)
    assert_test("empty ADU returns empty", test_empty_adu_returns_empty)
    assert_test("warning status from budget ratio", test_budget_status_warning)
    assert_test("exceeded status from budget limit", test_budget_status_exceeded)
    assert_test("totalTokens is correct sum", test_total_tokens)
    assert_test("snake_case keys and warnings_triggered", test_snake_case_keys_and_warnings)
    print(f"\n── Results: {passed} passed, {failed} failed ──")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()

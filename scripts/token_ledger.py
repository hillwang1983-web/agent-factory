"""Deterministic ADU token ledger — aggregate all run records per ADU.

Provides a single pure function that sums input/output tokens across all runs
for a given ADU, with per-agent breakdown including runCount, successCount,
failureCount, and status (normal/warning/exceeded).
"""


def aggregate_adu_tokens(runs, adu_id, budget):
    """Aggregate token usage for all runs belonging to adu_id.

    Args:
        runs: list of run dicts with keys: adu_id, agent, result, token_usage
        adu_id: string ADU identifier
        budget: token-budget.json structure with default and agents keys

    Returns:
        dict with inputTokens, outputTokens, totalTokens, runCount, agentBreakdown
    """
    summary = {
        "inputTokens": 0,
        "outputTokens": 0,
        "totalTokens": 0,
        "runCount": 0,
        "agentBreakdown": {},
    }
    default_budget = budget.get("default", {}) if isinstance(budget, dict) else {}
    agent_budgets = budget.get("agents", {}) if isinstance(budget, dict) else {}

    for run in runs:
        if run.get("adu_id") != adu_id:
            continue

        agent = run.get("agent") or "unknown"
        usage = run.get("token_usage") or {}
        input_tokens = int(usage.get("inputTokens") or 0)
        output_tokens = int(usage.get("outputTokens") or 0)
        result = run.get("result")

        entry = summary["agentBreakdown"].setdefault(agent, {
            "inputTokens": 0,
            "outputTokens": 0,
            "runCount": 0,
            "successCount": 0,
            "failureCount": 0,
            "status": "normal",
        })
        entry["inputTokens"] += input_tokens
        entry["outputTokens"] += output_tokens
        entry["runCount"] += 1
        if result == "success":
            entry["successCount"] += 1
        else:
            entry["failureCount"] += 1

        summary["inputTokens"] += input_tokens
        summary["outputTokens"] += output_tokens
        summary["runCount"] += 1

    for agent, entry in summary["agentBreakdown"].items():
        limits = agent_budgets.get(agent, default_budget)
        input_limit = int(limits.get("inputTokenLimit") or 0)
        output_limit = int(limits.get("outputTokenLimit") or 0)
        warn_ratio = float(limits.get("warnAtRatio") or 0.8)
        if (
            (input_limit and entry["inputTokens"] >= input_limit)
            or (output_limit and entry["outputTokens"] >= output_limit)
        ):
            entry["status"] = "exceeded"
        elif (
            (input_limit and entry["inputTokens"] >= input_limit * warn_ratio)
            or (output_limit and entry["outputTokens"] >= output_limit * warn_ratio)
        ):
            entry["status"] = "warning"

    summary["totalTokens"] = summary["inputTokens"] + summary["outputTokens"]
    return summary

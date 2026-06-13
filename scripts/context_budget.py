#!/usr/bin/env python3
import sys
import os
import json
import argparse
from pathlib import Path

def get_char_count(file_path):
    if not file_path.exists():
        return 0
    try:
        return len(file_path.read_text(encoding='utf-8', errors='ignore'))
    except Exception:
        return 0

def get_directory_size(dir_path):
    if not dir_path.exists():
        return 0
    total = 0
    for f in dir_path.glob("**/*"):
        if f.is_file():
            total += get_char_count(f)
    return total

def main():
    parser = argparse.ArgumentParser(description="Estimate token usage for an agent execution step.")
    parser.add_argument("--agent", required=True, help="Agent name")
    parser.add_argument("--adu", required=True, help="ADU ID")
    parser.add_argument("--repo-root", required=True, help="Repo root path")
    parser.add_argument("--registry-dir", required=True, help="Registry dir path")
    parser.add_argument("--mode", default="estimate", choices=["estimate", "check"])
    args = parser.parse_args()

    adu_id = args.adu
    agent = args.agent
    repo_root = Path(args.repo_root)
    registry_dir = Path(args.registry_dir)

    # 1. Load token governance limits
    gov_file = registry_dir / "token-governance.json"
    limits = {
        "warning_input_tokens": 1200000,
        "hard_input_tokens": 3000000
    }
    if gov_file.exists():
        try:
            with open(gov_file, 'r', encoding='utf-8') as f:
                gov_data = json.load(f)
                defaults = gov_data.get("defaults", {})
                limits["warning_input_tokens"] = defaults.get("warning_input_tokens", 1200000)
                limits["hard_input_tokens"] = defaults.get("hard_input_tokens", 3000000)

                # Check agent specific limits
                agent_limits = gov_data.get("agent_budgets", {}).get(agent, {})
                if "warning_input_tokens" in agent_limits:
                    limits["warning_input_tokens"] = agent_limits["warning_input_tokens"]
                if "hard_input_tokens" in agent_limits:
                    limits["hard_input_tokens"] = agent_limits["hard_input_tokens"]
        except Exception:
            pass

    # 2. Compute components size (estimated in tokens: ~4 characters per token)
    system_prompt_size = 12000  # Default baseline system prompt

    # Project Profile
    profile_file = repo_root / ".agent-factory" / "project-profile.json"
    profile_tokens = int(get_char_count(profile_file) / 4)

    # Knowledge Pack
    knowledge_dir = repo_root / ".agent-factory" / "knowledge"
    knowledge_tokens = int(get_directory_size(knowledge_dir) / 4)
    if knowledge_tokens == 0:
        knowledge_tokens = int(get_directory_size(repo_root / ".ai-agent" / "context-packs") / 4)

    # Run history for the ADU
    run_history_tokens = 0
    runs_file = registry_dir / "runs.json"
    if runs_file.exists():
        try:
            with open(runs_file, 'r', encoding='utf-8') as f:
                runs = json.load(f).get("runs", [])
                adu_runs = [r for r in runs if r.get("adu_id") == adu_id]
                # estimate size of adu runs
                run_history_tokens = int(len(json.dumps(adu_runs)) / 4)
        except Exception:
            pass
    if run_history_tokens > 400000:
        run_history_tokens = 400000 # Cap normal injected history

    # Artifacts size (design, contract, analysis)
    artifacts_tokens = 0
    analysis_file = repo_root / ".ai-agent" / "analysis" / f"{adu_id}.md"
    design_file = repo_root / ".ai-agent" / "designs" / f"{adu_id}-detailed-design.md"
    contract_file = repo_root / ".ai-agent" / "contracts" / f"{adu_id}.json"
    artifacts_tokens += int(get_char_count(analysis_file) / 4)
    artifacts_tokens += int(get_char_count(design_file) / 4)
    artifacts_tokens += int(get_char_count(contract_file) / 4)

    # Active git diff context
    diff_tokens = 25000 # Default baseline change size

    # Summarize overall input
    estimated_input_tokens = (
        system_prompt_size +
        profile_tokens +
        knowledge_tokens +
        run_history_tokens +
        artifacts_tokens +
        diff_tokens
    )

    # 3. Determine budget status
    status = "ok"
    if estimated_input_tokens > limits["hard_input_tokens"]:
        status = "hard_stop"
    elif estimated_input_tokens > limits["warning_input_tokens"]:
        status = "warning"

    # 4. Generate recommendations if warning/hard_stop
    recommended_truncations = []
    if status != "ok":
        if run_history_tokens > 100000:
            recommended_truncations.append({
                "source": "run_history",
                "action": "summarize",
                "expected_saving_tokens": int(run_history_tokens * 0.7)
            })
        if knowledge_tokens > 150000:
            recommended_truncations.append({
                "source": "knowledge_pack",
                "action": "selective_import",
                "expected_saving_tokens": int(knowledge_tokens * 0.5)
            })

    output = {
        "estimated_input_tokens": estimated_input_tokens,
        "budget_status": status,
        "breakdown": {
            "system_prompt": system_prompt_size,
            "project_profile": profile_tokens,
            "knowledge_pack": knowledge_tokens,
            "run_history": run_history_tokens,
            "artifacts": artifacts_tokens,
            "diff": diff_tokens
        },
        "recommended_truncations": recommended_truncations
    }

    print(json.dumps(output, indent=2))

    if status == "hard_stop" and args.mode == "check":
        sys.exit(2)
    elif status == "warning" and args.mode == "check":
        sys.exit(0)
    else:
        sys.exit(0)

if __name__ == "__main__":
    main()

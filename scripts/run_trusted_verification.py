#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import hashlib
import shlex
import subprocess
import time
from datetime import datetime, timezone
import sys

from command_policy import evaluate_command

def compute_sha256(text: str) -> str:
    h = hashlib.sha256()
    h.update(text.encode("utf-8"))
    return h.hexdigest()

def iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def main():
    parser = argparse.ArgumentParser(description="Execute trusted verification commands")
    parser.add_argument("--adu", required=True, help="ADU ID")
    parser.add_argument("--run-dir", required=True, help="Run directory path")
    parser.add_argument("--repo-root", required=True, help="Repository root path")
    parser.add_argument("--registry-dir", required=True, help="Registry directory path")
    args = parser.parse_args()

    run_dir = pathlib.Path(args.run_dir).resolve()
    repo_root = pathlib.Path(args.repo_root).resolve()
    registry_dir = pathlib.Path(args.registry_dir).resolve()

    # Load adu.json
    adu_json_path = registry_dir / "adu.json"
    if not adu_json_path.exists():
        print(f"ERROR: adu.json not found at {adu_json_path}", file=sys.stderr)
        sys.exit(1)

    try:
        adu_data = json.loads(adu_json_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"ERROR: Failed to parse adu.json: {e}", file=sys.stderr)
        sys.exit(1)

    adu_entry = next((a for a in adu_data.get("adus", []) if a.get("id") == args.adu), None)
    if not adu_entry:
        print(f"ERROR: ADU {args.adu} not found in adu.json", file=sys.stderr)
        sys.exit(1)

    required_commands = adu_entry.get("required_commands", [])
    command_policy = adu_entry.get("command_policy", {})
    allowed_commands = command_policy.get("allowed_commands", [])
    blocked_patterns = command_policy.get("blocked_command_patterns", [])

    verification_dir = run_dir / "verification"
    verification_dir.mkdir(parents=True, exist_ok=True)

    commands_records = []
    has_blocked = False
    has_requires_approval = False

    # Evaluate all commands first
    evaluated = []
    for cmd in required_commands:
        decision = evaluate_command(cmd, allowed_commands, blocked_patterns)
        evaluated.append((cmd, decision))
        if decision.decision == "blocked":
            has_blocked = True
        elif decision.decision == "requires_approval":
            has_requires_approval = True

    # Build initial commands_records for decisions
    for idx, (cmd, decision) in enumerate(evaluated):
        commands_records.append({
            "command": cmd,
            "policy_decision": decision.decision,
            "decision_reason": decision.reason,
            "started_at": None,
            "finished_at": None,
            "exit_code": None,
            "stdout_path": None,
            "stderr_path": None,
            "stdout_sha256": None,
            "stderr_sha256": None,
            "timed_out": False
        })

    def write_results(exit_code_status):
        results = {
            "version": 1,
            "adu_id": args.adu,
            "run_id": run_dir.name,
            "generated_by": "agent-factory-runner",
            "commands": commands_records
        }
        results_path = run_dir / "verification-results.json"
        results_path.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
        return exit_code_status

    if has_blocked:
        return write_results(2)

    if has_requires_approval:
        return write_results(20)

    # All commands are allowed -> execute them
    final_exit_code = 0
    for idx, (cmd, decision) in enumerate(evaluated):
        record = commands_records[idx]
        record["started_at"] = iso_now()

        argv = shlex.split(decision.normalized_command)

        stdout_rel = f"verification/command-{idx+1:03d}.stdout.log"
        stderr_rel = f"verification/command-{idx+1:03d}.stderr.log"

        stdout_file = run_dir / stdout_rel
        stderr_file = run_dir / stderr_rel

        try:
            completed = subprocess.run(
                argv,
                cwd=str(repo_root),
                text=True,
                capture_output=True,
                timeout=300,
                shell=False
            )
            stdout_text = completed.stdout
            stderr_text = completed.stderr
            exit_code = completed.returncode
            timed_out = False
        except subprocess.TimeoutExpired as e:
            stdout_text = e.stdout or ""
            stderr_text = e.stderr or ""
            exit_code = -1
            timed_out = True
        except Exception as e:
            stdout_text = ""
            stderr_text = str(e)
            exit_code = -2
            timed_out = False

        record["finished_at"] = iso_now()
        record["exit_code"] = exit_code
        record["timed_out"] = timed_out

        # Write outputs
        stdout_file.write_text(stdout_text, encoding="utf-8")
        stderr_file.write_text(stderr_text, encoding="utf-8")

        record["stdout_path"] = stdout_rel
        record["stderr_path"] = stderr_rel
        record["stdout_sha256"] = compute_sha256(stdout_text)
        record["stderr_sha256"] = compute_sha256(stderr_text)

        if exit_code != 0:
            final_exit_code = 1
            # Write final results and stop executing subsequent commands
            return write_results(1)

    return write_results(final_exit_code)

if __name__ == "__main__":
    sys.exit(main())

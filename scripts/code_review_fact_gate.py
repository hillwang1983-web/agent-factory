#!/usr/bin/env python3
import shlex

def normalize_command(command: str) -> str:
    try:
        return " ".join(shlex.split(command))
    except Exception:
        return " ".join(command.split())

def validate_fact_consistency(verification_results: dict, code_review_report: dict) -> dict:
    errors = []

    # Extract executed commands from verification-results.json
    executed_commands = []
    for cmd_entry in verification_results.get("commands", []):
        if cmd_entry.get("exit_code") is not None:
            executed_commands.append(normalize_command(cmd_entry["command"]))

    cr_commands = [normalize_command(c) for c in code_review_report.get("commands_run", [])]

    executed_set = set(executed_commands)
    cr_set = set(cr_commands)

    for cmd in cr_set:
        if cmd not in executed_set:
            errors.append(f"Command '{cmd}' declared in code review report but was not executed during trusted verification.")

    for cmd in executed_set:
        if cmd not in cr_set:
            errors.append(f"Command '{cmd}' executed during trusted verification but not declared in code review report.")

    return {
        "valid": len(errors) == 0,
        "errors": errors
    }

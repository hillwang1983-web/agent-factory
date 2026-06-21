#!/usr/bin/env python3
import shlex
from dataclasses import dataclass

@dataclass(frozen=True)
class CommandDecision:
    decision: str
    normalized_command: str
    reason: str

def normalize_command(command: str) -> str:
    try:
        return " ".join(shlex.split(command))
    except Exception:
        return " ".join(command.split())

def evaluate_command(
    command: str,
    allowed_commands: list[str],
    blocked_patterns: list[str],
) -> CommandDecision:
    normalized = normalize_command(command)
    
    # 1. Reject shell control operators
    if any(token in normalized for token in ("&&", "||", ";", "\n", "\r")):
        return CommandDecision("blocked", normalized, "shell control operators are not allowed")
    
    # 2. Reject blocked patterns
    if any(pattern and pattern in normalized for pattern in blocked_patterns):
        return CommandDecision("blocked", normalized, "matched blocked command pattern")
    
    # 3. Accept allowed match (either exact or starting with allowed + " ")
    for allowed in allowed_commands:
        norm_allowed = normalize_command(allowed)
        if normalized == norm_allowed or normalized.startswith(norm_allowed + " "):
            return CommandDecision("allowed", normalized, "matched allowed command")
            
    # 4. Require approval
    return CommandDecision("requires_approval", normalized, "command is not in allowed_commands")

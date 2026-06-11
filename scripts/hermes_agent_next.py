#!/usr/bin/env python3
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ADU_PATH = ROOT / ".ai-agent" / "registry" / "adu.json"

NEXT_AGENT = {
    "created": "requirement-analyst",
    "analyzed": "context-pack",
    "contexted": "detail-designer",
    "designed": "contract",
    "contracted": "testwriter",
    "test_red": "developer",
    "code_rework": "developer",
    "build_rework": "developer",
    "acceptance_rework": "developer",
    "implemented": "code-reviewer",
    "code_reviewed": "buildfix-debugger",
    "debugged": "acceptance-reviewer",
    "acceptance_reviewed": "evidence",
}



def main():
    data = json.loads(ADU_PATH.read_text(encoding="utf-8"))
    for adu in data["adus"]:
        state = adu["state"]
        if state in ("evidenced", "mvp_ready"):
            continue
        if state == "human_gate":
            print(f"{adu['id']} is blocked at human_gate")
            return 2
        if state in ("analysis_review", "design_review"):
            print(f"{adu['id']} is blocked at review gate ({state})")
            return 3
        agent = NEXT_AGENT.get(state)
        if not agent:
            print(f"No next agent for {adu['id']} state={state}")
            return 1
        cmd = [
            sys.executable,
            str(ROOT / "scripts" / "hermes_agent_run.py"),
            "--adu",
            adu["id"],
            "--agent",
            agent,
        ]
        print("Running:", " ".join(cmd))
        return subprocess.call(cmd, cwd=str(ROOT))
    print("No runnable ADU found")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

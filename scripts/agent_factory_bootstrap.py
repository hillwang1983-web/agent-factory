#!/usr/bin/env python3
import argparse
import json
import pathlib
import sys

RUNTIME_FILES = {
    "adu.json": {"version": 1, "adus": []},
    "runs.json": {"version": 1, "runs": []},
    "reviews.json": {"version": 1, "reviews": []},
    "projects.json": {"version": 1, "projects": []},
    "operations.json": {"version": 1, "operations": []},
    "epics.json": {"version": 1, "epics": []},
    "intake-drafts.json": {"version": 1, "drafts": []},
    "intake-operations.json": {"version": 1, "operations": []},
    "events.json": {"version": 1, "events": []},
    "evidence-waivers.json": {"version": 1, "waivers": []},
    "write-path-expansion-requests.json": {"version": 1, "requests": []},
    "human-gates.json": {"version": 1, "gates": []},
    "token-budget.json": {"version": 1, "agents": {}},
    "artifact-edits.json": {"version": 1, "edits": []},
    "operator-actions.json": {"version": 1, "actions": []},
    "operator-audit-logs.json": {"version": 1, "logs": []},
}

RUNTIME_DIRS = [
    ".ai-agent/registry",
    ".ai-agent/policies",
    ".ai-agent/runs",
    ".ai-agent/locks",
    ".ai-agent/evidence",
    ".ai-agent/context-packs",
    ".ai-agent/contracts",
    ".ai-agent/reviews",
    ".ai-agent/analysis",
    ".ai-agent/designs",
    ".ai-agent/acceptance",
]

def validate_json(path):
    try:
        json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Existing JSON is malformed: {path}: {exc}") from exc

def main():
    parser = argparse.ArgumentParser(description="Bootstrap Agent Factory runtime directories and registry files")
    parser.add_argument("--workspace", default=None, help="Agent Factory workspace root")
    args = parser.parse_args()

    workspace = pathlib.Path(args.workspace).expanduser().resolve() if args.workspace else pathlib.Path(__file__).resolve().parents[1]

    for rel_dir in RUNTIME_DIRS:
        (workspace / rel_dir).mkdir(parents=True, exist_ok=True)

    policy_file = workspace / ".ai-agent" / "policies" / "agent-run-policy.json"
    if not policy_file.exists():
        default_policy = {
            "version": 1,
            "defaults": {
                "max_duration_seconds": 600,
                "no_progress_timeout_seconds": 180,
                "termination_grace_seconds": 5,
                "max_prompt_bytes": 120000,
                "max_estimated_input_tokens": 30000
            },
            "agents": {
                "adu-intake-agent": {
                    "max_duration_seconds": 300,
                    "no_progress_timeout_seconds": 120
                },
                "requirement-analyst": {
                    "max_duration_seconds": 240,
                    "no_progress_timeout_seconds": 90,
                    "max_prompt_bytes": 60000,
                    "max_estimated_input_tokens": 16000
                },
                "system-flow-designer": {
                    "max_duration_seconds": 360
                },
                "developer": {
                    "max_duration_seconds": 1200
                }
            }
        }
        policy_file.write_text(json.dumps(default_policy, indent=2) + "\n", encoding="utf-8")

    registry = workspace / ".ai-agent" / "registry"
    created = []
    for name, payload in RUNTIME_FILES.items():
        path = registry / name
        if path.exists():
            validate_json(path)
            continue
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        created.append(str(path))

    print(json.dumps({"workspace": str(workspace), "created": created}, indent=2))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

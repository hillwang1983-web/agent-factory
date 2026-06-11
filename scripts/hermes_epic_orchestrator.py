#!/usr/bin/env python3
"""Hermes Epic Orchestrator

Implements Epic-level orchestration for Phase 3 Agent Factory.
Handles: system-flow-designer, adu-splitter, materialize child ADUs,
child ADU DAG scheduling (serial MVP), and epic-acceptance-reviewer.

CLI: python3 scripts/hermes_epic_orchestrator.py --epic EPIC_ID --mode step|start|continue --project PROJECT_ID --repo-root /path/to/repo

Broadcasts events via NDJSON stdout.
"""

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Dynamic registry path resolution
registry_dir_env = os.environ.get("AGENT_FACTORY_REGISTRY_DIR")
if registry_dir_env:
    REGISTRY = Path(registry_dir_env).resolve()
else:
    projects_registry_env = os.environ.get("AGENT_FACTORY_PROJECTS_REGISTRY")
    if projects_registry_env:
        REGISTRY = Path(projects_registry_env).parent.resolve()
    else:
        REGISTRY = ROOT / ".ai-agent" / "registry"

# Epic state machine: current state -> (next agent, next state)
EPIC_STATE_NEXT = {
    "created": ("system-flow-designer", "flow_designed"),
    "flow_designed": ("adu-splitter", "split_decision"),
    "split_decision": (None, "split_decision"),  # handled by post-splitter logic
    "single_adu_selected": (None, "child_adus_created"),
    "split_required": (None, "epic_planned"),
    "epic_planned": (None, "child_adus_created"),
    "child_adus_created": (None, "child_adus_running"),
    "child_adus_running": (None, "child_adus_running"),
    "child_adus_blocked": (None, "child_adus_running"),
    "child_adus_evidenced": ("epic-acceptance-reviewer", "epic_acceptance"),
    "epic_acceptance": (None, "epic_acceptance"),
    "epic_evidenced": (None, "epic_evidenced"),
    "epic_failed": (None, "epic_failed"),
    "human_gate": (None, "human_gate"),
    "canceled": (None, "canceled"),
}


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(path)


def broadcast_event(event_type: str, payload: dict):
    msg = json.dumps({"type": event_type, "payload": payload})
    print(msg, flush=True)


def run_agent(epic_id: str, agent: str, project_id: str, repo_root: str) -> dict:
    """Run an Epic-level agent via hermes_agent_run.py --epic."""
    runner = str(ROOT / "scripts" / "hermes_agent_run.py")
    cmd = [
        sys.executable, runner,
        "--epic", epic_id,
        "--agent", agent,
        "--project", project_id,
        "--repo", repo_root,
    ]
    broadcast_event("epic_agent_started", {"epicId": epic_id, "agent": agent})
    proc = subprocess.run(cmd, cwd=repo_root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        broadcast_event("epic_agent_failed", {
            "epicId": epic_id, "agent": agent, "returncode": proc.returncode,
            "stderr": proc.stderr[:500]
        })
        return {"result": "failed", "error": proc.stderr[:500]}
    # Parse the last JSON object from stdout (runner outputs pretty-printed JSON as final output)
    stdout = proc.stdout.strip()
    run_record = None
    if stdout:
        # Find the last top-level JSON object: scan backwards for the closing brace,
        # then find the matching opening brace
        last_close = stdout.rfind("}")
        if last_close >= 0:
            # Walk backwards to find the matching opening brace
            depth = 0
            start = -1
            for i in range(last_close, -1, -1):
                if stdout[i] == "}":
                    depth += 1
                elif stdout[i] == "{":
                    depth -= 1
                    if depth == 0:
                        start = i
                        break
            if start >= 0:
                try:
                    run_record = json.loads(stdout[start:last_close + 1])
                except json.JSONDecodeError:
                    pass
    if run_record:
        broadcast_event("epic_agent_completed", {
            "epicId": epic_id, "agent": agent, "result": run_record.get("result")
        })
        return run_record
    broadcast_event("epic_agent_completed", {"epicId": epic_id, "agent": agent, "result": "success"})
    return {"result": "success"}


def run_child_adu(adu_id: str, mode: str, project_id: str, repo_root: str) -> dict:
    """Run a child ADU step via hermes_agent_orchestrator.py."""
    orchestrator = str(ROOT / "scripts" / "hermes_agent_orchestrator.py")
    cmd = [
        sys.executable, orchestrator,
        "--adu", adu_id,
        "--mode", mode,
        "--project", project_id,
        "--repo-root", repo_root,
    ]
    broadcast_event("child_adu_started", {"aduId": adu_id, "mode": mode})
    proc = subprocess.run(cmd, cwd=repo_root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        broadcast_event("child_adu_failed", {
            "aduId": adu_id, "returncode": proc.returncode, "stderr": proc.stderr[:500]
        })
        return {"result": "failed"}
    # Forward NDJSON lines from child orchestrator
    for line in proc.stdout.strip().splitlines():
        if line.strip():
            print(line, flush=True)
    broadcast_event("child_adu_completed", {"aduId": adu_id})
    return {"result": "success"}


def materialize_child_adus(epic: dict, repo_root: str) -> dict:
    """Read split-plan.json and create real ADU records for each child ADU."""
    split_path = Path(repo_root) / ".ai-agent" / "epics" / epic["id"] / "split-plan.json"
    if not split_path.exists():
        return {"result": "failed", "error": f"split-plan.json not found: {split_path}"}

    split_plan = load_json(split_path)
    child_defs = split_plan.get("child_adus", [])
    deps = split_plan.get("dependencies", [])
    decision = split_plan.get("decision", "split_required")

    adu_data = load_json(REGISTRY / "adu.json") if (REGISTRY / "adu.json").exists() else {"adus": []}

    # Validate all child ADU definitions before creating any
    all_errors = []
    for i, child_def in enumerate(child_defs):
        errors = validate_child_adu_def(child_def, i, epic["id"])
        all_errors.extend(errors)
    if all_errors:
        error_msg = "; ".join(all_errors[:5])
        broadcast_event("epic_validation_failed", {
            "epicId": epic["id"], "validator": "child_adu_path_safety",
            "errors": all_errors
        })
        return {"result": "failed", "error": f"Child ADU validation failed: {error_msg}"}

    created_ids = []
    for i, child_def in enumerate(child_defs):
        child_id = child_def.get("id")
        if not child_id:
            continue

        # Check if already exists
        existing = next((a for a in adu_data["adus"] if a["id"] == child_id), None)
        if existing:
            created_ids.append(child_id)
            continue

        now = dt.datetime.now(dt.timezone.utc).isoformat()
        # Use validated paths (normalize_repo_relative_path may have fixed them)
        safe_write_paths = [normalize_repo_relative_path(p) for p in child_def.get("allowed_write_paths", [])]
        safe_write_paths = [p for p in safe_write_paths if p is not None]
        safe_write_paths.extend([
            ".ai-agent/analysis/", ".ai-agent/designs/", ".ai-agent/contracts/",
            ".ai-agent/reviews/", ".ai-agent/acceptance/", ".ai-agent/evidence/",
            ".ai-agent/runs/",
        ])

        child_adu = {
            "id": child_id,
            "project_id": epic.get("project_id"),
            "project_name": epic.get("project_name"),
            "repo_path": repo_root,
            "artifact_root": ".ai-agent",
            "profile_path": ".agent-factory/project-profile.json",
            "knowledge_dir": ".agent-factory/knowledge",
            "title": child_def.get("title", f"Child ADU {i+1}"),
            "goal": child_def.get("goal", ""),
            "state": "created",
            "retry_count": 0,
            "max_retries": 3,
            "risk": epic.get("risk", "medium"),
            "target_level": epic.get("target_level", "mvp"),
            "allowed_read_paths": list(set(
                [".agent-factory/project-profile.json", ".agent-factory/knowledge/", ".ai-agent/"] +
                safe_write_paths  # write paths must also be readable
            )),
            "allowed_write_paths": safe_write_paths,
            "required_commands": child_def.get("required_commands", []),
            "required_evidence": [f".ai-agent/evidence/{child_id}.md"],
            "artifacts": [],
            "human_gate_required": True,
            "language": epic.get("language", "zh"),
            "parent_epic_id": epic["id"],
            "depends_on": [d["from"] for d in deps if d.get("to") == child_id],
            "scope": child_def.get("scope", ""),
            "integration_role": child_def.get("integration_role", ""),
            "epic_sequence": i + 1,
            "review_policy": {
                "analysis_review_required": True,
                "design_review_required": True,
            },
            "command_policy": {
                "mode": "allowlist",
                "allowed_commands": child_def.get("required_commands", []),
                "blocked_command_patterns": [
                    "rm -rf", "sudo ", "curl ", "wget ", "ssh ", "scp ", "rsync ",
                    "chmod -R 777", "> /dev/", "dd ", "mkfs", "launchctl",
                    "security ", "git push", "git clean", "git reset --hard",
                ],
            },
            "review_counters": {"code_review_failures": 0, "acceptance_review_failures": 0},
            "review_limits": {"max_code_review_failures": 5, "max_acceptance_review_failures": 5},
            "created_at": now,
            "updated_at": now,
        }
        adu_data["adus"].append(child_adu)
        created_ids.append(child_id)
        broadcast_event("child_adu_created", {"epicId": epic["id"], "aduId": child_id})

    save_json(REGISTRY / "adu.json", adu_data)

    # Update Epic
    epic["child_adus"] = list(set(epic.get("child_adus", []) + created_ids))
    epic["dependencies"] = deps
    epic["split_plan_path"] = f".ai-agent/epics/{epic['id']}/split-plan.json"
    return {"result": "success", "child_ids": created_ids}


def normalize_repo_relative_path(value: str) -> str | None:
    """Validate and normalize a repository-relative path. Aligned with ProjectAduFactory."""
    if not isinstance(value, str):
        return None
    path_value = value.strip().replace("\\", "/")
    if not path_value:
        return None
    if path_value.startswith("/") or "\0" in path_value:
        return None
    if any(part == ".." for part in path_value.split("/")):
        return None
    blocked_prefixes = (
        ".git/", ".agent-factory/", ".ai-agent/registry/", "~/",
        "/Users/", "/home/", "/etc/", "/tmp/", "/var/",
    )
    if any(path_value.startswith(prefix) or path_value.lstrip("/").startswith(prefix.lstrip("/"))
           for prefix in blocked_prefixes):
        return None
    return path_value


BLOCKED_COMMAND_FRAGMENTS = [
    "rm -rf", "sudo ", "curl ", "wget ", "ssh ", "scp ", "rsync ",
    "chmod -R 777", "> /dev/", "dd ", "mkfs", "launchctl",
    "security ", "git push", "git clean", "git reset --hard",
]


def validate_child_adu_def(child_def: dict, index: int, epic_id: str) -> list[str]:
    """Validate a child ADU definition from split-plan. Returns list of error messages."""
    errors = []
    child_id = child_def.get("id", f"[index {index}]")

    # Validate write paths
    write_paths = child_def.get("allowed_write_paths", [])
    if not isinstance(write_paths, list):
        errors.append(f"Child ADU {child_id}: allowed_write_paths must be an array")
    else:
        for j, p in enumerate(write_paths):
            normalized = normalize_repo_relative_path(p)
            if normalized is None:
                errors.append(f"Child ADU {child_id}: invalid write path at index {j}: {p}")
            elif normalized != p:
                child_def["allowed_write_paths"][j] = normalized

    # Validate commands
    commands = child_def.get("required_commands", [])
    if not isinstance(commands, list):
        errors.append(f"Child ADU {child_id}: required_commands must be an array")
    else:
        for j, cmd in enumerate(commands):
            if not isinstance(cmd, str) or not cmd.strip():
                errors.append(f"Child ADU {child_id}: empty command at index {j}")
                continue
            for blocked in BLOCKED_COMMAND_FRAGMENTS:
                if blocked in cmd:
                    errors.append(f"Child ADU {child_id}: blocked command pattern '{blocked}' in: {cmd}")
                    break

    # Validate scope and goal
    if not child_def.get("scope", "").strip():
        errors.append(f"Child ADU {child_id}: scope must not be empty")
    if not child_def.get("goal", "").strip():
        errors.append(f"Child ADU {child_id}: goal must not be empty")

    return errors


def get_runnable_child(epic: dict, repo_root: str) -> str | None:
    """Find the first runnable child ADU respecting DAG dependencies (serial MVP)."""
    adu_data = load_json(REGISTRY / "adu.json") if (REGISTRY / "adu.json").exists() else {"adus": []}
    child_ids = epic.get("child_adus", [])
    deps = epic.get("dependencies", [])

    # Build dependency map: child_id -> [depends_on_ids]
    dep_map = {}
    for dep in deps:
        to_id = dep.get("to")
        from_id = dep.get("from")
        if to_id not in dep_map:
            dep_map[to_id] = []
        dep_map[to_id].append(from_id)

    terminal_states = {"evidenced", "canceled"}

    for child_id in child_ids:
        child = next((a for a in adu_data["adus"] if a["id"] == child_id), None)
        if not child:
            continue

        # Skip terminal children
        if child.get("state") in terminal_states:
            continue

        # Skip human_gate children
        if child.get("state") == "human_gate":
            continue

        # Skip paused children
        if child.get("paused"):
            continue

        # Check dependencies are all evidenced
        required_deps = dep_map.get(child_id, [])
        all_deps_met = True
        for dep_id in required_deps:
            dep_adu = next((a for a in adu_data["adus"] if a["id"] == dep_id), None)
            if not dep_adu or dep_adu.get("state") not in terminal_states:
                all_deps_met = False
                break

        if all_deps_met:
            return child_id

    return None


def aggregate_epic_state(epic: dict) -> str:
    """Aggregate Epic state from child ADU states."""
    adu_data = load_json(REGISTRY / "adu.json") if (REGISTRY / "adu.json").exists() else {"adus": []}
    child_ids = epic.get("child_adus", [])

    if not child_ids:
        return epic.get("state", "created")

    children = [a for a in adu_data["adus"] if a["id"] in child_ids]
    if not children:
        return epic.get("state", "created")

    terminal_states = {"evidenced", "canceled"}
    running_states = {"created", "analysis_review", "analyzed", "contexted", "design_review",
                       "designed", "contracted", "test_red", "implemented", "code_reviewed",
                       "code_rework", "build_rework", "debugged", "acceptance_reviewed",
                       "acceptance_rework"}
    blocked_states = {"human_gate"}

    evidenced_count = sum(1 for c in children if c.get("state") == "evidenced")
    blocked_count = sum(1 for c in children if c.get("state") in blocked_states)
    running_count = sum(1 for c in children if c.get("state") in running_states)
    total = len(children)

    # Update summary
    epic["summary"] = {
        "total_child_adus": total,
        "evidenced_child_adus": evidenced_count,
        "blocked_child_adus": blocked_count,
        "running_child_adus": running_count,
    }

    if evidenced_count == total:
        return "child_adus_evidenced"
    if blocked_count > 0:
        return "child_adus_blocked"
    if running_count > 0 or evidenced_count < total:
        return "child_adus_running"

    return epic.get("state", "created")


def step_epic(epic: dict, project_id: str, repo_root: str) -> dict:
    """Execute one step of the Epic state machine."""
    state = epic.get("state", "created")

    # Handle split_decision: read split-plan to determine next state
    if state == "split_decision":
        split_path = Path(repo_root) / ".ai-agent" / "epics" / epic["id"] / "split-plan.json"
        if split_path.exists():
            split_plan = load_json(split_path)
            decision = split_plan.get("decision")
            if decision == "single_adu":
                epic["state"] = "single_adu_selected"
            else:
                epic["state"] = "split_required"
        else:
            return {"result": "blocked", "error": "split-plan.json not found"}
        broadcast_event("epic_state_changed", {"epicId": epic["id"], "state": epic["state"]})
        return {"result": "success", "next_state": epic["state"]}

    # Handle split_required: validate then materialize child ADUs
    if state == "split_required":
        # Validate split-plan before materializing
        split_path = Path(repo_root) / ".ai-agent" / "epics" / epic["id"] / "split-plan.json"
        val_proc = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "validate_epic_split_plan.py"), str(split_path)],
            cwd=str(ROOT), text=True, capture_output=True
        )
        if val_proc.returncode != 0:
            broadcast_event("epic_validation_failed", {
                "epicId": epic["id"], "validator": "validate_epic_split_plan",
                "stderr": (val_proc.stderr or val_proc.stdout)[:500]
            })
            epic["state"] = "human_gate"
            return {"result": "failed", "error": "split-plan validation failed", "detail": (val_proc.stderr or val_proc.stdout)[:300]}

        result = materialize_child_adus(epic, repo_root)
        if result.get("result") == "success":
            epic["state"] = "epic_planned"
            broadcast_event("epic_state_changed", {"epicId": epic["id"], "state": "epic_planned"})
            # Immediately advance to child_adus_created
            epic["state"] = "child_adus_created"
            broadcast_event("epic_state_changed", {"epicId": epic["id"], "state": "child_adus_created"})
        return result

    # Handle child scheduling states
    if state in ("single_adu_selected", "child_adus_created", "child_adus_running", "child_adus_blocked"):
        # Aggregate current state
        new_state = aggregate_epic_state(epic)
        if new_state != state:
            epic["state"] = new_state
            broadcast_event("epic_state_changed", {"epicId": epic["id"], "state": new_state})
            return {"result": "success", "next_state": new_state}

        if new_state == "child_adus_evidenced":
            return {"result": "success", "next_state": new_state}

        if new_state == "child_adus_blocked":
            return {"result": "blocked", "error": "Child ADUs are blocked"}

        # Find runnable child and execute one step
        runnable = get_runnable_child(epic, repo_root)
        if runnable:
            broadcast_event("child_adu_step", {"epicId": epic["id"], "aduId": runnable})
            child_result = run_child_adu(runnable, "step", project_id, repo_root)
            if child_result.get("result") == "failed":
                # Child ADU execution failed — mark Epic state directly as blocked.
                # aggregate_epic_state only returns child_adus_blocked when a child
                # is in human_gate; a failed child may remain in a running state
                # (e.g. implemented), so we must set the Epic state explicitly.
                epic["state"] = "child_adus_blocked"
                broadcast_event("epic_state_changed", {
                    "epicId": epic["id"], "aduId": runnable,
                    "state": "child_adus_blocked",
                    "action": "child_failed_blocking_epic"
                })
                return {"result": "blocked", "error": f"Child ADU {runnable} execution failed"}
            # Re-aggregate
            new_state = aggregate_epic_state(epic)
            if new_state != state:
                epic["state"] = new_state
                broadcast_event("epic_state_changed", {"epicId": epic["id"], "state": new_state})
        else:
            # No runnable child — check if all done
            new_state = aggregate_epic_state(epic)
            if new_state != state:
                epic["state"] = new_state
                broadcast_event("epic_state_changed", {"epicId": epic["id"], "state": new_state})

        return {"result": "success", "next_state": epic["state"]}

    # Handle state transitions that need an Epic-level agent
    if state in EPIC_STATE_NEXT:
        agent, next_state = EPIC_STATE_NEXT[state]
        if agent:
            result = run_agent(epic["id"], agent, project_id, repo_root)
            if result.get("result") == "success":
                # For split_decision state, read the split-plan result
                if next_state == "split_decision":
                    epic["state"] = next_state
                elif next_state == "epic_acceptance":
                    # Validate acceptance before trusting its status
                    acc_path = Path(repo_root) / ".ai-agent" / "epics" / epic["id"] / "epic-acceptance.json"
                    if acc_path.exists():
                        val_proc = subprocess.run(
                            [sys.executable, str(ROOT / "scripts" / "validate_epic_acceptance.py"),
                             str(acc_path), "--repo-root", repo_root],
                            cwd=str(ROOT), text=True, capture_output=True
                        )
                        if val_proc.returncode != 0:
                            broadcast_event("epic_validation_failed", {
                                "epicId": epic["id"], "validator": "validate_epic_acceptance",
                                "stderr": (val_proc.stderr or val_proc.stdout)[:500]
                            })
                            epic["state"] = "epic_failed"
                        else:
                            acc_data = load_json(acc_path)
                            if acc_data.get("epic_acceptance_status") == "pass":
                                epic["state"] = "epic_evidenced"
                            else:
                                epic["state"] = "epic_failed"
                    else:
                        epic["state"] = "epic_failed"
                        broadcast_event("epic_state_changed", {"epicId": epic["id"], "state": "epic_failed"})
                        return {"result": "failed", "error": "epic-acceptance-reviewer ran but epic-acceptance.json is missing"}
                else:
                    epic["state"] = next_state
            else:
                return result
        elif next_state and next_state != state:
            epic["state"] = next_state
        broadcast_event("epic_state_changed", {"epicId": epic["id"], "state": epic["state"]})
        return {"result": "success", "next_state": epic["state"]}

    return {"result": "completed", "next_state": epic["state"]}


def main():
    parser = argparse.ArgumentParser(description="Hermes Epic Orchestrator")
    parser.add_argument("--epic", required=True, help="Epic ID")
    parser.add_argument("--mode", required=True, choices=["step", "start", "continue", "pause", "cancel"],
                        help="Execution mode")
    parser.add_argument("--project", required=True, help="Project ID")
    parser.add_argument("--repo-root", required=True, help="Target repo root path")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    if not repo_root.is_dir():
        raise SystemExit(f"Repo root does not exist: {repo_root}")

    # Load Epic
    epics_data = load_json(REGISTRY / "epics.json") if (REGISTRY / "epics.json").exists() else {"epics": []}
    epic = next((e for e in epics_data.get("epics", []) if e["id"] == args.epic), None)
    if not epic:
        raise SystemExit(f"Epic not found: {args.epic}")

    broadcast_event("epic_orchestrator_started", {
        "epicId": args.epic, "mode": args.mode, "state": epic.get("state")
    })

    try:
        if args.mode == "start":
            # Reset Epic to created and run one step (system-flow-designer)
            if epic.get("state") != "created":
                epic["state"] = "created"
            result = step_epic(epic, args.project, str(repo_root))
            broadcast_event("epic_orchestrator_completed", {
                "epicId": args.epic, "mode": args.mode, "result": result
            })

        elif args.mode == "step":
            result = step_epic(epic, args.project, str(repo_root))
            broadcast_event("epic_orchestrator_completed", {
                "epicId": args.epic, "mode": args.mode, "result": result
            })

        elif args.mode == "continue":
            max_steps = 50  # Safety limit
            for _ in range(max_steps):
                state = epic.get("state", "created")
                if state in ("epic_evidenced", "epic_failed", "human_gate", "canceled"):
                    break
                result = step_epic(epic, args.project, str(repo_root))
                if result.get("result") in ("blocked", "failed"):
                    break
            broadcast_event("epic_orchestrator_completed", {
                "epicId": args.epic, "mode": args.mode, "final_state": epic.get("state")
            })

        elif args.mode == "pause":
            # Pause all non-terminal child ADUs and set Epic to child_adus_blocked
            adu_data = load_json(REGISTRY / "adu.json") if (REGISTRY / "adu.json").exists() else {"adus": []}
            terminal = {"evidenced", "canceled"}
            for adu in adu_data.get("adus", []):
                if adu.get("parent_epic_id") == args.epic and adu.get("state") not in terminal:
                    adu["paused"] = True
            save_json(REGISTRY / "adu.json", adu_data)
            epic["state"] = "child_adus_blocked"
            broadcast_event("epic_state_changed", {"epicId": args.epic, "state": "child_adus_blocked"})
            broadcast_event("epic_orchestrator_completed", {
                "epicId": args.epic, "mode": "pause", "state": "child_adus_blocked"
            })

        elif args.mode == "cancel":
            # Cancel all non-terminal child ADUs, then cancel the Epic
            adu_data = load_json(REGISTRY / "adu.json") if (REGISTRY / "adu.json").exists() else {"adus": []}
            for adu in adu_data.get("adus", []):
                if adu.get("parent_epic_id") == args.epic:
                    adu["state"] = "canceled"
                    adu["paused"] = False
            save_json(REGISTRY / "adu.json", adu_data)
            epic["state"] = "canceled"
            broadcast_event("epic_state_changed", {"epicId": args.epic, "state": "canceled"})
            broadcast_event("epic_orchestrator_completed", {
                "epicId": args.epic, "mode": "cancel", "state": "canceled"
            })

    finally:
        # Persist Epic state
        for i, e in enumerate(epics_data.get("epics", [])):
            if e["id"] == args.epic:
                epic["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
                epics_data["epics"][i] = epic
                break
        else:
            epics_data.setdefault("epics", []).append(epic)
        save_json(REGISTRY / "epics.json", epics_data)
        broadcast_event("epic_orchestrator_saved", {"epicId": args.epic, "state": epic.get("state")})


if __name__ == "__main__":
    main()

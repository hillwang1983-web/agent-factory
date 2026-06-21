#!/usr/bin/env python3
"""Hermes Agent Orchestrator

Implements start / continue / pause / cancel operations for an ADU.
It reads the ADU state from `.ai-agent/registry/adu.json`, determines the next
agent based on the state machine, invokes `scripts/hermes_agent_run.py`
with the appropriate model overrides, enforces token budget using correct
key names (warnAtRatio, inputTokenLimit, outputTokenLimit), and broadcasts
events via NDJSON stdout.

IMPORTANT:
  - This script does NOT write to runs.json. hermes_agent_run.py owns that.
  - If the runner returns rc != 0 the state is NOT advanced.
"""

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))
from registry_lock import registry_lock, save_json_direct

# Project root (assumes this script lives under <repo>/scripts)
ROOT = Path(__file__).resolve().parents[1]

# Module-level lock owner token, set during acquire_lock
_LOCK_OWNER_TOKEN = None

# Dynamic registry path resolution supporting physical isolation in test environments
registry_dir_env = os.environ.get("AGENT_FACTORY_REGISTRY_DIR")
if registry_dir_env:
    REGISTRY = Path(registry_dir_env).resolve()
else:
    projects_registry_env = os.environ.get("AGENT_FACTORY_PROJECTS_REGISTRY")
    if projects_registry_env:
        REGISTRY = Path(projects_registry_env).parent.resolve()
    else:
        REGISTRY = ROOT / ".ai-agent" / "registry"

# Simple state machine mapping current state -> (next agent, next state)
STATE_NEXT = {
    "created": ("requirement-analyst", "analysis_review"),
    "analysis_review": (None, "analysis_review"),
    "analyzed": ("context-pack", "contexted"),
    "contexted": ("detail-designer", "design_review"),
    "design_review": (None, "design_review"),
    "designed": ("contract", "contracted"),
    "contracted": ("testwriter", "test_red"),
    "test_red": ("developer", "implemented"),
    "code_rework": ("rework-planner", "rework_planned"),
    "build_rework": ("rework-planner", "rework_planned"),
    "acceptance_rework": ("rework-planner", "rework_planned"),
    "rework_planned": ("developer", "implemented"),
    "implemented": ("code-reviewer", "code_reviewed"),
    "code_reviewed": ("buildfix-debugger", "debugged"),
    "debugged": ("acceptance-reviewer", "acceptance_reviewed"),
    "acceptance_reviewed": ("evidence", "evidenced"),
    "evidenced": (None, "evidenced"),
    "human_gate": (None, "human_gate"),
    "paused": (None, "paused"),
    "canceled": (None, "canceled"),
}


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)



def broadcast_event(event_type: str, payload: dict):
    """Send a simple JSON line to stdout (NDJSON) for the backend to capture."""
    msg = json.dumps({"type": event_type, "payload": payload})
    print(msg, flush=True)

def ensure_adu_fields(adu):
    if not adu:
        return
    if "review_counters" not in adu or not isinstance(adu["review_counters"], dict):
        adu["review_counters"] = {
            "code_review_failures": 0,
            "buildfix_failures": 0,
            "acceptance_review_failures": 0
        }
    else:
        if "code_review_failures" not in adu["review_counters"]:
            adu["review_counters"]["code_review_failures"] = 0
        if "buildfix_failures" not in adu["review_counters"]:
            adu["review_counters"]["buildfix_failures"] = 0
        if "acceptance_review_failures" not in adu["review_counters"]:
            adu["review_counters"]["acceptance_review_failures"] = 0

    if "review_limits" not in adu or not isinstance(adu["review_limits"], dict):
        adu["review_limits"] = {
            "max_code_review_failures": 5,
            "max_buildfix_failures": 5,
            "max_acceptance_review_failures": 5
        }
    else:
        if "max_code_review_failures" not in adu["review_limits"]:
            adu["review_limits"]["max_code_review_failures"] = 5
        elif adu["review_limits"]["max_code_review_failures"] < 5:
            adu["review_limits"]["max_code_review_failures"] = 5
        if "max_buildfix_failures" not in adu["review_limits"]:
            adu["review_limits"]["max_buildfix_failures"] = 5
        elif adu["review_limits"]["max_buildfix_failures"] < 5:
            adu["review_limits"]["max_buildfix_failures"] = 5
        if "max_acceptance_review_failures" not in adu["review_limits"]:
            adu["review_limits"]["max_acceptance_review_failures"] = 5
        elif adu["review_limits"]["max_acceptance_review_failures"] < 5:
            adu["review_limits"]["max_acceptance_review_failures"] = 5

def check_token_budget(agent_id: str, input_tokens: int, output_tokens: int):
    """Check token budget using correct key names from token-budget.json:
    - warnAtRatio (default 0.8)
    - inputTokenLimit / outputTokenLimit
    - hardStop (boolean, default false)
    """
    budget_path = REGISTRY / "token-budget.json"
    if not budget_path.exists():
        return {"status": "ok"}
    budget = load_json(budget_path)
    # Look up agent-specific config, fallback to default
    agent_cfg = budget.get("agents", {}).get(agent_id, budget.get("default", {}))
    warn_at_ratio = agent_cfg.get("warnAtRatio", 0.8)
    hard_stop = agent_cfg.get("hardStop", False)
    input_limit = agent_cfg.get("inputTokenLimit", 0)
    output_limit = agent_cfg.get("outputTokenLimit", 0)

    status = "ok"
    max_ratio = 0.0

    if input_limit > 0:
        ratio = input_tokens / input_limit
        if ratio > max_ratio:
            max_ratio = ratio
    if output_limit > 0:
        ratio = output_tokens / output_limit
        if ratio > max_ratio:
            max_ratio = ratio

    if hard_stop and ((input_limit > 0 and input_tokens >= input_limit) or (output_limit > 0 and output_tokens >= output_limit)):
        return {"status": "hardStop", "ratio": max_ratio}
    if (input_limit > 0 and input_tokens >= input_limit * warn_at_ratio) or (output_limit > 0 and output_tokens >= output_limit * warn_at_ratio):
        return {"status": "warning", "ratio": max_ratio}
    return {"status": "ok", "ratio": max_ratio}

def _lock_dir(project_id: str, repo_root: str = None) -> Path:
    # Project-aware ADUs store locks in their own repo's .ai-agent/locks/ for isolation.
    # Non-project ADUs fall back to the global workspace root.
    if repo_root:
        return Path(repo_root) / ".ai-agent" / "locks"
    return ROOT / ".ai-agent" / "locks"


def acquire_lock(adu_id: str, mode: str, project_id: str = "default-open5gs", repo_root: str = None):
    lock_dir = _lock_dir(project_id, repo_root)
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_file = lock_dir / f"{project_id}__{adu_id}.lock"

    now = time.time()
    if lock_file.exists():
        try:
            lock_data = json.loads(lock_file.read_text(encoding="utf-8"))
            heartbeat = lock_data.get("heartbeat_at")
            pid = lock_data.get("pid")
            hb_time = None
            if isinstance(heartbeat, (int, float)):
                hb_time = heartbeat
            elif isinstance(heartbeat, str):
                try:
                    s = heartbeat.replace("Z", "+00:00")
                    hb_time = dt.datetime.fromisoformat(s).timestamp()
                except Exception:
                    hb_time = now - 2000

            # PID alive check via os.kill(pid, 0)
            pid_alive = True
            if pid:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    pid_alive = False

            # PID alive → ALWAYS refuse to acquire, regardless of heartbeat freshness.
            # A live process with stale heartbeat is still running, not dead.
            # Only reclaim locks from dead PIDs.
            if pid_alive:
                print(json.dumps({
                    "type": "agent_factory_orchestrator_event",
                    "payload": {
                        "event": "already_running",
                        "adu_id": adu_id,
                        "message": f"ADU {adu_id} is already being processed by PID {lock_data.get('pid')}"
                    }
                }), flush=True)
                sys.exit(1)
        except Exception:
            pass

    # Use a unique owner token for safe release
    import uuid
    owner_token = os.environ.get("AGENT_FACTORY_OWNER_TOKEN") or str(uuid.uuid4())

    lock_data = {
        "adu_id": adu_id,
        "project_id": project_id,
        "mode": mode,
        "pid": os.getpid(),
        "owner_token": owner_token,
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "heartbeat_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    lock_file.write_text(json.dumps(lock_data, indent=2), encoding="utf-8")
    global _LOCK_OWNER_TOKEN
    _LOCK_OWNER_TOKEN = owner_token


def update_lock_heartbeat(adu_id: str, mode: str, project_id: str = "default-open5gs", repo_root: str = None):
    lock_file = _lock_dir(project_id, repo_root) / f"{project_id}__{adu_id}.lock"
    if lock_file.exists():
        try:
            lock_data = json.loads(lock_file.read_text(encoding="utf-8"))
            lock_data["heartbeat_at"] = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
            lock_file.write_text(json.dumps(lock_data, indent=2), encoding="utf-8")
        except Exception:
            pass


def release_lock(adu_id: str, project_id: str = "default-open5gs", repo_root: str = None, owner_token: str = None):
    lock_file = _lock_dir(project_id, repo_root) / f"{project_id}__{adu_id}.lock"
    if lock_file.exists():
        try:
            if owner_token:
                lock_data = json.loads(lock_file.read_text(encoding="utf-8"))
                # Only delete if we own the lock (or lock has no owner_token — legacy)
                existing_token = lock_data.get("owner_token")
                if existing_token and existing_token != owner_token:
                    return  # Not our lock, don't delete
            lock_file.unlink()
        except Exception:
            pass

def run_agent(adu_id: str, agent_name: str, project_id: str, repo_path: str):
    cmd = [
        "python3",
        str(ROOT / "scripts" / "hermes_agent_run.py"),
        "--adu", adu_id,
        "--agent", agent_name,
        "--project", project_id,
        "--repo", repo_path
    ]
    proc = subprocess.run(cmd, cwd=str(ROOT), text=True, capture_output=True)
    return proc.returncode, proc.stdout, proc.stderr

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--adu", required=True, help="ADU identifier")
    parser.add_argument("--mode", choices=["start", "continue", "pause", "cancel", "step"], required=True)
    parser.add_argument("--project", required=False, help="Project ID")
    parser.add_argument("--repo-root", required=False, help="Repository root path")
    parser.add_argument("--operation-id", required=False, help="Orchestration operation identifier")
    args = parser.parse_args()

    adu_path = REGISTRY / "adu.json"
    adu_data = load_json(adu_path)

    # Find the ADU record
    adu = None
    for item in adu_data.get("adus", []):
        if item.get("id") == args.adu:
            adu = item
            break
    if not adu:
        print(f"ADU {args.adu} not found", file=sys.stderr)
        sys.exit(1)
    ensure_adu_fields(adu)

    # Strict project check
    if adu.get("project_id"):
        if not args.project or not args.repo_root:
            print(f"ADU {args.adu} is bound to a project. --project and --repo-root are required.", file=sys.stderr)
            sys.exit(1)
        if args.project != adu["project_id"]:
            print(f"Project ID mismatch: arg={args.project}, adu={adu['project_id']}", file=sys.stderr)
            sys.exit(1)
        if adu.get("repo_path") and args.repo_root != adu["repo_path"]:
            print(f"Repo root mismatch: arg={args.repo_root}, adu={adu['repo_path']}", file=sys.stderr)
            sys.exit(1)

        # Project must be in 'profiled' status before running any ADU steps
        projects_path = REGISTRY / "projects.json"
        if projects_path.exists():
            try:
                projects_data = load_json(projects_path)
                project_rec = next(
                    (p for p in projects_data.get("projects", []) if p.get("project_id") == args.project),
                    None,
                )
                if project_rec and project_rec.get("status") not in ("profiled",):
                    print(
                        f"Project {args.project} is not ready "
                        f"(status={project_rec.get('status')}). "
                        f"Only 'profiled' projects can run ADUs.",
                        file=sys.stderr,
                    )
                    sys.exit(1)
            except Exception:
                pass  # Registry absent or malformed — skip status check

    project_id = args.project if args.project else adu.get("project_id", "default-open5gs")

    repo_path = args.repo_root
    if not repo_path:
        projects_path = REGISTRY / "projects.json"
        repo_path = str(ROOT)
        if projects_path.exists():
            try:
                projects_data = load_json(projects_path)
                for p in projects_data.get("projects", []):
                    if p.get("project_id") == project_id:
                        repo_path = p.get("repo_path", str(ROOT))
                        break
            except Exception:
                pass

    if args.mode in ("start", "continue", "step"):
        acquire_lock(args.adu, args.mode, project_id, repo_root=repo_path)

    try:
        if args.mode == "pause":
            with registry_lock(REGISTRY):
                adu_data = load_json(adu_path)
                adu = next((item for item in adu_data.get("adus", []) if item.get("id") == args.adu), None)
                if adu:
                    adu["paused"] = True
                    save_json_direct(adu_path, adu_data)
            broadcast_event("agent_factory_orchestrator_event", {"adu": args.adu, "action": "paused"})
            sys.exit(0)

        if args.mode == "cancel":
            with registry_lock(REGISTRY):
                adu_data = load_json(adu_path)
                adu = next((item for item in adu_data.get("adus", []) if item.get("id") == args.adu), None)
                if adu:
                    adu["state"] = "canceled"
                    save_json_direct(adu_path, adu_data)
            broadcast_event("agent_factory_orchestrator_event", {"adu": args.adu, "action": "canceled"})
            sys.exit(0)

        if args.mode == "start":
            with registry_lock(REGISTRY):
                adu_data = load_json(adu_path)
                adu = next((item for item in adu_data.get("adus", []) if item.get("id") == args.adu), None)
                if not adu:
                    print(f"ADU {args.adu} not found", file=sys.stderr)
                    sys.exit(1)
                ensure_adu_fields(adu)
                adu["state"] = "created"
                adu["paused"] = False
                adu["human_gate_required"] = False
                adu["retry_count"] = 0
                if "review_counters" in adu:
                    adu["review_counters"]["code_review_failures"] = 0
                    adu["review_counters"]["buildfix_failures"] = 0
                    adu["review_counters"]["acceptance_review_failures"] = 0
                save_json_direct(adu_path, adu_data)
            broadcast_event("agent_factory_orchestrator_event", {"adu": args.adu, "action": "started", "state": "created"})

        if args.mode == "continue":
            with registry_lock(REGISTRY):
                adu_data = load_json(adu_path)
                adu = next((item for item in adu_data.get("adus", []) if item.get("id") == args.adu), None)
                if not adu:
                    print(f"ADU {args.adu} not found", file=sys.stderr)
                    sys.exit(1)
                ensure_adu_fields(adu)
                adu["paused"] = False
                if adu.get("state") == "human_gate":
                    adu["human_gate_required"] = False
                    adu["retry_count"] = 0
                    pre_gate = adu.pop("pre_gate_state", None)
                    if pre_gate and pre_gate not in ("human_gate", "evidenced", "canceled"):
                        adu["state"] = pre_gate
                    if "review_counters" in adu:
                        adu["review_counters"]["code_review_failures"] = 0
                        adu["review_counters"]["buildfix_failures"] = 0
                        adu["review_counters"]["acceptance_review_failures"] = 0
                save_json_direct(adu_path, adu_data)
            broadcast_event("agent_factory_orchestrator_event", {"adu": args.adu, "action": "continued"})

        if args.mode == "step":
            with registry_lock(REGISTRY):
                adu_data = load_json(adu_path)
                adu = next((item for item in adu_data.get("adus", []) if item.get("id") == args.adu), None)
                if not adu:
                    print(f"ADU {args.adu} not found", file=sys.stderr)
                    sys.exit(1)
                ensure_adu_fields(adu)
                if adu.get("state") == "human_gate":
                    adu["human_gate_required"] = False
                    adu["retry_count"] = 0
                    pre_gate = adu.pop("pre_gate_state", None)
                    if pre_gate and pre_gate not in ("human_gate", "evidenced", "canceled"):
                        adu["state"] = pre_gate
                    if "review_counters" in adu:
                        adu["review_counters"]["code_review_failures"] = 0
                        adu["review_counters"]["buildfix_failures"] = 0
                        adu["review_counters"]["acceptance_review_failures"] = 0
                save_json_direct(adu_path, adu_data)

        # For start / continue / step we advance the state machine until done
        had_failure = False
        while True:
            next_agent = None
            next_state = None
            current_state = None

            # --- RMW Phase 1: Check state, review gates, budget under lock ---
            with registry_lock(REGISTRY):
                adu_data = load_json(adu_path)
                adu = next((item for item in adu_data.get("adus", []) if item.get("id") == args.adu), None)
                if not adu:
                    break
                ensure_adu_fields(adu)

                if adu.get("paused") or adu.get("state") == "paused":
                    broadcast_event("agent_factory_orchestrator_event", {"adu": args.adu, "action": "paused"})
                    break
                if adu.get("state") == "canceled":
                    broadcast_event("agent_factory_orchestrator_event", {"adu": args.adu, "action": "canceled"})
                    break

                current_state = adu.get("state", "created")

                # Review gate blocking logic
                if current_state in ("analysis_review", "design_review"):
                    gate = "analysis" if current_state == "analysis_review" else "design"

                    # Honor review_policy: if the gate is disabled, auto-advance to next state
                    review_policy = adu.get("review_policy", {})
                    gate_required = review_policy.get(f"{gate}_review_required", True)
                    if not gate_required:
                        to_state = "analyzed" if gate == "analysis" else "designed"
                        adu["state"] = to_state
                        adu["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
                        save_json_direct(adu_path, adu_data)
                        broadcast_event("agent_factory_orchestrator_event", {
                            "adu": args.adu,
                            "state": to_state,
                            "action": "auto_advanced",
                            "reason": f"{gate}_review_required=false in review_policy",
                        })
                        continue  # Next iteration: process the new state

                    art_path = f".ai-agent/analysis/{args.adu}.md" if gate == "analysis" else f".ai-agent/designs/{args.adu}-detailed-design.md"

                    # Check and insert pending review record
                    reviews_path = REGISTRY / "reviews.json"
                    reviews_wrapper = {"version": 1, "reviews": []}
                    if reviews_path.exists():
                        try:
                            reviews_wrapper = load_json(reviews_path)
                            if not isinstance(reviews_wrapper, dict) or "reviews" not in reviews_wrapper:
                                reviews_wrapper = {"version": 1, "reviews": []}
                        except Exception:
                            reviews_wrapper = {"version": 1, "reviews": []}

                    reviews_list = reviews_wrapper.get("reviews", [])
                    if not isinstance(reviews_list, list):
                        reviews_list = []
                        reviews_wrapper["reviews"] = reviews_list

                    # check if there is already a pending review for this adu and gate
                    has_pending = False
                    for r in reviews_list:
                        if isinstance(r, dict) and r.get("adu_id") == args.adu and r.get("gate") == gate and r.get("status") == "pending":
                            has_pending = True
                            break

                    if not has_pending:
                        now_str = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
                        new_review = {
                            "review_id": f"review-{args.adu}-{gate}-{int(time.time() * 1000)}",
                            "adu_id": args.adu,
                            "gate": gate,
                            "state": current_state,
                            "status": "pending",
                            "artifact_paths": [art_path],
                            "created_at": now_str,
                            "updated_at": now_str,
                            "approved_at": None,
                            "approved_by": None,
                            "comment": None,
                            "approved_hashes": {}
                        }
                        reviews_list.append(new_review)
                        try:
                            save_json_direct(reviews_path, reviews_wrapper)
                        except Exception as e:
                            print(f"Failed to save pending review: {e}", file=sys.stderr)

                    broadcast_event("agent_factory_orchestrator_event", {
                        "event": "review_required",
                        "adu_id": args.adu,
                        "state": current_state,
                        "gate": gate,
                        "artifact_paths": [art_path]
                    })
                    break

                if current_state not in STATE_NEXT:
                    # No further steps
                    broadcast_event("agent_factory_orchestrator_event", {"adu": args.adu, "state": current_state, "action": "completed"})
                    break
                next_agent, next_state = STATE_NEXT[current_state]
                if not next_agent:
                    broadcast_event("agent_factory_orchestrator_event", {"adu": args.adu, "state": current_state, "action": "completed"})
                    break

                # Check Token Budget before running agent
                budget_ok = True
                try:
                    budget_cmd = [
                        sys.executable,
                        str(ROOT / "scripts" / "context_budget.py"),
                        "--agent", next_agent,
                        "--adu", args.adu,
                        "--repo-root", repo_path,
                        "--registry-dir", str(REGISTRY),
                        "--mode", "check"
                    ]
                    budget_proc = subprocess.run(budget_cmd, cwd=str(ROOT), capture_output=True, text=True)
                    if budget_proc.returncode == 2:
                        budget_ok = False
                        adu["state"] = "human_gate"
                        adu["human_gate_required"] = True
                        adu["gate_type"] = "token_budget_approval"
                        adu["pre_gate_state"] = current_state
                        save_json_direct(adu_path, adu_data)

                        gates_path = REGISTRY / "human-gates.json"
                        gates_data = {"version": 1, "gates": []}
                        if gates_path.exists():
                            try:
                                gates_data = load_json(gates_path)
                            except Exception:
                                pass

                        gate_id = f"gate-{args.adu}-token_budget_approval-{int(time.time() * 1000)}"
                        new_gate = {
                            "gate_id": gate_id,
                            "scope": "adu",
                            "target_id": args.adu,
                            "epic_id": adu.get("epic_id"),
                            "project_id": project_id,
                            "gate_type": "token_budget_approval",
                            "status": "pending",
                            "title": "Token Budget Hard Stop Blocked",
                            "reason": f"Estimated context size exceeds the hard budget limit for agent '{next_agent}'.",
                            "source_agent": next_agent,
                            "pre_gate_state": current_state,
                            "available_actions": ["approve", "cancel"],
                            "created_at": dt.datetime.now(dt.timezone.utc).isoformat()
                        }
                        existing_gates = gates_data.get("gates", [])
                        existing_gates = [g for g in existing_gates if not (g.get("target_id") == args.adu and g.get("gate_type") == "token_budget_approval" and g.get("status") == "pending")]
                        existing_gates.append(new_gate)
                        gates_data["gates"] = existing_gates
                        save_json_direct(gates_path, gates_data)

                        broadcast_event("agent_factory_orchestrator_event", {
                            "adu": args.adu,
                            "action": "paused_at_gate",
                            "gate_type": "token_budget_approval",
                            "message": "Token budget hard stop triggered. Human approval required."
                        })
                        print(json.dumps({
                            "event": "human_gate_opened",
                            "gate_type": "token_budget_approval",
                            "gate_id": gate_id,
                            "message": "Token budget hard stop triggered. Human approval required."
                        }))
                        break
                    elif budget_proc.returncode == 0:
                        try:
                            b_data = json.loads(budget_proc.stdout)
                            if b_data.get("budget_status") == "warning":
                                print(json.dumps({
                                    "event": "token_budget_warning",
                                    "message": f"Estimated input tokens ({b_data.get('estimated_input_tokens')}) exceeds warning threshold."
                                }))
                        except Exception:
                            pass
                except Exception as e:
                    print(f"WARNING: failed to run token budget check: {e}", file=sys.stderr)

            # Broadcast starting event
            broadcast_event("agent_factory_orchestrator_event", {
                "event": "agent_started",
                "adu_id": args.adu,
                "agent_id": next_agent,
                "state": current_state,
                "operation_id": args.operation_id,
            })

            # Run the agent
            update_lock_heartbeat(args.adu, args.mode, project_id, repo_root=repo_path)
            rc, out, err = run_agent(args.adu, next_agent, project_id, repo_path)
            update_lock_heartbeat(args.adu, args.mode, project_id, repo_root=repo_path)

            # --- RMW Phase 2: Handle agent run outcome under lock ---
            should_break = False
            with registry_lock(REGISTRY):
                adu_data = load_json(adu_path)
                adu = next((item for item in adu_data.get("adus", []) if item.get("id") == args.adu), None)
                if not adu:
                    break
                ensure_adu_fields(adu)

                if adu.get("paused") or adu.get("state") == "paused":
                    broadcast_event("agent_factory_orchestrator_event", {"adu": args.adu, "action": "paused"})
                    break
                if adu.get("state") == "canceled":
                    broadcast_event("agent_factory_orchestrator_event", {"adu": args.adu, "action": "canceled"})
                    break

                # Parse runner output and verify success
                run_success = False
                input_tokens = 0
                output_tokens = 0
                result_json = None
                try:
                    result_json = json.loads(out)
                    if rc == 0 and result_json.get("result") == "success":
                        run_success = True
                    token_usage = result_json.get("token_usage", {})
                    input_tokens = token_usage.get("inputTokens", 0)
                    output_tokens = token_usage.get("outputTokens", 0)
                except Exception:
                    pass

                if adu.get("state") == "human_gate" or rc == 20 or (result_json and result_json.get("result") == "human_gate"):
                    # Force state in memory and update files if needed
                    adu["state"] = "human_gate"
                    adu["human_gate_required"] = True
                    parsed_result = result_json.get("parsed_result", {}) if result_json else {}
                    gate_type = None
                    if result_json:
                        gate_type = result_json.get("gate_type") or parsed_result.get("gate_type")
                    if gate_type:
                        adu["gate_type"] = gate_type
                    elif rc == 20:
                        adu["gate_type"] = "write_path_expansion"

                    # Save to adu.json to ensure persistence
                    save_json_direct(adu_path, adu_data)

                    action_str = "paused_at_gate"
                    if adu.get("gate_type") == "write_path_expansion":
                        action_str = "paused_at_write_path_gate"
                    elif adu.get("gate_type") == "environment_verification_required":
                        action_str = "paused_at_environment_verification_gate"

                    broadcast_event("agent_factory_orchestrator_event", {
                        "adu": args.adu,
                        "agent": next_agent,
                        "state": "human_gate",
                        "action": action_str,
                    })
                    should_break = True

                if not should_break:
                    if not run_success:
                        error_msg = "Unstructured agent output"
                        if result_json and isinstance(result_json, dict):
                            parsed = result_json.get("parsed_result")
                            if parsed and isinstance(parsed, dict) and parsed.get("error"):
                                error_msg = parsed.get("error")
                        elif err:
                            error_msg = err[:500]

                        broadcast_event("agent_factory_orchestrator_event", {
                            "event": "agent_failed",
                            "adu_id": args.adu,
                            "agent_id": next_agent,
                            "state": current_state,
                            "result": "failed",
                            "returncode": rc,
                            "stderr": error_msg,
                            "operation_id": args.operation_id,
                        })
                        had_failure = True
                        should_break = True

                if not should_break:
                    # Token budget enforcement using correct keys
                    budget_check = check_token_budget(next_agent, input_tokens, output_tokens)
                    if budget_check["status"] == "hardStop":
                        adu["pre_gate_state"] = current_state
                        adu["state"] = "human_gate"
                        adu["human_gate_required"] = True
                        save_json_direct(adu_path, adu_data)
                        broadcast_event("agent_factory_token_warning", {"adu": args.adu, "agent": next_agent, "status": "hardStop", "ratio": budget_check.get("ratio")})
                        should_break = True
                    elif budget_check["status"] == "warning":
                        broadcast_event("agent_factory_token_warning", {"adu": args.adu, "agent": next_agent, "status": "warning", "ratio": budget_check.get("ratio")})

                if not should_break:
                    # Only advance state after successful run
                    if next_agent in ("code-reviewer", "buildfix-debugger", "acceptance-reviewer"):
                        actual_state = adu.get("state")
                        if actual_state == "code_rework":
                            adu["review_counters"]["code_review_failures"] = int(adu["review_counters"].get("code_review_failures", 0)) + 1
                            if adu["review_counters"]["code_review_failures"] > adu["review_limits"].get("max_code_review_failures", 5):
                                adu["pre_gate_state"] = actual_state
                                adu["state"] = "human_gate"
                                adu["human_gate_required"] = True
                        elif actual_state == "build_rework":
                            adu["review_counters"]["buildfix_failures"] = int(adu["review_counters"].get("buildfix_failures", 0)) + 1
                            if adu["review_counters"]["buildfix_failures"] > adu["review_limits"].get("max_buildfix_failures", 5):
                                adu["pre_gate_state"] = actual_state
                                adu["state"] = "human_gate"
                                adu["human_gate_required"] = True
                        elif actual_state == "acceptance_rework":
                            adu["review_counters"]["acceptance_review_failures"] = int(adu["review_counters"].get("acceptance_review_failures", 0)) + 1
                            if adu["review_counters"]["acceptance_review_failures"] > adu["review_limits"].get("max_acceptance_review_failures", 5):
                                adu["pre_gate_state"] = actual_state
                                adu["state"] = "human_gate"
                                adu["human_gate_required"] = True
                    else:
                        adu["state"] = next_state

                    # Update adu token_summary using the unified Token Ledger.
                    try:
                        import sys as _sys
                        _sys.path.insert(0, str(ROOT / "scripts"))
                        from token_ledger import aggregate_adu_tokens
                        _runs_data = load_json(REGISTRY / "runs.json") if (REGISTRY / "runs.json").exists() else {"runs": []}
                        _budget_data = load_json(REGISTRY / "token-budget.json") if (REGISTRY / "token-budget.json").exists() else {}
                        adu["token_summary"] = aggregate_adu_tokens(
                            _runs_data.get("runs", []), args.adu, _budget_data
                        )
                    except ImportError:
                        pass
                    except Exception:
                        pass

                    save_json_direct(adu_path, adu_data)

            if should_break:
                break

            to_state = adu["state"]

            # Broadcast successful agent run completion
            broadcast_event("agent_factory_orchestrator_event", {
                "event": "agent_completed",
                "adu_id": args.adu,
                "agent_id": next_agent,
                "from_state": current_state,
                "to_state": to_state,
                "result": "success",
                "operation_id": args.operation_id,
            })

            if args.mode == "step":
                broadcast_event("agent_factory_orchestrator_event", {
                    "event": "step_completed",
                    "adu_id": args.adu,
                    "agent_id": next_agent,
                    "from_state": current_state,
                    "to_state": to_state,
                    "result": "success"
                })
                break

            broadcast_event("agent_factory_orchestrator_event", {
                "event": "state_changed",
                "adu_id": args.adu,
                "state": to_state,
            })

            # Sleep a bit to avoid tight loop
            time.sleep(0.5)
    finally:
        if args.mode in ("start", "continue", "step"):
            release_lock(args.adu, project_id, repo_root=repo_path, owner_token=_LOCK_OWNER_TOKEN)
        if had_failure:
            sys.exit(1)

if __name__ == "__main__":
    main()

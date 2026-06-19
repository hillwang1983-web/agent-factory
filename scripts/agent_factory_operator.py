#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import sys
import urllib.request
import urllib.error
import uuid
from datetime import datetime

# Resolve Workspace Root
ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKSPACE = os.environ.get("AGENT_FACTORY_WORKSPACE", str(ROOT))

def load_json(path, default):
    p = pathlib.Path(path)
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from registry_lock import registry_lock, save_json_direct, save_json

def call_api(endpoint, method="GET", payload=None):
    api_base = os.environ.get("AGENT_FACTORY_API_BASE", "http://localhost:3011").rstrip("/")
    url = f"{api_base}{endpoint}"

    headers = {"Content-Type": "application/json"}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        try:
            err_body = json.loads(err.read().decode("utf-8"))
            error_msg = err_body.get("error", str(err))
        except Exception:
            error_msg = str(err)
        print(f"API Error ({err.code}): {error_msg}", file=sys.stderr)
        sys.exit(1)
    except Exception as err:
        print(f"Failed to connect to API base {api_base}: {err}", file=sys.stderr)
        sys.exit(1)

def get_adu_next_action(adu):
    state = adu.get("state", "created")
    recommended = None
    priority = "optional"
    reason = ""
    inputs = []

    if state == "created":
        recommended = "start"
        priority = "required"
        reason = "ADU is created, start requirement analysis."
    elif state == "analysis_review":
        has_pending = any(q.get("status") == "pending" for q in adu.get("clarification_questions", []))
        if has_pending:
            recommended = "answer_clarifications"
            priority = "required"
            reason = "Clarification questions are pending."
            inputs.append({"key": "answers", "label": "Clarification Answers", "type": "text", "required": True})
        else:
            recommended = "approve_review"
            priority = "required"
            reason = "Requirement analysis completed."
            inputs.append({"key": "comment", "label": "Approval/Rework Comment", "type": "text", "required": False})
    elif state in ("analyzed", "contexted", "designed", "contracted", "implemented", "code_reviewed", "debugged", "acceptance_reviewed"):
        recommended = "step"
        priority = "recommended"
        reason = f"State {state} complete. Proceed to next agent."
    elif state in ("test_red", "code_rework", "acceptance_rework", "build_rework"):
        recommended = "step"
        priority = "recommended"
        reason = f"Rework or test red state. Proceed to developer."
    elif state == "human_gate":
        priority = "required"
        gate_type = adu.get("gate_type", "")
        if gate_type in ("write_path_approval", "write_path_expansion"):
            recommended = "approve_write_path"
            reason = "Write path expansion requires approval."
            inputs.append({"key": "request_id", "label": "Request ID", "type": "text", "required": True})
        elif gate_type == "token_budget_approval":
            recommended = "approve_review"
            reason = "Token budget exceeded."
            inputs.append({"key": "comment", "label": "Approval comment", "type": "text", "required": True})
        elif gate_type in ("environment_verification_required", "missing_runtime_evidence"):
            recommended = "submit_runtime_evidence"
            reason = "Missing runtime evidence."
            inputs.append({"key": "runtime_log", "label": "Runtime Log", "type": "markdown", "required": False})
            inputs.append({"key": "waiver_reason", "label": "Waiver Reason", "type": "text", "required": False})
    elif state == "failed":
        recommended = "request_rework"
        priority = "required"
        reason = "ADU failed quality gates."
        inputs.append({"key": "comment", "label": "Rework details", "type": "text", "required": True})

    return {
        "target": {"type": "adu", "id": adu.get("id"), "project_id": adu.get("project_id")},
        "state": state,
        "recommended_action": recommended,
        "priority": priority,
        "reason": reason,
        "blocking_reasons": ["ADU is paused."] if adu.get("paused") else [],
        "required_inputs": inputs
    }

def get_epic_next_action(epic):
    state = epic.get("state", "created")
    recommended = None
    priority = "optional"
    reason = ""

    if state == "created":
        recommended = "start"
        priority = "required"
        reason = "Epic is created. Start system-flow-designer."
    elif state in ("flow_designed", "split_decision", "single_adu_selected"):
        recommended = "continue_auto"
        priority = "recommended"
        reason = f"Flow design complete. Run adu-splitter."
    elif state in ("split_required", "epic_planned"):
        recommended = "materialize_child_adus"
        priority = "required"
        reason = "Child ADU splits planned. Materialize child ADUs."
    elif state == "child_adus_created":
        recommended = "continue_auto"
        priority = "recommended"
        reason = "Child ADUs materialized. Begin execution."
    elif state == "child_adus_blocked":
        recommended = "open_child_adu"
        priority = "required"
        reason = "One or more child ADUs are blocked."
    elif state in ("child_adus_evidenced", "epic_acceptance"):
        recommended = "continue_auto"
        priority = "recommended"
        reason = "All child ADUs completed. Run Epic acceptance reviewer."
    elif state == "acceptance_review":
        recommended = "approve_review"
        priority = "required"
        reason = "Epic level acceptance review pending human approval."

    return {
        "target": {"type": "epic", "id": epic.get("id"), "project_id": epic.get("project_id")},
        "state": state,
        "recommended_action": recommended,
        "priority": priority,
        "reason": reason,
        "blocking_reasons": [],
        "required_inputs": []
    }

def local_next(args):
    reg_dir = pathlib.Path(WORKSPACE) / ".ai-agent" / "registry"
    if args.adu:
        adus_file = reg_dir / "adu.json"
        registry = load_json(adus_file, {"adus": []})
        adu = next((a for a in registry.get("adus", []) if a.get("id") == args.adu), None)
        if not adu:
            print(f"ADU {args.adu} not found locally.", file=sys.stderr)
            sys.exit(1)
        res = get_adu_next_action(adu)
        print(json.dumps(res, indent=2, ensure_ascii=False))
    elif args.epic:
        epics_file = reg_dir / "epics.json"
        registry = load_json(epics_file, {"epics": []})
        epic = next((e for e in registry.get("epics", []) if e.get("id") == args.epic), None)
        if not epic:
            print(f"Epic {args.epic} not found locally.", file=sys.stderr)
            sys.exit(1)
        res = get_epic_next_action(epic)
        print(json.dumps(res, indent=2, ensure_ascii=False))

def local_act(args):
    reg_dir = pathlib.Path(WORKSPACE) / ".ai-agent" / "registry"
    actions_file = reg_dir / "actions.json"
    key = args.idempotency_key or f"local-key-{int(datetime.now().timestamp())}"

    # 1. RMW action entry under lock
    with registry_lock(reg_dir):
        actions_reg = load_json(actions_file, {"actions": []})
        existing = next((a for a in actions_reg.get("actions", []) if a.get("idempotency_key") == key), None)
        if existing:
            print(f"Action with key {key} already executed (idempotent local bypass).")
            return

        # Add to actions registry
        actions_reg["actions"].append({
            "id": f"ACT-{int(datetime.now().timestamp())}",
            "target": {"type": "epic" if args.epic else "adu", "id": args.epic if args.epic else args.adu},
            "action": args.action,
            "requested_by": args.requested_by,
            "idempotency_key": key,
            "created_at": datetime.now().isoformat()
        })
        save_json_direct(actions_file, actions_reg)

    # 2. Run subprocess outside lock
    if args.action in ("start", "continue_auto", "step", "materialize_child_adus"):
        import subprocess
        run_mode = "continue" if args.action == "continue_auto" else ("start" if args.action == "start" else "step")

        script = "hermes_epic_orchestrator.py" if args.epic else "hermes_agent_orchestrator.py"
        script_path = pathlib.Path(WORKSPACE) / "scripts" / script
        if not script_path.exists():
            print(f"Orchestrator script not found at {script_path}", file=sys.stderr)
            sys.exit(1)

        target_id = args.epic if args.epic else args.adu
        project_id = "default-open5gs"
        repo_root = WORKSPACE

        if args.epic:
            epics_file = reg_dir / "epics.json"
            epics_reg = load_json(epics_file, {"epics": []})
            epic = next((e for e in epics_reg.get("epics", []) if e.get("id") == target_id), None)
            if epic:
                project_id = epic.get("project_id", "default-open5gs")
        else:
            adus_file = reg_dir / "adu.json"
            adus_reg = load_json(adus_file, {"adus": []})
            adu = next((a for a in adus_reg.get("adus", []) if a.get("id") == target_id), None)
            if adu:
                project_id = adu.get("project_id", "default-open5gs")

        projects_file = reg_dir / "projects.json"
        projects_reg = load_json(projects_file, {"projects": []})
        project = next((p for p in projects_reg.get("projects", []) if p.get("project_id") == project_id), None)
        if project and project.get("repo_path"):
            repo_root = os.path.abspath(os.path.expanduser(project["repo_path"]))

        cmd = [
            "python3", str(script_path),
            "--adu" if args.adu else "--epic", target_id,
            "--mode", run_mode,
            "--project", project_id,
            "--repo-root", repo_root
        ]

        print(f"Local Execution: {' '.join(cmd)}")
        res = subprocess.run(cmd, cwd=WORKSPACE)
        if res.returncode != 0:
            sys.exit(res.returncode)
    else:
        # Non-direct actions local mockup
        print(f"Action '{args.action}' recorded locally. (Non-runner actions require active backend logic to fully execute)")

def local_handoff(args):
    reg_dir = pathlib.Path(WORKSPACE) / ".ai-agent" / "registry"
    target_id = args.epic if args.epic else args.adu
    target_type = "epic" if args.epic else "adu"

    if target_type == "adu":
        adus_file = reg_dir / "adu.json"
        registry = load_json(adus_file, {"adus": []})
        adu = next((a for a in registry.get("adus", []) if a.get("id") == target_id), None)
        if not adu:
            print(f"ADU {target_id} not found locally.", file=sys.stderr)
            sys.exit(1)
        next_act = get_adu_next_action(adu)
        summary = {
            "target": {"type": "adu", "id": target_id},
            "summary": f"ADU is in state: {adu.get('state')}. Goal: {adu.get('title')}.",
            "current_state": adu.get("state"),
            "next_action": next_act,
            "recent_events": [],
            "quality_risks": [],
            "token_summary": adu.get("token_summary", {}),
            "artifact_links": adu.get("artifacts", [])
        }
    else:
        epics_file = reg_dir / "epics.json"
        registry = load_json(epics_file, {"epics": []})
        epic = next((e for e in registry.get("epics", []) if e.get("id") == target_id), None)
        if not epic:
            print(f"Epic {target_id} not found locally.", file=sys.stderr)
            sys.exit(1)
        next_act = get_epic_next_action(epic)
        summary = {
            "target": {"type": "epic", "id": target_id},
            "summary": f"Epic is in state: {epic.get('state')}.",
            "current_state": epic.get("state"),
            "next_action": next_act,
            "recent_events": [],
            "quality_risks": [],
            "token_summary": {},
            "artifact_links": []
        }
    print(json.dumps(summary, indent=2, ensure_ascii=False))

def local_intake(args):
    reg_dir = pathlib.Path(WORKSPACE) / ".ai-agent" / "registry"
    projects_file = reg_dir / "projects.json"
    projects_reg = load_json(projects_file, {"projects": []})

    project = next((p for p in projects_reg.get("projects", []) if p.get("project_id") == args.project), None)
    if not project:
        print(f"Project {args.project} not found in local registry.", file=sys.stderr)
        sys.exit(1)

    req_file = pathlib.Path(args.requirement_file)
    if not req_file.exists():
        print(f"Requirement file not found at {args.requirement_file}", file=sys.stderr)
        sys.exit(1)

    raw_requirement = req_file.read_text(encoding="utf-8")

    # Create DRAFT ID and write raw-input.json to project intake dir
    draft_id = f"DRAFT-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8]}"
    repo_path = os.path.abspath(os.path.expanduser(project.get("repo_path")))
    intake_dir = pathlib.Path(repo_path) / ".ai-agent" / "intake" / draft_id
    intake_dir.mkdir(parents=True, exist_ok=True)

    raw_input = {
        "raw_text": raw_requirement,
        "user_hints": "",
        "requirement_type": "feature",
        "files": []
    }
    save_json(intake_dir / "raw-input.json", raw_input)

    # Save as 'generating' in local registry under lock
    with registry_lock(reg_dir):
        drafts_file = reg_dir / "intake-drafts.json"
        drafts_reg = load_json(drafts_file, {"drafts": []})

        rec_target = args.preferred_granularity
        if rec_target == "auto":
            rec_target = "epic" if ("epic" in raw_requirement.lower() or len(raw_requirement) > 500) else "adu"

        drafts_reg["drafts"].append({
            "draft_id": draft_id,
            "project_id": args.project,
            "repo_path": project.get("repo_path"),
            "status": "generating",
            "title": "Pending Generation",
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "draft_path": f".ai-agent/intake/{draft_id}/draft.json"
        })
        save_json_direct(drafts_file, drafts_reg)

    # Spawn hermes_agent_run.py subprocess to generate draft.json
    import subprocess
    script_path = pathlib.Path(WORKSPACE) / "scripts" / "hermes_agent_run.py"
    if not script_path.exists():
        print(f"Intake agent run script not found at {script_path}", file=sys.stderr)
        sys.exit(1)

    cmd = [
        "python3", str(script_path),
        "--intake-draft", draft_id,
        "--project", args.project,
        "--repo", repo_path,
        "--agent", "adu-intake-agent"
    ]

    print(f"Local Execution: {' '.join(cmd)}")
    res = subprocess.run(cmd, cwd=WORKSPACE)

    # Update status based on execution result under lock
    with registry_lock(reg_dir):
        drafts_reg = load_json(drafts_file, {"drafts": []})
        entry = next((d for d in drafts_reg.get("drafts", []) if d.get("draft_id") == draft_id), None)

        if res.returncode == 0:
            status = "draft_ready"
            # Read generated draft.json to get actual title
            title = "Local Intake Draft"
            draft_file = intake_dir / "draft.json"
            if draft_file.exists():
                try:
                    draft_content = json.loads(draft_file.read_text(encoding="utf-8"))
                    title = draft_content.get("title", "Local Intake Draft")
                except Exception:
                    pass
        else:
            status = "generation_failed"
            title = "Generation Failed"
            print("Draft generation failed locally.", file=sys.stderr)

        if entry:
            entry["status"] = status
            entry["title"] = title
            entry["updated_at"] = datetime.now().isoformat()
            save_json_direct(drafts_file, drafts_reg)

    if status == "generation_failed":
        sys.exit(1)

    print(json.dumps({
        "draft_id": draft_id,
        "recommended_target": rec_target,
        "reason": f"Local mock intake generated for project {args.project}.",
        "clarification_questions": []
    }, indent=2, ensure_ascii=False))

def main():
    parser = argparse.ArgumentParser(description="Agent Factory Operator CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # 'next' command
    p_next = subparsers.add_parser("next", help="Get next action recommended")
    g_next = p_next.add_mutually_exclusive_group(required=True)
    g_next.add_argument("--adu", help="Target ADU ID")
    g_next.add_argument("--epic", help="Target Epic ID")

    # 'act' command
    p_act = subparsers.add_parser("act", help="Perform operator action")
    g_act = p_act.add_mutually_exclusive_group(required=True)
    g_act.add_argument("--adu", help="Target ADU ID")
    g_act.add_argument("--epic", help="Target Epic ID")
    p_act.add_argument("--action", required=True, help="Operator action name")
    p_act.add_argument("--idempotency-key", help="Idempotency key")
    p_act.add_argument("--requested-by", default="codex", choices=["human", "codex", "system"], help="Who requested the action")
    p_act.add_argument("--payload", help="JSON payload string")

    # 'handoff' command
    p_handoff = subparsers.add_parser("handoff", help="Get handoff context summary")
    g_handoff = p_handoff.add_mutually_exclusive_group(required=True)
    g_handoff.add_argument("--adu", help="Target ADU ID")
    g_handoff.add_argument("--epic", help="Target Epic ID")

    # 'intake' command
    p_intake = subparsers.add_parser("intake", help="Submit intake requirement")
    p_intake.add_argument("--project", required=True, help="Project ID")
    p_intake.add_argument("--requirement-file", required=True, help="Path to requirement markdown file")
    p_intake.add_argument("--preferred-granularity", default="auto", choices=["auto", "adu", "epic"], help="Preferred target type")
    p_intake.add_argument("--language", default="zh", help="Target language")

    args = parser.parse_args()

    # Determine mode: API or local
    use_api = "AGENT_FACTORY_API_BASE" in os.environ

    if not use_api:
        # Local execution fallback
        if args.command == "next":
            local_next(args)
        elif args.command == "act":
            local_act(args)
        elif args.command == "handoff":
            local_handoff(args)
        elif args.command == "intake":
            local_intake(args)
        return

    # REST API Execution
    if args.command == "next":
        target_type = "epic" if args.epic else "adu"
        target_id = args.epic if args.epic else args.adu
        res = call_api(f"/api/agent-factory/operator/{target_type}/{target_id}/next-action")
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "act":
        target_type = "epic" if args.epic else "adu"
        target_id = args.epic if args.epic else args.adu

        payload_data = {}
        if args.payload:
            try:
                payload_data = json.loads(args.payload)
            except Exception as err:
                print(f"Invalid JSON payload: {err}", file=sys.stderr)
                sys.exit(1)

        body = {
            "action": args.action,
            "idempotency_key": args.idempotency_key or str(uuid.uuid4()),
            "requested_by": args.requested_by,
            "payload": payload_data
        }
        res = call_api(f"/api/agent-factory/operator/{target_type}/{target_id}/actions", method="POST", payload=body)
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "handoff":
        target_type = "epic" if args.epic else "adu"
        target_id = args.epic if args.epic else args.adu
        res = call_api(f"/api/agent-factory/operator/{target_type}/{target_id}/handoff")
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif args.command == "intake":
        try:
            req_file = pathlib.Path(args.requirement_file)
            raw_requirement = req_file.read_text(encoding="utf-8")
        except Exception as err:
            print(f"Failed to read requirement file: {err}", file=sys.stderr)
            sys.exit(1)

        body = {
            "project_id": args.project,
            "raw_requirement": raw_requirement,
            "preferred_granularity": args.preferred_granularity,
            "language": args.language
        }
        res = call_api("/api/agent-factory/operator/intake", method="POST", payload=body)
        print(json.dumps(res, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()

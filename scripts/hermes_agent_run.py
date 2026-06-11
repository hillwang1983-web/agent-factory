#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

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


def load_json(path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(path)


def find_adu(adu_data, adu_id):
    for adu in adu_data["adus"]:
        if adu["id"] == adu_id:
            return adu
    raise SystemExit(f"ADU not found: {adu_id}")


def load_project_profile(project_repo_path: Path) -> dict:
    profile_path = project_repo_path / ".agent-factory" / "project-profile.json"
    if not profile_path.exists():
        return {}
    try:
        return load_json(profile_path)
    except Exception:
        return {}


def load_knowledge_pack(project_repo_path: Path, max_bytes: int = 80000) -> dict:
    knowledge_dir = project_repo_path / ".agent-factory" / "knowledge"
    pack = {}
    if not knowledge_dir.is_dir():
        return pack
    for md_file in sorted(knowledge_dir.glob("*.md")):
        try:
            raw = md_file.read_bytes()
            content = raw[:max_bytes].decode("utf-8", errors="replace")
            pack[md_file.name] = content
        except Exception:
            pass
    return pack


def render_prompt(prompt_text, adu, agent_name, project_info=None):
    common_path = ROOT / ".ai-agent" / "context-packs" / "common.md"
    common = common_path.read_text(encoding="utf-8") if common_path.exists() else ""

    lang = adu.get("document_language", adu.get("language", "zh"))
    lang_instruction = ""
    if lang in ["zh", "cn", "zh-CN"]:
        lang_instruction = (
            "\n\nCRITICAL LANGUAGE CONSTRAINT:\n"
            "You MUST produce all output files, artifacts, documents, and markdown files in Chinese (简体中文).\n"
            "However, technical variables, configuration keys, database schemas, code symbols, code snippets, and JSON response keys/internal status values MUST remain in their technical English names as specified in the templates.\n"
        )
    else:
        lang_instruction = (
            "\n\nLANGUAGE CONSTRAINT:\n"
            "You MUST produce all output files, artifacts, documents, and markdown files in English.\n"
        )

    payload = {
        "agent": agent_name,
        "adu": adu,
        "common_context": common,
    }

    project_repo_path = None
    if project_info and project_info.get("repo_path"):
        project_repo_path = Path(project_info.get("repo_path", "")).resolve()
    artifact_root = project_repo_path if project_repo_path else ROOT

    # Inject latest review/debugger report when developer is reworking code.
    adu_id = adu.get("id", "")
    rework_state = adu.get("state")
    if agent_name == "developer" and rework_state in ("code_rework", "acceptance_rework", "build_rework", "rework_planned"):
        # When rework_planned, load the rework-plan first (it's the authoritative action list)
        if rework_state == "rework_planned":
            rework_plan_path = artifact_root / ".ai-agent" / "rework" / f"{adu_id}-rework-plan.json"
            if rework_plan_path.exists():
                try:
                    payload["rework_plan"] = json.loads(rework_plan_path.read_text(encoding="utf-8"))
                except Exception:
                    pass

        # Load the source feedback (review or debugger report) for full context
        if rework_state == "build_rework":
            summary_path = artifact_root / ".ai-agent" / "runs" / f"{adu_id}-validation-summary.md"
            debugger_data = {}
            if summary_path.exists():
                try:
                    debugger_data["validation_summary_md"] = summary_path.read_text(encoding="utf-8")
                except Exception:
                    pass
            if debugger_data:
                payload["debugger_feedback"] = debugger_data
        elif rework_state in ("code_rework", "acceptance_rework", "rework_planned"):
            # Determine the original feedback source. For rework_planned,
            # read rework-plan.json's "source" field to decide what to load.
            feedback_source = None
            if rework_state == "code_rework":
                feedback_source = "code-review"
            elif rework_state == "acceptance_rework":
                feedback_source = "acceptance-review"
            elif rework_state == "rework_planned":
                plan = payload.get("rework_plan", {})
                if isinstance(plan, dict):
                    feedback_source = plan.get("source")
                # If source is "buildfix", we load debugger feedback instead
                if feedback_source == "buildfix":
                    feedback_source = "buildfix"

            if feedback_source == "buildfix":
                summary_path = artifact_root / ".ai-agent" / "runs" / f"{adu_id}-validation-summary.md"
                debugger_data = {}
                if summary_path.exists():
                    try:
                        debugger_data["validation_summary_md"] = summary_path.read_text(encoding="utf-8")
                    except Exception:
                        pass
                if debugger_data:
                    payload["debugger_feedback"] = debugger_data
            elif feedback_source in ("code-review", "acceptance-review"):
                review_kind = feedback_source
                review_dir = "reviews" if review_kind == "code-review" else "acceptance"
                review_json_path = artifact_root / ".ai-agent" / review_dir / f"{adu_id}-{review_kind}.json"
                review_md_path = artifact_root / ".ai-agent" / review_dir / f"{adu_id}-{review_kind}.md"
                review_data = {}
                if review_json_path.exists():
                    try:
                        review_data["report_json"] = json.loads(review_json_path.read_text(encoding="utf-8"))
                    except Exception:
                        pass
                if review_md_path.exists():
                    try:
                        review_data["report_md"] = review_md_path.read_text(encoding="utf-8")
                    except Exception:
                        pass
                if review_data:
                    payload["rework_feedback"] = review_data

    if project_info:
        repo_path = project_repo_path
        payload["project"] = project_info
        payload["project_profile"] = load_project_profile(repo_path) if repo_path else {}
        payload["knowledge_pack"] = load_knowledge_pack(repo_path) if repo_path else {}
        payload["policies"] = {
            "review_policy": adu.get("review_policy"),
            "command_policy": adu.get("command_policy"),
        }
        payload["artifact_paths"] = {
            "allowed_read_paths": adu.get("allowed_read_paths", []),
            "allowed_write_paths": adu.get("allowed_write_paths", []),
            "required_evidence": adu.get("required_evidence", []),
        }

    rendered = prompt_text + lang_instruction
    rendered = rendered.replace("{{ADU_ID}}", adu["id"])
    rendered = rendered.replace("{{EPIC_ID}}", adu["id"])
    if adu.get("project_id"):
        rendered = rendered.replace("{{PROJECT_ID}}", adu["project_id"])
    if "repo_path" in adu:
        rendered = rendered.replace("{{REPO_PATH}}", adu["repo_path"])
        rendered = rendered.replace("{{SCAN_RESULT_PATH}}", f"/tmp/{adu['project_id']}-scan.json")

    section_header = "# Project Context Payload" if project_info else "# Runtime Payload"
    rendered += f"\n\n{section_header}\n\n"
    rendered += "```json\n"
    rendered += json.dumps(payload, ensure_ascii=False, indent=2)
    rendered += "\n```\n"
    return rendered


def extract_json_result(text):
    # Greedy match so nested JSON objects are captured correctly
    blocks = re.findall(r"```json\s*(\{.*\})\s*```", text, flags=re.DOTALL)
    if not blocks:
        return None
    for block in reversed(blocks):
        parsed = parse_json_block(block)
        if parsed is not None:
            return parsed
    return None


def parse_json_block(block):
    try:
        return json.loads(block)
    except json.JSONDecodeError:
        repaired = re.sub(r'\\([^"\\/bfnrtu])', r'\1', block)
        if repaired == block:
            return None
        try:
            parsed = json.loads(repaired)
            if isinstance(parsed, dict):
                parsed.setdefault("_json_repaired", True)
            return parsed
        except json.JSONDecodeError:
            return None


def build_unstructured_result(stdout, stderr):
    stdout_text = stdout or ""
    stderr_text = stderr or ""
    lower_combined = f"{stdout_text}\n{stderr_text}".lower()

    if "dsml" in lower_combined or "tool_calls" in lower_combined:
        error_code = "tool_call_without_final_json"
        error = "Agent 最终输出仍是工具调用片段，而不是约定的 fenced JSON；通常表示工具调用循环耗尽或模型未按协议收尾。"
    else:
        error_code = "missing_final_json"
        error = "Agent 最终输出中没有可解析的 fenced JSON 结果。"

    preview_source = stdout_text.strip() or stderr_text.strip()
    return {
        "result": "unstructured",
        "error_code": error_code,
        "error": error,
        "stdout_preview": preview_source[:1000],
    }


def normalize_repo_relative_path(value):
    if not isinstance(value, str):
        return None
    path_value = value.strip().replace("\\", "/")
    if not path_value:
        return None
    if path_value.startswith("/") or "\0" in path_value:
        return None
    if any(part == ".." for part in path_value.split("/")):
        return None
    blocked_prefixes = (".git/", ".agent-factory/", ".ai-agent/registry/", "~", "/Users/", "/home/", "/etc/", "/tmp/", "/var/")
    if any(path_value.startswith(prefix) for prefix in blocked_prefixes):
        return None
    return path_value


def extend_unique(target_list, values):
    if not isinstance(target_list, list):
        target_list = []
    existing = set(target_list)
    for value in values:
        if value not in existing:
            target_list.append(value)
            existing.add(value)
    return target_list


def apply_agent_side_effects(adu, agent_name, result):
    if not isinstance(result, dict):
        return

    if agent_name == "detail-designer" and result.get("result") == "success":
        requested = []
        for key in ("required_write_paths", "requested_write_paths", "proposed_write_paths", "implementation_write_paths"):
            values = result.get(key, [])
            if isinstance(values, list):
                requested.extend(values)

        normalized = []
        for item in requested:
            path_value = normalize_repo_relative_path(item)
            if path_value:
                normalized.append(path_value)

        if normalized:
            adu["pending_design_write_paths"] = extend_unique(
                adu.get("pending_design_write_paths") or [],
                normalized,
            )

    # Path expansion: developer records files it needs that are outside allowed_write_paths.
    if agent_name == "developer" and result.get("result") == "success":
        requested = result.get("requested_write_paths", [])
        if requested and isinstance(requested, list):
            normalized = []
            for item in requested:
                path_value = normalize_repo_relative_path(item)
                if path_value:
                    normalized.append(path_value)
            if normalized:
                adu["pending_path_requests"] = extend_unique(
                    adu.get("pending_path_requests") or [],
                    normalized,
                )

    # Path expansion: code-reviewer approves/rejects developer path requests.
    if agent_name == "code-reviewer" and result.get("result") == "success":
        approved = result.get("approved_write_paths", [])
        if approved and isinstance(approved, list):
            normalized = []
            for item in approved:
                path_value = normalize_repo_relative_path(item)
                if path_value:
                    normalized.append(path_value)
            if normalized:
                adu["allowed_write_paths"] = extend_unique(
                    adu.get("allowed_write_paths") or [],
                    normalized,
                )
        adu["pending_path_requests"] = []


def handle_intake_draft(args, root, registry):
    draft_id = args.intake_draft
    # Use --repo (project repo_path) not workspace root — intake files live under the project repo
    project_repo_path = Path(args.repo).resolve() if args.repo else root
    intake_dir = project_repo_path / ".ai-agent" / "intake" / draft_id

    with open(intake_dir / "raw-input.json") as f:
        raw_input = json.load(f)

    project_profile = load_project_profile(project_repo_path)
    knowledge_pack = load_knowledge_pack(project_repo_path)

    prompt_path = root / ".ai-agent" / "prompts" / "adu-intake-agent.md"
    prompt_text = prompt_path.read_text(encoding="utf-8")

    # Read content of uploaded source files and concatenate for the prompt
    files_content_parts = []
    for sf in raw_input.get("files", []):
        rel_path = sf.get("relative_path", "")
        filename = sf.get("filename", "unknown")
        try:
            content = (project_repo_path / rel_path).read_text(encoding="utf-8", errors="replace")
            if sf.get("truncated"):
                content = content[:5000] + "\n[TRUNCATED]"
            files_content_parts.append(f"## {filename}\n{content}")
        except Exception as e:
            files_content_parts.append(f"## {filename}\n[Could not read: {e}]")
    files_content = "\n\n".join(files_content_parts) if files_content_parts else "(no files uploaded)"

    # Key names match AgentFactoryIntakeRawInput schema (requirement_type / raw_text / user_hints)
    prompt = prompt_text.replace("{PROJECT_PROFILE}", json.dumps(project_profile, indent=2))
    prompt = prompt.replace("{KNOWLEDGE_PACK}", json.dumps(knowledge_pack, indent=2))
    prompt = prompt.replace("{REQUIREMENT_TYPE}", raw_input.get("requirement_type", "feature"))
    prompt = prompt.replace("{RAW_TEXT}", raw_input.get("raw_text", ""))
    prompt = prompt.replace("{USER_HINTS}", raw_input.get("user_hints", ""))
    prompt = prompt.replace("{UPLOADED_FILES_CONTENT}", files_content)
    prompt = prompt.replace("{DRAFT_ID}", draft_id)

    # Call hermes
    agents = load_json(registry / "agents.json")
    cmd = [agents.get("hermes_bin", "hermes")]
    cmd.extend(agents.get("agents", {}).get("adu-intake-agent", {}).get("hermes_args", []))
    cmd.extend(["-z", prompt])

    proc = subprocess.run(
        cmd,
        cwd=str(project_repo_path),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    if proc.returncode != 0:
        print(f"Hermes failed (exit {proc.returncode}): {proc.stderr[:500]}", file=sys.stderr)
        sys.exit(1)

    # Hermes exits 0 even on API errors — detect them in stdout before trying JSON parse
    stdout = proc.stdout
    if "API call failed" in stdout or "RESOURCE_EXHAUSTED" in stdout or "HTTP 429" in stdout:
        print(f"Hermes API error: {stdout[:400]}", file=sys.stderr)
        sys.exit(1)

    result = extract_json_result(stdout)
    if not result:
        preview = stdout[:300].replace("\n", " ")
        print(f"Failed to parse JSON result from Hermes. Output preview: {preview}", file=sys.stderr)
        sys.exit(1)

    # Guard against unexpected agent output structure
    if "draft_content" not in result:
        print(f"Missing 'draft_content' in result. Got keys: {list(result.keys())}", file=sys.stderr)
        sys.exit(1)
    if "report_content" not in result:
        print(f"Missing 'report_content' in result. Got keys: {list(result.keys())}", file=sys.stderr)
        sys.exit(1)

    # Write artefacts under the project repo, not the workspace root
    (intake_dir / "draft.json").write_text(
        json.dumps(result["draft_content"], indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (intake_dir / "intake-report.md").write_text(result["report_content"], encoding="utf-8")

    print(f"Draft {draft_id} processed successfully.")
    sys.exit(0)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--adu", required=False)
    parser.add_argument("--epic", required=False)
    parser.add_argument("--agent", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--intake-draft", required=False)
    parser.add_argument("--project", required=False)
    parser.add_argument("--repo", required=False)
    args = parser.parse_args()

    if args.intake_draft:
        handle_intake_draft(args, ROOT, REGISTRY)

    agents = load_json(REGISTRY / "agents.json")
    runs = load_json(REGISTRY / "runs.json")

    # Determine if we're in Epic-level or ADU-level mode
    is_epic_run = bool(args.epic)
    if not is_epic_run and not args.agent == "project-profiler" and not args.intake_draft:
        if not args.adu:
            raise SystemExit("Error: --adu or --epic is required")


    adu_data = None
    epic_data = None
    epic = None

    if args.agent == "project-profiler":
        if not args.project:
            raise SystemExit("Error: --project is required when running project-profiler agent")
        # Build mock adu object
        adu = {
            "id": args.project,
            "project_id": args.project,
            "repo_path": args.repo or str(ROOT),
            "workspace_root": args.repo or str(ROOT),
            "artifacts": []
        }
    elif is_epic_run:
        epic_data = load_json(REGISTRY / "epics.json")
        epic = next((e for e in epic_data.get("epics", []) if e["id"] == args.epic), None)
        if not epic:
            raise SystemExit(f"Epic not found: {args.epic}")
        # Build a synthetic adu for render_prompt compatibility
        adu = {
            "id": args.epic,
            "project_id": epic.get("project_id", "default-open5gs"),
            "repo_path": epic.get("repo_path", str(ROOT)),
            "state": epic.get("state", "created"),
            "title": epic.get("title", ""),
            "language": epic.get("language", "zh"),
            "artifacts": [],
            "allowed_read_paths": [],
            "allowed_write_paths": [],
            "required_evidence": [],
        }
    else:
        if not args.adu:
            raise SystemExit("Error: --adu or --epic is required")
        adu_data = load_json(REGISTRY / "adu.json")
        adu = find_adu(adu_data, args.adu)

    projects_path = REGISTRY / "projects.json"
    project_repo_path = ROOT
    project_id = "default-open5gs"
    project_info = None

    if args.agent == "project-profiler":
        project_id = args.project
        project_repo_path = Path(args.repo or str(ROOT)).resolve()
        project_info = {
            "project_id": project_id,
            "repo_path": str(project_repo_path),
            "profile_path": str(project_repo_path / ".agent-factory" / "project-profile.json"),
            "knowledge_dir": str(project_repo_path / ".agent-factory" / "knowledge")
        }
    else:
        project_id = adu.get("project_id", "default-open5gs")
        if projects_path.exists():
            try:
                projects_data = load_json(projects_path)
                p = next((proj for proj in projects_data.get("projects", []) if proj["project_id"] == project_id), None)
                if p:
                    project_repo_path = Path(p["repo_path"]).resolve()
                    project_info = {
                        "project_id": project_id,
                        "repo_path": str(project_repo_path),
                        "profile_path": p.get("profile_path") or str(project_repo_path / ".agent-factory" / "project-profile.json"),
                        "knowledge_dir": p.get("knowledge_dir") or str(project_repo_path / ".agent-factory" / "knowledge")
                    }
            except Exception:
                pass

    agent_cfg = agents["agents"].get(args.agent)
    # Load per‑agent model override configuration
    model_settings_path = REGISTRY / "agent-model-settings.json"
    model_overrides = {}
    if model_settings_path.exists():
        try:
            model_overrides = json.load(model_settings_path.open("r", encoding="utf-8"))
        except Exception:
            model_overrides = {}
    agent_model_cfg = model_overrides.get(args.agent, {})
    # If a provider or model is specified for this agent, inject into the
    # agent-specific hermes_args (not the global one) so that the spawned
    # hermes command actually uses the override.
    if agent_cfg and agent_model_cfg.get("provider"):
        agent_cfg["hermes_args"] = agent_cfg.get("hermes_args", []) + ["--provider", agent_model_cfg["provider"]]
    if agent_cfg and agent_model_cfg.get("model"):
        agent_cfg["hermes_args"] = agent_cfg.get("hermes_args", []) + ["--model", agent_model_cfg["model"]]

    if not agent_cfg:
        raise SystemExit(f"Agent not found: {args.agent}")

    prompt_path = ROOT / agent_cfg["prompt"]
    prompt_text = prompt_path.read_text(encoding="utf-8")
    prompt = render_prompt(prompt_text, adu, args.agent, project_info)

    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    if is_epic_run:
        run_dir = project_repo_path / ".ai-agent" / "runs" / "epics" / args.epic / f"{timestamp}-{args.agent}"
    else:
        run_dir = project_repo_path / ".ai-agent" / "runs" / f"{timestamp}-{adu['id']}-{args.agent}"
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "prompt.md").write_text(prompt, encoding="utf-8")

    cmd = [agents.get("hermes_bin", "hermes")]
    cmd.extend(agent_cfg.get("hermes_args", []))
    cmd.extend(["-z", prompt])

    estimated_input_tokens = len(prompt) // 4

    # Pre-execution token budget hardStop check
    budget_path = REGISTRY / "token-budget.json"
    if budget_path.exists():
        try:
            budget = load_json(budget_path)
            agent_cfg_budget = budget.get("agents", {}).get(args.agent, budget.get("default", {}))
            hard_stop = agent_cfg_budget.get("hardStop", False)
            input_limit = agent_cfg_budget.get("inputTokenLimit", 0)
            if hard_stop and input_limit > 0 and estimated_input_tokens >= input_limit:
                if adu_data:
                    adu.setdefault("pre_gate_state", adu.get("state", "created"))
                    adu["state"] = "human_gate"
                    adu["human_gate_required"] = True
                
                run_record = {
                    "timestamp": timestamp,
                    "adu_id": adu["id"],
                    "project_id": project_id,
                    "workspace_root": str(project_repo_path),
                    "agent": args.agent,
                    "returncode": 1,
                    "result": "failed",
                    "run_dir": str(run_dir.relative_to(project_repo_path)),
                    "parsed_result": {
                        "result": "failed",
                        "error": f"Token budget hardStop triggered pre-execution: Estimated input {estimated_input_tokens} exceeds limit {input_limit}"
                    },
                    "token_usage": {
                        "inputTokens": estimated_input_tokens,
                        "outputTokens": 0,
                        "totalTokens": estimated_input_tokens,
                        "estimatedInputTokens": estimated_input_tokens,
                        "usageSource": "estimated"
                    }
                }
                runs["runs"].append(run_record)
                if adu_data:
                    save_json(REGISTRY / "adu.json", adu_data)
                save_json(REGISTRY / "runs.json", runs)
                print(json.dumps(run_record, ensure_ascii=False, indent=2))
                sys.exit(1)
        except Exception:
            pass

    if args.dry_run:
        print(" ".join(cmd[: len(cmd) - 1]) + " <prompt>")
        return

    env = os.environ.copy()
    session_id = f"oneshot_{timestamp}_{adu['id']}_{args.agent}"
    env["HERMES_SESSION_ID"] = session_id

    proc = subprocess.run(
        cmd,
        cwd=str(project_repo_path),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )

    (run_dir / "stdout.md").write_text(proc.stdout, encoding="utf-8")
    (run_dir / "stderr.md").write_text(proc.stderr, encoding="utf-8")

    result = extract_json_result(proc.stdout)
    if proc.returncode != 0:
        adu["retry_count"] = int(adu.get("retry_count", 0)) + 1
        run_result = "failed"
    elif result is None:
        adu["retry_count"] = int(adu.get("retry_count", 0)) + 1
        run_result = "unstructured"
        result = build_unstructured_result(proc.stdout, proc.stderr)
    else:
        run_result = result.get("result") or result.get("status") or "unknown"
        next_state = result.get("next_state")

        if run_result == "success":
            # Quality gate: validate output artifacts deterministically
            val_cmd = None
            if args.agent == "contract":
                val_cmd = [sys.executable, str(ROOT / "scripts" / "validate_agent_contract.py"), "--adu", adu["id"], "--repo-root", str(project_repo_path)]
            elif args.agent in ("code-reviewer", "acceptance-reviewer"):
                kind = "code-review" if args.agent == "code-reviewer" else "acceptance"
                val_cmd = [sys.executable, str(ROOT / "scripts" / "validate_quality_report.py"), "--adu", adu["id"], "--kind", kind, "--repo-root", str(project_repo_path)]
            elif args.agent == "system-flow-designer":
                flow_path = project_repo_path / ".ai-agent" / "epics" / adu["id"] / "system-flow.json"
                if flow_path.exists():
                    val_cmd = [sys.executable, str(ROOT / "scripts" / "validate_epic_flow.py"), str(flow_path)]
                else:
                    run_result = "failed"
                    result["error"] = "system-flow-designer reported success but system-flow.json is missing"
                    result["result"] = "failed"
            elif args.agent == "adu-splitter":
                split_path = project_repo_path / ".ai-agent" / "epics" / adu["id"] / "split-plan.json"
                if split_path.exists():
                    val_cmd = [sys.executable, str(ROOT / "scripts" / "validate_epic_split_plan.py"), str(split_path)]
                else:
                    run_result = "failed"
                    result["error"] = "adu-splitter reported success but split-plan.json is missing"
                    result["result"] = "failed"
            elif args.agent == "epic-acceptance-reviewer":
                acc_path = project_repo_path / ".ai-agent" / "epics" / adu["id"] / "epic-acceptance.json"
                if acc_path.exists():
                    val_cmd = [sys.executable, str(ROOT / "scripts" / "validate_epic_acceptance.py"), str(acc_path), "--repo-root", str(project_repo_path)]
                else:
                    run_result = "failed"
                    result["error"] = "epic-acceptance-reviewer reported success but epic-acceptance.json is missing"
                    result["result"] = "failed"

            if val_cmd:
                val_proc = subprocess.run(val_cmd, cwd=str(ROOT), text=True, capture_output=True)
                if val_proc.returncode != 0:
                    run_result = "failed"
                    err_msg = val_proc.stderr or val_proc.stdout or f"{args.agent} quality validation failed"
                    result["error"] = err_msg.strip()
                    result["result"] = "failed"

        if run_result == "success" and next_state:
            adu["state"] = next_state
            adu["retry_count"] = 0
        elif run_result == "human_gate":
            # Agent explicitly requested human intervention — set gate state immediately
            adu["pre_gate_state"] = adu.get("state", "created")
            adu["state"] = "human_gate"
            adu["human_gate_required"] = True
        else:
            adu["retry_count"] = int(adu.get("retry_count", 0)) + 1

        apply_agent_side_effects(adu, args.agent, result)

        for artifact in result.get("artifacts", []):
            if artifact not in adu["artifacts"]:
                adu["artifacts"].append(artifact)

    if int(adu.get("retry_count", 0)) >= int(adu.get("max_retries", 3)):
        adu.setdefault("pre_gate_state", adu.get("state", "created"))
        adu["state"] = "human_gate"
        adu["human_gate_required"] = True

    estimated_input_tokens = len(prompt) // 4
    estimated_output_tokens = len(proc.stdout) // 4 if proc.stdout else 0
    input_tokens = estimated_input_tokens
    output_tokens = estimated_output_tokens
    usage_source = "estimated"

    # Try to retrieve actual token counts from state.db
    db_path = None
    home_env = os.environ.get("HERMES_HOME", "").strip()
    if home_env:
        db_path = Path(home_env) / "state.db"
    else:
        config_env = os.environ.get("HERMES_CONFIG_PATH", "").strip()
        if config_env:
            db_path = Path(config_env).parent / "state.db"

    if not db_path or not db_path.exists():
        try:
            active_profile_path = Path.home() / ".hermes" / "active_profile"
            if active_profile_path.exists():
                profile = active_profile_path.read_text(encoding="utf-8").strip()
                if profile and profile != "default":
                    db_path = Path.home() / ".hermes" / "profiles" / profile / "state.db"
        except Exception:
            pass

    if not db_path or not db_path.exists():
        db_path = Path.home() / ".hermes" / "state.db"

    if db_path.exists():
        import sqlite3
        try:
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                "SELECT input_tokens, output_tokens FROM sessions WHERE id = ?",
                (session_id,)
            )
            row = cursor.fetchone()
            if row:
                db_in = row["input_tokens"] or 0
                db_out = row["output_tokens"] or 0
                if db_in > 0 or db_out > 0:
                    input_tokens = db_in
                    output_tokens = db_out
                    usage_source = "state_db"
            conn.close()
        except Exception:
            pass

    if usage_source == "estimated" and result:
        hermes_usage = result.get("token_usage")
        if hermes_usage and isinstance(hermes_usage, dict):
            input_tokens = hermes_usage.get("inputTokens") or hermes_usage.get("input") or input_tokens
            output_tokens = hermes_usage.get("outputTokens") or hermes_usage.get("output") or output_tokens
            usage_source = "hermes"

    run_record = {
        "timestamp": timestamp,
        "adu_id": None if is_epic_run else adu["id"],
        "epic_id": args.epic if is_epic_run else None,
        "project_id": project_id,
        "workspace_root": str(project_repo_path),
        "agent": args.agent,
        "returncode": proc.returncode,
        "result": run_result,
        "run_dir": str(run_dir.relative_to(project_repo_path)),
        "parsed_result": result,
        "token_usage": {
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": input_tokens + output_tokens,
            "estimatedInputTokens": estimated_input_tokens,
            "usageSource": usage_source
        }
    }
    runs["runs"].append(run_record)

    if is_epic_run:
        if run_result == "success" and result:
            next_state = result.get("next_state")
            if next_state:
                epic["state"] = next_state
            for artifact in result.get("artifacts", []):
                existing = epic.get("artifacts", [])
                if artifact not in existing:
                    existing.append(artifact)
                epic["artifacts"] = existing
        if epic_data:
            save_json(REGISTRY / "epics.json", epic_data)
    elif adu_data:
        save_json(REGISTRY / "adu.json", adu_data)
    save_json(REGISTRY / "runs.json", runs)

    print(json.dumps(run_record, ensure_ascii=False, indent=2))

    if run_result != "success":
        sys.exit(1)


if __name__ == "__main__":
    main()

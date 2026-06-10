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
    "created": ("context-pack", "contexted"),
    "contexted": ("contract", "contracted"),
    "contracted": ("testwriter", "test_red"),
    "test_red": ("developer", "implemented"),
    "implemented": ("buildfix-debugger", "debugged"),
    "debugged": ("evidence", "evidenced"),
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
    if project_info:
        repo_path = Path(project_info.get("repo_path", "")) if project_info.get("repo_path") else None
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
    blocks = re.findall(r"```json\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if not blocks:
        return None
    for block in reversed(blocks):
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            continue
    return None


def handle_intake_draft(args, root, registry):
    draft_id = args.intake_draft
    intake_dir = root / ".ai-agent" / "intake" / draft_id
    
    with open(intake_dir / "raw-input.json") as f:
        raw_input = json.load(f)
    
    # Assuming raw_input has keys like type, text, hints, etc.
    # Load project info if possible
    project_repo_path = root
    
    project_profile = load_project_profile(project_repo_path)
    knowledge_pack = load_knowledge_pack(project_repo_path)
    
    prompt_path = root / ".ai-agent" / "prompts" / "adu-intake-agent.md"
    prompt_text = prompt_path.read_text(encoding="utf-8")
    
    # Fill placeholders
    prompt = prompt_text.replace("{PROJECT_PROFILE}", json.dumps(project_profile, indent=2))
    prompt = prompt.replace("{KNOWLEDGE_PACK}", json.dumps(knowledge_pack, indent=2))
    prompt = prompt.replace("{REQUIREMENT_TYPE}", raw_input.get("type", "feature"))
    prompt = prompt.replace("{RAW_TEXT}", raw_input.get("text", ""))
    prompt = prompt.replace("{USER_HINTS}", raw_input.get("hints", ""))
    prompt = prompt.replace("{UPLOADED_FILES_CONTENT}", raw_input.get("files_content", ""))
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
        print(f"Hermes failed: {proc.stderr}")
        sys.exit(1)
        
    result = extract_json_result(proc.stdout)
    if not result:
        print("Failed to parse JSON result from Hermes")
        sys.exit(1)
        
    # Write files
    (intake_dir / "draft.json").write_text(json.dumps(result["draft_content"], indent=2, ensure_ascii=False), encoding="utf-8")
    (intake_dir / "intake-report.md").write_text(result["report_content"], encoding="utf-8")
    
    print(f"Draft {draft_id} processed successfully.")
    sys.exit(0)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--adu", required=False)
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


    adu_data = None
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
    else:
        if not args.adu:
            raise SystemExit("Error: --adu is required")
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
    else:
        run_result = result.get("result") or result.get("status") or "unknown"
        next_state = result.get("next_state")

        if run_result == "success" and args.agent in ("contract", "code-reviewer", "acceptance-reviewer"):
            if args.agent == "contract":
                kind = "contract"
                val_cmd = [sys.executable, str(ROOT / "scripts" / "validate_agent_contract.py"), "--adu", adu["id"], "--repo-root", str(project_repo_path)]
            else:
                kind = "code-review" if args.agent == "code-reviewer" else "acceptance"
                val_cmd = [sys.executable, str(ROOT / "scripts" / "validate_quality_report.py"), "--adu", adu["id"], "--kind", kind, "--repo-root", str(project_repo_path)]
            val_proc = subprocess.run(val_cmd, cwd=str(ROOT), text=True, capture_output=True)
            if val_proc.returncode != 0:
                run_result = "failed"
                err_msg = val_proc.stderr or val_proc.stdout or f"{kind} quality validation failed"
                result["error"] = err_msg.strip()
                result["result"] = "failed"

        if run_result == "success" and next_state:
            adu["state"] = next_state
            adu["retry_count"] = 0
        else:
            adu["retry_count"] = int(adu.get("retry_count", 0)) + 1

        for artifact in result.get("artifacts", []):
            if artifact not in adu["artifacts"]:
                adu["artifacts"].append(artifact)

    if int(adu.get("retry_count", 0)) >= int(adu.get("max_retries", 3)):
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
        "adu_id": adu["id"],
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

    if adu_data:
        save_json(REGISTRY / "adu.json", adu_data)
    save_json(REGISTRY / "runs.json", runs)

    print(json.dumps(run_record, ensure_ascii=False, indent=2))

    if run_result != "success":
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
import agent_run_policy


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


def expand_runtime_path(value, workspace_root, project_repo_root=None):
    if not isinstance(value, str):
        return value
    project_root = project_repo_root if project_repo_root is not None else workspace_root
    return (
        value
        .replace("${AGENT_FACTORY_WORKSPACE}", str(workspace_root))
        .replace("$AGENT_FACTORY_WORKSPACE", str(workspace_root))
        .replace("${PROJECT_REPO_ROOT}", str(project_root))
        .replace("$PROJECT_REPO_ROOT", str(project_root))
    )


def resolve_agent_cwd(default_cwd_raw, workspace_root, project_repo_path):
    raw = default_cwd_raw or "${PROJECT_REPO_ROOT}"
    expanded = expand_runtime_path(raw, workspace_root, project_repo_path)
    return Path(expanded).resolve()


sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from registry_lock import registry_lock, save_json_direct, save_json


def load_quality_report_result(project_repo_path: Path, adu_id: str, agent_name: str) -> dict:
    if agent_name == "code-reviewer":
        report_path = project_repo_path / ".ai-agent" / "reviews" / f"{adu_id}-code-review.json"
        status_key = "review_status"
    elif agent_name == "acceptance-reviewer":
        report_path = project_repo_path / ".ai-agent" / "acceptance" / f"{adu_id}-acceptance-review.json"
        status_key = "acceptance_status"
    else:
        return {}

    report = load_json(report_path)
    synced = {
        "result": "success",
        status_key: report.get(status_key),
        "next_state": report.get("next_state"),
    }
    for key in (
        "summary",
        "findings",
        "mismatch_findings",
        "missing_evidence",
        "assertion_results",
        "negative_assertion_results",
    ):
        if key in report:
            synced[key] = report[key]
    return synced


def is_environment_verification_required(quality_result: dict) -> bool:
    if quality_result.get("acceptance_status") != "fail":
        return False

    mismatch_findings = quality_result.get("mismatch_findings") or []
    if isinstance(mismatch_findings, list) and len(mismatch_findings) > 0:
        return False

    missing_evidence = quality_result.get("missing_evidence") or []
    if not isinstance(missing_evidence, list) or len(missing_evidence) == 0:
        return False

    env_markers = (
        "runtime",
        "run time",
        "environment",
        "mongodb",
        "webui",
        "http",
        "curl",
        "运行时",
        "运行期",
        "运行环境",
        "环境",
        "人工",
    )
    searchable = json.dumps(missing_evidence, ensure_ascii=False).lower()
    return any(marker in searchable for marker in env_markers)


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


def load_latest_review_feedback(adu_id: str, gate: str):
    reviews_path = REGISTRY / "reviews.json"
    if not reviews_path.exists():
        return None
    try:
        data = load_json(reviews_path)
    except Exception:
        return None

    reviews = data.get("reviews", []) if isinstance(data, dict) else data
    if not isinstance(reviews, list):
        return None

    matching = [
        review for review in reviews
        if isinstance(review, dict)
        and review.get("adu_id") == adu_id
        and review.get("gate") == gate
        and review.get("status") == "rework_requested"
    ]
    if not matching:
        return None

    return max(
        matching,
        key=lambda review: review.get("updated_at") or review.get("created_at") or "",
    )


def validate_declared_changes(result, project_repo_path: Path, run_started_ns: int):
    changed_files = result.get("changed_files", []) if isinstance(result, dict) else []
    if not isinstance(changed_files, list):
        return ["changed_files must be an array"]

    repo_root = project_repo_path.resolve()
    errors = []
    for raw_path in changed_files:
        normalized = normalize_repo_relative_path(raw_path)
        if not normalized:
            errors.append(f"changed_files contains an invalid repository path: {raw_path!r}")
            continue

        file_path = (repo_root / normalized).resolve()
        try:
            file_path.relative_to(repo_root)
        except ValueError:
            errors.append(f"changed_files escapes the project repository: {raw_path}")
            continue

        if not file_path.is_file():
            errors.append(f"declared changed file does not exist: {normalized}")
            continue

        if file_path.stat().st_mtime_ns < run_started_ns:
            errors.append(f"declared changed file was not modified during this run: {normalized}")

    return errors


def get_agent_target_files(agent, adu, project_repo_path: Path):
    target_id = adu["id"]
    is_epic_run = adu.get("is_epic_run", False)

    files = []
    if is_epic_run:
        if agent == "system-flow-designer":
            files.extend([
                "system-flow.md",
                "system-flow.json"
            ])
            return [
                str(project_repo_path / ".ai-agent" / "epics" / target_id / "system-flow.md"),
                str(project_repo_path / ".ai-agent" / "epics" / target_id / "system-flow.json"),
            ]
        elif agent == "adu-splitter":
            return [
                str(project_repo_path / ".ai-agent" / "epics" / target_id / "split-plan.md"),
                str(project_repo_path / ".ai-agent" / "epics" / target_id / "split-plan.json"),
            ]
        elif agent == "epic-acceptance-reviewer":
            return [
                str(project_repo_path / ".ai-agent" / "epics" / target_id / "epic-acceptance.json"),
                str(project_repo_path / ".ai-agent" / "epics" / target_id / "epic-acceptance.md"),
            ]
    elif agent == "project-profiler":
        return [
            str(project_repo_path / ".agent-factory" / "project-profile.json"),
            str(project_repo_path / ".agent-factory" / "knowledge" / "project-summary.md"),
            str(project_repo_path / ".agent-factory" / "knowledge" / "module-map.md"),
            str(project_repo_path / ".agent-factory" / "knowledge" / "test-strategy.md"),
            str(project_repo_path / ".agent-factory" / "knowledge" / "risk-map.md"),
        ]
    else:
        if agent == "requirement-analyst":
            return [str(project_repo_path / ".ai-agent" / "analysis" / f"{target_id}.md")]
        elif agent == "detail-designer":
            return [
                str(project_repo_path / ".ai-agent" / "designs" / f"{target_id}-detailed-design.md"),
                str(project_repo_path / ".ai-agent" / "designs" / f"{target_id}-interfaces.json"),
            ]
        elif agent == "context-pack":
            return [str(project_repo_path / ".ai-agent" / "context-packs" / f"{target_id}.md")]
        elif agent == "contract":
            return [
                str(project_repo_path / ".ai-agent" / "contracts" / f"{target_id}.json"),
                str(project_repo_path / ".ai-agent" / "contracts" / f"{target_id}-notes.md"),
            ]
        elif agent == "rework-planner":
            return [
                str(project_repo_path / ".ai-agent" / "rework" / f"{target_id}-rework-plan.json"),
                str(project_repo_path / ".ai-agent" / "rework" / f"{target_id}-rework-plan.md"),
            ]
        elif agent == "buildfix-debugger":
            return [str(project_repo_path / ".ai-agent" / "runs" / f"{target_id}-validation-summary.md")]
        elif agent == "code-reviewer":
            return [
                str(project_repo_path / ".ai-agent" / "reviews" / f"{target_id}-code-review.json"),
                str(project_repo_path / ".ai-agent" / "reviews" / f"{target_id}-code-review.md"),
            ]
        elif agent == "acceptance-reviewer":
            return [
                str(project_repo_path / ".ai-agent" / "acceptance" / f"{target_id}-acceptance-review.json"),
                str(project_repo_path / ".ai-agent" / "acceptance" / f"{target_id}-acceptance-review.md"),
            ]
        elif agent == "evidence":
            return [
                str(project_repo_path / ".ai-agent" / "evidence" / f"{target_id}.json"),
                str(project_repo_path / ".ai-agent" / "evidence" / f"{target_id}-notes.md"),
            ]
        elif agent == "testwriter":
            return [str(project_repo_path / "tests" / "ai-agent-mvp" / f"{target_id}-validation.md")]
    return []


def render_prompt(prompt_text, adu, agent_name, project_info=None, run_dir=None):
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
    if adu.get("is_epic_run"):
        payload["epic"] = adu.get("epic_data", {})
        payload["clarifications"] = adu.get("epic_data", {}).get("clarifications", [])

    project_repo_path = None
    if project_info and project_info.get("repo_path"):
        project_repo_path = Path(project_info.get("repo_path", "")).resolve()
    artifact_root = project_repo_path if project_repo_path else ROOT

    if run_dir:
        completion_path = run_dir / "completion.json"
        payload["runtime_control"] = {
            "completion_file": str(completion_path.relative_to(artifact_root)),
            "completion_schema_version": 1,
            "completion_write_rule": (
                "Write the JSON to completion.json.tmp and atomically rename it "
                "to completion.json only after all declared artifacts are complete."
            ),
        }

    # Inject latest review/debugger report when developer is reworking code.
    adu_id = adu.get("id", "")
    rework_state = adu.get("state")
    if agent_name == "detail-designer" and rework_state == "contexted":
        design_feedback = load_latest_review_feedback(adu_id, "design")
        if design_feedback:
            payload["design_review_feedback"] = {
                "review_id": design_feedback.get("review_id"),
                "status": design_feedback.get("status"),
                "comment": design_feedback.get("comment"),
                "artifact_paths": design_feedback.get("artifact_paths", []),
                "updated_at": design_feedback.get("updated_at"),
            }

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
        import context_payload_builder
        import agent_run_policy
        policy = agent_run_policy.load_policy(agent_name, ROOT)
        max_bytes = policy.max_prompt_bytes

        focused_payload = context_payload_builder.build_focused_payload(
            agent_name,
            adu,
            project_info,
            project_repo_path,
            run_dir,
            max_bytes
        )

        payload.update(focused_payload)
        payload["project"] = project_info
        payload["policies"] = {
            "review_policy": adu.get("review_policy"),
            "command_policy": adu.get("command_policy"),
        }
        payload["artifact_paths"] = {
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

    if run_dir:
        rendered += (
            "\n\n# Runtime Completion Protocol\n\n"
            "Before finishing, write your final structured JSON result to the "
            "`runtime_control.completion_file` path wrapped in the following envelope format. "
            "The JSON must be fully valid and contain no comments. The `status` field "
            "must be \"success\" (or \"failed\" / \"human_gate\" if terminating due to an error or gate), "
            "and the `result` field must contain the final structured output dictionary expected from your agent role:\n"
            "```json\n"
            "{\n"
            '  "version": 1,\n'
            '  "status": "success",\n'
            '  "result": {}\n'
            "}\n"
            "```\n"
            "Write a temporary sibling file first, then atomically rename it. Do not write "
            "the completion file until all declared files are fully persisted.\n"
        )

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

def _hermes_profile_from_args(hermes_args):
    for index, arg in enumerate(hermes_args):
        if arg == "--profile" and index + 1 < len(hermes_args):
            profile = str(hermes_args[index + 1]).strip()
            return profile or None
    return None


def _find_and_parse_hermes_diagnostic(session_id, profile=None):
    active_profile_path = Path.home() / ".hermes" / "active_profile"
    resolved_profile = profile
    if not resolved_profile and active_profile_path.exists():
        try:
            resolved_profile = active_profile_path.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    resolved_profile = resolved_profile or "default"

    sessions_dir = Path.home() / ".hermes" / "profiles" / resolved_profile / "sessions"
    if not sessions_dir.exists():
        return None

    candidates = list(sessions_dir.glob(f"request_dump_{session_id}_*.json"))
    if not candidates:
        return None

    # Get the latest file by modification time
    latest_file = max(candidates, key=lambda p: p.stat().st_mtime)
    try:
        with open(latest_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def extract_provider_error(diag, agent_model_cfg):
    if not diag:
        return None

    error_info = diag.get("error", {})
    if not error_info:
        return None

    status_code = error_info.get("status_code")
    error_type = error_info.get("type", "")
    message = error_info.get("message", "")

    provider = agent_model_cfg.get("provider", "unknown")
    model = agent_model_cfg.get("model", "unknown")

    if status_code == 401 or "AuthenticationError" in error_type:
        error_code = "PROVIDER_AUTHENTICATION_FAILED"
    elif status_code == 429:
        error_code = "PROVIDER_RATE_LIMITED"
    elif status_code and status_code >= 500:
        error_code = "PROVIDER_UNAVAILABLE"
    else:
        return None

    return {
        "result": "failed",
        "error_code": error_code,
        "error": f"Provider: {provider}\nModel: {model}\nHTTP status: {status_code}\nReason: {error_type}\nMessage: {message}",
        "provider": provider,
        "model": model,
        "status_code": status_code,
        "message": message,
        "retryable": status_code in (429, 500, 502, 503, 504)
    }


def build_unstructured_result(stdout, stderr):
    stdout_text = stdout or ""
    stderr_text = stderr or ""
    lower_combined = f"{stdout_text}\n{stderr_text}".lower()

    if "dsml" in lower_combined or "tool_calls" in lower_combined:
        error_code = "tool_call_without_final_json"
        error = "Agent 最终输出仍是工具调用片段，而不是约定的 fenced JSON；通常表示工具调用循环耗尽或模型未按协议收尾。"
    elif re.search(r"```json\s*\{.*\}\s*```", stdout_text, flags=re.DOTALL):
        error_code = "invalid_final_json"
        error = "Agent 最终输出包含 fenced JSON，但 JSON 语法无效；常见原因是字符串中包含未转义的双引号。"
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


def _format_list_for_log(values, max_items=20):
    if not isinstance(values, list) or not values:
        return "  (none)"
    lines = []
    for item in values[:max_items]:
        if isinstance(item, (dict, list)):
            text = json.dumps(item, ensure_ascii=False, sort_keys=True)
        else:
            text = str(item)
        lines.append(f"  - {text}")
    if len(values) > max_items:
        lines.append(f"  ... {len(values) - max_items} more")
    return "\n".join(lines)


def build_agent_stdout_summary(agent_name, result, termination_reason=None):
    result = result if isinstance(result, dict) else {}
    lines = [
        "# Agent Completion Summary",
        "",
        f"- agent: {agent_name}",
        f"- result: {result.get('result') or result.get('status') or 'unknown'}",
        f"- next_state: {result.get('next_state')}",
        f"- next_agent: {result.get('next_agent')}",
        f"- termination_reason: {termination_reason or 'process_exit'}",
        "",
        "## changed_files",
        _format_list_for_log(result.get("changed_files", [])),
        "",
        "## artifacts",
        _format_list_for_log(result.get("artifacts", [])),
        "",
        "## commands_run",
        _format_list_for_log(result.get("commands_run", [])),
        "",
        "## risks",
        _format_list_for_log(result.get("risks", [])),
        "",
    ]
    return "\n".join(lines)


def build_agent_stderr_summary(result, verification_results_path=None):
    result = result if isinstance(result, dict) else {}
    lines = [
        "# Agent Diagnostic Summary",
        "",
        f"- result: {result.get('result') or result.get('status') or 'unknown'}",
    ]
    for key in ("error_code", "gate_type", "error"):
        if result.get(key):
            lines.append(f"- {key}: {result.get(key)}")
    if verification_results_path:
        lines.append(f"- verification_results_path: {verification_results_path}")
    lines.append("")
    return "\n".join(lines)


def write_log_summaries_if_empty(run_dir, agent_name, result, termination_reason=None, verification_results_path=None):
    stdout_path = run_dir / "stdout.md"
    stderr_path = run_dir / "stderr.md"
    result_kind = result.get("result") if isinstance(result, dict) else None

    if stdout_path.exists() and not stdout_path.read_text(encoding="utf-8").strip():
        stdout_path.write_text(
            build_agent_stdout_summary(agent_name, result, termination_reason),
            encoding="utf-8",
        )

    should_write_stderr = bool(
        result_kind not in (None, "success")
        or (isinstance(result, dict) and (result.get("error") or result.get("gate_type")))
    )
    if should_write_stderr and stderr_path.exists() and not stderr_path.read_text(encoding="utf-8").strip():
        stderr_path.write_text(
            build_agent_stderr_summary(result, verification_results_path),
            encoding="utf-8",
        )


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


def is_path_allowed_by_allowlist(path_value, allowed_paths):
    normalized = normalize_repo_relative_path(path_value)
    if not normalized:
        return False
    for allowed in allowed_paths or []:
        allowed_normalized = normalize_repo_relative_path(allowed)
        if not allowed_normalized:
            continue
        if allowed_normalized.endswith("/"):
            if normalized.startswith(allowed_normalized):
                return True
        elif normalized == allowed_normalized:
            return True
    return False


def evaluate_rework_plan_gate(adu, result, project_repo_path):
    if not isinstance(result, dict) or result.get("result") != "success":
        return None
    if result.get("next_state") != "rework_planned":
        return None

    artifacts = result.get("artifacts", [])
    changed_files = result.get("changed_files", [])
    candidates = []
    for raw_path in artifacts + changed_files:
        normalized = normalize_repo_relative_path(raw_path)
        if normalized and normalized.endswith("-rework-plan.json"):
            candidates.append(project_repo_path / normalized)
    candidates.append(project_repo_path / ".ai-agent" / "rework" / f"{adu.get('id')}-rework-plan.json")

    plan_path = None
    for p in candidates:
        if p.is_file():
            plan_path = p
            break
    if not plan_path:
        return {
            "result": "failed",
            "error_code": "rework_plan_missing",
            "error": "Rework plan JSON file not found."
        }

    cmd = [
        sys.executable,
        str(ROOT / "scripts" / "validate_rework_plan.py"),
        "--plan-path", str(plan_path),
        "--allowed-paths", ",".join(adu.get("allowed_write_paths") or []),
        "--adu", adu.get("id")
    ]
    proc = subprocess.run(cmd, text=True, capture_output=True)
    if proc.returncode != 0:
        if proc.returncode == 20:
            blocked = []
            import re
            m = re.search(r"blocked paths:\s*(.*)", proc.stderr or proc.stdout or "")
            if m:
                blocked = [p.strip() for p in m.group(1).split(",") if p.strip()]
            return {
                "result": "human_gate",
                "next_state": "human_gate",
                "next_agent": "human",
                "gate_type": "rework_requires_operator_cleanup",
                "pre_gate_state": "rework_planned",
                "blocked_write_paths": sorted(set(blocked)),
                "operator_actions": ["cleanup_out_of_scope_changes", "reject_rework_plan"],
                "changed_files": result.get("changed_files", []),
                "artifacts": result.get("artifacts", []),
                "commands_run": result.get("commands_run", []),
                "risks": [
                    (proc.stderr or proc.stdout or "Rework plan requires cleanup outside allowed_write_paths.").strip()
                ]
            }
        else:
            return {
                "result": "failed",
                "error_code": "rework_plan_invalid",
                "error": (proc.stderr or proc.stdout or "Rework plan validation failed.").strip()
            }

    return None


def find_latest_verification_results_path(adu_id, project_repo_path):
    """Find the verification results file path for the ADU, prioritizing
    acceptance-reviewer and falling back to buildfix-debugger.

    Returns:
        tuple (full_path, timestamp, source_agent) or (None, None, None)
    """
    runs_file = REGISTRY / "runs.json"
    if not runs_file.is_file():
        return None, None, None
    try:
        with open(runs_file, "r", encoding="utf-8") as f:
            runs_data = json.load(f)
        runs = runs_data.get("runs", [])
        runs_sorted = sorted(
            [r for r in runs if r.get("timestamp")],
            key=lambda r: r["timestamp"],
            reverse=True
        )

        # 1. Prioritize acceptance-reviewer
        for run in runs_sorted:
            if run.get("adu_id") == adu_id and run.get("result") == "success":
                if run.get("agent") == "acceptance-reviewer":
                    v_path = run.get("verification_results_path")
                    if v_path:
                        full_path = project_repo_path / v_path
                        if full_path.is_file():
                            return full_path, run.get("timestamp"), "acceptance-reviewer"

        # 2. Fall back to buildfix-debugger
        for run in runs_sorted:
            if run.get("adu_id") == adu_id and run.get("result") == "success":
                if run.get("agent") == "buildfix-debugger":
                    v_path = run.get("verification_results_path")
                    if v_path:
                        full_path = project_repo_path / v_path
                        if full_path.is_file():
                            return full_path, run.get("timestamp"), "buildfix-debugger"
    except Exception:
        pass
    return None, None, None


RUNTIME_MANAGED_PREFIXES = (
    ".ai-agent/registry/",
    ".ai-agent/locks/",
    ".ai-agent/runs/",
)

GENERATED_PREFIXES = (
    "build/",
    "dist/",
    "coverage/",
    "node_modules/",
)


def normalize_path_simple(raw: str) -> str | None:
    """Lightweight path normalizer that only rejects truly dangerous paths.
    Unlike normalize_repo_relative_path, this does not block .ai-agent/registry/
    because the file declaration classifier needs to categorize those paths,
    not reject them."""
    if not isinstance(raw, str):
        return None
    value = raw.strip().replace("\\", "/")
    if not value or value.startswith("/") or "\0" in value:
        return None
    if any(part == ".." for part in value.split("/")):
        return None
    return value


ALLOWED_WRITE_AGENTS = {"developer", "buildfix-debugger"}

def validate_agent_file_declarations(agent_name, result, repo_root, run_started_ns, delta=None):
    """Classify changed_files declarations into valid/runtime/generated/errors."""
    declared = result.get("changed_files", [])
    if not isinstance(declared, list):
        return {"errors": ["changed_files must be an array"]}

    valid_changed_files = []
    runtime_managed_files = []
    generated_files = []
    errors = []

    for raw_path in declared:
        normalized = normalize_path_simple(raw_path)
        if not normalized:
            errors.append(f"invalid changed_files path: {raw_path!r}")
            continue

        # Runtime-managed paths (registry, lock, run metadata)
        if normalized.startswith(RUNTIME_MANAGED_PREFIXES):
            runtime_managed_files.append(normalized)
            continue

        # Generated/build output paths
        if normalized.startswith(GENERATED_PREFIXES):
            generated_files.append(normalized)
            continue

        # Evidence agent: only .ai-agent/evidence/ files are valid changes
        if agent_name == "evidence":
            allowed_prefix = ".ai-agent/evidence/"
            if not normalized.startswith(allowed_prefix):
                errors.append(f"evidence_agent_declared_source_change: {normalized}")
                continue

        # Role-based write policy: only developer/buildfix-debugger may modify production source.
        # testwriter may write to .ai-agent/ and tests/.
        # All other agents are restricted to .ai-agent/ paths.
        if agent_name not in ALLOWED_WRITE_AGENTS and agent_name != "evidence":
            if agent_name == "testwriter":
                if not (normalized.startswith(".ai-agent/") or normalized.startswith("tests/")):
                    errors.append(f"illegal_write_path_escape: agent {agent_name} attempted to write outside .ai-agent/ or tests/: {normalized}")
                    continue
            else:
                if not normalized.startswith(".ai-agent/"):
                    errors.append(f"illegal_write_path_escape: agent {agent_name} attempted to write outside .ai-agent/: {normalized}")
                    continue

        file_path = (repo_root / normalized)
        try:
            file_path.resolve().relative_to(repo_root.resolve())
        except ValueError:
            errors.append(f"changed file escapes repository: {normalized}")
            continue

        if delta is not None:
            actual_changes = set(delta.get("created", [])) | set(delta.get("modified", [])) | set(delta.get("deleted", []))
            if normalized not in actual_changes:
                errors.append(f"declared changed file was not modified during this run: {normalized}")
                continue
            if normalized in delta.get("deleted", []):
                if file_path.is_file():
                    errors.append(f"declared deleted file still exists: {normalized}")
                    continue
                valid_changed_files.append(normalized)
                continue

        if not file_path.is_file():
            errors.append(f"declared changed file does not exist: {normalized}")
            continue

        if delta is None:
            if file_path.stat().st_mtime_ns < run_started_ns:
                errors.append(f"declared changed file was not modified during this run: {normalized}")
                continue
        valid_changed_files.append(normalized)

    return {
        "valid_changed_files": valid_changed_files,
        "runtime_managed_files": runtime_managed_files,
        "generated_files": generated_files,
        "errors": errors,
    }


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

    # Clarification questions: extract from requirement-analyst
    if agent_name == "requirement-analyst" and result.get("result") == "success":
        questions = result.get("clarification_questions", [])
        if isinstance(questions, list):
            formatted_questions = []
            for idx, q in enumerate(questions):
                if isinstance(q, dict) and "question" in q:
                    q_id = q.get("id") or f"q{idx + 1}"
                    existing = next((eq for eq in adu.get("clarification_questions", []) if eq.get("question") == q["question"]), None)
                    if existing:
                        formatted_questions.append(existing)
                    else:
                        formatted_questions.append({
                            "id": q_id,
                            "question": q["question"],
                            "blocking": q.get("blocking", True),
                            "status": "pending",
                            "answer": None,
                            "answered_at": None
                        })
            adu["clarification_questions"] = formatted_questions



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
    agent_cfg = agents.get("agents", {}).get("adu-intake-agent", {})
    if not agent_cfg:
        print("Agent 'adu-intake-agent' not found in registry.", file=sys.stderr)
        sys.exit(1)

    # Load per‑agent model override configuration
    model_settings_path = registry / "agent-model-settings.json"
    model_overrides = {}
    if model_settings_path.exists():
        try:
            model_overrides = json.load(model_settings_path.open("r", encoding="utf-8"))
        except Exception:
            model_overrides = {}
    agent_model_cfg = model_overrides.get("adu-intake-agent", {})

    hermes_args = list(agent_cfg.get("hermes_args", []))
    if agent_model_cfg.get("provider"):
        hermes_args.extend(["--provider", agent_model_cfg["provider"]])
    if agent_model_cfg.get("model"):
        hermes_args.extend(["--model", agent_model_cfg["model"]])

    cmd = [agents.get("hermes_bin", "hermes")]
    cmd.extend(hermes_args)
    cmd.extend(["-z", prompt])

    default_cwd_raw = agents.get("default_cwd", "${PROJECT_REPO_ROOT}")
    cwd_path = resolve_agent_cwd(default_cwd_raw, ROOT, project_repo_path)

    policy = agent_run_policy.load_policy("adu-intake-agent", ROOT)
    target_files = [
        str(project_repo_path / ".ai-agent" / "intake" / draft_id / "draft.json"),
        str(project_repo_path / ".ai-agent" / "intake" / draft_id / "intake-report.md")
    ]

    proc = agent_run_policy.execute_controlled_process(
        cmd,
        cwd_path,
        None,
        policy,
        target_files=target_files
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
            "is_epic_run": True,
            "epic_data": epic,
        }
    else:
        if not args.adu:
            raise SystemExit("Error: --adu or --epic is required")
        adu_data = load_json(REGISTRY / "adu.json")
        adu = find_adu(adu_data, args.adu)
        adu.setdefault("artifacts", [])

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

    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    run_started_ns = time.time_ns()
    if is_epic_run:
        run_dir = project_repo_path / ".ai-agent" / "runs" / "epics" / args.epic / f"{timestamp}-{args.agent}"
    else:
        run_dir = project_repo_path / ".ai-agent" / "runs" / f"{timestamp}-{adu['id']}-{args.agent}"
    run_dir.mkdir(parents=True, exist_ok=True)

    prompt_path = ROOT / agent_cfg["prompt"]
    prompt_text = prompt_path.read_text(encoding="utf-8")
    prompt = render_prompt(prompt_text, adu, args.agent, project_info, run_dir)
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
                with registry_lock(REGISTRY):
                    fresh_runs = load_json(REGISTRY / "runs.json") if (REGISTRY / "runs.json").exists() else {"runs": []}
                    fresh_runs["runs"].append(run_record)
                    save_json_direct(REGISTRY / "runs.json", fresh_runs)

                    if adu_data:
                        fresh_adu_data = load_json(REGISTRY / "adu.json") if (REGISTRY / "adu.json").exists() else {"adus": []}
                        fresh_adu = next((a for a in fresh_adu_data.get("adus", []) if a.get("id") == adu["id"]), None)
                        if fresh_adu:
                            fresh_adu["state"] = "human_gate"
                            fresh_adu["human_gate_required"] = True
                            fresh_adu["gate_type"] = "token_budget_approval"
                            fresh_adu["pre_gate_state"] = adu.get("state", "created")
                            save_json_direct(REGISTRY / "adu.json", fresh_adu_data)

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
    env["PYTHONUNBUFFERED"] = "1"
    env["HERMES_ONESHOT_NO_REDIRECT"] = "1"

    default_cwd_raw = agents.get("default_cwd", "${PROJECT_REPO_ROOT}")
    cwd_path = resolve_agent_cwd(default_cwd_raw, ROOT, project_repo_path)

    policy = agent_run_policy.load_policy(args.agent, ROOT)
    target_files = get_agent_target_files(args.agent, adu, project_repo_path)

    import run_file_snapshot
    allowed_write_paths = adu.get("allowed_write_paths") or ["."]
    snapshot_paths = list(allowed_write_paths)
    try:
        run_dir_rel = str(run_dir.relative_to(project_repo_path)).replace("\\", "/")
        snapshot_paths.append(run_dir_rel)
    except ValueError:
        pass

    for tf in target_files:
        try:
            rel = str(Path(tf).relative_to(project_repo_path)).replace("\\", "/")
            snapshot_paths.append(rel)
        except ValueError:
            pass

    # Clean and filter absolute/traversal paths
    snapshot_paths = [
        p for p in snapshot_paths
        if p and not p.startswith("/") and ".." not in p.split("/")
    ]

    delta = None
    run_started_ns = time.time_ns()
    snapshot_before = run_file_snapshot.snapshot_allowed_files(project_repo_path, snapshot_paths)

    max_attempts = policy.no_progress_max_attempts
    if max_attempts < 1:
        max_attempts = 1

    for attempt in range(1, max_attempts + 1):
        session_id = f"oneshot_{timestamp}_{adu['id']}_{args.agent}_att{attempt}"
        attempt_env = env.copy()
        attempt_env["HERMES_SESSION_ID"] = session_id

        completion_file = run_dir / f"completion_att{attempt}.json"

        attempt_prompt = prompt.replace("completion.json", f"completion_att{attempt}.json")
        (run_dir / "prompt.md").write_text(attempt_prompt, encoding="utf-8")

        attempt_cmd = list(cmd)
        try:
            z_idx = attempt_cmd.index("-z")
            attempt_cmd[z_idx + 1] = attempt_prompt
        except ValueError:
            pass

        proc = agent_run_policy.execute_controlled_process(
            attempt_cmd,
            cwd_path,
            attempt_env,
            policy,
            target_files=target_files,
            completion_file=completion_file
        )

        snapshot_after = run_file_snapshot.snapshot_allowed_files(project_repo_path, snapshot_paths)
        delta = run_file_snapshot.diff_snapshots(snapshot_before, snapshot_after)

        stdout_path = run_dir / f"stdout_att{attempt}.md" if attempt > 1 else run_dir / "stdout.md"
        stderr_path = run_dir / f"stderr_att{attempt}.md" if attempt > 1 else run_dir / "stderr.md"
        stdout_path.write_text(proc.stdout, encoding="utf-8")
        stderr_path.write_text(proc.stderr, encoding="utf-8")
        if attempt > 1:
            (run_dir / "stdout.md").write_text(proc.stdout, encoding="utf-8")
            (run_dir / "stderr.md").write_text(proc.stderr, encoding="utf-8")

        try:
            with open(run_dir / "file-snapshot-before.json", "w", encoding="utf-8") as f:
                json.dump(snapshot_before, f, ensure_ascii=False, indent=2)
            with open(run_dir / "file-snapshot-after.json", "w", encoding="utf-8") as f:
                json.dump(snapshot_after, f, ensure_ascii=False, indent=2)
            with open(run_dir / "file-delta.json", "w", encoding="utf-8") as f:
                json.dump(delta, f, ensure_ascii=False, indent=2)
        except Exception as e:
            raise RuntimeError(f"Failed to write file snapshots: {e}")

        try:
            run_dir_rel = str(run_dir.relative_to(project_repo_path)).replace("\\", "/")
        except ValueError:
            run_dir_rel = ""

        control_files = set()
        if run_dir_rel:
            control_files.add(f"{run_dir_rel}/file-snapshot-before.json")
            control_files.add(f"{run_dir_rel}/file-snapshot-after.json")
            control_files.add(f"{run_dir_rel}/file-delta.json")
            for att in range(1, max_attempts + 1):
                control_files.add(f"{run_dir_rel}/prompt.md")
                control_files.add(f"{run_dir_rel}/prompt_att{att}.md")
                control_files.add(f"{run_dir_rel}/completion.json")
                control_files.add(f"{run_dir_rel}/completion_att{att}.json")
                control_files.add(f"{run_dir_rel}/stdout.md")
                control_files.add(f"{run_dir_rel}/stdout_att{att}.md")
                control_files.add(f"{run_dir_rel}/stderr.md")
                control_files.add(f"{run_dir_rel}/stderr_att{att}.md")

        has_delta = False
        if delta:
            all_changed = set(delta.get("created", [])) | set(delta.get("modified", [])) | set(delta.get("deleted", []))
            for path in all_changed:
                if path not in control_files:
                    has_delta = True
                    break

        provider_error = None
        if proc.completion_status in ("invalid", "missing"):
            hermes_profile = _hermes_profile_from_args(agent_cfg.get("hermes_args", []))
            diag = _find_and_parse_hermes_diagnostic(session_id, hermes_profile)
            if diag:
                provider_error = extract_provider_error(diag, agent_model_cfg)
            if not provider_error:
                combined_output = f"{proc.stdout}\n{proc.stderr}"
                provider_signatures = [
                    "openai", "anthropic", "google-generativeai", "google.api_core",
                    "urllib3", "requests", "httpx", "api.openai.com", "api.anthropic.com",
                    "generativelanguage.googleapis.com", "groq", "openrouter", "deepseek",
                    "gemini", "claude"
                ]
                has_provider_context = any(sig in combined_output.lower() for sig in provider_signatures)
                if has_provider_context:
                    if (
                        "AuthenticationError" in combined_output
                        or "invalid_api_key" in combined_output.lower()
                        or "Incorrect API key provided" in combined_output
                        or "API_KEY_INVALID" in combined_output
                        or "HTTP 401 Unauthorized" in combined_output
                        or "status_code: 401" in combined_output.lower()
                        or "status code 401" in combined_output.lower()
                    ):
                        provider_error = {
                            "result": "failed",
                            "error_code": "PROVIDER_AUTHENTICATION_FAILED",
                            "error": f"Provider authentication failed detected in output: {combined_output[:500]}"
                        }
                    elif (
                        "RateLimitError" in combined_output
                        or "RESOURCE_EXHAUSTED" in combined_output
                        or "Resource has been exhausted" in combined_output
                        or "rate limit exceeded" in combined_output.lower()
                        or "HTTP 429 Too Many Requests" in combined_output
                        or "status_code: 429" in combined_output.lower()
                        or "status code 429" in combined_output.lower()
                    ):
                        provider_error = {
                            "result": "failed",
                            "error_code": "PROVIDER_RATE_LIMITED",
                            "error": f"Provider rate limited detected in output: {combined_output[:500]}"
                        }

        has_provider_block = False
        if provider_error:
            if provider_error.get("error_code") in ("PROVIDER_AUTHENTICATION_FAILED", "PROVIDER_RATE_LIMITED"):
                has_provider_block = True

        retryable = (
            proc.termination_reason == "no_progress_timeout"
            and proc.completion_status == "missing"
            and not proc.target_files_changed
            and not has_delta
            and not has_provider_block
            and attempt < max_attempts
        )
        if not retryable:
            break

        print(f"No progress timeout on attempt {attempt}. Retrying in {policy.retry_backoff_seconds * attempt} seconds...", file=sys.stderr)
        time.sleep(policy.retry_backoff_seconds * attempt)

    if proc.completion_status == "valid":
        result = proc.completion_result
    elif proc.completion_status == "not_expected":
        result = extract_json_result(proc.stdout)
    else:
        result = None

    if proc.returncode != 0:
        adu["retry_count"] = int(adu.get("retry_count", 0)) + 1
        run_result = "failed"
    elif result is None:
        is_empty_output = not proc.stdout.strip() and not proc.stderr.strip()
        provider_error_result = None

        if proc.completion_status in ("invalid", "missing"):
            hermes_profile = _hermes_profile_from_args(agent_cfg.get("hermes_args", []))
            diag = _find_and_parse_hermes_diagnostic(session_id, hermes_profile)
            if diag:
                provider_error_result = extract_provider_error(diag, agent_model_cfg)
            if not provider_error_result:
                combined_output = f"{proc.stdout}\n{proc.stderr}"
                provider_signatures = [
                    "openai", "anthropic", "google-generativeai", "google.api_core",
                    "urllib3", "requests", "httpx", "api.openai.com", "api.anthropic.com",
                    "generativelanguage.googleapis.com", "groq", "openrouter", "deepseek",
                    "gemini", "claude"
                ]
                has_provider_context = any(sig in combined_output.lower() for sig in provider_signatures)
                if has_provider_context:
                    if (
                        "AuthenticationError" in combined_output
                        or "invalid_api_key" in combined_output.lower()
                        or "Incorrect API key provided" in combined_output
                        or "API_KEY_INVALID" in combined_output
                        or "HTTP 401 Unauthorized" in combined_output
                        or "status_code: 401" in combined_output.lower()
                        or "status code 401" in combined_output.lower()
                    ):
                        provider_error_result = {
                            "result": "failed",
                            "error_code": "PROVIDER_AUTHENTICATION_FAILED",
                            "error": f"Provider authentication failed detected in output: {combined_output[:500]}"
                        }
                    elif (
                        "RateLimitError" in combined_output
                        or "RESOURCE_EXHAUSTED" in combined_output
                        or "Resource has been exhausted" in combined_output
                        or "rate limit exceeded" in combined_output.lower()
                        or "HTTP 429 Too Many Requests" in combined_output
                        or "status_code: 429" in combined_output.lower()
                        or "status code 429" in combined_output.lower()
                    ):
                        provider_error_result = {
                            "result": "failed",
                            "error_code": "PROVIDER_RATE_LIMITED",
                            "error": f"Provider rate limited detected in output: {combined_output[:500]}"
                        }

        if not provider_error_result and is_empty_output and proc.completion_status in ("invalid", "missing"):
            provider_error_result = {
                "result": "failed",
                "error_code": "EMPTY_HERMES_RESPONSE",
                "error": "Hermes exited successfully but produced empty output and no diagnostic dump."
            }

        if provider_error_result:
            result = provider_error_result
            run_result = result["result"]
            error_lines = [
                "[Agent Factory Provider Error]",
                f"error_code: {result.get('error_code', 'PROVIDER_ERROR')}",
                str(result.get("error", "Provider request failed.")),
            ]
            existing_stderr = (run_dir / "stderr.md").read_text(encoding="utf-8")
            separator = "\n" if existing_stderr and not existing_stderr.endswith("\n") else ""
            (run_dir / "stderr.md").write_text(
                f"{existing_stderr}{separator}{chr(10).join(error_lines)}\n",
                encoding="utf-8",
            )
        else:
            adu["retry_count"] = int(adu.get("retry_count", 0)) + 1
            run_result = "unstructured"
            result = build_unstructured_result(proc.stdout, proc.stderr)
            if proc.completion_status in ("invalid", "missing"):
                result["error_code"] = (
                    "invalid_completion_envelope"
                    if proc.completion_status == "invalid"
                    else "missing_completion_envelope"
                )
                result["stdout_candidate"] = extract_json_result(proc.stdout)
    else:
        run_result = result.get("result") or result.get("status") or "unknown"
        next_state = result.get("next_state")

        if run_result == "success":
            # Unified file declaration validation — replaces validate_declared_changes and the
            # old non-developer write path escape check. This classifies changed_files into:
            #   valid_changed_files (source/output actually modified)
            #   runtime_managed_files (registry/lock/run metadata — not agent-authored)
            #   generated_files (build/dist/coverage output — not agent-authored)
            #   errors (invalid, missing, unmodified, or evidence declaring source paths)
            file_decls = validate_agent_file_declarations(
                args.agent, result, project_repo_path, run_started_ns, delta=delta
            )
            if file_decls.get("errors"):
                run_result = "failed"
                result["result"] = "failed"
                result["error_code"] = "declared_changes_unverified"
                result["error"] = "; ".join(file_decls["errors"])
                result["file_declaration_errors"] = file_decls["errors"]
                with (run_dir / "stderr.md").open("a", encoding="utf-8") as stderr_file:
                    stderr_file.write("\n".join(file_decls["errors"]))
                    stderr_file.write("\n")
            else:
                result["file_declarations"] = file_decls

            rework_gate = evaluate_rework_plan_gate(adu, result, project_repo_path)
            if rework_gate:
                run_result = rework_gate.get("result", "human_gate")
                result.update(rework_gate)

        if run_result == "success" and args.agent in ("buildfix-debugger", "code-reviewer", "acceptance-reviewer"):
            trusted_cmd = [
                sys.executable,
                str(ROOT / "scripts" / "run_trusted_verification.py"),
                "--adu", adu["id"],
                "--run-dir", str(run_dir),
                "--repo-root", str(project_repo_path),
                "--registry-dir", str(REGISTRY)
            ]
            trusted_proc = subprocess.run(trusted_cmd, text=True, capture_output=True)
            if trusted_proc.returncode == 20:
                run_result = "human_gate"
                result["result"] = "human_gate"
                result["gate_type"] = "command_policy_exception"
                result["next_state"] = "human_gate"
                result["next_agent"] = "human"
                result["error"] = "Verification command requires operator approval."
            elif trusted_proc.returncode != 0:
                run_result = "failed"
                result["result"] = "failed"
                result["error_code"] = "trusted_verification_failed"
                result["error"] = f"Trusted verification failed with exit code {trusted_proc.returncode}."
                if trusted_proc.stderr:
                    with (run_dir / "stderr.md").open("a", encoding="utf-8") as stderr_file:
                        stderr_file.write(f"\n[Trusted Verification Error]: {trusted_proc.stderr}")

        if run_result == "success":
            # Quality gate: validate output artifacts deterministically
            val_cmd = None
            if args.agent == "contract":
                val_cmd = [sys.executable, str(ROOT / "scripts" / "validate_agent_contract.py"), "--adu", adu["id"], "--repo-root", str(project_repo_path)]
            elif args.agent in ("code-reviewer", "acceptance-reviewer"):
                kind = "code-review" if args.agent == "code-reviewer" else "acceptance"
                val_cmd = [sys.executable, str(ROOT / "scripts" / "validate_quality_report.py"), "--adu", adu["id"], "--kind", kind, "--repo-root", str(project_repo_path), "--run-dir", str(run_dir)]
            elif args.agent == "evidence":
                import evidence_package_compiler
                contract_path = project_repo_path / ".ai-agent" / "contracts" / f"{adu['id']}.json"
                acceptance_path = project_repo_path / ".ai-agent" / "acceptance" / f"{adu['id']}-acceptance-review.json"
                evidence_path = project_repo_path / ".ai-agent" / "evidence" / f"{adu['id']}.json"

                v_path, source_timestamp, source_agent = find_latest_verification_results_path(adu["id"], project_repo_path)
                if not v_path:
                    # Fallback to an empty verification-results.json structure
                    v_path = run_dir / "verification-results.json"
                    if not v_path.is_file():
                        v_path.write_text("{}", encoding="utf-8")

                runtime_records = adu.get("runtime_evidence_records") or []

                try:
                    package = evidence_package_compiler.compile_evidence_from_files(
                        str(contract_path),
                        str(acceptance_path),
                        str(v_path),
                        runtime_records,
                        source_run_timestamp=source_timestamp,
                        source_agent=source_agent
                    )
                    evidence_path.parent.mkdir(parents=True, exist_ok=True)
                    temp_path = evidence_path.with_suffix(".json.tmp")
                    with open(temp_path, "w", encoding="utf-8") as f:
                        json.dump(package, f, ensure_ascii=False, indent=2)
                        f.write("\n")
                    temp_path.replace(evidence_path)
                except Exception as e:
                    run_result = "failed"
                    result["result"] = "failed"
                    result["error"] = f"Canonical evidence package compilation failed: {e}"

                if run_result == "success":
                    val_cmd = [sys.executable, str(ROOT / "scripts" / "validate_evidence_package.py"), "--adu", adu["id"], "--repo-root", str(project_repo_path), "--registry-dir", str(REGISTRY)]
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
                if val_proc.returncode == 20:
                    run_result = "human_gate"
                    result["result"] = "human_gate"
                    result["gate_type"] = "environment_verification_required" if args.agent == "evidence" else "write_path_expansion"
                    err_msg = val_proc.stderr or val_proc.stdout or "Human gate required"
                    result["error"] = err_msg.strip()

                    import re
                    match = re.search(r"HUMAN_GATE:.*assertions:\s*(.*)", err_msg)
                    if match:
                        result["affected_assertions"] = [s.strip() for s in match.group(1).split(",") if s.strip()]

                    with (run_dir / "stderr.md").open("a", encoding="utf-8") as stderr_file:
                        if proc.stderr:
                            stderr_file.write("\n")
                        stderr_file.write(err_msg.strip())
                        stderr_file.write("\n")

                    qg_path = run_dir / "quality-gate.md"
                    qg_path.write_text(f"# Quality Gate Pending\n\n{err_msg.strip()}\n", encoding="utf-8")
                elif val_proc.returncode != 0:
                    run_result = "failed"
                    err_msg = val_proc.stderr or val_proc.stdout or f"{args.agent} quality validation failed"
                    result["error"] = err_msg.strip()
                    result["result"] = "failed"
                    with (run_dir / "stderr.md").open("a", encoding="utf-8") as stderr_file:
                        if proc.stderr:
                            stderr_file.write("\n")
                        stderr_file.write(err_msg.strip())
                        stderr_file.write("\n")
                elif args.agent in ("code-reviewer", "acceptance-reviewer"):
                    quality_result = load_quality_report_result(project_repo_path, adu["id"], args.agent)
                    result.update(quality_result)
                    next_state = quality_result.get("next_state") or next_state
                    if args.agent == "acceptance-reviewer" and is_environment_verification_required(quality_result):
                        run_result = "human_gate"
                        result["result"] = "human_gate"
                        result["gate_type"] = "environment_verification_required"
                        result["next_state"] = "human_gate"
                        result["next_agent"] = "human"
                        result["error"] = "Acceptance requires human judgment for runtime/environment verification evidence."
                        qg_path = run_dir / "quality-gate.md"
                        qg_path.write_text(
                            "# Environment Verification Required\n\n"
                            "Acceptance failed only because runtime/environment evidence is missing. "
                            "A human must decide whether to run the prepared verification, approve an environment waiver, "
                            "or send the ADU back for rework.\n",
                            encoding="utf-8",
                        )

        apply_agent_side_effects(adu, args.agent, result)

        if run_result == "success" and next_state:
            adu["state"] = next_state
            adu["retry_count"] = 0
        elif run_result == "human_gate":
            adu["pre_gate_state"] = adu.get("state", "created")
            adu["state"] = "human_gate"
            adu["human_gate_required"] = True
            if result.get("gate_type"):
                adu["gate_type"] = result["gate_type"]
        else:
            adu["retry_count"] = int(adu.get("retry_count", 0)) + 1

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

    effective_rc = 0
    if run_result == "human_gate":
        effective_rc = 20
    elif run_result != "success":
        effective_rc = 1

    try:
        verification_results_path = str((run_dir / "verification-results.json").relative_to(project_repo_path))
    except ValueError:
        verification_results_path = str(run_dir / "verification-results.json")
    verification_results_path_for_record = verification_results_path if (run_dir / "verification-results.json").exists() else None

    write_log_summaries_if_empty(
        run_dir,
        args.agent,
        result,
        proc.termination_reason or "process_exit",
        verification_results_path_for_record,
    )

    import hashlib
    delta_sha = ""
    delta_file = run_dir / "file-delta.json"
    if not delta_file.is_file():
        raise RuntimeError("file-delta.json is missing or not a file. Integrity check failed.")
    h = hashlib.sha256()
    try:
        with open(delta_file, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        delta_sha = h.hexdigest()
    except Exception as e:
        raise RuntimeError(f"Failed to calculate file-delta.json SHA-256 hash: {e}")

    run_record = {
        "timestamp": timestamp,
        "adu_id": None if is_epic_run else adu["id"],
        "epic_id": args.epic if is_epic_run else None,
        "project_id": project_id,
        "workspace_root": str(project_repo_path),
        "agent": args.agent,
        "returncode": proc.returncode,
        "effective_returncode": effective_rc,
        "result": run_result,
        "run_dir": str(run_dir.relative_to(project_repo_path)),
        "file_delta_sha256": delta_sha,
        "parsed_result": result,
        "verification_results_path": verification_results_path_for_record,
        "termination_reason": proc.termination_reason or "process_exit",
        "completion_signal_used": proc.completion_result is not None,
        "token_usage": {
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "totalTokens": input_tokens + output_tokens,
            "estimatedInputTokens": estimated_input_tokens,
            "usageSource": usage_source
        }
    }
    with registry_lock(REGISTRY):
        # 1. Update and save runs
        fresh_runs = load_json(REGISTRY / "runs.json") if (REGISTRY / "runs.json").exists() else {"runs": []}
        fresh_runs["runs"].append(run_record)
        save_json_direct(REGISTRY / "runs.json", fresh_runs)

        # 2. Update and save target state
        if is_epic_run:
            if epic_data:
                fresh_epic_data = load_json(REGISTRY / "epics.json") if (REGISTRY / "epics.json").exists() else {"epics": []}
                fresh_epic = next((e for e in fresh_epic_data.get("epics", []) if e.get("id") == args.epic), None)
                if fresh_epic:
                    if run_result == "success" and result:
                        next_state = result.get("next_state")
                        if next_state:
                            fresh_epic["state"] = next_state
                        for artifact in result.get("artifacts", []):
                            existing = fresh_epic.get("artifacts", [])
                            if artifact not in existing:
                                existing.append(artifact)
                            fresh_epic["artifacts"] = existing
                    save_json_direct(REGISTRY / "epics.json", fresh_epic_data)
        else:
            if adu_data:
                fresh_adu_data = load_json(REGISTRY / "adu.json") if (REGISTRY / "adu.json").exists() else {"adus": []}
                fresh_adu = next((a for a in fresh_adu_data.get("adus", []) if a.get("id") == adu["id"]), None)
                if fresh_adu:
                    # Merge mutated fields from our local adu object
                    for key in ["pending_design_write_paths", "pending_path_requests", "allowed_write_paths",
                                "clarification_questions", "human_gate_required", "retry_count", "pre_gate_state",
                                "gate_type", "artifacts"]:
                        if key in adu:
                            fresh_adu[key] = adu[key]

                    # Update state only if not canceled/paused in the registry
                    if fresh_adu.get("state") not in ("canceled", "paused") and not fresh_adu.get("paused"):
                        if run_result in ("success", "human_gate") or adu["state"] == "human_gate":
                            fresh_adu["state"] = adu["state"]

                    fresh_adu["latest_agent"] = args.agent
                    fresh_adu["latest_run_timestamp"] = run_record["timestamp"]
                    fresh_adu["last_result"] = run_record["result"]
                    fresh_adu["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()

                    try:
                        from token_ledger import aggregate_adu_tokens
                        _runs_data = load_json(REGISTRY / "runs.json") if (REGISTRY / "runs.json").exists() else {"runs": []}
                        _budget_data = load_json(REGISTRY / "token-budget.json") if (REGISTRY / "token-budget.json").exists() else {}
                        fresh_adu["token_summary"] = aggregate_adu_tokens(
                            _runs_data.get("runs", []), adu["id"], _budget_data
                        )
                    except Exception:
                        pass

                    save_json_direct(REGISTRY / "adu.json", fresh_adu_data)

    print(json.dumps(run_record, ensure_ascii=False, indent=2))

    if run_result == "human_gate":
        sys.exit(20)
    elif run_result != "success":
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Regression tests for Phase 2 workflow integrity.

These tests guard against drift between the orchestrator, runner, and prompts.
They intentionally avoid calling Hermes.
"""
import importlib.util
import json
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
passed = 0
failed = 0


def ok(label):
    global passed
    print(f"✅  {label}")
    passed += 1


def fail(label, reason=""):
    global failed
    print(f"❌  {label}" + (f": {reason}" if reason else ""))
    failed += 1


def load_module(name, rel_path):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


print("Running Phase 2 flow integrity tests...\n")

run_mod = load_module("hermes_agent_run", "scripts/hermes_agent_run.py")
orch_mod = load_module("hermes_agent_orchestrator", "scripts/hermes_agent_orchestrator.py")


# T01: runner state map must not preserve the pre-2.0 shortcut flow.
expected_states = [
    "created",
    "analysis_review",
    "analyzed",
    "contexted",
    "design_review",
    "designed",
    "contracted",
    "test_red",
    "implemented",
    "code_reviewed",
    "build_rework",
    "debugged",
    "acceptance_reviewed",
]

try:
    missing = [state for state in expected_states if state not in run_mod.STATE_NEXT]
    mismatched = [
        state for state in expected_states
        if state in run_mod.STATE_NEXT and run_mod.STATE_NEXT[state] != orch_mod.STATE_NEXT[state]
    ]
    if missing or mismatched:
        fail(
            "T01: hermes_agent_run STATE_NEXT matches Phase 2 orchestrator flow",
            f"missing={missing}, mismatched={mismatched}",
        )
    else:
        ok("T01: hermes_agent_run STATE_NEXT matches Phase 2 orchestrator flow")
except Exception as exc:
    fail("T01: hermes_agent_run STATE_NEXT matches Phase 2 orchestrator flow", str(exc))


# T02: detail-designer path requirements must be retained for design approval.
try:
    adu = {
        "id": "REQ-FLOW-001",
        "allowed_write_paths": [".ai-agent/designs/"],
    }
    result = {
        "result": "success",
        "next_state": "design_review",
        "required_write_paths": ["src/amf/context.c", "tests/registration.test.py"],
    }
    run_mod.apply_agent_side_effects(adu, "detail-designer", result)
    pending = adu.get("pending_design_write_paths")
    if pending == ["src/amf/context.c", "tests/registration.test.py"]:
        ok("T02: detail-designer records pending design write paths")
    else:
        fail("T02: detail-designer records pending design write paths", f"got {pending}")
except Exception as exc:
    fail("T02: detail-designer records pending design write paths", str(exc))


# T03: unstructured tool-call output must keep a diagnostic reason in run records.
try:
    diagnostic = run_mod.build_unstructured_result(
        '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="read_file"></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>',
        "",
    )
    if (
        diagnostic.get("result") == "unstructured"
        and diagnostic.get("error_code") == "tool_call_without_final_json"
        and "工具调用" in diagnostic.get("error", "")
    ):
        ok("T03: unstructured tool-call output is diagnosed")
    else:
        fail("T03: unstructured tool-call output is diagnosed", f"got {diagnostic}")
except Exception as exc:
    fail("T03: unstructured tool-call output is diagnosed", str(exc))


# T03b: final JSON with common invalid command escapes should still parse.
try:
    parsed = run_mod.extract_json_result(
        'done\n```json\n{"result":"success","commands_run":["git grep -n \\"foo\\|bar\\" src/"],"next_state":"implemented"}\n```'
    )
    if parsed and parsed.get("result") == "success" and parsed.get("commands_run") == ['git grep -n "foo|bar" src/']:
        ok("T03b: invalid command escape in final JSON is repaired")
    else:
        fail("T03b: invalid command escape in final JSON is repaired", f"got {parsed}")
except Exception as exc:
    fail("T03b: invalid command escape in final JSON is repaired", str(exc))


# T04: project-bound developer rework must receive code-review feedback from the project repo.
try:
    with tempfile.TemporaryDirectory() as tmp_dir:
        repo = Path(tmp_dir)
        review_dir = repo / ".ai-agent" / "reviews"
        review_dir.mkdir(parents=True)
        (review_dir / "REQ-FLOW-001-code-review.json").write_text(
            json.dumps({
                "review_status": "fail",
                "findings": [{"id": "CR-1", "required_fix": "修复代码审查问题"}],
                "required_developer_actions": ["按 CR-1 整改"],
            }, ensure_ascii=False),
            encoding="utf-8",
        )
        (review_dir / "REQ-FLOW-001-code-review.md").write_text("# 代码审查\n需要整改", encoding="utf-8")
        prompt = run_mod.render_prompt(
            "# Developer\n",
            {"id": "REQ-FLOW-001", "state": "code_rework", "document_language": "zh"},
            "developer",
            {"repo_path": str(repo)},
        )
        if '"rework_feedback"' in prompt and "修复代码审查问题" in prompt:
            ok("T04: project code-review feedback is injected into developer prompt")
        else:
            fail("T04: project code-review feedback is injected into developer prompt")
except Exception as exc:
    fail("T04: project code-review feedback is injected into developer prompt", str(exc))


# T05: buildfix/debugger failures must route back to developer with debugger feedback.
try:
    if run_mod.STATE_NEXT.get("build_rework") != ("developer", "implemented"):
        fail("T05: build_rework routes to developer", f"got {run_mod.STATE_NEXT.get('build_rework')}")
    else:
        with tempfile.TemporaryDirectory() as tmp_dir:
            repo = Path(tmp_dir)
            runs_dir = repo / ".ai-agent" / "runs"
            runs_dir.mkdir(parents=True)
            (runs_dir / "REQ-FLOW-002-validation-summary.md").write_text(
                "# 验证失败\n编译失败，需要 developer 修复。", encoding="utf-8"
            )
            prompt = run_mod.render_prompt(
                "# Developer\n",
                {"id": "REQ-FLOW-002", "state": "build_rework", "document_language": "zh"},
                "developer",
                {"repo_path": str(repo)},
            )
            if '"debugger_feedback"' in prompt and "编译失败，需要 developer 修复" in prompt:
                ok("T05: buildfix/debugger feedback is injected into developer prompt")
            else:
                fail("T05: buildfix/debugger feedback is injected into developer prompt")
except Exception as exc:
    fail("T05: buildfix/debugger feedback is injected into developer prompt", str(exc))


print(f"\n{passed + failed} tests: {passed} passed, {failed} failed")
if failed:
    raise SystemExit(1)

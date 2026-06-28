#!/usr/bin/env python3
"""
Regression tests for Phase 2 workflow integrity.

These tests guard against drift between the orchestrator, runner, and prompts.
They intentionally avoid calling Hermes.
"""
import importlib.util
import json
import os
import tempfile
import time
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


# T05: buildfix/debugger failures must route through rework-planner.
try:
    if run_mod.STATE_NEXT.get("build_rework") != ("rework-planner", "rework_planned"):
        fail("T05: build_rework routes through rework-planner", f"got {run_mod.STATE_NEXT.get('build_rework')}")
    else:
        ok("T05: build_rework routes through rework-planner")
except Exception as exc:
    fail("T05: build_rework routes through rework-planner", str(exc))


# T06: design rework feedback must reach detail-designer through the registry.
try:
    with tempfile.TemporaryDirectory() as tmp_dir:
        registry = Path(tmp_dir) / "registry"
        registry.mkdir()
        (registry / "reviews.json").write_text(
            json.dumps({
                "version": 1,
                "reviews": [{
                    "review_id": "review-design-1",
                    "adu_id": "REQ-FLOW-003",
                    "gate": "design",
                    "status": "rework_requested",
                    "comment": "必须修复 Canonical String 歧义和 Base64 栈溢出风险。",
                    "updated_at": "2026-06-20T00:00:00Z",
                }],
            }, ensure_ascii=False),
            encoding="utf-8",
        )
        original_registry = run_mod.REGISTRY
        run_mod.REGISTRY = registry
        try:
            prompt = run_mod.render_prompt(
                "# Detail Designer\n",
                {"id": "REQ-FLOW-003", "state": "contexted", "document_language": "zh"},
                "detail-designer",
                project_info=None,
            )
        finally:
            run_mod.REGISTRY = original_registry

        if (
            '"design_review_feedback"' in prompt
            and "Canonical String 歧义" in prompt
            and "Base64 栈溢出风险" in prompt
        ):
            ok("T06: design review feedback is injected into detail-designer prompt")
        else:
            fail("T06: design review feedback is injected into detail-designer prompt")
except Exception as exc:
    fail("T06: design review feedback is injected into detail-designer prompt", str(exc))


# T07: success cannot claim an unchanged or missing file in changed_files.
try:
    with tempfile.TemporaryDirectory() as tmp_dir:
        repo = Path(tmp_dir)
        design = repo / ".ai-agent" / "designs" / "REQ-FLOW-004-detailed-design.md"
        design.parent.mkdir(parents=True)
        design.write_text("# Old design", encoding="utf-8")
        old_ns = time.time_ns() - 10_000_000_000
        os.utime(design, ns=(old_ns, old_ns))
        run_started_ns = time.time_ns()

        stale_errors = run_mod.validate_declared_changes(
            {
                "result": "success",
                "changed_files": [
                    ".ai-agent/designs/REQ-FLOW-004-detailed-design.md",
                    ".ai-agent/designs/REQ-FLOW-004-interfaces.json",
                ],
            },
            repo,
            run_started_ns,
        )

        design.write_text("# Revised design", encoding="utf-8")
        interfaces = design.parent / "REQ-FLOW-004-interfaces.json"
        interfaces.write_text('{"version":2}', encoding="utf-8")
        fresh_errors = run_mod.validate_declared_changes(
            {
                "result": "success",
                "changed_files": [
                    ".ai-agent/designs/REQ-FLOW-004-detailed-design.md",
                    ".ai-agent/designs/REQ-FLOW-004-interfaces.json",
                ],
            },
            repo,
            run_started_ns,
        )

        if (
            any("not modified during this run" in error for error in stale_errors)
            and any("does not exist" in error for error in stale_errors)
            and fresh_errors == []
        ):
            ok("T07: unchanged and missing changed_files are rejected")
        else:
            fail(
                "T07: unchanged and missing changed_files are rejected",
                f"stale={stale_errors}, fresh={fresh_errors}",
            )
except Exception as exc:
    fail("T07: unchanged and missing changed_files are rejected", str(exc))


# T08: contract watchdog targets must match the prompt, validator, and dashboard paths.
try:
    with tempfile.TemporaryDirectory() as tmp_dir:
        repo = Path(tmp_dir)
        targets = run_mod.get_agent_target_files(
            "contract",
            {"id": "REQ-FLOW-005"},
            repo,
        )
        expected = [
            str(repo / ".ai-agent" / "contracts" / "REQ-FLOW-005.json"),
            str(repo / ".ai-agent" / "contracts" / "REQ-FLOW-005-notes.md"),
        ]
        if targets == expected:
            ok("T08: contract watchdog targets use standard contract artifact paths")
        else:
            fail(
                "T08: contract watchdog targets use standard contract artifact paths",
                f"got {targets}",
            )
except Exception as exc:
    fail("T08: contract watchdog targets use standard contract artifact paths", str(exc))


# T09: completion protocol runs must still produce readable log summaries.
try:
    result = {
        "result": "human_gate",
        "next_state": "human_gate",
        "next_agent": "human",
        "changed_files": [".ai-agent/reviews/ADU-X-code-review.json"],
        "artifacts": [".ai-agent/reviews/ADU-X-code-review.json"],
        "commands_run": ["npm run build --prefix webui"],
        "risks": [],
        "gate_type": "command_policy_exception",
        "error": "Verification command requires operator approval.",
    }
    stdout_summary = run_mod.build_agent_stdout_summary("code-reviewer", result, "completion_signal")
    stderr_summary = run_mod.build_agent_stderr_summary(
        result,
        ".ai-agent/runs/run-code-reviewer/verification-results.json",
    )
    if (
        "Agent Completion Summary" in stdout_summary
        and "code-reviewer" in stdout_summary
        and "command_policy_exception" in stderr_summary
        and "verification-results.json" in stderr_summary
    ):
        ok("T09: completion protocol runs produce readable stdout/stderr summaries")
    else:
        fail("T09: completion protocol runs produce readable stdout/stderr summaries")
except Exception as exc:
    fail("T09: completion protocol runs produce readable stdout/stderr summaries", str(exc))


# T10: successful completion with verification artifacts must not write diagnostic text to stderr.
try:
    with tempfile.TemporaryDirectory() as tmp_dir:
        run_dir = Path(tmp_dir)
        (run_dir / "stdout.md").write_text("Hermes activity log\n", encoding="utf-8")
        (run_dir / "stderr.md").write_text("", encoding="utf-8")
        result = {
            "result": "success",
            "next_state": "code_rework",
            "next_agent": "developer",
            "changed_files": [".ai-agent/reviews/ADU-X-code-review.json"],
            "artifacts": [".ai-agent/reviews/ADU-X-code-review.json"],
            "commands_run": ["npm run build --prefix webui"],
            "risks": [],
        }
        run_mod.write_log_summaries_if_empty(
            run_dir,
            "code-reviewer",
            result,
            "completion_signal",
            ".ai-agent/runs/run-code-reviewer/verification-results.json",
        )
        if (run_dir / "stderr.md").read_text(encoding="utf-8") == "":
            ok("T10: successful completion does not write diagnostics to stderr")
        else:
            fail("T10: successful completion does not write diagnostics to stderr")
except Exception as exc:
    fail("T10: successful completion does not write diagnostics to stderr", str(exc))


# T11: rework plan with out-of-allowlist cleanup opens human gate
try:
    with tempfile.TemporaryDirectory() as tmp_dir:
        repo = Path(tmp_dir)
        rework_dir = repo / ".ai-agent" / "rework"
        rework_dir.mkdir(parents=True)
        (rework_dir / "REQ-FLOW-006-rework-plan.json").write_text(
            json.dumps({
                "version": 1,
                "adu_id": "REQ-FLOW-006",
                "source": "code-review",
                "must_fix_now": [{
                    "finding_id": "CR-1",
                    "severity": "P1",
                    "developer_action": "Revert lib/app unauthorized changes.",
                    "verification_command": "git diff --name-only HEAD -- lib/app/",
                    "affected_paths": ["lib/app"]
                }],
                "additional_write_paths": ["src/core.c"],
                "return_to": "developer",
            }, ensure_ascii=False),
            encoding="utf-8",
        )
        result = {
            "result": "success",
            "next_state": "rework_planned",
            "artifacts": [".ai-agent/rework/REQ-FLOW-006-rework-plan.json"],
            "changed_files": [".ai-agent/rework/REQ-FLOW-006-rework-plan.json"],
            "next_agent": "developer",
        }
        gate = run_mod.evaluate_rework_plan_gate(
            {"id": "REQ-FLOW-006", "allowed_write_paths": ["webui/"]},
            result,
            repo,
        )
        # Negative check: src/core.c is outside webui/
        assert gate is not None, "Gate should be opened"
        assert gate.get("result") == "human_gate"
        assert gate.get("gate_type") == "rework_requires_operator_cleanup"
        assert set(gate.get("blocked_write_paths")) == {"src/core.c", "lib/app"}
        assert gate.get("next_agent") == "human"

        # Positive check: webui/server/index.js is inside webui/
        (rework_dir / "REQ-FLOW-006-rework-plan.json").write_text(
            json.dumps({
                "version": 1,
                "adu_id": "REQ-FLOW-006",
                "source": "code-review",
                "must_fix_now": [],
                "additional_write_paths": ["webui/server/index.js"],
                "return_to": "developer",
            }, ensure_ascii=False),
            encoding="utf-8",
        )
        gate_ok = run_mod.evaluate_rework_plan_gate(
            {"id": "REQ-FLOW-006", "allowed_write_paths": ["webui/"]},
            result,
            repo,
        )
        assert gate_ok is None, f"Expected None gate but got {gate_ok}"

        # Schema validation check: affected_paths is empty list
        (rework_dir / "REQ-FLOW-006-rework-plan.json").write_text(
            json.dumps({
                "version": 1,
                "adu_id": "REQ-FLOW-006",
                "source": "code-review",
                "must_fix_now": [{
                    "finding_id": "CR-1",
                    "severity": "P1",
                    "developer_action": "Fix logic in src/core.c",
                    "verification_command": "git diff",
                    "affected_paths": []
                }],
                "additional_write_paths": [],
                "return_to": "developer",
            }, ensure_ascii=False),
            encoding="utf-8",
        )
        gate_heur = run_mod.evaluate_rework_plan_gate(
            {"id": "REQ-FLOW-006", "allowed_write_paths": ["webui/"]},
            result,
            repo,
        )
        assert gate_heur is not None, "Gate should be opened for validation failure"
        assert gate_heur.get("result") == "failed"
        assert gate_heur.get("error_code") == "rework_plan_invalid"

        ok("T11: rework plan with out-of-allowlist cleanup opens human gate")
except Exception as exc:
    fail("T11: rework plan with out-of-allowlist cleanup opens human gate", str(exc))



print(f"\n{passed + failed} tests: {passed} passed, {failed} failed")
if failed:
    raise SystemExit(1)

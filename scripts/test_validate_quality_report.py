#!/usr/bin/env python3
"""
Negative (and positive) tests for validate_quality_report.py.
Uses isolated temp directories to avoid touching the real registry.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate_quality_report.py"

passed = 0
failed = 0


def run(adu, kind, repo_root=None, extra_env=None):
    cmd = [sys.executable, str(VALIDATOR), "--adu", adu, "--kind", kind]
    if repo_root:
        cmd += ["--repo-root", repo_root]
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return result.returncode, result.stdout, result.stderr


def assert_fail(label, *args, **kwargs):
    global passed, failed
    rc, _, _ = run(*args, **kwargs)
    if rc != 0:
        print(f"✅  {label}")
        passed += 1
    else:
        print(f"❌  {label}: expected non-zero exit but got 0")
        failed += 1


def assert_pass(label, *args, **kwargs):
    global passed, failed
    rc, out, err = run(*args, **kwargs)
    if rc == 0:
        print(f"✅  {label}")
        passed += 1
    else:
        print(f"❌  {label}: expected exit 0 but got {rc}\n  stdout: {out.strip()}\n  stderr: {err.strip()}")
        failed += 1


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def minimal_code_review(adu_id, status="pass"):
    if status == "pass":
        return {
            "version": 1,
            "adu_id": adu_id,
            "review_status": "pass",
            "summary": "ok",
            "checked_files": ["src/foo.c"],
            "contract_assertion_results": [{"assertion_id": "A1", "status": "pass", "reason": "ok", "evidence": []}],
            "findings": [],
            "required_developer_actions": [],
            "next_state": "code_reviewed",
        }
    else:
        return {
            "version": 1,
            "adu_id": adu_id,
            "review_status": "fail",
            "summary": "issue",
            "checked_files": ["src/foo.c"],
            "contract_assertion_results": [],
            "findings": [{"id": "CR-1", "severity": "P1", "file": "src/foo.c", "line": 1,
                          "title": "Bug", "detail": "Detail", "required_fix": "Fix it"}],
            "required_developer_actions": ["Fix CR-1"],
            "next_state": "code_rework",
        }


def minimal_contract(adu_id):
    return {
        "version": 2,
        "adu_id": adu_id,
        "source_documents": {"analysis": ".ai-agent/analysis/x.md", "design": ".ai-agent/designs/x.md"},
        "scope": {"in_scope": ["feat"], "out_of_scope": [], "allowed_write_paths": [".ai-agent/"]},
        "acceptance_assertions": [
            {"id": "A1", "title": "t1", "requirement": "r1", "verification_type": "automated_test",
             "verification_command": "make test", "expected_evidence": ["PASS: test suite"],
             "must_pass": True, "risk_if_missing": "none"},
            {"id": "A2", "title": "t2", "requirement": "r2", "verification_type": "automated_test",
             "verification_command": "make test", "expected_evidence": ["PASS: test suite"],
             "must_pass": True, "risk_if_missing": "none"},
            {"id": "A3", "title": "t3", "requirement": "r3", "verification_type": "automated_test",
             "verification_command": "make test", "expected_evidence": ["PASS: test suite"],
             "must_pass": False, "risk_if_missing": "none"},
        ],
        "negative_assertions": [
            {"id": "N1", "title": "no secret", "forbidden_change": "No /etc/ modification",
             "verification_command": "git diff --name-only | grep -v etc", "must_pass": True}
        ],
        "evidence_requirements": [
            {"id": "E1", "assertion_id": "A1", "artifact": ".ai-agent/evidence/x.json", "required_fields": ["assertions.A1.status"]}
        ],
        "quality_gates": {"code_review_required": True, "acceptance_review_required": True,
                          "minimum_assertions": 3, "minimum_negative_assertions": 1},
    }


def minimal_acceptance_review(adu_id, status="pass"):
    if status == "pass":
        return {
            "version": 1,
            "adu_id": adu_id,
            "acceptance_status": "pass",
            "summary": "ok",
            "assertion_results": [
                {"assertion_id": "A1", "status": "pass", "verification_command": "make test", "observed_result": "PASS", "evidence": []},
                {"assertion_id": "A2", "status": "pass", "verification_command": "make test", "observed_result": "PASS", "evidence": []},
            ],
            "negative_assertion_results": [
                {"assertion_id": "N1", "status": "pass", "observed_result": "No forbidden files modified"}
            ],
            "mismatch_findings": [],
            "missing_evidence": [],
            "next_state": "acceptance_reviewed",
        }
    else:
        return {
            "version": 1,
            "adu_id": adu_id,
            "acceptance_status": "fail",
            "summary": "issue",
            "assertion_results": [],
            "negative_assertion_results": [],
            "mismatch_findings": [{"id": "AR-1", "severity": "P1", "title": "Mismatch",
                                   "detail": "detail", "required_fix": "fix"}],
            "missing_evidence": [],
            "next_state": "acceptance_rework",
        }


# ── Test setup helpers ────────────────────────────────────────────────────────

def make_repo(tmpdir, adu_id, kind, report_data, contract_data=None):
    repo = Path(tmpdir) / "repo"
    if kind == "code-review":
        write_json(repo / ".ai-agent" / "reviews" / f"{adu_id}-code-review.json", report_data)
    else:
        write_json(repo / ".ai-agent" / "acceptance" / f"{adu_id}-acceptance-review.json", report_data)
        if contract_data:
            write_json(repo / ".ai-agent" / "contracts" / f"{adu_id}.json", contract_data)
    return str(repo)


def make_registry(tmpdir, adu_id, repo_path, adu_extra=None):
    reg = Path(tmpdir) / "registry"
    reg.mkdir(parents=True, exist_ok=True)
    adu = {"id": adu_id, "project_id": "proj-A", "repo_path": repo_path, "state": "implemented",
           "title": "t", "goal": "g", "retry_count": 0, "max_retries": 3, "risk": "low",
           "target_level": "mvp", "allowed_read_paths": [], "allowed_write_paths": [".ai-agent/"],
           "required_commands": [], "required_evidence": [], "artifacts": [],
           "human_gate_required": False}
    if adu_extra:
        adu.update(adu_extra)
    (reg / "adu.json").write_text(json.dumps({
        "version": 1,
        "adus": [adu]
    }), encoding="utf-8")
    return str(reg)


# ── Tests ─────────────────────────────────────────────────────────────────────

print("Running validate_quality_report tests...\n")

# T01 — file missing → fail
with tempfile.TemporaryDirectory() as tmp:
    repo = Path(tmp) / "repo"
    repo.mkdir()
    assert_fail("T01: missing code-review file → non-zero exit", "REQ-T01", "code-review", repo_root=str(repo))

# T02 — adu_id mismatch → fail
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_code_review("REQ-WRONG")
    repo = make_repo(tmp, "REQ-T02", "code-review", report)
    assert_fail("T02: adu_id mismatch → fail", "REQ-T02", "code-review", repo_root=repo)

# T03 — pass review with P1 finding → fail
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_code_review("REQ-T03", status="pass")
    report["findings"] = [{"id": "CR-1", "severity": "P1", "file": "f.c", "line": 1,
                           "title": "Bug", "detail": "d", "required_fix": "fix"}]
    repo = make_repo(tmp, "REQ-T03", "code-review", report)
    assert_fail("T03: pass review with P1 finding → fail", "REQ-T03", "code-review", repo_root=repo)

# T04 — pass review with required_fix in finding → fail
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_code_review("REQ-T04", status="pass")
    report["findings"] = [{"id": "CR-1", "severity": "P3", "file": "f.c", "line": 1,
                           "title": "Note", "detail": "d", "required_fix": "must fix"}]
    repo = make_repo(tmp, "REQ-T04", "code-review", report)
    assert_fail("T04: pass review with required_fix → fail", "REQ-T04", "code-review", repo_root=repo)

# T05 — pass review with required_developer_actions → fail
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_code_review("REQ-T05", status="pass")
    report["required_developer_actions"] = ["Do something"]
    repo = make_repo(tmp, "REQ-T05", "code-review", report)
    assert_fail("T05: pass review with developer actions → fail", "REQ-T05", "code-review", repo_root=repo)

# T06 — fail review with wrong next_state → fail
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_code_review("REQ-T06", status="fail")
    report["next_state"] = "code_reviewed"  # wrong
    repo = make_repo(tmp, "REQ-T06", "code-review", report)
    assert_fail("T06: fail review with wrong next_state → fail", "REQ-T06", "code-review", repo_root=repo)

# T07 — fail review with no findings → fail
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_code_review("REQ-T07", status="fail")
    report["findings"] = []
    repo = make_repo(tmp, "REQ-T07", "code-review", report)
    assert_fail("T07: fail review with no findings → fail", "REQ-T07", "code-review", repo_root=repo)

# T08 — acceptance: missing contract → fail
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_acceptance_review("REQ-T08", status="pass")
    repo = make_repo(tmp, "REQ-T08", "acceptance", report, contract_data=None)
    assert_fail("T08: acceptance with missing contract → fail", "REQ-T08", "acceptance", repo_root=repo)

# T09 — acceptance: adu_id mismatch → fail
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_acceptance_review("REQ-WRONG")
    contract = minimal_contract("REQ-T09")
    repo = make_repo(tmp, "REQ-T09", "acceptance", report, contract_data=contract)
    assert_fail("T09: acceptance adu_id mismatch → fail", "REQ-T09", "acceptance", repo_root=repo)

# T10 — acceptance: must_pass assertion not covered → fail
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_acceptance_review("REQ-T10", status="pass")
    report["assertion_results"] = []  # missing A1 and A2 which are must_pass
    contract = minimal_contract("REQ-T10")
    repo = make_repo(tmp, "REQ-T10", "acceptance", report, contract_data=contract)
    assert_fail("T10: acceptance missing must_pass assertion → fail", "REQ-T10", "acceptance", repo_root=repo)

# T11 — cross-project: ADU bound to project-A but repo-root is project-B → fail
with tempfile.TemporaryDirectory() as tmp:
    proj_a = Path(tmp) / "proj-a"
    proj_b = Path(tmp) / "proj-b"
    proj_a.mkdir()
    proj_b.mkdir()
    report = minimal_code_review("REQ-T11")
    # Place review in project-B's dir
    write_json(proj_b / ".ai-agent" / "reviews" / "REQ-T11-code-review.json", report)
    # Registry says REQ-T11 is in project-A
    reg = make_registry(tmp, "REQ-T11", str(proj_a))
    env = {"AGENT_FACTORY_REGISTRY_DIR": reg}
    assert_fail("T11: cross-project evidence rejection → fail", "REQ-T11", "code-review",
                repo_root=str(proj_b), extra_env=env)

# T12 — valid code-review pass → exit 0
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_code_review("REQ-T12")
    repo = make_repo(tmp, "REQ-T12", "code-review", report)
    reg = make_registry(tmp, "REQ-T12", repo)
    assert_pass("T12: valid code-review pass → exit 0", "REQ-T12", "code-review",
                repo_root=repo, extra_env={"AGENT_FACTORY_REGISTRY_DIR": reg})

# T13 — valid acceptance pass → exit 0
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_acceptance_review("REQ-T13", status="pass")
    contract = minimal_contract("REQ-T13")
    repo = make_repo(tmp, "REQ-T13", "acceptance", report, contract_data=contract)
    reg = make_registry(tmp, "REQ-T13", repo)
    assert_pass("T13: valid acceptance pass → exit 0", "REQ-T13", "acceptance",
                repo_root=repo, extra_env={"AGENT_FACTORY_REGISTRY_DIR": reg})

# T14 — valid code-review fail (rework) → exit 0 (validator succeeds on well-formed fail report)
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_code_review("REQ-T14", status="fail")
    repo = make_repo(tmp, "REQ-T14", "code-review", report)
    reg = make_registry(tmp, "REQ-T14", repo)
    assert_pass("T14: well-formed fail code-review → exit 0", "REQ-T14", "code-review",
                repo_root=repo, extra_env={"AGENT_FACTORY_REGISTRY_DIR": reg})

# T14b — fail review may include advisory P3 findings with recommendation
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_code_review("REQ-T14B", status="fail")
    report["findings"].append({
        "id": "CR-2",
        "severity": "P3",
        "file": "src/style.js",
        "line": 12,
        "title": "Style note",
        "detail": "Non-blocking cleanup suggestion.",
        "recommendation": "Consider moving helper near related code.",
    })
    repo = make_repo(tmp, "REQ-T14B", "code-review", report)
    reg = make_registry(tmp, "REQ-T14B", repo)
    assert_pass("T14b: fail code-review allows P3 recommendation-only finding → exit 0",
                "REQ-T14B", "code-review", repo_root=repo,
                extra_env={"AGENT_FACTORY_REGISTRY_DIR": reg})

# T14c — fail review still rejects missing required_fix for P1/P2 findings
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_code_review("REQ-T14C", status="fail")
    report["findings"][0].pop("required_fix")
    repo = make_repo(tmp, "REQ-T14C", "code-review", report)
    reg = make_registry(tmp, "REQ-T14C", repo)
    assert_fail("T14c: fail code-review requires required_fix for P1/P2 finding → fail",
                "REQ-T14C", "code-review", repo_root=repo,
                extra_env={"AGENT_FACTORY_REGISTRY_DIR": reg})

# T15 — acceptance pass may include a waived assertion only when covered by an approved environment waiver
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_acceptance_review("REQ-T15", status="pass")
    report["assertion_results"][1]["status"] = "waived"
    report["assertion_results"][1]["observed_result"] = "Skipped due to approved environment waiver waiver-REQ-T15-001"
    report["missing_evidence"] = [{
        "assertion_id": "A2",
        "required_artifact": "Docker regression output",
        "detail": "Covered by approved environment waiver waiver-REQ-T15-001"
    }]
    contract = minimal_contract("REQ-T15")
    repo = make_repo(tmp, "REQ-T15", "acceptance", report, contract_data=contract)
    reg = make_registry(tmp, "REQ-T15", repo, adu_extra={
        "human_gate_waivers": [{
            "waiver_id": "waiver-REQ-T15-001",
            "type": "environment",
            "from_state": "human_gate",
            "pre_gate_state": "code_reviewed",
            "to_state": "debugged",
            "comment": "Docker regression environment unavailable on this host.",
            "approved_by": "local-user",
            "created_at": "2026-06-12T00:00:00Z"
        }]
    })
    assert_pass("T15: acceptance pass allows waived assertion with approved environment waiver → exit 0",
                "REQ-T15", "acceptance", repo_root=repo,
                extra_env={"AGENT_FACTORY_REGISTRY_DIR": reg})

# T16 — acceptance pass with waived assertion but no approved environment waiver → fail
with tempfile.TemporaryDirectory() as tmp:
    report = minimal_acceptance_review("REQ-T16", status="pass")
    report["assertion_results"][1]["status"] = "waived"
    contract = minimal_contract("REQ-T16")
    repo = make_repo(tmp, "REQ-T16", "acceptance", report, contract_data=contract)
    reg = make_registry(tmp, "REQ-T16", repo)
    assert_fail("T16: acceptance pass rejects waived assertion without approved environment waiver → fail",
                "REQ-T16", "acceptance", repo_root=repo,
                extra_env={"AGENT_FACTORY_REGISTRY_DIR": reg})

# ── Summary ───────────────────────────────────────────────────────────────────

print(f"\n{passed + failed} tests: {passed} passed, {failed} failed")
if failed > 0:
    sys.exit(1)

#!/usr/bin/env python3
"""
Tests for validate_evidence_package.py.

Focus: runtime-assertion false-pass vectors.

  Hole A: contracts using the plain `acceptance` array format had every
          assertion hardcoded to verification_type "static", so runtime
          requirements were never enforced.
  Hole B: a self-reported top-level evidence package status of
          "success"/"passed" auto-satisfied every static assertion with
          zero per-assertion evidence.

Uses isolated temp directories to avoid touching the real registry.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate_evidence_package.py"

passed = 0
failed = 0


def run(adu, repo_root, registry_dir):
    cmd = [
        sys.executable, str(VALIDATOR),
        "--adu", adu,
        "--repo-root", repo_root,
        "--registry-dir", registry_dir,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode, result.stdout, result.stderr


def assert_exit(label, expected, adu, repo_root, registry_dir):
    global passed, failed
    rc, out, err = run(adu, repo_root, registry_dir)
    if rc == expected:
        print(f"✅  {label}")
        passed += 1
    else:
        print(f"❌  {label}: expected exit {expected} but got {rc}\n  stdout: {out.strip()}\n  stderr: {err.strip()}")
        failed += 1


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def setup(tmp, adu_id, contract, evidence, runtime_records=None):
    repo = Path(tmp) / "repo"
    write_json(repo / ".ai-agent" / "contracts" / f"{adu_id}.json", contract)
    write_json(repo / ".ai-agent" / "evidence" / f"{adu_id}.json", evidence)
    reg = Path(tmp) / "registry"
    reg.mkdir(parents=True, exist_ok=True)
    if runtime_records is not None:
        write_json(reg / "adu.json", {"adus": [{"id": adu_id, "runtime_evidence_records": runtime_records}]})
    return str(repo), str(reg)


print("Running validate_evidence_package tests...\n")

# T01 — the legacy plain `acceptance` array format is unsupported. The contract
# gate (validate_agent_contract.py) now requires structured `acceptance_assertions`,
# so this evidence validator rejects the plain-array format deterministically with
# a migration hint, instead of guessing runtime vs static from assertion text.
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T01",
        "acceptance": [
            "Run the end-to-end registration test via curl http://localhost:3000 and observe success",
        ],
    }
    evidence = {"status": "success"}  # self-report only, no per-assertion runtime evidence
    repo, reg = setup(tmp, "REQ-T01", contract, evidence)
    assert_exit("T01: legacy plain 'acceptance' array format is rejected → fail (1)",
                1, "REQ-T01", repo, reg)

# T02 — Hole B isolation: an explicitly static assertion with no per-assertion
# evidence must NOT pass on the self-reported package status alone (exit 1).
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T02",
        "acceptance_assertions": [
            {"id": "A1", "title": "config file present", "verification_type": "static", "must_pass": True},
        ],
    }
    evidence = {"status": "success"}  # self-report only, no entry for A1
    repo, reg = setup(tmp, "REQ-T02", contract, evidence)
    assert_exit("T02: static assertion w/ only self-reported package status → fail (1)",
                1, "REQ-T02", repo, reg)

# T03 — regression guard: a static assertion WITH real per-assertion evidence
# still passes (exit 0). Guards against over-tightening when removing Hole B.
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T03",
        "acceptance_assertions": [
            {"id": "A1", "title": "config file present", "verification_type": "static", "must_pass": True},
        ],
    }
    evidence = {"evidence": {"A1": {"status": "verified", "path": ".ai-agent/evidence/A1.json"}}}
    repo, reg = setup(tmp, "REQ-T03", contract, evidence)
    assert_exit("T03: static assertion w/ real per-assertion evidence → pass (0)",
                0, "REQ-T03", repo, reg)

# T04 — regression guard: a runtime assertion WITH real runtime evidence
# (command + exit 0 + output) still passes (exit 0).
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T04",
        "acceptance_assertions": [
            {"id": "A1", "title": "service responds", "verification_type": "runtime", "must_pass": True},
        ],
    }
    evidence = {"evidence": {"A1": {"command": "curl http://localhost:3000", "exitCode": 0, "output": "200 OK"}}}
    repo, reg = setup(tmp, "REQ-T04", contract, evidence)
    assert_exit("T04: runtime assertion w/ real runtime evidence → pass (0)",
                0, "REQ-T04", repo, reg)

# T05 — runtime evidence with a self-reported status:success but NO exitCode
# must NOT pass. A real exit code is required; a status string cannot stand in
# for it (evidence-dict path).
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T05",
        "acceptance_assertions": [
            {"id": "A1", "title": "service responds", "verification_type": "runtime", "must_pass": True},
        ],
    }
    evidence = {"evidence": {"A1": {"command": "curl http://localhost", "status": "success", "output": "200 OK"}}}
    repo, reg = setup(tmp, "REQ-T05", contract, evidence)
    assert_exit("T05: runtime evidence w/ status:success but no exitCode → human_gate (20)",
                20, "REQ-T05", repo, reg)

# T06 — same principle via the 'assertions' dict path: a runtime assertion with a
# self-reported status but no exitCode must NOT pass.
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T06",
        "acceptance_assertions": [
            {"id": "A1", "title": "service responds", "verification_type": "runtime", "must_pass": True},
        ],
    }
    evidence = {"assertions": {"A1": {"command": "curl http://localhost", "status": "passed", "observed_result": "200 OK"}}}
    repo, reg = setup(tmp, "REQ-T06", contract, evidence)
    assert_exit("T06: runtime evidence via assertions dict w/ status but no exitCode → human_gate (20)",
                20, "REQ-T06", repo, reg)

# T07 — runtime evidence with an empty command (and empty output) but exitCode 0
# must NOT pass. Field presence is not enough; command/output must be non-empty.
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T07",
        "acceptance_assertions": [
            {"id": "A1", "title": "service responds", "verification_type": "runtime", "must_pass": True},
        ],
    }
    evidence = {"evidence": {"A1": {"command": "", "exitCode": 0, "output": ""}}}
    repo, reg = setup(tmp, "REQ-T07", contract, evidence)
    assert_exit("T07: runtime evidence w/ empty command/output → human_gate (20)",
                20, "REQ-T07", repo, reg)

# T08 — runtime evidence with a real command + exitCode 0 but EMPTY output must
# NOT pass. Output/stdout must be non-empty.
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T08",
        "acceptance_assertions": [
            {"id": "A1", "title": "service responds", "verification_type": "runtime", "must_pass": True},
        ],
    }
    evidence = {"evidence": {"A1": {"command": "curl http://localhost", "exitCode": 0, "output": ""}}}
    repo, reg = setup(tmp, "REQ-T08", contract, evidence)
    assert_exit("T08: runtime evidence w/ empty output → human_gate (20)",
                20, "REQ-T08", repo, reg)

# T09 — evidence keyed by a different assertion id that merely *contains* the
# target id as a substring must NOT satisfy it. Matching is by exact id.
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T09",
        "acceptance_assertions": [
            {"id": "A1", "title": "service responds", "verification_type": "runtime", "must_pass": True},
        ],
    }
    # "A12" contains "A1" as a substring; with exact matching it must not count as A1.
    evidence = {"evidence": {"A12": {"command": "curl http://localhost", "exitCode": 0, "output": "200 OK"}}}
    repo, reg = setup(tmp, "REQ-T09", contract, evidence)
    assert_exit("T09: substring-only id match must not satisfy assertion → human_gate (20)",
                20, "REQ-T09", repo, reg)

# ── Real Contract Agent schema (automated_test / manual_review) ───────────────
# The Contract Agent emits verification_type "automated_test" and "manual_review"
# (see .ai-agent/prompts/contract-agent.md), NOT "runtime"/"static". These tests
# exercise the real vocabulary.

# T10 — an automated_test assertion is a RUNTIME assertion. Pseudo-static
# evidence ({"status":"verified","path":"fake.txt"}) must NOT satisfy it.
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T10",
        "acceptance_assertions": [
            {"id": "A1", "title": "endpoint works", "verification_type": "automated_test", "must_pass": True},
        ],
    }
    evidence = {"evidence": {"A1": {"status": "verified", "path": "fake.txt"}}}
    repo, reg = setup(tmp, "REQ-T10", contract, evidence)
    assert_exit("T10: automated_test w/ pseudo-static evidence → human_gate (20)",
                20, "REQ-T10", repo, reg)

# T11 — automated_test WITH real runtime evidence passes.
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T11",
        "acceptance_assertions": [
            {"id": "A1", "title": "endpoint works", "verification_type": "automated_test", "must_pass": True},
        ],
    }
    evidence = {"evidence": {"A1": {"command": "make test", "exitCode": 0, "output": "PASS: suite"}}}
    repo, reg = setup(tmp, "REQ-T11", contract, evidence)
    assert_exit("T11: automated_test w/ real runtime evidence → pass (0)",
                0, "REQ-T11", repo, reg)

# T12 — a manual_review assertion is satisfied by a static/manual evidence entry.
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T12",
        "acceptance_assertions": [
            {"id": "A1", "title": "doc reviewed", "verification_type": "manual_review", "must_pass": True},
        ],
    }
    evidence = {"evidence": {"A1": {"status": "verified", "path": ".ai-agent/evidence/A1.json"}}}
    repo, reg = setup(tmp, "REQ-T12", contract, evidence)
    assert_exit("T12: manual_review w/ static evidence → pass (0)",
                0, "REQ-T12", repo, reg)

# T13 — an unknown verification_type must fail rather than be silently treated
# as static (which would let a runtime requirement pass with weak evidence).
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T13",
        "acceptance_assertions": [
            {"id": "A1", "title": "??", "verification_type": "totally_unknown", "must_pass": True},
        ],
    }
    evidence = {"evidence": {"A1": {"status": "verified", "path": "x"}}}
    repo, reg = setup(tmp, "REQ-T13", contract, evidence)
    assert_exit("T13: unknown verification_type → fail (1)",
                1, "REQ-T13", repo, reg)

# ── runtime_evidence_records path (adu.json) ──────────────────────────────────

# T14 — a runtime record with an exact assertion_id but EMPTY command/output
# must NOT satisfy the assertion.
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T14",
        "acceptance_assertions": [
            {"id": "A1", "title": "svc", "verification_type": "runtime", "must_pass": True},
        ],
    }
    records = [{"assertion_id": "A1", "command": "", "output": "", "exitCode": 0}]
    repo, reg = setup(tmp, "REQ-T14", contract, {"status": "x"}, runtime_records=records)
    assert_exit("T14: runtime record w/ exact id but empty command/output → human_gate (20)",
                20, "REQ-T14", repo, reg)

# T15 — a runtime record that merely mentions "A12" in its text must NOT satisfy
# assertion "A1" (no substring / text-guess matching; exact assertion_id only).
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T15",
        "acceptance_assertions": [
            {"id": "A1", "title": "svc", "verification_type": "runtime", "must_pass": True},
        ],
    }
    records = [{"command": "run test A12", "output": "ok A12", "exitCode": 0}]
    repo, reg = setup(tmp, "REQ-T15", contract, {"status": "x"}, runtime_records=records)
    assert_exit("T15: runtime record substring-matching A12 must not satisfy A1 → human_gate (20)",
                20, "REQ-T15", repo, reg)

# T16 — a valid runtime record (exact assertion_id, non-empty command/output,
# exitCode 0) satisfies the assertion.
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T16",
        "acceptance_assertions": [
            {"id": "A1", "title": "svc", "verification_type": "automated_test", "must_pass": True},
        ],
    }
    records = [{"assertion_id": "A1", "command": "make test", "output": "PASS", "exitCode": 0}]
    repo, reg = setup(tmp, "REQ-T16", contract, {"status": "x"}, runtime_records=records)
    assert_exit("T16: valid runtime record (exact id, non-empty, exit 0) → pass (0)",
                0, "REQ-T16", repo, reg)

# T17 — a runtime record written with a plural `assertion_ids` list (the shape
# the Human Gate persists) satisfies a member assertion by exact membership.
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T17",
        "acceptance_assertions": [
            {"id": "A5", "title": "svc", "verification_type": "runtime", "must_pass": True},
        ],
    }
    records = [{"assertion_ids": ["A5", "A6"], "command": "make e2e", "output": "PASS", "exitCode": 0}]
    repo, reg = setup(tmp, "REQ-T17", contract, {"status": "x"}, runtime_records=records)
    assert_exit("T17: runtime record w/ plural assertion_ids (membership) → pass (0)",
                0, "REQ-T17", repo, reg)

# T18 — static/manual evidence is also matched by EXACT id only: an entry keyed
# "A12" must not satisfy assertion "A1" via substring.
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T18",
        "acceptance_assertions": [
            {"id": "A1", "title": "doc reviewed", "verification_type": "manual_review", "must_pass": True},
        ],
    }
    evidence = {"evidence": {"A12": {"status": "verified", "path": ".ai-agent/evidence/A12.json"}}}
    repo, reg = setup(tmp, "REQ-T18", contract, evidence)
    assert_exit("T18: static evidence keyed A12 must not satisfy A1 → fail (1)",
                1, "REQ-T18", repo, reg)

# T19 — static evidence w/ custom contract required_fields passes without generic fields
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T19",
        "acceptance_assertions": [
            {"id": "A1", "title": "Custom field", "verification_type": "manual_review", "must_pass": True},
        ],
        "evidence_requirements": [
            {
                "assertion_id": "A1",
                "artifact": "evidence.json",
                "required_fields": ["evidence.A1.observed_result"]
            }
        ]
    }
    evidence = {"evidence": {"A1": {"status": "success", "observed_result": "It works"}}}
    repo, reg = setup(tmp, "REQ-T19", contract, evidence)
    assert_exit("T19: custom fields override generic missing fields → pass (0)",
                0, "REQ-T19", repo, reg)

# T20 — valid waiver with matching human-gates.json passes
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T20",
        "acceptance_assertions": [
            {"id": "A1", "title": "Hard to test", "verification_type": "runtime", "must_pass": True},
        ]
    }
    evidence = {}
    repo, reg = setup(tmp, "REQ-T20", contract, evidence)
    write_json(Path(reg) / "evidence-waivers.json", {"waivers": [
        {
            "adu_id": "REQ-T20",
            "assertion_ids": ["A1"],
            "gate_id": "gate-1",
            "status": "approved",
            "approved_by": "user",
            "reason": "OK",
            "created_at": "now"
        }
    ]})
    write_json(Path(reg) / "human-gates.json", {
        "gates": [{"gate_id": "gate-1", "target_id": "REQ-T20"}]
    })
    assert_exit("T20: waiver with valid gate in human-gates.json → pass (0)",
                0, "REQ-T20", repo, reg)

# T21 — invalid waiver (no matching gate) fails
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T21",
        "acceptance_assertions": [
            {"id": "A1", "title": "Hard to test", "verification_type": "runtime", "must_pass": True},
        ]
    }
    evidence = {}
    repo, reg = setup(tmp, "REQ-T21", contract, evidence)
    write_json(Path(reg) / "evidence-waivers.json", {"waivers": [
        {
            "adu_id": "REQ-T21",
            "assertion_ids": ["A1"],
            "gate_id": "gate-1",
            "status": "approved",
            "approved_by": "user",
            "reason": "OK",
            "created_at": "now"
        }
    ]})
    write_json(Path(reg) / "human-gates.json", {
        "gates": [{"gate_id": "gate-other", "target_id": "REQ-T21"}]
    })
    assert_exit("T21: waiver with missing gate → human_gate (20)",
                20, "REQ-T21", repo, reg)

# ── Summary ───────────────────────────────────────────────────────────────────


print(f"\n{passed + failed} tests: {passed} passed, {failed} failed")
if failed > 0:
    sys.exit(1)

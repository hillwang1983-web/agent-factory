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


def setup(tmp, adu_id, contract, evidence):
    repo = Path(tmp) / "repo"
    write_json(repo / ".ai-agent" / "contracts" / f"{adu_id}.json", contract)
    write_json(repo / ".ai-agent" / "evidence" / f"{adu_id}.json", evidence)
    reg = Path(tmp) / "registry"
    reg.mkdir(parents=True, exist_ok=True)
    return str(repo), str(reg)


print("Running validate_evidence_package tests...\n")

# T01 — Hole A+B composition: `acceptance`-format runtime requirement that is
# only "verified" by a self-reported package status must NOT pass. It needs
# real runtime evidence, so the validator should demand a human gate (exit 20).
with tempfile.TemporaryDirectory() as tmp:
    contract = {
        "adu_id": "REQ-T01",
        "acceptance": [
            "Run the end-to-end registration test via curl http://localhost:3000 and observe success",
        ],
    }
    evidence = {"status": "success"}  # self-report only, no per-assertion runtime evidence
    repo, reg = setup(tmp, "REQ-T01", contract, evidence)
    assert_exit("T01: acceptance-format runtime requirement w/ only self-reported status → human_gate (20)",
                20, "REQ-T01", repo, reg)

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

# ── Summary ───────────────────────────────────────────────────────────────────

print(f"\n{passed + failed} tests: {passed} passed, {failed} failed")
if failed > 0:
    sys.exit(1)

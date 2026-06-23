#!/usr/bin/env python3
"""
Regression tests for validate_agent_contract.py, focusing on command_policy enforcement (P1b).

Each test uses an isolated temp registry and temp repo dir via AGENT_FACTORY_REGISTRY_DIR,
so no production files are touched.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate_agent_contract.py"

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


def write_json(path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")


def make_adu(adu_id, repo_path, command_policy=None):
    adu = {
        "id": adu_id,
        "project_id": "test-proj",
        "repo_path": str(repo_path),
        "allowed_write_paths": [".ai-agent/"],
        "allowed_read_paths": [".agent-factory/"],
        "state": "contracted",
    }
    if command_policy is not None:
        adu["command_policy"] = command_policy
    return adu


def make_contract(adu_id, verification_command=None, manual_steps=None, vtype="automated_test"):
    """Build a minimal valid contract, with customisable verification method."""
    assertion = {
        "id": "A1",
        "title": "Basic assertion",
        "requirement": "System must pass tests",
        "verification_type": vtype,
        "expected_evidence": ["test run output"],
        "must_pass": True,
    }
    if verification_command is not None:
        assertion["verification_command"] = verification_command
    if manual_steps is not None:
        assertion["manual_verification_steps"] = manual_steps

    return {
        "version": 2,
        "adu_id": adu_id,
        "source_documents": {
            "analysis": f".ai-agent/analysis/{adu_id}.md",
            "design": f".ai-agent/designs/{adu_id}-detailed-design.md",
        },
        "scope": {
            "in_scope": ["test behaviour"],
            "out_of_scope": [],
            "allowed_write_paths": [".ai-agent/evidence/"],
        },
        "acceptance_assertions": [assertion],
        "negative_assertions": [
            {"id": "N1", "title": "No regressions", "forbidden_change": "No prior tests broken", "must_pass": True}
        ],
        "evidence_requirements": [
            {
                "id": "E1",
                "assertion_id": "A1",
                "artifact": f".ai-agent/evidence/{adu_id}.md",
                "required_fields": ["assertions.A1.status"],
            }
        ],
        "quality_gates": {"minimum_assertions": 1, "minimum_negative_assertions": 1},
    }


def run_validator(adu_id, repo_root, registry_dir):
    env = os.environ.copy()
    env["AGENT_FACTORY_REGISTRY_DIR"] = str(registry_dir)
    proc = subprocess.run(
        [sys.executable, str(VALIDATOR), "--adu", adu_id, "--repo-root", str(repo_root)],
        capture_output=True, text=True, env=env,
    )
    return proc.returncode, proc.stdout, proc.stderr


ALLOWLIST_POLICY = {
    "mode": "allowlist",
    "allowed_commands": ["meson test -C build", "npm test"],
    "blocked_command_patterns": ["rm -rf", "sudo "],
}

ADU_ID = "REQ-CONTRACT-TEST-001"

print("Running validate_agent_contract.py regression tests...\n")

# ── T01: Valid contract with allowed command → pass ───────────────────────────
with tempfile.TemporaryDirectory() as tmp:
    repo = Path(tmp) / "repo"
    reg = Path(tmp) / "registry"
    write_json(reg / "adu.json", {"version": 1, "adus": [make_adu(ADU_ID, repo, ALLOWLIST_POLICY)]})
    write_json(repo / ".ai-agent" / "contracts" / f"{ADU_ID}.json",
               make_contract(ADU_ID, verification_command="meson test -C build"))
    rc, out, err = run_validator(ADU_ID, repo, reg)
    if rc == 0 and "PASS" in out:
        ok("T01: Valid contract with allowed command → exit 0")
    else:
        fail("T01: Valid contract with allowed command → exit 0", f"rc={rc} out={out.strip()!r} err={err.strip()!r}")

# ── T02: Allowed command with extra flags (prefix match) → pass ───────────────
with tempfile.TemporaryDirectory() as tmp:
    repo = Path(tmp) / "repo"
    reg = Path(tmp) / "registry"
    write_json(reg / "adu.json", {"version": 1, "adus": [make_adu(ADU_ID, repo, ALLOWLIST_POLICY)]})
    write_json(repo / ".ai-agent" / "contracts" / f"{ADU_ID}.json",
               make_contract(ADU_ID, verification_command="meson test -C build --suite unit"))
    rc, out, err = run_validator(ADU_ID, repo, reg)
    if rc == 0:
        ok("T02: Allowed command with extra flags (prefix match) → exit 0")
    else:
        fail("T02: Allowed command with extra flags (prefix match) → exit 0", f"rc={rc} err={err.strip()!r}")

# ── T03: verification_command not in allowlist → fail ────────────────────────
with tempfile.TemporaryDirectory() as tmp:
    repo = Path(tmp) / "repo"
    reg = Path(tmp) / "registry"
    write_json(reg / "adu.json", {"version": 1, "adus": [make_adu(ADU_ID, repo, ALLOWLIST_POLICY)]})
    write_json(repo / ".ai-agent" / "contracts" / f"{ADU_ID}.json",
               make_contract(ADU_ID, verification_command="npm run build"))
    rc, out, err = run_validator(ADU_ID, repo, reg)
    if rc != 0 and "not in allowed_commands" in err:
        ok("T03: Command not in allowlist → rejected")
    else:
        fail("T03: Command not in allowlist → rejected", f"rc={rc} err={err.strip()!r}")

# ── T04: verification_command matches blocked_command_patterns → fail ─────────
with tempfile.TemporaryDirectory() as tmp:
    repo = Path(tmp) / "repo"
    reg = Path(tmp) / "registry"
    write_json(reg / "adu.json", {"version": 1, "adus": [make_adu(ADU_ID, repo, ALLOWLIST_POLICY)]})
    write_json(repo / ".ai-agent" / "contracts" / f"{ADU_ID}.json",
               make_contract(ADU_ID, verification_command="rm -rf /tmp/build"))
    rc, out, err = run_validator(ADU_ID, repo, reg)
    if rc != 0 and "blocked pattern" in err:
        ok("T04: Blocked command pattern → rejected")
    else:
        fail("T04: Blocked command pattern → rejected", f"rc={rc} err={err.strip()!r}")

# ── T05: sudo prefix matches blocked pattern → fail ──────────────────────────
with tempfile.TemporaryDirectory() as tmp:
    repo = Path(tmp) / "repo"
    reg = Path(tmp) / "registry"
    write_json(reg / "adu.json", {"version": 1, "adus": [make_adu(ADU_ID, repo, ALLOWLIST_POLICY)]})
    write_json(repo / ".ai-agent" / "contracts" / f"{ADU_ID}.json",
               make_contract(ADU_ID, verification_command="sudo meson test -C build"))
    rc, out, err = run_validator(ADU_ID, repo, reg)
    if rc != 0 and "blocked pattern" in err:
        ok("T05: sudo prefix matches blocked pattern → rejected")
    else:
        fail("T05: sudo prefix matches blocked pattern → rejected", f"rc={rc} err={err.strip()!r}")

# ── T06: No command_policy on ADU → check skipped → pass ─────────────────────
with tempfile.TemporaryDirectory() as tmp:
    repo = Path(tmp) / "repo"
    reg = Path(tmp) / "registry"
    write_json(reg / "adu.json", {"version": 1, "adus": [make_adu(ADU_ID, repo, command_policy=None)]})
    write_json(repo / ".ai-agent" / "contracts" / f"{ADU_ID}.json",
               make_contract(ADU_ID, verification_command="arbitrary-unlisted-command"))
    rc, out, err = run_validator(ADU_ID, repo, reg)
    if rc == 0:
        ok("T06: No command_policy on ADU → policy check skipped → pass")
    else:
        fail("T06: No command_policy on ADU → policy check skipped → pass", f"rc={rc} err={err.strip()!r}")

# ── T07: manual_verification_steps only → policy check not applied → pass ────
with tempfile.TemporaryDirectory() as tmp:
    repo = Path(tmp) / "repo"
    reg = Path(tmp) / "registry"
    write_json(reg / "adu.json", {"version": 1, "adus": [make_adu(ADU_ID, repo, ALLOWLIST_POLICY)]})
    write_json(repo / ".ai-agent" / "contracts" / f"{ADU_ID}.json",
               make_contract(ADU_ID, manual_steps=["Manually verify the service is reachable"], vtype="manual_review"))
    rc, out, err = run_validator(ADU_ID, repo, reg)
    if rc == 0:
        ok("T07: manual_verification_steps only → policy check not applied → pass")
    else:
        fail("T07: manual_verification_steps only → policy check not applied → pass", f"rc={rc} err={err.strip()!r}")

# ── T08: evidence requirement may reference negative assertion id → pass ─────
with tempfile.TemporaryDirectory() as tmp:
    repo = Path(tmp) / "repo"
    reg = Path(tmp) / "registry"
    write_json(reg / "adu.json", {"version": 1, "adus": [make_adu(ADU_ID, repo, ALLOWLIST_POLICY)]})
    contract = make_contract(ADU_ID, verification_command="meson test -C build")
    contract["evidence_requirements"].append({
        "id": "E_NEG_1",
        "assertion_id": "N1",
        "artifact": f".ai-agent/evidence/{ADU_ID}.md",
        "required_fields": ["negative_assertions.N1.status"],
    })
    write_json(repo / ".ai-agent" / "contracts" / f"{ADU_ID}.json", contract)
    rc, out, err = run_validator(ADU_ID, repo, reg)
    if rc == 0:
        ok("T08: evidence requirement may reference negative assertion id → pass")
    else:
        fail("T08: evidence requirement may reference negative assertion id → pass", f"rc={rc} err={err.strip()!r}")

# ── Summary ───────────────────────────────────────────────────────────────────
print(f"\n{passed + failed} tests: {passed} passed, {failed} failed")
if failed > 0:
    sys.exit(1)

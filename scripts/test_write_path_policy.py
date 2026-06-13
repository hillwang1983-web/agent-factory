#!/usr/bin/env python3
"""
Unit tests for write_path_policy.py and policy checks in validate_agent_contract.py.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POLICY_SCRIPT = ROOT / "scripts" / "write_path_policy.py"
CONTRACT_VALIDATOR = ROOT / "scripts" / "validate_agent_contract.py"

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

def run_policy(adu_id, requested_paths, reg_dir, rules_path=None):
    cmd = [sys.executable, str(POLICY_SCRIPT), "--adu", adu_id, "--requested-paths", requested_paths]
    if rules_path:
        cmd.extend(["--rules", str(rules_path)])

    env = os.environ.copy()
    env["AGENT_FACTORY_REGISTRY_DIR"] = str(reg_dir)
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout, res.stderr

def run_validator(adu_id, reg_dir, repo_dir):
    cmd = [sys.executable, str(CONTRACT_VALIDATOR), "--adu", adu_id, "--repo-root", str(repo_dir)]
    env = os.environ.copy()
    env["AGENT_FACTORY_REGISTRY_DIR"] = str(reg_dir)
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return res.returncode, res.stdout, res.stderr

def test_policy_engine():
    global passed, failed
    print("Running Write Path Policy Engine tests...")

    with tempfile.TemporaryDirectory() as temp_dir:
        td = Path(temp_dir)
        reg_dir = td / "registry"
        rules_path = td / "path-derivation-rules.json"

        # Write custom rules config
        rules_config = {
            "version": 1,
            "rules": [
                {
                    "id": "meson-rule",
                    "when_requested_path_matches": ["lib/app/*.c"],
                    "allow_derived_paths": ["lib/app/meson.build"],
                    "risk": "low"
                }
            ],
            "blocked_paths": [
                ".git/",
                ".ai-agent/registry/projects.json",
                ".ai-agent/registry/agent-model-settings.json",
                ".ai-agent/registry/adu.json",
                ".ai-agent/registry/runs.json",
                ".ai-agent/registry/epics.json",
                ".ai-agent/registry/token-budget.json",
                ".ai-agent/registry/write-path-expansion-requests.json",
                "**/.env",
                ".env",
                "*.env",
                "**/id_rsa",
                "**/secrets*",
                "secrets*"
            ],
            "high_risk_prefixes": [
                "lib/core/"
            ]
        }
        write_json(rules_path, rules_config)

        # Write registry adu.json
        adu_registry = {
            "version": 1,
            "adus": [
                {
                    "id": "REQ-001",
                    "allowed_write_paths": [
                        "lib/app/main.c"
                    ],
                    "allowed_read_paths": [
                        "lib/app/main.c"
                    ]
                }
            ]
        }
        write_json(reg_dir / "adu.json", adu_registry)

        # 1. Test case: Already covered path
        rc, out, err = run_policy("REQ-001", "lib/app/main.c", reg_dir, rules_path)
        if rc != 0:
            fail("Already covered path run", err)
        else:
            res = json.loads(out)
            if res["result"] == "approved" and res["decision"] == "auto_approved":
                ok("Already covered path correctly returned auto_approved")
            else:
                fail("Already covered path returned incorrect decision", out)

        # 2. Test case: Blocked sensitive path
        rc, out, err = run_policy("REQ-001", ".git/config", reg_dir, rules_path)
        if rc != 0:
            fail("Blocked path run failed", err)
        else:
            res = json.loads(out)
            if res["result"] == "blocked" and res["decision"] == "blocked":
                ok("Sensitive blocked path correctly returned blocked")
            else:
                fail("Sensitive blocked path returned incorrect decision", out)

        # 3. Test case: Derived low-risk path
        rc, out, err = run_policy("REQ-001", "lib/app/meson.build", reg_dir, rules_path)
        if rc != 0:
            fail("Derived path run failed", err)
        else:
            res = json.loads(out)
            if res["result"] == "approved" and res["decision"] == "auto_approved" and "meson-rule" in res["reason"]:
                ok("Low-risk derived path correctly returned auto_approved matching rule")
            else:
                fail("Low-risk derived path returned incorrect decision", out)

        # 4. Test case: Medium risk path (pending human approval)
        rc, out, err = run_policy("REQ-001", "lib/other/file.c", reg_dir, rules_path)
        if rc != 0:
            fail("Medium risk path run failed", err)
        else:
            res = json.loads(out)
            if res["result"] == "pending" and res["decision"] == "pending_human_approval" and res["risk"] == "medium":
                ok("Medium risk path correctly returned pending_human_approval")
            else:
                fail("Medium risk path returned incorrect decision", out)

        # 5. Test case: High risk path (pending human approval, risk = high)
        rc, out, err = run_policy("REQ-001", "lib/core/main.c", reg_dir, rules_path)
        if rc != 0:
            fail("High risk path run failed", err)
        else:
            res = json.loads(out)
            if res["result"] == "pending" and res["decision"] == "pending_human_approval" and res["risk"] == "high":
                ok("High risk prefix correctly returned pending_human_approval with high risk")
            else:
                fail("High risk prefix returned incorrect decision", out)

        # 6. Test case: Root .env path (should match **/.env and be blocked)
        rc, out, err = run_policy("REQ-001", ".env", reg_dir, rules_path)
        if rc != 0:
            fail("Root .env path run failed", err)
        else:
            res = json.loads(out)
            if res["result"] == "blocked" and res["decision"] == "blocked":
                ok("Root .env path correctly returned blocked")
            else:
                fail("Root .env path returned incorrect decision", out)

        # 7. Test case: Subdirectory .env path (should match **/.env and be blocked)
        rc, out, err = run_policy("REQ-001", "subdir/.env", reg_dir, rules_path)
        if rc != 0:
            fail("Subdirectory .env path run failed", err)
        else:
            res = json.loads(out)
            if res["result"] == "blocked" and res["decision"] == "blocked":
                ok("Subdirectory .env path correctly returned blocked")
            else:
                fail("Subdirectory .env path returned incorrect decision", out)

        # 8. Test case: Root secrets.txt path (should match secrets* and be blocked)
        rc, out, err = run_policy("REQ-001", "secrets.txt", reg_dir, rules_path)
        if rc != 0:
            fail("Root secrets.txt path run failed", err)
        else:
            res = json.loads(out)
            if res["result"] == "blocked" and res["decision"] == "blocked":
                ok("Root secrets.txt path correctly returned blocked")
            else:
                fail("Root secrets.txt path returned incorrect decision", out)

        # 9. Test case: Registry files (should be blocked)
        rc, out, err = run_policy("REQ-001", ".ai-agent/registry/adu.json", reg_dir, rules_path)
        if rc != 0:
            fail("Registry adu.json path run failed", err)
        else:
            res = json.loads(out)
            if res["result"] == "blocked" and res["decision"] == "blocked":
                ok("Registry adu.json path correctly returned blocked")
            else:
                fail("Registry adu.json path returned incorrect decision", out)

def test_contract_validator_integration():
    global passed, failed
    print("Running Contract Validator Integration tests...")

    with tempfile.TemporaryDirectory() as temp_dir:
        td = Path(temp_dir)
        reg_dir = td / "registry"
        repo_dir = td / "repo"

        # Write rules config
        rules_config = {
            "version": 1,
            "rules": [
                {
                    "id": "meson-rule",
                    "when_requested_path_matches": ["lib/app/*.c"],
                    "allow_derived_paths": ["lib/app/meson.build"],
                    "risk": "low"
                }
            ],
            "blocked_paths": [
                ".git/",
                ".ai-agent/registry/projects.json",
                ".ai-agent/registry/agent-model-settings.json",
                ".ai-agent/registry/adu.json",
                ".ai-agent/registry/runs.json",
                ".ai-agent/registry/epics.json",
                ".ai-agent/registry/token-budget.json",
                ".ai-agent/registry/write-path-expansion-requests.json",
                "**/.env",
                ".env",
                "*.env",
                "**/id_rsa",
                "**/secrets*",
                "secrets*"
            ],
            "high_risk_prefixes": ["lib/core/"]
        }
        write_json(reg_dir / "path-derivation-rules.json", rules_config)
        # Note: write_path_policy.py resolves rules path relative to script parent if not overridden,
        # so we also copy the rules to the real .ai-agent/policies location, or rely on validator using the resolved registry.
        os.makedirs(repo_dir / ".ai-agent" / "policies", exist_ok=True)
        write_json(repo_dir / ".ai-agent" / "policies" / "path-derivation-rules.json", rules_config)

        # Write registry adu.json
        adu_registry = {
            "version": 1,
            "adus": [
                {
                    "id": "REQ-002",
                    "allowed_write_paths": ["lib/app/main.c"],
                    "allowed_read_paths": ["lib/app/main.c"],
                    "state": "contracted"
                }
            ]
        }
        write_json(reg_dir / "adu.json", adu_registry)

        # Helper to write contract JSON
        def write_contract(allowed_write_paths):
            contract_data = {
                "version": 2,
                "adu_id": "REQ-002",
                "source_documents": {
                    "analysis": ".ai-agent/analysis/REQ-002.md",
                    "design": ".ai-agent/designs/REQ-002-detailed-design.md"
                },
                "scope": {
                    "in_scope": ["test"],
                    "out_of_scope": ["test"],
                    "allowed_write_paths": allowed_write_paths
                },
                "acceptance_assertions": [
                    {
                        "id": "A1", "title": "A1", "requirement": "R1", "verification_type": "manual_review",
                        "manual_verification_steps": ["Check"], "expected_evidence": ["Evidence"], "must_pass": True
                    },
                    {
                        "id": "A2", "title": "A2", "requirement": "R2", "verification_type": "manual_review",
                        "manual_verification_steps": ["Check"], "expected_evidence": ["Evidence"], "must_pass": True
                    },
                    {
                        "id": "A3", "title": "A3", "requirement": "R3", "verification_type": "manual_review",
                        "manual_verification_steps": ["Check"], "expected_evidence": ["Evidence"], "must_pass": True
                    }
                ],
                "negative_assertions": [
                    {
                        "id": "N1", "title": "N1", "forbidden_change": "No change",
                        "manual_verification_steps": ["Check"], "must_pass": True
                    }
                ],
                "evidence_requirements": [
                    {
                        "id": "E1", "assertion_id": "A1", "artifact": ".ai-agent/evidence/REQ-002.json",
                        "required_fields": ["status"]
                    }
                ],
                "quality_gates": {}
            }
            write_json(repo_dir / ".ai-agent" / "contracts" / "REQ-002.json", contract_data)

        # 1. Test case: Contract allowed paths are covered -> PASS (exit 0)
        write_contract(["lib/app/main.c"])
        rc, out, err = run_validator("REQ-002", reg_dir, repo_dir)
        if rc != 0:
            fail("Contract validation failed when all paths covered", f"rc={rc}\nout={out}\nerr={err}")
        else:
            ok("Contract validation passed successfully for covered paths")

        # 2. Test case: Contract allowed paths require auto-approved paths -> Auto-approves, updates adu.json, exits 0
        write_contract(["lib/app/main.c", "lib/app/meson.build"])
        rc, out, err = run_validator("REQ-002", reg_dir, repo_dir)
        if rc != 0:
            fail("Contract validation failed for auto-approved derived paths", f"rc={rc}\nout={out}\nerr={err}")
        else:
            # Check if adu.json was updated with meson.build
            updated_adu_registry = json.loads((reg_dir / "adu.json").read_text(encoding="utf-8"))
            updated_adu = updated_adu_registry["adus"][0]
            if "lib/app/meson.build" in updated_adu["allowed_write_paths"]:
                ok("Contract validation auto-approved low-risk derived paths and updated adu.json")
            else:
                fail("Contract validation succeeded but did not update adu.json allowed_write_paths", str(updated_adu))

        # 3. Test case: Contract allowed paths require medium-risk paths -> registers request, exits 20
        write_contract(["lib/app/main.c", "lib/other/file.c"])
        # Reset adu.json to remove previous additions
        write_json(reg_dir / "adu.json", adu_registry)
        rc, out, err = run_validator("REQ-002", reg_dir, repo_dir)
        if rc != 20:
            fail("Contract validation did not return exit code 20 for pending path", f"rc={rc}\nout={out}\nerr={err}")
        else:
            # Check write-path-expansion-requests.json
            req_file = reg_dir / "write-path-expansion-requests.json"
            if req_file.exists():
                req_data = json.loads(req_file.read_text(encoding="utf-8"))
                pending_reqs = [r for r in req_data.get("requests", []) if r["decision"] == "pending_human_approval"]
                if len(pending_reqs) > 0 and "lib/other/file.c" in pending_reqs[0]["requested_paths"]:
                    ok("Contract validation returned exit code 20 and correctly registered pending request")
                else:
                    fail("Pending request was registered but paths/details are incorrect", str(req_data))
            else:
                fail("Exit code 20 returned but write-path-expansion-requests.json was not created")

        # 4. Test case: Contract allowed paths require blocked paths -> exits 1
        write_contract(["lib/app/main.c", ".git/config"])
        write_json(reg_dir / "adu.json", adu_registry)
        rc, out, err = run_validator("REQ-002", reg_dir, repo_dir)
        if rc != 1:
            fail("Contract validation did not fail with exit code 1 for blocked path", f"rc={rc}\nout={out}\nerr={err}")
        else:
            ok("Contract validation failed with exit code 1 for blocked path")

if __name__ == "__main__":
    test_policy_engine()
    test_contract_validator_integration()

    print(f"\nSummary: {passed} passed, {failed} failed.")
    sys.exit(1 if failed > 0 else 0)

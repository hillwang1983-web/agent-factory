#!/usr/bin/env python3
import sys
import os
import json
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Validate ADU evidence package against contract assertions.")
    parser.add_argument("--adu", required=True, help="ADU ID")
    parser.add_argument("--repo-root", required=True, help="Path to repo root")
    parser.add_argument("--registry-dir", required=True, help="Path to registry directory")
    args = parser.parse_args()

    adu_id = args.adu
    repo_root = Path(args.repo_root)
    registry_dir = Path(args.registry_dir)

    contract_file = repo_root / ".ai-agent" / "contracts" / f"{adu_id}.json"
    evidence_file = repo_root / ".ai-agent" / "evidence" / f"{adu_id}.json"
    waivers_file = registry_dir / "evidence-waivers.json"
    adu_file = registry_dir / "adu.json"

    # 1. Load Contract
    if not contract_file.exists():
        print(f"FAIL: Contract file for {adu_id} does not exist at {contract_file}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(contract_file, 'r', encoding='utf-8') as f:
            contract = json.load(f)
    except Exception as e:
        print(f"FAIL: Failed to parse contract JSON: {e}", file=sys.stderr)
        sys.exit(1)

    # Convert acceptance/acceptance_criteria to standard format
    assertions = []
    if "acceptance_assertions" in contract:
        assertions = contract["acceptance_assertions"]
    elif "acceptance_criteria" in contract:
        for ac in contract["acceptance_criteria"]:
            method = ac.get("method", "")
            title = ac.get("title", "")
            is_runtime = "run" in title.lower() or "post" in method.lower() or "get" in method.lower() or "inspect" in method.lower()
            assertions.append({
                "id": ac["id"],
                "title": title,
                "verification_type": "runtime" if is_runtime else "static",
                "must_pass": True,
                "expected_evidence": [ac.get("expected", "")]
            })
    elif "acceptance" in contract:
        # The plain `acceptance` array is a legacy, pre-per-assertion format: no
        # assertion ids, no verification types. The contract gate
        # (validate_agent_contract.py) now requires structured
        # `acceptance_assertions`, so this format is unsupported here. Reject it
        # deterministically with a migration hint instead of guessing runtime vs
        # static from assertion text (keyword guessing misclassifies, e.g.
        # "runnable validation" -> runtime).
        print(
            f"FAIL: Contract {adu_id} uses the legacy plain 'acceptance' array format, "
            f"which is unsupported. Migrate it to structured 'acceptance_assertions' "
            f"with an explicit 'verification_type' per assertion.",
            file=sys.stderr,
        )
        sys.exit(1)

    # 2. Load Waivers
    waivers = []
    if waivers_file.exists():
        try:
            with open(waivers_file, 'r', encoding='utf-8') as f:
                waivers = json.load(f).get("waivers", [])
        except Exception as e:
            print(f"WARNING: Failed to parse waivers JSON: {e}", file=sys.stderr)

    # Filter waivers for this ADU
    adu_waivers = [w for w in waivers if w.get("adu_id") == adu_id]

    # 3. Load Evidence
    evidence_data = {}
    if evidence_file.exists():
        try:
            with open(evidence_file, 'r', encoding='utf-8') as f:
                evidence_data = json.load(f)
        except Exception as e:
            print(f"WARNING: Failed to parse evidence JSON: {e}", file=sys.stderr)

    # 4. Load adu.json to check manual execution records
    runtime_records = []
    if adu_file.exists():
        try:
            with open(adu_file, 'r', encoding='utf-8') as f:
                adus = json.load(f).get("adus", [])
                adu = next((a for a in adus if a.get("id") == adu_id), None)
                if adu and "runtime_evidence_records" in adu:
                    runtime_records = adu["runtime_evidence_records"]
        except Exception as e:
            print(f"WARNING: Failed to parse adu.json: {e}", file=sys.stderr)

    # Map the Contract Agent's verification_type vocabulary to evidence kind.
    # "automated_test" requires real runtime evidence; "manual_review" is a
    # static/manual check. ("runtime"/"static" also occur via the
    # acceptance_criteria conversion above.) Unknown types are rejected rather
    # than silently treated as static, which would let a runtime requirement
    # pass with weak evidence.
    RUNTIME_TYPES = {"automated_test", "runtime"}
    STATIC_TYPES = {"manual_review", "static"}

    missing_runtime = []
    missing_static = []
    unknown_types = []

    for ass in assertions:
        ass_id = ass.get("id")
        vtype = ass.get("verification_type")
        must_pass = ass.get("must_pass", True)

        if not must_pass:
            continue

        if vtype in RUNTIME_TYPES:
            is_runtime = True
        elif vtype in STATIC_TYPES:
            is_runtime = False
        else:
            unknown_types.append((ass_id, vtype))
            continue

        # Check if waived
        is_waived = any(ass_id in w.get("assertion_ids", []) for w in adu_waivers)
        if is_waived:
            continue

        # Check if evidence exists
        has_evidence = False
        evidence_dict = evidence_data.get("evidence", {})
        assertions_dict = evidence_data.get("assertions", {})

        if not is_runtime:
            for key, val in evidence_dict.items():
                if ass_id.lower() in key.lower():
                    has_evidence = True
                    break
                if isinstance(val, dict) and val.get("path") and ass_id in val.get("path"):
                    has_evidence = True
                    break
                if isinstance(val, dict) and val.get("status") == "verified" and ass_id in str(val):
                    has_evidence = True
                    break

            # Check inside 'assertions' dict if not found in 'evidence'
            if not has_evidence and ass_id in assertions_dict:
                val = assertions_dict[ass_id]
                if isinstance(val, dict) and val.get("status") in ("passed", "success", "pass"):
                    has_evidence = True

            # NOTE: a self-reported top-level evidence package status
            # ("success"/"passed") is deliberately NOT accepted as evidence here.
            # Per-assertion evidence is required; trusting the agent's own
            # package status would let assertions pass with no real artifact.
        else:
            # Runtime assertions: MUST have concrete runtime evidence

            # 1. Check evidence.json matching entries for command, exitCode, output
            for key, val in evidence_dict.items():
                # Match evidence to the assertion by EXACT id (dict key or an
                # explicit assertion_id), never a loose substring like "A1" in "A12".
                if key == ass_id or (isinstance(val, dict) and val.get("assertion_id") == ass_id):
                    if isinstance(val, dict):
                        sub = val.get("script_result") or val.get("curl_output") or val.get("executed_script") or val
                        cmd_val = sub.get("command") or sub.get("script") or ""
                        out_val = sub.get("output") or sub.get("stdout") or ""
                        # Runtime evidence requires a non-empty command, non-empty
                        # output, and a real exit code 0. Field presence alone is not
                        # enough, and a self-reported status is not accepted.
                        has_cmd = bool(str(cmd_val).strip())
                        has_code = sub.get("exitCode") == 0 or sub.get("exit_code") == 0
                        has_out = bool(str(out_val).strip())
                        if has_cmd and has_code and has_out:
                            has_evidence = True
                            break

            # Also check 'assertions' dict for runtime execution evidence
            if not has_evidence and ass_id in assertions_dict:
                val = assertions_dict[ass_id]
                if isinstance(val, dict):
                    cmd_val = val.get("command") or ""
                    out_val = val.get("observed_result") or val.get("output") or ""
                    # Same rule: non-empty command + output and a real exit code 0.
                    has_cmd = bool(str(cmd_val).strip())
                    has_code = val.get("exitCode") == 0 or val.get("exit_code") == 0
                    has_out = bool(str(out_val).strip())
                    if has_cmd and has_code and has_out:
                        has_evidence = True

            # 2. Check runtime records (runtime_evidence_records in adu.json).
            # Require an EXACT assertion_id, a real exit code 0, and a non-empty
            # command + output. No substring/text guessing (so an "A12" record
            # cannot satisfy "A1"), and no empty-content records.
            if not has_evidence:
                for r in runtime_records:
                    # Exact id match only: a plural `assertion_ids` list (written
                    # by the Human Gate) by membership, or a singular
                    # `assertion_id`. No substring/text guessing.
                    r_ids = r.get("assertion_ids")
                    if isinstance(r_ids, list):
                        matched = ass_id in r_ids
                    else:
                        matched = (r.get("assertion_id") or r.get("assertionId") or "") == ass_id
                    if not matched:
                        continue
                    cmd = str(r.get("command") or "").strip()
                    out = str(r.get("output") or r.get("stdout") or "").strip()
                    has_code = r.get("exitCode") == 0 or r.get("exit_code") == 0
                    if cmd and out and has_code:
                        has_evidence = True
                        break

        if not has_evidence:
            if is_runtime:
                missing_runtime.append(ass)
            else:
                missing_static.append(ass)

    if unknown_types:
        detail = ', '.join(f"{aid} ('{vt}')" for aid, vt in unknown_types)
        print(f"FAIL: Unknown verification_type for assertions: {detail}. "
              f"Allowed: automated_test, manual_review.", file=sys.stderr)
        sys.exit(1)

    if missing_static:
        print(f"FAIL: Missing static evidence for assertions: {', '.join(a['id'] for a in missing_static)}", file=sys.stderr)
        sys.exit(1)

    if missing_runtime:
        print(f"HUMAN_GATE: Missing runtime environment/evidence for assertions: {', '.join(a['id'] for a in missing_runtime)}", file=sys.stderr)
        # Standard return for human gate requirement is exit code 20
        sys.exit(20)

    print("PASS: All contract assertions have valid evidence/waivers.")
    sys.exit(0)

if __name__ == "__main__":
    main()

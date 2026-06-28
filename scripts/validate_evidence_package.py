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

    # Filter and validate waivers for this ADU
    gates_file = registry_dir / "human-gates.json"
    gates_data = []
    if gates_file.exists():
        try:
            with open(gates_file, 'r', encoding='utf-8') as f:
                gates_data = json.load(f).get("gates", [])
        except Exception:
            pass

    valid_waivers = []
    for w in waivers:
        if w.get("adu_id") == adu_id:
            # P2-2: Waiver Schema and status check
            w_status = w.get("status")
            w_ids = w.get("assertion_ids", [])
            w_gate_id = w.get("gate_id") or w.get("human_gate_id")
            w_reason = w.get("reason")
            w_time = w.get("created_at")
            w_approved_by = w.get("approved_by")

            if not (w_status == "approved" and w_gate_id and w_approved_by and w_reason and w_time and isinstance(w_ids, list) and len(w_ids) > 0):
                continue

            matching_gate = next((g for g in gates_data if g.get("gate_id") == w_gate_id), None)
            if not matching_gate:
                continue

            if matching_gate.get("target_id") != adu_id:
                continue

            # P1 Waiver未绑定受影响断言
            if matching_gate.get("status") not in ("approved", "resolved", "waived"):
                continue

            gate_type = matching_gate.get("gate_type")
            if gate_type not in ("environment_verification_required",):
                continue

            gate_assertions = matching_gate.get("affected_assertions", [])
            if not isinstance(gate_assertions, list) or len(gate_assertions) == 0:
                continue

            # Waiver assertion must belong to gate.affected_assertions
            if not all(a in gate_assertions for a in w_ids):
                continue

            valid_waivers.append(w)
    adu_waivers = valid_waivers

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

    # Include both acceptance and negative assertions
    all_assertions = list(assertions)
    for nass in contract.get("negative_assertions", []):
        all_assertions.append({
            "id": nass["id"],
            "title": nass.get("title", ""),
            "verification_type": "manual_review", # negative assertions are typically manually reviewed / statically checked
            "must_pass": nass.get("must_pass", True)
        })

    for ass in all_assertions:
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
        negative_assertions_dict = evidence_data.get("negative_assertions", {})

        static_lookup = {**evidence_dict, **assertions_dict, **negative_assertions_dict}
        runtime_lookup = {**evidence_dict, **assertions_dict}

        ass_reqs = [r for r in contract.get("evidence_requirements", []) if r.get("assertion_id") == ass_id or ass_id in r.get("assertion_ids", [])]

        def evaluate_required_fields(reqs, ev_data):
            if not reqs:
                return False
            for req in reqs:
                req_fields = req.get("required_fields", [])
                for field_path in req_fields:
                    parts = field_path.split(".")
                    curr = ev_data
                    found = True
                    for p in parts:
                        if isinstance(curr, dict) and p in curr:
                            curr = curr[p]
                        else:
                            found = False
                            break
                    if not found:
                        return False
            return True

        if not is_runtime:
            def is_valid_static(ev_val):
                if not isinstance(ev_val, dict):
                    return False
                status = ev_val.get("status")
                if status in ("failed", "fail"):
                    return False
                if ass_reqs:
                    return evaluate_required_fields(ass_reqs, evidence_data)
                if status not in ("passed", "success", "pass", "verified"):
                    return False
                # P1-5: Substantial fields check
                has_notes = isinstance(ev_val.get("reviewer_notes"), str) and bool(ev_val.get("reviewer_notes").strip())
                has_path = isinstance(ev_val.get("artifact_path"), str) and bool(ev_val.get("artifact_path").strip())
                has_legacy_path = isinstance(ev_val.get("path"), str) and bool(ev_val.get("path").strip())
                has_summary_path = isinstance(ev_val.get("summary_path"), str) and bool(ev_val.get("summary_path").strip())
                has_hash = isinstance(ev_val.get("hash"), str) and bool(ev_val.get("hash").strip())
                has_evidence_url = isinstance(ev_val.get("evidence_url"), str) and bool(ev_val.get("evidence_url").strip())
                has_obs = isinstance(ev_val.get("observed_result"), str) and bool(ev_val.get("observed_result").strip())
                return has_notes or has_path or has_legacy_path or has_summary_path or has_hash or has_evidence_url or has_obs

            # Check inside static_lookup
            if ass_id in static_lookup:
                if is_valid_static(static_lookup[ass_id]):
                    has_evidence = True

        else:
            # Runtime assertions: MUST have concrete runtime evidence
            if ass_id in runtime_lookup:
                val = runtime_lookup[ass_id]
                if isinstance(val, dict):
                    cmd_val = val.get("command")
                    out_val = val.get("observed_result") or val.get("output") or val.get("observed_output")
                    code_val = val.get("exitCode")
                    if code_val is None:
                        code_val = val.get("exit_code")

                    has_code = type(code_val) is int and code_val == 0
                    has_cmd = isinstance(cmd_val, str) and bool(cmd_val.strip())
                    has_out = isinstance(out_val, str) and bool(out_val.strip())
                    if has_cmd and has_code and has_out:
                        if ass_reqs:
                            if evaluate_required_fields(ass_reqs, evidence_data):
                                has_evidence = True
                        else:
                            has_evidence = True

            # 2. Check runtime records (runtime_evidence_records in adu.json)
            if not has_evidence:
                for r in runtime_records:
                    r_ids = r.get("assertion_ids")
                    if isinstance(r_ids, list):
                        matched = ass_id in r_ids
                    else:
                        matched = (r.get("assertion_id") or r.get("assertionId") or "") == ass_id
                    if not matched:
                        continue
                    cmd_val = r.get("command")
                    out_val = r.get("output") or r.get("stdout") or r.get("observed_output") or r.get("observed_result")
                    code_val = r.get("exitCode")
                    if code_val is None:
                        code_val = r.get("exit_code")

                    has_code = type(code_val) is int and code_val == 0
                    has_cmd = isinstance(cmd_val, str) and bool(cmd_val.strip())
                    has_out = isinstance(out_val, str) and bool(out_val.strip())
                    if has_cmd and has_out and has_code:
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

    # Validate evidence requirements (required_fields)
    import re
    missing_fields = []
    for req in contract.get("evidence_requirements", []):
        artifact = req.get("artifact", "")
        fields = req.get("required_fields", [])
        if artifact.endswith(".json") and isinstance(fields, list):
            for field_path in fields:
                parts = [p for p in re.split(r'\.|\[|\]', field_path) if p]
                curr = evidence_data
                found = True
                for part in parts:
                    if isinstance(curr, dict) and part in curr:
                        curr = curr[part]
                    elif isinstance(curr, list) and part.isdigit() and int(part) < len(curr):
                        curr = curr[int(part)]
                    else:
                        found = False
                        break
                # Check for non-empty string or dict/list/int/bool
                if not found or curr is None or curr == "" or (isinstance(curr, (list, dict)) and not curr):
                    missing_fields.append(field_path)

    if missing_fields:
        print(f"FAIL: Missing required fields in evidence.json: {', '.join(missing_fields)}", file=sys.stderr)
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

#!/usr/bin/env python3
import argparse
import json
import os
import sys
from pathlib import Path

VAGUE_PHRASES = [
    "works correctly",
    "implemented",
    "looks good",
    "as expected",
    "normal",
]

def main():
    parser = argparse.ArgumentParser(description="Validate Hard Contract Version 2")
    parser.add_argument("--adu", required=True, help="ADU ID (e.g. REQ-MVP-001)")
    parser.add_argument("--repo-root", help="Repository root path")
    args = parser.parse_args()

    adu_id = args.adu
    if args.repo_root:
        root = Path(args.repo_root)
    else:
        root = Path(__file__).resolve().parents[1]
    contract_path = root / ".ai-agent" / "contracts" / f"{adu_id}.json"

    if not contract_path.exists():
        print(f"FAIL contract {adu_id}: Contract file does not exist at {contract_path}", file=sys.stderr)
        return 1

    try:
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"FAIL contract {adu_id}: Failed to parse JSON: {e}", file=sys.stderr)
        return 1

    # 1. Top level keys
    required_top_level = [
        "version",
        "adu_id",
        "source_documents",
        "scope",
        "acceptance_assertions",
        "negative_assertions",
        "evidence_requirements",
        "quality_gates",
    ]
    for key in required_top_level:
        if key not in contract:
            print(f"FAIL contract {adu_id}: Missing top-level key '{key}'", file=sys.stderr)
            return 1

    # 2. Version and ADU ID checks
    if contract.get("version") != 2:
        print(f"FAIL contract {adu_id}: version must be 2, got {contract.get('version')}", file=sys.stderr)
        return 1

    if contract.get("adu_id") != adu_id:
        print(f"FAIL contract {adu_id}: adu_id in JSON ('{contract.get('adu_id')}') does not match expected '{adu_id}'", file=sys.stderr)
        return 1

    # 3. Quality gates defaults
    quality_gates = contract.get("quality_gates", {})
    min_assertions = quality_gates.get("minimum_assertions", 3)
    min_neg_assertions = quality_gates.get("minimum_negative_assertions", 1)

    # 4. Acceptance Assertions check
    assertions = contract.get("acceptance_assertions", [])
    if not isinstance(assertions, list):
        print(f"FAIL contract {adu_id}: 'acceptance_assertions' must be a list", file=sys.stderr)
        return 1

    if len(assertions) < min_assertions:
        print(f"FAIL contract {adu_id}: acceptance_assertions length ({len(assertions)}) is less than minimum required ({min_assertions})", file=sys.stderr)
        return 1

    assertion_ids = set()
    for idx, ass in enumerate(assertions):
        # Fields check
        req_fields = ["id", "title", "requirement", "verification_type", "expected_evidence", "must_pass"]
        for field in req_fields:
            if field not in ass:
                print(f"FAIL contract {adu_id}: acceptance_assertions[{idx}] missing field '{field}'", file=sys.stderr)
                return 1

        # Check verification commands / steps
        v_cmd = ass.get("verification_command")
        m_steps = ass.get("manual_verification_steps")

        has_v_cmd = isinstance(v_cmd, str) and len(v_cmd.strip()) > 0
        has_m_steps = False
        if isinstance(m_steps, str) and len(m_steps.strip()) > 0:
            has_m_steps = True
        elif isinstance(m_steps, list) and len(m_steps) > 0 and all(isinstance(s, str) and len(s.strip()) > 0 for s in m_steps):
            has_m_steps = True

        if not has_v_cmd and not has_m_steps:
            print(f"FAIL contract {adu_id}: acceptance_assertions[{idx}] must provide a non-empty 'verification_command' or 'manual_verification_steps'", file=sys.stderr)
            return 1

        ass_id = ass.get("id")
        assertion_ids.add(ass_id)

        # Expected evidence check
        ev = ass.get("expected_evidence", [])
        if not isinstance(ev, list) or len(ev) == 0:
            print(f"FAIL contract {adu_id}: acceptance_assertions[{idx}] expected_evidence must be a non-empty list", file=sys.stderr)
            return 1

        # Vague phrases check
        for phrase in ev:
            if not isinstance(phrase, str):
                print(f"FAIL contract {adu_id}: expected_evidence items must be strings", file=sys.stderr)
                return 1
            for vague in VAGUE_PHRASES:
                if vague in phrase.lower():
                    print(f"FAIL contract {adu_id}: acceptance_assertions[{idx}].expected_evidence contains vague phrase: '{phrase}'", file=sys.stderr)
                    return 1

    # 5. Negative Assertions check
    neg_assertions = contract.get("negative_assertions", [])
    if not isinstance(neg_assertions, list):
        print(f"FAIL contract {adu_id}: 'negative_assertions' must be a list", file=sys.stderr)
        return 1

    if len(neg_assertions) < min_neg_assertions:
        print(f"FAIL contract {adu_id}: negative_assertions length ({len(neg_assertions)}) is less than minimum required ({min_neg_assertions})", file=sys.stderr)
        return 1

    for idx, nass in enumerate(neg_assertions):
        req_fields = ["id", "title", "forbidden_change", "must_pass"]
        for field in req_fields:
            if field not in nass:
                print(f"FAIL contract {adu_id}: negative_assertions[{idx}] missing field '{field}'", file=sys.stderr)
                return 1
        assertion_ids.add(nass.get("id"))

    # 6. Evidence Requirements check
    ev_reqs = contract.get("evidence_requirements", [])
    if not isinstance(ev_reqs, list):
        print(f"FAIL contract {adu_id}: 'evidence_requirements' must be a list", file=sys.stderr)
        return 1

    for idx, evr in enumerate(ev_reqs):
        req_fields = ["id", "assertion_id", "artifact", "required_fields"]
        for field in req_fields:
            if field not in evr:
                print(f"FAIL contract {adu_id}: evidence_requirements[{idx}] missing field '{field}'", file=sys.stderr)
                return 1

        ref_ass = evr.get("assertion_id")
        if ref_ass not in assertion_ids:
            print(f"FAIL contract {adu_id}: evidence_requirements[{idx}].assertion_id ('{ref_ass}') does not map to any active acceptance or negative assertion id", file=sys.stderr)
            return 1

        req_f = evr.get("required_fields", [])
        if not isinstance(req_f, list) or len(req_f) == 0:
            print(f"FAIL contract {adu_id}: evidence_requirements[{idx}].required_fields must be a non-empty list", file=sys.stderr)
            return 1

    # 7. Allowed Write Paths check
    scope = contract.get("scope", {})
    if not isinstance(scope, dict) or "allowed_write_paths" not in scope:
        print(f"FAIL contract {adu_id}: Missing scope.allowed_write_paths", file=sys.stderr)
        return 1

    contract_allowed_paths = scope.get("allowed_write_paths", [])
    if not isinstance(contract_allowed_paths, list):
        print(f"FAIL contract {adu_id}: scope.allowed_write_paths must be a list", file=sys.stderr)
        return 1

    # Load ADU registry to check allowed write paths inclusion
    registry_dir_env = os.environ.get("AGENT_FACTORY_REGISTRY_DIR")
    if registry_dir_env:
        global_registry = Path(registry_dir_env).resolve()
    else:
        projects_registry_env = os.environ.get("AGENT_FACTORY_PROJECTS_REGISTRY")
        if projects_registry_env:
            global_registry = Path(projects_registry_env).parent.resolve()
        else:
            global_registry = Path(__file__).resolve().parents[1] / ".ai-agent" / "registry"

    adu_json_path = global_registry / "adu.json"
    if not adu_json_path.exists():
        print(f"FAIL contract {adu_id}: ADU registry does not exist at {adu_json_path}", file=sys.stderr)
        return 1
    try:
        adu_registry = json.loads(adu_json_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"FAIL contract {adu_id}: Failed to parse ADU registry JSON: {e}", file=sys.stderr)
        return 1

    adu_entry = None
    for item in adu_registry.get("adus", []):
        if item.get("id") == adu_id:
            adu_entry = item
            break
    if not adu_entry:
        print(f"FAIL contract {adu_id}: ADU {adu_id} not found in registry", file=sys.stderr)
        return 1

    adu_allowed_paths = adu_entry.get("allowed_write_paths", [])

    # Command policy check: verification_command must satisfy the ADU's command_policy
    command_policy = adu_entry.get("command_policy")
    if command_policy and isinstance(command_policy, dict):
        policy_mode = command_policy.get("mode", "")
        allowed_commands = command_policy.get("allowed_commands", [])
        blocked_patterns = command_policy.get("blocked_command_patterns", [])

        for idx, ass in enumerate(assertions):
            v_cmd = ass.get("verification_command")
            if not isinstance(v_cmd, str) or not v_cmd.strip():
                continue  # Already validated: at least one of v_cmd / manual_steps exists
            cmd = v_cmd.strip()

            for pat in blocked_patterns:
                if isinstance(pat, str) and pat in cmd:
                    print(
                        f"FAIL contract {adu_id}: acceptance_assertions[{idx}].verification_command "
                        f"matches blocked pattern '{pat}'",
                        file=sys.stderr,
                    )
                    return 1

            if policy_mode == "allowlist" and allowed_commands:
                if not any(cmd == ac or cmd.startswith(ac + " ") for ac in allowed_commands if isinstance(ac, str)):
                    print(
                        f"FAIL contract {adu_id}: acceptance_assertions[{idx}].verification_command "
                        f"'{cmd}' is not in allowed_commands {allowed_commands}",
                        file=sys.stderr,
                    )
                    return 1

    disallowed_paths = []
    for cp in contract_allowed_paths:
        if not isinstance(cp, str):
            print(f"FAIL contract {adu_id}: scope.allowed_write_paths items must be strings", file=sys.stderr)
            return 1

        cp_parts = Path(os.path.normpath(cp)).parts
        matched = False
        for ap in adu_allowed_paths:
            ap_parts = Path(os.path.normpath(ap)).parts
            if len(cp_parts) >= len(ap_parts) and cp_parts[:len(ap_parts)] == ap_parts:
                matched = True
                break
        if not matched:
            disallowed_paths.append(cp)

    if disallowed_paths:
        import subprocess
        import datetime
        import uuid

        policy_script = Path(__file__).parent / "write_path_policy.py"
        cmd = [sys.executable, str(policy_script), "--adu", adu_id, "--requested-paths", json.dumps(disallowed_paths)]
        cmd.extend(["--registry-dir", str(global_registry)])
        if args.repo_root:
            cmd.extend(["--repo-root", str(args.repo_root)])

        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=True)
            policy_result = json.loads(res.stdout)
        except Exception as e:
            print(f"FAIL contract {adu_id}: Failed to evaluate write path policy: {e}", file=sys.stderr)
            return 1

        result_str = policy_result.get("result")
        reason = policy_result.get("reason", "")

        if result_str == "blocked":
            print(f"FAIL contract {adu_id}: contract allowed write paths {policy_result.get('blocked_paths')} are blocked by policy. Reason: {reason}", file=sys.stderr)
            return 1

        now_str = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
        request_id = f"req-{uuid.uuid4().hex[:8]}"

        # 1. Update write-path-expansion-requests.json
        req_file = global_registry / "write-path-expansion-requests.json"
        req_data = {"version": 1, "requests": []}
        if req_file.exists():
            try:
                req_data = json.loads(req_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        # Check for an existing duplicate pending request to avoid spamming
        existing_req = None
        for r in req_data.setdefault("requests", []):
            if r.get("adu_id") == adu_id and r.get("decision") == "pending_human_approval" and sorted(r.get("requested_paths", [])) == sorted(disallowed_paths):
                existing_req = r
                break

        if existing_req:
            request_id = existing_req["request_id"]
        else:
            req_data["requests"].append({
                "request_id": request_id,
                "adu_id": adu_id,
                "source_agent": "contract_validator",
                "requested_paths": disallowed_paths,
                "decision": "auto_approved" if result_str == "approved" else "pending_human_approval",
                "reason": reason,
                "created_at": now_str,
                "updated_at": now_str
            })
            try:
                req_file.write_text(json.dumps(req_data, indent=2, ensure_ascii=False), encoding="utf-8")
            except Exception as e:
                print(f"FAIL contract {adu_id}: Failed to write to {req_file}: {e}", file=sys.stderr)
                return 1

        if result_str == "approved":
            # 2. Update adu.json
            for item in adu_registry.get("adus", []):
                if item.get("id") == adu_id:
                    # Add to allowed_write_paths
                    current_write = item.get("allowed_write_paths", [])
                    for p in policy_result.get("approved_paths", []):
                        if p not in current_write:
                            current_write.append(p)
                    item["allowed_write_paths"] = current_write

                    # Add to allowed_read_paths
                    current_read = item.get("allowed_read_paths", [])
                    for p in policy_result.get("approved_paths", []):
                        if p not in current_read:
                            current_read.append(p)
                    item["allowed_read_paths"] = current_read

                    # Record expansion history in the adu entry
                    if "write_path_expansions" not in item:
                        item["write_path_expansions"] = []
                    item["write_path_expansions"].append({
                        "request_id": request_id,
                        "source_agent": "contract_validator",
                        "requested_paths": disallowed_paths,
                        "approved_paths": policy_result.get("approved_paths", []),
                        "decision": "auto_approved",
                        "reason": reason,
                        "created_at": now_str,
                        "updated_at": now_str
                    })
                    break
            try:
                adu_json_path.write_text(json.dumps(adu_registry, indent=2, ensure_ascii=False), encoding="utf-8")
            except Exception as e:
                print(f"FAIL contract {adu_id}: Failed to write to {adu_json_path}: {e}", file=sys.stderr)
                return 1
        else:
            # Result is pending human approval
            print(f"FAIL contract {adu_id}: disallowed write paths {policy_result.get('pending_paths')} require human approval. Request registered: {request_id}", file=sys.stderr)
            return 20

    print(f"PASS contract {adu_id} assertions={len(assertions)} negative_assertions={len(neg_assertions)} evidence_requirements={len(ev_reqs)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())

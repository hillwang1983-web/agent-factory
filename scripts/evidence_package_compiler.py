#!/usr/bin/env python3
import json
import re
import sys
import argparse
from pathlib import Path

def load_json(path):
    if not path.is_file():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def has_non_empty_path(data, field_path):
    parts = [p for p in re.split(r'\.|\[|\]', field_path) if p]
    curr = data
    for part in parts:
        if isinstance(curr, dict) and part in curr:
            curr = curr[part]
        elif isinstance(curr, list) and part.isdigit() and int(part) < len(curr):
            curr = curr[int(part)]
        else:
            return False
    if curr is None or curr == "" or (isinstance(curr, (list, dict)) and not curr):
        return False
    return True

def compile_runtime_assertion(review, command, execution, runtime_records, assertion_id, acceptance_status):
    review_status = review.get("status") if isinstance(review, dict) else None
    review_ok = review_status in ("passed", "success", "pass", "verified")
    top_ok = acceptance_status in ("passed", "success", "pass", "verified")

    if not review_ok or not top_ok:
        status_val = "fail" if review_status in ("failed", "fail") or acceptance_status in ("failed", "fail") else "pending_environment_verification"
        obs_val = (
            (isinstance(review, dict) and (review.get("observed_result") or review.get("reviewer_notes"))) or
            "Acceptance verification failed or was not successfully completed."
        )
        return {
            "status": status_val,
            "command": command,
            "observed_result": obs_val
        }

    # 1. Match from execution (verification-results.json)
    if isinstance(execution, dict):
        exit_code = execution.get("exit_code")
        if exit_code is None:
            exit_code = execution.get("exitCode")

        # Ensure it is an integer 0
        if type(exit_code) is int and exit_code == 0:
            observed_result = (
                execution.get("stdout") or
                execution.get("output") or
                execution.get("observed_output") or
                execution.get("observed_result") or
                ""
            )
            if observed_result.strip():
                return {
                    "status": "pass",
                    "command": command,
                    "exit_code": 0,
                    "observed_result": observed_result.strip()
                }

    # 2. Match from runtime records (runtime_evidence_records in adu.json)
    for r in runtime_records or []:
        r_ids = r.get("assertion_ids")
        if isinstance(r_ids, list):
            matched = assertion_id in r_ids
        else:
            matched = (r.get("assertion_id") or r.get("assertionId") or "") == assertion_id
        if matched:
            code_val = r.get("exit_code")
            if code_val is None:
                code_val = r.get("exitCode")

            if type(code_val) is int and code_val == 0:
                cmd_val = r.get("command") or ""
                out_val = (
                    r.get("output") or
                    r.get("stdout") or
                    r.get("observed_output") or
                    r.get("observed_result") or
                    ""
                )
                if cmd_val.strip() and out_val.strip():
                    return {
                        "status": "pass",
                        "command": cmd_val.strip(),
                        "exit_code": 0,
                        "observed_result": out_val.strip()
                    }

    # 3. Fallback: missing or pending
    return {
        "status": "pending_environment_verification",
        "command": command,
        "observed_result": "No successful runtime execution result found in verification results or runtime records."
    }

def compile_manual_assertion(review, acceptance_status):
    if not isinstance(review, dict) or not review:
        return {
            "status": "pending_manual_review",
            "observed_result": "No manual review result found in acceptance report."
        }
    status = review.get("status") or "pending_manual_review"
    if status in ("passed", "success", "verified"):
        status = "pass"
    elif status in ("failed", "fail"):
        status = "fail"

    top_ok = acceptance_status in ("passed", "success", "pass", "verified")
    if not top_ok:
        status = "fail" if acceptance_status in ("failed", "fail") else "pending_manual_review"

    return {
        "status": status,
        "observed_result": review.get("observed_result") or review.get("reviewer_notes") or review.get("summary") or "Manual review completed."
    }

def compile_evidence(contract, acceptance_report, verification_results, runtime_records, source_run_timestamp=None, source_agent=None):
    acceptance_status = acceptance_report.get("acceptance_status")

    assertions = {}
    acceptance_by_id = {
        item["assertion_id"]: item
        for item in acceptance_report.get("assertion_results", [])
        if isinstance(item, dict) and isinstance(item.get("assertion_id"), str)
    }

    # Map verification results by exact command
    command_results = {
        item["command"]: item
        for item in verification_results.get("commands", [])
        if isinstance(item, dict) and isinstance(item.get("command"), str)
    }

    for assertion in contract.get("acceptance_assertions", []):
        assertion_id = assertion["id"]
        review = acceptance_by_id.get(assertion_id, {})
        vtype = assertion.get("verification_type")

        if vtype in ("automated_test", "runtime"):
            command = assertion.get("verification_command", "")
            execution = command_results.get(command)
            assertions[assertion_id] = compile_runtime_assertion(
                review, command, execution, runtime_records, assertion_id, acceptance_status
            )
        else:
            assertions[assertion_id] = compile_manual_assertion(review, acceptance_status)

    # Compile negative assertions
    negative_assertions = {}
    neg_by_id = {}
    for item in (acceptance_report.get("negative_assertion_results", []) or acceptance_report.get("assertion_results", []) or []):
        if isinstance(item, dict) and isinstance(item.get("assertion_id"), str):
            neg_by_id[item["assertion_id"]] = item

    for nass in contract.get("negative_assertions", []):
        n_id = nass["id"]
        review = neg_by_id.get(n_id)
        if not isinstance(review, dict) or not review:
            negative_assertions[n_id] = {
                "status": "pending_manual_review",
                "observed_result": "No manual review result found in acceptance report for negative assertion."
            }
            continue

        status = review.get("status")
        top_ok = acceptance_status in ("passed", "success", "pass", "verified")
        if top_ok and status in ("passed", "success", "pass", "verified"):
            status = "pass"
        elif status in ("failed", "fail") or acceptance_status in ("failed", "fail"):
            status = "fail"
        else:
            status = "pending_manual_review"

        observed = review.get("observed_result") or review.get("reviewer_notes") or ""
        if not observed.strip():
            if status != "fail":
                status = "pending_manual_review"
            observed = "No manual review description found in acceptance report."

        negative_assertions[n_id] = {
            "status": status,
            "observed_result": observed.strip()
        }

    # Determine overall acceptance status
    overall_status = "pass"
    for ass in assertions.values():
        if ass.get("status") != "pass":
            overall_status = "fail"
            break
    for nass in negative_assertions.values():
        if nass.get("status") != "pass":
            overall_status = "fail"
            break

    package = {
        "version": 1,
        "adu_id": contract.get("adu_id"),
        "title": contract.get("title", ""),
        "evidence_generated_at": acceptance_report.get("evidence_generated_at") or "",
        "acceptance_status": overall_status,
        "source_run_timestamp": source_run_timestamp or acceptance_report.get("source_run_timestamp") or "",
        "source_agent": source_agent or acceptance_report.get("source_agent") or "",
        "assertions": assertions,
        "negative_assertions": negative_assertions,
        "summary": {
            "total_assertions": len(assertions),
            "passed": sum(1 for a in assertions.values() if a.get("status") == "pass"),
            "failed": sum(1 for a in assertions.values() if a.get("status") == "fail"),
            "total_negative_assertions": len(negative_assertions),
            "negative_passed": sum(1 for a in negative_assertions.values() if a.get("status") == "pass"),
            "negative_failed": sum(1 for a in negative_assertions.values() if a.get("status") == "fail"),
            "overall_status": "all_passed" if overall_status == "pass" else "failed"
        }
    }
    return package

def validate_compiled_package(package, contract):
    missing = []
    for requirement in contract.get("evidence_requirements", []):
        for field_path in requirement.get("required_fields", []):
            # Check package has path non empty
            if not has_non_empty_path(package, field_path):
                missing.append(field_path)
    if missing:
        raise ValueError("Missing required evidence fields: " + ", ".join(missing))

def compile_evidence_from_files(contract_path, acceptance_path, verification_path, runtime_records, source_run_timestamp=None, source_agent=None):
    contract = load_json(Path(contract_path))
    acceptance = load_json(Path(acceptance_path))
    verification = load_json(Path(verification_path))

    package = compile_evidence(contract, acceptance, verification, runtime_records, source_run_timestamp, source_agent)
    validate_compiled_package(package, contract)
    return package

def main():
    parser = argparse.ArgumentParser(description="Compile canonical evidence package.")
    parser.add_argument("--adu", required=True, help="ADU ID")
    parser.add_argument("--repo-root", required=True, help="Path to repo root")
    parser.add_argument("--registry-dir", required=True, help="Path to registry directory")
    parser.add_argument("--run-dir", required=True, help="Path to the current run directory (where verification-results.json sits)")
    parser.add_argument("--output", required=True, help="Output evidence JSON path")
    parser.add_argument("--source-run-timestamp", default="", help="Timestamp of the source run")
    parser.add_argument("--source-agent", default="", help="Agent of the source run")
    args = parser.parse_args()

    adu_id = args.adu
    repo_root = Path(args.repo_root)
    registry_dir = Path(args.registry_dir)
    run_dir = Path(args.run_dir)
    output_path = Path(args.output)

    contract_path = repo_root / ".ai-agent" / "contracts" / f"{adu_id}.json"
    acceptance_path = repo_root / ".ai-agent" / "acceptance" / f"{adu_id}-acceptance-review.json"
    verification_path = run_dir / "verification-results.json"

    # Load runtime records from registry/adu.json
    adu_file = registry_dir / "adu.json"
    runtime_records = []
    if adu_file.is_file():
        try:
            with open(adu_file, "r", encoding="utf-8") as f:
                adus = json.load(f).get("adus", [])
                adu = next((a for a in adus if a.get("id") == adu_id), None)
                if adu and "runtime_evidence_records" in adu:
                    runtime_records = adu["runtime_evidence_records"]
        except Exception:
            pass

    try:
        package = compile_evidence_from_files(
            contract_path,
            acceptance_path,
            verification_path,
            runtime_records,
            source_run_timestamp=args.source_run_timestamp,
            source_agent=args.source_agent
        )

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(package, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"PASS: Compiled canonical evidence for {adu_id} to {output_path}")
        sys.exit(0)
    except Exception as e:
        print(f"FAIL: Evidence compilation failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()

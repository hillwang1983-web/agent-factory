#!/usr/bin/env python3
import argparse
import json
import os
import sys
from pathlib import Path

def fail(kind, adu_id, code, message, assertion_id=None, json_mode=False):
    if json_mode:
        output = {
            "valid": False,
            "kind": kind,
            "adu_id": adu_id,
            "failure_code": code,
            "message": message
        }
        if assertion_id:
            output["assertion_id"] = assertion_id
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print(f"FAIL {kind} {adu_id}: {message}", file=sys.stderr)
    return 1

def success(kind, adu_id, status, json_mode=False):
    if json_mode:
        print(json.dumps({
            "valid": True,
            "kind": kind,
            "adu_id": adu_id,
            "status": status
        }, ensure_ascii=False, indent=2))
    else:
        print(f"PASS {kind} {adu_id} status={status}")
    return 0

def validate_code_review(report, adu_id, json_mode=False):
    if report.get("adu_id") != adu_id:
        return fail("code-review", adu_id, "adu_id_mismatch", f"adu_id in JSON ('{report.get('adu_id')}') does not match expected '{adu_id}'", json_mode=json_mode)

    status = report.get("review_status")
    next_state = report.get("next_state")

    if status == "pass":
        if next_state != "code_reviewed":
            return fail("code-review", adu_id, "invalid_next_state", f"status is 'pass' but next_state is '{next_state}' (expected 'code_reviewed')", json_mode=json_mode)

        checked_files = report.get("checked_files", [])
        if not isinstance(checked_files, list) or len(checked_files) == 0:
            return fail("code-review", adu_id, "checked_files_empty", "pass review must have at least one checked_file", json_mode=json_mode)

        assertion_results = report.get("contract_assertion_results", [])
        if not isinstance(assertion_results, list):
            return fail("code-review", adu_id, "assertion_results_not_list", "contract_assertion_results must be a list", json_mode=json_mode)

        for idx, item in enumerate(assertion_results):
            if item.get("status") != "pass":
                return fail("code-review", adu_id, "assertion_not_pass", f"contract_assertion_results[{idx}] is not 'pass' but review_status is 'pass'", assertion_id=item.get("assertion_id"), json_mode=json_mode)

        # Check findings and actions for pass reports
        findings = report.get("findings", [])
        if not isinstance(findings, list):
            return fail("code-review", adu_id, "findings_not_list", "findings must be a list", json_mode=json_mode)
        for idx, f in enumerate(findings):
            severity = str(f.get("severity") or "").upper()
            if severity in ("P1", "P2"):
                return fail("code-review", adu_id, "high_severity_finding", f"pass review cannot have P1 or P2 findings (finding severity is '{severity}')", json_mode=json_mode)
            if f.get("required_fix"):
                return fail("code-review", adu_id, "required_fix_in_pass", f"pass review findings cannot contain required_fix ('{f.get('required_fix')}')", json_mode=json_mode)

        req_actions = report.get("required_developer_actions", [])
        if not isinstance(req_actions, list):
            return fail("code-review", adu_id, "required_actions_not_list", "required_developer_actions must be a list", json_mode=json_mode)
        if len(req_actions) > 0:
            return fail("code-review", adu_id, "required_actions_in_pass", "pass review cannot have required developer actions", json_mode=json_mode)

    elif status == "fail":
        if next_state != "code_rework":
            return fail("code-review", adu_id, "invalid_next_state", f"status is 'fail' but next_state is '{next_state}' (expected 'code_rework')", json_mode=json_mode)

        findings = report.get("findings", [])
        if not isinstance(findings, list) or len(findings) == 0:
            return fail("code-review", adu_id, "findings_empty", "fail review must have at least one finding", json_mode=json_mode)

        for idx, f in enumerate(findings):
            req_fields = ["severity", "title", "detail", "required_fix"]
            for field in req_fields:
                if field not in f:
                    return fail("code-review", adu_id, "finding_missing_fields", f"findings[{idx}] missing field '{field}'", json_mode=json_mode)
    else:
        return fail("code-review", adu_id, "invalid_status", f"invalid review_status '{status}'", json_mode=json_mode)

    return success("code-review", adu_id, status, json_mode=json_mode)


def validate_acceptance(report, adu_id, repo_root=None, json_mode=False):
    if report.get("adu_id") != adu_id:
        return fail("acceptance", adu_id, "adu_id_mismatch", f"adu_id in JSON ('{report.get('adu_id')}') does not match expected '{adu_id}'", json_mode=json_mode)

    status = report.get("acceptance_status")
    next_state = report.get("next_state")

    # Load contract file to verify must_pass assertion coverage
    if repo_root:
        root = Path(repo_root)
    else:
        root = Path(__file__).resolve().parents[1]
    contract_path = root / ".ai-agent" / "contracts" / f"{adu_id}.json"
    if not contract_path.exists():
        return fail("acceptance", adu_id, "contract_not_found", f"Contract file does not exist at {contract_path}", json_mode=json_mode)
    try:
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
    except Exception as e:
        return fail("acceptance", adu_id, "contract_parse_error", f"Failed to parse contract JSON: {e}", json_mode=json_mode)

    must_pass_acceptance = [
        ass.get("id") for ass in contract.get("acceptance_assertions", [])
        if ass.get("must_pass") is True
    ]
    must_pass_negative = [
        nass.get("id") for nass in contract.get("negative_assertions", [])
        if nass.get("must_pass") is True
    ]

    if status == "pass":
        if next_state != "acceptance_reviewed":
            return fail("acceptance", adu_id, "invalid_next_state", f"status is 'pass' but next_state is '{next_state}' (expected 'acceptance_reviewed')", json_mode=json_mode)

        environment_waiver_allowed = _has_approved_environment_waiver(adu_id)
        waived_assertions = set()

        assertions = report.get("assertion_results", [])
        if not isinstance(assertions, list):
            return fail("acceptance", adu_id, "assertion_results_not_list", "assertion_results must be a list", json_mode=json_mode)

        passed_assertions = {}
        for idx, item in enumerate(assertions):
            ass_id = item.get("assertion_id")
            item_status = item.get("status")
            if ass_id:
                passed_assertions[ass_id] = item_status
            if item_status == "waived" and environment_waiver_allowed and ass_id:
                waived_assertions.add(ass_id)
                continue
            if item_status != "pass":
                return fail("acceptance", adu_id, "assertion_not_pass_without_waiver", f"assertion_results[{idx}] status is not 'pass' but acceptance_status is 'pass'", assertion_id=ass_id, json_mode=json_mode)

        neg_assertions = report.get("negative_assertion_results", [])
        if not isinstance(neg_assertions, list):
            return fail("acceptance", adu_id, "assertion_results_not_list", "negative_assertion_results must be a list", json_mode=json_mode)

        passed_negatives = {}
        for idx, item in enumerate(neg_assertions):
            neg_id = item.get("assertion_id")
            if neg_id:
                passed_negatives[neg_id] = item.get("status")
            if item.get("status") != "pass":
                return fail("acceptance", adu_id, "assertion_not_pass", f"negative_assertion_results[{idx}] status is not 'pass' but acceptance_status is 'pass'", assertion_id=neg_id, json_mode=json_mode)

        # Check coverage of must_pass contract assertions
        for ass_id in must_pass_acceptance:
            if ass_id not in passed_assertions:
                return fail("acceptance", adu_id, "must_pass_assertion_not_covered", f"must_pass acceptance assertion '{ass_id}' is not covered in report assertion_results", assertion_id=ass_id, json_mode=json_mode)
            if passed_assertions[ass_id] == "waived" and ass_id in waived_assertions:
                continue
            if passed_assertions[ass_id] != "pass":
                return fail("acceptance", adu_id, "must_pass_assertion_failed", f"must_pass acceptance assertion '{ass_id}' did not pass in report results (status: '{passed_assertions[ass_id]}')", assertion_id=ass_id, json_mode=json_mode)

        for neg_id in must_pass_negative:
            if neg_id not in passed_negatives:
                return fail("acceptance", adu_id, "must_pass_assertion_not_covered", f"must_pass negative assertion '{neg_id}' is not covered in report negative_assertion_results", assertion_id=neg_id, json_mode=json_mode)
            if passed_negatives[neg_id] != "pass":
                return fail("acceptance", adu_id, "must_pass_assertion_failed", f"must_pass negative assertion '{neg_id}' did not pass in report results (status: '{passed_negatives[neg_id]}')", assertion_id=neg_id, json_mode=json_mode)

        mismatch = report.get("mismatch_findings", [])
        if isinstance(mismatch, list) and len(mismatch) > 0:
            return fail("acceptance", adu_id, "mismatch_findings_in_pass", "pass report cannot have mismatch_findings", json_mode=json_mode)

        missing = report.get("missing_evidence", [])
        if isinstance(missing, list) and len(missing) > 0:
            uncovered_missing = [
                item for item in missing
                if not isinstance(item, dict) or item.get("assertion_id") not in waived_assertions
            ]
            if not uncovered_missing:
                missing = []
        if isinstance(missing, list) and len(missing) > 0:
            return fail("acceptance", adu_id, "missing_evidence_in_pass", "pass report cannot have missing_evidence", json_mode=json_mode)

    elif status == "fail":
        if next_state != "acceptance_rework":
            return fail("acceptance", adu_id, "invalid_next_state", f"status is 'fail' but next_state is '{next_state}' (expected 'acceptance_rework')", json_mode=json_mode)

        mismatch = report.get("mismatch_findings", [])
        missing = report.get("missing_evidence", [])
        if (not isinstance(mismatch, list) or len(mismatch) == 0) and (not isinstance(missing, list) or len(missing) == 0):
            return fail("acceptance", adu_id, "findings_empty", "fail report must have at least one mismatch_finding or missing_evidence item", json_mode=json_mode)
    else:
        return fail("acceptance", adu_id, "invalid_status", f"invalid acceptance_status '{status}'", json_mode=json_mode)

    return success("acceptance", adu_id, status, json_mode=json_mode)


def _resolve_registry() -> Path:
    registry_dir_env = os.environ.get("AGENT_FACTORY_REGISTRY_DIR")
    if registry_dir_env:
        return Path(registry_dir_env).resolve()
    projects_registry_env = os.environ.get("AGENT_FACTORY_PROJECTS_REGISTRY")
    if projects_registry_env:
        return Path(projects_registry_env).parent.resolve()
    return Path(__file__).resolve().parents[1] / ".ai-agent" / "registry"


def _load_registered_adu(adu_id: str):
    registry = _resolve_registry()
    adu_json = registry / "adu.json"
    if not adu_json.exists():
        return None
    try:
        data = json.loads(adu_json.read_text(encoding="utf-8"))
    except Exception:
        return None
    return next((a for a in data.get("adus", []) if a.get("id") == adu_id), None)


def _has_approved_environment_waiver(adu_id: str) -> bool:
    adu_entry = _load_registered_adu(adu_id)
    if not adu_entry:
        return False
    waivers = adu_entry.get("human_gate_waivers", [])
    if not isinstance(waivers, list):
        return False
    for waiver in waivers:
        if not isinstance(waiver, dict):
            continue
        if waiver.get("type") == "environment" and waiver.get("approved_by"):
            return True
    return False


def check_cross_project(adu_id: str, repo_root: str, json_mode=False) -> int:
    """Reject evidence when the ADU's registered project does not own repo_root."""
    adu_entry = _load_registered_adu(adu_id)
    if adu_entry is None:
        return 0  # ADU not yet persisted – skip

    registered_repo = adu_entry.get("repo_path")
    if registered_repo and Path(registered_repo).resolve() != Path(repo_root).resolve():
        return fail(
            "cross-project",
            adu_id,
            "cross_project_mismatch",
            f"ADU is bound to repo '{registered_repo}' but evidence is being validated against '{repo_root}'",
            json_mode=json_mode
        )
    return 0


def main():
    parser = argparse.ArgumentParser(description="Validate Quality Reports")
    parser.add_argument("--adu", required=True, help="ADU ID")
    parser.add_argument("--kind", choices=["code-review", "acceptance"], required=True, help="Report kind")
    parser.add_argument("--repo-root", help="Repository root path")
    parser.add_argument("--json", action="store_true", help="Output result structurally as JSON")
    args = parser.parse_args()

    json_mode = getattr(args, "json", False)

    if args.repo_root:
        root = Path(args.repo_root)
    else:
        root = Path(__file__).resolve().parents[1]

    # Cross-project evidence rejection
    if args.repo_root:
        rc = check_cross_project(args.adu, args.repo_root, json_mode=json_mode)
        if rc != 0:
            return rc

    if args.kind == "code-review":
        path = root / ".ai-agent" / "reviews" / f"{args.adu}-code-review.json"
    else:
        path = root / ".ai-agent" / "acceptance" / f"{args.adu}-acceptance-review.json"

    if not path.exists():
        return fail(args.kind, args.adu, "file_not_found", f"File does not exist at {path}", json_mode=json_mode)

    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return fail(args.kind, args.adu, "json_parse_error", f"Failed to parse JSON: {e}", json_mode=json_mode)

    if args.kind == "code-review":
        return validate_code_review(report, args.adu, json_mode=json_mode)
    else:
        return validate_acceptance(report, args.adu, repo_root=args.repo_root, json_mode=json_mode)

if __name__ == "__main__":
    sys.exit(main())

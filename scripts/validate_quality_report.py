#!/usr/bin/env python3
import argparse
import json
import os
import sys
from pathlib import Path

def validate_code_review(report, adu_id):
    if report.get("adu_id") != adu_id:
        print(f"FAIL code-review {adu_id}: adu_id in JSON ('{report.get('adu_id')}') does not match expected '{adu_id}'", file=sys.stderr)
        return 1

    status = report.get("review_status")
    next_state = report.get("next_state")

    if status == "pass":
        if next_state != "code_reviewed":
            print(f"FAIL code-review {adu_id}: status is 'pass' but next_state is '{next_state}' (expected 'code_reviewed')", file=sys.stderr)
            return 1

        checked_files = report.get("checked_files", [])
        if not isinstance(checked_files, list) or len(checked_files) == 0:
            print(f"FAIL code-review {adu_id}: pass review must have at least one checked_file", file=sys.stderr)
            return 1

        assertion_results = report.get("contract_assertion_results", [])
        if not isinstance(assertion_results, list):
            print(f"FAIL code-review {adu_id}: contract_assertion_results must be a list", file=sys.stderr)
            return 1

        for idx, item in enumerate(assertion_results):
            if item.get("status") != "pass":
                print(f"FAIL code-review {adu_id}: contract_assertion_results[{idx}] is not 'pass' but review_status is 'pass'", file=sys.stderr)
                return 1

        # Check findings and actions for pass reports
        findings = report.get("findings", [])
        if not isinstance(findings, list):
            print(f"FAIL code-review {adu_id}: findings must be a list", file=sys.stderr)
            return 1
        for idx, f in enumerate(findings):
            severity = str(f.get("severity") or "").upper()
            if severity in ("P1", "P2"):
                print(f"FAIL code-review {adu_id}: pass review cannot have P1 or P2 findings (finding severity is '{severity}')", file=sys.stderr)
                return 1
            if f.get("required_fix"):
                print(f"FAIL code-review {adu_id}: pass review findings cannot contain required_fix ('{f.get('required_fix')}')", file=sys.stderr)
                return 1

        req_actions = report.get("required_developer_actions", [])
        if not isinstance(req_actions, list):
            print(f"FAIL code-review {adu_id}: required_developer_actions must be a list", file=sys.stderr)
            return 1
        if len(req_actions) > 0:
            print(f"FAIL code-review {adu_id}: pass review cannot have required developer actions", file=sys.stderr)
            return 1
    
    elif status == "fail":
        if next_state != "code_rework":
            print(f"FAIL code-review {adu_id}: status is 'fail' but next_state is '{next_state}' (expected 'code_rework')", file=sys.stderr)
            return 1

        findings = report.get("findings", [])
        if not isinstance(findings, list) or len(findings) == 0:
            print(f"FAIL code-review {adu_id}: fail review must have at least one finding", file=sys.stderr)
            return 1

        for idx, f in enumerate(findings):
            req_fields = ["severity", "title", "detail", "required_fix"]
            for field in req_fields:
                if field not in f:
                    print(f"FAIL code-review {adu_id}: findings[{idx}] missing field '{field}'", file=sys.stderr)
                    return 1
    else:
        print(f"FAIL code-review {adu_id}: invalid review_status '{status}'", file=sys.stderr)
        return 1

    print(f"PASS code-review {adu_id} status={status}")
    return 0


def validate_acceptance(report, adu_id, repo_root=None):
    if report.get("adu_id") != adu_id:
        print(f"FAIL acceptance {adu_id}: adu_id in JSON ('{report.get('adu_id')}') does not match expected '{adu_id}'", file=sys.stderr)
        return 1

    status = report.get("acceptance_status")
    next_state = report.get("next_state")

    # Load contract file to verify must_pass assertion coverage
    if repo_root:
        root = Path(repo_root)
    else:
        root = Path(__file__).resolve().parents[1]
    contract_path = root / ".ai-agent" / "contracts" / f"{adu_id}.json"
    if not contract_path.exists():
        print(f"FAIL acceptance {adu_id}: Contract file does not exist at {contract_path}", file=sys.stderr)
        return 1
    try:
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"FAIL acceptance {adu_id}: Failed to parse contract JSON: {e}", file=sys.stderr)
        return 1

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
            print(f"FAIL acceptance {adu_id}: status is 'pass' but next_state is '{next_state}' (expected 'acceptance_reviewed')", file=sys.stderr)
            return 1

        assertions = report.get("assertion_results", [])
        if not isinstance(assertions, list):
            print(f"FAIL acceptance {adu_id}: assertion_results must be a list", file=sys.stderr)
            return 1

        passed_assertions = {}
        for idx, item in enumerate(assertions):
            ass_id = item.get("assertion_id")
            if ass_id:
                passed_assertions[ass_id] = item.get("status")
            if item.get("status") != "pass":
                print(f"FAIL acceptance {adu_id}: assertion_results[{idx}] status is not 'pass' but acceptance_status is 'pass'", file=sys.stderr)
                return 1

        neg_assertions = report.get("negative_assertion_results", [])
        if not isinstance(neg_assertions, list):
            print(f"FAIL acceptance {adu_id}: negative_assertion_results must be a list", file=sys.stderr)
            return 1

        passed_negatives = {}
        for idx, item in enumerate(neg_assertions):
            neg_id = item.get("assertion_id")
            if neg_id:
                passed_negatives[neg_id] = item.get("status")
            if item.get("status") != "pass":
                print(f"FAIL acceptance {adu_id}: negative_assertion_results[{idx}] status is not 'pass' but acceptance_status is 'pass'", file=sys.stderr)
                return 1

        # Check coverage of must_pass contract assertions
        for ass_id in must_pass_acceptance:
            if ass_id not in passed_assertions:
                print(f"FAIL acceptance {adu_id}: must_pass acceptance assertion '{ass_id}' is not covered in report assertion_results", file=sys.stderr)
                return 1
            if passed_assertions[ass_id] != "pass":
                print(f"FAIL acceptance {adu_id}: must_pass acceptance assertion '{ass_id}' did not pass in report results (status: '{passed_assertions[ass_id]}')", file=sys.stderr)
                return 1

        for neg_id in must_pass_negative:
            if neg_id not in passed_negatives:
                print(f"FAIL acceptance {adu_id}: must_pass negative assertion '{neg_id}' is not covered in report negative_assertion_results", file=sys.stderr)
                return 1
            if passed_negatives[neg_id] != "pass":
                print(f"FAIL acceptance {adu_id}: must_pass negative assertion '{neg_id}' did not pass in report results (status: '{passed_negatives[neg_id]}')", file=sys.stderr)
                return 1

        mismatch = report.get("mismatch_findings", [])
        if isinstance(mismatch, list) and len(mismatch) > 0:
            print(f"FAIL acceptance {adu_id}: pass report cannot have mismatch_findings", file=sys.stderr)
            return 1

        missing = report.get("missing_evidence", [])
        if isinstance(missing, list) and len(missing) > 0:
            print(f"FAIL acceptance {adu_id}: pass report cannot have missing_evidence", file=sys.stderr)
            return 1

    elif status == "fail":
        if next_state != "acceptance_rework":
            print(f"FAIL acceptance {adu_id}: status is 'fail' but next_state is '{next_state}' (expected 'acceptance_rework')", file=sys.stderr)
            return 1

        mismatch = report.get("mismatch_findings", [])
        missing = report.get("missing_evidence", [])
        if (not isinstance(mismatch, list) or len(mismatch) == 0) and (not isinstance(missing, list) or len(missing) == 0):
            print(f"FAIL acceptance {adu_id}: fail report must have at least one mismatch_finding or missing_evidence item", file=sys.stderr)
            return 1
    else:
        print(f"FAIL acceptance {adu_id}: invalid acceptance_status '{status}'", file=sys.stderr)
        return 1

    print(f"PASS acceptance {adu_id} status={status}")
    return 0


def _resolve_registry() -> Path:
    registry_dir_env = os.environ.get("AGENT_FACTORY_REGISTRY_DIR")
    if registry_dir_env:
        return Path(registry_dir_env).resolve()
    projects_registry_env = os.environ.get("AGENT_FACTORY_PROJECTS_REGISTRY")
    if projects_registry_env:
        return Path(projects_registry_env).parent.resolve()
    return Path(__file__).resolve().parents[1] / ".ai-agent" / "registry"


def check_cross_project(adu_id: str, repo_root: str) -> int:
    """Reject evidence when the ADU's registered project does not own repo_root."""
    registry = _resolve_registry()
    adu_json = registry / "adu.json"
    if not adu_json.exists():
        return 0  # registry absent – skip cross-project check (e.g. test env)
    try:
        data = json.loads(adu_json.read_text(encoding="utf-8"))
    except Exception:
        return 0

    adu_entry = next((a for a in data.get("adus", []) if a.get("id") == adu_id), None)
    if adu_entry is None:
        return 0  # ADU not yet persisted – skip

    registered_repo = adu_entry.get("repo_path")
    if registered_repo and Path(registered_repo).resolve() != Path(repo_root).resolve():
        print(
            f"FAIL cross-project {adu_id}: ADU is bound to repo '{registered_repo}' "
            f"but evidence is being validated against '{repo_root}'",
            file=sys.stderr,
        )
        return 1
    return 0


def main():
    parser = argparse.ArgumentParser(description="Validate Quality Reports")
    parser.add_argument("--adu", required=True, help="ADU ID")
    parser.add_argument("--kind", choices=["code-review", "acceptance"], required=True, help="Report kind")
    parser.add_argument("--repo-root", help="Repository root path")
    args = parser.parse_args()

    if args.repo_root:
        root = Path(args.repo_root)
    else:
        root = Path(__file__).resolve().parents[1]

    # Cross-project evidence rejection
    if args.repo_root:
        rc = check_cross_project(args.adu, args.repo_root)
        if rc != 0:
            return rc

    if args.kind == "code-review":
        path = root / ".ai-agent" / "reviews" / f"{args.adu}-code-review.json"
    else:
        path = root / ".ai-agent" / "acceptance" / f"{args.adu}-acceptance-review.json"

    if not path.exists():
        print(f"FAIL {args.kind} {args.adu}: File does not exist at {path}", file=sys.stderr)
        return 1

    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"FAIL {args.kind} {args.adu}: Failed to parse JSON: {e}", file=sys.stderr)
        return 1

    if args.kind == "code-review":
        return validate_code_review(report, args.adu)
    else:
        return validate_acceptance(report, args.adu, repo_root=args.repo_root)

if __name__ == "__main__":
    sys.exit(main())

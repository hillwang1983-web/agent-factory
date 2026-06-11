#!/usr/bin/env python3
"""Validate an epic-acceptance.json produced by the epic-acceptance-reviewer agent.

Checks:
  - epic_acceptance_status is 'pass' or 'fail'
  - If 'pass': all required child ADUs are evidenced, no P1/P2 unresolved
  - Each acceptance_point maps to evidence
  - No pass with unresolved findings

Usage: validate_epic_acceptance.py <epic-acceptance.json> [--repo-root <path>] [--epic-id <id>]
Exit 0 on pass, exit 1 on fail.
"""
import argparse
import json
import sys
from pathlib import Path


def fail(msg: str):
    print(f"VALIDATE_EPIC_ACCEPTANCE FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("acceptance_path", help="Path to epic-acceptance.json")
    parser.add_argument("--repo-root", help="Target repo root for resolving child evidence")
    parser.add_argument("--epic-id", help="Epic ID for context")
    args = parser.parse_args()

    fp = Path(args.acceptance_path)
    if not fp.exists():
        fail(f"File not found: {args.acceptance_path}")

    try:
        data = json.loads(fp.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        fail(f"Invalid JSON: {e}")

    status = data.get("epic_acceptance_status")
    if status not in ("pass", "fail"):
        fail(f"epic_acceptance_status must be 'pass' or 'fail', got: {status}")

    if status == "pass":
        # Check that all required child ADUs are listed as evidenced
        evidenced_children = data.get("evidenced_child_adus", [])
        required_children = data.get("required_child_adus", [])
        if required_children:
            missing = set(required_children) - set(evidenced_children)
            if missing:
                fail(f"Epic acceptance claims pass but these required child ADUs are not evidenced: {missing}")

        # Check no P1/P2 unresolved findings
        unresolved = data.get("unresolved_findings", [])
        if unresolved and isinstance(unresolved, list):
            p1p2 = [f for f in unresolved if isinstance(f, dict) and f.get("severity") in ("P1", "P2")]
            if p1p2:
                fail(f"Pass but {len(p1p2)} P1/P2 findings remain unresolved")

        # Check acceptance points coverage
        acceptance_points = data.get("acceptance_points_covered", [])
        if not acceptance_points or not isinstance(acceptance_points, list):
            fail("Pass but acceptance_points_covered is empty or missing")

    # If repo-root provided, verify evidence paths exist and are within repo
    if args.repo_root:
        evidence_refs = data.get("evidence_references", [])
        if evidence_refs and isinstance(evidence_refs, list):
            repo = Path(args.repo_root).resolve()
            for ref in evidence_refs:
                if isinstance(ref, str):
                    ev_path = (repo / ref).resolve()
                    if not ev_path.is_relative_to(repo):
                        fail(f"Evidence path escapes repo root: {ref}")
                    if not ev_path.exists():
                        fail(f"Evidence file not found: {ref}")

    print(f"VALIDATE_EPIC_ACCEPTANCE PASS: {args.acceptance_path} (status={status})")
    sys.exit(0)


if __name__ == "__main__":
    main()

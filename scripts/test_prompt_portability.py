#!/usr/bin/env python3
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROMPT_DIR = ROOT / ".ai-agent" / "prompts"
DEFAULT_COMMON_CONTEXT = ROOT / "config" / "defaults" / "common-context.md"
POLICY_SCRIPT = ROOT / "scripts" / "write_path_policy.py"

FORBIDDEN_PROMPT_PATTERNS = {
    "Open5GS": re.compile(r"\bopen5gs\b", re.IGNORECASE),
    "5G/5GC": re.compile(r"\b5g(?:c|\s+core(?:-network)?)?\b", re.IGNORECASE),
    "telecom identifiers": re.compile(r"\b(?:imsi|supi|imei|gnb|amf|smf|upf|udm|udr|pfcp|ngap)\b", re.IGNORECASE),
    "UE-specific wording": re.compile(r"\b(?:suspended|online)\s+ue\b", re.IGNORECASE),
    "PDU session": re.compile(r"\bpdu\s+session", re.IGNORECASE),
    "telecom example database": re.compile(r"\bmongodb\b", re.IGNORECASE),
    "host-specific absolute path": re.compile(r"(?:/Users/|/home/)[^/\s]+/"),
}


def test_active_prompts_are_domain_neutral():
    violations = []
    prompt_sources = sorted(PROMPT_DIR.glob("*.md")) + [DEFAULT_COMMON_CONTEXT]
    for prompt_path in prompt_sources:
        text = prompt_path.read_text(encoding="utf-8")
        for label, pattern in FORBIDDEN_PROMPT_PATTERNS.items():
            for match in pattern.finditer(text):
                line = text.count("\n", 0, match.start()) + 1
                violations.append(f"{prompt_path.name}:{line}: {label}: {match.group(0)}")
    assert not violations, "Domain-specific content found in active prompts:\n" + "\n".join(violations)


def test_project_scoped_derivation_rule_is_not_applied_to_other_projects():
    with tempfile.TemporaryDirectory() as temp_dir:
        temp = Path(temp_dir)
        registry = temp / "registry"
        registry.mkdir()
        rules_path = temp / "rules.json"
        rules_path.write_text(json.dumps({
            "version": 1,
            "rules": [{
                "id": "project-specific-rule",
                "project_glob": "project-a",
                "when_requested_path_matches": ["src/module/*.c"],
                "allow_derived_paths": ["src/module/build.file"],
                "risk": "low",
                "reason": "Project A build registration"
            }],
            "blocked_paths": [],
            "high_risk_prefixes": []
        }), encoding="utf-8")
        (registry / "adu.json").write_text(json.dumps({
            "version": 1,
            "adus": [{
                "id": "ADU-OTHER",
                "project_id": "project-b",
                "allowed_write_paths": ["src/module/main.c"],
                "allowed_read_paths": ["src/module/main.c"]
            }]
        }), encoding="utf-8")

        result = subprocess.run(
            [
                sys.executable,
                str(POLICY_SCRIPT),
                "--adu", "ADU-OTHER",
                "--requested-paths", "src/module/build.file",
                "--repo-root", str(temp / "project-b"),
                "--registry-dir", str(registry),
                "--rules", str(rules_path),
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        payload = json.loads(result.stdout)
        assert payload["decision"] == "pending_human_approval", payload
        assert "project-specific-rule" not in payload.get("reason", ""), payload


def main():
    tests = [
        test_active_prompts_are_domain_neutral,
        test_project_scoped_derivation_rule_is_not_applied_to_other_projects,
    ]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except Exception as exc:
            failed += 1
            print(f"FAIL {test.__name__}: {exc}")
    print(f"{len(tests) - failed}/{len(tests)} tests passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import subprocess
import sys

LEAK_PATTERNS = [
    "/Users/" + "hill",
    "file:///Users/" + "hill",
    "/private/tmp" + "/",
    "/home/" + "user",
    "file:///home/" + "user",
    "e598a519-c339-45f3-b355-" + "069de5537fd5",
]

DOC_EXEMPT_PREFIXES = (
    "docs/superpowers/plans/",
    "docs/superpowers/specs/",
)

RUNTIME_REGISTRY_NAMES = {
    ".ai-agent/registry/adu.json",
    ".ai-agent/registry/runs.json",
    ".ai-agent/registry/reviews.json",
    ".ai-agent/registry/projects.json",
    ".ai-agent/registry/operations.json",
    ".ai-agent/registry/epics.json",
    ".ai-agent/registry/intake-drafts.json",
    ".ai-agent/registry/token-budget.json",
    ".ai-agent/registry/artifact-edits.json",
    ".ai-agent/registry/events.json",
    ".ai-agent/registry/evidence-waivers.json",
    ".ai-agent/registry/write-path-expansion-requests.json",
    ".ai-agent/registry/human-gates.json",
}

def run_git(workspace, args):
    result = subprocess.run(
        ["git", *args],
        cwd=str(workspace),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []
    return [line for line in result.stdout.splitlines() if line.strip()]

def check_json(path, errors):
    try:
        json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"Invalid JSON: {path}: {exc}")

def check_path_leaks(workspace, errors):
    tracked = run_git(workspace, ["ls-files"])
    for rel in tracked:
        if rel.startswith(DOC_EXEMPT_PREFIXES):
            continue
        path = workspace / rel
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for pattern in LEAK_PATTERNS:
            if pattern in text:
                errors.append(f"Tracked file leaks local path pattern {pattern}: {rel}")

def check_staged_runtime_files(workspace, errors):
    staged = run_git(workspace, ["diff", "--cached", "--name-only"])
    for rel in staged:
        if rel in RUNTIME_REGISTRY_NAMES:
            errors.append(f"Runtime registry file is staged and must remain host-local: {rel}")

def main():
    parser = argparse.ArgumentParser(description="Check Agent Factory portability and first-run configuration")
    parser.add_argument("--workspace", default=None)
    parser.add_argument("--skip-hermes", action="store_true")
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()

    workspace = pathlib.Path(args.workspace).expanduser().resolve() if args.workspace else pathlib.Path(__file__).resolve().parents[1]
    errors = []
    warnings = []

    if not workspace.exists():
        errors.append(f"Workspace does not exist: {workspace}")
    elif not os.access(workspace, os.W_OK):
        errors.append(f"Workspace is not writable: {workspace}")

    registry = workspace / ".ai-agent" / "registry"
    if not registry.exists():
        warnings.append(f"Registry directory does not exist yet: {registry}; run bootstrap")
    else:
        agents = registry / "agents.json"
        if not agents.exists():
            errors.append(f"Missing agents.json: {agents}")
        else:
            check_json(agents, errors)
            try:
                parsed = json.loads(agents.read_text(encoding="utf-8"))
                default_cwd = parsed.get("default_cwd", "")
                if default_cwd not in ("${PROJECT_REPO_ROOT}", "${AGENT_FACTORY_WORKSPACE}", str(workspace)):
                    errors.append(f"agents.json default_cwd must be tokenized or workspace-local: {default_cwd}")
            except Exception:
                pass

    hermes_config = pathlib.Path(os.environ.get("HERMES_CONFIG_PATH", pathlib.Path.home() / ".hermes" / "config.yaml")).expanduser()
    if not args.skip_hermes and not hermes_config.exists():
        errors.append(f"Hermes config not found: {hermes_config}")

    check_path_leaks(workspace, errors)
    check_staged_runtime_files(workspace, errors)

    payload = {
        "workspace": str(workspace),
        "errors": errors,
        "warnings": warnings,
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))

    if errors:
        sys.exit(1)
    if warnings and args.strict:
        sys.exit(2)
    sys.exit(0)

if __name__ == "__main__":
    main()

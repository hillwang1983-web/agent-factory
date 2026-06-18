#!/usr/bin/env python3
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATTERNS = [
    "/Users/" + "hill",
    "file:///Users/" + "hill",
    "/private/tmp" + "/",
    "/home/" + "user",
    "file:///home/" + "user",
]
EXEMPT_PREFIXES = ("docs/superpowers/plans/", "docs/superpowers/specs/")

def main():
    result = subprocess.run(["git", "ls-files"], cwd=str(ROOT), capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        return 1

    failures = []
    for rel in result.stdout.splitlines():
        if rel.startswith(EXEMPT_PREFIXES):
            continue
        path = ROOT / rel
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for pattern in PATTERNS:
            if pattern in text:
                failures.append(f"{rel}: contains {pattern}")

    if failures:
        print("Tracked local path leaks detected:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print("[PASS] no tracked local path leaks")
    return 0

if __name__ == "__main__":
    sys.exit(main())

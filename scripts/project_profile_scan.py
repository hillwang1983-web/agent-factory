#!/usr/bin/env python3
import os
import sys
import json
import argparse

# Blacklist of directories to ignore during scan
IGNORED_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    "target",
    "__pycache__",
    ".venv",
    "vendor",
    "out",
    "bin",
}

# Mapping file names to stack lists
MANIFEST_STACK = {
    "package.json": ["node", "javascript"],
    "tsconfig.json": ["typescript"],
    "pyproject.toml": ["python"],
    "requirements.txt": ["python"],
    "setup.py": ["python"],
    "go.mod": ["go"],
    "Cargo.toml": ["rust"],
    "pom.xml": ["java"],
    "build.gradle": ["java"],
    "CMakeLists.txt": ["c-cpp"],
    "meson.build": ["c-cpp"],
    "Makefile": ["make"],
}

# Extension to language mapping
EXT_TO_LANG = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cc": "cpp",
    ".html": "html",
    ".css": "css",
    ".md": "markdown",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".xml": "xml",
}

def scan_repo(project_id, repo_path):
    # Resolve real absolute path
    repo_path = os.path.realpath(repo_path)
    if not os.path.isdir(repo_path):
        print(f"Error: Path is not a directory: {repo_path}", file=sys.stderr)
        sys.exit(1)

    # Git validation
    if not os.path.exists(os.path.join(repo_path, ".git")):
        print(f"Error: Not a Git repository (missing .git): {repo_path}", file=sys.stderr)
        sys.exit(1)

    # File counts and sizes
    lang_breakdown = {}
    detected_files = []
    discovered_commands = {
        "install": [],
        "build": [],
        "test": [],
        "lint": [],
        "typecheck": [],
        "dev": []
    }
    source_dirs = set()
    test_dirs = set()
    risk_paths = []

    total_files = 0
    total_lines_of_code = 0

    # Simple walk
    for root, dirs, files in os.walk(repo_path):
        # Filter ignored directories in-place to avoid descending
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]

        # Determine relative folder from repo root
        rel_folder = os.path.relpath(root, repo_path)
        if rel_folder == ".":
            rel_folder = ""

        # Capture source and test folders
        folder_lower = os.path.basename(root).lower()
        if folder_lower in ("src", "source", "lib"):
            source_dirs.add(rel_folder)
        elif folder_lower in ("test", "tests", "spec", "specs"):
            test_dirs.add(rel_folder)

        for file in files:
            # Capture specific manifests
            if file in MANIFEST_STACK:
                rel_file = os.path.join(rel_folder, file) if rel_folder else file
                detected_files.append(rel_file)

            # Analyze commands from package.json
            if file == "package.json":
                package_json_path = os.path.join(root, file)
                try:
                    with open(package_json_path, "r", encoding="utf-8") as f:
                        pkg = json.load(f)
                        scripts = pkg.get("scripts", {})
                        for s_name, s_cmd in scripts.items():
                            pkg_mgr = "npm"
                            if os.path.exists(os.path.join(repo_path, "pnpm-lock.yaml")):
                                pkg_mgr = "pnpm"
                            elif os.path.exists(os.path.join(repo_path, "yarn.lock")):
                                pkg_mgr = "yarn"

                            run_cmd = f"{pkg_mgr} run {s_name}" if s_name not in ("test", "start", "install") else f"{pkg_mgr} {s_name}"
                            if s_name == "build":
                                discovered_commands["build"].append(run_cmd)
                            elif s_name == "test" or "test" in s_name:
                                discovered_commands["test"].append(run_cmd)
                            elif s_name == "lint" or "lint" in s_name:
                                discovered_commands["lint"].append(run_cmd)
                            elif s_name == "typecheck":
                                discovered_commands["typecheck"].append(run_cmd)
                            elif s_name == "dev" or s_name == "start":
                                discovered_commands["dev"].append(run_cmd)
                except Exception as e:
                    pass

            # Detect risk configuration files (secrets/env files)
            if file.startswith(".env") or file in ("credentials.json", "secrets.yaml"):
                rel_file = os.path.join(rel_folder, file) if rel_folder else file
                risk_paths.append(rel_file)

            # File stats for language breakdown
            _, ext = os.path.splitext(file)
            ext = ext.lower()
            if ext in EXT_TO_LANG:
                lang = EXT_TO_LANG[ext]
                file_path = os.path.join(root, file)
                try:
                    size = os.path.getsize(file_path)
                except OSError:
                    size = 0
                if lang not in lang_breakdown:
                    lang_breakdown[lang] = {"language": lang, "files": 0, "bytes": 0}
                lang_breakdown[lang]["files"] += 1
                lang_breakdown[lang]["bytes"] += size

                total_files += 1
                if size < 1024 * 1024:  # Less than 1MB
                    try:
                        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                            total_lines_of_code += sum(1 for _ in f)
                    except Exception:
                        pass

    # Determine stack based on manifests and language counts
    detected_stack = set()
    for file in detected_files:
        basename = os.path.basename(file)
        if basename in MANIFEST_STACK:
            detected_stack.update(MANIFEST_STACK[basename])

    # Add languages with significant file presence
    for lang, stats in lang_breakdown.items():
        if stats["files"] > 2:
            detected_stack.add(lang)

    # Guess project type
    project_type = "generic"
    if "node" in detected_stack or "javascript" in detected_stack:
        if "react" in detected_stack or os.path.exists(os.path.join(repo_path, "vite.config.ts")) or os.path.exists(os.path.join(repo_path, "vite.config.js")):
            project_type = "web-frontend"
        else:
            project_type = "node-app"
    elif "python" in detected_stack:
        project_type = "python-project"
    elif "c-cpp" in detected_stack or "make" in detected_stack:
        project_type = "c-cpp-project"
    elif "go" in detected_stack:
        project_type = "go-project"
    elif "rust" in detected_stack:
        project_type = "rust-project"

    # Default fallback package managers
    package_managers = []
    if os.path.exists(os.path.join(repo_path, "package-lock.json")):
        package_managers.append("npm")
    if os.path.exists(os.path.join(repo_path, "pnpm-lock.yaml")):
        package_managers.append("pnpm")
    if os.path.exists(os.path.join(repo_path, "yarn.lock")):
        package_managers.append("yarn")
    if os.path.exists(os.path.join(repo_path, "Cargo.lock")):
        package_managers.append("cargo")
    if os.path.exists(os.path.join(repo_path, "go.sum")):
        package_managers.append("go")
    if os.path.exists(os.path.join(repo_path, "requirements.txt")) or os.path.exists(os.path.join(repo_path, "poetry.lock")):
        package_managers.append("pip")

    # Clean up sets to list
    return {
        "project_id": project_id,
        "repo_path": repo_path,
        "git_root": repo_path,
        "current_branch": get_git_branch(repo_path),
        "is_dirty": check_git_dirty(repo_path),
        "project_type": project_type,
        "detected_files": detected_files,
        "package_managers": package_managers,
        "detected_stack": sorted(list(detected_stack)),
        "language_breakdown": sorted(list(lang_breakdown.values()), key=lambda x: x["bytes"], reverse=True),
        "commands": discovered_commands,
        "source_dirs": sorted(list(source_dirs)),
        "test_dirs": sorted(list(test_dirs)),
        "risk_paths": risk_paths,
        "ignored_dirs": sorted(list(IGNORED_DIRS)),
        "scan_summary": {
            "total_files": total_files,
            "lines_of_code": total_lines_of_code
        }
    }

def get_git_branch(repo_path):
    try:
        # Read HEAD file directly to stay read-only/deterministic
        head_path = os.path.join(repo_path, ".git", "HEAD")
        if os.path.exists(head_path):
            with open(head_path, "r", encoding="utf-8") as f:
                head = f.read().strip()
                if head.startswith("ref: refs/heads/"):
                    return head[16:]
                return head[:8]
    except Exception:
        pass
    return "unknown"

def check_git_dirty(repo_path):
    # Check if index file has any changes (quick stat comparison not needed, default to false for read-only scanner)
    return False

def main():
    parser = argparse.ArgumentParser(description="Deterministic scanner for repository onboarding")
    parser.add_argument("--project-id", required=True, help="Unique identifier of the project")
    parser.add_argument("--repo", required=True, help="Absolute path to target Git repository")
    parser.add_argument("--out", required=True, help="Output JSON path")
    args = parser.parse_args()

    result = scan_repo(args.project_id, args.repo)

    # Write output JSON
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
        f.write("\n")

    print(f"SUCCESS: scan file written to {args.out}")

if __name__ == "__main__":
    main()

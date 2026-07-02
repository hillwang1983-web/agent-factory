#!/usr/bin/env python3
import os
import sys
import json
import argparse
import subprocess
from datetime import datetime
from pathlib import Path

# Ensure local script directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from project_profile_contract import (
    normalize_profile_document,
    normalize_profile_summary,
    ProjectProfileContractError
)

def write_json_atomic(path, data):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target.with_name(f"{target.name}.tmp-{os.getpid()}")
    try:
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, target)
    finally:
        if temp_path.exists():
            temp_path.unlink()

def load_projects(projects_json_path):
    if not os.path.exists(projects_json_path):
        return {"version": 1, "projects": []}
    try:
        with open(projects_json_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error reading projects.json: {e}", file=sys.stderr)
        sys.exit(1)

def save_projects(projects_json_path, data):
    tmp_path = projects_json_path + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        os.rename(tmp_path, projects_json_path)
    except Exception as e:
        print(f"Error writing projects.json: {e}", file=sys.stderr)
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        sys.exit(1)

def run_cmd(args):
    print(f"Running command: {' '.join(args)}")
    res = subprocess.run(args, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Command failed with exit code {res.returncode}", file=sys.stderr)
        print(f"STDOUT:\n{res.stdout}", file=sys.stderr)
        print(f"STDERR:\n{res.stderr}", file=sys.stderr)
        return False, res.stdout, res.stderr
    return True, res.stdout, res.stderr

def resolve_workspace_root():
    env_value = os.environ.get("AGENT_FACTORY_WORKSPACE")
    if env_value and env_value.strip():
        return os.path.abspath(env_value.strip())
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def main():
    parser = argparse.ArgumentParser(description="Profile a registered Git repository")
    parser.add_argument("--project", required=True, help="Project ID to profile")
    args = parser.parse_args()

    # Workspace resolution
    workspace_root = resolve_workspace_root()
    projects_json_path = os.environ.get(
        "AGENT_FACTORY_PROJECTS_REGISTRY",
        os.path.join(workspace_root, ".ai-agent", "registry", "projects.json")
    )

    registry = load_projects(projects_json_path)
    projects = registry.get("projects", [])
    project = next((p for p in projects if p["project_id"] == args.project), None)

    if not project:
        print(f"Error: Project '{args.project}' not found in registry.", file=sys.stderr)
        sys.exit(1)

    repo_path = project["repo_path"]
    print(f"--- STARTING PROFILING FOR PROJECT '{args.project}' (Repo: {repo_path}) ---")

    # 1. Update project status to profiling
    project["status"] = "profiling"
    project["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    save_projects(projects_json_path, registry)

    # 2. Run deterministic scan
    scan_out_path = f"/tmp/{args.project}-scan.json"
    scan_script = os.path.join(workspace_root, "scripts", "project_profile_scan.py")
    
    scan_ok, scan_stdout, scan_stderr = run_cmd([
        "python3", scan_script,
        "--project-id", args.project,
        "--repo", repo_path,
        "--out", scan_out_path
    ])

    if not scan_ok:
        project["status"] = "profile_failed"
        project["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        save_projects(projects_json_path, registry)
        sys.exit(1)

    # 3. Spawn project-profiler LLM agent
    run_script = os.path.join(workspace_root, "scripts", "hermes_agent_run.py")
    agent_ok, agent_stdout, agent_stderr = run_cmd([
        "python3", run_script,
        "--project", args.project,
        "--repo", repo_path,
        "--agent", "project-profiler"
    ])

    # 4. Validate output files
    profile_json_path = os.path.join(repo_path, ".agent-factory", "project-profile.json")
    knowledge_dir = os.path.join(repo_path, ".agent-factory", "knowledge")
    
    req_docs = [
        "project-summary.md",
        "module-map.md",
        "test-strategy.md",
        "risk-map.md"
    ]

    files_valid = True
    if not agent_ok or not os.path.exists(profile_json_path):
        files_valid = False
        print("Error: Profiler Agent failed or profile.json was not generated.", file=sys.stderr)

    if files_valid:
        for doc in req_docs:
            doc_path = os.path.join(knowledge_dir, doc)
            if not os.path.exists(doc_path) or os.path.getsize(doc_path) == 0:
                files_valid = False
                print(f"Error: Missing or empty knowledge document: {doc_path}", file=sys.stderr)
                break

    if not files_valid:
        project["status"] = "profile_failed"
        project["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        save_projects(projects_json_path, registry)
        sys.exit(1)

    # 5. Extract profile summary and update projects.json
    try:
        with open(profile_json_path, "r", encoding="utf-8") as f:
            profile_data = json.load(f)

        # Load scan summary from deterministic scanner output
        scan_summary = {}
        if os.path.exists(scan_out_path):
            try:
                with open(scan_out_path, "r", encoding="utf-8") as sf:
                    scan_data = json.load(sf)
                    scan_summary = scan_data.get("scan_summary", {})
            except Exception as se:
                print(f"Warning: Failed to load scan summary from {scan_out_path}: {se}", file=sys.stderr)

        if scan_summary:
            profile_data["scan_summary"] = scan_summary

        # Normalize via Project Profile Contract
        canonical_profile = normalize_profile_document(profile_data)
        summary = normalize_profile_summary(canonical_profile)

        # Write back canonical v2 atomically
        write_json_atomic(profile_json_path, canonical_profile)

        project["profile_summary"] = summary

    except Exception as e:
        print(f"Error: Failed to parse or normalize project profile: {e}", file=sys.stderr)
        project["status"] = "profile_failed"
        project["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        save_projects(projects_json_path, registry)
        sys.exit(1)

    project["status"] = "profiled"
    project["last_profiled_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    project["updated_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    save_projects(projects_json_path, registry)

    # Cleanup temp scan file
    try:
        if os.path.exists(scan_out_path):
            os.remove(scan_out_path)
    except OSError:
        pass

    print(f"--- PROFILING COMPLETED SUCCESSFULLY FOR PROJECT '{args.project}' ---")

if __name__ == "__main__":
    main()

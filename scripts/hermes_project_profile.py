#!/usr/bin/env python3
import os
import sys
import json
import argparse
import subprocess
from datetime import datetime

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
            
        llm_langs = []
        if "detected_stack" in profile_data:
            if isinstance(profile_data["detected_stack"], list):
                for item in profile_data["detected_stack"]:
                    if isinstance(item, str):
                        llm_langs.append(item.lower())
                    elif isinstance(item, dict) and "language" in item:
                        llm_langs.append(item["language"].lower())
        elif "stack" in profile_data and "languages" in profile_data["stack"]:
            llm_langs = [l.lower() for l in profile_data["stack"]["languages"]]
        elif "tech_stack" in profile_data:
            primary = profile_data["tech_stack"].get("primary_language", "")
            secondary = profile_data["tech_stack"].get("secondary_languages", [])
            if primary:
                llm_langs.append(primary.split(" ")[0].lower())
            for s in secondary:
                llm_langs.append(s.lower())

        # Normalize names
        normalized_llm_langs = []
        for lang in llm_langs:
            lang = lang.replace("node.js", "javascript").replace("c++", "cpp").strip()
            if lang:
                normalized_llm_langs.append(lang)
        normalized_llm_langs = list(dict.fromkeys(normalized_llm_langs))

        # 5.2 Read language breakdown from the deterministic scan file
        scan_langs = {}
        if os.path.exists(scan_out_path):
            try:
                with open(scan_out_path, "r", encoding="utf-8") as sf:
                    scan_data = json.load(sf)
                    for item in scan_data.get("language_breakdown", []):
                        l_name = item["language"].lower().replace("c++", "cpp").replace("node.js", "javascript").strip()
                        scan_langs[l_name] = item.get("bytes", 0)
            except Exception as se:
                print(f"Warning: Failed to load scan summary: {se}", file=sys.stderr)

        # 5.3 Compute percentages based on byte size (fallback to equal split if no scan info or no bytes)
        detected_stack = []
        if scan_langs and normalized_llm_langs:
            lang_bytes = {}
            total_bytes = 0
            for lang in normalized_llm_langs:
                b = scan_langs.get(lang, 0)
                lang_bytes[lang] = b
                total_bytes += b

            if total_bytes > 0:
                for lang in normalized_llm_langs:
                    pct = round((lang_bytes[lang] / total_bytes) * 100)
                    detected_stack.append({"language": lang, "percentage": pct})
                
                # Ensure a minimum of 1% for any language identified by the LLM
                for item in detected_stack:
                    if item["percentage"] < 1:
                        item["percentage"] = 1
                
                # Adjust sum to exactly 100%
                total_pct = sum(item["percentage"] for item in detected_stack)
                if total_pct != 100 and len(detected_stack) > 0:
                    max_item = max(detected_stack, key=lambda x: x["percentage"])
                    max_item["percentage"] += (100 - total_pct)
            
        if not detected_stack and normalized_llm_langs:
            pct = round(100 / max(len(normalized_llm_langs), 1))
            detected_stack = [{"language": lang, "percentage": pct} for lang in normalized_llm_langs]
            total_pct = sum(item["percentage"] for item in detected_stack)
            if total_pct != 100 and len(detected_stack) > 0:
                detected_stack[0]["percentage"] += (100 - total_pct)

        project_type = profile_data.get("project_type", "unknown")
        if project_type == "unknown" and "tech_stack" in profile_data:
            build_system = profile_data["tech_stack"].get("build_system", "").lower()
            primary_lang = profile_data["tech_stack"].get("primary_language", "").lower()
            if build_system in ("meson", "cmake") or primary_lang.startswith("c"):
                project_type = "c-cpp-project"

        risk_level = profile_data.get("risk_level", "unknown")
        if risk_level == "unknown":
            if "risk_map" in profile_data and "high_risk_paths" in profile_data["risk_map"]:
                count = len(profile_data["risk_map"]["high_risk_paths"])
                risk_level = "high" if count >= 5 else "medium" if count >= 2 else "low"
            elif "risks" in profile_data:
                count = len(profile_data["risks"])
                risk_level = "high" if count >= 5 else "medium" if count >= 2 else "low"
        
        disc_cmds = profile_data.get("discovered_commands", {})
        build_val = disc_cmds.get("build", [])
        if (not build_val or len(build_val) == 0) and "commands" in profile_data:
            build_val = profile_data["commands"].get("build", [])
        
        if isinstance(build_val, dict):
            build_commands = list(build_val.values())
        elif isinstance(build_val, str):
            build_commands = [build_val]
        else:
            build_commands = build_val if build_val else []

        test_val = disc_cmds.get("test", [])
        if (not test_val or len(test_val) == 0) and "commands" in profile_data:
            test_val = profile_data["commands"].get("test", [])
            
        if isinstance(test_val, dict):
            test_commands = list(test_val.values())
        elif isinstance(test_val, str):
            test_commands = [test_val]
        else:
            test_commands = test_val if test_val else []

        # Load scan summary from deterministic scanner output
        scan_summary = {}
        if os.path.exists(scan_out_path):
            try:
                with open(scan_out_path, "r", encoding="utf-8") as sf:
                    scan_data = json.load(sf)
                    scan_summary = scan_data.get("scan_summary", {})
            except Exception as se:
                print(f"Warning: Failed to load scan summary from {scan_out_path}: {se}", file=sys.stderr)

        # Write the normalized values back to project-profile.json to keep in sync
        profile_data["detected_stack"] = detected_stack
        profile_data["project_type"] = project_type
        profile_data["risk_level"] = risk_level
        with open(profile_json_path, "w", encoding="utf-8") as pf:
            json.dump(profile_data, pf, indent=2)
            pf.write("\n")

        project["profile_summary"] = {
            "detected_stack": detected_stack,
            "project_type": project_type,
            "risk_level": risk_level,
            "build_commands": build_commands,
            "test_commands": test_commands,
            "scan_summary": scan_summary
        }
    except Exception as e:
        print(f"Warning: Failed to parse generated project-profile.json: {e}", file=sys.stderr)

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

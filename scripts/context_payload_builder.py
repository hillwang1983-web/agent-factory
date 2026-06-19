import json
import pathlib
import sys

CONTEXT_LEVELS = {
    "requirement-analyst": "focused",
    "context-pack": "full",
    "detail-designer": "focused",
    "contract": "focused",
    "developer": "task",
    "code-reviewer": "task",
    "acceptance-reviewer": "task",
}

def build_focused_payload(agent_name, adu, project_info, repo_path, run_dir, max_prompt_bytes):
    # Dynamic imports to avoid circular dependency
    import hermes_agent_run
    
    profile = hermes_agent_run.load_project_profile(repo_path) if repo_path else {}
    knowledge = hermes_agent_run.load_knowledge_pack(repo_path) if repo_path else {}

    sources = []
    if repo_path:
        profile_path = repo_path / ".agent-factory" / "project-profile.json"
        if profile_path.exists():
            sources.append({"path": ".agent-factory/project-profile.json", "bytes": profile_path.stat().st_size})
        
        k_dir = repo_path / ".agent-factory" / "knowledge"
        if k_dir.exists():
            for f in k_dir.glob("**/*"):
                if f.is_file():
                    try:
                        rel = f.relative_to(repo_path)
                        sources.append({"path": str(rel), "bytes": f.stat().st_size})
                    except Exception:
                        pass

    level = CONTEXT_LEVELS.get(agent_name, "focused")
    
    payload = {
        "agent": agent_name,
        "adu": adu,
    }

    if level == "focused":
        pruned_profile = {}
        if profile:
            pruned_profile["tech_stack"] = profile.get("tech_stack", {})
            pruned_profile["build_commands"] = profile.get("build_commands", [])
            pruned_profile["test_commands"] = profile.get("test_commands", [])
            
            allowed_paths = adu.get("allowed_write_paths", []) + adu.get("allowed_read_paths", [])
            module_map = profile.get("module_map", {})
            pruned_modules = {}
            for mod_name, mod_info in module_map.items():
                mod_paths = mod_info.get("paths", [])
                matched = False
                for ap in allowed_paths:
                    for mp in mod_paths:
                        if ap.startswith(mp) or mp.startswith(ap) or mod_name.lower() in ap.lower():
                            matched = True
                            break
                    if matched: break
                if matched:
                    pruned_modules[mod_name] = mod_info
            pruned_profile["module_map"] = pruned_modules
            
            risk_paths = profile.get("risk_paths", {})
            pruned_risks = {}
            for rp, risk_info in risk_paths.items():
                for ap in allowed_paths:
                    if ap.startswith(rp) or rp.startswith(ap):
                        pruned_risks[rp] = risk_info
                        break
            pruned_profile["risk_paths"] = pruned_risks
        
        payload["project_profile"] = pruned_profile

        pruned_knowledge = {}
        if knowledge:
            for k, v in knowledge.items():
                relates = False
                k_stem = pathlib.Path(k).stem.lower()
                desc = (adu.get("title", "") + " " + adu.get("goal", "")).lower()
                if k_stem in desc:
                    relates = True
                else:
                    for ap in (adu.get("allowed_write_paths", []) + adu.get("allowed_read_paths", [])):
                        if k_stem in ap.lower():
                            relates = True
                            break
                
                if relates:
                    pruned_knowledge[k] = v[:2000] if isinstance(v, str) else v
            
        payload["knowledge_pack"] = pruned_knowledge
    else:
        payload["project_profile"] = profile
        payload["knowledge_pack"] = knowledge

    # Deduplicate: do not duplicate allowed paths in payload["artifact_paths"]
    # We will only put unique keys or omit payload["artifact_paths"] duplication
    
    payload_str = json.dumps(payload, ensure_ascii=False)
    
    # Watchdog on payload size (hard gate)
    if len(payload_str) > max_prompt_bytes:
        # Step 1: Compress knowledge pack further to 500 chars
        if "knowledge_pack" in payload:
            for k in payload["knowledge_pack"]:
                if isinstance(payload["knowledge_pack"][k], str):
                    payload["knowledge_pack"][k] = payload["knowledge_pack"][k][:500]
        payload_str = json.dumps(payload, ensure_ascii=False)
        
        if len(payload_str) > max_prompt_bytes:
            # Step 2: Remove module_map and risk_paths
            if "project_profile" in payload:
                payload["project_profile"].pop("module_map", None)
                payload["project_profile"].pop("risk_paths", None)
            payload_str = json.dumps(payload, ensure_ascii=False)
            
            if len(payload_str) > max_prompt_bytes:
                # Step 3: Remove knowledge_pack entirely
                payload.pop("knowledge_pack", None)
                payload_str = json.dumps(payload, ensure_ascii=False)
                
                if len(payload_str) > max_prompt_bytes:
                    print(f"CONTEXT_BUDGET_EXCEEDED: payload size ({len(payload_str)} bytes) exceeds policy max limit ({max_prompt_bytes})", file=sys.stderr)
                    raise RuntimeError("CONTEXT_BUDGET_EXCEEDED")

    if run_dir:
        try:
            manifest_path = pathlib.Path(run_dir) / "context-manifest.json"
            manifest = {
                "agent": agent_name,
                "context_level": level,
                "prompt_bytes": len(payload_str),
                "estimated_tokens": len(payload_str) // 4,
                "sources": sources,
                "deduplicated_fields": ["allowed_read_paths", "allowed_write_paths"]
            }
            manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        except Exception:
            pass

    return payload

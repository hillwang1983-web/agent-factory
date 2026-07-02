#!/usr/bin/env python3
import json
import os
from pathlib import Path

class ProjectProfileContractError(ValueError):
    pass

def normalize_repo_path(path_value: str) -> str:
    # Basic path normalization for string checks
    return os.path.normpath(path_value.replace("\\", "/")).replace("\\", "/")

def _extract_commands_from_legacy(commands_val, default_id_prefix: str) -> list:
    extracted = []
    if isinstance(commands_val, str):
        if commands_val.strip():
            extracted.append({
                "id": default_id_prefix,
                "command": commands_val.strip(),
                "source": "package.json"
            })
    elif isinstance(commands_val, list):
        for idx, item in enumerate(commands_val):
            if isinstance(item, str) and item.strip():
                extracted.append({
                    "id": f"{default_id_prefix}_{idx}",
                    "command": item.strip(),
                    "source": "package.json"
                })
            elif isinstance(item, dict) and "command" in item:
                cmd = item.get("command")
                if isinstance(cmd, str) and cmd.strip():
                    extracted.append({
                        "id": str(item.get("id") or f"{default_id_prefix}_{idx}"),
                        "command": cmd.strip(),
                        "source": str(item.get("source") or "package.json")
                    })
    elif isinstance(commands_val, dict):
        for key, val in commands_val.items():
            if isinstance(val, str) and val.strip():
                extracted.append({
                    "id": key,
                    "command": val.strip(),
                    "source": "package.json"
                })
            elif isinstance(val, dict) and "command" in val:
                cmd = val.get("command")
                if isinstance(cmd, str) and cmd.strip():
                    extracted.append({
                        "id": str(val.get("id") or key),
                        "command": cmd.strip(),
                        "source": str(val.get("source") or "package.json")
                    })
    return extracted

def normalize_profile_document(profile: dict) -> dict:
    """Normalize a project profile to the canonical v2 layout."""
    if not isinstance(profile, dict):
        raise ProjectProfileContractError("Profile must be a dictionary.")

    # Check if already v2
    if profile.get("schema_version") == 2:
        # Validate minimal v2 structure to ensure robustness
        v2_doc = {
            "schema_version": 2,
            "project_id": str(profile.get("project_id", "unknown-project")),
            "project_type": str(profile.get("project_type", "unknown-type")),
            "detected_stack": profile.get("detected_stack") or [],
            "commands": profile.get("commands") or {"safe": {"build": [], "test": []}, "ambiguous": [], "unsafe": []},
            "risk_profile": profile.get("risk_profile") or {"risk_level": "unknown", "reasons": []},
        }
        if "scan_summary" in profile:
            v2_doc["scan_summary"] = profile["scan_summary"]
        return v2_doc

    # It's a legacy (or v1) profile. Let's convert it to canonical v2.
    project_id = str(profile.get("project_id") or "unknown-project")
    project_type = str(profile.get("project_type") or "unknown-type")

    # Normalize detected_stack
    detected_stack_raw = profile.get("detected_stack") or []
    detected_stack = []
    if isinstance(detected_stack_raw, list):
        for item in detected_stack_raw:
            if isinstance(item, str):
                detected_stack.append({"language": item, "percentage": 100})
            elif isinstance(item, dict) and "language" in item:
                detected_stack.append({
                    "language": str(item.get("language")),
                    "percentage": float(item.get("percentage") or 100)
                })

    # Normalize commands: extract discovered_commands or commands
    commands_src = profile.get("discovered_commands") or profile.get("commands") or {}
    safe_build = []
    safe_test = []

    if isinstance(commands_src, dict):
        legacy_build = commands_src.get("build")
        legacy_test = commands_src.get("test")
        safe_build = _extract_commands_from_legacy(legacy_build, "build")
        safe_test = _extract_commands_from_legacy(legacy_test, "test")

    commands = {
        "safe": {
            "build": safe_build,
            "test": safe_test
        },
        "ambiguous": [],
        "unsafe": []
    }

    # Normalize risk_profile
    risk_level = "unknown"
    reasons = []
    risk_profile_raw = profile.get("risk_profile")
    if isinstance(risk_profile_raw, dict):
        risk_level = risk_profile_raw.get("risk_level") or "unknown"
        reasons = risk_profile_raw.get("reasons") or []
    else:
        risk_level = profile.get("risk_level") or "unknown"

    if risk_level not in ["low", "medium", "high", "unknown"]:
        risk_level = "unknown"

    risk_profile = {
        "risk_level": risk_level,
        "reasons": reasons
    }

    v2_doc = {
        "schema_version": 2,
        "project_id": project_id,
        "project_type": project_type,
        "detected_stack": detected_stack,
        "commands": commands,
        "risk_profile": risk_profile
    }

    if "scan_summary" in profile:
        v2_doc["scan_summary"] = profile["scan_summary"]

    return v2_doc

def normalize_profile_summary(profile: dict) -> dict:
    """Normalize a profile and extract the summary (safe build/test commands and risk level)."""
    canonical = normalize_profile_document(profile)

    # Risk level extraction
    risk_level = canonical.get("risk_profile", {}).get("risk_level", "unknown")
    if risk_level not in ["low", "medium", "high", "unknown"]:
        risk_level = "unknown"

    # Safe build commands extraction
    build_commands = []
    seen_build = set()
    for item in canonical.get("commands", {}).get("safe", {}).get("build", []):
        cmd = item.get("command")
        if isinstance(cmd, str) and cmd.strip():
            cmd_cleaned = cmd.strip()
            if cmd_cleaned not in seen_build:
                seen_build.add(cmd_cleaned)
                build_commands.append(cmd_cleaned)

    # Safe test commands extraction
    test_commands = []
    seen_test = set()
    for item in canonical.get("commands", {}).get("safe", {}).get("test", []):
        cmd = item.get("command")
        if isinstance(cmd, str) and cmd.strip():
            cmd_cleaned = cmd.strip()
            if cmd_cleaned not in seen_test:
                seen_test.add(cmd_cleaned)
                test_commands.append(cmd_cleaned)

    return {
        "detected_stack": canonical.get("detected_stack") or [],
        "project_type": canonical.get("project_type") or "unknown-type",
        "risk_level": risk_level,
        "build_commands": build_commands,
        "test_commands": test_commands,
        "scan_summary": canonical.get("scan_summary") or {}
    }

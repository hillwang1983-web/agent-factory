#!/usr/bin/env python3
import sys
import pathlib

sys.path.append(str(pathlib.Path(__file__).resolve().parent))
from context_payload_builder import build_focused_payload

def run_tests():
    print("Running Context Payload Builder Tests...")

    # Mock parameters
    adu = {
        "id": "ADU-1351-001",
        "title": "ogs-license restriction",
        "goal": "implement sign up restriction",
        "allowed_read_paths": ["lib/app/ogs-license.c"],
        "allowed_write_paths": ["lib/app/ogs-license.c"]
    }
    
    project_info = {
        "project_id": "open5gs"
    }

    import hermes_agent_run
    
    orig_profile = getattr(hermes_agent_run, "load_project_profile", None)
    orig_knowledge = getattr(hermes_agent_run, "load_knowledge_pack", None)

    # Mock profile and knowledge pack
    mock_profile = {
        "tech_stack": {"lang": "C"},
        "build_commands": ["meson compile"],
        "test_commands": ["./test/license/test-license"],
        "module_map": {
            "license-module": {
                "paths": ["lib/app/ogs-license.c"]
            },
            "unrelated-module": {
                "paths": ["lib/core/ogs-core.c"]
            }
        },
        "risk_paths": {
            "lib/app/": "medium",
            "lib/core/": "high"
        }
    }

    large_text = "A" * 5000
    mock_knowledge = {
        "ogs-license.md": large_text,
        "unrelated.md": "some unrelated content"
    }

    hermes_agent_run.load_project_profile = lambda path: mock_profile
    hermes_agent_run.load_knowledge_pack = lambda path: mock_knowledge

    try:
        # Case 1: Pruning works
        print("Testing Case 1: Focused pruning & length limit...")
        payload = build_focused_payload(
            "requirement-analyst",
            adu,
            project_info,
            pathlib.Path("."),
            None,
            60000
        )

        assert "project_profile" in payload
        profile_res = payload["project_profile"]
        assert "license-module" in profile_res["module_map"]
        assert "unrelated-module" not in profile_res["module_map"], "Unrelated module not pruned"
        assert "lib/app/" in profile_res["risk_paths"]
        assert "lib/core/" not in profile_res["risk_paths"], "Unrelated risk path not pruned"

        assert "knowledge_pack" in payload
        k_pack = payload["knowledge_pack"]
        assert "ogs-license.md" in k_pack
        assert "unrelated.md" not in k_pack, "Unrelated knowledge file not pruned"
        assert len(k_pack["ogs-license.md"]) == 2000, f"Expected 2000 chars, got {len(k_pack['ogs-license.md'])}"

        # Case 2: Size hard gate - level 1 (compress knowledge pack to 500 chars)
        print("Testing Case 2: Compression level 1...")
        payload = build_focused_payload(
            "requirement-analyst",
            adu,
            project_info,
            pathlib.Path("."),
            None,
            2450
        )
        assert len(payload["knowledge_pack"]["ogs-license.md"]) == 500

        # Case 3: Size hard gate - level 2 (removes module_map/risk_paths)
        print("Testing Case 3: Compression level 2...")
        payload = build_focused_payload(
            "requirement-analyst",
            adu,
            project_info,
            pathlib.Path("."),
            None,
            1000
        )
        assert "module_map" not in payload["project_profile"]
        assert "risk_paths" not in payload["project_profile"]

        # Case 4: Size hard gate - level 3 (removes knowledge pack)
        print("Testing Case 4: Compression level 3...")
        payload = build_focused_payload(
            "requirement-analyst",
            adu,
            project_info,
            pathlib.Path("."),
            None,
            800
        )
        assert "knowledge_pack" not in payload

        # Case 5: Hard budget exceeded error
        print("Testing Case 5: Hard budget exceeded...")
        threw = False
        try:
            build_focused_payload(
                "requirement-analyst",
                adu,
                project_info,
                None,
                None,
                100
            )
        except RuntimeError as exc:
            if "CONTEXT_BUDGET_EXCEEDED" in str(exc):
                threw = True
        
        assert threw, "Expected CONTEXT_BUDGET_EXCEEDED"

        print("✅ All Context Payload Builder Tests Passed!")

    finally:
        if orig_profile: hermes_agent_run.load_project_profile = orig_profile
        if orig_knowledge: hermes_agent_run.load_knowledge_pack = orig_knowledge

if __name__ == "__main__":
    try:
        run_tests()
    except Exception as e:
        print(f"Test failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

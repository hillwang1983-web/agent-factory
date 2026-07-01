#!/usr/bin/env python3
import sys
import pathlib
import copy

sys.path.append(str(pathlib.Path(__file__).resolve().parent))
import validate_epic_split_plan

def run_tests():
    print("Running validate_epic_split_plan semantic tests...")

    # Mock fail to raise AssertionError
    def mock_fail(msg):
        raise AssertionError(msg)
    validate_epic_split_plan.fail = mock_fail

    # Mock profile and system flow data
    profile_data = {
        "risk_paths": {
            "lib/core/": "high",
            "lib/proto/": "medium"
        }
    }

    system_flow_data = {
        "acceptance_points": [
            "Suspend changes MongoDB admin_status to SUSPENDED",
            "Suspended UE registration is rejected"
        ]
    }

    # Case 5: Correct License split plan (all pass)
    base_plan = {
        "decision": "split_required",
        "child_adus": [
            {
                "id": "ADU-1351-001",
                "title": "ogs-license core",
                "goal": "core library implementation",
                "scope": "lib/app",
                "allowed_write_paths": ["lib/app/ogs-license.c", "lib/app/meson.build"],
                "required_deliverables": ["lib/app/ogs-license.c", "lib/app/meson.build"],
                "allowed_read_paths": [],
                "required_commands": ["meson compile"],
                "acceptance_summary": "core logic works"
            },
            {
                "id": "ADU-1351-002",
                "title": "ogs-license WebUI",
                "goal": "WebUI components",
                "scope": "webui",
                "allowed_write_paths": ["webui/src/pages/license.js", "backend/routes/license.js"],
                "required_deliverables": ["webui/src/pages/license.js", "backend/routes/license.js"],
                "allowed_read_paths": [],
                "required_commands": [],
                "acceptance_summary": "UI renders correctly"
            }
        ],
        "dependencies": [
            {
                "from": "ADU-1351-001",
                "to": "ADU-1351-002",
                "semantics": "prerequisite_to_dependent",
                "reason": "UI depends on core module"
            }
        ],
        "acceptance_coverage": [
            {
                "acceptance_id": "Suspend changes MongoDB admin_status to SUSPENDED",
                "covered_by": ["ADU-1351-001"],
                "required_paths": ["lib/app/ogs-license.c"]
            },
            {
                "acceptance_id": "Suspended UE registration is rejected",
                "covered_by": ["ADU-1351-002"],
                "required_paths": ["webui/src/pages/license.js"]
            }
        ]
    }

    print("Testing Case 5: All correct split plan passes...")
    validate_epic_split_plan.check_split_semantics(base_plan, profile_data, system_flow_data)

    # Case 1: Dependency semantics error
    print("Testing Case 1: Dependency semantics error...")
    plan = copy.deepcopy(base_plan)
    plan["dependencies"][0]["semantics"] = "dependent_to_prerequisite"
    try:
        validate_epic_split_plan.check_split_semantics(plan, profile_data, system_flow_data)
        assert False, "Expected dependency semantics failure"
    except AssertionError as e:
        assert "must be 'prerequisite_to_dependent'" in str(e), f"Unexpected message: {e}"

    # Case 2: WebUI requirement only frontend or only backend
    print("Testing Case 2: WebUI requirement missing dual paths...")
    plan = copy.deepcopy(base_plan)
    plan["child_adus"][1]["allowed_write_paths"] = ["backend/routes/license.js"] # Frontend missing
    plan["child_adus"][1]["required_deliverables"] = ["backend/routes/license.js"]
    try:
        validate_epic_split_plan.check_split_semantics(plan, profile_data, system_flow_data)
        assert False, "Expected WebUI path failure"
    except AssertionError as e:
        assert "missing either frontend or backend paths" in str(e), f"Unexpected message: {e}"

    # Case 3: Test command references unauthorized file
    print("Testing Case 3: Test command references unauthorized file...")
    plan = copy.deepcopy(base_plan)
    plan["child_adus"][0]["required_commands"] = ["pytest tests/test-license.py"]
    try:
        validate_epic_split_plan.check_split_semantics(plan, profile_data, system_flow_data)
        assert False, "Expected command path authorization failure"
    except AssertionError as e:
        assert "references path 'tests/test-license.py' which is not in" in str(e), f"Unexpected message: {e}"

    # Case 4: High risk path changes without risk_justification
    print("Testing Case 4: High-risk path missing justification...")
    plan = copy.deepcopy(base_plan)
    plan["child_adus"][0]["allowed_write_paths"].append("lib/core/ogs-core.c")
    try:
        validate_epic_split_plan.check_split_semantics(plan, profile_data, system_flow_data)
        assert False, "Expected risk justification failure"
    except AssertionError as e:
        assert "modifies high-risk path" in str(e) and "risk_justification" in str(e), f"Unexpected message: {e}"

    # Case 4.1: High risk path WITH justification passes
    print("Testing Case 4.1: High-risk path WITH justification passes...")
    plan = copy.deepcopy(base_plan)
    plan["child_adus"][0]["allowed_write_paths"].append("lib/core/ogs-core.c")
    plan["child_adus"][0]["risk_justification"] = "Required to register core lifecycle handler"
    validate_epic_split_plan.check_split_semantics(plan, profile_data, system_flow_data)

    # Case 6: codeless and required_deliverables both present
    print("Testing Case 6: codeless and required_deliverables both present...")
    plan = copy.deepcopy(base_plan)
    plan["child_adus"][0]["codeless"] = True
    try:
        validate_epic_split_plan.check_split_semantics(plan, profile_data, system_flow_data)
        assert False, "Expected failure because codeless ADU cannot have required_deliverables"
    except AssertionError as e:
        assert "is codeless but has required_deliverables defined" in str(e), f"Unexpected message: {e}"

    # Case 7: required deliverable out of write paths
    print("Testing Case 7: required deliverable out of write paths...")
    plan = copy.deepcopy(base_plan)
    plan["child_adus"][0]["required_deliverables"].append("lib/outside/file.c")
    try:
        validate_epic_split_plan.check_split_semantics(plan, profile_data, system_flow_data)
        assert False, "Expected failure because required deliverable is outside allowed_write_paths"
    except AssertionError as e:
        assert "is not in allowed_write_paths" in str(e), f"Unexpected message: {e}"

    # Case 8: required_deliverables is not a list
    print("Testing Case 8: required_deliverables is not a list...")
    plan = copy.deepcopy(base_plan)
    plan["child_adus"][0]["required_deliverables"] = "not-a-list"
    try:
        validate_epic_split_plan.check_split_semantics(plan, profile_data, system_flow_data)
        assert False, "Expected failure because required_deliverables is not a list"
    except AssertionError as e:
        assert "must specify either 'codeless': true OR a non-empty list" in str(e), f"Unexpected message: {e}"

    print("✅ All validate_epic_split_plan semantic tests passed!")

if __name__ == "__main__":
    try:
        run_tests()
    except Exception as e:
        print(f"Test failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

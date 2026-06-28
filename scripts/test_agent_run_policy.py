#!/usr/bin/env python3
import sys
import os
import pathlib
import time
import json
import subprocess
import signal

# Add current scripts folder to sys.path
sys.path.append(str(pathlib.Path(__file__).parent))
from agent_run_policy import AgentRunPolicy, execute_controlled_process

def is_pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True

def run_tests():
    print("Running Agent Run Policy Watchdog Tests...")

    workspace = pathlib.Path(__file__).resolve().parent.parent
    scripts_dir = workspace / "scripts"

    # We will write a temp mock_hermes.py
    mock_hermes_path = scripts_dir / "temp_mock_hermes.py"
    mock_hermes_code = """import sys
import time
import pathlib
import json

scenario = sys.argv[1]
output_file = pathlib.Path(sys.argv[2])

if scenario == "success":
    output_file.write_text(json.dumps({"result": "success", "status": "completed"}), encoding="utf-8")
    sys.exit(0)

elif scenario == "infinite_output":
    # Infinite output with no target file created
    for i in range(100):
        print(f"Substantive progress step {i}")
        sys.stdout.flush()
        time.sleep(0.5)
    sys.exit(0)

elif scenario == "silent":
    # Silent sleep
    time.sleep(100)
    sys.exit(0)

elif scenario == "silent_success":
    # Hermes oneshot can remain silent while inference is in progress.
    time.sleep(3)
    output_file.write_text(json.dumps({"result": "success", "status": "completed"}), encoding="utf-8")
    sys.exit(0)

elif scenario == "progress_then_stall":
    print("Substantive progress started")
    sys.stdout.flush()
    time.sleep(100)
    sys.exit(0)

elif scenario == "no_exit":
    # Write outcome and then hang
    output_file.write_text(json.dumps({"result": "success", "status": "completed"}), encoding="utf-8")
    time.sleep(100)
    sys.exit(0)

elif scenario == "completion_success_then_hang":
    completion_file = pathlib.Path(sys.argv[3])
    output_file.write_text("business artifact", encoding="utf-8")
    tmp_path = completion_file.with_suffix(".tmp")
    tmp_path.write_text(json.dumps({
        "version": 1,
        "status": "success",
        "result": {
            "result": "success",
            "next_state": "contracted",
            "changed_files": [str(output_file)],
            "commands_run": [],
            "artifacts": [str(output_file)],
            "risks": [
                {
                    "description": "API signature mismatch risk",
                    "severity": "medium",
                    "mitigation": "Perform automated checks during builds"
                },
                "Standard string risk"
            ],
            "next_agent": "testwriter"
        }
    }), encoding="utf-8")
    tmp_path.replace(completion_file)
    time.sleep(100)
    sys.exit(0)

elif scenario == "completion_invalid_version":
    completion_file = pathlib.Path(sys.argv[3])
    tmp_path = completion_file.with_suffix(".tmp")
    tmp_path.write_text(json.dumps({
        "version": 2,
        "status": "success",
        "result": {"result": "success"}
    }), encoding="utf-8")
    tmp_path.replace(completion_file)
    time.sleep(100)
    sys.exit(0)

elif scenario == "completion_missing_fields":
    completion_file = pathlib.Path(sys.argv[3])
    tmp_path = completion_file.with_suffix(".tmp")
    tmp_path.write_text(json.dumps({
        "version": 1,
        "status": "success",
        "result": {"result": "success"}
    }), encoding="utf-8")
    tmp_path.replace(completion_file)
    time.sleep(100)
    sys.exit(0)

elif scenario == "completion_human_gate_then_hang":
    completion_file = pathlib.Path(sys.argv[3])
    output_file.write_text("business artifact", encoding="utf-8")
    tmp_path = completion_file.with_suffix(".tmp")
    tmp_path.write_text(json.dumps({
        "version": 1,
        "status": "human_gate",
        "result": {
            "result": "human_gate",
            "next_state": "human_gate",
            "changed_files": [str(output_file)],
            "commands_run": [],
            "artifacts": [str(output_file)],
            "risks": [
                {
                    "description": "Requires environment validation evidence verification",
                    "severity": "high",
                    "mitigation": "Manually verify deployment log"
                }
            ],
            "next_agent": "human"
        }
    }), encoding="utf-8")
    tmp_path.replace(completion_file)
    time.sleep(100)
    sys.exit(0)

elif scenario == "write_business_json_then_completion":
    print(json.dumps({
        "version": 1,
        "adu_id": "ADU-TEST",
        "source": "code-review",
        "must_fix_now": []
    }), flush=True)
    completion_file = pathlib.Path(sys.argv[3])
    envelope = {
        "version": 1,
        "status": "success",
        "result": {
            "result": "success",
            "next_state": "rework_planned",
            "changed_files": [".ai-agent/rework/ADU-TEST-rework-plan.json"],
            "artifacts": [".ai-agent/rework/ADU-TEST-rework-plan.json"],
            "commands_run": [],
            "risks": [],
            "next_agent": "developer"
        }
    }
    tmp = completion_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(envelope), encoding="utf-8")
    tmp.replace(completion_file)
    time.sleep(100)
    sys.exit(0)

elif scenario == "completion_success_without_inner_result":
    completion_file = pathlib.Path(sys.argv[3])
    output_file.write_text("review artifact", encoding="utf-8")
    envelope = {
        "version": 1,
        "status": "success",
        "result": {
            "review_status": "fail",
            "next_state": "code_rework",
            "changed_files": [str(output_file)],
            "artifacts": [str(output_file)],
            "commands_run": ["npm run build --prefix webui"],
            "risks": ["Code review failed and developer must rework."],
            "next_agent": "developer"
        }
    }
    tmp = completion_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(envelope), encoding="utf-8")
    tmp.replace(completion_file)
    time.sleep(100)
    sys.exit(0)

elif scenario == "completion_success_without_audit_arrays":
    completion_file = pathlib.Path(sys.argv[3])
    output_file.write_text("rework plan", encoding="utf-8")
    envelope = {
        "version": 1,
        "status": "success",
        "result": {
            "result": "success",
            "next_state": "rework_planned",
            "changed_files": [str(output_file)],
            "artifacts": [str(output_file)],
            "return_to": "developer",
            "next_agent": "developer"
        }
    }
    tmp = completion_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(envelope), encoding="utf-8")
    tmp.replace(completion_file)
    time.sleep(100)
    sys.exit(0)

elif scenario == "write_to_target_then_stall":
    time.sleep(0.5)
    output_file.write_text("some changes", encoding="utf-8")
    time.sleep(100)
    sys.exit(0)
"""
    mock_hermes_path.write_text(mock_hermes_code, encoding="utf-8")

    try:
        # Define some testing policies
        policy = AgentRunPolicy(
            max_duration_seconds=3,
            no_progress_timeout_seconds=2,
            termination_grace_seconds=1,
            max_prompt_bytes=10000,
            max_estimated_input_tokens=1000
        )

        # Test Case 1: Immediately successful
        print("Testing Case 1: Immediate success...")
        target_file = workspace / "temp_outcome_1.json"
        if target_file.exists(): target_file.unlink()

        cmd = [sys.executable, str(mock_hermes_path), "success", str(target_file)]
        result = execute_controlled_process(cmd, workspace, None, policy, [str(target_file)])
        assert result.returncode == 0, f"Expected 0 exit, got {result.returncode}"
        assert target_file.exists(), "Target file was not created"
        target_file.unlink()

        # Test Case 2: Infinite output, no target file -> max_duration timeout
        # For this test, it will trigger sys.exit(1) inside execute_controlled_process
        # because of timeout. We must run it in a subprocess to check its exit status and stdout outcome.
        print("Testing Case 2: Max duration timeout...")
        target_file = workspace / "temp_outcome_2.json"
        if target_file.exists(): target_file.unlink()

        # We spawn a subprocess running execute_controlled_process via a wrapper
        wrapper_code = f"""import sys
import pathlib
sys.path.append("{str(scripts_dir)}")
from agent_run_policy import AgentRunPolicy, execute_controlled_process
policy = AgentRunPolicy(3, 10, 1, 10000, 1000)
cmd = [sys.executable, "{str(mock_hermes_path)}", "infinite_output", "{str(target_file)}"]
res = execute_controlled_process(cmd, pathlib.Path("{str(workspace)}"), None, policy, ["{str(target_file)}"])
sys.exit(res.returncode)
"""
        wrapper_path = workspace / "temp_wrapper.py"
        wrapper_path.write_text(wrapper_code, encoding="utf-8")

        p = subprocess.run([sys.executable, str(wrapper_path)], capture_output=True, text=True)
        assert p.returncode == 1, f"Expected timeout exit code 1, got {p.returncode}"
        assert "__AGENT_RUN_OUTCOME__" in p.stdout, "Missing structured output"
        outcome_line = [l for l in p.stdout.splitlines() if l.startswith("__AGENT_RUN_OUTCOME__:")][0]
        outcome = json.loads(outcome_line.replace("__AGENT_RUN_OUTCOME__:", ""))
        assert outcome["error_code"] == "AGENT_RUN_TIMEOUT", f"Expected AGENT_RUN_TIMEOUT, got {outcome['error_code']}"
        wrapper_path.unlink()
        if target_file.exists():
            target_file.unlink()

        # Test Case 3: Silent inference may exceed no-progress timeout, but
        # must be allowed to complete before the absolute duration limit.
        print("Testing Case 3: Silent inference completes...")
        wrapper_code = f"""import sys
import pathlib
sys.path.append("{str(scripts_dir)}")
from agent_run_policy import AgentRunPolicy, execute_controlled_process
policy = AgentRunPolicy(6, 1, 1, 10000, 1000)
cmd = [sys.executable, "{str(mock_hermes_path)}", "silent_success", "{str(target_file)}"]
res = execute_controlled_process(cmd, pathlib.Path("{str(workspace)}"), None, policy, ["{str(target_file)}"])
sys.exit(res.returncode)
"""
        wrapper_path = workspace / "temp_wrapper.py"
        wrapper_path.write_text(wrapper_code, encoding="utf-8")

        p = subprocess.run([sys.executable, str(wrapper_path)], capture_output=True, text=True)
        assert p.returncode == 0, (
            "Silent but healthy inference must not be killed by no-progress timeout. "
            f"stdout={p.stdout!r}, stderr={p.stderr!r}"
        )
        wrapper_path.unlink()

        # Test Case 4: Once observable progress starts, a subsequent stall
        # must still be terminated by the no-progress watchdog.
        print("Testing Case 4: Progress followed by stall...")
        target_file = workspace / "temp_outcome_4.json"
        if target_file.exists(): target_file.unlink()
        wrapper_code = f"""import sys
import pathlib
sys.path.append("{str(scripts_dir)}")
from agent_run_policy import AgentRunPolicy, execute_controlled_process
policy = AgentRunPolicy(10, 2, 1, 10000, 1000)
cmd = [sys.executable, "{str(mock_hermes_path)}", "progress_then_stall", "{str(target_file)}"]
res = execute_controlled_process(cmd, pathlib.Path("{str(workspace)}"), None, policy, ["{str(target_file)}"])
sys.exit(res.returncode)
"""
        wrapper_path = workspace / "temp_wrapper.py"
        wrapper_path.write_text(wrapper_code, encoding="utf-8")

        p = subprocess.run([sys.executable, str(wrapper_path)], capture_output=True, text=True)
        assert p.returncode == 1, f"Expected exit code 1, got {p.returncode}"
        assert "__AGENT_RUN_OUTCOME__" in p.stdout
        outcome_line = [l for l in p.stdout.splitlines() if l.startswith("__AGENT_RUN_OUTCOME__:")][0]
        outcome = json.loads(outcome_line.replace("__AGENT_RUN_OUTCOME__:", ""))
        assert outcome["error_code"] == "AGENT_NO_PROGRESS", f"Expected AGENT_NO_PROGRESS, got {outcome['error_code']}"
        wrapper_path.unlink()

        # Test Case 5: A target artifact alone is not proof that the Agent has
        # finished. The process may still be preparing its final JSON result.
        print("Testing Case 5: Artifact does not terminate a live Agent...")
        target_file = workspace / "temp_outcome_4.json"
        if target_file.exists(): target_file.unlink()

        wrapper_code = f"""import sys
import pathlib
sys.path.append("{str(scripts_dir)}")
from agent_run_policy import AgentRunPolicy, execute_controlled_process
policy = AgentRunPolicy(3, 10, 1, 10000, 1000)
cmd = [sys.executable, "{str(mock_hermes_path)}", "no_exit", "{str(target_file)}"]
res = execute_controlled_process(cmd, pathlib.Path("{str(workspace)}"), None, policy, ["{str(target_file)}"])
sys.exit(res.returncode)
"""
        wrapper_path = workspace / "temp_wrapper.py"
        wrapper_path.write_text(wrapper_code, encoding="utf-8")

        p = subprocess.run([sys.executable, str(wrapper_path)], capture_output=True, text=True)
        assert p.returncode == 1, (
            "A generated artifact must not make the watchdog report success "
            "while the Agent process is still running"
        )
        outcome_line = [l for l in p.stdout.splitlines() if l.startswith("__AGENT_RUN_OUTCOME__:")][0]
        outcome = json.loads(outcome_line.replace("__AGENT_RUN_OUTCOME__:", ""))
        assert outcome["error_code"] == "AGENT_RUN_TIMEOUT"
        wrapper_path.unlink()
        target_file.unlink()

        # Test Case 6: Explicit completion protocol success then hang -> early exit on completion_signal
        print("Testing Case 6: Explicit completion success then hang...")
        target_file = workspace / "temp_outcome_4.json"
        completion_file = workspace / "temp_completion.json"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        cmd = [sys.executable, str(mock_hermes_path), "completion_success_then_hang", str(target_file), str(completion_file)]
        t_start = time.time()
        result = execute_controlled_process(
            cmd,
            workspace,
            None,
            AgentRunPolicy(20, 10, 1, 10000, 1000),
            [str(target_file)],
            completion_file=str(completion_file)
        )
        t_elapsed = time.time() - t_start
        assert result.returncode == 0, f"Expected 0 exit on completion signal, got {result.returncode}"
        assert result.termination_reason == "completion_signal", f"Expected termination_reason completion_signal, got {result.termination_reason}"
        assert result.completion_result is not None
        assert result.completion_result["result"] == "success"
        assert t_elapsed < 5.0, f"Expected fast completion (under 5s), took {t_elapsed}s"
        # Assert child PID is dead and reaped
        pid_alive = True
        try:
            os.kill(result.pid, 0)
        except OSError:
            pid_alive = False
        assert not pid_alive, f"Expected child PID {result.pid} to be dead and reaped, but it is still alive!"
        target_file.unlink()
        completion_file.unlink()

        # Test Case 7: Invalid completion file -> fails/timeout, does not terminate early
        print("Testing Case 7: Invalid completion file...")
        target_file = workspace / "temp_outcome_4.json"
        completion_file = workspace / "temp_completion.json"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        cmd = [sys.executable, str(mock_hermes_path), "completion_invalid_version", str(target_file), str(completion_file)]
        wrapper_code = f"""import sys
import pathlib
sys.path.append("{str(scripts_dir)}")
from agent_run_policy import AgentRunPolicy, execute_controlled_process
policy = AgentRunPolicy(3, 10, 1, 10000, 1000)
cmd = [sys.executable, "{str(mock_hermes_path)}", "completion_invalid_version", "{str(target_file)}", "{str(completion_file)}"]
res = execute_controlled_process(cmd, pathlib.Path("{str(workspace)}"), None, policy, ["{str(target_file)}"], completion_file="{str(completion_file)}")
sys.exit(res.returncode)
"""
        wrapper_path = workspace / "temp_wrapper.py"
        wrapper_path.write_text(wrapper_code, encoding="utf-8")

        p = subprocess.run([sys.executable, str(wrapper_path)], capture_output=True, text=True)
        assert p.returncode == 1, f"Expected timeout exit code 1, got {p.returncode}"
        wrapper_path.unlink()
        if completion_file.exists(): completion_file.unlink()

        # Test Case 8: Completion missing fields -> fails/timeout, does not terminate early
        print("Testing Case 8: Completion missing fields...")
        target_file = workspace / "temp_outcome_4.json"
        completion_file = workspace / "temp_completion.json"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        cmd = [sys.executable, str(mock_hermes_path), "completion_missing_fields", str(target_file), str(completion_file)]
        wrapper_code = f"""import sys
import pathlib
sys.path.append("{str(scripts_dir)}")
from agent_run_policy import AgentRunPolicy, execute_controlled_process
policy = AgentRunPolicy(3, 10, 1, 10000, 1000)
cmd = [sys.executable, "{str(mock_hermes_path)}", "completion_missing_fields", "{str(target_file)}", "{str(completion_file)}"]
res = execute_controlled_process(cmd, pathlib.Path("{str(workspace)}"), None, policy, ["{str(target_file)}"], completion_file="{str(completion_file)}")
sys.exit(res.returncode)
"""
        wrapper_path = workspace / "temp_wrapper.py"
        wrapper_path.write_text(wrapper_code, encoding="utf-8")

        p = subprocess.run([sys.executable, str(wrapper_path)], capture_output=True, text=True)
        assert p.returncode == 1, f"Expected timeout exit code 1 due to missing fields, got {p.returncode}"
        wrapper_path.unlink()
        if completion_file.exists(): completion_file.unlink()

        # Test Case 9: Explicit completion human_gate then hang -> early exit on completion_signal (human_gate status)
        print("Testing Case 9: Explicit completion human_gate then hang...")
        target_file = workspace / "temp_outcome_4.json"
        completion_file = workspace / "temp_completion.json"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        cmd = [sys.executable, str(mock_hermes_path), "completion_human_gate_then_hang", str(target_file), str(completion_file)]
        t_start = time.time()
        result = execute_controlled_process(
            cmd,
            workspace,
            None,
            AgentRunPolicy(20, 10, 1, 10000, 1000),
            [str(target_file)],
            completion_file=str(completion_file)
        )
        t_elapsed = time.time() - t_start
        assert result.returncode == 0, f"Expected 0 exit on completion human_gate, got {result.returncode}"
        assert result.termination_reason == "completion_signal", f"Expected termination_reason completion_signal, got {result.termination_reason}"
        assert result.completion_result is not None
        assert result.completion_result["result"] == "human_gate"
        assert t_elapsed < 5.0, f"Expected fast completion (under 5s), took {t_elapsed}s"

        # Assert child PID is dead and reaped
        pid_alive = True
        try:
            os.kill(result.pid, 0)
        except OSError:
            pid_alive = False
        assert not pid_alive, f"Expected child PID {result.pid} to be dead and reaped, but it is still alive!"
        target_file.unlink()
        completion_file.unlink()

        # Test Case 10: Explicit completion envelope priority -> completion_status is valid, stdout business JSON ignored
        print("Testing Case 10: Explicit completion envelope priority...")
        target_file = workspace / "temp_outcome_4.json"
        completion_file = workspace / "temp_completion.json"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        cmd = [sys.executable, str(mock_hermes_path), "write_business_json_then_completion", str(target_file), str(completion_file)]
        t_start = time.time()
        result = execute_controlled_process(
            cmd,
            workspace,
            None,
            AgentRunPolicy(20, 10, 1, 10000, 1000),
            [str(target_file)],
            completion_file=str(completion_file)
        )
        t_elapsed = time.time() - t_start
        assert result.returncode == 0, f"Expected 0 exit on completion, got {result.returncode}"
        assert result.termination_reason == "completion_signal", f"Expected termination_reason completion_signal, got {result.termination_reason}"
        assert result.completion_status == "valid", f"Expected completion_status valid, got {result.completion_status}"
        assert result.completion_result is not None
        assert result.completion_result["next_state"] == "rework_planned"
        assert t_elapsed < 5.0, f"Expected fast completion (under 5s), took {t_elapsed}s"

        # Assert child PID is dead and reaped
        pid_alive = True
        try:
            os.kill(result.pid, 0)
        except OSError:
            pid_alive = False
        assert not pid_alive, f"Expected child PID {result.pid} to be dead and reaped, but it is still alive!"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        # Test Case 11: Completion status is authoritative when inner result.result is omitted
        print("Testing Case 11: Completion success without inner result field...")
        target_file = workspace / "temp_outcome_4.json"
        completion_file = workspace / "temp_completion.json"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        cmd = [sys.executable, str(mock_hermes_path), "completion_success_without_inner_result", str(target_file), str(completion_file)]
        result = execute_controlled_process(
            cmd,
            workspace,
            None,
            AgentRunPolicy(20, 10, 1, 10000, 1000),
            [str(target_file)],
            completion_file=str(completion_file)
        )
        assert result.returncode == 0, f"Expected 0 exit on completion, got {result.returncode}"
        assert result.completion_status == "valid", f"Expected completion_status valid, got {result.completion_status}"
        assert result.completion_result is not None
        assert result.completion_result["result"] == "success"
        assert result.completion_result["review_status"] == "fail"
        assert result.completion_result["next_state"] == "code_rework"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        # Test Case 12: Completion may omit audit arrays when no commands/risks were produced
        print("Testing Case 12: Completion success without audit arrays...")
        target_file = workspace / "temp_outcome_4.json"
        completion_file = workspace / "temp_completion.json"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        cmd = [sys.executable, str(mock_hermes_path), "completion_success_without_audit_arrays", str(target_file), str(completion_file)]
        result = execute_controlled_process(
            cmd,
            workspace,
            None,
            AgentRunPolicy(20, 10, 1, 10000, 1000),
            [str(target_file)],
            completion_file=str(completion_file)
        )
        assert result.returncode == 0, f"Expected 0 exit on completion, got {result.returncode}"
        assert result.completion_status == "valid", f"Expected completion_status valid, got {result.completion_status}"
        assert result.completion_result is not None
        assert result.completion_result["commands_run"] == []
        assert result.completion_result["risks"] == []
        assert result.completion_result["next_state"] == "rework_planned"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        # Test Case 13: target_files_changed check
        print("Testing Case 13: target_files_changed detection...")
        target_file = workspace / "temp_outcome_4.json"
        completion_file = workspace / "temp_completion.json"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        cmd = [sys.executable, str(mock_hermes_path), "write_to_target_then_stall", str(target_file), str(completion_file)]
        result = execute_controlled_process(
            cmd,
            workspace,
            None,
            AgentRunPolicy(20, 2, 1, 10000, 1000),
            [str(target_file)],
            completion_file=str(completion_file)
        )
        assert result.termination_reason == "no_progress_timeout", f"Expected no_progress_timeout, got {result.termination_reason}"
        assert result.target_files_changed is True, "Expected target_files_changed to be True"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        # Test Case 14: target_files_changed is False when unchanged
        print("Testing Case 14: target_files_changed is False when unchanged...")
        target_file = workspace / "temp_outcome_4.json"
        completion_file = workspace / "temp_completion.json"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        cmd = [sys.executable, str(mock_hermes_path), "silent", str(target_file), str(completion_file)]
        result = execute_controlled_process(
            cmd,
            workspace,
            None,
            AgentRunPolicy(20, 2, 1, 10000, 1000),
            [str(target_file)],
            completion_file=str(completion_file)
        )
        assert result.termination_reason == "no_progress_timeout", f"Expected no_progress_timeout, got {result.termination_reason}"
        assert result.target_files_changed is False, "Expected target_files_changed to be False"
        if target_file.exists(): target_file.unlink()
        if completion_file.exists(): completion_file.unlink()

        print("✅ All Agent Run Policy Watchdog Tests Passed!")
    finally:
        for temp_path in (
            workspace / "temp_outcome_1.json",
            workspace / "temp_outcome_2.json",
            workspace / "temp_outcome_4.json",
            workspace / "temp_wrapper.py",
            workspace / "temp_completion.json",
        ):
            if temp_path.exists():
                temp_path.unlink()
        if mock_hermes_path.exists():
            mock_hermes_path.unlink()

if __name__ == "__main__":
    try:
        run_tests()
    except Exception as e:
        print(f"Test failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

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

elif scenario == "no_exit":
    # Write outcome and then hang
    output_file.write_text(json.dumps({"result": "success", "status": "completed"}), encoding="utf-8")
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
execute_controlled_process(cmd, pathlib.Path("{str(workspace)}"), None, policy, ["{str(target_file)}"])
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

        # Test Case 3: Silent -> no progress timeout
        print("Testing Case 3: No progress timeout...")
        wrapper_code = f"""import sys
import pathlib
sys.path.append("{str(scripts_dir)}")
from agent_run_policy import AgentRunPolicy, execute_controlled_process
policy = AgentRunPolicy(10, 2, 1, 10000, 1000)
cmd = [sys.executable, "{str(mock_hermes_path)}", "silent", "{str(target_file)}"]
execute_controlled_process(cmd, pathlib.Path("{str(workspace)}"), None, policy, ["{str(target_file)}"])
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

        # Test Case 4: Output generated but process doesn't exit -> early convergence
        print("Testing Case 4: Early convergence...")
        target_file = workspace / "temp_outcome_4.json"
        if target_file.exists(): target_file.unlink()

        cmd = [sys.executable, str(mock_hermes_path), "no_exit", str(target_file)]
        t_start = time.time()
        result = execute_controlled_process(cmd, workspace, None, policy, [str(target_file)])
        t_elapsed = time.time() - t_start
        assert result.returncode == 0, f"Expected 0 exit code on early convergence, got {result.returncode}"
        assert t_elapsed < 4.0, f"Expected early exit (under 4s), took {t_elapsed}s"
        assert target_file.exists()
        target_file.unlink()

        print("✅ All Agent Run Policy Watchdog Tests Passed!")
    finally:
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

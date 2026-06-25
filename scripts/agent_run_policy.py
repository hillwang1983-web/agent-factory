import json
import pathlib
import subprocess
import threading
from dataclasses import dataclass

@dataclass(frozen=True)
class AgentRunPolicy:
    max_duration_seconds: int
    no_progress_timeout_seconds: int
    termination_grace_seconds: int
    max_prompt_bytes: int
    max_estimated_input_tokens: int

def load_policy(agent_name: str, workspace_root: pathlib.Path) -> AgentRunPolicy:
    policy_path = workspace_root / ".ai-agent" / "policies" / "agent-run-policy.json"
    
    # defaults definition
    d_max_duration = 600
    d_no_progress = 180
    d_grace = 5
    d_prompt_bytes = 120000
    d_tokens = 30000

    if policy_path.exists():
        try:
            with open(policy_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            defaults = data.get("defaults", {})
            agent_override = data.get("agents", {}).get(agent_name, {})
            
            # Validation
            for k, v in defaults.items():
                if isinstance(v, (int, float)) and v <= 0:
                    raise ValueError(f"Policy default value for {k} must be positive: {v}")
            for a_name, a_override in data.get("agents", {}).items():
                for k, v in a_override.items():
                    if isinstance(v, (int, float)) and v <= 0:
                        raise ValueError(f"Policy override for agent {a_name} key {k} must be positive: {v}")

            return AgentRunPolicy(
                max_duration_seconds=int(agent_override.get("max_duration_seconds", defaults.get("max_duration_seconds", d_max_duration))),
                no_progress_timeout_seconds=int(agent_override.get("no_progress_timeout_seconds", defaults.get("no_progress_timeout_seconds", d_no_progress))),
                termination_grace_seconds=int(agent_override.get("termination_grace_seconds", defaults.get("termination_grace_seconds", d_grace))),
                max_prompt_bytes=int(agent_override.get("max_prompt_bytes", defaults.get("max_prompt_bytes", d_prompt_bytes))),
                max_estimated_input_tokens=int(agent_override.get("max_estimated_input_tokens", defaults.get("max_estimated_input_tokens", d_tokens)))
            )
        except Exception as exc:
            # Propagate validation error, otherwise fallback
            if isinstance(exc, ValueError):
                raise exc
    
    return AgentRunPolicy(d_max_duration, d_no_progress, d_grace, d_prompt_bytes, d_tokens)

def read_completion_result(completion_path):
    if completion_path is None or not completion_path.is_file():
        return None

    try:
        payload = json.loads(completion_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    if payload.get("version") != 1:
        return None
    if payload.get("status") not in ("success", "failed", "human_gate"):
        return None

    result = payload.get("result")
    if not isinstance(result, dict):
        return None

    if payload["status"] == "success":
        if result.get("result") != "success":
            return None
        # Enforce all required fields for success
        if "next_state" not in result or not (result["next_state"] is None or isinstance(result["next_state"], str)):
            return None
        if "changed_files" not in result or not isinstance(result["changed_files"], list) or not all(isinstance(x, str) for x in result["changed_files"]):
            return None
        if "artifacts" not in result or not isinstance(result["artifacts"], list) or not all(isinstance(x, str) for x in result["artifacts"]):
            return None
        if "commands_run" not in result or not isinstance(result["commands_run"], list) or not all(isinstance(x, str) for x in result["commands_run"]):
            return None
        if "risks" not in result or not isinstance(result["risks"], list) or not all(isinstance(x, (str, dict)) for x in result["risks"]):
            return None
        if "next_agent" not in result or not (result["next_agent"] is None or isinstance(result["next_agent"], str)):
            return None
    elif payload["status"] == "human_gate":
        if result.get("result") != "human_gate":
            return None
        # Enforce same fields for human_gate (consistent schema)
        if "next_state" not in result or not (result["next_state"] is None or isinstance(result["next_state"], str)):
            return None
        if "changed_files" not in result or not isinstance(result["changed_files"], list) or not all(isinstance(x, str) for x in result["changed_files"]):
            return None
        if "artifacts" not in result or not isinstance(result["artifacts"], list) or not all(isinstance(x, str) for x in result["artifacts"]):
            return None
        if "commands_run" not in result or not isinstance(result["commands_run"], list) or not all(isinstance(x, str) for x in result["commands_run"]):
            return None
        if "risks" not in result or not isinstance(result["risks"], list) or not all(isinstance(x, (str, dict)) for x in result["risks"]):
            return None
        if "next_agent" not in result or not (result["next_agent"] is None or isinstance(result["next_agent"], str)):
            return None
    else:
        # failed
        if result.get("result") in ("success", "human_gate"):
            return None

    return result

def execute_controlled_process(cmd, cwd_path, env, policy, target_files=None, completion_file=None):
    """
    Run subprocess.Popen with active watchdog enforcing max duration and no progress.
    """
    import time
    import signal
    import sys
    import os
    import pathlib
    import fcntl

    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd_path),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
        env=env
    )

    # Track target files mtime
    target_paths = []
    if target_files:
        for f in target_files:
            target_paths.append(pathlib.Path(f))
    
    def get_max_mtime():
        mtimes = []
        for p in target_paths:
            if p.exists():
                try:
                    mtimes.append(p.stat().st_mtime)
                except Exception:
                    pass
        return max(mtimes) if mtimes else 0

    completion_path = pathlib.Path(completion_file) if completion_file else None
    completion_result = None

    start_time = time.time()
    last_progress_time = start_time
    last_mtime = get_max_mtime()
    progress_observed = False
    
    stdout_buf = []
    stderr_buf = []

    def read_stream(stream_buffer, buf):
        import codecs
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        try:
            while True:
                chunk_bytes = stream_buffer.read1(4096)
                if not chunk_bytes:
                    break
                chunk_text = decoder.decode(chunk_bytes)
                if chunk_text:
                    buf.append(chunk_text)
            # Flush final decoder state
            final_text = decoder.decode(b"", final=True)
            if final_text:
                buf.append(final_text)
        except Exception as e:
            import sys
            print(f"Exception in read_stream: {e}", file=sys.stderr)

    t_out = threading.Thread(target=read_stream, args=(proc.stdout.buffer, stdout_buf), daemon=True)
    t_err = threading.Thread(target=read_stream, args=(proc.stderr.buffer, stderr_buf), daemon=True)
    t_out.start()
    t_err.start()

    termination_reason = None
    exit_code = None

    last_stdout_len = 0
    last_stderr_len = 0

    while True:
        now = time.time()
        elapsed = now - start_time
        
        # Check completion file first
        completion_result = read_completion_result(completion_path)
        if completion_result is not None:
            termination_reason = "completion_signal"
            exit_code = 0 if completion_result.get("result") in ("success", "human_gate") else 1
            break

        # 1. Check max duration
        if elapsed > policy.max_duration_seconds:
            termination_reason = "max_duration_exceeded"
            break

        # 2. Check process state
        ret = proc.poll()
        if ret is not None:
            exit_code = ret
            break

        # 3. Read output
        has_new_output = False
        
        current_stdout_buf = list(stdout_buf)
        current_stderr_buf = list(stderr_buf)
        current_stdout_len = sum(len(x) for x in current_stdout_buf)
        current_stderr_len = sum(len(x) for x in current_stderr_buf)

        if current_stdout_len > last_stdout_len:
            new_data = "".join(current_stdout_buf)[last_stdout_len:]
            lines = new_data.splitlines()
            has_substantive = False
            for line in lines:
                stripped = line.strip()
                if not stripped:
                    continue
                if "HTTP/1.1 200" in stripped or "completions" in stripped or "POST /chat" in stripped:
                    continue
                has_substantive = True
            if has_substantive:
                has_new_output = True
            last_stdout_len = current_stdout_len

        if current_stderr_len > last_stderr_len:
            new_data = "".join(current_stderr_buf)[last_stderr_len:]
            lines = new_data.splitlines()
            has_substantive = False
            for line in lines:
                stripped = line.strip()
                if not stripped:
                    continue
                if "HTTP/1.1 200" in stripped or "completions" in stripped or "POST /chat" in stripped:
                    continue
                has_substantive = True
            if has_substantive:
                has_new_output = True
            last_stderr_len = current_stderr_len

        # 4. Check target file mtime changes
        current_mtime = get_max_mtime()
        if current_mtime > last_mtime:
            has_new_output = True
            last_mtime = current_mtime

        if has_new_output:
            last_progress_time = now
            progress_observed = True

        # 5. Check no progress timeout
        if progress_observed and (now - last_progress_time) > policy.no_progress_timeout_seconds:
            termination_reason = "no_progress_timeout"
            break

        time.sleep(0.5)

    if termination_reason:
        try:
            pgid = os.getpgid(proc.pid)
            if termination_reason != "completion_signal":
                print(f"Watchdog triggered: {termination_reason}. Killing process group {pgid}", file=sys.stderr)
                os.killpg(pgid, signal.SIGTERM)
                
                # Wait grace period
                wait_start = time.time()
                killed = False
                while time.time() - wait_start < policy.termination_grace_seconds:
                    if proc.poll() is not None:
                        killed = True
                        break
                    time.sleep(0.2)
                
                if not killed:
                    try:
                        os.killpg(pgid, signal.SIGKILL)
                    except Exception:
                        pass
                    try:
                        proc.wait(timeout=2.0)
                    except Exception:
                        pass
                else:
                    try:
                        proc.wait(timeout=1.0)
                    except Exception:
                        pass
            else:
                # For completion_signal, wait for natural exit
                try:
                    proc.poll()
                    proc.wait(timeout=3.0)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(pgid, signal.SIGTERM)
                    except Exception:
                        pass
                    try:
                        proc.wait(timeout=2.0)
                    except Exception:
                        pass
        except Exception:
            pass
        
        if termination_reason != "completion_signal":
            err_code = "AGENT_RUN_TIMEOUT" if termination_reason == "max_duration_exceeded" else "AGENT_NO_PROGRESS"
            
            result_json = {
                "result": "failed",
                "error_code": err_code,
                "termination_reason": termination_reason,
                "next_state": None
            }
            print(f"__AGENT_RUN_OUTCOME__:{json.dumps(result_json)}")
            exit_code = 1

    # Wait for the reader threads to finish reading remaining output
    t_out.join(timeout=2.0)
    t_err.join(timeout=2.0)

    final_stdout = "".join(stdout_buf)
    final_stderr = "".join(stderr_buf)

    # final check of completion file if not already set
    if completion_result is None and completion_path is not None:
        completion_result = read_completion_result(completion_path)

    if completion_path is None:
        completion_status = "not_expected"
    elif completion_result is not None:
        completion_status = "valid"
    elif completion_path.exists():
        completion_status = "invalid"
    else:
        completion_status = "missing"

    class ControlledProcessResult:
        def __init__(self, stdout, stderr, returncode, completion_result=None, completion_status="not_expected", termination_reason=None, pid=None):
            self.stdout = stdout
            self.stderr = stderr
            self.returncode = returncode
            self.completion_result = completion_result
            self.completion_status = completion_status
            self.termination_reason = termination_reason
            self.pid = pid
    
    return ControlledProcessResult(final_stdout, final_stderr, exit_code, completion_result, completion_status, termination_reason, proc.pid)

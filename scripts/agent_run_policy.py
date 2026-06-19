import json
import pathlib
import subprocess
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

def execute_controlled_process(cmd, cwd_path, env, policy, target_files=None):
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

    start_time = time.time()
    last_progress_time = start_time
    last_mtime = get_max_mtime()
    
    stdout_buf = []
    stderr_buf = []

    # Make stdout/stderr non-blocking
    for stream in (proc.stdout, proc.stderr):
        if stream:
            fd = stream.fileno()
            fl = fcntl.fcntl(fd, fcntl.F_GETFL)
            fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

    termination_reason = None
    exit_code = None

    while True:
        now = time.time()
        elapsed = now - start_time
        
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
        
        try:
            out = proc.stdout.read()
            if out:
                stdout_buf.append(out)
                lines = out.splitlines()
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
        except Exception:
            pass

        try:
            err = proc.stderr.read()
            if err:
                stderr_buf.append(err)
                lines = err.splitlines()
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
        except Exception:
            pass

        # 4. Check target file mtime changes
        current_mtime = get_max_mtime()
        if current_mtime > last_mtime:
            has_new_output = True
            last_mtime = current_mtime

        if has_new_output:
            last_progress_time = now

        # 5. Check no progress timeout
        if (now - last_progress_time) > policy.no_progress_timeout_seconds:
            termination_reason = "no_progress_timeout"
            break

        # 6. Early convergence: if target files are generated, exit early
        if target_paths and all(p.exists() and p.stat().st_size > 0 for p in target_paths):
            time.sleep(1.5)
            try:
                out = proc.stdout.read()
                if out: stdout_buf.append(out)
            except Exception: pass
            try:
                err = proc.stderr.read()
                if err: stderr_buf.append(err)
            except Exception: pass
            
            try:
                pgid = os.getpgid(proc.pid)
                os.killpg(pgid, signal.SIGTERM)
            except Exception:
                pass
            exit_code = 0
            break

        time.sleep(0.5)

    if termination_reason:
        try:
            pgid = os.getpgid(proc.pid)
            print(f"Watchdog triggered: {termination_reason}. Killing process group {pgid}", file=sys.stderr)
            os.killpg(pgid, signal.SIGTERM)
        except Exception:
            pass
        
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
                pgid = os.getpgid(proc.pid)
                os.killpg(pgid, signal.SIGKILL)
            except Exception:
                pass
        
        err_code = "AGENT_RUN_TIMEOUT" if termination_reason == "max_duration_exceeded" else "AGENT_NO_PROGRESS"
        
        result_json = {
            "result": "failed",
            "error_code": err_code,
            "termination_reason": termination_reason,
            "next_state": None
        }
        print(f"__AGENT_RUN_OUTCOME__:{json.dumps(result_json)}")
        sys.exit(1)

    # Read remaining output
    try:
        out = proc.stdout.read()
        if out: stdout_buf.append(out)
    except Exception: pass
    try:
        err = proc.stderr.read()
        if err: stderr_buf.append(err)
    except Exception: pass

    final_stdout = "".join(stdout_buf)
    final_stderr = "".join(stderr_buf)

    class ControlledProcessResult:
        def __init__(self, stdout, stderr, returncode):
            self.stdout = stdout
            self.stderr = stderr
            self.returncode = returncode
    
    return ControlledProcessResult(final_stdout, final_stderr, exit_code)


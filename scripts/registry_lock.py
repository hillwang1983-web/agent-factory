import os
import time
import json
import uuid
import pathlib
from contextlib import contextmanager

def is_pid_alive(pid):
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError as err:
        import errno
        return err.errno != errno.ESRCH

@contextmanager
def registry_lock(registry_dir):
    lock_path = pathlib.Path(registry_dir) / "registry.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    owner = str(uuid.uuid4())
    start = time.time()
    timeout = 15.0  # 15 seconds timeout
    acquired = False

    while True:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, 'w') as f:
                json.dump({
                    "pid": os.getpid(),
                    "owner": owner,
                    "heartbeat": int(time.time() * 1000)
                }, f)
            acquired = True
            break
        except FileExistsError:
            try:
                with open(str(lock_path), 'r', encoding='utf-8') as f:
                    data = json.load(f)
                pid = data.get("pid", 0)
                heartbeat = data.get("heartbeat", 0)

                pid_alive = is_pid_alive(pid)

                if not pid_alive:
                    try:
                        os.unlink(str(lock_path))
                    except OSError:
                        pass
                    continue
            except Exception:
                try:
                    mtime = os.path.getmtime(str(lock_path))
                    if time.time() - mtime > 30:
                        os.unlink(str(lock_path))
                except OSError:
                    pass
                continue

            if time.time() - start > timeout:
                raise TimeoutError("Registry lock acquisition timed out")
            time.sleep(0.01)

    try:
        yield
    finally:
        if acquired:
            try:
                with open(str(lock_path), 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if data.get("owner") == owner:
                    os.unlink(str(lock_path))
            except Exception:
                pass

def save_json_direct(path, data):
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(p)

def save_json(path, data):
    p = pathlib.Path(path)
    with registry_lock(p.parent):
        save_json_direct(p, data)

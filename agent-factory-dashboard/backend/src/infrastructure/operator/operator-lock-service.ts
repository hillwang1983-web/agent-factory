import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true; // No error = alive
  } catch (err: any) {
    // EPERM = process exists but owned by different user = still alive
    // ESRCH = no such process = dead
    // All other errors (e.g. EINVAL) = treat as dead
    if (err && typeof err === 'object' && 'code' in err) {
      if (err.code === 'EPERM') return true;
    }
    return false;
  }
}

export interface LockOwner {
  pid: number;
  owner_token: string;
  heartbeat_at: string;
  acquired_at: string;
}

export class OperatorLockService {
  private static activeLocks = new Set<string>();
  private readonly ownerToken: string;

  constructor(private readonly workspaceRoot: string) {
    this.ownerToken = randomUUID();
  }

  getOwnerToken(): string {
    return this.ownerToken;
  }

  acquireLock(targetId: string, projectId: string = 'default-open5gs', writeFsLock: boolean = true): boolean {
    // Check in-memory locks first
    if (OperatorLockService.activeLocks.has(targetId)) {
      return false;
    }

    // Check file-system locks
    const lockDir = path.join(this.workspaceRoot, '.ai-agent', 'locks');
    const lockPath = path.join(lockDir, `${projectId}__${targetId}.lock`);
    if (fs.existsSync(lockPath)) {
      try {
        const lockContent = fs.readFileSync(lockPath, 'utf-8');
        const lockData = JSON.parse(lockContent);
        const pid = lockData.pid;
        const heartbeat = lockData.heartbeat_at;
        if (pid) {
          const pidDead = !isPidAlive(pid);
          // PID alive → ALWAYS refuse to acquire, regardless of heartbeat freshness.
          // A live process that hasn't updated its heartbeat is still running.
          // Only reclaim locks from dead PIDs.
          if (!pidDead) {
            return false;
          }
          // PID dead → lock can be reclaimed safely
        }
      } catch {
        // Corrupted lock, proceed
      }
    }

    // Acquire lock
    OperatorLockService.activeLocks.add(targetId);
    if (writeFsLock) {
      try {
        fs.mkdirSync(lockDir, { recursive: true });
        fs.writeFileSync(lockPath, JSON.stringify({
          pid: process.pid,
          owner_token: this.ownerToken,
          acquired_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString()
        }, null, 2), 'utf-8');
      } catch {
        // If write fails, still allow in-memory lock
      }
    }

    return true;
  }

  releaseLock(targetId: string, projectId: string = 'default-open5gs', deleteFile: boolean = true): void {
    OperatorLockService.activeLocks.delete(targetId);
    if (deleteFile) {
      const lockPath = path.join(this.workspaceRoot, '.ai-agent', 'locks', `${projectId}__${targetId}.lock`);
      if (fs.existsSync(lockPath)) {
        try {
          const lockContent = fs.readFileSync(lockPath, 'utf-8');
          const lockData = JSON.parse(lockContent);
          // Only delete if we own the lock (or lock has no owner_token — legacy)
          if (!lockData.owner_token || lockData.owner_token === this.ownerToken) {
            fs.unlinkSync(lockPath);
          }
        } catch {
          // Can't read/deleted already
        }
      }
    }
  }

  isLocked(targetId: string, projectId: string = 'default-open5gs'): boolean {
    if (OperatorLockService.activeLocks.has(targetId)) {
      return true;
    }
    const lockPath = path.join(this.workspaceRoot, '.ai-agent', 'locks', `${projectId}__${targetId}.lock`);
    if (fs.existsSync(lockPath)) {
      try {
        const lockContent = fs.readFileSync(lockPath, 'utf-8');
        const lockData = JSON.parse(lockContent);
        const pid = lockData.pid;
        if (pid && isPidAlive(pid)) {
          return true;
        }
      } catch {}
    }
    return false;
  }
}

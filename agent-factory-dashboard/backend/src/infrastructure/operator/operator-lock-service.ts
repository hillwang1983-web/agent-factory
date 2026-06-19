import * as fs from 'fs';
import * as path from 'path';

export class OperatorLockService {
  private static activeLocks = new Set<string>();

  constructor(private readonly workspaceRoot: string) {}

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
        const heartbeat = lockData.heartbeat_at;
        if (heartbeat) {
          const hbTime = new Date(heartbeat).getTime();
          const now = Date.now();
          // Lock is valid if younger than 30 minutes
          if (now - hbTime < 1800 * 1000) {
            return false;
          }
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
          fs.unlinkSync(lockPath);
        } catch {}
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
        const heartbeat = lockData.heartbeat_at;
        if (heartbeat) {
          const hbTime = new Date(heartbeat).getTime();
          const now = Date.now();
          return now - hbTime < 1800 * 1000;
        }
      } catch {}
    }
    return false;
  }
}

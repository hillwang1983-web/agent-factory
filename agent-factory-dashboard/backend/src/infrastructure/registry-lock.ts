import { AsyncLocalStorage } from 'async_hooks';
import * as fs from 'fs/promises';
import * as path from 'path';

export class RegistryLock {
  private static asyncLocalStorage = new AsyncLocalStorage<string>();
  private static lockOwner: string | null = null;
  private static mutex: Promise<any> = Promise.resolve();
  private static workspaceRoot: string = '';

  static timeoutMs = 15000;
  static staleMs = 30000;

  static setWorkspaceRoot(root: string) {
    RegistryLock.workspaceRoot = path.resolve(root);
  }

  private static getLockFilePath(): string {
    const root = RegistryLock.workspaceRoot || process.cwd();
    return path.join(root, '.ai-agent', 'registry', 'registry.lock');
  }

  private static isPidAlive(pid: number): boolean {
    if (pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      return err.code !== 'ESRCH';
    }
  }

  static async runLocked<T>(fn: () => Promise<T> | T): Promise<T> {
    const currentOwner = RegistryLock.asyncLocalStorage.getStore();

    // Re-entrancy check: if the lock is already held by this async execution path
    if (currentOwner && RegistryLock.lockOwner === currentOwner) {
      return await fn();
    }

    const newOwner = Math.random().toString(36).substring(2, 11) + '-' + Date.now();

    return new Promise<T>((resolve, reject) => {
      RegistryLock.mutex = RegistryLock.mutex.then(async () => {
        let acquired = false;
        try {
          await RegistryLock.acquireFileLock(newOwner);
          acquired = true;
          RegistryLock.lockOwner = newOwner;

          const result = await RegistryLock.asyncLocalStorage.run(newOwner, async () => {
            return await fn();
          });
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          RegistryLock.lockOwner = null;
          if (acquired) {
            await RegistryLock.releaseFileLock(newOwner);
          }
        }
      });
    });
  }

  private static async acquireFileLock(ownerToken: string): Promise<void> {
    const lockFile = RegistryLock.getLockFilePath();
    const lockDir = path.dirname(lockFile);
    await fs.mkdir(lockDir, { recursive: true });

    const start = Date.now();
    while (true) {
      try {
        const handle = await fs.open(lockFile, 'wx');
        const lockData = JSON.stringify({
          pid: process.pid,
          owner: ownerToken,
          heartbeat: Date.now()
        });
        await handle.write(lockData);
        await handle.close();
        return;
      } catch (err: any) {
        if (err.code !== 'EEXIST') {
          throw err;
        }
        try {
          const content = await fs.readFile(lockFile, 'utf8');
          const data = JSON.parse(content);
          const pid = Number(data.pid);
          const heartbeat = Number(data.heartbeat);

          const pidAlive = RegistryLock.isPidAlive(pid);

          if (!pidAlive) {
            try {
              await fs.unlink(lockFile);
            } catch {}
            continue;
          }
        } catch {
          try {
            const stats = await fs.stat(lockFile);
            const age = Date.now() - stats.mtimeMs;
            if (age > RegistryLock.staleMs) {
              try {
                await fs.unlink(lockFile);
              } catch {}
            }
          } catch {}
          continue;
        }

        if (Date.now() - start > RegistryLock.timeoutMs) {
          throw new Error('Registry lock acquisition timed out');
        }
        await new Promise(r => setTimeout(r, 10));
      }
    }
  }

  private static async releaseFileLock(ownerToken: string): Promise<void> {
    const lockFile = RegistryLock.getLockFilePath();
    try {
      const content = await fs.readFile(lockFile, 'utf8');
      const data = JSON.parse(content);
      if (data && data.owner === ownerToken) {
        await fs.unlink(lockFile);
      }
    } catch {}
  }
}

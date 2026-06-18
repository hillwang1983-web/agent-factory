import fs from 'fs';
import os from 'os';
import path from 'path';

export function findWorkspaceRoot(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    if (
      fs.existsSync(path.join(current, '.git')) ||
      fs.existsSync(path.join(current, '.ai-agent')) ||
      fs.existsSync(path.join(current, 'agent-factory-dashboard'))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

export function resolveWorkspaceRoot(envValue: string | undefined, startDir: string): string {
  if (envValue && envValue.trim()) {
    return path.resolve(envValue.trim());
  }
  return findWorkspaceRoot(startDir);
}

export function resolveHermesConfigPath(envValue: string | undefined): string {
  if (envValue && envValue.trim()) {
    return path.resolve(envValue.trim());
  }
  return path.join(os.homedir(), '.hermes', 'config.yaml');
}

export function parseAllowedProjectRoots(envValue: string | undefined, workspaceRoot: string): string[] {
  const roots = [workspaceRoot];
  if (envValue && envValue.trim()) {
    for (const item of envValue.split(',')) {
      const trimmed = item.trim();
      if (trimmed) {
        roots.push(path.resolve(trimmed));
      }
    }
  }
  return Array.from(new Set(roots.map((root) => path.resolve(root))));
}

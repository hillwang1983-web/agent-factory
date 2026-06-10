import fs from 'fs/promises';
import path from 'path';
import pino from 'pino';
import { AgentFactoryRepository } from '../domain/agent-factory-repository';
import {
  AgentFactoryAdu,
  AgentFactoryAgentConfig,
  AgentFactoryArtifact,
  AgentFactoryRun,
  AgentFactoryReview,
  AgentFactoryArtifactEdit,
} from '../domain/agent-factory';

export class FileAgentFactoryRepository implements AgentFactoryRepository {
  private readonly workspaceRoot: string;
  private readonly maxBytes: number;
  private readonly logger: pino.Logger;

  constructor(workspaceRoot: string, maxBytes: number, logger: pino.Logger) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.maxBytes = maxBytes;
    this.logger = logger.child({ component: 'FileAgentFactoryRepository' });
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  private resolveSafePath(relativePath: string, workspaceRootOverride?: string): string {
    const root = workspaceRootOverride ? path.resolve(workspaceRootOverride) : this.workspaceRoot;
    const resolved = path.resolve(root, relativePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`Artifact path escapes workspace root: ${relativePath}`);
    }

    // For project artifacts, strictly check allowed prefixes
    if (workspaceRootOverride) {
      const isAllowed = [
        '.agent-factory/project-profile.json',
        '.agent-factory/knowledge/',
        '.ai-agent/context-packs/',
        '.ai-agent/analysis/',
        '.ai-agent/designs/',
        '.ai-agent/contracts/',
        '.ai-agent/runs/',
        '.ai-agent/reviews/',
        '.ai-agent/acceptance/',
        '.ai-agent/evidence/',
        '.ai-agent/intake/',
        'tests/ai-agent-mvp/'
      ].some(prefix => relativePath.replace(/\\/g, '/').startsWith(prefix));
      
      if (!isAllowed) {
         throw new Error(`Project artifact path is not within an allowed project directory: ${relativePath}`);
      }
    }

    return resolved;
  }

  async readAdus(): Promise<AgentFactoryAdu[]> {
    const aduJsonPath = this.resolveSafePath('.ai-agent/registry/adu.json');
    try {
      const data = await fs.readFile(aduJsonPath, 'utf-8');
      const parsed = JSON.parse(data) as { adus?: AgentFactoryAdu[] };
      const adus = parsed.adus || [];
      
      for (const adu of adus) {
        if (!adu.project_id) {
          adu.project_id = 'default-open5gs';
        }
      }

      return adus;
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        this.logger.warn('adu.json registry not found, returning empty list');
        return [];
      }
      this.logger.error({ err }, 'Failed to read adu.json');
      throw err;
    }
  }

  async writeAdus(adus: AgentFactoryAdu[]): Promise<void> {
    const aduJsonPath = this.resolveSafePath('.ai-agent/registry/adu.json');
    try {
      const data = {
        version: 1,
        adus,
      };
      await fs.writeFile(aduJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    } catch (err) {
      this.logger.error({ err }, 'Failed to write adu.json');
      throw err;
    }
  }

  async listAdus(): Promise<AgentFactoryAdu[]> {
    return this.readAdus();
  }

  async listAdusByProject(projectId: string): Promise<AgentFactoryAdu[]> {
    const adus = await this.readAdus();
    return adus.filter(adu => adu.project_id === projectId);
  }

  async getAduById(aduId: string): Promise<AgentFactoryAdu | null> {
    const adus = await this.readAdus();
    return adus.find(adu => adu.id === aduId) || null;
  }

  async saveAdu(adu: AgentFactoryAdu): Promise<void> {
    const adus = await this.readAdus();
    const existingIndex = adus.findIndex(a => a.id === adu.id);
    if (existingIndex >= 0) {
      adus[existingIndex] = adu;
    } else {
      adus.push(adu);
    }
    await this.writeAdus(adus);
  }

  async writeRuns(runs: AgentFactoryRun[]): Promise<void> {
    const runsJsonPath = this.resolveSafePath('.ai-agent/registry/runs.json');
    try {
      const data = { version: 1, runs };
      await fs.mkdir(path.dirname(runsJsonPath), { recursive: true });
      await fs.writeFile(runsJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    } catch (err) {
      this.logger.error({ err }, 'Failed to write runs.json');
      throw err;
    }
  }

  async appendRunSummary(run: AgentFactoryRun): Promise<void> {
    const runs = await this.readRuns();
    runs.push(run);
    await this.writeRuns(runs);
  }

  async readAgents(): Promise<Record<string, AgentFactoryAgentConfig>> {
    const agentsJsonPath = this.resolveSafePath('.ai-agent/registry/agents.json');
    try {
      const data = await fs.readFile(agentsJsonPath, 'utf-8');
      const parsed = JSON.parse(data) as { agents?: Record<string, AgentFactoryAgentConfig> };
      return parsed.agents || {};
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        this.logger.warn('agents.json registry not found, returning empty record');
        return {};
      }
      this.logger.error({ err }, 'Failed to read agents.json');
      throw err;
    }
  }

  async readRuns(): Promise<AgentFactoryRun[]> {
    const runsJsonPath = this.resolveSafePath('.ai-agent/registry/runs.json');
    try {
      const data = await fs.readFile(runsJsonPath, 'utf-8');
      const parsed = JSON.parse(data) as { runs?: AgentFactoryRun[] };
      return parsed.runs || [];
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        this.logger.warn('runs.json registry not found, returning empty list');
        return [];
      }
      this.logger.error({ err }, 'Failed to read runs.json');
      throw err;
    }
  }

  classifyArtifactKind(filePath: string): AgentFactoryArtifact['kind'] {
    const normPath = filePath.replace(/\\/g, '/'); // Normalize windows backslashes to forward slashes

    if (normPath.includes('.ai-agent/context-packs/')) {
      return 'context';
    }
    if (normPath.includes('.ai-agent/contracts/') && normPath.endsWith('-notes.md')) {
      return 'contract-notes';
    }
    if (normPath.includes('.ai-agent/contracts/')) {
      return 'contract';
    }
    if (normPath.includes('tests/ai-agent-mvp/')) {
      return 'validation';
    }
    if (normPath.includes('.ai-agent/evidence/')) {
      return 'evidence';
    }
    if (normPath.endsWith('stdout.md')) {
      return 'stdout';
    }
    if (normPath.endsWith('stderr.md')) {
      return 'stderr';
    }
    if (normPath.endsWith('prompt.md')) {
      return 'prompt';
    }
    if (normPath.includes('.ai-agent/runs/')) {
      return 'run-log';
    }
    if (normPath.includes('.ai-agent/reviews/')) {
      return 'run-log';
    }
    if (normPath.includes('.ai-agent/acceptance/')) {
      return 'run-log';
    }
    return 'other';
  }

  async listArtifacts(paths: string[], workspaceRootOverride?: string): Promise<AgentFactoryArtifact[]> {
    const results: AgentFactoryArtifact[] = [];

    for (const relativePath of paths) {
      try {
        const fullPath = this.resolveSafePath(relativePath, workspaceRootOverride);
        const stat = await fs.stat(fullPath);
        results.push({
          path: relativePath,
          kind: this.classifyArtifactKind(relativePath),
          exists: true,
          size_bytes: stat.size,
          modified_at: stat.mtime.toISOString(),
        });
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
          results.push({
            path: relativePath,
            kind: this.classifyArtifactKind(relativePath),
            exists: false,
          });
        } else {
          this.logger.error({ err, path: relativePath }, 'Failed to stat artifact');
          throw err;
        }
      }
    }

    return results;
  }

  async listRunFiles(runDir: string, workspaceRootOverride?: string): Promise<AgentFactoryArtifact[]> {
    try {
      const fullDir = this.resolveSafePath(runDir, workspaceRootOverride);
      const files = await fs.readdir(fullDir);
      const paths = files.map((file) => path.join(runDir, file));
      return this.listArtifacts(paths, workspaceRootOverride);
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        this.logger.warn({ runDir }, 'Run directory not found');
        return [];
      }
      this.logger.error({ err, runDir }, 'Failed to list run files');
      throw err;
    }
  }

  async readTextArtifact(relativePath: string, maxBytes: number, workspaceRootOverride?: string): Promise<{ path: string; content: string; truncated: boolean }> {
    const fullPath = this.resolveSafePath(relativePath, workspaceRootOverride);

    // Resolve the real absolute canonical path of the target file to handle and prevent symlink bypasses
    let realPath: string;
    try {
      realPath = await fs.realpath(fullPath);
    } catch (err: unknown) {
      const fsErr = err as NodeJS.ErrnoException;
      if (fsErr.code === 'ENOENT') {
        // Preserve ENOENT so callers can return 404 rather than 500
        throw Object.assign(new Error(`File not found: ${relativePath}`), { code: 'ENOENT' });
      }
      this.logger.error({ err, path: relativePath }, 'Failed to resolve real path for text artifact');
      throw err;
    }

    const root = workspaceRootOverride ? path.resolve(workspaceRootOverride) : this.workspaceRoot;
    const allowedDirs = [
      path.join(root, '.agent-factory'),
      path.join(root, '.ai-agent', 'context-packs'),
      path.join(root, '.ai-agent', 'contracts'),
      path.join(root, '.ai-agent', 'evidence'),
      path.join(root, '.ai-agent', 'runs'),
      path.join(root, 'tests', 'ai-agent-mvp'),
      path.join(root, '.ai-agent', 'analysis'),
      path.join(root, '.ai-agent', 'designs'),
      path.join(root, '.ai-agent', 'reviews'),
      path.join(root, '.ai-agent', 'acceptance'),
      path.join(root, '.ai-agent', 'intake')
    ];

    // Resolve allowedDirs to real paths to be 100% robust
    const resolvedAllowedDirs = await Promise.all(
      allowedDirs.map(async (dir) => {
        try {
          return await fs.realpath(dir);
        } catch {
          return path.resolve(dir);
        }
      })
    );

    const isAllowed = resolvedAllowedDirs.some((resolvedDir) => {
      return realPath === resolvedDir || realPath.startsWith(resolvedDir + path.sep);
    });

    if (!isAllowed) {
      throw new Error(`Access denied: path is not in the allowed list of directories: ${relativePath}`);
    }

    const limit = Math.min(maxBytes || this.maxBytes, 200000);

    try {
      const handle = await fs.open(realPath, 'r');
      const { size } = await handle.stat();

      const bytesToRead = Math.min(size, limit);
      const buffer = Buffer.alloc(bytesToRead);

      await handle.read(buffer, 0, bytesToRead, 0);
      await handle.close();

      const content = buffer.toString('utf-8');
      const truncated = size > limit;

      return {
        path: relativePath,
        content,
        truncated,
      };
    } catch (err: unknown) {
      this.logger.error({ err, path: relativePath }, 'Failed to read text artifact');
      throw err;
    }
  }

  async readReviews(): Promise<AgentFactoryReview[]> {
    const reviewsPath = this.resolveSafePath('.ai-agent/registry/reviews.json');
    try {
      const data = await fs.readFile(reviewsPath, 'utf-8');
      const parsed = JSON.parse(data) as { reviews?: AgentFactoryReview[] };
      return parsed.reviews || [];
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        return [];
      }
      this.logger.error({ err }, 'Failed to read reviews.json');
      throw err;
    }
  }

  async writeReviews(reviews: AgentFactoryReview[]): Promise<void> {
    const reviewsPath = this.resolveSafePath('.ai-agent/registry/reviews.json');
    try {
      const data = { version: 1, reviews };
      await fs.mkdir(path.dirname(reviewsPath), { recursive: true });
      await fs.writeFile(reviewsPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    } catch (err) {
      this.logger.error({ err }, 'Failed to write reviews.json');
      throw err;
    }
  }

  async readEdits(): Promise<AgentFactoryArtifactEdit[]> {
    const editsPath = this.resolveSafePath('.ai-agent/registry/artifact-edits.json');
    try {
      const data = await fs.readFile(editsPath, 'utf-8');
      const parsed = JSON.parse(data) as { edits?: AgentFactoryArtifactEdit[] };
      return parsed.edits || [];
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        return [];
      }
      this.logger.error({ err }, 'Failed to read artifact-edits.json');
      throw err;
    }
  }

  async writeEdits(edits: AgentFactoryArtifactEdit[]): Promise<void> {
    const editsPath = this.resolveSafePath('.ai-agent/registry/artifact-edits.json');
    try {
      const data = { version: 1, edits };
      await fs.mkdir(path.dirname(editsPath), { recursive: true });
      await fs.writeFile(editsPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    } catch (err) {
      this.logger.error({ err }, 'Failed to write artifact-edits.json');
      throw err;
    }
  }

  async writeTextArtifact(relativePath: string, content: string, workspaceRootOverride?: string): Promise<{ sha256: string; bytes: number }> {
    if (!relativePath.endsWith('.md')) {
      throw new Error(`Access denied: only markdown (.md) files can be edited: ${relativePath}`);
    }

    const byteLength = Buffer.byteLength(content, 'utf-8');
    if (byteLength > 200000) {
      throw new Error(`Payload too large: Content length ${byteLength} exceeds maximum allowed size of 200KB`);
    }

    const fullPath = this.resolveSafePath(relativePath, workspaceRootOverride);
    const parentDir = path.dirname(fullPath);

    await fs.mkdir(parentDir, { recursive: true });

    let realParentDir: string;
    try {
      realParentDir = await fs.realpath(parentDir);
    } catch (err) {
      this.logger.error({ err, parentDir }, 'Parent directory does not exist or failed to resolve realpath');
      throw new Error(`Access denied: parent directory does not exist: ${parentDir}`);
    }

    const root = workspaceRootOverride ? path.resolve(workspaceRootOverride) : this.workspaceRoot;
    const allowedWriteDirs = [
      path.join(root, '.ai-agent', 'analysis'),
      path.join(root, '.ai-agent', 'designs')
    ];

    const resolvedAllowedWriteDirs = await Promise.all(
      allowedWriteDirs.map(async (dir) => {
        try {
          await fs.mkdir(dir, { recursive: true });
          return await fs.realpath(dir);
        } catch {
          return path.resolve(dir);
        }
      })
    );

    const isAllowed = resolvedAllowedWriteDirs.some((resolvedDir) => {
      return realParentDir === resolvedDir || realParentDir.startsWith(resolvedDir + path.sep);
    });

    if (!isAllowed) {
      throw new Error(`Access denied: write path is not in the allowed directories: ${relativePath}`);
    }

    const tmpPath = fullPath + '.tmp';
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, fullPath);

    const crypto = await import('crypto');
    const sha256 = crypto.createHash('sha256').update(content, 'utf-8').digest('hex');

    return {
      sha256,
      bytes: byteLength
    };
  }
}

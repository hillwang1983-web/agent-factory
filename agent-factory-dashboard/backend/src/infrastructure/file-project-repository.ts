import fs from 'fs/promises';
import path from 'path';
import pino from 'pino';
import { ProjectRepository } from '../domain/project-repository';
import { AgentFactoryProject, RegisterProjectInput, ProjectStatus } from '../domain/project';

export class FileProjectRepository implements ProjectRepository {
  private readonly registryPath: string;
  private readonly workspaceRoot: string;
  private readonly allowedRoots: string[];
  private readonly logger: pino.Logger;

  private readonly forbiddenPrefixes = [
    '/',
    '/System',
    '/Library',
    '/Applications',
    '/Users/hill/.ssh',
    '/Users/hill/.hermes',
    '/Users/hill/.codex',
  ];

  constructor(
    registryPath: string,
    workspaceRoot: string,
    allowedRoots: string[],
    logger: pino.Logger
  ) {
    this.registryPath = path.resolve(registryPath);
    this.workspaceRoot = path.resolve(workspaceRoot);
    const envRoots = process.env.AGENT_FACTORY_ALLOWED_PROJECT_ROOTS
      ? process.env.AGENT_FACTORY_ALLOWED_PROJECT_ROOTS.split(',').map((r) => r.trim()).filter(Boolean)
      : [];
    const combinedRoots = [...allowedRoots, ...envRoots];
    this.allowedRoots = Array.from(new Set(combinedRoots.map((r) => path.resolve(r))));
    this.logger = logger.child({ component: 'FileProjectRepository' });
  }

  private parseProfileSummary(parsed: any): AgentFactoryProject['profile_summary'] {
    let detectedStack = parsed.detected_stack || [];
    if (detectedStack.length > 0 && typeof detectedStack[0] === 'string') {
      detectedStack = detectedStack.map((lang: any) => ({
        language: lang,
        percentage: Math.round(100 / Math.max(detectedStack.length, 1))
      }));
    } else if ((!detectedStack || detectedStack.length === 0) && parsed.stack) {
      const langs = parsed.stack.languages || [];
      detectedStack = langs.map((lang: string) => ({
        language: lang,
        percentage: Math.round(100 / Math.max(langs.length, 1))
      }));
    } else if ((!detectedStack || detectedStack.length === 0) && parsed.tech_stack) {
      const primary = parsed.tech_stack.primary_language;
      const secondary = parsed.tech_stack.secondary_languages || [];
      const langs: string[] = [];
      if (primary) {
        langs.push(primary.split(' ')[0].toLowerCase());
      }
      for (const s of secondary) {
        const cleaned = s.toLowerCase();
        if (cleaned === 'node.js') {
          langs.push('javascript');
        } else {
          langs.push(cleaned);
        }
      }
      const uniqueLangs = Array.from(new Set(langs));
      detectedStack = uniqueLangs.map((lang: string) => ({
        language: lang,
        percentage: Math.round(100 / Math.max(uniqueLangs.length, 1))
      }));
      const totalPct = detectedStack.reduce((sum: number, item: any) => sum + item.percentage, 0);
      if (totalPct > 0 && totalPct !== 100 && detectedStack.length > 0) {
        detectedStack[0].percentage += (100 - totalPct);
      }
    }

    let projectType = parsed.project_type || 'unknown';
    if (projectType === 'unknown' && parsed.tech_stack) {
      const buildSystem = parsed.tech_stack.build_system || '';
      const primaryLang = parsed.tech_stack.primary_language || '';
      if (buildSystem.toLowerCase() === 'meson' || buildSystem.toLowerCase() === 'cmake' || primaryLang.toLowerCase().startsWith('c')) {
        projectType = 'c-cpp-project';
      }
    }

    let riskLevel = parsed.risk_level || 'unknown';
    if (riskLevel === 'unknown') {
      if (parsed.risk_map && parsed.risk_map.high_risk_paths) {
        const count = parsed.risk_map.high_risk_paths.length;
        riskLevel = count >= 5 ? 'high' : count >= 2 ? 'medium' : 'low';
      } else if (parsed.risks) {
        const count = parsed.risks.length;
        riskLevel = count >= 5 ? 'high' : count >= 2 ? 'medium' : 'low';
      }
    }

    let buildCommandsRaw = parsed.discovered_commands?.build || parsed.commands?.build || [];
    let buildCommands: string[] = [];
    if (Array.isArray(buildCommandsRaw)) {
      buildCommands = buildCommandsRaw;
    } else if (buildCommandsRaw && typeof buildCommandsRaw === 'object') {
      buildCommands = Object.values(buildCommandsRaw);
    } else if (typeof buildCommandsRaw === 'string') {
      buildCommands = [buildCommandsRaw];
    }

    let testCommandsRaw = parsed.discovered_commands?.test || parsed.commands?.test || [];
    let testCommands: string[] = [];
    if (Array.isArray(testCommandsRaw)) {
      testCommands = testCommandsRaw;
    } else if (testCommandsRaw && typeof testCommandsRaw === 'object') {
      testCommands = Object.values(testCommandsRaw);
    } else if (typeof testCommandsRaw === 'string') {
      testCommands = [testCommandsRaw];
    }

    return {
      detected_stack: detectedStack,
      project_type: projectType,
      risk_level: riskLevel,
      build_commands: buildCommands,
      test_commands: testCommands,
      scan_summary: parsed.scan_summary || {},
    };
  }

  private async ensureRegistryExists(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
      await fs.access(this.registryPath);
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        // Create default registry with the default open5gs project
        const defaultProject: AgentFactoryProject = {
          project_id: 'default-open5gs',
          name: 'Default Open5GS Workspace',
          repo_path: this.workspaceRoot,
          git_root: this.workspaceRoot,
          default_branch: 'main',
          status: 'registered',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          profile_path: path.join(this.workspaceRoot, '.agent-factory', 'project-profile.json'),
          knowledge_dir: path.join(this.workspaceRoot, '.agent-factory', 'knowledge'),
          last_profiled_at: null,
        };

        // If project-profile exists, we can set status to profiled
        try {
          await fs.access(defaultProject.profile_path!);
          defaultProject.status = 'profiled';
          const profileData = await fs.readFile(defaultProject.profile_path!, 'utf-8');
          const parsed = JSON.parse(profileData);
          defaultProject.profile_summary = this.parseProfileSummary(parsed);
          defaultProject.last_profiled_at = new Date().toISOString();
        } catch {
          // No profile found, leave status as registered
        }

        const data = {
          version: 1,
          projects: [defaultProject],
        };
        await fs.writeFile(
          this.registryPath,
          JSON.stringify(data, null, 2) + '\n',
          'utf-8'
        );
        this.logger.info({ defaultProject }, 'Created projects.json with default project');
      } else {
        throw err;
      }
    }
  }

  async listProjects(): Promise<AgentFactoryProject[]> {
    await this.ensureRegistryExists();
    try {
      const data = await fs.readFile(this.registryPath, 'utf-8');
      const parsed = JSON.parse(data) as { projects?: AgentFactoryProject[] };
      const projects = parsed.projects || [];
      
      // Dynamic status validation based on existence of profile_path
      for (const p of projects) {
        if (p.status !== 'registered') {
          continue;
        }
        if (p.profile_path) {
          try {
            await fs.access(p.profile_path);
            p.status = 'profiled';
            const profileData = await fs.readFile(p.profile_path, 'utf-8');
            const parsedProfile = JSON.parse(profileData);
            p.profile_summary = this.parseProfileSummary(parsedProfile);
          } catch {
            // Profile not found/readable, status remains whatever it was
          }
        }
      }
      return projects;
    } catch (err) {
      this.logger.error({ err }, 'Failed to list projects');
      throw err;
    }
  }

  async getProject(projectId: string): Promise<AgentFactoryProject | null> {
    const projects = await this.listProjects();
    const project = projects.find((p) => p.project_id === projectId);
    return project || null;
  }

  async createProject(input: RegisterProjectInput): Promise<AgentFactoryProject> {
    if (!input.name || !input.repoPath) {
      throw new Error('Project name and repoPath are required');
    }

    // 1. Resolve and validate repoPath
    let resolvedRepoPath: string;
    try {
      resolvedRepoPath = await fs.realpath(input.repoPath);
    } catch (err) {
      throw new Error(`Path does not exist or is not readable: ${input.repoPath}`);
    }

    const stat = await fs.stat(resolvedRepoPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolvedRepoPath}`);
    }

    // 2. Reject forbidden paths (Denylist First)
    const isForbidden = this.forbiddenPrefixes.some((forbidden) => {
      const normalizedForbidden = path.normalize(forbidden);
      const normalizedRepo = path.normalize(resolvedRepoPath);
      return (
        normalizedRepo === normalizedForbidden ||
        normalizedRepo.startsWith(normalizedForbidden + path.sep)
      );
    });

    if (isForbidden) {
      throw new Error(`Access Denied: Path ${resolvedRepoPath} is forbidden`);
    }

    // 3. Validate allowedRoots boundary (Allowlist Second)
    const isAllowed = this.allowedRoots.some((allowedRoot) => {
      const normalizedAllowed = path.normalize(allowedRoot);
      const normalizedRepo = path.normalize(resolvedRepoPath);
      return (
        normalizedRepo === normalizedAllowed ||
        normalizedRepo.startsWith(normalizedAllowed + path.sep)
      );
    });

    if (!isAllowed) {
      throw new Error(`Access Denied: Path ${resolvedRepoPath} is outside allowed directories`);
    }

    // 4. Validate Git repository (git root via git rev-parse)
    const { execSync } = require('child_process');
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: resolvedRepoPath,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch (err) {
      throw new Error(`Not a Git repository (git rev-parse failed): ${resolvedRepoPath}`);
    }

    const realGitRoot = await fs.realpath(gitRoot);
    if (resolvedRepoPath !== realGitRoot) {
      throw new Error(`Access Denied: Path ${resolvedRepoPath} is a subdirectory of Git repository ${realGitRoot}. You must register the top-level Git root.`);
    }

    // 5. Generate safe unique project_id
    const rawId = input.projectId ? input.projectId.trim() : '';
    const baseId = (rawId || path.basename(resolvedRepoPath)).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    let projectId = baseId || 'project';

    const projects = await this.listProjects();
    
    // Check duplication
    if (projects.some((p) => p.repo_path === resolvedRepoPath)) {
      throw new Error(`Project with repository path ${resolvedRepoPath} is already registered`);
    }

    let counter = 1;
    while (projects.some((p) => p.project_id === projectId)) {
      projectId = `${baseId}-${counter++}`;
    }

    // 6. Create project object
    const newProject: AgentFactoryProject = {
      project_id: projectId,
      name: input.name.trim(),
      repo_path: resolvedRepoPath,
      git_root: resolvedRepoPath,
      default_branch: 'main',
      status: 'registered',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      profile_path: path.join(resolvedRepoPath, '.agent-factory', 'project-profile.json'),
      knowledge_dir: path.join(resolvedRepoPath, '.agent-factory', 'knowledge'),
      last_profiled_at: null,
      description: input.description,
    };

    projects.push(newProject);

    // Write atomic
    const data = {
      version: 1,
      projects,
    };
    const tmpPath = this.registryPath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    await fs.rename(tmpPath, this.registryPath);

    this.logger.info({ newProject }, 'Registered new project successfully');
    return newProject;
  }

  async updateProject(project: AgentFactoryProject): Promise<void> {
    const projects = await this.listProjects();
    const index = projects.findIndex((p) => p.project_id === project.project_id);
    if (index === -1) {
      throw new Error(`Project ${project.project_id} not found`);
    }

    project.updated_at = new Date().toISOString();
    projects[index] = project;

    const data = {
      version: 1,
      projects,
    };
    const tmpPath = this.registryPath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    await fs.rename(tmpPath, this.registryPath);
    this.logger.info({ projectId: project.project_id, status: project.status }, 'Project updated');
  }

  async disableProject(projectId: string): Promise<void> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
    project.status = 'disabled';
    await this.updateProject(project);
  }
}

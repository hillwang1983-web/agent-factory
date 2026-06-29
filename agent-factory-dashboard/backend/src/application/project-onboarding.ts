import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import pino from 'pino';
import { ProjectRepository } from '../domain/project-repository';
import { AgentFactoryProject, RegisterProjectInput } from '../domain/project';
import { broadcastOrchestratorEvent } from '../websocket/broadcaster';

export class ProjectOnboardingUseCase {
  private readonly projectRepo: ProjectRepository;
  private readonly workspaceRoot: string;
  private readonly logger: pino.Logger;

  constructor(
    projectRepo: ProjectRepository,
    workspaceRoot: string,
    logger: pino.Logger
  ) {
    this.projectRepo = projectRepo;
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.logger = logger.child({ component: 'ProjectOnboardingUseCase' });
  }

  async listProjects(): Promise<AgentFactoryProject[]> {
    return this.projectRepo.listProjects();
  }

  async getProject(projectId: string): Promise<AgentFactoryProject | null> {
    return this.projectRepo.getProject(projectId);
  }

  async registerProject(input: RegisterProjectInput): Promise<AgentFactoryProject> {
    const project = await this.projectRepo.createProject(input);

    // Create target .agent-factory/ directory structure inside target repo
    const targetDir = path.join(project.repo_path, '.agent-factory');
    const targetKnowledgeDir = path.join(targetDir, 'knowledge');

    try {
      await fs.mkdir(targetKnowledgeDir, { recursive: true });
      this.logger.info({ projectId: project.project_id, targetDir }, 'Created target .agent-factory structure');
    } catch (err) {
      this.logger.error({ err, projectId: project.project_id }, 'Failed to create .agent-factory structure in target repo');
    }

    // Broadcast registration event
    broadcastOrchestratorEvent({
      type: 'agentFactoryEvent',
      event: 'project_registered',
      projectId: project.project_id,
      project
    });

    return project;
  }

  async disableProject(projectId: string): Promise<void> {
    await this.projectRepo.disableProject(projectId);
    broadcastOrchestratorEvent({
      type: 'agentFactoryEvent',
      event: 'project_disabled',
      projectId
    });
  }

  async runProfiling(projectId: string): Promise<{ success: boolean; status: string }> {
    const project = await this.projectRepo.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    if (project.status === 'disabled') {
      throw new Error(`Access Denied: Project ${projectId} is disabled`);
    }

    if (project.status === 'profiling') {
      return { success: true, status: 'profiling' };
    }

    project.status = 'profiling';
    await this.projectRepo.updateProject(project);

    // Broadcast start profiling
    broadcastOrchestratorEvent({
      type: 'agentFactoryEvent',
      event: 'project_profiling_started',
      projectId
    });

    const scriptPath = path.join(this.workspaceRoot, 'scripts', 'hermes_project_profile.py');
    this.logger.info({ projectId, scriptPath }, 'Spawning hermes_project_profile.py');

    const child = spawn('python3', [scriptPath, '--project', projectId], {
      cwd: this.workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdoutData = '';
    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
      this.logger.info({ projectId, output: chunk.toString().trim() }, 'Profiling STDOUT');

      // Broadcast output logs
      broadcastOrchestratorEvent({
        type: 'agentFactoryEvent',
        event: 'project_profiling_log',
        projectId,
        log: chunk.toString()
      });
    });

    child.stderr.on('data', (chunk) => {
      this.logger.error({ projectId, output: chunk.toString().trim() }, 'Profiling STDERR');
      broadcastOrchestratorEvent({
        type: 'agentFactoryEvent',
        event: 'project_profiling_log',
        projectId,
        log: `ERROR: ${chunk.toString()}`
      });
    });

    child.on('close', async (code) => {
      this.logger.info({ projectId, code }, 'Profiling script exited');
      const updatedProject = await this.projectRepo.getProject(projectId);
      if (updatedProject) {
        if (code === 0) {
          // Re-load to read newly created profile
          try {
            const profileJsonPath = path.join(updatedProject.repo_path, '.agent-factory', 'project-profile.json');
            const profileContent = await fs.readFile(profileJsonPath, 'utf-8');
            const parsed = JSON.parse(profileContent);
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

            const existingSummary = updatedProject.profile_summary;
            const scanSummary = existingSummary?.scan_summary || parsed.scan_summary || {};

            updatedProject.status = 'profiled';
            updatedProject.profile_summary = {
              detected_stack: detectedStack,
              project_type: projectType,
              risk_level: riskLevel,
              build_commands: buildCommands,
              test_commands: testCommands,
              scan_summary: scanSummary,
            };
            updatedProject.last_profiled_at = new Date().toISOString();
          } catch (e) {
            this.logger.error({ e, projectId }, 'Failed to parse generated profile JSON after successful run');
            updatedProject.status = 'profile_failed';
          }
        } else {
          updatedProject.status = 'profile_failed';
        }
        await this.projectRepo.updateProject(updatedProject);

        broadcastOrchestratorEvent({
          type: 'agentFactoryEvent',
          event: 'project_profiling_completed',
          projectId,
          status: updatedProject.status,
          project: updatedProject
        });
      }
    });

    return { success: true, status: 'profiling' };
  }

  async getProjectProfile(projectId: string): Promise<any> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
    const profilePath = path.join(project.repo_path, '.agent-factory', 'project-profile.json');
    try {
      const content = await fs.readFile(profilePath, 'utf-8');
      return JSON.parse(content);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error('Project profile does not exist. Please run profiling first.');
      }
      throw err;
    }
  }

  async getProjectKnowledgeList(projectId: string): Promise<string[]> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
    const knowledgeDir = path.join(project.repo_path, '.agent-factory', 'knowledge');
    try {
      const files = await fs.readdir(knowledgeDir);
      return files.filter(f => f.endsWith('.md'));
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async getProjectKnowledgeDoc(projectId: string, docName: string): Promise<string> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
    if (!docName.endsWith('.md') || docName.includes('/') || docName.includes('..')) {
      throw new Error('Invalid knowledge document name');
    }
    const docPath = path.join(project.repo_path, '.agent-factory', 'knowledge', docName);
    try {
      return await fs.readFile(docPath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`Knowledge document ${docName} not found`);
      }
      throw err;
    }
  }
}

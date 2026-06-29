import { ProjectRepository } from '../domain/project-repository';
import { AgentFactoryRepository } from '../domain/agent-factory-repository';
import { AgentFactoryAdu, CreateProjectAduInput } from '../domain/agent-factory';
import * as path from 'path';

const ADU_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

const BLOCKED_COMMAND_PATTERNS = [
  'rm -rf',
  'sudo ',
  'curl ',
  'wget ',
  'ssh ',
  'scp ',
  'rsync ',
  'chmod -R 777',
  '> /dev/',
  'dd ',
  'mkfs',
  'launchctl',
  'security ',
  'git push',
  'git clean',
  'git reset --hard',
];

function normalizeRepoRelativePath(input: string): string {
  const value = input.trim().replace(/\\/g, '/');
  if (!value || value.startsWith('/') || value.includes('..') || value.includes('\0')) {
    throw new Error(`Invalid repository-relative path: ${input}`);
  }
  return value;
}

export class ProjectAduFactory {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly agentFactoryRepository: AgentFactoryRepository,
  ) {}

  async createForProject(projectId: string, input: CreateProjectAduInput): Promise<AgentFactoryAdu> {
    const project = await this.projectRepository.getProject(projectId);

    if (!project) {
      const err = new Error(`Project ${projectId} not found`);
      (err as any).status = 404;
      throw err;
    }

    if (project.status !== 'profiled') {
      const err = new Error(`Project ${projectId} is not profiled (status: ${project.status})`);
      (err as any).status = 409;
      throw err;
    }

    if (!project.profile_path || !project.knowledge_dir) {
      const err = new Error(`Project ${projectId} is missing profile_path or knowledge_dir`);
      (err as any).status = 409;
      throw err;
    }

    const aduId = input.aduId || `REQ-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

    if (!ADU_ID_PATTERN.test(aduId)) {
      const err = new Error(`Invalid ADU ID: ${aduId}`);
      (err as any).status = 400;
      throw err;
    }

    if (!input.title?.trim() || !input.goal?.trim()) {
      const err = new Error(`Title and goal are required`);
      (err as any).status = 400;
      throw err;
    }

    const existingAdu = await this.agentFactoryRepository.getAduById(aduId);
    if (existingAdu) {
      const err = new Error(`ADU with ID ${aduId} already exists`);
      (err as any).status = 400;
      throw err;
    }

    // Build paths
    const allowedReadPaths = new Set<string>();
    allowedReadPaths.add(normalizeRepoRelativePath('.agent-factory/project-profile.json'));
    allowedReadPaths.add(normalizeRepoRelativePath('.agent-factory/knowledge/'));
    allowedReadPaths.add(normalizeRepoRelativePath('.ai-agent/'));

    if (input.preferredReadPaths) {
      input.preferredReadPaths.forEach(p => allowedReadPaths.add(normalizeRepoRelativePath(p)));
    }

    const allowedWritePaths = new Set<string>();
    allowedWritePaths.add(normalizeRepoRelativePath('.ai-agent/analysis/'));
    allowedWritePaths.add(normalizeRepoRelativePath('.ai-agent/designs/'));
    allowedWritePaths.add(normalizeRepoRelativePath('.ai-agent/contracts/'));
    allowedWritePaths.add(normalizeRepoRelativePath('.ai-agent/reviews/'));
    allowedWritePaths.add(normalizeRepoRelativePath('.ai-agent/acceptance/'));
    allowedWritePaths.add(normalizeRepoRelativePath('.ai-agent/evidence/'));
    allowedWritePaths.add(normalizeRepoRelativePath('.ai-agent/runs/'));

    if (input.preferredWritePaths) {
      input.preferredWritePaths.forEach(p => allowedWritePaths.add(normalizeRepoRelativePath(p)));
    }

    // Build commands
    const requiredCommands = new Set<string>();
    if (input.requiredCommands) {
      input.requiredCommands.forEach(cmd => {
        if (!cmd.trim()) return;
        for (const blocked of BLOCKED_COMMAND_PATTERNS) {
          if (cmd.includes(blocked)) {
            const err = new Error(`Command blocked by pattern "${blocked}": ${cmd}`);
            (err as any).status = 400;
            throw err;
          }
        }
        requiredCommands.add(cmd.trim());
      });
    }

    const profileTestCommands = project.profile_summary?.test_commands || [];
    const profileBuildCommands = project.profile_summary?.build_commands || [];

    if (requiredCommands.size === 0 && profileTestCommands.length === 0 && profileBuildCommands.length === 0 && input.manualEvidenceMode !== true) {
      const err = new Error(`No verification commands available. Project profile lacks build/test commands, and no explicit commands were provided.`);
      (err as any).status = 400;
      throw err;
    }

    const allowedCommands = Array.from(requiredCommands);
    // Add profile commands to allowlist (but not necessarily to requiredCommands)
    for (const cmd of profileTestCommands) {
      if (!allowedCommands.includes(cmd)) allowedCommands.push(cmd);
    }
    for (const cmd of profileBuildCommands) {
      if (!allowedCommands.includes(cmd)) allowedCommands.push(cmd);
    }

    const now = new Date().toISOString();

    const adu: AgentFactoryAdu = {
      id: aduId,
      project_id: project.project_id,
      project_name: project.name,
      repo_path: project.repo_path,
      artifact_root: '.ai-agent',
      profile_path: project.profile_path,
      knowledge_dir: project.knowledge_dir,
      title: input.title,
      goal: input.goal,
      state: 'created',
      retry_count: 0,
      max_retries: 3,
      risk: input.risk || 'medium',
      target_level: input.targetLevel || 'mvp',
      allowed_read_paths: Array.from(allowedReadPaths),
      allowed_write_paths: Array.from(allowedWritePaths),
      required_commands: Array.from(requiredCommands),
      required_evidence: [`.ai-agent/evidence/${aduId}.md`],
      artifacts: [],
      human_gate_required: true,
      language: 'zh',
      clarifications: input.clarifications || [],
      source_summary: input.sourceSummary || '',
      review_policy: {
        analysis_review_required: input.analysisReviewRequired !== false,
        design_review_required: input.designReviewRequired !== false,
      },
      command_policy: {
        mode: 'allowlist',
        allowed_commands: allowedCommands,
        blocked_command_patterns: BLOCKED_COMMAND_PATTERNS,
      },
      review_counters: {
        code_review_failures: 0,
        buildfix_failures: 0,
        acceptance_review_failures: 0,
      },
      review_limits: {
        max_code_review_failures: 5,
        max_buildfix_failures: 5,
        max_acceptance_review_failures: 5,
      },
      created_at: now,
      updated_at: now,
    };

    await this.agentFactoryRepository.saveAdu(adu);
    return adu;
  }
}

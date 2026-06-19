import { ProjectRepository } from '../domain/project-repository';
import { AgentFactoryRepository } from '../domain/agent-factory-repository';
import { AgentFactoryEpic, CreateEpicInput } from '../domain/agent-factory';

export class EpicFactory {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly agentFactoryRepository: AgentFactoryRepository,
  ) {}

  async createForProject(projectId: string, input: CreateEpicInput): Promise<AgentFactoryEpic> {
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

    if (!input.title?.trim() || !input.source_requirement?.trim()) {
      const err = new Error('Title and source_requirement are required');
      (err as any).status = 400;
      throw err;
    }

    // Generate a unique Epic ID
    let epicId: string;
    let attempts = 0;
    do {
      const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      epicId = `EPIC-${new Date().getFullYear()}-${suffix}`;
      const existing = await this.agentFactoryRepository.getEpic(epicId);
      if (!existing) break;
      attempts++;
      if (attempts > 20) {
        const err = new Error('Failed to generate a unique Epic ID after 20 attempts');
        (err as any).status = 500;
        throw err;
      }
    } while (true);

    const now = new Date().toISOString();

    const epic: AgentFactoryEpic = {
      id: epicId,
      project_id: project.project_id,
      project_name: project.name,
      repo_path: project.repo_path,
      title: input.title.trim(),
      source_requirement: input.source_requirement.trim(),
      state: 'created',
      risk: input.risk || 'medium',
      target_level: input.target_level || 'mvp',
      language: input.language || 'zh',
      child_adus: [],
      dependencies: [],
      clarifications: input.clarifications || [],
      created_at: now,
      updated_at: now,
    };

    await this.agentFactoryRepository.saveEpic(epic);
    return epic;
  }
}

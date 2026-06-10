import { AgentFactoryProject, RegisterProjectInput } from './project';

export interface ProjectRepository {
  listProjects(): Promise<AgentFactoryProject[]>;
  getProject(projectId: string): Promise<AgentFactoryProject | null>;
  createProject(input: RegisterProjectInput): Promise<AgentFactoryProject>;
  updateProject(project: AgentFactoryProject): Promise<void>;
  disableProject(projectId: string): Promise<void>;
}

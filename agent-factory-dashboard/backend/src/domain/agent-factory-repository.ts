import {
  AgentFactoryAdu,
  AgentFactoryAgentConfig,
  AgentFactoryArtifact,
  AgentFactoryRun,
  AgentFactoryReview,
  AgentFactoryArtifactEdit,
  AgentFactoryEpic,
} from './agent-factory';

export interface AgentFactoryRepository {
  getWorkspaceRoot(): string;
  readAdus(): Promise<AgentFactoryAdu[]>;
  listAdus(): Promise<AgentFactoryAdu[]>;
  listAdusByProject(projectId: string): Promise<AgentFactoryAdu[]>;
  getAduById(aduId: string): Promise<AgentFactoryAdu | null>;
  saveAdu(adu: AgentFactoryAdu): Promise<void>;
  writeAdus(adus: AgentFactoryAdu[]): Promise<void>;
  readAgents(): Promise<Record<string, AgentFactoryAgentConfig>>;
  readRuns(): Promise<AgentFactoryRun[]>;
  listArtifacts(paths: string[], workspaceRootOverride?: string): Promise<AgentFactoryArtifact[]>;
  listRunFiles(runDir: string, workspaceRootOverride?: string): Promise<AgentFactoryArtifact[]>;
  readTextArtifact(path: string, maxBytes: number, workspaceRootOverride?: string): Promise<{ path: string; content: string; truncated: boolean; availability: 'available' | 'empty' | 'not_recorded' }>;
  readReviews(): Promise<AgentFactoryReview[]>;
  writeReviews(reviews: AgentFactoryReview[]): Promise<void>;
  readEdits(): Promise<AgentFactoryArtifactEdit[]>;
  writeEdits(edits: AgentFactoryArtifactEdit[]): Promise<void>;
  writeTextArtifact(path: string, content: string, workspaceRootOverride?: string): Promise<{ sha256: string; bytes: number }>;
  // Phase 3: Epic
  readEpics(): Promise<AgentFactoryEpic[]>;
  saveEpic(epic: AgentFactoryEpic): Promise<void>;
  getEpic(epicId: string): Promise<AgentFactoryEpic | null>;
  listEpicsByProject(projectId: string): Promise<AgentFactoryEpic[]>;
  listEpicArtifacts(epicId: string, repoPath: string): Promise<AgentFactoryArtifact[]>;
  updateAdus(updateFn: (adus: AgentFactoryAdu[]) => Promise<AgentFactoryAdu[]> | AgentFactoryAdu[]): Promise<void>;
  updateReviews(updateFn: (reviews: AgentFactoryReview[]) => Promise<AgentFactoryReview[]> | AgentFactoryReview[]): Promise<void>;
  updateEdits(updateFn: (edits: AgentFactoryArtifactEdit[]) => Promise<AgentFactoryArtifactEdit[]> | AgentFactoryArtifactEdit[]): Promise<void>;
}

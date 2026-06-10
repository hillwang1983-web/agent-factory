import {
  AgentFactoryAdu,
  AgentFactoryAgentConfig,
  AgentFactoryArtifact,
  AgentFactoryRun,
  AgentFactoryReview,
  AgentFactoryArtifactEdit,
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
  readTextArtifact(path: string, maxBytes: number, workspaceRootOverride?: string): Promise<{ path: string; content: string; truncated: boolean }>;
  readReviews(): Promise<AgentFactoryReview[]>;
  writeReviews(reviews: AgentFactoryReview[]): Promise<void>;
  readEdits(): Promise<AgentFactoryArtifactEdit[]>;
  writeEdits(edits: AgentFactoryArtifactEdit[]): Promise<void>;
  writeTextArtifact(path: string, content: string, workspaceRootOverride?: string): Promise<{ sha256: string; bytes: number }>;
}

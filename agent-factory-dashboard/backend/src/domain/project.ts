export type ProjectStatus =
  | 'registered'
  | 'profiling'
  | 'profiled'
  | 'profile_failed'
  | 'disabled';

export interface ProjectProfileSummary {
  detected_stack: any[];
  project_type: string;
  risk_level: 'low' | 'medium' | 'high' | 'unknown' | string;
  build_commands: string[];
  test_commands: string[];
  scan_summary?: {
    total_files: number;
    lines_of_code: number;
  };
}

export interface AgentFactoryProject {
  project_id: string;
  name: string;
  repo_path: string;
  git_root: string;
  default_branch: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  profile_path: string | null;
  knowledge_dir: string | null;
  last_profiled_at: string | null;
  profile_summary?: ProjectProfileSummary;
  description?: string;
}

export interface RegisterProjectInput {
  projectId?: string;
  name: string;
  repoPath: string;
  description?: string;
}

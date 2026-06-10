export interface AgentFactoryCommandPolicy {
  mode: 'allowlist';
  allowed_commands: string[];
  blocked_command_patterns: string[];
}

export interface AgentFactoryReviewPolicy {
  analysis_review_required: boolean;
  design_review_required: boolean;
}

export type AgentFactoryHealth = 'healthy' | 'active' | 'blocked' | 'stale' | 'failed' | 'running';

export interface AgentFactoryRun {
  timestamp: string;
  adu_id: string;
  agent: string;
  returncode: number;
  result: string;
  run_dir: string;
  parsed_result: {
    result?: string;
    next_state?: string;
    changed_files?: string[];
    commands_run?: Array<string | { command: string; result?: string }>;
    artifacts?: string[];
    risks?: string[];
    next_agent?: string | null;
  } | null;
  token_usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedInputTokens: number;
    usageSource: string;
  };
}

export interface AgentFactoryArtifact {
  path: string;
  kind: 'context' | 'contract' | 'contract-notes' | 'validation' | 'run-log' | 'evidence' | 'stdout' | 'stderr' | 'prompt' | 'other' | string;
  exists: boolean;
  size_bytes?: number;
  modified_at?: string;
}

export interface AgentFactoryWorkflowStep {
  state: string;
  label: string;
  status: 'complete' | 'current' | 'pending' | 'blocked' | 'failed';
  agent?: string | null;
  run_timestamp?: string;
  result?: string;
}

export interface AgentFactoryAduView {
  id: string;
  title: string;
  goal: string;
  state: string;
  retry_count: number;
  max_retries: number;
  risk: string;
  target_level: string;
  allowed_read_paths: string[];
  allowed_write_paths: string[];
  required_commands: string[];
  required_evidence: string[];
  artifacts: string[];
  human_gate_required: boolean;
  paused?: boolean;
  language?: string;
  next_agent: string | null;
  latest_run: AgentFactoryRun | null;
  runs: AgentFactoryRun[];
  workflow: AgentFactoryWorkflowStep[];
  artifact_status: AgentFactoryArtifact[];
  health: {
    status: AgentFactoryHealth;
    reasons: string[];
  };
  review_policy?: {
    analysis_review_required: boolean;
    design_review_required: boolean;
  };
  review_summary?: {
    analysis?: {
      status: 'pending' | 'approved' | 'rework_requested';
      artifact_path: string;
      approved_at: string | null;
    };
    design?: {
      status: 'pending' | 'approved' | 'rework_requested';
      artifact_path: string;
      approved_at: string | null;
    };
  };
  review_counters?: {
    code_review_failures: number;
    acceptance_review_failures: number;
  };
  review_limits?: {
    max_code_review_failures: number;
    max_acceptance_review_failures: number;
  };
  project_id?: string;
  project_name?: string;
  repo_path?: string;
  artifact_root?: string;
  profile_path?: string;
  knowledge_dir?: string;
  command_policy?: AgentFactoryCommandPolicy;
  created_at?: string;
  updated_at?: string;
}

export interface AgentFactoryProject {
  project_id: string;
  name: string;
  repo_path: string;
  git_root: string;
  default_branch: string | null;
  status: 'registered' | 'profiling' | 'profiled' | 'profile_failed' | 'disabled';
  created_at: string;
  updated_at: string;
  profile_path: string | null;
  knowledge_dir: string | null;
  last_profiled_at: string | null;
  description?: string;
  profile_summary?: {
    detected_stack: string[];
    project_type: string;
    risk_level: string;
    build_commands: string[];
    test_commands: string[];
  };
}

export interface QualityReportStatus {
  path: string;
  exists: boolean;
  valid?: boolean;
  status?: 'pass' | 'fail';
}

export interface QualityReports {
  aduId: string;
  contract: QualityReportStatus;
  codeReview: QualityReportStatus;
  acceptanceReview: QualityReportStatus;
}

export type ReviewGateStatus = {
  review_id: string;
  adu_id: string;
  gate: 'analysis' | 'design';
  state: 'analysis_review' | 'design_review';
  status: 'pending' | 'approved' | 'rework_requested';
  artifact_paths: string[];
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  approved_by: string | null;
  comment: string | null;
  approved_hashes: Record<string, string>;
};

export type EditableArtifact = {
  kind: 'analysis' | 'design';
  path: string;
  title: string;
  exists: boolean;
  editable: boolean;
  lastModifiedAt: string | null;
  bytes: number;
  sha256: string | null;
};

export interface AgentFactoryAgentView {
  id: string;
  description: string;
  prompt: string;
  worktree: boolean;
  hermes_args: string[];
  total_runs: number;
  success_runs: number;
  failed_runs: number;
  unstructured_runs: number;
  latest_run: AgentFactoryRun | null;
  active_adu_ids: string[];
  status: 'idle' | 'active' | 'failed' | 'stale';
}

export interface AgentFactoryDashboard {
  generated_at: string;
  workspace: string;
  registry_valid: boolean;
  summary: {
    total_adus: number;
    active_adus: number;
    evidenced_adus: number;
    human_gate_adus: number;
    total_runs: number;
    success_runs: number;
    failed_runs: number;
    unstructured_runs: number;
    missing_artifacts: number;
  };
  adus: AgentFactoryAduView[];
  agents: AgentFactoryAgentView[];
  recent_runs: AgentFactoryRun[];
}

export interface CreateProjectAduInput {
  aduId?: string;
  title: string;
  goal: string;
  risk?: string;
  targetLevel?: string;
  preferredReadPaths?: string[];
  preferredWritePaths?: string[];
  requiredCommands?: string[];
  analysisReviewRequired?: boolean;
  designReviewRequired?: boolean;
  manualEvidenceMode?: boolean;
}

export type AgentFactoryIntakeDraftStatus =
  | 'created'
  | 'generating'
  | 'draft_ready'
  | 'generation_failed'
  | 'registered'
  | 'discarded';

export interface AgentFactoryIntakeSourceFile {
  file_id: string;
  filename: string;
  media_type: 'text/plain' | 'text/markdown' | 'application/json';
  relative_path: string;
  bytes: number;
  truncated: boolean;
  sha256: string;
}

export interface AgentFactoryIntakeRawInput {
  raw_text: string;
  user_hints?: string;
  requirement_type: 'feature' | 'bugfix' | 'test' | 'docs' | 'refactor' | 'unknown';
  files: AgentFactoryIntakeSourceFile[];
}

export interface AgentFactoryAduDraft {
  draft_id: string;
  project_id: string;
  status: AgentFactoryIntakeDraftStatus;
  confidence: 'high' | 'medium' | 'low';
  aduId?: string;
  title: string;
  goal: string;
  risk: 'low' | 'medium' | 'high';
  targetLevel: 'mvp' | 'production';
  preferredReadPaths: string[];
  preferredWritePaths: string[];
  requiredCommands: string[];
  analysisReviewRequired: boolean;
  designReviewRequired: boolean;
  manualEvidenceMode: boolean;
  scope: {
    in_scope: string[];
    out_of_scope: string[];
  };
  risks: string[];
  questions: string[];
  split_suggestions: Array<{
    title: string;
    reason: string;
    suggested_goal: string;
  }>;
  source_summary: string;
  created_at: string;
  updated_at: string;
  registered_adu_id?: string;
  error?: string;
}


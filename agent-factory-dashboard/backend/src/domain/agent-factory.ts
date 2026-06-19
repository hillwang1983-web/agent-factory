/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
export type AgentFactoryAduState =
  | 'created'
  | 'analysis_review'
  | 'analyzed'
  | 'contexted'
  | 'design_review'
  | 'designed'
  | 'contracted'
  | 'test_red'
  | 'implemented'
  | 'code_reviewed'
  | 'code_rework'
  | 'build_rework'
  | 'debugged'
  | 'acceptance_reviewed'
  | 'acceptance_rework'
  | 'evidenced'
  | 'mvp_ready'
  | 'human_gate'
  | string;

export interface AgentFactoryCommandPolicy {
  mode: 'allowlist';
  allowed_commands: string[];
  blocked_command_patterns: string[];
}

export interface AgentFactoryReviewPolicy {
  analysis_review_required: boolean;
  design_review_required: boolean;
}

export interface AgentFactoryAdu {
  id: string;
  project_id?: string;
  project_name?: string;
  repo_path?: string;
  artifact_root?: string;
  profile_path?: string;
  knowledge_dir?: string;
  title: string;
  goal: string;
  state: AgentFactoryAduState;
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
  pre_gate_state?: string;
  language?: string;
  clarifications?: AgentFactoryDraftQuestionAnswer[];
  source_summary?: string;
  gate_type?: string;
  write_path_policy?: {
    mode: 'strict_with_expansion' | string;
    auto_approve_derived: boolean;
    human_approval_required_for_medium_risk: boolean;
    max_expansion_paths_per_request: number;
  };
  write_path_expansions?: Array<{
    request_id: string;
    source_agent: string;
    requested_paths: string[];
    approved_paths: string[];
    decision: 'auto_approved' | 'pending_human_approval' | 'approved' | 'rejected' | 'blocked';
    reason: string;
    created_at: string;
    updated_at: string;
  }>;
  review_policy?: AgentFactoryReviewPolicy;
  command_policy?: AgentFactoryCommandPolicy;
  created_at?: string;
  updated_at?: string;
  review_counters?: {
    code_review_failures: number;
    buildfix_failures?: number;
    acceptance_review_failures: number;
  };
  review_limits?: {
    max_code_review_failures: number;
    max_buildfix_failures?: number;
    max_acceptance_review_failures: number;
  };
  pending_path_requests?: string[];
  pending_design_write_paths?: string[];
  parent_epic_id?: string;
  depends_on?: string[];
  scope?: string;
  integration_role?: string;
  epic_sequence?: number;
  rework_plan_path?: string;
  token_summary?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    agentBreakdown: Record<string, {
      inputTokens: number;
      outputTokens: number;
      status: string;
    }>;
  };
  clarification_questions?: Array<{
    id: string;
    question: string;
    blocking: boolean;
    status: 'pending' | 'answered' | 'deferred';
    answer?: string | null;
    answered_at?: string | null;
  }>;
}


export interface AgentFactoryAgentConfig {
  description: string;
  prompt: string;
  worktree: boolean;
  hermes_args: string[];
}

export interface AgentFactoryRun {
  timestamp: string;
  adu_id: string;
  agent: string;
  returncode: number;
  effective_returncode?: number;
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
  kind: 'context' | 'contract' | 'contract-notes' | 'validation' | 'run-log' | 'evidence' | 'stdout' | 'stderr' | 'prompt' | 'other';
  exists: boolean;
  size_bytes?: number;
  modified_at?: string;
}

export interface AgentFactoryWorkflowStep {
  state: AgentFactoryAduState;
  label: string;
  status: 'complete' | 'current' | 'pending' | 'blocked' | 'failed';
  agent?: string | null;
  run_timestamp?: string;
  result?: string;
}

export interface AgentFactoryAduView extends AgentFactoryAdu {
  next_agent: string | null;
  latest_run: AgentFactoryRun | null;
  runs: AgentFactoryRun[];
  workflow: AgentFactoryWorkflowStep[];
  artifact_status: AgentFactoryArtifact[];
  health: {
    status: 'healthy' | 'active' | 'blocked' | 'stale' | 'failed' | 'running';
    reasons: string[];
  };
  display_status: {
    kind: 'completed' | 'running' | 'blocked' | 'failed' | 'active' | 'stale' | 'canceled';
    label: string;
    reason: string;
  };
}

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

export interface AgentFactoryReview {
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
}

export interface AgentFactoryArtifactEdit {
  edit_id: string;
  adu_id: string;
  gate: 'analysis' | 'design';
  artifact_path: string;
  editor: string;
  edited_at: string;
  change_reason: string;
  previous_sha256: string;
  new_sha256: string;
  previous_bytes: number;
  new_bytes: number;
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
  clarifications?: AgentFactoryDraftQuestionAnswer[];
  sourceSummary?: string;
}

export type AgentFactoryDraftQuestionAnswerStatus =
  | 'unanswered'
  | 'answered'
  | 'defer_to_requirement_analyst'
  | 'out_of_scope';

export type AgentFactoryDraftQuestionAnswerImpact =
  | 'scope'
  | 'acceptance_criteria'
  | 'design'
  | 'implementation'
  | 'test'
  | 'unknown';

export interface AgentFactoryDraftQuestionAnswer {
  question: string;
  answer: string;
  status: AgentFactoryDraftQuestionAnswerStatus;
  impact: AgentFactoryDraftQuestionAnswerImpact;
  updated_at?: string;
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
  question_answers?: AgentFactoryDraftQuestionAnswer[];
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

// ── Phase 3: Epic ──

export type AgentFactoryEpicState =
  | 'created'
  | 'flow_designed'
  | 'split_decision'
  | 'single_adu_selected'
  | 'split_required'
  | 'epic_planned'
  | 'child_adus_created'
  | 'child_adus_running'
  | 'child_adus_blocked'
  | 'child_adus_evidenced'
  | 'epic_acceptance'
  | 'epic_evidenced'
  | 'epic_failed'
  | 'human_gate'
  | 'canceled';

export interface AgentFactoryEpicDependency {
  from: string;
  to: string;
  reason: string;
}

export interface AgentFactoryEpic {
  id: string;
  project_id: string;
  project_name?: string;
  repo_path: string;
  title: string;
  source_requirement: string;
  state: AgentFactoryEpicState;
  risk: 'low' | 'medium' | 'high' | string;
  target_level: 'mvp' | 'production' | string;
  language: string;
  system_flow_path?: string;
  split_plan_path?: string;
  child_adus: string[];
  dependencies: AgentFactoryEpicDependency[];
  acceptance_path?: string;
  summary?: {
    total_child_adus: number;
    evidenced_child_adus: number;
    blocked_child_adus: number;
    running_child_adus: number;
  };
  clarifications?: any[];
  created_at: string;
  updated_at: string;
}

export interface CreateEpicInput {
  title: string;
  source_requirement: string;
  risk?: string;
  target_level?: string;
  language?: string;
  clarifications?: any[];
}

export interface AgentFactoryEpicView extends AgentFactoryEpic {
  child_adu_views?: AgentFactoryAduView[];
  next_agent: string | null;
  health: {
    status: 'healthy' | 'active' | 'blocked' | 'stale' | 'failed' | 'running';
    reasons: string[];
  };
  progress: {
    current_phase: 'flow' | 'split' | 'child_adus' | 'epic_acceptance' | 'completed' | 'failed';
    completed_phases: string[];
    current_agent: string | null;
    next_action: string | null;
    child_summary: {
      total: number;
      evidenced: number;
      blocked: number;
      running: number;
    };
  };
}

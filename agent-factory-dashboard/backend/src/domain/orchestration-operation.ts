export type OrchestrationOperationStatus =
  | 'queued'
  | 'spawning'
  | 'running'
  | 'waiting_human'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface OrchestrationOperationEvent {
  event_id: string;
  operation_id: string;
  scope: 'adu' | 'epic' | 'project' | 'intake';
  target_id: string;
  type: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  payload: Record<string, any>;
  created_at: string;
  stream?: 'stdout' | 'stderr' | 'system';
}

export interface OrchestrationOperationSpawnInfo {
  pid?: number;
  command?: string;
  cwd?: string;
}

export interface OrchestrationOperation {
  operation_id: string;
  scope: 'adu' | 'epic' | 'project' | 'intake';
  target_id: string;
  epic_id?: string | null;
  project_id: string;
  action: 'start' | 'continue' | 'step' | 'pause' | 'cancel' | 'materialize_child_adus' | 'approve_gate' | 'reject_gate';
  mode: 'auto' | 'step' | 'manual' | 'start' | 'continue' | 'pause' | 'cancel' | 'materialize' | 'materialize_child_adus';
  status: OrchestrationOperationStatus;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  spawn?: OrchestrationOperationSpawnInfo | null;
  current_agent?: string | null;
  current_state?: string | null;
  result?: 'success' | 'failed' | 'human_gate' | 'no_op' | null;
  error?: string | null;
  last_progress_at?: string | null;
  termination_reason?: string | null;
  prompt_bytes?: number | null;
  estimated_input_tokens?: number | null;

  // Compatibility fields
  id?: string;
  targetType?: 'adu' | 'epic';
  targetId?: string;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  finalState?: string;
  events?: OrchestrationOperationEvent[];
}

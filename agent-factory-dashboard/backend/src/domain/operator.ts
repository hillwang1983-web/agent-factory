export type OperatorTargetType = 'project' | 'draft' | 'adu' | 'epic' | 'human_gate' | 'operation';

export interface OperatorTargetRef {
  type: OperatorTargetType;
  id: string;
  project_id?: string;
}

export type OperatorActionType =
  | 'create_draft'
  | 'answer_clarifications'
  | 'register_adu'
  | 'create_epic'
  | 'start'
  | 'continue_auto'
  | 'step'
  | 'pause'
  | 'cancel'
  | 'approve_review'
  | 'request_rework'
  | 'approve_write_path'
  | 'reject_write_path'
  | 'submit_runtime_evidence'
  | 'grant_environment_waiver'
  | 'materialize_child_adus'
  | 'open_child_adu';

export interface OperatorAction {
  id: string;
  target: OperatorTargetRef;
  action: OperatorActionType;
  requested_by: 'human' | 'codex' | 'system';
  idempotency_key: string;
  payload?: Record<string, any>;
  created_at: string;
}

export type OperatorActionPriority = 'required' | 'recommended' | 'optional' | 'blocked';

export interface OperatorNextAction {
  target: OperatorTargetRef;
  state: string;
  recommended_action: OperatorActionType | null;
  priority: OperatorActionPriority;
  reason: string;
  blocking_reasons: string[];
  required_inputs: Array<{
    key: string;
    label: string;
    type: 'text' | 'markdown' | 'choice' | 'file' | 'boolean';
    required: boolean;
  }>;
  safe_to_auto_continue: boolean;
  estimated_risk: 'low' | 'medium' | 'high';
}

export interface OperatorAuditLog {
  id: string;
  timestamp: string;
  target: OperatorTargetRef;
  action: OperatorActionType;
  requested_by: string;
  status: 'success' | 'failed';
  details?: string;
}

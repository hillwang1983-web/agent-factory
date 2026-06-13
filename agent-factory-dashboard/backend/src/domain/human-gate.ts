export type HumanGateType =
  | 'analysis_review'
  | 'design_review'
  | 'clarification_required'
  | 'write_path_expansion'
  | 'environment_verification_required'
  | 'acceptance_waiver'
  | 'command_policy_exception'
  | 'token_budget_approval'
  | 'manual_intervention';

export type HumanGateStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'rework_requested'
  | 'waived'
  | 'resolved'
  | 'canceled';

export interface HumanGate {
  gate_id: string;
  scope: 'adu' | 'epic' | 'project' | 'intake';
  target_id: string;
  epic_id?: string | null;
  project_id: string;
  gate_type: HumanGateType;
  status: HumanGateStatus;
  title: string;
  reason: string;
  source_agent: string;
  source_run_id?: string | null;
  pre_gate_state?: string | null;
  affected_assertions?: string[];
  available_actions: ('submit_runtime_result' | 'approve_waiver' | 'request_rework' | 'approve' | 'reject' | 'resolve' | 'cancel')[];
  created_at: string;
  resolved_at?: string | null;
  resolution?: any;
}

export type OperatorOverrideAction = 'approve_command_policy' | 'approve_environment_waiver';

export interface OperatorOverride {
  adu_id: string;
  action: OperatorOverrideAction;
  approved_by: string;
  override_notes: string;
  timestamp: string;
  payload?: Record<string, any>;
}

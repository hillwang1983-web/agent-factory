export type OperatorOverrideReason =
  | 'agent_declaration_mismatch'
  | 'validator_false_negative'
  | 'environment_verified'
  | 'manual_evidence_accepted';

export type OperatorOverrideOperation =
  | 'accept_validator_result'
  | 'amend_file_declaration';

export interface OperatorOverrideValidator {
  command: string;
  exit_code: number;
  output: string;
}

export interface OperatorOverride {
  override_id: string;
  adu_id: string;
  run_timestamp: string;
  operation: OperatorOverrideOperation;
  from_result: string;
  to_result: 'success';
  from_state: string;
  to_state: string;
  reason_code?: OperatorOverrideReason;
  comment: string;
  validator?: OperatorOverrideValidator;
  amended_changed_files?: string[];
  actor: string;
  created_at: string;
}

export interface AmendFileDeclarationInput {
  operation: 'amend_file_declaration';
  changed_files: string[];
  comment: string;
}

export const OPERATOR_OVERRIDE_REASONS: OperatorOverrideReason[] = [
  'agent_declaration_mismatch',
  'validator_false_negative',
  'environment_verified',
  'manual_evidence_accepted',
];

export const ALLOWED_TERMINAL_STATE_BY_AGENT: Record<string, string> = {
  'developer': 'implemented',
  'code-reviewer': 'code_reviewed',
  'buildfix-debugger': 'debugged',
  'acceptance-reviewer': 'acceptance_reviewed',
  'evidence': 'evidenced',
};

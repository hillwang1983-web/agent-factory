export interface AssertionEvidenceItem {
  type: 'prepared_script' | 'executed_script' | 'curl_output' | 'waiver' | 'run_record' | 'other';
  path?: string;
  waiver_id?: string;
  status?: string;
}

export type AssertionEvidenceStatus =
  | 'pass'
  | 'fail'
  | 'not_verified'
  | 'pending_environment_verification'
  | 'waived'
  | 'not_applicable';

export interface AssertionEvidence {
  assertion_id: string;
  status: AssertionEvidenceStatus;
  verification_type: 'runtime' | 'static';
  required_evidence: string;
  evidence_items: AssertionEvidenceItem[];
  notes?: string;
}

export interface EvidenceMatrix {
  adu_id: string;
  overall_status: 'pass' | 'fail' | 'pending_environment_verification' | 'waived';
  assertion_evidence: AssertionEvidence[];
}

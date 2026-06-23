import fs from 'fs';
import path from 'path';
import { loadAppConfig } from '../config';
import { EvidenceMatrix, AssertionEvidence, AssertionEvidenceItem, AssertionEvidenceStatus } from '../domain/evidence-governance';

export class EvidenceGovernanceService {
  private static instance: EvidenceGovernanceService;

  private constructor() {}

  public static getInstance(): EvidenceGovernanceService {
    if (!EvidenceGovernanceService.instance) {
      EvidenceGovernanceService.instance = new EvidenceGovernanceService();
    }
    return EvidenceGovernanceService.instance;
  }

  private getRegistryDir(): string {
    const config = loadAppConfig();
    return path.join(config.workspaceRoot, '.ai-agent', 'registry');
  }

  private getAduRepoRoot(aduId: string): string {
    const config = loadAppConfig();
    try {
      const aduJsonFile = path.join(this.getRegistryDir(), 'adu.json');
      if (fs.existsSync(aduJsonFile)) {
        const adus = JSON.parse(fs.readFileSync(aduJsonFile, 'utf-8')).adus || [];
        const adu = adus.find((a: any) => a.id === aduId);
        if (adu) {
          if (adu.repo_path) {
            return adu.repo_path;
          }
          if (adu.project_id) {
            const projectsFile = config.projectsRegistryPath;
            if (fs.existsSync(projectsFile)) {
              const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf-8')).projects || [];
              const project = projects.find((p: any) => p.project_id === adu.project_id);
              if (project && project.repo_path) {
                return project.repo_path;
              }
            }
          }
        }
      }
    } catch (_) {}
    return config.workspaceRoot;
  }

  private getContractsDir(repoRoot: string): string {
    return path.join(repoRoot, '.ai-agent', 'contracts');
  }

  private getEvidenceDir(repoRoot: string): string {
    return path.join(repoRoot, '.ai-agent', 'evidence');
  }

  private readWaiversForAdu(aduId: string): any[] {
    const file = path.join(this.getRegistryDir(), 'evidence-waivers.json');
    if (!fs.existsSync(file)) return [];
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(content);
      const waivers = parsed.waivers || [];
      return waivers.filter((w: any) => w.adu_id === aduId);
    } catch (_) {
      return [];
    }
  }

  async buildEvidenceMatrix(aduId: string): Promise<EvidenceMatrix> {
    const repoRoot = this.getAduRepoRoot(aduId);
    const contractPath = path.join(this.getContractsDir(repoRoot), `${aduId}.json`);
    const evidencePath = path.join(this.getEvidenceDir(repoRoot), `${aduId}.json`);


    let assertions: any[] = [];
    let contract: any = {};

    // 1. Read Contract file to get assertions
    if (fs.existsSync(contractPath)) {
      try {
        contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));
        if (contract.acceptance_assertions) {
          assertions = contract.acceptance_assertions;
          if (contract.negative_assertions) {
            assertions = assertions.concat(contract.negative_assertions.map((n: any) => ({
              ...n,
              verification_type: 'manual_review'
            })));
          }
        } else if (contract.acceptance_criteria) {
          assertions = contract.acceptance_criteria.map((ac: any) => ({
            id: ac.id,
            title: ac.title,
            requirement: ac.expected,
            verification_type: (ac.title.toLowerCase().includes('run') || ac.method?.toLowerCase().includes('post') || ac.method?.toLowerCase().includes('get') || ac.method?.toLowerCase().includes('inspect')) ? 'runtime' : 'static',
            expected_evidence: [ac.expected],
            must_pass: true
          }));
        } else if (contract.acceptance) {
          assertions = contract.acceptance.map((acc: string, index: number) => ({
            id: `A-${index + 1}`,
            title: `Acceptance Criteria ${index + 1}`,
            requirement: acc,
            verification_type: 'static',
            expected_evidence: [acc],
            must_pass: true
          }));
        }
      } catch (_) {}
    }

    // 2. Read Evidence file if it exists
    let evidenceData: any = null;
    if (fs.existsSync(evidencePath)) {
      try {
        evidenceData = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
      } catch (_) {}
    }

    // Read Acceptance Review report if it exists
    const acceptancePath = path.join(repoRoot, '.ai-agent', 'acceptance', `${aduId}-acceptance-review.json`);
    let acceptanceData: any = null;
    if (fs.existsSync(acceptancePath)) {
      try {
        acceptanceData = JSON.parse(fs.readFileSync(acceptancePath, 'utf-8'));
      } catch (_) {}
    }

    // 3. Read active waivers for the ADU
    const aduWaivers = this.readWaiversForAdu(aduId);

    // 4. Read ADU details to inspect manual runtime execution logs
    let aduRuntimeRecords: any[] = [];
    try {
      const aduJsonFile = path.join(this.getRegistryDir(), 'adu.json');
      if (fs.existsSync(aduJsonFile)) {
        const adus = JSON.parse(fs.readFileSync(aduJsonFile, 'utf-8')).adus || [];
        const adu = adus.find((a: any) => a.id === aduId);
        if (adu && adu.runtime_evidence_records) {
          aduRuntimeRecords = adu.runtime_evidence_records;
        }
      }
    } catch (_) {}

    const assertionEvidences: AssertionEvidence[] = [];
    let overallStatus: EvidenceMatrix['overall_status'] = 'pass';
    let hasWaivers = false;
    let hasPendingVerification = false;

    // 5. Evaluate status for each assertion
    for (const ass of assertions) {
      const assertionId = ass.id || ass.assertion_id;
      const verificationType = ass.verification_type || 'static';
      const isRuntime = ['automated_test', 'runtime', 'scripted', 'curl'].includes(verificationType);
      const mustPass = ass.must_pass !== false;

      // Find matching waiver
      let waiver = null;
      try {
        const gatesFile = path.join(this.getRegistryDir(), 'human-gates.json');
        let gatesData = [];
        if (fs.existsSync(gatesFile)) {
          gatesData = JSON.parse(fs.readFileSync(gatesFile, 'utf-8')).gates || [];
        }
        waiver = aduWaivers.find(w => {
          if (!w.assertion_ids || !w.assertion_ids.includes(assertionId) || w.status !== 'approved' || !w.gate_id || !w.approved_by || !w.reason || !w.created_at) {
            return false;
          }
          const gate = gatesData.find((g: any) => g.gate_id === w.gate_id);
          if (!gate || gate.target_id !== aduId) return false;

          // P1 Waiver未绑定受影响断言
          if (!['approved', 'resolved', 'waived'].includes(gate.status)) return false;
          if (gate.gate_type !== 'environment_verification_required') return false;

          const gateAssertions = gate.affected_assertions || [];
          if (!w.assertion_ids.every((a: string) => gateAssertions.includes(a))) return false;

          return true;
        });
      } catch (_) {}

      let status: AssertionEvidenceStatus = 'not_verified';
      const evidenceItems: AssertionEvidenceItem[] = [];

      if (waiver) {
        status = 'waived';
        hasWaivers = true;
        evidenceItems.push({
          type: 'waiver',
          waiver_id: waiver.waiver_id,
          status: 'verified'
        });
      } else {
        let evidenceFound = false;

        const assReqs = (contract.evidence_requirements || []).filter((r: any) => r.assertion_id === assertionId || (r.assertion_ids || []).includes(assertionId));

        const is_valid_static = (ev_val: any) => {
          if (!ev_val || typeof ev_val !== 'object') return false;
          if (ev_val.status === 'failed' || ev_val.status === 'fail') return false;
          if (assReqs.length > 0) return true;

          const status = ev_val.status;
          if (status !== 'passed' && status !== 'success' && status !== 'pass' && status !== 'verified') return false;
          const hasNotes = typeof ev_val.reviewer_notes === 'string' && ev_val.reviewer_notes.trim().length > 0;
          const hasPath = typeof ev_val.artifact_path === 'string' && ev_val.artifact_path.trim().length > 0;
          const hasLegacyPath = typeof ev_val.path === 'string' && ev_val.path.trim().length > 0;
          const hasSummaryPath = typeof ev_val.summary_path === 'string' && ev_val.summary_path.trim().length > 0;
          const hasHash = typeof ev_val.hash === 'string' && ev_val.hash.trim().length > 0;
          const hasUrl = typeof ev_val.evidence_url === 'string' && ev_val.evidence_url.trim().length > 0;
          return hasNotes || hasPath || hasLegacyPath || hasSummaryPath || hasHash || hasUrl;
        };

        const check_required_fields = () => {
          for (const req of assReqs) {
            const artifact = req.artifact || '';
            if (artifact.endsWith('.json') && Array.isArray(req.required_fields)) {
              for (const fieldPath of req.required_fields) {
                let parts = fieldPath.split(/[\.\[\]]/).filter(Boolean);
                let curr = evidenceData;
                let found = true;
                for (const part of parts) {
                  if (curr && typeof curr === 'object' && part in curr) {
                    curr = curr[part];
                  } else {
                    found = false;
                    break;
                  }
                }
                if (!found || curr === null || curr === undefined || curr === '' || (typeof curr === 'object' && Object.keys(curr).length === 0)) {
                  return false;
                }
              }
            }
          }
          return true;
        };

        if (!isRuntime) {
          // Static assertions: acceptance report status pass is sufficient
          if (acceptanceData && (acceptanceData.assertion_results || acceptanceData.negative_assertion_results)) {
            const results = [
              ...(acceptanceData.assertion_results || []),
              ...(acceptanceData.negative_assertion_results || [])
            ];
            const match = results.find((r: any) => (r.assertion_id || r.id) === assertionId);
            if (match && (match.status === 'pass' || match.status === 'waived')) {
              if (check_required_fields()) {
                evidenceFound = true;
                evidenceItems.push({
                  type: 'run_record',
                  path: acceptancePath,
                  status: match.status === 'waived' ? 'waived' : 'verified'
                });
              }
            }
          }

          // Static assertions: evidence.json match is sufficient
          if (evidenceData && evidenceData.evidence) {
            const matches = Object.entries(evidenceData.evidence).filter(([key, val]: [string, any]) => {
              return key === assertionId || (val && typeof val === 'object' && val.assertion_id === assertionId);
            });
            for (const [key, val] of matches) {
              if (is_valid_static(val) && check_required_fields()) {
                evidenceFound = true;
                evidenceItems.push({
                  type: 'run_record',
                  path: (val as any).artifact_path || (val as any).path || evidencePath,
                  status: 'verified'
                });
                break;
              }
            }
          }

          if (!evidenceFound && evidenceData && evidenceData.negative_assertions) {
            const matches = Object.entries(evidenceData.negative_assertions).filter(([key, val]: [string, any]) => {
              return key === assertionId || (val && typeof val === 'object' && val.assertion_id === assertionId);
            });
            for (const [key, val] of matches) {
              if (is_valid_static(val) && check_required_fields()) {
                evidenceFound = true;
                evidenceItems.push({
                  type: 'run_record',
                  path: (val as any).artifact_path || (val as any).path || evidencePath,
                  status: 'verified'
                });
                break;
              }
            }
          }

          // Static assertions: assertions dict fallback
          if (!evidenceFound && evidenceData && evidenceData.assertions) {
            const val = evidenceData.assertions[assertionId];
            if (is_valid_static(val) && check_required_fields()) {
              evidenceFound = true;
              evidenceItems.push({
                type: 'run_record',
                path: evidencePath,
                status: 'verified'
              });
            }
          }
        } else {
          // Runtime assertions: MUST have concrete runtime evidence

          // 1. Check evidence.json matching entries for command, exitCode, output
          if (evidenceData && evidenceData.evidence) {
            const matches = Object.entries(evidenceData.evidence).filter(([key, val]: [string, any]) => {
              return key === assertionId || (val && typeof val === 'object' && val.assertion_id === assertionId);
            });
            for (const [key, val] of matches) {
              if (val && typeof val === 'object') {
                const valAny = val as any;
                const sub = valAny.script_result || valAny.curl_output || valAny.executed_script || valAny;
                const cmdVal = sub.command || sub.script;
                const outVal = sub.output || sub.stdout;
                const codeVal = sub.exitCode !== undefined ? sub.exitCode : sub.exit_code;

                const hasCmd = typeof cmdVal === 'string' && cmdVal.trim().length > 0;
                const hasCode = typeof codeVal === 'number' && codeVal === 0;
                const hasOut = typeof outVal === 'string' && outVal.trim().length > 0;

                if (hasCmd && hasCode && hasOut) {
                  evidenceFound = true;
                  evidenceItems.push({
                    type: 'run_record',
                    path: valAny.path || evidencePath,
                    status: 'verified'
                  });
                  break;
                }
              }
            }
          }

          if (!evidenceFound && evidenceData && evidenceData.assertions) {
            const val = evidenceData.assertions[assertionId];
            if (val && typeof val === 'object') {
              const cmdVal = val.command;
              const outVal = val.observed_result || val.output;
              const codeVal = val.exitCode !== undefined ? val.exitCode : val.exit_code;

              const hasCmd = typeof cmdVal === 'string' && cmdVal.trim().length > 0;
              const hasCode = typeof codeVal === 'number' && codeVal === 0;
              const hasOut = typeof outVal === 'string' && outVal.trim().length > 0;

              if (hasCmd && hasCode && hasOut) {
                evidenceFound = true;
                evidenceItems.push({
                  type: 'run_record',
                  path: evidencePath,
                  status: 'verified'
                });
              }
            }
          }

          // 2. Check runtime_evidence_records in adu.json
          if (!evidenceFound && aduRuntimeRecords.length > 0) {
            for (const r of aduRuntimeRecords) {
              const r_ids = r.assertion_ids;
              let matched = false;
              if (Array.isArray(r_ids)) {
                matched = r_ids.includes(assertionId);
              } else {
                matched = (r.assertion_id || r.assertionId || "") === assertionId;
              }
              if (!matched) continue;

              const codeVal = r.exitCode !== undefined ? r.exitCode : r.exit_code;
              const cmdVal = r.command;
              const outVal = r.output || r.stdout;

              const hasCmd = typeof cmdVal === 'string' && cmdVal.trim().length > 0;
              const hasOut = typeof outVal === 'string' && outVal.trim().length > 0;
              const hasCode = typeof codeVal === 'number' && codeVal === 0;

              if (hasCmd && hasOut && hasCode) {
                evidenceFound = true;
                evidenceItems.push({
                  type: 'run_record',
                  path: 'adu.json',
                  status: 'verified'
                });
                break;
              }
            }
          }
        }

        if (evidenceFound) {
          status = 'pass';
        } else {
          if (isRuntime) {
            status = 'pending_environment_verification';
            hasPendingVerification = true;
          } else {
            status = 'not_verified';
          }
        }
      }

      assertionEvidences.push({
        assertion_id: assertionId,
        status,
        verification_type: verificationType,
        required_evidence: ass.expected_evidence ? ass.expected_evidence.join(', ') : ass.requirement || '',
        evidence_items: evidenceItems,
        notes: waiver ? `Waived by operator: ${waiver.reason}` : ass.requirement
      });
    }

    // Determine overall status
    if (hasPendingVerification) {
      overallStatus = 'pending_environment_verification';
    } else if (assertionEvidences.some(a => a.status === 'fail' || a.status === 'not_verified')) {
      overallStatus = 'fail';
    } else if (hasWaivers) {
      overallStatus = 'waived';
    } else {
      overallStatus = 'pass';
    }

    return {
      adu_id: aduId,
      overall_status: overallStatus,
      assertion_evidence: assertionEvidences
    };
  }

  async validateEvidencePackage(aduId: string): Promise<{ success: boolean; error?: string }> {
    const matrix = await this.buildEvidenceMatrix(aduId);
    if (matrix.overall_status === 'fail') {
      return { success: false, error: 'One or more contract assertions are not verified.' };
    }
    if (matrix.overall_status === 'pending_environment_verification') {
      return { success: false, error: 'One or more runtime assertions require environment verification.' };
    }
    return { success: true };
  }
}

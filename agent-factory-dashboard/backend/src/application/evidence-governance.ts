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

    // 1. Read Contract file to get assertions
    if (fs.existsSync(contractPath)) {
      try {
        const contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));
        if (contract.acceptance_assertions) {
          assertions = contract.acceptance_assertions;
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
      const isRuntime = verificationType === 'runtime';
      const mustPass = ass.must_pass !== false;

      // Find matching waiver
      const waiver = aduWaivers.find(w => w.assertion_ids && w.assertion_ids.includes(assertionId));

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

        if (!isRuntime) {
          // Static assertions: acceptance report status pass is sufficient
          if (acceptanceData && (acceptanceData.assertion_results || acceptanceData.negative_assertion_results)) {
            const results = [
              ...(acceptanceData.assertion_results || []),
              ...(acceptanceData.negative_assertion_results || [])
            ];
            const match = results.find((r: any) => (r.assertion_id || r.id) === assertionId);
            if (match && (match.status === 'pass' || match.status === 'waived')) {
              evidenceFound = true;
              evidenceItems.push({
                type: 'run_record',
                path: acceptancePath,
                status: match.status === 'waived' ? 'waived' : 'verified'
              });
            }
          }

          // Static assertions: evidence.json match is sufficient
          if (evidenceData && evidenceData.evidence) {
            const matches = Object.entries(evidenceData.evidence).find(([key, val]: [string, any]) => {
              return key.toLowerCase().includes(assertionId.toLowerCase()) ||
                     (val && val.path && val.path.includes(assertionId)) ||
                     (val && val.status === 'verified' && key.toLowerCase().replace(/_/g, '').includes(ass.title.toLowerCase().replace(/\s/g, '')));
            });
            if (matches) {
              evidenceFound = true;
              evidenceItems.push({
                type: 'run_record',
                path: (matches[1] as any).path || (matches[1] as any).summary_path || evidencePath,
                status: 'verified'
              });
            }
          }

          // Static assertions: evidenceData.status success is sufficient
          if (evidenceData && evidenceData.status === 'success') {
            evidenceFound = true;
            evidenceItems.push({
              type: 'run_record',
              path: evidencePath,
              status: 'verified'
            });
          }
        } else {
          // Runtime assertions: MUST have concrete runtime evidence

          // 1. Check evidence.json matching entries for command, exitCode, output
          if (evidenceData && evidenceData.evidence) {
            const matches = Object.entries(evidenceData.evidence).filter(([key, val]: [string, any]) => {
              return key.toLowerCase().includes(assertionId.toLowerCase()) ||
                     (val && val.path && val.path.includes(assertionId)) ||
                     (val && val.assertion_id === assertionId);
            });
            for (const [key, val] of matches) {
              if (val && typeof val === 'object') {
                const valAny = val as any;
                const sub = valAny.script_result || valAny.curl_output || valAny.executed_script || valAny;
                const hasCmd = typeof sub.command === 'string' || typeof sub.script === 'string';
                const hasCode = sub.exitCode === 0 || sub.exit_code === 0 || sub.status === 'success';
                const hasOut = typeof sub.output === 'string' || typeof sub.stdout === 'string';
                if (hasCmd && hasCode && hasOut) {
                  evidenceFound = true;
                  evidenceItems.push({
                    type: 'run_record',
                    path: valAny.path || evidencePath,
                    status: 'verified'
                  });
                }
              }
            }
          }

          // 2. Check runtime_evidence_records in adu.json
          if (aduRuntimeRecords.length > 0) {
            const matchingRecords = aduRuntimeRecords.filter(r =>
              r.exitCode === 0 &&
              r.command && (
                r.command.includes(assertionId) ||
                (r.output && r.output.includes(assertionId)) ||
                r.assertion_id === assertionId ||
                r.assertionId === assertionId
              )
            );
            if (matchingRecords.length > 0) {
              evidenceFound = true;
              for (const r of matchingRecords) {
                evidenceItems.push({
                  type: 'executed_script',
                  path: r.command,
                  status: 'verified'
                });
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

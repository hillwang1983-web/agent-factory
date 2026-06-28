import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  ALLOWED_TERMINAL_STATE_BY_AGENT,
  OperatorOverride,
  OperatorOverrideReason,
  OPERATOR_OVERRIDE_REASONS,
} from '../domain/operator-override';
import { RegistryLock } from '../infrastructure/registry-lock';

import { OperatorOverrideOperation, AmendFileDeclarationInput } from '../domain/operator-override';

export interface ApplyOverrideInput {
  operation: 'accept_validator_result';
  to_result: 'success';
  to_state: string;
  reason_code: OperatorOverrideReason;
  comment: string;
}

export type OverrideInput = ApplyOverrideInput | AmendFileDeclarationInput;

interface OverrideSnapshot {
  aduState: string;
  agent: string;
  repoRoot: string;
  runDir: string;
  runResult: string;
  runOperatorOverrideId?: string;
  fileDeltaSha256?: string;
}

interface ValidatorResult {
  command: string;
  exitCode: number;
  output: string;
}

interface RegistryPaths {
  registryDir: string;
  aduJsonPath: string;
  runsJsonPath: string;
  overridesPath: string;
}

export class OperatorOverrideService {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    RegistryLock.setWorkspaceRoot(this.workspaceRoot);
  }

  private getRegistryPaths(): RegistryPaths {
    const registryDir = path.join(this.workspaceRoot, '.ai-agent', 'registry');
    return {
      registryDir,
      aduJsonPath: path.join(registryDir, 'adu.json'),
      runsJsonPath: path.join(registryDir, 'runs.json'),
      overridesPath: path.join(registryDir, 'operator-overrides.json'),
    };
  }

  private readJson(filePath: string, fallback?: unknown): any {
    if (!fs.existsSync(filePath)) {
      if (fallback !== undefined) return fallback;
      throw Object.assign(new Error(`Registry file not found: ${filePath}`), { status: 500 });
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  private findExistingOverride(
    overridesData: any,
    aduId: string,
    runTimestamp: string,
    operation: string,
  ): OperatorOverride | undefined {
    return (overridesData.overrides || []).find(
      (item: OperatorOverride) =>
        item.adu_id === aduId &&
        item.run_timestamp === runTimestamp &&
        item.operation === operation,
    );
  }

  private validateRequest(input: any): void {
    if (input.operation !== 'accept_validator_result' && input.operation !== 'amend_file_declaration') {
      throw Object.assign(new Error('Unsupported override operation'), { status: 400 });
    }
    if (!input.comment || input.comment.length < 10 || input.comment.length > 4000) {
      throw Object.assign(new Error('Comment must be 10-4000 characters'), { status: 400 });
    }
    if (input.operation === 'accept_validator_result') {
      if (input.to_result !== 'success') {
        throw Object.assign(new Error('to_result must be success'), { status: 400 });
      }
      if (!OPERATOR_OVERRIDE_REASONS.includes(input.reason_code)) {
        throw Object.assign(new Error(`Invalid reason_code: ${input.reason_code}`), { status: 400 });
      }
    } else if (input.operation === 'amend_file_declaration') {
      if (!Array.isArray(input.changed_files) || input.changed_files.length === 0) {
        throw Object.assign(new Error('changed_files must be a non-empty array'), { status: 400 });
      }
    }
  }

  private runValidator(args: string[], cwd: string): Promise<ValidatorResult> {
    return new Promise((resolve) => {
      execFile(
        'python3',
        args,
        {
          cwd,
          timeout: 60000,
          encoding: 'utf-8',
          maxBuffer: 20000,
        },
        (error, stdout, stderr) => {
          const output = `${stdout || ''}\n${stderr || ''}`.trim();
          if (!error) {
            resolve({
              command: `python3 ${args.join(' ')}`,
              exitCode: 0,
              output: output || '(no output)',
            });
            return;
          }
          const exitCode = typeof (error as any).code === 'number'
            ? (error as any).code
            : typeof (error as any).status === 'number'
              ? (error as any).status
              : 1;
          resolve({
            command: `python3 ${args.join(' ')}`,
            exitCode,
            output: output || error.message || 'Validator failed',
          });
        },
      );
    });
  }

  private async validateSnapshot(
    aduId: string,
    snapshot: OverrideSnapshot,
    paths: RegistryPaths,
  ): Promise<ValidatorResult> {
    const scriptsDir = path.join(this.workspaceRoot, 'scripts');
    const { agent, repoRoot, runDir } = snapshot;

    if (agent === 'buildfix-debugger') {
      if (!runDir) {
        throw Object.assign(new Error('No run directory for buildfix-debugger'), { status: 422 });
      }
      const verificationPath = path.join(runDir, 'verification-results.json');
      if (!fs.existsSync(verificationPath)) {
        throw Object.assign(new Error('verification-results.json not found'), { status: 422 });
      }
      let verification: any;
      try {
        verification = this.readJson(verificationPath);
      } catch (error: any) {
        throw Object.assign(
          new Error(`verification-results.json is invalid: ${error.message}`),
          { status: 422 },
        );
      }
      if (verification.adu_id !== aduId) {
        throw Object.assign(
          new Error(`verification-results.json adu_id mismatch: ${String(verification.adu_id)} !== ${aduId}`),
          { status: 422 },
        );
      }
      if (!Array.isArray(verification.commands) || verification.commands.length === 0) {
        throw Object.assign(new Error('verification-results.json has no commands'), { status: 422 });
      }
      const invalidCommands = verification.commands.filter(
        (command: any) =>
          !command ||
          typeof command.command !== 'string' ||
          command.command.trim() === '' ||
          typeof command.exit_code !== 'number' ||
          command.exit_code !== 0,
      );
      if (invalidCommands.length > 0) {
        throw Object.assign(
          new Error(`${invalidCommands.length} verification command(s) invalid or failed`),
          { status: 422 },
        );
      }
      return {
        command: `read ${verificationPath}`,
        exitCode: 0,
        output: `verification-results.json: all ${verification.commands.length} commands passed`,
      };
    }

    let args: string[];
    if (agent === 'code-reviewer') {
      const verificationPath = runDir && path.join(runDir, 'verification-results.json');
      if (!runDir || !verificationPath || !fs.existsSync(verificationPath)) {
        throw Object.assign(
          new Error('Code-reviewer requires run_dir with verification-results.json'),
          { status: 422 },
        );
      }
      args = [
        path.join(scriptsDir, 'validate_quality_report.py'),
        '--adu', aduId,
        '--kind', 'code-review',
        '--repo-root', repoRoot,
        '--run-dir', runDir,
      ];
    } else if (agent === 'acceptance-reviewer') {
      args = [
        path.join(scriptsDir, 'validate_quality_report.py'),
        '--adu', aduId,
        '--kind', 'acceptance',
        '--repo-root', repoRoot,
      ];
    } else if (agent === 'evidence') {
      args = [
        path.join(scriptsDir, 'validate_evidence_package.py'),
        '--adu', aduId,
        '--repo-root', repoRoot,
        '--registry-dir', paths.registryDir,
      ];
    } else {
      throw Object.assign(new Error(`No validator configured for agent ${agent}`), { status: 400 });
    }

    const result = await this.runValidator(args, repoRoot);
    if (result.exitCode !== 0) {
      throw Object.assign(
        new Error(`Validator failed (exit ${result.exitCode}): ${result.output.substring(0, 500)}`),
        { status: 422 },
      );
    }
    return result;
  }

  private writeJsonAtomically(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
      fs.renameSync(tempPath, filePath);
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  async applyOverride(
    aduId: string,
    runTimestamp: string,
    input: OverrideInput,
  ): Promise<OperatorOverride> {
    if (!/^[A-Za-z0-9_.-]+$/.test(aduId)) {
      throw Object.assign(new Error('Invalid aduId format'), { status: 400 });
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(runTimestamp)) {
      throw Object.assign(new Error('Invalid runTimestamp format'), { status: 400 });
    }
    this.validateRequest(input);
    const paths = this.getRegistryPaths();

    const phaseOne = await RegistryLock.runLocked(() => {
      const aduData = this.readJson(paths.aduJsonPath);
      const adu = (aduData.adus || []).find((item: any) => item.id === aduId);
      if (!adu) throw Object.assign(new Error(`ADU ${aduId} not found`), { status: 404 });

      const runsData = this.readJson(paths.runsJsonPath, { version: 1, runs: [] });
      const run = (runsData.runs || []).find(
        (item: any) => item.timestamp === runTimestamp && item.adu_id === aduId,
      );
      if (!run) throw Object.assign(new Error(`Run ${runTimestamp} not found`), { status: 404 });

      const overridesData = this.readJson(paths.overridesPath, { version: 1, overrides: [] });
      const existing = this.findExistingOverride(overridesData, aduId, runTimestamp, input.operation);
      if (existing) return { existing };
      if (run.result === 'success') {
        throw Object.assign(new Error('Run already succeeded'), { status: 409 });
      }

      if (input.operation === 'amend_file_declaration') {
        if (run.agent !== 'developer') {
          throw Object.assign(new Error('Amend file declaration only allowed for developer agent'), { status: 409 });
        }
        if (run.result !== 'failed') {
          throw Object.assign(new Error('Amend file declaration only allowed for failed runs'), { status: 409 });
        }
        const errCode = run.parsed_result?.error_code;
        if (errCode !== 'declared_changes_unverified') {
          throw Object.assign(new Error(`Amend file declaration only allowed for declared_changes_unverified error, got: ${errCode || 'none'}`), { status: 409 });
        }

        if (!run.file_delta_sha256) {
          throw Object.assign(new Error('Missing file delta SHA-256 hash in runs registry'), { status: 422 });
        }

        // Validate files against file-delta.json
        const repoRoot = path.resolve(adu.repo_path || this.workspaceRoot);
        const runDir = run.run_dir ? path.resolve(repoRoot, run.run_dir) : '';
        let actualDelta: Set<string> = new Set();
        if (runDir) {
          const deltaPath = path.join(runDir, 'file-delta.json');
          if (fs.existsSync(deltaPath)) {
            const fileBuffer = fs.readFileSync(deltaPath);
            const hashSum = crypto.createHash('sha256');
            hashSum.update(fileBuffer);
            const actualSha = hashSum.digest('hex');
            if (actualSha !== run.file_delta_sha256) {
              throw Object.assign(new Error('Inconsistent file delta snapshot (SHA-256 mismatch)'), { status: 409 });
            }

            try {
              const deltaData = JSON.parse(fs.readFileSync(deltaPath, 'utf-8'));
              const created = deltaData.created || [];
              const modified = deltaData.modified || [];
              const deleted = deltaData.deleted || [];
              actualDelta = new Set([...created, ...modified, ...deleted]);
            } catch (e) {}
          }
        }

        for (const file of input.changed_files) {
          if (!actualDelta.has(file)) {
            throw Object.assign(new Error(`Requested file is not in actual delta: ${file}`), { status: 422 });
          }
          if (!isAllowedByAdu(file, adu.allowed_write_paths || [])) {
            throw Object.assign(new Error(`File ${file} is not allowed by ADU write paths`), { status: 422 });
          }
        }
      } else {
        const expectedState = ALLOWED_TERMINAL_STATE_BY_AGENT[run.agent || ''];
        if (!expectedState) {
          throw Object.assign(new Error(`Agent ${run.agent || ''} does not support override`), { status: 400 });
        }
        if (input.to_state !== expectedState) {
          throw Object.assign(
            new Error(`to_state must be ${expectedState} for agent ${run.agent}, got ${input.to_state}`),
            { status: 400 },
          );
        }
      }

      const repoRoot = path.resolve(adu.repo_path || this.workspaceRoot);
      const runDir = run.run_dir ? path.resolve(repoRoot, run.run_dir) : '';
      const snapshot: OverrideSnapshot = {
        aduState: adu.state || '',
        agent: run.agent || '',
        repoRoot,
        runDir,
        runResult: run.result || 'failed',
        runOperatorOverrideId: run.operator_override_id,
        fileDeltaSha256: run.file_delta_sha256,
      };
      return { snapshot };
    });

    if ('existing' in phaseOne && phaseOne.existing) return phaseOne.existing;
    const snapshot = phaseOne.snapshot as OverrideSnapshot;

    let validator: ValidatorResult | undefined;
    if (input.operation === 'accept_validator_result') {
      validator = await this.validateSnapshot(aduId, snapshot, paths);
    }

    return RegistryLock.runLocked(() => {
      const aduData = this.readJson(paths.aduJsonPath);
      const runsData = this.readJson(paths.runsJsonPath, { version: 1, runs: [] });
      const overridesData = this.readJson(paths.overridesPath, { version: 1, overrides: [] });

      const existing = this.findExistingOverride(overridesData, aduId, runTimestamp, input.operation);
      if (existing) return existing;

      const adu = (aduData.adus || []).find((item: any) => item.id === aduId);
      const run = (runsData.runs || []).find(
        (item: any) => item.timestamp === runTimestamp && item.adu_id === aduId,
      );
      if (!adu || !run) {
        throw Object.assign(new Error('ADU or run disappeared during validation'), { status: 409 });
      }
      if (
        adu.state !== snapshot.aduState ||
        run.result !== snapshot.runResult ||
        run.operator_override_id !== snapshot.runOperatorOverrideId ||
        run.file_delta_sha256 !== snapshot.fileDeltaSha256
      ) {
        throw Object.assign(
          new Error('ADU or run changed during validation; retry the override'),
          { status: 409 },
        );
      }

      if (input.operation === 'amend_file_declaration') {
        if (!snapshot.fileDeltaSha256) {
          throw Object.assign(new Error('Missing file delta SHA-256 hash in override snapshot'), { status: 422 });
        }
        const deltaPath = path.join(snapshot.runDir, 'file-delta.json');
        if (!fs.existsSync(deltaPath)) {
          throw Object.assign(new Error('file-delta.json not found on disk'), { status: 409 });
        }
        const fileBuffer = fs.readFileSync(deltaPath);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        const actualSha = hashSum.digest('hex');
        if (actualSha !== snapshot.fileDeltaSha256) {
          throw Object.assign(new Error('Inconsistent file delta snapshot (SHA-256 mismatch before write)'), { status: 409 });
        }
      }

      const overrideId = `override-${aduId}-${Date.now()}`;
      const now = new Date().toISOString();

      let overrideRecord: OperatorOverride;
      if (input.operation === 'amend_file_declaration') {
        overrideRecord = {
          override_id: overrideId,
          adu_id: aduId,
          run_timestamp: runTimestamp,
          operation: 'amend_file_declaration',
          from_result: run.result || 'failed',
          to_result: 'success',
          from_state: adu.state || '',
          to_state: 'implemented',
          comment: input.comment,
          amended_changed_files: input.changed_files,
          actor: 'operator',
          created_at: now,
        };

        run.original_result = run.result;
        run.original_effective_returncode = run.effective_returncode;
        run.original_parsed_result = run.parsed_result;
        run.operator_override_id = overrideId;
        run.effective_returncode = 0;
        run.result = 'success';
        run.changed_files = input.changed_files;
        if (!run.parsed_result || typeof run.parsed_result !== 'object') run.parsed_result = {};
        run.parsed_result.changed_files = input.changed_files;
        run.parsed_result.result = 'success';
        run.parsed_result.operator_override = {
          override_id: overrideId,
          original_result: run.original_result,
          applied_at: now,
        };
        adu.state = 'implemented';
      } else {
        overrideRecord = {
          override_id: overrideId,
          adu_id: aduId,
          run_timestamp: runTimestamp,
          operation: 'accept_validator_result',
          from_result: run.result || 'failed',
          to_result: 'success',
          from_state: adu.state || '',
          to_state: input.to_state,
          reason_code: input.reason_code,
          comment: input.comment,
          validator: {
            command: validator!.command,
            exit_code: validator!.exitCode,
            output: validator!.output.substring(0, 20000),
          },
          actor: 'operator',
          created_at: now,
        };

        run.original_result = run.result;
        run.original_effective_returncode = run.effective_returncode;
        run.original_parsed_result = run.parsed_result;
        run.operator_override_id = overrideId;
        run.effective_returncode = 0;
        run.result = 'success';
        if (!run.parsed_result || typeof run.parsed_result !== 'object') run.parsed_result = {};
        run.parsed_result.operator_override = {
          override_id: overrideId,
          original_result: run.original_result,
          applied_at: now,
        };
        adu.state = input.to_state;
      }

      if (!Array.isArray(overridesData.overrides)) overridesData.overrides = [];
      overridesData.overrides.push(overrideRecord);

      this.writeJsonAtomically(paths.overridesPath, overridesData);
      this.writeJsonAtomically(paths.runsJsonPath, runsData);
      this.writeJsonAtomically(paths.aduJsonPath, aduData);
      return overrideRecord;
    });
  }

  async getOverrides(aduId: string): Promise<OperatorOverride[]> {
    const { overridesPath } = this.getRegistryPaths();
    const data = this.readJson(overridesPath, { version: 1, overrides: [] });
    return (data.overrides || []).filter((item: OperatorOverride) => item.adu_id === aduId);
  }
}

function isAllowedByAdu(file: string, allowedPaths: string[]): boolean {
  const normalized = normalizePath(file);
  for (const allowed of allowedPaths || []) {
    const allowedNorm = normalizePath(allowed);
    if (allowedNorm.endsWith('/')) {
      if (normalized.startsWith(allowedNorm)) return true;
    } else {
      if (normalized === allowedNorm) return true;
    }
  }
  return false;
}

function normalizePath(p: string): string {
  let res = p.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (res.startsWith('/')) res = res.substring(1);
  return res;
}

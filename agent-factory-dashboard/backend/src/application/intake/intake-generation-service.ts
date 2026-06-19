import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { validateIntakeOutput } from './intake-output-validator';
import { AgentFactoryError } from './intake-error';

export interface IntakeOperation {
  draft_id: string;
  project_id: string;
  status: 'queued' | 'generating' | 'validating' | 'draft_ready' | 'generation_failed' | 'canceled';
  pid: number | null;
  process_group_id: number | null;
  started_at: string | null;
  last_progress_at: string | null;
  soft_deadline_at: string | null;
  hard_deadline_at: string | null;
  finished_at: string | null;
  artifact_completed_at: string | null;
  termination_reason: string | null;
  error_code: string | null;
  error_message: string | null;
  title?: string | null;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM';
  }
}

export class IntakeGenerationService {
  private activeOperations = new Map<string, {
    child: ChildProcess;
    operation: IntakeOperation;
    softTimer?: NodeJS.Timeout;
    hardTimer?: NodeJS.Timeout;
    resolveList: (() => void)[];
    rejectList: ((err: any) => void)[];
  }>();

  constructor(
    private workspaceRoot: string,
    private getIntakeRegistryPath: () => Promise<string>,
    private getIntakeOperationsPath: () => string
  ) {}

  private isTerminal(status: string): boolean {
    return ['draft_ready', 'generation_failed', 'canceled'].includes(status);
  }

  // Compare-And-Set updates to keep states consistent
  private async updateStatus(
    draftId: string,
    nextStatus: 'queued' | 'generating' | 'validating' | 'draft_ready' | 'generation_failed' | 'canceled',
    updates: Partial<IntakeOperation> = {}
  ): Promise<IntakeOperation> {
    const regPath = await this.getIntakeRegistryPath();
    const opsPath = this.getIntakeOperationsPath();

    // 1. Read and update drafts registry
    const registry = JSON.parse(await fs.readFile(regPath, 'utf-8'));
    const dIndex = registry.drafts.findIndex((d: any) => d.draft_id === draftId);
    if (dIndex === -1) throw new Error(`Draft ${draftId} not found`);

    const currentDraft = registry.drafts[dIndex];
    if (currentDraft.status === 'draft_ready' && nextStatus !== 'draft_ready') {
      // draft_ready is protected and cannot be overwritten by late errors or timeouts
      return this.getOperationRecord(draftId);
    }

    if (this.isTerminal(currentDraft.status) && currentDraft.status !== nextStatus) {
      throw new Error(`IntakeStateConflictError: Cannot transition from ${currentDraft.status} to ${nextStatus}`);
    }

    currentDraft.status = nextStatus;
    if (updates.title) currentDraft.title = updates.title;
    if (updates.error_message) currentDraft.error = updates.error_message;
    currentDraft.updated_at = new Date().toISOString();
    await fs.writeFile(regPath, JSON.stringify(registry, null, 2), 'utf-8');

    // 2. Read and update operations registry
    let opsRegistry = { version: 1, operations: [] as IntakeOperation[] };
    try {
      if (existsSync(opsPath)) {
        opsRegistry = JSON.parse(await fs.readFile(opsPath, 'utf-8'));
      }
    } catch (e) {
      // ignore
    }

    let opIndex = opsRegistry.operations.findIndex((o: any) => o.draft_id === draftId);
    let opRecord: IntakeOperation;

    if (opIndex === -1) {
      opRecord = {
        draft_id: draftId,
        project_id: currentDraft.project_id,
        status: nextStatus,
        pid: null,
        process_group_id: null,
        started_at: new Date().toISOString(),
        last_progress_at: new Date().toISOString(),
        soft_deadline_at: null,
        hard_deadline_at: null,
        finished_at: null,
        artifact_completed_at: null,
        termination_reason: null,
        error_code: null,
        error_message: null,
      };
      opsRegistry.operations.push(opRecord as any);
    } else {
      opRecord = opsRegistry.operations[opIndex];
      opRecord.status = nextStatus;
    }

    Object.assign(opRecord, updates);
    if (this.isTerminal(nextStatus)) {
      opRecord.finished_at = new Date().toISOString();
    }
    await fs.writeFile(opsPath, JSON.stringify(opsRegistry, null, 2), 'utf-8');

    return opRecord;
  }

  private async getOperationRecord(draftId: string): Promise<IntakeOperation> {
    const opsPath = this.getIntakeOperationsPath();
    if (existsSync(opsPath)) {
      const opsRegistry = JSON.parse(await fs.readFile(opsPath, 'utf-8'));
      const op = opsRegistry.operations.find((o: any) => o.draft_id === draftId);
      if (op) return op;
    }
    // Fallback if not in operations but in drafts
    const regPath = await this.getIntakeRegistryPath();
    const registry = JSON.parse(await fs.readFile(regPath, 'utf-8'));
    const draft = registry.drafts.find((d: any) => d.draft_id === draftId);
    if (!draft) throw new Error(`Draft ${draftId} not found`);
    return {
      draft_id: draftId,
      project_id: draft.project_id,
      status: draft.status,
      pid: null,
      process_group_id: null,
      started_at: draft.created_at,
      last_progress_at: draft.updated_at,
      soft_deadline_at: null,
      hard_deadline_at: null,
      finished_at: this.isTerminal(draft.status) ? draft.updated_at : null,
      artifact_completed_at: null,
      termination_reason: null,
      error_code: draft.error ? 'INTAKE_AGENT_FAILED' : null,
      error_message: draft.error || null,
    };
  }

  async start(draftId: string): Promise<IntakeOperation> {
    // 1. Idempotent check
    const active = this.activeOperations.get(draftId);
    if (active) {
      return active.operation;
    }

    const regPath = await this.getIntakeRegistryPath();
    const registry = JSON.parse(await fs.readFile(regPath, 'utf-8'));
    const draft = registry.drafts.find((d: any) => d.draft_id === draftId);
    if (!draft) throw new Error(`Draft ${draftId} not found`);

    if (this.isTerminal(draft.status)) {
      return this.getOperationRecord(draftId);
    }

    // Update status to generating
    const operation = await this.updateStatus(draftId, 'generating', {
      started_at: new Date().toISOString(),
      last_progress_at: new Date().toISOString(),
    });

    const softTimeoutMs = parseInt(process.env.INTAKE_TIMEOUT_MS || '30000', 10);
    const hardTimeoutMs = parseInt(process.env.INTAKE_HARD_TIMEOUT_MS || '300000', 10);

    const softDeadline = new Date(Date.now() + softTimeoutMs).toISOString();
    const hardDeadline = new Date(Date.now() + hardTimeoutMs).toISOString();

    const scriptPath = path.join(this.workspaceRoot, 'scripts', 'hermes_agent_run.py');
    
    // Spawn with detached: true to start a new process group
    const child = spawn(
      'python3',
      [
        scriptPath,
        '--intake-draft', draftId,
        '--project', draft.project_id,
        '--repo', draft.repo_path,
        '--agent', 'adu-intake-agent'
      ],
      {
        cwd: this.workspaceRoot,
        detached: true
      }
    );

    operation.pid = child.pid || null;
    operation.process_group_id = child.pid || null; // detached process group id is pid
    operation.soft_deadline_at = softDeadline;
    operation.hard_deadline_at = hardDeadline;

    await this.updateStatus(draftId, 'generating', {
      pid: child.pid,
      process_group_id: child.pid,
      soft_deadline_at: softDeadline,
      hard_deadline_at: hardDeadline
    });

    let stderrBuf = '';
    child.stderr?.on('data', (chunk) => {
      stderrBuf += chunk.toString();
    });

    const resolveList: (() => void)[] = [];
    const rejectList: ((err: any) => void)[] = [];

    // Soft timeout timer (does not terminate process, just triggers resolve/reject list timeouts)
    const softTimer = setTimeout(() => {
      const err = new AgentFactoryError(
        'Intake soft timeout reached — draft generation timed out',
        'INTAKE_SOFT_TIMEOUT',
        202,
        { retryable: true, target_id: draftId }
      );
      while (rejectList.length > 0) {
        const rej = rejectList.shift();
        rej?.(err);
      }
    }, softTimeoutMs);

    // Hard timeout watchdog (SIGTERM -> SIGKILL)
    const hardTimer = setTimeout(() => {
      this.terminateProcessGroup(child.pid || 0, 'hard_timeout_exceeded');
    }, hardTimeoutMs);

    const handleFinish = async (code: number | null) => {
      clearTimeout(softTimer);
      clearTimeout(hardTimer);

      const op = this.activeOperations.get(draftId)?.operation || operation;
      if (this.isTerminal(op.status)) {
        this.activeOperations.delete(draftId);
        return;
      }

      // Read output paths
      const draftFilePath = path.join(draft.repo_path, draft.draft_path);
      const reportFilePath = path.join(draft.repo_path, draft.report_path);

      try {
        const { title } = await validateIntakeOutput(draft.repo_path, draftFilePath, reportFilePath);
        // Validated successfully
        await this.updateStatus(draftId, 'draft_ready', {
          title,
          artifact_completed_at: new Date().toISOString(),
        });
        // Notify anyone waiting
        while (resolveList.length > 0) {
          resolveList.shift()?.();
        }
      } catch (err: any) {
        // Output invalid or missing

        // If it was terminated by hard timeout AND output is missing/invalid, report INTAKE_HARD_TIMEOUT
        if (op.termination_reason === 'hard_timeout_exceeded') {
          const errSummary = 'Intake hard timeout exceeded — draft generation timed out';
          await this.updateStatus(draftId, 'generation_failed', {
            error_code: 'INTAKE_HARD_TIMEOUT',
            error_message: errSummary
          });
          const errObj = new AgentFactoryError(
            errSummary,
            'INTAKE_HARD_TIMEOUT',
            400,
            { retryable: false, target_id: draftId }
          );
          while (rejectList.length > 0) {
            rejectList.shift()?.(errObj);
          }
          return;
        }

        const errSummary = err.message || stderrBuf.trim().split('\n').pop()?.slice(0, 200) || 'Intake generation failed';
        await this.updateStatus(draftId, 'generation_failed', {
          error_code: err.error_code || 'INTAKE_OUTPUT_INVALID',
          error_message: errSummary
        });
        const errObj = new AgentFactoryError(
          errSummary,
          err.error_code || 'INTAKE_OUTPUT_INVALID',
          400,
          { retryable: false, target_id: draftId }
        );
        while (rejectList.length > 0) {
          rejectList.shift()?.(errObj);
        }
      } finally {
        this.activeOperations.delete(draftId);
      }
    };

    child.on('close', (code) => {
      handleFinish(code).catch((e) => console.error(`[IntakeGenerationService] close error for ${draftId}:`, e));
    });

    child.on('error', (err) => {
      console.error(`[IntakeGenerationService] child process error for ${draftId}:`, err);
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
      this.activeOperations.delete(draftId);

      this.updateStatus(draftId, 'generation_failed', {
        error_code: 'INTAKE_AGENT_FAILED',
        error_message: err.message
      }).catch((e) => console.error(`[IntakeGenerationService] status update error for ${draftId}:`, e));

      while (rejectList.length > 0) {
        rejectList.shift()?.(err);
      }
    });

    this.activeOperations.set(draftId, {
      child,
      operation,
      softTimer,
      hardTimer,
      resolveList,
      rejectList,
    });

    return operation;
  }

  private terminateProcessGroup(pid: number, reason: string) {
    if (!pid) return;
    console.warn(`[IntakeGenerationService] Terminating process group -${pid} due to: ${reason}`);

    for (const [draftId, active] of this.activeOperations.entries()) {
      if (active.child.pid === pid) {
        active.operation.termination_reason = reason as any;
        break;
      }
    }

    try {
      process.kill(-pid, 'SIGTERM');
    } catch (e) {}

    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (e) {}
    }, 5000);
  }

  async wait(draftId: string, timeoutMs: number): Promise<void> {
    const active = this.activeOperations.get(draftId);
    if (!active) {
      const record = await this.getOperationRecord(draftId);
      if (record.status === 'draft_ready') return;
      if (record.status === 'generation_failed') {
        throw new AgentFactoryError(
          record.error_message || 'Intake generation failed',
          record.error_code || 'INTAKE_AGENT_FAILED',
          400,
          { retryable: false, target_id: draftId }
        );
      }
      throw new Error(`No active generation for draft ${draftId} and it is not in terminal state.`);
    }

    if (active.operation.status === 'draft_ready') return;

    return new Promise<void>((resolve, reject) => {
      active.resolveList.push(resolve);
      active.rejectList.push(reject);
    });
  }

  // Scanning registry and recovering stale statuses on startup
  async recover(): Promise<void> {
    const regPath = await this.getIntakeRegistryPath();
    const opsPath = this.getIntakeOperationsPath();
    if (!existsSync(opsPath)) return;

    const opsRegistry = JSON.parse(await fs.readFile(opsPath, 'utf-8'));
    const draftsRegistry = JSON.parse(await fs.readFile(regPath, 'utf-8'));

    let updated = false;

    for (const op of opsRegistry.operations as IntakeOperation[]) {
      if (op.status === 'generating') {
        const draft = draftsRegistry.drafts.find((d: any) => d.draft_id === op.draft_id);
        if (!draft) continue;

        const pid = op.pid;
        if (pid && isPidAlive(pid)) {
          // Process still alive, remount the watchdog timer (hard timeout)
          const elapsed = Date.now() - new Date(op.started_at || '').getTime();
          const hardTimeoutMs = parseInt(process.env.INTAKE_HARD_TIMEOUT_MS || '300000', 10);
          const remaining = Math.max(0, hardTimeoutMs - elapsed);

          console.log(`[IntakeGenerationService] Recovered active PID ${pid} for ${op.draft_id}. Watchdog remaining: ${remaining}ms`);
          
          const watchdogTimer = setTimeout(() => {
            this.terminateProcessGroup(pid, 'recovered_hard_timeout_exceeded');
          }, remaining);

          // We don't have child process handle anymore, but we can manage it as a watchdog-only process
          this.activeOperations.set(op.draft_id, {
            child: { pid } as any,
            operation: op,
            hardTimer: watchdogTimer,
            resolveList: [],
            rejectList: []
          });
        } else {
          // Process is dead. Validate artifacts.
          console.log(`[IntakeGenerationService] Stale process PID ${pid} found dead for ${op.draft_id}. Resolving output status.`);
          const draftFilePath = path.join(draft.repo_path, draft.draft_path);
          const reportFilePath = path.join(draft.repo_path, draft.report_path);

          try {
            const { title } = await validateIntakeOutput(draft.repo_path, draftFilePath, reportFilePath);
            op.status = 'draft_ready';
            op.title = title;
            draft.status = 'draft_ready';
            draft.title = title;
          } catch (e: any) {
            op.status = 'generation_failed';
            op.error_code = 'INTAKE_AGENT_FAILED';
            op.error_message = e.message || 'Process terminated abruptly without output';
            draft.status = 'generation_failed';
            draft.error = op.error_message;
          }
          op.finished_at = new Date().toISOString();
          draft.updated_at = new Date().toISOString();
          updated = true;
        }
      }
    }

    if (updated) {
      await fs.writeFile(opsPath, JSON.stringify(opsRegistry, null, 2), 'utf-8');
      await fs.writeFile(regPath, JSON.stringify(draftsRegistry, null, 2), 'utf-8');
    }
  }
}

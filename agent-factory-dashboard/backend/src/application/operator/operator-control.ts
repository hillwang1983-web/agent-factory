import { OperatorAction, OperatorAuditLog, OperatorTargetRef } from '../../domain/operator';
import { OperatorRepository } from '../../domain/operator-repository';
import { AgentFactoryMonitorUseCase } from '../agent-factory-monitor';
import { OperatorLockService } from '../../infrastructure/operator/operator-lock-service';
import { OrchestrationOperationStore } from '../orchestration-operation-store';
import { EpicMonitor } from '../epic-monitor';

export interface OperatorRunnerDelegate {
  spawnAduOrchestrator(aduId: string, mode: 'start' | 'continue' | 'step'): Promise<any>;
  spawnEpicOrchestrator(epicId: string, mode: 'start' | 'continue' | 'step' | 'materialize'): Promise<any>;
  executeNonDirectAction(action: OperatorAction): Promise<any>;
}

export class OperatorControl {
  constructor(
    private readonly monitor: AgentFactoryMonitorUseCase,
    private readonly epicMonitor: EpicMonitor,
    private readonly operatorRepo: OperatorRepository,
    private readonly lockService: OperatorLockService,
    private readonly operationStore: OrchestrationOperationStore,
    private readonly runnerDelegate: OperatorRunnerDelegate
  ) {}

  async executeAction(action: OperatorAction): Promise<any> {
    // 1. Idempotency Check
    const existing = await this.operatorRepo.getActionByIdempotencyKey(action.idempotency_key);
    if (existing) {
      const op = this.operationStore.getLatestForTarget(
        action.target.type === 'epic' ? 'epic' : 'adu',
        action.target.id
      );
      return {
        operation_id: op?.operation_id || `OP-${action.idempotency_key}`,
        accepted: true,
        status: op?.status || 'completed',
        message: 'Action completed (idempotent)',
        operation: op
      };
    }

    const targetId = action.target.id;
    const targetType = action.target.type;

    let projectId = 'default-open5gs';
    if (targetType === 'adu') {
      const adu = await this.monitor.repo.getAduById(targetId);
      if (!adu) throw Object.assign(new Error(`ADU ${targetId} not found`), { status: 404 });
      projectId = adu.project_id || 'default-open5gs';
    } else if (targetType === 'epic') {
      const epic = await this.epicMonitor.getEpic(targetId);
      if (!epic) throw Object.assign(new Error(`Epic ${targetId} not found`), { status: 404 });
      projectId = epic.project_id || 'default-open5gs';
    } else {
      throw Object.assign(new Error(`Invalid targetType: ${targetType}`), { status: 400 });
    }

    const isDirectRunner = ['start', 'continue_auto', 'step', 'materialize_child_adus'].includes(action.action);
    const isLockBypassed = ['pause', 'cancel'].includes(action.action);

    // 2. Lock Check
    if (!isLockBypassed) {
      const isLocked = this.lockService.isLocked(targetId, projectId);
      if (isLocked) {
        throw Object.assign(new Error(`Target ${targetId} is currently locked by another active operation.`), { conflict: true });
      }

      // Acquire Lock
      if (!this.lockService.acquireLock(targetId, projectId, !isDirectRunner)) {
        throw Object.assign(new Error(`Failed to acquire lock for target ${targetId}.`), { conflict: true });
      }
    }

    try {
      let result: any;
      switch (action.action) {
        case 'start':
        case 'continue_auto':
        case 'step':
        case 'materialize_child_adus': {
          let runMode: 'start' | 'continue' | 'step' | 'materialize';
          if (action.action === 'materialize_child_adus') {
            if (targetType !== 'epic') {
              throw Object.assign(new Error('materialize_child_adus action is only supported for Epic targets'), { status: 400 });
            }
            runMode = 'materialize';
          } else {
            runMode = action.action === 'continue_auto' ? 'continue' : (action.action === 'start' ? 'start' : 'step');
          }
          if (targetType === 'epic') {
            result = await this.runnerDelegate.spawnEpicOrchestrator(targetId, runMode);
          } else {
            result = await this.runnerDelegate.spawnAduOrchestrator(targetId, runMode as any);
          }
          break;
        }

        case 'pause': {
          if (targetType === 'adu') {
            await this.monitor.pauseAdu(targetId);
            result = { success: true, message: 'ADU flagged for pause' };
          } else {
            throw new Error('Pause is only supported for ADU targets');
          }
          break;
        }

        case 'cancel': {
          if (targetType === 'adu') {
            await this.monitor.cancelAdu(targetId);
            result = { success: true, message: 'ADU canceled' };
          } else {
            throw new Error('Cancel is only supported for ADU targets');
          }
          break;
        }

        default:
          result = await this.runnerDelegate.executeNonDirectAction(action);
          break;
      }

      // Save Action & Audit Log on success
      await this.operatorRepo.saveAction(action);
      await this.operatorRepo.saveAuditLog({
        id: `LOG-${action.id}`,
        timestamp: new Date().toISOString(),
        target: action.target,
        action: action.action,
        requested_by: action.requested_by,
        status: 'success',
        details: `Successfully executed ${action.action} on ${targetType} ${targetId}`
      });

      return result;
    } catch (err: any) {
      // Log failure
      await this.operatorRepo.saveAuditLog({
        id: `LOG-${action.id}`,
        timestamp: new Date().toISOString(),
        target: action.target,
        action: action.action,
        requested_by: action.requested_by,
        status: 'failed',
        details: `Failed to execute ${action.action}: ${err.message}`
      });
      throw err;
    } finally {
      // Release Lock
      if (!isLockBypassed) {
        this.lockService.releaseLock(targetId, projectId, !isDirectRunner);
      }
    }
  }
}

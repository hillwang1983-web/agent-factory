import { OperatorAction, OperatorAuditLog } from './operator';

export interface OperatorRepository {
  saveAction(action: OperatorAction): Promise<void>;
  getActions(): Promise<OperatorAction[]>;
  getActionByIdempotencyKey(key: string): Promise<OperatorAction | null>;
  saveAuditLog(log: OperatorAuditLog): Promise<void>;
  getAuditLogs(): Promise<OperatorAuditLog[]>;
}

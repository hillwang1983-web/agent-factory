import * as fs from 'fs/promises';
import * as path from 'path';
import { OperatorAction, OperatorAuditLog } from '../../domain/operator';
import { OperatorRepository } from '../../domain/operator-repository';

export class FileOperatorRepository implements OperatorRepository {
  private readonly actionsPath: string;
  private readonly logsPath: string;
  private writeMutex: Promise<void> = Promise.resolve();

  constructor(workspaceRoot: string) {
    const registryDir = path.join(workspaceRoot, '.ai-agent', 'registry');
    this.actionsPath = path.join(registryDir, 'operator-actions.json');
    this.logsPath = path.join(registryDir, 'operator-audit-logs.json');
  }

  private async readJsonFile<T>(filePath: string, key: string, defaultValue: T): Promise<T> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed[key] ?? defaultValue;
    } catch {
      return defaultValue;
    }
  }

  private async writeJsonFile<T>(filePath: string, key: string, data: T): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const payload = { version: 1, [key]: data };
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  }

  async saveAction(action: OperatorAction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.writeMutex = this.writeMutex.then(async () => {
        try {
          const actions = await this.readJsonFile<OperatorAction[]>(this.actionsPath, 'actions', []);
          if (!actions.find(a => a.id === action.id || a.idempotency_key === action.idempotency_key)) {
            actions.push(action);
            await this.writeJsonFile<OperatorAction[]>(this.actionsPath, 'actions', actions);
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async getActions(): Promise<OperatorAction[]> {
    return this.readJsonFile<OperatorAction[]>(this.actionsPath, 'actions', []);
  }

  async getActionByIdempotencyKey(key: string): Promise<OperatorAction | null> {
    const actions = await this.getActions();
    return actions.find(a => a.idempotency_key === key) ?? null;
  }

  async saveAuditLog(log: OperatorAuditLog): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.writeMutex = this.writeMutex.then(async () => {
        try {
          const logs = await this.readJsonFile<OperatorAuditLog[]>(this.logsPath, 'logs', []);
          if (!logs.find(l => l.id === log.id)) {
            logs.push(log);
            await this.writeJsonFile<OperatorAuditLog[]>(this.logsPath, 'logs', logs);
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async getAuditLogs(): Promise<OperatorAuditLog[]> {
    return this.readJsonFile<OperatorAuditLog[]>(this.logsPath, 'logs', []);
  }
}

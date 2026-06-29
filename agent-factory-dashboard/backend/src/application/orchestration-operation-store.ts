import fs from 'fs';
import path from 'path';
import { loadAppConfig } from '../config';
import { OrchestrationOperation, OrchestrationOperationEvent } from '../domain/orchestration-operation';
import { mapOrchestratorEvent } from './runtime/orchestrator-event-mapper';
export { mapOrchestratorEvent };

function toCompatibility(op: OrchestrationOperation): OrchestrationOperation {
  op.id = op.operation_id;
  op.targetType = op.scope === 'epic' ? 'epic' : 'adu';
  op.targetId = op.target_id;
  op.startedAt = op.started_at || op.created_at;
  op.endedAt = op.finished_at || undefined;
  return op;
}

function isPidAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e && typeof e === 'object' && e.code === 'EPERM';
  }
}

export class OrchestrationOperationStore {
  private static instance: OrchestrationOperationStore;

  private constructor() {}

  public static getInstance(): OrchestrationOperationStore {
    if (!OrchestrationOperationStore.instance) {
      OrchestrationOperationStore.instance = new OrchestrationOperationStore();
    }
    return OrchestrationOperationStore.instance;
  }

  private getRegistryDir(): string {
    const config = loadAppConfig();
    return path.join(config.workspaceRoot, '.ai-agent', 'registry');
  }

  private readOperations(): OrchestrationOperation[] {
    const dir = this.getRegistryDir();
    const file = path.join(dir, 'operations.json');
    if (!fs.existsSync(file)) return [];

    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch (e: any) {
      throw new Error(`Failed to read operations registry file at ${file}: ${e.message}`);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (e: any) {
      throw new Error(`Failed to parse operations registry file at ${file}: ${e.message}`);
    }

    const ops = parsed.operations || [];

    // Proactively clean up stale operations where the process has died
    let changed = false;
    const now = new Date().toISOString();
    for (const op of ops) {
      if (
        ['queued', 'spawning', 'running'].includes(op.status) &&
        op.spawn?.pid !== undefined &&
        !isPidAlive(op.spawn.pid)
      ) {
        op.status = 'failed';
        op.result = 'failed';
        op.error = `stale active operation: process PID ${op.spawn.pid} is no longer alive`;
        op.finished_at = now;
        op.endedAt = now;
        op.exitCode = 1;
        changed = true;
      }
    }

    if (changed) {
      try {
        fs.writeFileSync(file, JSON.stringify({ version: 1, operations: ops }, null, 2) + '\n', 'utf-8');
      } catch (_) {}
    }

    return ops;
  }

  private writeOperations(ops: OrchestrationOperation[]) {
    const dir = this.getRegistryDir();
    const file = path.join(dir, 'operations.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, operations: ops }, null, 2) + '\n', 'utf-8');
  }

  private readEvents(): OrchestrationOperationEvent[] {
    const dir = this.getRegistryDir();
    const file = path.join(dir, 'events.json');
    if (!fs.existsSync(file)) return [];

    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch (e: any) {
      throw new Error(`Failed to read events registry file at ${file}: ${e.message}`);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (e: any) {
      throw new Error(`Failed to parse events registry file at ${file}: ${e.message}`);
    }

    return parsed.events || [];
  }

  private writeEvents(evts: OrchestrationOperationEvent[]) {
    const dir = this.getRegistryDir();
    const file = path.join(dir, 'events.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, events: evts }, null, 2) + '\n', 'utf-8');
  }

  createOperation(input: {
    targetType?: 'adu' | 'epic';
    targetId?: string;
    mode?: any;
    operation_id?: string;
    scope?: 'adu' | 'epic' | 'project' | 'intake';
    target_id?: string;
    action?: any;
    project_id?: string;
    epic_id?: string;
    status?: any;
  }): OrchestrationOperation {
    const timestamp = new Date().toISOString();
    const targetId = input.targetId || input.target_id || '';
    const scope = input.scope || (input.targetType === 'epic' ? 'epic' : 'adu');
    const action = input.action || input.mode || 'start';
    const operation_id = input.operation_id || `op-${targetId}-${Date.now()}`;
    const project_id = input.project_id || 'default-open5gs';
    const status = input.status || 'running'; // Default running for backward compatibility tests

    const op: OrchestrationOperation = {
      operation_id,
      scope,
      target_id: targetId,
      epic_id: input.epic_id || null,
      project_id,
      action,
      mode: input.mode || (action === 'step' ? 'step' : 'auto'),
      status,
      created_at: timestamp,
      started_at: timestamp,
      finished_at: null,
      spawn: {
        command: '',
        cwd: loadAppConfig().workspaceRoot
      },
      current_agent: null,
      current_state: null,
      result: null,
      error: null
    };

    toCompatibility(op);
    op.events = [];

    const ops = this.readOperations();
    ops.push(op);
    this.writeOperations(ops);

    return op;
  }

  getOperation(id: string): OrchestrationOperation | null {
    const ops = this.readOperations();
    const op = ops.find(o => o.operation_id === id || o.id === id);
    if (!op) return null;

    const compatible = toCompatibility(op);
    const evts = this.readEvents();
    compatible.events = evts.filter(e => e.operation_id === op.operation_id || e.operation_id === op.id);
    return compatible;
  }

  getAllOperations(): OrchestrationOperation[] {
    const ops = this.readOperations();
    return ops.map(op => toCompatibility(op));
  }

  getLatestForTarget(targetType: 'adu' | 'epic', targetId: string): OrchestrationOperation | null {
    const ops = this.readOperations();
    const filtered = ops
      .filter(o => (o.scope === targetType || o.targetType === targetType) && (o.target_id === targetId || o.targetId === targetId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (filtered.length === 0) return null;

    const op = toCompatibility(filtered[0]);
    const evts = this.readEvents();
    op.events = evts.filter(e => e.operation_id === op.operation_id || e.operation_id === op.id);
    return op;
  }

  addEvent(id: string, event: any): void {
    const ops = this.readOperations();
    const op = ops.find(o => o.operation_id === id || o.id === id);
    if (!op) return;

    const event_id = `evt-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newEvent: OrchestrationOperationEvent = {
      event_id,
      operation_id: op.operation_id,
      scope: op.scope,
      target_id: op.target_id,
      type: event.type || 'orchestrator_event',
      severity: event.severity || (event.stream === 'stderr' ? 'error' : 'info'),
      message: event.message || (event.payload && event.payload.message) || '',
      payload: event.payload || event,
      created_at: new Date().toISOString(),
      stream: event.stream
    };

    const evts = this.readEvents();

    // Cap events to 200 per operation
    const opEvents = evts.filter(e => e.operation_id === op.operation_id);
    if (opEvents.length >= 200) {
      const firstIdx = evts.findIndex(e => e.operation_id === op.operation_id);
      if (firstIdx >= 0) {
        evts.splice(firstIdx, 1);
      }
    }

    evts.push(newEvent);

    // Cap global events to 5000 to prevent filesystem memory bloat
    if (evts.length > 5000) {
      evts.splice(0, evts.length - 5000);
    }
    this.writeEvents(evts);
  }

  updateOperation(id: string, updates: any): OrchestrationOperation | null {
    const ops = this.readOperations();
    const op = ops.find(o => o.operation_id === id || o.id === id);
    if (!op) return null;

    if (updates.pid !== undefined) {
      if (!op.spawn) op.spawn = {};
      op.spawn.pid = updates.pid;
    }
    if (updates.command !== undefined) {
      if (!op.spawn) op.spawn = {};
      op.spawn.command = updates.command;
    }
    if (updates.cwd !== undefined) {
      if (!op.spawn) op.spawn = {};
      op.spawn.cwd = updates.cwd;
    }

    if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'canceled') {
      op.finished_at = new Date().toISOString();
      op.endedAt = op.finished_at;
      op.result = updates.status === 'completed' ? 'success' : 'failed';
    }

    Object.assign(op, updates);
    toCompatibility(op);

    this.writeOperations(ops);
    return op;
  }

  getActiveOperation(targetId: string): OrchestrationOperation | null {
    const ops = this.readOperations();
    let changed = false;
    const now = new Date().toISOString();

    for (const op of ops) {
      if (
        op.target_id === targetId &&
        ['queued', 'spawning', 'running'].includes(op.status) &&
        op.spawn?.pid !== undefined &&
        !isPidAlive(op.spawn.pid)
      ) {
        op.status = 'failed';
        op.result = 'failed';
        op.error = `stale active operation: process PID ${op.spawn.pid} is no longer alive`;
        op.finished_at = now;
        op.endedAt = now;
        op.exitCode = 1;
        changed = true;
      }
    }

    if (changed) {
      this.writeOperations(ops);
    }

    const active = ops.find(o =>
      o.target_id === targetId &&
      ['queued', 'spawning', 'running', 'waiting_human'].includes(o.status)
    );
    return active ? toCompatibility(active) : null;
  }

  getAll(): OrchestrationOperation[] {
    const evts = this.readEvents();
    return this.readOperations().map(op => {
      const compatible = toCompatibility(op);
      compatible.events = evts.filter(e => e.operation_id === op.operation_id || e.operation_id === op.id);
      return compatible;
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  clear(): void {
    const dir = this.getRegistryDir();
    const opsFile = path.join(dir, 'operations.json');
    const evtsFile = path.join(dir, 'events.json');
    try {
      if (fs.existsSync(opsFile)) fs.unlinkSync(opsFile);
      if (fs.existsSync(evtsFile)) fs.unlinkSync(evtsFile);
    } catch (_) {}
  }
}

export function handleOrchestratorStdoutLine(
  opId: string,
  line: string,
  store: OrchestrationOperationStore
): void {
  try {
    const parsed = JSON.parse(line);
    store.addEvent(opId, {
      type: parsed.event || parsed.type || 'orchestrator_event',
      payload: parsed,
      stream: 'stdout',
      message: parsed.message || (parsed.payload && parsed.payload.message) || '',
      severity: parsed.severity || 'info'
    });

    const updates = mapOrchestratorEvent(parsed);
    if (updates && Object.keys(updates).length > 0) {
      store.updateOperation(opId, updates);
    }
  } catch (e) {
    store.addEvent(opId, {
      type: 'stdout_raw',
      payload: { line },
      stream: 'stdout',
    });
  }
}

export function handleOrchestratorStderrLine(
  opId: string,
  line: string,
  store: OrchestrationOperationStore
): void {
  store.addEvent(opId, {
    type: 'stderr_line',
    payload: { line },
    stream: 'stderr',
  });
}

export async function handleOrchestratorProcessClose(
  opId: string,
  code: number | null,
  aduId: string,
  repo: { getAduById(id: string): Promise<{ state: string } | null> },
  store: OrchestrationOperationStore
): Promise<void> {
  let finalState: string | undefined;
  try {
    const updatedAdu = await repo.getAduById(aduId);
    if (updatedAdu) {
      finalState = updatedAdu.state;
    }
  } catch (_) {}

  let status = 'completed';
  let result = 'success';

  if (code === 20 || finalState === 'human_gate') {
    status = 'waiting_human';
    result = 'human_gate';
  } else if (code !== 0) {
    status = 'failed';
    result = 'failed';
  }

  store.updateOperation(opId, {
    status,
    result,
    exitCode: code ?? -1,
    finalState,
  });
}

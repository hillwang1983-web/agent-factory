import fs from 'fs';
import path from 'path';
import { loadAppConfig } from '../config';
import { HumanGate, HumanGateType, HumanGateStatus } from '../domain/human-gate';
import { broadcastOrchestratorEvent } from '../websocket/broadcaster';
import { RegistryLock } from '../infrastructure/registry-lock';
import { OrchestrationOperationStore } from './orchestration-operation-store';


export class HumanGateService {
  private static instance: HumanGateService;

  private constructor() {}

  public static getInstance(): HumanGateService {
    if (!HumanGateService.instance) {
      HumanGateService.instance = new HumanGateService();
    }
    return HumanGateService.instance;
  }

  private closeActiveOperation(targetId: string, status: 'completed' | 'canceled') {
    try {
      const opStore = OrchestrationOperationStore.getInstance();
      const activeOp = opStore.getActiveOperation(targetId);
      if (activeOp) {
        opStore.updateOperation(activeOp.operation_id, {
          status,
          result: status === 'completed' ? 'success' : 'failed'
        });
      }
    } catch (_) {}
  }

  private getAduContractAssertions(aduId: string): string[] {
    try {
      const adus = this.readAdus();
      const adu = adus.find(a => a.id === aduId);
      if (!adu) return [];

      let repoRoot = adu.repo_path;
      if (!repoRoot && adu.project_id) {
        const config = loadAppConfig();
        const projectsFile = config.projectsRegistryPath;
        if (fs.existsSync(projectsFile)) {
          const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf-8')).projects || [];
          const project = projects.find((p: any) => p.project_id === adu.project_id);
          if (project && project.repo_path) {
            repoRoot = project.repo_path;
          }
        }
      }
      if (!repoRoot) {
        const config = loadAppConfig();
        repoRoot = config.workspaceRoot;
      }

      const contractPath = path.join(repoRoot, '.ai-agent', 'contracts', `${aduId}.json`);
      if (!fs.existsSync(contractPath)) return [];
      const contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));

      let assertions: any[] = [];
      if (contract.acceptance_assertions) {
        assertions = contract.acceptance_assertions;
      } else if (contract.acceptance_criteria) {
        assertions = contract.acceptance_criteria;
      } else if (contract.acceptance) {
        return contract.acceptance.map((_: any, idx: number) => `A-${idx + 1}`);
      }
      return assertions.map((a: any) => a.id || a.assertion_id).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  private getRegistryDir(): string {

    const config = loadAppConfig();
    return path.join(config.workspaceRoot, '.ai-agent', 'registry');
  }

  private readGates(): HumanGate[] {
    const dir = this.getRegistryDir();
    const file = path.join(dir, 'human-gates.json');
    if (!fs.existsSync(file)) return [];
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed.gates || [];
    } catch (_) {
      return [];
    }
  }

  private writeGates(gates: HumanGate[]) {
    const dir = this.getRegistryDir();
    const file = path.join(dir, 'human-gates.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, gates }, null, 2) + '\n', 'utf-8');
  }

  private readWaivers(): any[] {
    const dir = this.getRegistryDir();
    const file = path.join(dir, 'evidence-waivers.json');
    if (!fs.existsSync(file)) return [];
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed.waivers || [];
    } catch (_) {
      return [];
    }
  }

  private writeWaivers(waivers: any[]) {
    const dir = this.getRegistryDir();
    const file = path.join(dir, 'evidence-waivers.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, waivers }, null, 2) + '\n', 'utf-8');
  }

  private readAdus(): any[] {
    const dir = this.getRegistryDir();
    const file = path.join(dir, 'adu.json');
    if (!fs.existsSync(file)) return [];
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed.adus || [];
    } catch (_) {
      return [];
    }
  }

  private writeAdus(adus: any[]) {
    const dir = this.getRegistryDir();
    const file = path.join(dir, 'adu.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, adus }, null, 2) + '\n', 'utf-8');
  }

  private readEpics(): any[] {
    const dir = this.getRegistryDir();
    const file = path.join(dir, 'epics.json');
    if (!fs.existsSync(file)) return [];
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed.epics || [];
    } catch (_) {
      return [];
    }
  }

  private writeEpics(epics: any[]) {
    const dir = this.getRegistryDir();
    const file = path.join(dir, 'epics.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, epics }, null, 2) + '\n', 'utf-8');
  }

  async openGate(input: {
    scope: 'adu' | 'epic' | 'project' | 'intake';
    target_id: string;
    epic_id?: string | null;
    project_id?: string;
    gate_type: HumanGateType;
    title: string;
    reason: string;
    source_agent: string;
    source_run_id?: string | null;
    pre_gate_state?: string | null;
    affected_assertions?: string[];
  }): Promise<HumanGate> {
    return RegistryLock.runLocked(() => {
      const gates = this.readGates();
      const gate_id = `gate-${input.target_id}-${input.gate_type}-${Date.now()}`;
      const project_id = input.project_id || 'default-open5gs';

      const available_actions: HumanGate['available_actions'] = [];
      if (input.gate_type === 'environment_verification_required') {
        available_actions.push('submit_runtime_result', 'approve_waiver', 'request_rework');
      } else if (['token_budget_approval', 'dependency_delivery_missing'].includes(input.gate_type)) {
        available_actions.push('approve', 'cancel');
      } else if (input.gate_type === 'dependency_blocked') {
        available_actions.push('cancel');
      } else if (['analysis_review', 'design_review'].includes(input.gate_type)) {
        available_actions.push('approve', 'request_rework');
      } else {
        available_actions.push('resolve', 'cancel');
      }

      const gate: HumanGate = {
        gate_id,
        scope: input.scope,
        target_id: input.target_id,
        epic_id: input.epic_id || null,
        project_id,
        gate_type: input.gate_type,
        status: 'pending',
        title: input.title,
        reason: input.reason,
        source_agent: input.source_agent,
        source_run_id: input.source_run_id || null,
        pre_gate_state: input.pre_gate_state || null,
        affected_assertions: input.affected_assertions || [],
        available_actions,
        created_at: new Date().toISOString(),
      };

      // Prevent duplicate active gates of same type on same target
      const existingIndex = gates.findIndex(g => g.target_id === input.target_id && g.gate_type === input.gate_type && g.status === 'pending');
      if (existingIndex >= 0) {
        gates[existingIndex] = gate;
      } else {
        gates.push(gate);
      }

      this.writeGates(gates);

      // Update target status to human_gate
      if (input.scope === 'adu') {
        const adus = this.readAdus();
        const adu = adus.find(a => a.id === input.target_id);
        if (adu) {
          adu.state = 'human_gate';
          adu.human_gate_required = true;
          adu.gate_type = input.gate_type;
          adu.pre_gate_state = input.pre_gate_state || adu.pre_gate_state;
          this.writeAdus(adus);
        }
      } else if (input.scope === 'epic') {
        const epics = this.readEpics();
        const epic = epics.find(e => e.id === input.target_id);
        if (epic) {
          epic.state = 'human_gate';
          this.writeEpics(epics);
        }
      }

      broadcastOrchestratorEvent({
        type: 'agentFactoryEvent',
        event: 'human_gate_opened',
        gateId: gate_id,
        targetId: input.target_id,
        gateType: input.gate_type
      });

      return gate;
    });
  }

  async listGates(filter?: { status?: string }): Promise<HumanGate[]> {
    const gates = this.readGates();
    if (filter && filter.status) {
      return gates.filter(g => g.status === filter.status);
    }
    return gates;
  }

  async getGate(gateId: string): Promise<HumanGate | null> {
    const gates = this.readGates();
    return gates.find(g => g.gate_id === gateId) || null;
  }

  async submitRuntimeResult(gateId: string, input: { command: string; exitCode: number; output: string }): Promise<void> {
    return RegistryLock.runLocked(() => {
      const gates = this.readGates();
      const gate = gates.find(g => g.gate_id === gateId);
      if (!gate) throw new Error(`Gate ${gateId} not found`);
      if (gate.status !== 'pending') throw new Error(`Gate is already resolved: ${gate.status}`);

      gate.status = 'resolved';
      gate.resolved_at = new Date().toISOString();
      gate.resolution = {
        action: 'submit_runtime_result',
        command: input.command,
        exitCode: input.exitCode,
        output: input.output
      };
      this.writeGates(gates);

      // Move state back to pre_gate_state so quality review / evidence runs again
      const targetState = gate.pre_gate_state || 'debugged';
      if (gate.scope === 'adu') {
        const adus = this.readAdus();
        const adu = adus.find(a => a.id === gate.target_id);
        if (adu) {
          adu.state = targetState;
          adu.human_gate_required = false;

          // Push the runtime validation command results to compliance log or adu runs.
          // Record the assertions this gate covers so the evidence validator can
          // match the record to assertions by exact id (not by text guessing).
          if (!adu.runtime_evidence_records) {
            adu.runtime_evidence_records = [];
          }
          adu.runtime_evidence_records.push({
            assertion_ids: gate.affected_assertions || [],
            command: input.command,
            exitCode: input.exitCode,
            output: input.output,
            submitted_at: new Date().toISOString()
          });

          this.writeAdus(adus);
        }
      }

      this.closeActiveOperation(gate.target_id, 'completed');

      broadcastOrchestratorEvent({
        type: 'agentFactoryEvent',
        event: 'human_gate_resolved',
        gateId,
        status: 'resolved'
      });
    });
  }

  async approveWaiver(gateId: string, input: {
    assertion_ids: string[];
    waiver_type: string;
    reason: string;
    risk: string;
    follow_up: string;
    operator: string;
  }): Promise<void> {
    return RegistryLock.runLocked(() => {
      const gates = this.readGates();
      const gate = gates.find(g => g.gate_id === gateId);
      if (!gate) throw new Error(`Gate ${gateId} not found`);
      if (gate.status !== 'pending') throw new Error(`Gate is already resolved: ${gate.status}`);

      if (!input.assertion_ids || !Array.isArray(input.assertion_ids) || input.assertion_ids.length === 0) {
        throw new Error('assertion_ids must be a non-empty array');
      }

      const contractAssertions = this.getAduContractAssertions(gate.target_id);
      for (const id of input.assertion_ids) {
        if (!contractAssertions.includes(id)) {
          throw new Error(`Assertion ID ${id} does not exist in the contract for ADU ${gate.target_id}`);
        }
        if (gate.affected_assertions && gate.affected_assertions.length > 0 && !gate.affected_assertions.includes(id)) {
          throw new Error(`Assertion ID ${id} is not affected by this gate`);
        }
      }

      gate.status = 'waived';
      gate.resolved_at = new Date().toISOString();
      gate.resolution = {
        action: 'approve_waiver',
        assertion_ids: input.assertion_ids,
        waiver_type: input.waiver_type,
        reason: input.reason,
        risk: input.risk,
        follow_up: input.follow_up,
        operator: input.operator
      };
      this.writeGates(gates);

      // Create Waiver Record
      const waivers = this.readWaivers();
      const waiver_id = `waiver-${gate.target_id}-${input.assertion_ids.join('-')}-${Date.now()}`;
      const waiver = {
        waiver_id,
        gate_id: gateId,
        adu_id: gate.scope === 'adu' ? gate.target_id : null,
        epic_id: gate.epic_id || (gate.scope === 'epic' ? gate.target_id : null),
        project_id: gate.project_id,
        assertion_ids: input.assertion_ids,
        waiver_type: input.waiver_type,
        reason: input.reason,
        risk: input.risk,
        follow_up: input.follow_up,
        operator: input.operator,
        status: 'approved',
        approved_by: input.operator || 'operator',
        created_at: new Date().toISOString()
      };
      waivers.push(waiver);
      this.writeWaivers(waivers);

      // Update target state
      const targetState = gate.pre_gate_state || 'debugged';
      if (gate.scope === 'adu') {
        const adus = this.readAdus();
        const adu = adus.find(a => a.id === gate.target_id);
        if (adu) {
          adu.state = targetState;
          adu.human_gate_required = false;
          this.writeAdus(adus);
        }
      }

      this.closeActiveOperation(gate.target_id, 'completed');

      broadcastOrchestratorEvent({
        type: 'agentFactoryEvent',
        event: 'human_gate_resolved',
        gateId,
        status: 'resolved'
      });
    });
  }

  async requestRework(gateId: string, input: {
    targetAgent: 'developer' | 'rework-planner';
    instruction: string;
  }): Promise<void> {
    return RegistryLock.runLocked(() => {
      const gates = this.readGates();
      const gate = gates.find(g => g.gate_id === gateId);
      if (!gate) throw new Error(`Gate ${gateId} not found`);
      if (gate.status !== 'pending') throw new Error(`Gate is already resolved: ${gate.status}`);

      gate.status = 'rework_requested';
      gate.resolved_at = new Date().toISOString();
      gate.resolution = {
        action: 'request_rework',
        targetAgent: input.targetAgent,
        instruction: input.instruction
      };
      this.writeGates(gates);

      // Set state to code_rework or acceptance_rework
      const nextState = input.targetAgent === 'rework-planner' ? 'code_rework' : 'code_rework';
      if (gate.scope === 'adu') {
        const adus = this.readAdus();
        const adu = adus.find(a => a.id === gate.target_id);
        if (adu) {
          adu.state = 'code_rework'; // standard code rework state
          adu.human_gate_required = false;

          // Append instruction to clarifications or feedback
          if (!adu.rework_instructions) {
            adu.rework_instructions = [];
          }
          adu.rework_instructions.push({
            instruction: input.instruction,
            targetAgent: input.targetAgent,
            requested_at: new Date().toISOString()
          });

          this.writeAdus(adus);
        }
      }

      this.closeActiveOperation(gate.target_id, 'completed');

      broadcastOrchestratorEvent({
        type: 'agentFactoryEvent',
        event: 'human_gate_resolved',
        gateId,
        status: 'rework_requested'
      });
    });
  }

  async approveGate(gateId: string, comment?: string): Promise<void> {
    // 1. Snapshot inside lock
    const { gate, adu, adus, dependencyFingerprint } = await RegistryLock.runLocked(() => {
      const gates = this.readGates();
      const targetGate = gates.find(g => g.gate_id === gateId);
      if (!targetGate) throw new Error(`Gate ${gateId} not found`);
      if (targetGate.status !== 'pending') throw new Error(`Gate is already resolved: ${targetGate.status}`);

      let targetAdu: any = null;
      let aduList: any[] = [];
      if (targetGate.scope === 'adu') {
        aduList = this.readAdus();
        targetAdu = aduList.find(a => a.id === targetGate.target_id);
      }

      // Generate fingerprint of all ADUs and their manifests
      const dependencyFingerprint = this.getDependencyFingerprint(aduList);

      return { gate: { ...targetGate }, adu: targetAdu ? { ...targetAdu } : null, adus: aduList.map(a => ({ ...a })), dependencyFingerprint };
    });

    // 2. Perform heavy validation (Git / file IO) outside RegistryLock
    if (gate.gate_type === 'dependency_delivery_missing') {
      if (!adu) throw new Error(`Target ADU ${gate.target_id} not found`);

      const repoRoot = this.getRepoRoot(adu);
      const { checkDependencyHealthTS } = require('./agent-factory-monitor');
      const depHealth = checkDependencyHealthTS(adu, adus, repoRoot);

      if (depHealth.status !== 'healthy') {
        throw new Error(`Dependency health check is still failing: ${depHealth.reasons.join(' ')}`);
      }
    } else if (gate.gate_type === 'dependency_blocked') {
      throw new Error(`dependency_blocked gates cannot be approved manually because the upstream dependency is canceled. The ADU must be canceled.`);
    }

    // 3. Update inside lock (Compare-And-Swap check on status and dependency state fingerprint)
    return RegistryLock.runLocked(() => {
      const gates = this.readGates();
      const targetGate = gates.find(g => g.gate_id === gateId);
      if (!targetGate) throw new Error(`Gate ${gateId} not found`);
      if (targetGate.status !== 'pending') throw new Error(`Gate status changed while validating: ${targetGate.status}`);

      // Verify fingerprint hasn't changed since the snapshot (CAS)
      if (targetGate.scope === 'adu') {
        const currentAdus = this.readAdus();
        const currentFingerprint = this.getDependencyFingerprint(currentAdus);

        if (JSON.stringify(dependencyFingerprint) !== JSON.stringify(currentFingerprint)) {
          throw new Error('Dependency state or manifest files changed while validating approval. Re-run validation.');
        }
      }

      targetGate.status = 'approved';
      targetGate.resolved_at = new Date().toISOString();
      targetGate.resolution = { Action: 'approve', comment };
      this.writeGates(gates);

      // Progress target to next state
      let targetState = 'completed';
      if (targetGate.gate_type === 'analysis_review') {
        targetState = 'analyzed';
      } else if (targetGate.gate_type === 'design_review') {
        targetState = 'designed';
      } else if (['token_budget_approval', 'dependency_delivery_missing', 'dependency_blocked'].includes(targetGate.gate_type)) {
        targetState = targetGate.pre_gate_state || 'created';
      }

      if (targetGate.scope === 'adu') {
        const adus = this.readAdus();
        const aduToUpdate = adus.find(a => a.id === targetGate.target_id);
        if (aduToUpdate) {
          aduToUpdate.state = targetState;
          aduToUpdate.human_gate_required = false;
          this.writeAdus(adus);
        }
      } else if (targetGate.scope === 'epic') {
        const epics = this.readEpics();
        const epicToUpdate = epics.find(e => e.id === targetGate.target_id);
        if (epicToUpdate) {
          epicToUpdate.state = targetState;
          this.writeEpics(epics);
        }
      }

      this.closeActiveOperation(targetGate.target_id, 'completed');

      broadcastOrchestratorEvent({
        type: 'agentFactoryEvent',
        event: 'human_gate_resolved',
        gateId,
        status: 'approved'
      });
    });
  }

  async cancelGate(gateId: string, reason: string): Promise<void> {
    return RegistryLock.runLocked(() => {
      const gates = this.readGates();
      const gate = gates.find(g => g.gate_id === gateId);
      if (!gate) throw new Error(`Gate ${gateId} not found`);
      if (gate.status !== 'pending') throw new Error(`Gate is already resolved: ${gate.status}`);

      gate.status = 'canceled';
      gate.resolved_at = new Date().toISOString();
      gate.resolution = { Action: 'cancel', reason };
      this.writeGates(gates);

      // Cancel targets
      if (gate.scope === 'adu') {
        const adus = this.readAdus();
        const adu = adus.find(a => a.id === gate.target_id);
        if (adu) {
          adu.state = 'canceled';
          adu.human_gate_required = false;
          this.writeAdus(adus);
        }
      } else if (gate.scope === 'epic') {
        const epics = this.readEpics();
        const epic = epics.find(e => e.id === gate.target_id);
        if (epic) {
          epic.state = 'canceled';
          this.writeEpics(epics);
        }
      }

      this.closeActiveOperation(gate.target_id, 'completed');

      broadcastOrchestratorEvent({
        type: 'agentFactoryEvent',
        event: 'human_gate_resolved',
        gateId,
        status: 'rework_requested'
      });
    });
  }

  private getDependencyFingerprint(adus: any[]): any[] {
    const crypto = require('crypto');
    return adus.map(a => {
      const repoRoot = this.getRepoRoot(a);
      const manifestPath = path.join(repoRoot, '.ai-agent', 'evidence', `${a.id}-manifest.json`);
      let manifestHash = '';
      let outputFingerprints: any[] = [];
      try {
        if (fs.existsSync(manifestPath)) {
          const content = fs.readFileSync(manifestPath);
          manifestHash = crypto.createHash('sha256').update(content).digest('hex');

          const manifest = JSON.parse(content.toString('utf-8'));
          const reqOutputs = manifest.required_outputs || [];
          for (const f of reqOutputs) {
            const fpath = path.join(repoRoot, f);
            if (fs.existsSync(fpath)) {
              const stat = fs.statSync(fpath);
              let fileHash = '';
              if (stat.size < 1024 * 1024) { // only hash files < 1MB to keep lock speed fast
                const fContent = fs.readFileSync(fpath);
                fileHash = crypto.createHash('sha256').update(fContent).digest('hex');
              }
              outputFingerprints.push({
                file: f,
                size: stat.size,
                mtime: stat.mtimeMs,
                hash: fileHash
              });
            } else {
              outputFingerprints.push({ file: f, exists: false });
            }
          }
        }
      } catch (_) {}
      return {
        id: a.id,
        state: a.state,
        manifestHash,
        outputs: outputFingerprints
      };
    });
  }

  private getRepoRoot(adu: any): string {
    let repoRoot = adu.repo_path;
    if (!repoRoot && adu.project_id) {
      const config = loadAppConfig();
      const projectsFile = config.projectsRegistryPath;
      if (fs.existsSync(projectsFile)) {
        const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf-8')).projects || [];
        const project = projects.find((p: any) => p.project_id === adu.project_id);
        if (project && project.repo_path) {
          repoRoot = project.repo_path;
        }
      }
    }
    if (!repoRoot) {
      const config = loadAppConfig();
      repoRoot = config.workspaceRoot;
    }
    return repoRoot;
  }
}

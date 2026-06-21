import fs from 'fs';
import path from 'path';
import { loadAppConfig } from '../config';
import { OperatorOverride } from '../domain/operator-override';

export class OperatorOverrideService {
  private static instance: OperatorOverrideService;

  private constructor() {}

  public static getInstance(): OperatorOverrideService {
    if (!OperatorOverrideService.instance) {
      OperatorOverrideService.instance = new OperatorOverrideService();
    }
    return OperatorOverrideService.instance;
  }

  private getRegistryDir(): string {
    const config = loadAppConfig();
    return path.join(config.workspaceRoot, '.ai-agent', 'registry');
  }

  public async applyOverride(override: OperatorOverride): Promise<void> {
    const registryDir = this.getRegistryDir();
    const aduJsonPath = path.join(registryDir, 'adu.json');
    if (!fs.existsSync(aduJsonPath)) {
      throw new Error(`adu.json not found at ${aduJsonPath}`);
    }

    let aduData: any;
    try {
      aduData = JSON.parse(fs.readFileSync(aduJsonPath, 'utf-8'));
    } catch (e) {
      throw new Error(`Failed to parse adu.json: ${e}`);
    }

    const adus = aduData.adus || [];
    const adu = adus.find((a: any) => a.id === override.adu_id);
    if (!adu) {
      throw new Error(`ADU ${override.adu_id} not found in registry`);
    }

    if (!adu.human_gate_waivers) {
      adu.human_gate_waivers = [];
    }

    const actionUpper = override.action.toUpperCase();

    // Perform the override action
    if (actionUpper === 'APPROVE_COMMAND_POLICY') {
      const command = override.payload?.command;
      if (!command) {
        throw new Error('Command string is required in payload for approve_command_policy');
      }

      if (!adu.command_policy) {
        adu.command_policy = { allowed_commands: [], blocked_command_patterns: [] };
      }
      if (!adu.command_policy.allowed_commands) {
        adu.command_policy.allowed_commands = [];
      }

      if (!adu.command_policy.allowed_commands.includes(command)) {
        adu.command_policy.allowed_commands.push(command);
      }

      adu.human_gate_waivers.push({
        type: 'command_policy',
        command,
        approved_by: override.approved_by,
        override_notes: override.override_notes,
        timestamp: override.timestamp
      });

    } else if (actionUpper === 'APPROVE_ENVIRONMENT_WAIVER') {
      adu.human_gate_waivers.push({
        type: 'environment',
        assertion_ids: override.payload?.assertion_ids || [],
        approved_by: override.approved_by,
        override_notes: override.override_notes,
        timestamp: override.timestamp
      });

    } else if (actionUpper === 'FORCE_STEP' || actionUpper === 'REVERT_STATE') {
      const targetState = override.payload?.target_state;
      if (!targetState) {
        throw new Error('target_state is required in payload for FORCE_STEP / REVERT_STATE');
      }

      adu.state = targetState;
      if (override.payload?.target_step !== undefined) {
        adu.current_step = override.payload.target_step;
      }
      if (override.payload?.target_phase !== undefined) {
        adu.current_phase = override.payload.target_phase;
      }
      // Clear pre_gate_state if we're forcing past a human gate
      if (adu.pre_gate_state) {
        delete adu.pre_gate_state;
      }

    } else if (actionUpper === 'RESET_BUDGET') {
      if (!adu.token_budget) {
        adu.token_budget = {};
      }
      if (override.payload?.warning_ratio !== undefined) {
        adu.token_budget.warning_ratio = override.payload.warning_ratio;
      }
      if (override.payload?.hard_limit !== undefined) {
        adu.token_budget.hard_limit = override.payload.hard_limit;
      }

    } else if (actionUpper === 'SUSPEND_RUN') {
      const paused = override.payload?.paused;
      if (paused === undefined) {
        throw new Error('paused boolean is required in payload for SUSPEND_RUN');
      }
      adu.paused = paused;

    } else {
      throw new Error(`Unsupported override action: ${override.action}`);
    }

    // Write back adu.json
    fs.writeFileSync(aduJsonPath, JSON.stringify(aduData, null, 2) + '\n', 'utf-8');

    // Cancel active orchestrator run if mutating state or suspending
    if (['FORCE_STEP', 'REVERT_STATE', 'SUSPEND_RUN'].includes(actionUpper)) {
      const config = loadAppConfig();
      const projectId = adu.project_id || 'default-open5gs';
      const lockPath = path.join(config.workspaceRoot, '.ai-agent', 'locks', `${projectId}__${override.adu_id}.lock`);
      if (fs.existsSync(lockPath)) {
        try {
          const lockContent = fs.readFileSync(lockPath, 'utf-8');
          const lockData = JSON.parse(lockContent);
          const pid = lockData.pid;
          if (pid) {
            try {
              process.kill(pid, 'SIGTERM');
              // Optional delay before force kill if process is stubborn
              setTimeout(() => {
                try { process.kill(pid, 'SIGKILL'); } catch (e) {}
              }, 500);
            } catch (err) {}
          }
          fs.unlinkSync(lockPath);
        } catch (e) {}
      }

      // Remove from memory activeOrchestrators
      try {
        const { activeOrchestrators } = require('../websocket/broadcaster');
        if (activeOrchestrators) {
          activeOrchestrators.delete(override.adu_id);
        }
      } catch (e) {}
    }

    // Write audit log to operator-overrides.json
    const overridesPath = path.join(registryDir, 'operator-overrides.json');
    let overridesData: any = { version: 1, overrides: [] };
    if (fs.existsSync(overridesPath)) {
      try {
        overridesData = JSON.parse(fs.readFileSync(overridesPath, 'utf-8'));
      } catch (e) {
        // overwrite corrupted file
      }
    }
    if (!overridesData.overrides) {
      overridesData.overrides = [];
    }
    overridesData.overrides.push(override);
    fs.writeFileSync(overridesPath, JSON.stringify(overridesData, null, 2) + '\n', 'utf-8');
  }
}

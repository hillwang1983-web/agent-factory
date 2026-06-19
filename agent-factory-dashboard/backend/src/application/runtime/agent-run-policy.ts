/**
 * Agent run policy loader — TypeScript counterpart of scripts/agent_run_policy.py.
 * Loads and validates .ai-agent/policies/agent-run-policy.json for frontend display
 * and for backend-side budget pre-checks.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface AgentRunPolicyConfig {
  max_duration_seconds: number;
  no_progress_timeout_seconds: number;
  termination_grace_seconds: number;
  max_prompt_bytes: number;
  max_estimated_input_tokens: number;
}

export interface AgentRunPolicyFile {
  version: number;
  defaults: AgentRunPolicyConfig;
  agents: Record<string, Partial<AgentRunPolicyConfig>>;
}

const DEFAULT_POLICY: AgentRunPolicyConfig = {
  max_duration_seconds: 600,
  no_progress_timeout_seconds: 180,
  termination_grace_seconds: 5,
  max_prompt_bytes: 120000,
  max_estimated_input_tokens: 30000,
};

export class AgentRunPolicyLoader {
  constructor(private readonly workspaceRoot: string) {}

  /**
   * Load and validate the entire policy file.
   */
  load(): AgentRunPolicyFile {
    const policyPath = path.join(this.workspaceRoot, '.ai-agent', 'policies', 'agent-run-policy.json');
    if (!fs.existsSync(policyPath)) {
      return { version: 1, defaults: { ...DEFAULT_POLICY }, agents: {} };
    }

    try {
      const raw = JSON.parse(fs.readFileSync(policyPath, 'utf-8'));
      return this.validate(raw);
    } catch (e) {
      // File exists but is malformed — throw, don't silently use defaults
      if (e instanceof SyntaxError) {
        throw new Error(`Invalid agent-run-policy.json: ${e.message}`);
      }
      throw e;
    }
  }

  /**
   * Get policy for a specific agent, merged with defaults.
   */
  getForAgent(agentId: string): AgentRunPolicyConfig {
    const policy = this.load();
    const agentOverrides = policy.agents[agentId] || {};
    return {
      ...DEFAULT_POLICY,
      ...policy.defaults,
      ...agentOverrides,
    };
  }

  private validate(raw: any): AgentRunPolicyFile {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid agent-run-policy.json: not an object');
    }
    if (raw.version !== 1) {
      throw new Error(`Invalid agent-run-policy.json version: ${raw.version}`);
    }

    const validateConfig = (cfg: any, label: string): AgentRunPolicyConfig => {
      for (const field of ['max_duration_seconds', 'no_progress_timeout_seconds',
        'termination_grace_seconds', 'max_prompt_bytes', 'max_estimated_input_tokens']) {
        if (cfg[field] !== undefined) {
          if (typeof cfg[field] !== 'number' || cfg[field] <= 0) {
            throw new Error(`${label}.${field} must be a positive number, got: ${cfg[field]}`);
          }
        }
      }
      return { ...DEFAULT_POLICY, ...cfg };
    };

    const defaults = validateConfig(raw.defaults || {}, 'defaults');
    const agents: Record<string, Partial<AgentRunPolicyConfig>> = {};

    if (raw.agents && typeof raw.agents === 'object') {
      for (const [agentId, cfg] of Object.entries(raw.agents)) {
        if (cfg && typeof cfg === 'object') {
          agents[agentId] = validateConfig(cfg, `agents.${agentId}`);
        }
      }
    }

    return { version: 1, defaults, agents };
  }
}

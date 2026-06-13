import fs from 'fs';
import path from 'path';
import { loadAppConfig } from '../config';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface TokenBudgetConfig {
  version: number;
  defaults: {
    warning_input_tokens: number;
    hard_input_tokens: number;
    warning_output_tokens: number;
    hard_output_tokens: number;
    max_context_artifact_bytes: number;
    max_history_runs: number;
  };
  agent_budgets: Record<string, {
    warning_input_tokens?: number;
    hard_input_tokens?: number;
  }>;
  context_policy: {
    knowledge_pack_mode: string;
    run_history_mode: string;
    artifact_mode: string;
    diff_mode: string;
  };
}

const DEFAULT_CONFIG: TokenBudgetConfig = {
  version: 1,
  defaults: {
    warning_input_tokens: 1200000,
    hard_input_tokens: 3000000,
    warning_output_tokens: 120000,
    hard_output_tokens: 300000,
    max_context_artifact_bytes: 200000,
    max_history_runs: 6
  },
  agent_budgets: {
    'requirement-analyst': {
      warning_input_tokens: 800000,
      hard_input_tokens: 1500000
    },
    'developer': {
      warning_input_tokens: 1500000,
      hard_input_tokens: 3500000
    },
    'acceptance-reviewer': {
      warning_input_tokens: 1000000,
      hard_input_tokens: 2000000
    }
  },
  context_policy: {
    knowledge_pack_mode: 'selective',
    run_history_mode: 'summarized',
    artifact_mode: 'referenced_with_snippets',
    diff_mode: 'relevant_files_only'
  }
};

export class TokenGovernanceService {
  private static instance: TokenGovernanceService;

  private constructor() {}

  public static getInstance(): TokenGovernanceService {
    if (!TokenGovernanceService.instance) {
      TokenGovernanceService.instance = new TokenGovernanceService();
    }
    return TokenGovernanceService.instance;
  }

  private getRegistryDir(): string {
    const config = loadAppConfig();
    return path.join(config.workspaceRoot, '.ai-agent', 'registry');
  }

  getBudgetConfig(): TokenBudgetConfig {
    const file = path.join(this.getRegistryDir(), 'token-governance.json');
    if (!fs.existsSync(file)) return DEFAULT_CONFIG;
    try {
      const content = fs.readFileSync(file, 'utf-8');
      return JSON.parse(content) as TokenBudgetConfig;
    } catch (_) {
      return DEFAULT_CONFIG;
    }
  }

  updateBudgetConfig(patch: Partial<TokenBudgetConfig>): void {
    const config = this.getBudgetConfig();
    const updated = {
      ...config,
      ...patch,
      defaults: {
        ...config.defaults,
        ...(patch.defaults || {})
      },
      agent_budgets: {
        ...config.agent_budgets,
        ...(patch.agent_budgets || {})
      },
      context_policy: {
        ...config.context_policy,
        ...(patch.context_policy || {})
      }
    };
    const dir = this.getRegistryDir();
    const file = path.join(dir, 'token-governance.json');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  }

  async estimateNextRun(aduId: string, agent: string): Promise<any> {
    const config = loadAppConfig();
    const scriptPath = path.join(config.workspaceRoot, 'scripts', 'context_budget.py');
    const registryDir = this.getRegistryDir();

    if (!fs.existsSync(scriptPath)) {
      // Return a mock fallback estimation if script is missing
      return {
        estimated_input_tokens: 150000,
        budget_status: 'ok',
        breakdown: {
          system_prompt: 10000,
          project_profile: 15000,
          knowledge_pack: 35000,
          run_history: 40000,
          artifacts: 30000,
          diff: 20000
        },
        recommended_truncations: []
      };
    }

    try {
      const { stdout } = await execFileAsync('python3', [
        scriptPath,
        '--agent', agent,
        '--adu', aduId,
        '--repo-root', config.workspaceRoot,
        '--registry-dir', registryDir,
        '--mode', 'estimate'
      ]);
      return JSON.parse(stdout);
    } catch (err: any) {
      // Fallback
      return {
        estimated_input_tokens: 180000,
        budget_status: 'warning',
        breakdown: {
          system_prompt: 12000,
          project_profile: 20000,
          knowledge_pack: 40000,
          run_history: 50000,
          artifacts: 38000,
          diff: 20000
        },
        recommended_truncations: [
          {
            source: 'run_history',
            action: 'summarize',
            expected_saving_tokens: 25000
          }
        ]
      };
    }
  }
}

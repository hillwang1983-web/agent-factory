import fs from 'fs/promises';
import path from 'path';
import pino from 'pino';
import { loadAppConfig } from '../config';

const config = loadAppConfig();

export class TokenBudgetRepository {
  private readonly budgetPath: string;
  private readonly logger: pino.Logger;

  constructor(logger: pino.Logger, budgetPath?: string) {
    this.budgetPath = budgetPath ?? path.join(config.workspaceRoot, '.ai-agent', 'registry', 'token-budget.json');
    this.logger = logger.child({ component: 'TokenBudgetRepository' });
  }

  async readBudget(): Promise<any> {
    try {
      const content = await fs.readFile(this.budgetPath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        this.logger.warn({ path: this.budgetPath }, 'Token budget file not found, returning empty object');
        return {};
      }
      this.logger.error({ err, path: this.budgetPath }, 'Failed to read token budget');
      throw err;
    }
  }

  async checkBudget(agentName: string, usage: { input?: number; output?: number }): Promise<{ warning: boolean; block: boolean; details?: string }> {
    const budget = await this.readBudget();
    const agentBudget = (budget.agents || {})[agentName] || {};
    const inputLimit = agentBudget.inputTokenLimit ?? Infinity;
    const outputLimit = agentBudget.outputTokenLimit ?? Infinity;
    const warnRatio = agentBudget.warnRatio ?? 0.9;
    let warning = false;
    let block = false;
    let details = '';
    if (usage.input && inputLimit !== Infinity) {
      if (usage.input > inputLimit) block = true;
      else if (usage.input > inputLimit * warnRatio) warning = true;
    }
    if (usage.output && outputLimit !== Infinity) {
      if (usage.output > outputLimit) block = true;
      else if (usage.output > outputLimit * warnRatio) warning = true;
    }
    if (warning) details = 'Token usage approaching limit';
    if (block) details = 'Token usage exceeded limit';
    return { warning, block, details };
  }

  private get aduPath(): string {
    return path.join(config.workspaceRoot, '.ai-agent', 'registry', 'adu.json');
  }

  private async loadAdu(): Promise<any> {
    const content = await fs.readFile(this.aduPath, 'utf-8');
    return JSON.parse(content);
  }

  private async saveAdu(data: any): Promise<void> {
    const tmp = this.aduPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
    await fs.rename(tmp, this.aduPath);
  }

  async setPauseStatus(aduId: string, paused: boolean): Promise<void> {
    const data = await this.loadAdu();
    const adu = data.adus.find((a: any) => a.id === aduId);
    if (adu) {
      adu.paused = paused;
      await this.saveAdu(data);
    }
  }

  async getPauseStatus(aduId: string): Promise<boolean> {
    const data = await this.loadAdu();
    const adu = data.adus.find((a: any) => a.id === aduId);
    return !!adu?.paused;
  }
}

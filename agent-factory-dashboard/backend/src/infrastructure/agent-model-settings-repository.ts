import fs from 'fs/promises';
import path from 'path';
import pino from 'pino';
import { loadAppConfig } from '../config';

const config = loadAppConfig();

export interface AgentModelSettings {
  [agentName: string]: {
    provider?: string;
    model?: string;
  };
}

export class AgentModelSettingsRepository {
  private readonly settingsPath: string;
  private readonly logger: pino.Logger;

  constructor(settingsPath?: string, logger?: pino.Logger) {
    this.logger = logger ?? pino();
    this.settingsPath = settingsPath ?? path.join(config.workspaceRoot, '.ai-agent', 'registry', 'agent-model-settings.json');
  }

  async readSettings(): Promise<AgentModelSettings> {
    try {
      const content = await fs.readFile(this.settingsPath, 'utf-8');
      return JSON.parse(content) as AgentModelSettings;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        this.logger.warn({ path: this.settingsPath }, 'Agent model settings not found, returning empty object');
        return {};
      }
      this.logger.error({ err, path: this.settingsPath }, 'Failed to read agent model settings');
      throw err;
    }
  }

  async writeSettings(settings: AgentModelSettings): Promise<void> {
    const dir = path.dirname(this.settingsPath);
    await fs.mkdir(dir, { recursive: true });
    const content = JSON.stringify(settings, null, 2);
    await fs.writeFile(this.settingsPath, content, { encoding: 'utf-8' });
  }
}

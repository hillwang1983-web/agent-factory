import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import pino from 'pino';
import YAML from 'yaml';

export type HermesModelOption = {
  provider: string;
  model: string;
  label: string;
  isDefault: boolean;
  source: 'hermes-config';
};

export type HermesConfig = {
  models: HermesModelOption[];
  defaultModel: string | null;
  defaultProvider: string | null;
};

interface RawHermesConfig {
  model?: {
    default?: string;
    provider?: string;
  };
  providers?: Record<string, {
    models?: string[] | Record<string, unknown>;
  }>;
}

export class HermesConfigRepository {
  private readonly configPath: string;
  private readonly logger: pino.Logger;

  constructor(logger: pino.Logger, configPath?: string) {
    this.configPath = configPath ?? path.join(os.homedir(), '.hermes', 'config.yaml');
    this.logger = logger.child({ component: 'HermesConfigRepository' });
  }

  async readConfig(): Promise<HermesConfig> {
    const hermesDir = path.dirname(this.configPath);

    // Load models_dev_cache.json — used as fallback when a provider lists no models
    let cacheData: any = null;
    const cachePath = path.join(hermesDir, 'models_dev_cache.json');
    try {
      cacheData = JSON.parse(await fs.readFile(cachePath, 'utf-8'));
    } catch (e) {
      this.logger.debug({ cachePath }, 'No models_dev_cache.json found');
    }

    // Collect all config sources: global config + all profile configs
    const configSources: RawHermesConfig[] = [];

    // Global config
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const parsed = YAML.parse(content) as RawHermesConfig;
      if (parsed) configSources.push(parsed);
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        this.logger.error({ err, path: this.configPath }, 'Failed to read Hermes config');
        throw err;
      }
      this.logger.warn({ path: this.configPath }, 'Hermes config not found');
    }

    // Profile configs — each profile in ~/.hermes/profiles/<name>/config.yaml
    const profilesDir = path.join(hermesDir, 'profiles');
    try {
      const profileNames = await fs.readdir(profilesDir);
      for (const profileName of profileNames) {
        const profileConfigPath = path.join(profilesDir, profileName, 'config.yaml');
        try {
          const content = await fs.readFile(profileConfigPath, 'utf-8');
          const parsed = YAML.parse(content) as RawHermesConfig;
          if (parsed) configSources.push(parsed);
        } catch {
          // profile has no config.yaml or it's unreadable — skip
        }
      }
    } catch {
      // no profiles directory — fine
    }

    if (configSources.length === 0) {
      return { models: [], defaultModel: null, defaultProvider: null };
    }

    // Use model defaults from the first source that defines them
    const primarySource = configSources[0];
    const defaultModel = primarySource.model?.default ?? null;
    const defaultProvider = primarySource.model?.provider ?? null;

    // Merge providers across all sources; last write wins for duplicate provider+model pairs
    const seenKeys = new Set<string>();
    const models: HermesModelOption[] = [];

    const pushModels = (providerName: string, rawModels: string[] | Record<string, unknown>) => {
      const list = Array.isArray(rawModels) ? rawModels : Object.keys(rawModels);
      for (const modelId of list) {
        if (typeof modelId !== 'string') continue;
        const key = `${providerName}/${modelId}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        models.push({
          provider: providerName,
          model: modelId,
          label: `${providerName} / ${modelId}`,
          isDefault: modelId === defaultModel,
          source: 'hermes-config',
        });
      }
    };

    for (const src of configSources) {
      if (!src.providers) continue;
      for (const [providerName, providerConf] of Object.entries(src.providers)) {
        let rawModels = providerConf?.models;

        // If no models listed in config, fall back to cache
        if (!rawModels || (Array.isArray(rawModels) ? rawModels.length === 0 : Object.keys(rawModels).length === 0)) {
          rawModels = cacheData?.[providerName]?.models ?? null;
        }

        if (rawModels) pushModels(providerName, rawModels as string[] | Record<string, unknown>);
      }
    }

    return { models, defaultModel, defaultProvider };
  }
}

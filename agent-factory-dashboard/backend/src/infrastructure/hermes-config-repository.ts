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
    let raw: RawHermesConfig;

    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      raw = YAML.parse(content) as RawHermesConfig;
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        this.logger.warn({ path: this.configPath }, 'Hermes config not found, returning empty model list');
        return { models: [], defaultModel: null, defaultProvider: null };
      }
      this.logger.error({ err, path: this.configPath }, 'Failed to read Hermes config');
      throw err;
    }

    if (!raw) {
      return { models: [], defaultModel: null, defaultProvider: null };
    }

    const defaultModel = raw.model?.default ?? null;
    const defaultProvider = raw.model?.provider ?? null;

    const models: HermesModelOption[] = [];

    // Attempt to load models_dev_cache.json from the same directory as config.yaml
    let cacheData: any = null;
    const cachePath = path.join(path.dirname(this.configPath), 'models_dev_cache.json');
    try {
      const cacheContent = await fs.readFile(cachePath, 'utf-8');
      cacheData = JSON.parse(cacheContent);
    } catch (e) {
      this.logger.debug({ cachePath }, 'No models_dev_cache.json found at config dir or failed to parse it');
    }

    if (raw.providers) {
      for (const [providerName, providerConf] of Object.entries(raw.providers)) {
        let rawModels = providerConf?.models;

        // If config.yaml has no models specified for this provider, try to load from cacheData
        if (!rawModels || (Array.isArray(rawModels) && rawModels.length === 0) || (typeof rawModels === 'object' && Object.keys(rawModels).length === 0)) {
          if (cacheData && cacheData[providerName] && cacheData[providerName].models) {
            rawModels = cacheData[providerName].models;
          }
        }

        if (rawModels) {
          if (Array.isArray(rawModels)) {
            for (const modelId of rawModels) {
              if (typeof modelId === 'string') {
                models.push({
                  provider: providerName,
                  model: modelId,
                  label: `${providerName} / ${modelId}`,
                  isDefault: modelId === defaultModel,
                  source: 'hermes-config',
                });
              }
            }
          } else if (typeof rawModels === 'object' && rawModels !== null) {
            for (const modelId of Object.keys(rawModels)) {
              models.push({
                provider: providerName,
                model: modelId,
                label: `${providerName} / ${modelId}`,
                isDefault: modelId === defaultModel,
                source: 'hermes-config',
              });
            }
          }
        }
      }
    }

    return { models, defaultModel, defaultProvider };
  }
}

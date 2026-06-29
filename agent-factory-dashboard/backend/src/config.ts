import path from 'path';
import {
  parseAllowedProjectRoots,
  resolveHermesConfigPath,
  resolveWorkspaceRoot,
} from './config-paths';

export interface AppConfig {
  port: number;
  wsPort: number;
  host: string;
  workspaceRoot: string;
  hermesConfigPath: string;
  artifactMaxBytes: number;
  pollIntervalMs: number;
  corsOrigin: string;
  enableControl: boolean;
  projectsRegistryPath: string;
  allowProjectPaths: string[];
}

export function loadAppConfig(): AppConfig {
  const workspaceRoot = resolveWorkspaceRoot(
    process.env.AGENT_FACTORY_WORKSPACE,
    path.resolve(__dirname, '..', '..')
  );
  const projectsRegistryPath =
    process.env.AGENT_FACTORY_PROJECTS_REGISTRY ||
    path.join(workspaceRoot, '.ai-agent', 'registry', 'projects.json');
  const allowProjectPaths = parseAllowedProjectRoots(
    process.env.AGENT_FACTORY_ALLOWED_PROJECT_ROOTS,
    workspaceRoot
  );

  return {
    port: parseInt(process.env.PORT || '3011', 10),
    wsPort: parseInt(process.env.WS_PORT || '3012', 10),
    host: process.env.HOST || '0.0.0.0',
    workspaceRoot,
    hermesConfigPath: resolveHermesConfigPath(process.env.HERMES_CONFIG_PATH),
    artifactMaxBytes: parseInt(process.env.AGENT_FACTORY_ARTIFACT_MAX_BYTES || '100000', 10),
    pollIntervalMs: parseInt(process.env.AGENT_FACTORY_POLL_INTERVAL_MS || '3000', 10),
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5175',
    enableControl: process.env.AGENT_FACTORY_ENABLE_CONTROL === 'true', // 默认为 false，纯只读监控
    projectsRegistryPath,
    allowProjectPaths,
  };
}

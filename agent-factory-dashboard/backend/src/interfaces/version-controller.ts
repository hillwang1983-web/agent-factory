import { Router } from 'express';
import { loadAppConfig } from '../config';
import fs from 'fs';
import path from 'path';

export interface AgentFactoryRuntimeInfo {
  phase: '3.7';
  api_version: '2026-06-19';
  build_commit: string;
  build_time: string;
  dirty: boolean;
  control_enabled: boolean;
  capabilities: string[];
}

export function createVersionRouter(): Router {
  const router = Router();
  const config = loadAppConfig();

  // Cache build info to avoid real-time git execution
  let buildCommit = process.env.AGENT_FACTORY_BUILD_COMMIT || 'unknown';
  let buildTime = new Date().toISOString();
  let dirty = false;

  try {
    const buildInfoPath = path.join(process.cwd(), 'build-info.json');
    if (fs.existsSync(buildInfoPath)) {
      const info = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
      if (info.build_commit) buildCommit = info.build_commit;
      if (info.build_time) buildTime = info.build_time;
      if (typeof info.dirty === 'boolean') dirty = info.dirty;
    }
  } catch (e) {
    // ignore
  }

  router.get('/runtime-info', (_req, res) => {
    res.json({
      phase: '3.7',
      api_version: '2026-06-19',
      build_commit: buildCommit,
      build_time: buildTime,
      dirty,
      control_enabled: config.enableControl,
      capabilities: ['operator-control']
    } as AgentFactoryRuntimeInfo);
  });

  return router;
}

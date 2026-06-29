import express from 'express';
import * as path from 'path';
import cors from 'cors';
import compression from 'compression';
import pino from 'pino';
import { loadAppConfig } from './config';
import { FileAgentFactoryRepository } from './infrastructure/file-agent-factory-repository';
import { AgentFactoryMonitorUseCase } from './application/agent-factory-monitor';
import { createAgentFactoryRouter } from './interfaces/agent-factory-controller';
import { initializeWebSocketServer } from './websocket/broadcaster';
import { FileProjectRepository } from './infrastructure/file-project-repository';
import { ProjectOnboardingUseCase } from './application/project-onboarding';
import { ProjectAduFactory } from './application/project-adu-factory';
import { AduIntake } from './application/adu-intake';
import { EpicFactory } from './application/epic-factory';
import { createVersionRouter } from './interfaces/version-controller';
import { IntakeGenerationService } from './application/intake/intake-generation-service';

async function main() {
  const config = loadAppConfig();

  const logger = pino({
    level: 'info',
  });

  logger.info({ config }, 'Starting Standalone Agent Factory Dashboard Backend');

  const repo = new FileAgentFactoryRepository(config.workspaceRoot, config.artifactMaxBytes, logger);
  const monitor = new AgentFactoryMonitorUseCase(repo);

  const projectRepo = new FileProjectRepository(config.projectsRegistryPath, config.workspaceRoot, config.allowProjectPaths, logger);
  const projectOnboarding = new ProjectOnboardingUseCase(projectRepo, config.workspaceRoot, logger);

  const aduFactory = new ProjectAduFactory(projectRepo, repo);
  const epicFactory = new EpicFactory(projectRepo, repo);
  const generationService = new IntakeGenerationService(
    config.workspaceRoot,
    async () => path.join(config.workspaceRoot, '.ai-agent', 'registry', 'intake-drafts.json'),
    () => path.join(config.workspaceRoot, '.ai-agent', 'registry', 'intake-operations.json')
  );
  await generationService.recover();

  const aduIntake = new AduIntake(projectRepo, aduFactory, config.workspaceRoot, epicFactory, generationService);

  // Initialize WS Broadcaster
  initializeWebSocketServer(config.wsPort, config.host, monitor, config.pollIntervalMs, logger);

  const app = express();

  app.use(cors({
    origin: config.corsOrigin,
    credentials: true,
  }));
  app.use(compression());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Basic health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      workspace: config.workspaceRoot,
      controlEnabled: config.enableControl,
    });
  });

  // Mount routes
  app.use('/api/agent-factory', createAgentFactoryRouter(monitor, projectOnboarding, projectRepo, repo, logger, aduIntake, epicFactory));
  app.use('/api/agent-factory', createVersionRouter());

  // Error handling middleware
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'Unhandled request error encountered');
    if (err.error_code) {
      return res.status(err.status || 400).json({
        success: false,
        error_code: err.error_code,
        message: err.message,
        retryable: err.retryable !== false,
        target_id: err.target_id,
        operation_id: err.operation_id,
        details: err.details,
      });
    }
    res.status(err.status || 500).json({
      success: false,
      error_code: 'INTERNAL_ERROR',
      message: err.message || 'Internal server error',
      retryable: false,
    });
  });

  app.listen(config.port, config.host, () => {
    logger.info({ port: config.port, host: config.host }, 'HTTP Server running');
  });
}

main().catch((err) => {
  console.error('Fatal backend execution error:', err);
  process.exit(1);
});

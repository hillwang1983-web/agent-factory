import { WebSocketServer, WebSocket } from 'ws';
import type { AgentFactoryMonitorUseCase } from '../application/agent-factory-monitor';
import type { Logger } from 'pino';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();
export const activeOrchestrators = new Set<string>();

let wssLogger: Logger | null = null;

/**
 * Initialize WebSocket server for dashboard live status updates.
 */
export function initializeWebSocketServer(
  port: number,
  host: string,
  monitor: AgentFactoryMonitorUseCase,
  pollIntervalMs: number,
  logger: Logger
): WebSocketServer {
  wssLogger = logger;
  wss = new WebSocketServer({ port, host });
  logger.info({ port, host }, 'WebSocket status server started');

  wss.on('connection', (ws) => {
    logger.debug('New live dashboard WS client connected');
    clients.add(ws);

    // Send initial dashboard state immediately on connection
    void (async () => {
      try {
        const dashboard = await monitor.getDashboard(activeOrchestrators);
        ws.send(JSON.stringify({
          type: 'agent_factory_status',
          payload: dashboard
        }));
      } catch (err) {
        logger.error({ err }, 'Failed to send initial dashboard status over WS');
      }
    })();

    ws.on('close', () => {
      clients.delete(ws);
      logger.debug('WS client disconnected');
    });

    ws.on('error', (err) => {
      clients.delete(ws);
      logger.error({ err }, 'WS client error encountered');
    });
  });

  // Background dashboard status polling & broadcast
  setInterval(async () => {
    if (clients.size === 0) return;
    try {
      const dashboard = await monitor.getDashboard(activeOrchestrators);
      const payload = JSON.stringify({
        type: 'agent_factory_status',
        payload: dashboard
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    } catch (err) {
      logger.error({ err }, 'WS dashboard polling error');
    }
  }, pollIntervalMs);

  return wss;
}

/**
 * Broadcast an orchestrator event to all connected clients.
 */
export function broadcastOrchestratorEvent(event: Record<string, any>) {
  if (
    (event.type === 'agent_factory_orchestrator_event' && event.payload && event.payload.state === 'human_gate') ||
    (event.event === 'state_changed' && event.state === 'human_gate')
  ) {
    const payload = event.payload || event;
    const aduId = payload.adu_id || payload.adu;
    const gateType = payload.gate_type || (payload.action === 'paused_at_write_path_gate' ? 'write_path_expansion' : 'environment_verification_required');
    const sourceAgent = payload.agent_id || payload.agent || 'developer';
    const affectedAssertions = payload.affected_assertions || [];

    // Open human gate asynchronously
    import('../application/human-gate-service').then(({ HumanGateService }) => {
      const humanGateService = HumanGateService.getInstance();
      return humanGateService.openGate({
        scope: 'adu',
        target_id: aduId,
        gate_type: gateType as any,
        title: gateType === 'write_path_expansion' ? 'Write Path Expansion Required' : 'Runtime Evidence Required',
        reason: gateType === 'write_path_expansion' ? 'Proposed modifications affect derived files. Approval required.' : 'Acceptance testing requires environment verification.',
        source_agent: sourceAgent,
        pre_gate_state: 'debugged', // default/fallback
        affected_assertions: affectedAssertions
      });
    }).catch(err => {
      if (wssLogger) {
        wssLogger.error({ err }, 'Failed to auto-open human gate via event subscription');
      } else {
        console.error('Failed to auto-open human gate via event subscription:', err);
      }
    });
  }

  if (clients.size === 0) return;
  const payload = JSON.stringify({
    type: 'agentFactoryEvent',
    payload: event,
  });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

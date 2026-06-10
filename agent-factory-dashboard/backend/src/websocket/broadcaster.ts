import { WebSocketServer, WebSocket } from 'ws';
import type { AgentFactoryMonitorUseCase } from '../application/agent-factory-monitor';
import type { Logger } from 'pino';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();
export const activeOrchestrators = new Set<string>();

/**
 * Initialize WebSocket server for dashboard live status updates.
 */
export function initializeWebSocketServer(
  port: number,
  monitor: AgentFactoryMonitorUseCase,
  pollIntervalMs: number,
  logger: Logger
): WebSocketServer {
  wss = new WebSocketServer({ port, host: '0.0.0.0' });
  logger.info({ port }, 'WebSocket status server started');

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

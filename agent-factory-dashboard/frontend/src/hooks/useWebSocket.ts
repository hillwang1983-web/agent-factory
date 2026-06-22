import { useEffect, useRef, useState } from 'react';
import { useAgentFactoryStore } from '../stores/agentFactory';
import { resolveWebSocketUrl } from './websocket-url';

const WS_URL = resolveWebSocketUrl(
  import.meta.env.VITE_WS_URL,
  window.location,
  import.meta.env.VITE_WS_PORT || '3012',
);

export type WebSocketStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

export function useWebSocket(enabled: boolean): WebSocketStatus {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const [status, setStatus] = useState<WebSocketStatus>('idle');

  useEffect(() => {
    if (!enabled) {
      wsRef.current?.close();
      wsRef.current = null;
      reconnectAttempts.current = 0;
      setStatus('idle');
      return undefined;
    }

    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket;
    let stopped = false;

    const connect = (): void => {
      if (stopped) return;
      setStatus((current) => (current === 'connected' ? current : 'connecting'));
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempts.current = 0;
        setStatus('connected');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === 'agent_factory_status') {
            useAgentFactoryStore.getState().setDashboard(msg.payload);
          } else if (msg.type === 'agentFactoryEvent') {
            const store = useAgentFactoryStore.getState();
            if (msg.event === 'project_profiling_started') {
              store.setProjectProfilingState(msg.projectId, true);
            } else if (msg.event === 'project_profiling_log') {
              store.addProfilingLog(msg.projectId, msg.log);
            } else if (msg.event === 'project_profiling_completed') {
              store.setProjectProfilingState(msg.projectId, false);
              void store.refresh();
            } else {
              void store.refresh();
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        reconnectAttempts.current += 1;
        setStatus('disconnected');
        const delay = Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempts.current, 5));
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        setStatus('disconnected');
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [enabled]);

  return status;
}

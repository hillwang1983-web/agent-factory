import { describe, expect, it } from 'vitest';
import { resolveWebSocketUrl } from '../src/hooks/websocket-url';

describe('resolveWebSocketUrl', () => {
  it('uses the browser host when no explicit URL is configured', () => {
    expect(resolveWebSocketUrl(undefined, {
      protocol: 'http:',
      hostname: '192.168.1.33',
    })).toBe('ws://192.168.1.33:3012');
  });

  it('uses secure WebSocket for an HTTPS page', () => {
    expect(resolveWebSocketUrl(undefined, {
      protocol: 'https:',
      hostname: 'agent-factory.example.com',
    })).toBe('wss://agent-factory.example.com:3012');
  });

  it('keeps an explicit deployment override', () => {
    expect(resolveWebSocketUrl(
      'wss://ws.example.com/agent-factory',
      { protocol: 'https:', hostname: 'dashboard.example.com' },
    )).toBe('wss://ws.example.com/agent-factory');
  });
});

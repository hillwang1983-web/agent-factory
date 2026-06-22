type WebSocketLocation = Pick<Location, 'protocol' | 'hostname'>;

export function resolveWebSocketUrl(
  explicitUrl: string | undefined,
  location: WebSocketLocation,
  port = '3012',
): string {
  if (explicitUrl?.trim()) return explicitUrl.trim();

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const hostname = location.hostname.includes(':')
    ? `[${location.hostname}]`
    : location.hostname;
  return `${protocol}//${hostname}:${port}`;
}

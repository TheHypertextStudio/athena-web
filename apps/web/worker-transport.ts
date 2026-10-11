/** Strip hop-by-hop transport headers without flattening repeated cookies or buffering a body. */
export function transportHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  const connection = headers.get('connection');
  for (const name of connection?.split(',') ?? []) headers.delete(name.trim());
  for (const name of [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]) {
    headers.delete(name);
  }
  return headers;
}

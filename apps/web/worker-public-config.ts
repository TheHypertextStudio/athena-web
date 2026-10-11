import { WorkersPublicConfigOut } from './src/lib/client-public-config-contract';
import type { WorkerRuntimeConfig } from './worker-runtime-config';
import { transportHeaders } from './worker-transport';

const MAX_CONFIG_BYTES = 16_384;
const PASSTHROUGH_REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** This exact GET requires a complete body; ordinary API caching remains untouched. */
export function stripConfigPreconditions(headers: Headers): void {
  for (const name of [
    'if-none-match',
    'if-modified-since',
    'if-match',
    'if-unmodified-since',
    'if-range',
    'range',
  ]) {
    headers.delete(name);
  }
}

/** Read a bounded decoded body, cancelling the upstream stream as soon as it overflows. */
async function readConfigBody(body: ReadableStream<Uint8Array>): Promise<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_CONFIG_BYTES) {
        await reader.cancel();
        throw new Error('Public configuration exceeds its size limit');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Invalidate validators and encoded-body metadata while preserving native repeated cookies. */
function overlayHeaders(source: Headers): Headers {
  const headers = transportHeaders(source);
  for (const name of [
    'etag',
    'last-modified',
    'content-length',
    'content-encoding',
    'content-range',
    'accept-ranges',
    'content-md5',
    'digest',
    'content-digest',
    'repr-digest',
    'cdn-cache-control',
    'cloudflare-cdn-cache-control',
    'surrogate-control',
  ]) {
    headers.delete(name);
  }
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return headers;
}

/** Fail closed without reflecting backend data, configuration or parse errors. */
function invalidConfigResponse(): Response {
  return new Response('Configuration unavailable', {
    status: 502,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** Validate the actual backend object and add only reviewed request-local routing metadata. */
function serializeConfig(value: unknown, config: WorkerRuntimeConfig): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Public configuration must be an object');
  }
  const parsed = WorkersPublicConfigOut.parse({
    ...value,
    apiOrigin: config.apiOrigin,
    sandboxOrigin: config.apiOrigin,
    briefHost: config.briefHostname ?? null,
  });
  const serialized = JSON.stringify(parsed);
  if (new TextEncoder().encode(serialized).byteLength > MAX_CONFIG_BYTES) {
    throw new Error('Public configuration exceeds its size limit');
  }
  return serialized;
}

/**
 * Extend only the gateway-selected exact GET config response, never inventing backend readiness.
 * @param response The original manually redirected upstream response.
 * @param config Validated request-local Worker routing bindings.
 * @returns A bounded uncached config, an unchanged backend error/redirect, or safe 502.
 */
export async function overlayWorkerPublicConfig(
  response: Response,
  config: WorkerRuntimeConfig,
): Promise<Response> {
  if (response.status >= 400 || PASSTHROUGH_REDIRECTS.has(response.status)) return response;
  try {
    if (
      response.status !== 200 ||
      !response.body ||
      !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(
        response.headers.get('content-type') ?? '',
      )
    ) {
      await response.body?.cancel();
      return invalidConfigResponse();
    }
    const body = serializeConfig(await readConfigBody(response.body), config);
    return new Response(body, { status: 200, headers: overlayHeaders(response.headers) });
  } catch {
    return invalidConfigResponse();
  }
}

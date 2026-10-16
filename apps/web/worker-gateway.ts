import { cspHeader, securityHeaders } from './src/lib/response-security';
import { overlayWorkerPublicConfig, stripConfigPreconditions } from './worker-public-config';
import { transportHeaders } from './worker-transport';
import { isWorkerApplicationHost, type WorkerRuntimeConfig } from './worker-runtime-config';

/** Canonical aliases redirect before API forwarding; AASA retains its legacy-host exception. */
export function workerHostRedirect(url: URL, config: WorkerRuntimeConfig): Response | undefined {
  let destination: string | undefined;
  if (url.hostname === `www.${config.appHostname}`) {
    destination = config.appOrigin;
  } else if (
    config.legacyRpHostname !== undefined &&
    url.hostname === `docket.${config.legacyRpHostname}` &&
    url.hostname !== config.appHostname &&
    url.hostname !== config.recoveryHostname
  ) {
    destination = config.appOrigin;
  } else if (
    config.legacyRpHostname !== undefined &&
    config.legacyRpHostname !== config.appHostname &&
    url.hostname === config.legacyRpHostname &&
    url.pathname !== '/.well-known/apple-app-site-association'
  ) {
    destination = config.appOrigin;
  } else if (url.hostname === 'athena.hypertext.studio') {
    destination = 'https://docket.hypertext.studio';
  }
  if (!destination) return undefined;
  return frontendResponse(
    new Response(null, {
      status: 308,
      headers: { Location: `${destination}${url.pathname}${url.search}` },
    }),
    url.pathname,
  );
}

/** Match only the existing backend paths; public-brief host routing stays with native Proxy. */
export function isWorkerApiRequest(url: URL, config: WorkerRuntimeConfig): boolean {
  // Native Next owns its priority trailing-slash 308 before Proxy and backend routing.
  if (url.pathname.endsWith('/')) return false;
  if (url.pathname === '/.well-known/lattice-client.json') return true;
  if (!isWorkerApplicationHost(url.hostname, config)) return false;
  return ['/v1', '/api/auth', '/internal/integrations/github'].some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Replace caller-controlled forwarding metadata at the public Worker boundary.
 * @param request The original public request, whose URL is authoritative on Workers.
 * @param config Explicit local acceptance retains the existing Portless forwarding contract.
 * @returns A streaming request with trusted browser-facing metadata.
 */
export function trustedWorkerRequest(request: Request, config: WorkerRuntimeConfig): Request {
  if (config.local) return request;
  const url = new URL(request.url);
  const headers = transportHeaders(request.headers);
  headers.delete('forwarded');
  headers.set('host', url.host);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
  headers.set('x-forwarded-port', url.port || '443');
  return new Request(request, { headers });
}

/** Preserve Next's existing frontend security policy without buffering the API body or cookies. */
function frontendResponse(response: Response, pathname: string): Response {
  const headers = transportHeaders(response.headers);
  const framing = pathname === '/docs' || pathname.startsWith('/docs/') ? [] : cspHeader;
  for (const { key, value } of [...securityHeaders, ...framing]) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Forward one original backend request with streaming, cancellation and manual redirects.
 * @param request The request after public forwarding metadata has been normalized.
 * @param config The request's validated environment-local API destination.
 * @returns The backend response with the existing frontend security policy.
 */
export async function forwardWorkerApi(
  request: Request,
  config: WorkerRuntimeConfig,
): Promise<Response> {
  const publicUrl = new URL(request.url);
  const upstream = new URL(config.apiOrigin);
  upstream.pathname = publicUrl.pathname;
  upstream.search = publicUrl.search;
  const headers = transportHeaders(request.headers);
  headers.set('host', upstream.host);
  const overlayConfig =
    request.method === 'GET' &&
    publicUrl.pathname === '/v1/config' &&
    isWorkerApplicationHost(publicUrl.hostname, config);
  if (overlayConfig) stripConfigPreconditions(headers);
  const forwarded = new Request(upstream, {
    method: request.method,
    headers,
    body: request.body,
    signal: request.signal,
    redirect: 'manual',
  });
  const response = await fetch(forwarded);
  return frontendResponse(
    overlayConfig ? await overlayWorkerPublicConfig(response, config) : response,
    publicUrl.pathname,
  );
}

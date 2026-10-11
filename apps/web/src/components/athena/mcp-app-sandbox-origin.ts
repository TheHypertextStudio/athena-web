/** Reject provider host syntax that is not a public DNS hostname. */
function publicSandboxHostname(host: string): boolean {
  return (
    host.includes('.') &&
    ![
      /^\[/,
      /^(?:\d{1,3}\.){3}\d{1,3}$/,
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/,
      /\.home\.arpa$/,
    ].some((pattern) => pattern.test(host))
  );
}

/** Validate an explicit sandbox origin against the actual browser origin. */
export function workerSandboxOrigin(value: unknown, browserOrigin: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const api = new URL(value);
    const app = new URL(browserOrigin);
    if (api.origin !== value || api.origin === app.origin) return undefined;
    const local = api.hostname === 'api.docket.localhost' && app.hostname === 'docket.localhost';
    if (local && ['http:', 'https:'].includes(api.protocol)) return api.origin;
    if (api.protocol !== 'https:') return undefined;
    if (!publicSandboxHostname(api.hostname)) return undefined;
    return api.origin;
  } catch {
    return undefined;
  }
}

/** Keep the legacy Node origin fallback outside the Workers sandbox boundary. */
export function sandboxProxyUrl(override?: string): string {
  if (process.env.DOCKET_RUNTIME_TARGET === 'workers') {
    const origin =
      typeof window === 'undefined'
        ? undefined
        : workerSandboxOrigin(override, window.location.origin);
    return origin === undefined ? '' : `${origin}/mcp/apps/sandbox`;
  }
  const origin = override ?? process.env['NEXT_PUBLIC_API_URL'] ?? '';
  return `${origin.replace(/\/$/, '')}/mcp/apps/sandbox`;
}

/** Reject an unavailable Workers sandbox before any iframe is rendered. */
export function sandboxViewFailure(origin: string, failure: string | null): string | null {
  if (process.env.DOCKET_RUNTIME_TARGET === 'workers' && !origin) {
    return 'Interactive view unavailable.';
  }
  return failure;
}

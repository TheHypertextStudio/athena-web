/**
 * The MCP Apps sandbox proxy endpoint.
 *
 * @remarks
 * Deliberately touches no database: the proxy is an inert document, and a test that needed a
 * migrated schema to assert that would be asserting the wrong thing. What matters is that the
 * document is served from the API origin (which is not the web app's), under a policy that keeps
 * it from reaching anywhere, and framable only by the web app.
 */
import { describe, expect, it, vi } from 'vitest';

import { MCP_UI_METHODS } from '@docket/integrations/mcp-apps-contract';

vi.mock('../../src/env', () => ({
  env: {
    WEB_URL: 'https://app.docket.test',
    API_URL: 'https://api.docket.test',
  },
}));

const { mcpAppSandboxHandler, sandboxHostOrigin } = await import('../../src/mcp/apps/sandbox');

/** The handler only reads response construction, so a bare context stands in for Hono's. */
function invoke(): Response {
  return mcpAppSandboxHandler({} as never);
}

describe('sandbox proxy endpoint', () => {
  it('serves the proxy from the API origin under its own policy', async () => {
    const response = invoke();
    expect(response.headers.get('Content-Type')).toContain('text/html');

    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain(`default-src 'none'`);
    // The proxy itself can never phone anywhere, so compromising it cannot become exfiltration.
    expect(csp).toContain(`connect-src 'none'`);
    // Framable only by the web app — and NOT blanket-denied, because being framed is the point.
    expect(csp).toContain('frame-ancestors https://app.docket.test');
    expect(response.headers.get('X-Frame-Options')).toBeNull();

    const html = await response.text();
    expect(html).toContain(MCP_UI_METHODS.sandboxProxyReady);
    expect(html).toContain(MCP_UI_METHODS.sandboxResourceReady);
    // The origin it will accept instructions from is baked in, not inferred at runtime.
    expect(html).toContain('"https://app.docket.test"');
  });

  it('is served from an origin the host page does not share', () => {
    // The spec requires the sandbox and the host to differ in origin; this asserts the deployment
    // shape that makes that true rather than assuming it.
    expect(sandboxHostOrigin()).toBe('https://app.docket.test');
    expect(new URL('https://api.docket.test').origin).not.toBe(sandboxHostOrigin());
  });
});

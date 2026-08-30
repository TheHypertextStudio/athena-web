/**
 * The `@docket/integrations/mcp-apps` subpath entry point.
 *
 * @remarks
 * `mcp-apps.ts` exists precisely so the browser (`apps/web`) can import the MCP Apps host
 * bridge and sandbox proxy without dragging the package's Node-only edges (mail transports,
 * provider HTTP clients, the MCP network guard) into a client bundle — see the file's own
 * doc comment. That guarantee depends entirely on the `export *` lines staying wired to the
 * right modules; nothing else in the suite imports the barrel itself; `mcp-apps-host.test.ts`
 * and `mcp-apps-sandbox.test.ts` reach the underlying files directly. This test imports the
 * subpath the way `apps/web/src/components/athena/mcp-app-view.tsx` really does, so a dropped
 * or renamed re-export line breaks a test instead of silently breaking the browser build.
 */
import { describe, expect, it } from 'vitest';

import * as McpApps from '../../src/mcp-apps';

describe('@docket/integrations/mcp-apps entry point', () => {
  it('re-exports the host bridge surface the browser widget host consumes', () => {
    expect(typeof McpApps.createMcpAppHost).toBe('function');
    expect(typeof McpApps.buildViewCsp).toBe('function');
    expect(typeof McpApps.buildViewPermissionsAllow).toBe('function');
    expect(typeof McpApps.isRenderableUiResource).toBe('function');
    expect(McpApps.MCP_APP_VIEW_SANDBOX).toBe('allow-scripts');
    expect(McpApps.MCP_APP_PROXY_SANDBOX).toBe('allow-scripts allow-same-origin');
    expect(McpApps.JSON_RPC_ERROR).toBeTypeOf('object');
  });

  it('re-exports the sandbox proxy surface the iframe document is built from', () => {
    expect(typeof McpApps.withCspMeta).toBe('function');
    expect(typeof McpApps.sandboxResourceParams).toBe('function');
    expect(typeof McpApps.sandboxProxyDocument).toBe('function');
    expect(typeof McpApps.MCP_APP_SANDBOX_CSP).toBe('string');
    expect(McpApps.MCP_APP_SANDBOX_CSP).toContain(`default-src 'none'`);
  });

  it('actually functions end-to-end through the barrel, not just by name', () => {
    // Exercises the real re-exported implementations (not stand-ins), proving the barrel
    // hands back working functions rather than merely present-but-broken bindings.
    expect(McpApps.buildViewCsp()).toContain(`default-src 'none'`);
    expect(McpApps.withCspMeta('<html><head></head></html>', McpApps.MCP_APP_SANDBOX_CSP)).toBe(
      `<html><head><meta http-equiv="Content-Security-Policy" content="${McpApps.MCP_APP_SANDBOX_CSP}"></head><body></body></html>`,
    );
    expect(McpApps.sandboxProxyDocument('https://host.example')).toContain('https://host.example');
  });
});

/**
 * Compatibility between Athena's MCP Apps facade and the official app implementation.
 *
 * @remarks
 * These tests deliberately put the published {@link App} on the view side of the transport. A
 * handwritten JSON-RPC fixture can agree with a handwritten host by sharing the same mistake;
 * the official app cannot.
 */
import { App } from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';

import { createMcpAppHost, type McpAppHostOptions } from '../../src/mcp-apps-host';

const RESOURCE = {
  uri: 'ui://official/compatibility',
  mimeType: 'text/html;profile=mcp-app',
  text: '<!doctype html><title>Official compatibility</title>',
};

/** Connect the official app to Athena's compatibility facade through an in-memory transport. */
async function officialHarness(overrides: Partial<McpAppHostOptions> = {}) {
  const transport: Transport = {
    start: async () => undefined,
    send: async (message) => host.receive(message),
    close: async () => transport.onclose?.(),
  };
  const host = createMcpAppHost({
    hostInfo: { name: 'docket', version: '1.0.0' },
    resource: RESOURCE,
    post: (message) => transport.onmessage?.(message as JSONRPCMessage),
    ...overrides,
  });
  const app = new App(
    { name: 'official-compatibility-app', version: '1.0.0' },
    { availableDisplayModes: ['inline'] },
    { autoResize: false },
  );
  await app.connect(transport);
  return { app, host };
}

describe('official MCP Apps compatibility', () => {
  it('advertises only the stable browser adapter capabilities Athena implements end to end', async () => {
    const { app } = await officialHarness({
      openLink: () => true,
      callTool: async () => ({ content: [] }),
      sendMessage: () => true,
      readResource: async () => ({}),
      updateModelContext: () => undefined,
      downloadFile: () => true,
      log: () => undefined,
    });

    expect(app.getHostCapabilities()).toEqual({
      openLinks: {},
      serverTools: { listChanged: false },
      message: { text: {} },
      sandbox: { csp: {}, permissions: {} },
    });
  });

  it('keeps the current mode unless both host and app support the requested stable mode', async () => {
    const requestDisplayMode = vi.fn((mode: 'inline' | 'fullscreen' | 'pip') =>
      mode === 'pip' ? 'inline' : mode,
    );
    const { app } = await officialHarness({
      hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] },
      requestDisplayMode,
    });

    await expect(app.requestDisplayMode({ mode: 'fullscreen' })).resolves.toEqual({
      mode: 'inline',
    });
    expect(requestDisplayMode).not.toHaveBeenCalled();
  });

  it('turns an app teardown request into the same graceful teardown handshake before removal', async () => {
    const onRequestTeardown = vi.fn();
    const { app } = await officialHarness({ onRequestTeardown });
    const teardown = vi.fn(async () => ({}));
    app.onteardown = teardown;

    await app.requestTeardown();
    await vi.waitFor(() => {
      expect(teardown).toHaveBeenCalledOnce();
      expect(onRequestTeardown).toHaveBeenCalledOnce();
    });
  });
});

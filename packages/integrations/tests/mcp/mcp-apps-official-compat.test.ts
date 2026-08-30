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
async function officialHarness(
  overrides: Partial<McpAppHostOptions> = {},
  appCapabilities: ConstructorParameters<typeof App>[1] = { availableDisplayModes: ['inline'] },
  beforeConnect?: (app: App) => void,
) {
  const appMessages: JSONRPCMessage[] = [];
  const hostMessages: JSONRPCMessage[] = [];
  const transport: Transport = {
    start: async () => undefined,
    send: async (message) => {
      appMessages.push(message);
      await host.receive(message);
    },
    close: async () => transport.onclose?.(),
  };
  const host = createMcpAppHost({
    hostInfo: { name: 'docket', version: '1.0.0' },
    resource: RESOURCE,
    post: (message) => {
      hostMessages.push(message as JSONRPCMessage);
      transport.onmessage?.(message as JSONRPCMessage);
    },
    ...overrides,
  });
  const app = new App({ name: 'official-compatibility-app', version: '1.0.0' }, appCapabilities, {
    autoResize: false,
  });
  beforeConnect?.(app);
  await app.connect(transport);
  return { app, appMessages, host, hostMessages };
}

describe('official MCP Apps compatibility', () => {
  it('interoperates through the official App across the complete stable lifecycle', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'official result' }],
      structuredContent: { ok: true },
    }));
    const requestDisplayMode = vi.fn((mode: 'inline' | 'fullscreen' | 'pip') => mode);
    const onSizeChanged = vi.fn();
    const openLink = vi.fn(() => true);
    const sendMessage = vi.fn(() => true);
    const toolInput = vi.fn();
    const toolResult = vi.fn();
    const hostContextChanged = vi.fn();
    const { app, appMessages, host } = await officialHarness(
      {
        callTool,
        authorizeTool: () => ({ allowed: true }),
        hostContext: {
          theme: 'light',
          displayMode: 'inline',
          availableDisplayModes: ['inline', 'fullscreen'],
          containerDimensions: { maxWidth: 720, maxHeight: 640 },
        },
        onSizeChanged,
        openLink,
        requestDisplayMode,
        sendMessage,
      },
      { availableDisplayModes: ['inline', 'fullscreen'] },
      (officialApp) => {
        officialApp.addEventListener('toolinput', toolInput);
        officialApp.addEventListener('toolresult', toolResult);
        officialApp.addEventListener('hostcontextchanged', hostContextChanged);
      },
    );

    expect(
      appMessages.slice(0, 2).map((message) => ('method' in message ? message.method : null)),
    ).toEqual(['ui/initialize', 'ui/notifications/initialized']);
    expect(host.initialized).toBe(true);
    expect(app.getHostContext()).toMatchObject({ theme: 'light', displayMode: 'inline' });

    await expect(
      host.receive({ jsonrpc: '2.0', id: 'malformed', method: 'ui/open-link', params: {} }),
    ).resolves.toBeUndefined();

    host.deliverToolInput({ query: 'Athena' });
    host.deliverToolResult({ content: [{ type: 'text', text: 'render this' }] });
    await vi.waitFor(() => {
      expect(toolInput).toHaveBeenCalledWith({ arguments: { query: 'Athena' } });
      expect(toolResult).toHaveBeenCalledWith(
        expect.objectContaining({ content: [{ type: 'text', text: 'render this' }] }),
      );
    });

    await expect(app.callServerTool({ name: 'lookup', arguments: { id: 7 } })).resolves.toEqual(
      expect.objectContaining({ structuredContent: { ok: true } }),
    );
    expect(callTool).toHaveBeenCalledWith('lookup', { id: 7 });
    await expect(app.openLink({ url: 'https://example.com/map' })).resolves.toEqual({});
    expect(openLink).toHaveBeenCalledWith('https://example.com/map');
    await expect(
      app.sendMessage({ role: 'user', content: [{ type: 'text', text: 'Keep exploring' }] }),
    ).resolves.toEqual({});
    expect(sendMessage).toHaveBeenCalledWith([{ type: 'text', text: 'Keep exploring' }]);

    await app.sendSizeChanged({ width: 480, height: 320 });
    await vi.waitFor(() => {
      expect(onSizeChanged).toHaveBeenCalledWith({ width: 480, height: 320 });
    });

    host.updateHostContext({ theme: 'dark', containerDimensions: { width: 900, height: 700 } });
    await vi.waitFor(() => {
      expect(hostContextChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: 'dark',
          containerDimensions: { width: 900, height: 700 },
        }),
      );
      expect(app.getHostContext()).toMatchObject({ theme: 'dark', displayMode: 'inline' });
    });

    await expect(app.requestDisplayMode({ mode: 'fullscreen' })).resolves.toEqual({
      mode: 'fullscreen',
    });
    expect(requestDisplayMode).toHaveBeenCalledWith('fullscreen');

    const teardown = vi.fn(async () => ({}));
    app.onteardown = teardown;
    await host.requestTeardown('test complete');
    expect(teardown).toHaveBeenCalledOnce();
  });

  it('advertises only the stable browser adapter capabilities Athena implements end to end', async () => {
    const { app } = await officialHarness({
      openLink: () => true,
      callTool: async () => ({ content: [] }),
      sendMessage: () => true,
      readResource: async () => ({}),
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

  it('returns invalid params for malformed official-App input without opening a link', async () => {
    const openLink = vi.fn(() => true);
    const { host, hostMessages } = await officialHarness({ openLink });

    await host.receive({ jsonrpc: '2.0', id: 'bad-link', method: 'ui/open-link', params: {} });

    expect(hostMessages.find((message) => 'id' in message && message.id === 'bad-link')).toEqual({
      jsonrpc: '2.0',
      id: 'bad-link',
      error: expect.objectContaining({ code: -32602 }),
    });
    expect(openLink).not.toHaveBeenCalled();
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

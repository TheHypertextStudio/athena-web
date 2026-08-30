/**
 * The MCP Apps host bridge, driven by a fake view frame.
 *
 * @remarks
 * Every test here plays the View: it posts raw JSON-RPC at the host exactly as an `<iframe>`
 * would and reads back what the host posts. Nothing mocks the bridge's own logic, so the
 * ordering guarantees, the refusal paths, and the CSP construction are exercised as the browser
 * would exercise them.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  MCP_UI_METHODS,
  MCP_UI_MIME_TYPE,
  MCP_UI_PROTOCOL_VERSION,
  MCP_UI_PROXIED_METHODS,
} from '@docket/types';
import {
  buildViewCsp,
  buildViewPermissionsAllow,
  createMcpAppHost,
  isRenderableUiResource,
  JSON_RPC_ERROR,
  MCP_APP_VIEW_SANDBOX,
  type JsonRpcMessage,
  type McpAppHostOptions,
} from '../../src/mcp-apps-host';
import { assertDefined } from '@docket/test-utils';

const RESOURCE = {
  uri: 'ui://acme/weather',
  mimeType: MCP_UI_MIME_TYPE,
  text: '<!doctype html><html><head></head><body>weather</body></html>',
};

/** Build a host wired to a recording transport, plus the helpers a fake view needs. */
function harness(overrides: Partial<McpAppHostOptions> = {}) {
  const posted: JsonRpcMessage[] = [];
  const host = createMcpAppHost({
    hostInfo: { name: 'docket', version: '1.0.0' },
    resource: RESOURCE,
    tool: { name: 'get_weather', arguments: { city: 'Dallas' }, requestId: 7 },
    hostContext: { theme: 'light', locale: 'en-US' },
    post: (message) => posted.push(message),
    ...overrides,
  });

  const methods = (): string[] =>
    posted.filter((m) => typeof m.method === 'string').map((m) => assertDefined(m.method));
  const resultFor = (id: string | number): JsonRpcMessage | undefined =>
    posted.find((m) => m.id === id);

  /** Run the view's half of the handshake and return the initialize result. */
  const handshake = async (): Promise<Record<string, unknown>> => {
    await host.receive({
      jsonrpc: '2.0',
      id: 1,
      method: MCP_UI_METHODS.initialize,
      params: {
        appInfo: { name: 'weather-view', version: '2.0.0' },
        appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
        protocolVersion: MCP_UI_PROTOCOL_VERSION,
      },
    });
    const answer = resultFor(1);
    await host.receive({ jsonrpc: '2.0', method: MCP_UI_METHODS.initialized, params: {} });
    return (answer?.result ?? {}) as Record<string, unknown>;
  };

  return { host, posted, methods, resultFor, handshake };
}

describe('handshake', () => {
  it('answers ui/initialize with host capabilities and hostContext', async () => {
    const { host, handshake } = harness({
      openLink: () => true,
      callTool: async () => ({ content: [] }),
      updateModelContext: () => undefined,
    });
    const result = await handshake();

    expect(result['protocolVersion']).toBe(MCP_UI_PROTOCOL_VERSION);
    expect(result['hostInfo']).toEqual({ name: 'docket', version: '1.0.0' });
    const capabilities = result['hostCapabilities'] as Record<string, unknown>;
    expect(capabilities['openLinks']).toEqual({});
    expect(capabilities['serverTools']).toEqual({ listChanged: false });
    expect(capabilities['updateModelContext']).toBeUndefined();
    expect(capabilities['downloadFile']).toBeUndefined();
    expect(capabilities['logging']).toBeUndefined();
    expect(capabilities['serverResources']).toBeUndefined();
    const context = result['hostContext'] as Record<string, unknown>;
    expect(context['theme']).toBe('light');
    expect(context['availableDisplayModes']).toEqual(['inline', 'fullscreen']);
    expect(context['toolInfo']).toEqual({
      id: 7,
      tool: { name: 'get_weather', inputSchema: { type: 'object', properties: {} } },
    });
    expect(host.appCapabilities).toEqual({ availableDisplayModes: ['inline', 'fullscreen'] });
  });

  it('states its own protocol version when the view asks for one it does not speak', async () => {
    const { host, resultFor } = harness();
    await host.receive({
      jsonrpc: '2.0',
      id: 1,
      method: MCP_UI_METHODS.initialize,
      params: {
        appInfo: { name: 'v', version: '1' },
        appCapabilities: {},
        protocolVersion: '1999-01-01',
      },
    });
    expect((resultFor(1)?.result as Record<string, unknown>)['protocolVersion']).toBe(
      MCP_UI_PROTOCOL_VERSION,
    );
  });

  it('posts nothing to the view before ui/notifications/initialized arrives', async () => {
    const { host, posted, methods } = harness();

    // The host tries to deliver data before the view is ready, which is the realistic race:
    // the tool finishes while the frame is still booting.
    host.deliverToolInput({ city: 'Dallas' });
    host.deliverToolResult({ content: [{ type: 'text', text: '72F' }] });
    host.updateHostContext({ theme: 'dark' });
    expect(methods()).toEqual([]);

    await host.receive({
      jsonrpc: '2.0',
      id: 1,
      method: MCP_UI_METHODS.initialize,
      params: {
        appInfo: { name: 'v', version: '1' },
        appCapabilities: {},
        protocolVersion: MCP_UI_PROTOCOL_VERSION,
      },
    });
    // The initialize RESPONSE is not gated — the view is blocked on it.
    expect(posted.map((m) => m.id)).toContain(1);
    expect(methods()).toEqual([]);

    await host.receive({ jsonrpc: '2.0', method: MCP_UI_METHODS.initialized });
    expect(methods()).toEqual([
      MCP_UI_METHODS.hostContextChanged,
      MCP_UI_METHODS.toolInput,
      MCP_UI_METHODS.toolResult,
    ]);
    expect(host.initialized).toBe(true);
  });

  it('never posts tool-result before tool-input, even when only the result is delivered', async () => {
    const { host, posted, methods, handshake } = harness();
    await handshake();
    host.deliverToolResult({ content: [] });

    expect(methods()).toEqual([MCP_UI_METHODS.toolInput, MCP_UI_METHODS.toolResult]);
    const input = posted.find((m) => m.method === MCP_UI_METHODS.toolInput);
    // Falls back to the arguments the tool was actually called with.
    expect(input?.params).toEqual({ arguments: { city: 'Dallas' } });
  });

  it('carries the tool arguments on ui/notifications/tool-input', async () => {
    const { host, posted, handshake } = harness();
    await handshake();
    host.deliverToolInput({ city: 'Dallas', units: 'F' });
    expect(posted.find((m) => m.method === MCP_UI_METHODS.toolInput)?.params).toEqual({
      arguments: { city: 'Dallas', units: 'F' },
    });
  });

  it('stops streaming partial arguments once the complete set is sent', async () => {
    const { host, methods, handshake } = harness();
    await handshake();
    host.deliverToolInputPartial({ city: 'Dal' });
    host.deliverToolInput({ city: 'Dallas' });
    host.deliverToolInputPartial({ city: 'Dallas!' });
    expect(methods()).toEqual([MCP_UI_METHODS.toolInputPartial, MCP_UI_METHODS.toolInput]);
  });

  it('delivers tool-input exactly once however many times it is called', async () => {
    const { host, methods, handshake } = harness();
    await handshake();
    host.deliverToolInput({ a: 1 });
    host.deliverToolInput({ a: 2 });
    expect(methods()).toEqual([MCP_UI_METHODS.toolInput]);
  });

  it('tells the view when the tool was cancelled', async () => {
    const { host, posted, handshake } = harness();
    await handshake();
    host.deliverToolCancelled('user action');
    expect(posted.at(-1)).toMatchObject({
      method: MCP_UI_METHODS.toolCancelled,
      params: { reason: 'user action' },
    });
    host.deliverToolCancelled();
    expect(posted.at(-1)?.params).toEqual({});
  });
});

describe('tools/call through the host bridge', () => {
  it('executes an authorized tool and returns the result with the matching id', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    const { host, resultFor, handshake } = harness({
      callTool,
      authorizeTool: (name) =>
        name === 'refresh' ? { allowed: true } : { allowed: false, reason: 'out of scope' },
    });
    await handshake();

    await host.receive({
      jsonrpc: '2.0',
      id: 'view-9',
      method: MCP_UI_PROXIED_METHODS.callTool,
      params: { name: 'refresh', arguments: { city: 'Dallas' } },
    });

    expect(callTool).toHaveBeenCalledWith('refresh', { city: 'Dallas' });
    expect(resultFor('view-9')?.result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('refuses a tool outside the session scope with a JSON-RPC error, not a silent success', async () => {
    const callTool = vi.fn(async () => ({ content: [] }));
    const { host, resultFor, handshake } = harness({
      callTool,
      authorizeTool: (name) =>
        name === 'refresh' ? { allowed: true } : { allowed: false, reason: 'not in this session' },
    });
    await handshake();

    await host.receive({
      jsonrpc: '2.0',
      id: 'view-10',
      method: MCP_UI_PROXIED_METHODS.callTool,
      params: { name: 'delete_everything', arguments: {} },
    });

    const answer = resultFor('view-10');
    expect(answer?.result).toBeUndefined();
    expect(answer?.error?.code).toBe(JSON_RPC_ERROR.refused);
    expect(answer?.error?.message).toContain('delete_everything');
    expect(callTool).not.toHaveBeenCalled();
  });

  it('refuses every tool when no authorization policy is supplied', async () => {
    const callTool = vi.fn(async () => ({ content: [] }));
    const { host, resultFor, handshake } = harness({ callTool });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 3,
      method: MCP_UI_PROXIED_METHODS.callTool,
      params: { name: 'anything' },
    });
    expect(resultFor(3)?.error?.code).toBe(JSON_RPC_ERROR.refused);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('replays tool-input and tool-result for a view-initiated call', async () => {
    const { host, methods, handshake } = harness({
      callTool: async () => ({ content: [{ type: 'text', text: 'fresh' }] }),
      authorizeTool: () => ({ allowed: true }),
    });
    await handshake();
    host.deliverToolResult({ content: [] });
    const before = methods().length;

    await host.receive({
      jsonrpc: '2.0',
      id: 4,
      method: MCP_UI_PROXIED_METHODS.callTool,
      params: { name: 'refresh', arguments: { city: 'Austin' } },
    });

    expect(methods().slice(before)).toEqual([MCP_UI_METHODS.toolInput, MCP_UI_METHODS.toolResult]);
  });

  it('reports a failing tool as an internal error rather than hanging the view', async () => {
    const { host, resultFor, handshake } = harness({
      callTool: async () => {
        throw new Error('upstream exploded');
      },
      authorizeTool: () => ({ allowed: true }),
    });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 5,
      method: MCP_UI_PROXIED_METHODS.callTool,
      params: { name: 'refresh' },
    });
    const error = resultFor(5)?.error;
    expect(error?.code).toBe(JSON_RPC_ERROR.internalError);
    // Application-owned copy: the upstream exception text never reaches the widget.
    expect(error?.message).not.toContain('exploded');
  });

  it('rejects a tools/call with no tool name', async () => {
    const { host, resultFor, handshake } = harness({
      callTool: async () => ({ content: [] }),
      authorizeTool: () => ({ allowed: true }),
    });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 6,
      method: MCP_UI_PROXIED_METHODS.callTool,
      params: {},
    });
    expect(resultFor(6)?.error).toBeDefined();
  });

  it('says so when the host does not proxy tool calls at all', async () => {
    const { host, resultFor, handshake } = harness({ authorizeTool: () => ({ allowed: true }) });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 7,
      method: MCP_UI_PROXIED_METHODS.callTool,
      params: { name: 'refresh' },
    });
    expect(resultFor(7)?.error?.code).toBe(JSON_RPC_ERROR.methodNotFound);
  });
});

describe('view-initiated host requests', () => {
  it('opens a link and answers with an empty result', async () => {
    const openLink = vi.fn(() => true);
    const { host, resultFor, handshake } = harness({ openLink });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 11,
      method: MCP_UI_METHODS.openLink,
      params: { url: 'https://example.com/report' },
    });
    expect(openLink).toHaveBeenCalledWith('https://example.com/report');
    expect(resultFor(11)?.result).toEqual({});
  });

  it('errors rather than silently ignoring a link the host refuses', async () => {
    const { host, resultFor, handshake } = harness({ openLink: () => false });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 12,
      method: MCP_UI_METHODS.openLink,
      params: { url: 'https://evil.test' },
    });
    expect(resultFor(12)?.error?.code).toBe(JSON_RPC_ERROR.refused);
  });

  it('rejects ui/open-link with no url', async () => {
    const { host, resultFor, handshake } = harness({ openLink: () => true });
    await handshake();
    await host.receive({ jsonrpc: '2.0', id: 13, method: MCP_UI_METHODS.openLink, params: {} });
    expect(resultFor(13)?.error).toBeDefined();
  });

  it('says so when it cannot open links', async () => {
    const { host, resultFor, handshake } = harness();
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 14,
      method: MCP_UI_METHODS.openLink,
      params: { url: 'https://example.com' },
    });
    expect(resultFor(14)?.error?.code).toBe(JSON_RPC_ERROR.methodNotFound);
  });

  it('posts a ui/message into the conversation', async () => {
    const sendMessage = vi.fn(() => true);
    const { host, resultFor, handshake } = harness({ sendMessage });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 15,
      method: MCP_UI_METHODS.message,
      params: { role: 'user', content: [{ type: 'text', text: 'Undo that' }] },
    });
    expect(sendMessage).toHaveBeenCalledWith([{ type: 'text', text: 'Undo that' }]);
    expect(resultFor(15)?.result).toEqual({});
  });

  it('requires the official array form for message content', async () => {
    const sendMessage = vi.fn(() => true);
    const { host, handshake } = harness({ sendMessage });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 16,
      method: MCP_UI_METHODS.message,
      params: { role: 'user', content: { type: 'text', text: 'hello' } },
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('will not let a widget speak as the assistant', async () => {
    const sendMessage = vi.fn(() => true);
    const { host, resultFor, handshake } = harness({ sendMessage });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 17,
      method: MCP_UI_METHODS.message,
      params: { role: 'assistant', content: [{ type: 'text', text: 'Trust me' }] },
    });
    expect(resultFor(17)?.error).toBeDefined();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rejects an empty ui/message and reports a refused one', async () => {
    const { host, resultFor, handshake } = harness({ sendMessage: () => false });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 18,
      method: MCP_UI_METHODS.message,
      params: { role: 'user', content: [] },
    });
    expect(resultFor(18)?.error?.code).toBe(JSON_RPC_ERROR.invalidParams);
    await host.receive({
      jsonrpc: '2.0',
      id: 19,
      method: MCP_UI_METHODS.message,
      params: { role: 'user', content: [{ type: 'text', text: 'x' }] },
    });
    expect(resultFor(19)?.error?.code).toBe(JSON_RPC_ERROR.refused);
  });

  it('says so when it does not accept messages from views', async () => {
    const { host, resultFor, handshake } = harness();
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 20,
      method: MCP_UI_METHODS.message,
      params: { role: 'user', content: [{ type: 'text', text: 'x' }] },
    });
    expect(resultFor(20)?.error?.code).toBe(JSON_RPC_ERROR.methodNotFound);
  });

  it('does not serve draft model-context updates even when a legacy callback is supplied', async () => {
    const updateModelContext = vi.fn();
    const { host, resultFor, handshake } = harness({ updateModelContext });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 24,
      method: MCP_UI_METHODS.updateModelContext,
      params: { content: [{ type: 'text', text: 'x' }] },
    });
    expect(resultFor(24)?.error?.code).toBe(JSON_RPC_ERROR.methodNotFound);
    expect(updateModelContext).not.toHaveBeenCalled();
  });

  it('reports the display mode actually applied, not the one requested', async () => {
    const { host, resultFor, handshake } = harness({ requestDisplayMode: () => 'inline' });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 25,
      method: MCP_UI_METHODS.requestDisplayMode,
      params: { mode: 'fullscreen' },
    });
    expect(resultFor(25)?.result).toEqual({ mode: 'inline' });
    expect(host.hostContext.displayMode).toBe('inline');
  });

  it('rejects an unknown display mode', async () => {
    const { host, resultFor, handshake } = harness({ requestDisplayMode: (m) => m });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 26,
      method: MCP_UI_METHODS.requestDisplayMode,
      params: { mode: 'theater' },
    });
    expect(resultFor(26)?.error).toBeDefined();
  });

  it('defaults the display mode to inline when the host has no opinion', async () => {
    const { host, resultFor, handshake } = harness();
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 27,
      method: MCP_UI_METHODS.requestDisplayMode,
      params: { mode: 'pip' },
    });
    expect(resultFor(27)?.result).toEqual({ mode: 'inline' });
  });

  it('answers ping', async () => {
    const { host, resultFor, handshake } = harness();
    await handshake();
    await host.receive({ jsonrpc: '2.0', id: 36, method: MCP_UI_PROXIED_METHODS.ping });
    expect(resultFor(36)?.result).toEqual({});
  });

  it('refuses any method that is not part of the view surface', async () => {
    const { host, resultFor, handshake } = harness();
    await handshake();
    await host.receive({ jsonrpc: '2.0', id: 37, method: 'tools/list', params: {} });
    expect(resultFor(37)?.error?.code).toBe(JSON_RPC_ERROR.methodNotFound);
  });
});

describe('view notifications and lifecycle', () => {
  it('reports valid size changes', async () => {
    const onSizeChanged = vi.fn();
    const { host, handshake } = harness({ onSizeChanged });
    await handshake();

    await host.receive({
      jsonrpc: '2.0',
      method: MCP_UI_METHODS.sizeChanged,
      params: { width: 420, height: 260 },
    });
    expect(onSizeChanged).toHaveBeenCalledWith({ width: 420, height: 260 });
  });

  it('drops a size notification carrying nothing usable', async () => {
    const onSizeChanged = vi.fn();
    const { host, handshake } = harness({ onSizeChanged });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      method: MCP_UI_METHODS.sizeChanged,
      params: { width: 'wide' },
    });
    expect(onSizeChanged).not.toHaveBeenCalled();
  });

  it('ignores unknown notifications, non-JSON-RPC data, and everything after close', async () => {
    const onAudit = vi.fn();
    const { host, posted, handshake } = harness({ onAudit });
    await handshake();
    const before = posted.length;

    await host.receive({ jsonrpc: '2.0', method: 'ui/notifications/unheard-of' });
    await host.receive({ type: 'webpack-hmr' });
    await host.receive(null);
    await host.receive({ jsonrpc: '1.0', method: 'ui/open-link' });
    expect(posted).toHaveLength(before);

    host.close();
    await host.receive({ jsonrpc: '2.0', id: 99, method: MCP_UI_PROXIED_METHODS.ping });
    host.deliverToolResult({ content: [] });
    expect(posted).toHaveLength(before);
  });

  it('asks the view to tear down and waits for its answer', async () => {
    const { host, posted, handshake } = harness();
    await handshake();

    const pending = host.requestTeardown('user closed the panel');
    const request = posted.find((m) => m.method === MCP_UI_METHODS.resourceTeardown);
    expect(request?.params).toEqual({});

    await host.receive({ jsonrpc: '2.0', id: request?.id, result: {} });
    await expect(pending).resolves.toBeUndefined();
  });

  it('stops waiting for an unresponsive view after one second', async () => {
    vi.useFakeTimers();
    try {
      const { host, handshake } = harness();
      await handshake();
      let settled = false;
      const pending = host.requestTeardown().then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not ask an uninitialized view to tear down', async () => {
    const { host, posted } = harness();
    await host.requestTeardown();
    expect(posted).toHaveLength(0);
  });

  it('ignores a response to a request the host never made', async () => {
    const { host, posted, handshake } = harness();
    await handshake();
    const before = posted.length;
    await host.receive({ jsonrpc: '2.0', id: 'host-404', result: {} });
    expect(posted).toHaveLength(before);
  });

  it('restyles in place: a theme change is a partial host-context patch, not a reload', async () => {
    const { host, posted, handshake } = harness();
    await handshake();
    host.updateHostContext({ theme: 'dark' });

    const patch = posted.find((m) => m.method === MCP_UI_METHODS.hostContextChanged);
    expect(patch?.params).toEqual({ theme: 'dark' });
    // The patch carries only what changed; the host's own view of the context is merged.
    expect(host.hostContext.theme).toBe('dark');
    expect(host.hostContext.locale).toBe('en-US');
  });

  it('records every view-initiated request for review', async () => {
    const entries: { method: string; outcome: string }[] = [];
    const { host, handshake } = harness({
      onAudit: (entry) => entries.push({ method: entry.method, outcome: entry.outcome }),
      openLink: () => true,
    });
    await handshake();
    await host.receive({
      jsonrpc: '2.0',
      id: 40,
      method: MCP_UI_METHODS.openLink,
      params: { url: 'https://example.com' },
    });
    expect(entries).toEqual([
      { method: MCP_UI_METHODS.initialize, outcome: 'ok' },
      { method: MCP_UI_METHODS.initialized, outcome: 'ok' },
      { method: MCP_UI_METHODS.openLink, outcome: 'ok' },
    ]);
  });
});

describe('sandbox policy', () => {
  it('builds a deny-all CSP when the resource declares nothing', () => {
    const csp = buildViewCsp();
    expect(csp).toContain(`default-src 'none'`);
    expect(csp).toContain(`connect-src 'none'`);
    expect(csp).toContain(`frame-src 'none'`);
    expect(csp).toContain(`object-src 'none'`);
    expect(csp).toContain(`base-uri 'self'`);
    // No implicit self on connect-src: a view has no same-origin server to reach.
    expect(csp).not.toContain(`connect-src 'self'`);
  });

  it('adds exactly the origins the resource declared and nothing else', () => {
    const csp = buildViewCsp({
      connectDomains: ['https://api.weather.test'],
      resourceDomains: ['https://cdn.test'],
      frameDomains: ['https://player.test'],
      baseUriDomains: ['https://cdn.test'],
    });
    expect(csp).toContain(`connect-src https://api.weather.test`);
    expect(csp).toContain(`script-src 'self' 'unsafe-inline' https://cdn.test`);
    expect(csp).toContain(`frame-src https://player.test`);
    expect(csp).toContain(`base-uri https://cdn.test`);
    expect(csp).not.toContain('https://elsewhere.test');
  });

  it('drops non-origin CSP values instead of letting them add directives', () => {
    const csp = buildViewCsp({
      connectDomains: ['https://api.example.com; script-src *', 'https://api.example.com/path'],
      resourceDomains: ['https://*.cdn.example.com'],
    });

    expect(csp).toContain(`connect-src 'none'`);
    expect(csp).toContain(`script-src 'self' 'unsafe-inline' https://*.cdn.example.com`);
    expect(csp).not.toContain('script-src *');
    expect(csp).not.toContain('/path');
  });

  it('grants only the permissions the resource asked for', () => {
    expect(buildViewPermissionsAllow()).toBe('');
    expect(buildViewPermissionsAllow({ camera: {}, geolocation: {} })).toBe(
      `camera 'src'; geolocation 'src'`,
    );
    expect(buildViewPermissionsAllow({ microphone: {}, clipboardWrite: {} })).toBe(
      `microphone 'src'; clipboard-write 'src'`,
    );
  });

  it('never grants the view an origin', () => {
    expect(MCP_APP_VIEW_SANDBOX).toBe('allow-scripts');
    expect(MCP_APP_VIEW_SANDBOX).not.toContain('allow-same-origin');
    expect(MCP_APP_VIEW_SANDBOX).not.toContain('allow-top-navigation');
  });

  it('recognises only ui:// documents served with the profile mimeType', () => {
    expect(isRenderableUiResource(RESOURCE)).toBe(true);
    expect(isRenderableUiResource({ ...RESOURCE, uri: 'https://acme/weather' })).toBe(false);
    expect(isRenderableUiResource({ ...RESOURCE, mimeType: 'text/html' })).toBe(false);
    expect(isRenderableUiResource({ ...RESOURCE, mimeType: 'text/html;foo=profile=mcp-app' })).toBe(
      false,
    );
    expect(isRenderableUiResource({ uri: RESOURCE.uri, mimeType: RESOURCE.mimeType })).toBe(false);
  });

  it('accepts valid base64 HTML blobs and rejects malformed base64', () => {
    expect(
      isRenderableUiResource({
        uri: RESOURCE.uri,
        mimeType: RESOURCE.mimeType,
        blob: 'PCFkb2N0eXBlIGh0bWw+PHRpdGxlPkJsb2I8L3RpdGxlPg==',
      }),
    ).toBe(true);
    expect(
      isRenderableUiResource({
        uri: RESOURCE.uri,
        mimeType: RESOURCE.mimeType,
        blob: 'not base64!',
      }),
    ).toBe(false);
  });
});

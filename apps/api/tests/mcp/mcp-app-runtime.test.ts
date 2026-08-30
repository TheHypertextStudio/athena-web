/**
 * Behavioral coverage for the first-party MCP App runtime shipped inside every Athena widget.
 *
 * @remarks
 * The runtime is an inline script by design. These tests execute that production script against a
 * small browser boundary and drive JSON-RPC messages through it; source-string assertions would
 * not prove that a real widget performs the stable view responsibilities.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { RUNTIME_JS } from '../../src/mcp/apps/runtime';
import { assertDefined } from '@docket/test-utils';

interface WireMessage {
  readonly jsonrpc: '2.0';
  readonly id?: string;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: unknown;
}

/** Execute the production runtime and expose its observable browser/wire boundary. */
function runRuntime() {
  const posted: WireMessage[] = [];
  const listeners: ((event: { data: WireMessage }) => void)[] = [];
  const rootProperties = new Map<string, string>();
  const rootStyle = {
    colorScheme: '',
    height: '',
    width: '',
    maxHeight: '',
    maxWidth: '',
    setProperty: (key: string, value: string) => rootProperties.set(key, value),
    removeProperty: (key: string) => {
      Reflect.set(
        rootStyle,
        key.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
        '',
      );
    },
  };
  const status = { textContent: '', hidden: true, dataset: {} as Record<string, string> };
  const body = {
    dataset: {} as Record<string, string>,
    scrollHeight: 240,
    scrollWidth: 480,
  };
  const documentStub = {
    documentElement: { style: rootStyle, lang: '' },
    body,
    head: { appendChild: () => undefined },
    querySelector: (selector: string) => (selector === '.status' ? status : null),
    createElement: () => ({
      style: {},
      className: '',
      textContent: '',
      innerHTML: '',
      setAttribute: () => undefined,
    }),
  };
  let nextTimer = 1;
  const windowStub = {
    __docketDisplayModes: ['inline', 'fullscreen'],
    parent: { postMessage: (message: WireMessage) => posted.push(message) },
    addEventListener: (type: string, listener: (event: { data: WireMessage }) => void) => {
      if (type === 'message') listeners.push(listener);
    },
    setTimeout: () => nextTimer++,
    clearTimeout: () => undefined,
  } as Record<string, unknown>;
  class ResizeObserverStub {
    observe(): void {
      return undefined;
    }
  }
  const requestAnimationFrame = (callback: () => void): number => {
    callback();
    return 1;
  };

  // This is Athena's own static script, not provider input. Executing it is the behavioral
  // boundary under test; parsing its source would not exercise its JSON-RPC state machine.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const execute = new Function(
    'window',
    'document',
    'ResizeObserver',
    'requestAnimationFrame',
    RUNTIME_JS,
  ) as (window: unknown, document: unknown, resize: unknown, frame: unknown) => void;
  execute(windowStub, documentStub, ResizeObserverStub, requestAnimationFrame);

  const send = (message: WireMessage): void => {
    for (const listener of listeners) listener({ data: message });
  };
  const request = (method: string): WireMessage =>
    assertDefined(posted.find((message) => message.method === method && message.id));
  const respond = (message: WireMessage, result: unknown): void => {
    send({ jsonrpc: '2.0', id: assertDefined(message.id), result });
  };
  return {
    posted,
    rootStyle,
    rootProperties,
    body,
    send,
    request,
    respond,
    docket: windowStub['docket'] as {
      readonly ready: Promise<unknown>;
      readonly input: Record<string, unknown>;
      readonly hostContext: Record<string, unknown>;
      readonly displayMode: string;
      onData(handler: (data: unknown) => void): void;
      canDisplay(mode: string): boolean;
      requestDisplayMode(mode: string): Promise<string>;
    },
  };
}

describe('Athena MCP App production runtime', () => {
  let runtime: ReturnType<typeof runRuntime>;

  beforeEach(() => {
    runtime = runRuntime();
  });

  it('initializes Athena widgets with declared capabilities and host context', async () => {
    const initialize = runtime.request('ui/initialize');
    expect(initialize.params).toEqual({
      protocolVersion: '2026-01-26',
      appInfo: { name: 'docket-widget', version: '1.0.0' },
      appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    });

    runtime.respond(initialize, {
      hostContext: {
        theme: 'light',
        locale: 'en-US',
        availableDisplayModes: ['inline', 'fullscreen'],
        containerDimensions: { maxWidth: 720, maxHeight: 640 },
      },
    });
    await runtime.docket.ready;

    expect(runtime.posted).toContainEqual({
      jsonrpc: '2.0',
      method: 'ui/notifications/initialized',
      params: {},
    });
    expect(runtime.docket.hostContext).toMatchObject({ theme: 'light', locale: 'en-US' });
    expect(runtime.rootStyle.colorScheme).toBe('only light');
    expect(runtime.rootStyle.maxWidth).toBe('720px');
    expect(runtime.rootStyle.maxHeight).toBe('640px');
  });

  it('merges theme sizing and display-mode responses in the Athena widget runtime', async () => {
    const initialize = runtime.request('ui/initialize');
    runtime.respond(initialize, {
      hostContext: {
        theme: 'light',
        availableDisplayModes: ['inline', 'fullscreen'],
        containerDimensions: { maxWidth: 720, maxHeight: 640 },
      },
    });
    await runtime.docket.ready;

    runtime.send({
      jsonrpc: '2.0',
      method: 'ui/notifications/host-context-changed',
      params: { theme: 'dark', styles: { variables: { '--color-text-primary': '#fff' } } },
    });
    expect(runtime.docket.hostContext).toMatchObject({
      theme: 'dark',
      availableDisplayModes: ['inline', 'fullscreen'],
      containerDimensions: { maxWidth: 720, maxHeight: 640 },
    });
    expect(runtime.rootStyle.colorScheme).toBe('only dark');
    expect(runtime.rootProperties.get('--color-text-primary')).toBe('#fff');

    const requested = runtime.docket.requestDisplayMode('fullscreen');
    const displayRequest = runtime.request('ui/request-display-mode');
    expect(displayRequest.params).toEqual({ mode: 'fullscreen' });
    runtime.respond(displayRequest, { mode: 'inline' });
    await expect(requested).resolves.toBe('inline');
    expect(runtime.docket.displayMode).toBe('inline');
  });

  it('does not request a display mode the host context does not offer', async () => {
    const initialize = runtime.request('ui/initialize');
    runtime.respond(initialize, {
      hostContext: { displayMode: 'inline', availableDisplayModes: ['inline'] },
    });
    await runtime.docket.ready;

    const requested = runtime.docket.requestDisplayMode('fullscreen');
    expect(
      runtime.posted.filter((message) => message.method === 'ui/request-display-mode'),
    ).toEqual([]);
    await expect(requested).resolves.toBe('inline');
    expect(runtime.docket.displayMode).toBe('inline');
  });

  it('handles complete tool notifications and ignores partial arguments for critical work', async () => {
    const initialize = runtime.request('ui/initialize');
    runtime.respond(initialize, { hostContext: {} });
    await runtime.docket.ready;
    const rendered: unknown[] = [];
    runtime.docket.onData((data) => rendered.push(data));

    runtime.send({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-input-partial',
      params: { arguments: { dangerous: true } },
    });
    expect(runtime.docket.input).toEqual({});

    runtime.send({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-input',
      params: { arguments: { orgId: 'org_1' } },
    });
    runtime.send({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: {
        content: [{ type: 'text', text: 'One task' }],
        structuredContent: { items: [{ id: 'task_1' }] },
      },
    });

    expect(runtime.docket.input).toEqual({ orgId: 'org_1' });
    expect(rendered).toEqual([{ items: [{ id: 'task_1' }] }]);
    expect(runtime.body.dataset['state']).toBe('ready');
  });

  it('reports size changes and acknowledges teardown in the Athena widget runtime', () => {
    expect(runtime.posted).toContainEqual({
      jsonrpc: '2.0',
      method: 'ui/notifications/size-changed',
      params: { width: 480, height: 240 },
    });
    runtime.send({ jsonrpc: '2.0', id: 'teardown-1', method: 'ui/resource-teardown', params: {} });
    expect(runtime.posted).toContainEqual({ jsonrpc: '2.0', id: 'teardown-1', result: {} });
  });
});

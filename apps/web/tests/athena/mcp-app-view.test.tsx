/**
 * The MCP Apps host surface in the Athena conversation.
 *
 * @remarks
 * jsdom will not execute a cross-origin `srcdoc` frame, so these tests do not try to run the real
 * widget. What they DO verify is everything the host is responsible for and the bridge is not:
 * the two frames and their sandbox attributes, the sandbox handshake, the theme patch, the height
 * response, and the fact that a widget's link and message requests reach the host callbacks.
 * Messages are posted at the component exactly as the proxy would post them.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MCP_UI_METHODS, MCP_UI_MIME_TYPE, MCP_UI_PROTOCOL_VERSION } from '@docket/types';

import { McpAppView } from '@/components/athena/mcp-app-view';
import { assertDefined } from '@docket/test-utils';

const SANDBOX_ORIGIN = 'https://api.docket.test';

const RESOURCE = {
  uri: 'ui://acme-release/checklist',
  mimeType: MCP_UI_MIME_TYPE,
  text: '<!doctype html><html><head></head><body>checklist</body></html>',
  meta: { csp: {}, prefersBorder: true },
};

// jsdom implements no media queries at all, so the host's theme probe needs a stand-in. The
// listener is real: the theme test drives it to prove the widget restyles without a reload.
const mediaListeners = new Set<() => void>();
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    media: query,
    matches: false,
    addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Render the view and take over its frame's `contentWindow` so messages can be intercepted. */
function mount(overrides: Partial<Parameters<typeof McpAppView>[0]> = {}) {
  const posted: { message: Record<string, unknown>; origin: string }[] = [];
  const onCallTool = overrides.onCallTool ?? vi.fn(async () => ({ content: [] }));

  const view = render(
    <McpAppView
      resource={RESOURCE}
      tool={{ name: 'release_checklist', arguments: { release: '4.2' } }}
      result={{ content: [{ type: 'text', text: '2 of 4 done' }] }}
      serverName="Acme Release Tracker"
      sandboxOrigin={SANDBOX_ORIGIN}
      onCallTool={onCallTool}
      {...overrides}
    />,
  );

  const frame = assertDefined(view.container.querySelector('iframe'));
  // jsdom gives a same-document window; standing in for it lets the test both capture what the
  // host posts and impersonate the proxy when posting back.
  const proxyWindow = {
    postMessage: (message: Record<string, unknown>, origin: string) =>
      posted.push({ message, origin }),
  };
  Object.defineProperty(frame, 'contentWindow', { value: proxyWindow, configurable: true });

  const fromProxy = (data: unknown): void => {
    window.dispatchEvent(
      new MessageEvent('message', { data, origin: SANDBOX_ORIGIN, source: proxyWindow as never }),
    );
  };

  return { view, frame, posted, fromProxy, onCallTool };
}

/** Play the view's half of the handshake through the proxy. */
async function handshake(
  harness: ReturnType<typeof mount>,
  appCapabilities: Record<string, unknown> = {},
): Promise<void> {
  harness.fromProxy({ jsonrpc: '2.0', method: MCP_UI_METHODS.sandboxProxyReady, params: {} });
  await waitFor(() => {
    expect(
      harness.posted.some((p) => p.message['method'] === MCP_UI_METHODS.sandboxResourceReady),
    ).toBe(true);
  });
  harness.fromProxy({
    jsonrpc: '2.0',
    id: 1,
    method: MCP_UI_METHODS.initialize,
    params: {
      appInfo: { name: 'acme-release-view', version: '1.0.0' },
      appCapabilities,
      protocolVersion: MCP_UI_PROTOCOL_VERSION,
    },
  });
  await waitFor(() => {
    expect(harness.posted.some((p) => p.message['id'] === 1)).toBe(true);
  });
  harness.fromProxy({ jsonrpc: '2.0', method: MCP_UI_METHODS.initialized, params: {} });
}

describe('McpAppView frames', () => {
  it('renders the widget through a proxy on the API origin, not the app origin', () => {
    const { frame } = mount();
    expect(frame.getAttribute('src')).toBe(`${SANDBOX_ORIGIN}/mcp/apps/sandbox`);
    expect(new URL(frame.src).origin).not.toBe(window.location.origin);
  });

  it('gives the proxy an origin and the widget none', async () => {
    const { frame, posted, fromProxy } = mount();
    // The proxy needs `allow-same-origin` to set the inner frame's policy…
    expect(frame.getAttribute('sandbox')).toContain('allow-same-origin');

    fromProxy({ jsonrpc: '2.0', method: MCP_UI_METHODS.sandboxProxyReady, params: {} });
    await waitFor(() => {
      expect(posted).not.toHaveLength(0);
    });
    const ready = posted.find((p) => p.message['method'] === MCP_UI_METHODS.sandboxResourceReady);
    const params = ready?.message['params'] as Record<string, unknown>;
    // …but the widget it creates gets scripts and nothing else.
    expect(params['sandbox']).toBe('allow-scripts');
    expect(String(params['sandbox'])).not.toContain('allow-same-origin');
  });

  it('hands the proxy a document whose policy blocks network egress', async () => {
    const { posted, fromProxy } = mount();
    fromProxy({ jsonrpc: '2.0', method: MCP_UI_METHODS.sandboxProxyReady, params: {} });
    await waitFor(() => {
      expect(posted).not.toHaveLength(0);
    });
    const html = String((posted[0]?.message['params'] as Record<string, unknown>)['html']);
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    // The fixture declares no origins, so it may not connect anywhere at all.
    expect(html).toContain(`connect-src 'none'`);
    expect(html).toContain(`default-src 'none'`);
    expect(html).toContain('<body>checklist</body>');
  });

  it('posts only to the proxy origin, never to a wildcard', async () => {
    const { posted, fromProxy } = mount();
    fromProxy({ jsonrpc: '2.0', method: MCP_UI_METHODS.sandboxProxyReady, params: {} });
    await waitFor(() => {
      expect(posted).not.toHaveLength(0);
    });
    for (const entry of posted) expect(entry.origin).toBe(SANDBOX_ORIGIN);
  });

  it('ignores messages that did not come from its own frame', async () => {
    const { posted } = mount();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { jsonrpc: '2.0', method: MCP_UI_METHODS.sandboxProxyReady, params: {} },
        origin: SANDBOX_ORIGIN,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted).toHaveLength(0);
  });

  it('honours the resource border preference', () => {
    const { view } = mount();
    expect(screen.getByTestId('mcp-app-view').getAttribute('data-prefers-border')).toBe('true');
    cleanup();
    render(
      <McpAppView
        resource={{ ...RESOURCE, meta: { csp: {}, prefersBorder: false } }}
        tool={{ name: 'release_checklist' }}
        result={{}}
        serverName="Acme"
        sandboxOrigin={SANDBOX_ORIGIN}
        onCallTool={async () => ({})}
      />,
    );
    expect(screen.getByTestId('mcp-app-view').getAttribute('data-prefers-border')).toBe('false');
    void view;
  });

  it('says so, in its own words, when it has nowhere to render', () => {
    render(
      <McpAppView
        resource={RESOURCE}
        tool={{ name: 'release_checklist' }}
        result={{}}
        serverName="Acme"
        sandboxOrigin=""
        onCallTool={async () => ({})}
      />,
    );
    expect(screen.getByTestId('mcp-app-view-failure').textContent).toBeTruthy();
  });
});

describe('McpAppView bridge', () => {
  it('delivers tool input then tool result, and only after the view is initialized', async () => {
    const harness = mount();
    harness.fromProxy({ jsonrpc: '2.0', method: MCP_UI_METHODS.sandboxProxyReady, params: {} });
    await waitFor(() => {
      expect(harness.posted).not.toHaveLength(0);
    });

    // Before the handshake completes, nothing but the sandbox notification has gone out.
    const early = harness.posted.map((p) => p.message['method']).filter(Boolean);
    expect(early).toEqual([MCP_UI_METHODS.sandboxResourceReady]);

    await handshake(harness);
    await waitFor(() => {
      const methods = harness.posted.map((p) => p.message['method']).filter(Boolean);
      expect(methods).toContain(MCP_UI_METHODS.toolResult);
    });
    const methods = harness.posted.map((p) => p.message['method']).filter(Boolean);
    expect(methods.indexOf(MCP_UI_METHODS.toolInput)).toBeLessThan(
      methods.indexOf(MCP_UI_METHODS.toolResult),
    );
  });

  it('runs a tool the widget asks for and answers with the result', async () => {
    const onCallTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'advanced' }] }));
    const harness = mount({ onCallTool });
    await handshake(harness);

    harness.fromProxy({
      jsonrpc: '2.0',
      id: 'w1',
      method: 'tools/call',
      params: { name: 'advance_release', arguments: {} },
    });
    await waitFor(() => {
      expect(onCallTool).toHaveBeenCalledWith('advance_release', {});
    });
    await waitFor(() => {
      expect(harness.posted.find((p) => p.message['id'] === 'w1')?.message['result']).toEqual({
        content: [{ type: 'text', text: 'advanced' }],
      });
    });
  });

  it('surfaces a refused tool call as an error the widget can see', async () => {
    const onCallTool = vi.fn(async () => {
      throw new Error('server said no');
    });
    const harness = mount({ onCallTool });
    await handshake(harness);
    harness.fromProxy({
      jsonrpc: '2.0',
      id: 'w2',
      method: 'tools/call',
      params: { name: 'advance_release' },
    });
    await waitFor(() => {
      const answer = harness.posted.find((p) => p.message['id'] === 'w2')?.message;
      expect(answer?.['error']).toBeDefined();
      // Application-owned copy: the remote server's own text never reaches the widget.
      expect(JSON.stringify(answer)).not.toContain('server said no');
    });
  });

  it('opens an off-origin link in a new tab with the opener severed', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const harness = mount();
    await handshake(harness);
    harness.fromProxy({
      jsonrpc: '2.0',
      id: 'w3',
      method: MCP_UI_METHODS.openLink,
      params: { url: 'https://acme.example/releases/4-2' },
    });
    await waitFor(() => {
      expect(open).toHaveBeenCalledWith(
        'https://acme.example/releases/4-2',
        '_blank',
        'noopener,noreferrer',
      );
    });
    expect(harness.posted.find((p) => p.message['id'] === 'w3')?.message['result']).toEqual({});
  });

  it('refuses a link that is not http(s) rather than handing it to the browser', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const harness = mount();
    await handshake(harness);
    harness.fromProxy({
      jsonrpc: '2.0',
      id: 'w4',
      method: MCP_UI_METHODS.openLink,
      params: { url: 'javascript:alert(1)' },
    });
    await waitFor(() => {
      expect(harness.posted.find((p) => p.message['id'] === 'w4')?.message['error']).toBeDefined();
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('passes a widget message and a context update to the conversation', async () => {
    const onMessage = vi.fn(() => true);
    const onModelContext = vi.fn();
    const harness = mount({ onMessage, onModelContext });
    await handshake(harness);

    harness.fromProxy({
      jsonrpc: '2.0',
      id: 'w5',
      method: MCP_UI_METHODS.message,
      params: { role: 'user', content: [{ type: 'text', text: 'Undo that' }] },
    });
    harness.fromProxy({
      jsonrpc: '2.0',
      id: 'w6',
      method: MCP_UI_METHODS.updateModelContext,
      params: { content: [{ type: 'text', text: 'The user advanced the checklist.' }] },
    });

    await waitFor(() => {
      expect(onMessage).toHaveBeenCalledWith('Undo that');
    });
    await waitFor(() => {
      expect(onModelContext).toHaveBeenCalledWith('The user advanced the checklist.');
    });
  });

  it('follows the height the widget reports instead of scrolling inside a fixed box', async () => {
    const harness = mount();
    await handshake(harness);
    await act(async () => {
      harness.fromProxy({
        jsonrpc: '2.0',
        method: MCP_UI_METHODS.sizeChanged,
        params: { width: 400, height: 322 },
      });
    });
    await waitFor(() => {
      expect(harness.frame.style.height).toBe('322px');
    });

    // …but never past the cap, so a runaway widget cannot take over the transcript.
    await act(async () => {
      harness.fromProxy({
        jsonrpc: '2.0',
        method: MCP_UI_METHODS.sizeChanged,
        params: { height: 99999 },
      });
    });
    await waitFor(() => {
      expect(harness.frame.style.height).toBe('640px');
    });
  });

  it('returns attempted background focus to the fullscreen card', async () => {
    const outside = document.createElement('button');
    outside.textContent = 'Background control';
    document.body.append(outside);

    try {
      const harness = mount();
      await handshake(harness, { availableDisplayModes: ['inline', 'fullscreen'] });
      await act(async () => {
        harness.fromProxy({
          jsonrpc: '2.0',
          id: 'full-1',
          method: MCP_UI_METHODS.requestDisplayMode,
          params: { mode: 'fullscreen' },
        });
      });

      const close = await screen.findByRole('button', { name: 'Close' });
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');

      outside.focus();
      fireEvent.focusIn(outside);

      expect(close).toHaveFocus();
    } finally {
      outside.remove();
    }
  });

  it('restyles in place when the theme flips, with no reload', async () => {
    const harness = mount();
    await handshake(harness);
    const srcBefore = harness.frame.getAttribute('src');

    document.documentElement.dataset['theme'] = 'dark';
    await waitFor(() => {
      const patch = harness.posted.find(
        (p) => p.message['method'] === MCP_UI_METHODS.hostContextChanged,
      );
      expect((patch?.message['params'] as Record<string, unknown>)['theme']).toBe('dark');
    });
    // The frame was never re-pointed, so nothing inside it was lost.
    expect(harness.frame.getAttribute('src')).toBe(srcBefore);
    delete document.documentElement.dataset['theme'];
  });
});

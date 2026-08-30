/**
 * The MCP Apps sandbox proxy, exercised by running its own script.
 *
 * @remarks
 * The proxy ships as an HTML string because it runs under a policy that forbids fetching
 * anything, so there is no module to import and assert on. Rather than assert on the source text
 * — which proves nothing about behaviour — these tests extract the inline script and execute it
 * against a hand-built stand-in for the three browser objects it touches. The forwarding rules,
 * the origin check, and the one-document-per-proxy rule are therefore tested as behaviour.
 */
import { describe, expect, it } from 'vitest';

import { MCP_UI_METHODS } from '@docket/types';
import { MCP_APP_PROXY_SANDBOX, MCP_APP_VIEW_SANDBOX, buildViewCsp } from '../../src/mcp-apps-host';
import {
  MCP_APP_SANDBOX_CSP,
  sandboxProxyDocument,
  sandboxResourceParams,
  withCspMeta,
} from '../../src/mcp-apps-sandbox';

interface PostedToHost {
  readonly message: unknown;
  readonly origin: string;
}

/** A minimal stand-in for the frame the proxy runs in. */
function runProxy(hostOrigin: string) {
  const document = sandboxProxyDocument(hostOrigin);
  const script = /<script>([\s\S]*?)<\/script>/.exec(document)?.[1];
  if (!script) throw new Error('The sandbox proxy document has no inline script');

  const toHost: PostedToHost[] = [];
  const toView: unknown[] = [];
  const listeners: ((event: Record<string, unknown>) => void)[] = [];
  const appended: { attributes: Record<string, string>; srcdoc?: string }[] = [];

  const parentWindow = {
    postMessage: (message: unknown, origin: string) => toHost.push({ message, origin }),
  };
  const viewWindow = { postMessage: (message: unknown) => toView.push(message) };

  const windowStub = {
    addEventListener: (_type: string, handler: (event: Record<string, unknown>) => void) =>
      listeners.push(handler),
  };
  const documentStub = {
    createElement: () => {
      const element = {
        attributes: {} as Record<string, string>,
        srcdoc: undefined as string | undefined,
        contentWindow: viewWindow,
        setAttribute(name: string, value: string) {
          element.attributes[name] = value;
        },
      };
      return element;
    },
    body: {
      appendChild: (element: { attributes: Record<string, string>; srcdoc?: string }) =>
        appended.push(element),
    },
  };

  // Running the shipped script is the point: asserting on its source text would prove nothing
  // about how it behaves, and this string is repo-authored, not attacker-supplied.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- see above
  const run = new Function('window', 'parent', 'document', script) as (
    w: unknown,
    p: unknown,
    d: unknown,
  ) => void;
  run(windowStub, parentWindow, documentStub);

  const dispatch = (event: Record<string, unknown>): void => {
    for (const listener of listeners) listener(event);
  };

  return {
    document,
    toHost,
    toView,
    appended,
    dispatch,
    parentWindow,
    viewWindow,
    /** The inner frame element, once a document has been loaded. */
    frame: () => appended[0],
    /** The window the proxy will recognise as the view's. */
    viewSource: () => viewWindow,
  };
}

const HOST = 'https://docket.test';

describe('sandbox proxy document', () => {
  it('announces itself to the host as soon as it loads', () => {
    const proxy = runProxy(HOST);
    expect(proxy.toHost).toEqual([
      {
        message: { jsonrpc: '2.0', method: MCP_UI_METHODS.sandboxProxyReady, params: {} },
        origin: HOST,
      },
    ]);
  });

  it('renders the document it is handed under the policy it is handed', () => {
    const proxy = runProxy(HOST);
    proxy.dispatch({
      source: proxy.parentWindow,
      origin: HOST,
      data: {
        jsonrpc: '2.0',
        method: MCP_UI_METHODS.sandboxResourceReady,
        params: {
          html: '<!doctype html><html><head></head><body>hi</body></html>',
          sandbox: MCP_APP_VIEW_SANDBOX,
          allow: `camera 'src'`,
        },
      },
    });

    const frame = proxy.frame();
    expect(frame?.srcdoc).toContain('<body>hi</body>');
    expect(frame?.attributes['sandbox']).toBe(MCP_APP_VIEW_SANDBOX);
    expect(frame?.attributes['allow']).toBe(`camera 'src'`);
    expect(frame?.attributes['referrerpolicy']).toBe('no-referrer');
  });

  it('accepts messages only from the host origin it was built for', () => {
    const proxy = runProxy(HOST);
    proxy.dispatch({
      source: proxy.parentWindow,
      origin: 'https://attacker.test',
      data: {
        jsonrpc: '2.0',
        method: MCP_UI_METHODS.sandboxResourceReady,
        params: { html: '<html><body>evil</body></html>' },
      },
    });
    expect(proxy.appended).toHaveLength(0);
  });

  it('loads one document and ignores any attempt to swap it', () => {
    const proxy = runProxy(HOST);
    const load = (body: string): void => {
      proxy.dispatch({
        source: proxy.parentWindow,
        origin: HOST,
        data: {
          jsonrpc: '2.0',
          method: MCP_UI_METHODS.sandboxResourceReady,
          params: { html: `<html><body>${body}</body></html>` },
        },
      });
    };
    load('first');
    load('second');
    expect(proxy.appended).toHaveLength(1);
    expect(proxy.frame()?.srcdoc).toContain('first');
  });

  it('forwards both directions without synthesizing requests or request ids', () => {
    const proxy = runProxy(HOST);
    proxy.dispatch({
      source: proxy.parentWindow,
      origin: HOST,
      data: {
        jsonrpc: '2.0',
        method: MCP_UI_METHODS.sandboxResourceReady,
        params: { html: '<html><body>v</body></html>' },
      },
    });

    // Host -> View.
    const toolResult = {
      jsonrpc: '2.0',
      method: MCP_UI_METHODS.toolResult,
      params: { content: [] },
    };
    proxy.dispatch({ source: proxy.parentWindow, origin: HOST, data: toolResult });
    expect(proxy.toView).toEqual([toolResult]);

    // View -> Host. The inner frame's origin is opaque, so identity is the source window.
    const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'refresh' } };
    proxy.dispatch({ source: proxy.viewSource(), origin: 'null', data: call });
    expect(proxy.toHost.at(-1)).toEqual({ message: call, origin: HOST });
    expect(proxy.toHost.filter((entry) => 'id' in (entry.message as object))).toEqual([
      { message: call, origin: HOST },
    ]);
  });

  it('never forwards a sandbox-reserved message in either direction', () => {
    const proxy = runProxy(HOST);
    proxy.dispatch({
      source: proxy.parentWindow,
      origin: HOST,
      data: {
        jsonrpc: '2.0',
        method: MCP_UI_METHODS.sandboxResourceReady,
        params: { html: '<html><body>v</body></html>' },
      },
    });
    const hostCount = proxy.toHost.length;

    proxy.dispatch({
      source: proxy.viewSource(),
      origin: 'null',
      data: { jsonrpc: '2.0', method: MCP_UI_METHODS.sandboxProxyReady, params: {} },
    });
    expect(proxy.toHost).toHaveLength(hostCount);

    proxy.dispatch({
      source: proxy.parentWindow,
      origin: HOST,
      data: { jsonrpc: '2.0', method: MCP_UI_METHODS.sandboxProxyReady, params: {} },
    });
    expect(proxy.toView).toHaveLength(0);
  });

  it('ignores anything that is not a JSON-RPC 2.0 message', () => {
    const proxy = runProxy(HOST);
    const before = proxy.toHost.length;
    proxy.dispatch({ source: proxy.parentWindow, origin: HOST, data: null });
    proxy.dispatch({ source: proxy.parentWindow, origin: HOST, data: { type: 'hmr' } });
    proxy.dispatch({ source: {}, origin: HOST, data: { jsonrpc: '2.0', method: 'ping' } });
    expect(proxy.toHost).toHaveLength(before);
    expect(proxy.appended).toHaveLength(0);
  });

  it('drops host traffic that arrives before a document is loaded', () => {
    const proxy = runProxy(HOST);
    proxy.dispatch({
      source: proxy.parentWindow,
      origin: HOST,
      data: { jsonrpc: '2.0', method: MCP_UI_METHODS.toolResult, params: {} },
    });
    expect(proxy.toView).toHaveLength(0);
  });

  it('accepts any host origin when built with a wildcard', () => {
    const proxy = runProxy('*');
    proxy.dispatch({
      source: proxy.parentWindow,
      origin: 'https://anything.test',
      data: {
        jsonrpc: '2.0',
        method: MCP_UI_METHODS.sandboxResourceReady,
        params: { html: '<html><body>x</body></html>' },
      },
    });
    expect(proxy.appended).toHaveLength(1);
  });

  it('runs itself under a policy that cannot reach the network', () => {
    expect(MCP_APP_SANDBOX_CSP).toContain(`connect-src 'none'`);
    expect(MCP_APP_SANDBOX_CSP).toContain(`default-src 'none'`);
    expect(MCP_APP_PROXY_SANDBOX).toContain('allow-same-origin');
  });
});

describe('policy injection', () => {
  it('puts the CSP first in the head so it governs everything after it', () => {
    const injected = withCspMeta(
      '<!doctype html><html><head><title>x</title></head></html>',
      'a b',
    );
    expect(injected).toContain('<head><meta http-equiv="Content-Security-Policy" content="a b">');
    expect(injected.indexOf('Content-Security-Policy')).toBeLessThan(injected.indexOf('<title>'));
  });

  it('synthesizes a head for a document that has none', () => {
    expect(withCspMeta('<html><body>x</body></html>', 'p')).toContain(
      '<html><head><meta http-equiv="Content-Security-Policy" content="p"></head><body>',
    );
    expect(withCspMeta('<body>x</body>', 'p')).toMatch(/^<head><meta/);
  });

  it('escapes quotes so a policy value cannot break out of the attribute', () => {
    expect(withCspMeta('<html><head></head></html>', 'script-src "x"')).toContain(
      'content="script-src &quot;x&quot;"',
    );
  });

  it('hands the proxy the computed policy rather than the raw declaration', () => {
    const params = sandboxResourceParams({
      uri: 'ui://acme/view',
      mimeType: 'text/html;profile=mcp-app',
      text: '<html><head></head><body>x</body></html>',
      meta: { csp: { connectDomains: ['https://api.acme.test'] }, permissions: { camera: {} } },
    });
    expect(String(params['html'])).toContain(
      buildViewCsp({ connectDomains: ['https://api.acme.test'] }),
    );
    expect(params['sandbox']).toBe(MCP_APP_VIEW_SANDBOX);
    expect(params['allow']).toBe(`camera 'src'`);
  });

  it('defaults csp/permissions to empty objects for a resource with no meta at all', () => {
    const params = sandboxResourceParams({
      uri: 'ui://acme/view',
      mimeType: 'text/html;profile=mcp-app',
      text: '<html><head></head><body>x</body></html>',
    });
    expect(params['csp']).toEqual({});
    expect(params['permissions']).toEqual({});
  });
});

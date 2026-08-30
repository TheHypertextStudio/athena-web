/**
 * `AthenaMcpPanel`'s widget→conversation wiring.
 *
 * @remarks
 * `McpAppView` already proves the protocol reaches this panel's `onMessage`
 * props (`mcp-app-view.test.tsx`). What that suite does NOT cover — and what was the actual
 * gap — is what this panel DOES with them. Before this test existed, both callbacks only wrote to
 * local `useState`: a widget's `ui/message` never reached the conversation. These tests drive the real
 * `McpAppView` bridge through a fake proxy frame (the same technique `mcp-app-view.test.tsx` uses)
 * and assert on the one HTTP call that actually matters: `POST /v1/me/athena/chat/messages`, the
 * same endpoint the conversation's own composer calls.
 */
import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MCP_UI_METHODS, MCP_UI_MIME_TYPE, MCP_UI_PROTOCOL_VERSION } from '@docket/types';
import { assertDefined } from '@docket/test-utils';

const WIDGET = {
  connectionId: 'conn-1',
  connectionName: 'Acme Release Tracker',
  alias: 'acme',
  tool: 'release_checklist',
  description: 'Show the current release checklist as an interactive card.',
  resourceUri: 'ui://acme-release/checklist',
};

const RESOURCE = {
  uri: 'ui://acme-release/checklist',
  mimeType: MCP_UI_MIME_TYPE,
  text: '<!doctype html><html><head></head><body>checklist</body></html>',
  prefersBorder: true,
  csp: {},
};

// jsdom implements no media queries at all; `McpAppView` probes one while building the widget's
// host context. Real listener bookkeeping is not exercised by these tests (that is
// `mcp-app-view.test.tsx`'s job) — only enough of the shape for the probe not to throw.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    media: query,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }),
});

const widgetsGet = vi.fn();
const callPost = vi.fn();
const chatMessagesPost = vi.fn();
const connectionPreviewPost = vi.fn();
const connectionCreatePost = vi.fn();
const connectionAuthorizePost = vi.fn();
const assignLocation = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      me: {
        athena: {
          'mcp-apps': {
            widgets: { $get: widgetsGet },
            call: { $post: callPost },
            'view-call': { $post: vi.fn() },
          },
          connections: {
            $post: connectionCreatePost,
            preview: { $post: connectionPreviewPost },
            ':id': { authorize: { $post: connectionAuthorizePost } },
          },
          chat: { messages: { $post: chatMessagesPost } },
        },
      },
    },
  },
}));

// The sandbox proxy origin is read from this env var at render time (`AthenaMcpPanel` renders
// `McpAppView` with no `sandboxOrigin` override, unlike `mcp-app-view.test.tsx`'s harness) — unset,
// `McpAppView` renders its "cannot be shown here" failure state instead of an iframe.
const SANDBOX_ORIGIN = 'https://api.docket.test';

// Imported after the mocks above so the module under test shares them.
const { AthenaMcpPanel } = await import('@/components/athena/athena-mcp-panel');

function renderPanel(): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AthenaMcpPanel />
    </QueryClientProvider>,
  );
}

/** Take over the rendered card's iframe so messages can be intercepted and impersonated. */
function captureFrame(): {
  readonly posted: { message: Record<string, unknown>; origin: string }[];
  readonly fromProxy: (data: unknown) => void;
} {
  const frame = assertDefined(document.querySelector('iframe'));
  const posted: { message: Record<string, unknown>; origin: string }[] = [];
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
  return { posted, fromProxy };
}

/** Open the fixture card and complete the view's half of the MCP Apps handshake. */
async function showAndHandshake(): Promise<ReturnType<typeof captureFrame>> {
  const button = await screen.findByText(WIDGET.description);
  assertDefined(button.closest('button')).click();

  await waitFor(() => {
    expect(document.querySelector('iframe')).not.toBeNull();
  });
  const harness = captureFrame();

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
      appCapabilities: {},
      protocolVersion: MCP_UI_PROTOCOL_VERSION,
    },
  });
  await waitFor(() => {
    expect(harness.posted.some((p) => p.message['id'] === 1)).toBe(true);
  });
  harness.fromProxy({ jsonrpc: '2.0', method: MCP_UI_METHODS.initialized, params: {} });
  return harness;
}

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: { assign: assignLocation, href: 'https://docket.test/athena' },
    writable: true,
    configurable: true,
  });
  process.env['NEXT_PUBLIC_API_URL'] = SANDBOX_ORIGIN;
  widgetsGet.mockResolvedValue({ ok: true, status: 200, json: async () => [WIDGET] });
  callPost.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      connectionId: WIDGET.connectionId,
      tool: WIDGET.tool,
      resource: RESOURCE,
      result: { content: [{ type: 'text', text: '3 of 4 done' }], isError: false },
      arguments: {},
    }),
  });
  chatMessagesPost.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id: 'session-1' }),
  });
  connectionPreviewPost.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ name: 'Acme' }),
  });
  connectionCreatePost.mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ id: 'connection-new', authMode: 'oauth', status: 'pending' }),
  });
  connectionAuthorizePost.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ authorizationUrl: 'https://acme.example/authorize' }),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete process.env['NEXT_PUBLIC_API_URL'];
});

describe('AthenaMcpPanel: visible destination', () => {
  it('offers tools and interactive apps directly from Athena', async () => {
    renderPanel();

    expect(await screen.findByRole('heading', { name: 'Tools & apps' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect a tool or app' }));

    expect(screen.getByRole('dialog', { name: 'Connect a tool or app' })).toHaveTextContent(
      'show its interactive apps directly in this conversation',
    );
  });
});

describe('AthenaMcpPanel: ui/message reaches the conversation', () => {
  it('keeps meaningful text visible when a successful tool has no interactive resource', async () => {
    callPost.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        connectionId: WIDGET.connectionId,
        tool: WIDGET.tool,
        resource: null,
        result: { content: [{ type: 'text', text: '3 of 4 done' }], isError: false },
        arguments: {},
      }),
    });
    renderPanel();

    assertDefined((await screen.findByText(WIDGET.description)).closest('button')).click();

    expect(await screen.findByText('3 of 4 done')).toBeVisible();
    expect(screen.getByText('Interactive view unavailable.')).toBeVisible();
    expect(callPost).toHaveBeenCalledOnce();
  });

  it('posts the widget-composed text verbatim to the canonical chat, not just local state', async () => {
    renderPanel();
    const harness = await showAndHandshake();

    harness.fromProxy({
      jsonrpc: '2.0',
      id: 'w1',
      method: MCP_UI_METHODS.message,
      params: { role: 'user', content: [{ type: 'text', text: 'Undo that' }] },
    });

    await waitFor(() => {
      expect(chatMessagesPost).toHaveBeenCalledWith({ json: { body: 'Undo that' } });
    });
    // The host answers the widget's request once the post actually succeeds, not eagerly.
    await waitFor(() => {
      const answer = harness.posted.find((p) => p.message['id'] === 'w1')?.message;
      expect(answer?.['result']).toEqual({});
    });
    expect(await screen.findByText('Undo that')).toBeInTheDocument();
  });

  it('tells the widget when the post failed instead of pretending it worked', async () => {
    chatMessagesPost.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    renderPanel();
    const harness = await showAndHandshake();

    harness.fromProxy({
      jsonrpc: '2.0',
      id: 'w2',
      method: MCP_UI_METHODS.message,
      params: { role: 'user', content: [{ type: 'text', text: 'Undo that' }] },
    });

    await waitFor(() => {
      const answer = harness.posted.find((p) => p.message['id'] === 'w2')?.message;
      expect(answer?.['error']).toBeDefined();
    });
    expect(
      await screen.findByText(`${WIDGET.connectionName} could not post that to the conversation.`),
    ).toBeInTheDocument();
  });
});

describe('AthenaMcpPanel: personal connection ceremony', () => {
  it('defaults to OAuth, previews identity, and starts owner-scoped approval without exposing a token', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect a tool or app' }));

    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'https://mcp.acme.example/mcp' },
    });
    fireEvent.blur(screen.getByLabelText('Server address'));
    await waitFor(() => {
      expect(connectionPreviewPost).toHaveBeenCalledWith({
        json: { url: 'https://mcp.acme.example/mcp' },
      });
    });

    fireEvent.click(screen.getByText('Other connection methods'));
    expect(screen.getByLabelText('Connection method')).toHaveValue('oauth');
    expect(screen.queryByLabelText('Bearer token')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(connectionCreatePost).toHaveBeenCalledWith({
        json: {
          url: 'https://mcp.acme.example/mcp',
          name: 'Acme',
          alias: 'acme',
          authMode: 'oauth',
        },
      });
    });
    expect(connectionAuthorizePost).toHaveBeenCalledWith({ param: { id: 'connection-new' } });
    expect(assignLocation).toHaveBeenCalledWith('https://acme.example/authorize');
    expect(JSON.stringify(connectionCreatePost.mock.calls)).not.toContain('bearerToken');
  });

  it.each([
    ['bearer', 'Bearer token', 'secret-token'],
    ['none', 'No authentication', null],
  ] as const)(
    'makes %s an explicit alternative and completes its non-OAuth connection check',
    async (authMode, option, token) => {
      connectionCreatePost.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: 'connection-new', authMode, status: 'connected' }),
      });
      renderPanel();
      fireEvent.click(await screen.findByRole('button', { name: 'Connect a tool or app' }));
      fireEvent.change(screen.getByLabelText('Server address'), {
        target: { value: 'https://mcp.acme.example/mcp' },
      });
      fireEvent.click(screen.getByText('Other connection methods'));
      fireEvent.change(screen.getByLabelText('Connection method'), {
        target: { value: authMode },
      });
      expect(screen.getByRole('option', { name: option })).toBeInTheDocument();
      if (token) {
        fireEvent.change(screen.getByLabelText('Bearer token'), { target: { value: token } });
      }

      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

      await waitFor(() => {
        expect(connectionCreatePost).toHaveBeenCalledWith({
          json: {
            url: 'https://mcp.acme.example/mcp',
            name: 'Acme',
            alias: 'acme',
            authMode,
            ...(token ? { bearerToken: token } : {}),
          },
        });
      });
      expect(connectionAuthorizePost).not.toHaveBeenCalled();
    },
  );
});

describe('AthenaMcpPanel: draft model-context updates stay unsupported', () => {
  it('rejects model-context injection without writing to the canonical chat', async () => {
    renderPanel();
    const harness = await showAndHandshake();

    harness.fromProxy({
      jsonrpc: '2.0',
      id: 'w3',
      method: MCP_UI_METHODS.updateModelContext,
      params: {
        content: [{ type: 'text', text: 'The user advanced the release checklist from the card.' }],
      },
    });

    await waitFor(() => {
      expect(
        harness.posted.find((entry) => entry.message['id'] === 'w3')?.message['error'],
      ).toBeDefined();
    });
    expect(chatMessagesPost).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mcp-app-model-context')).not.toBeInTheDocument();
  });
});

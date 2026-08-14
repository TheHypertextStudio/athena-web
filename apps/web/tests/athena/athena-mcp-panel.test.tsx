/**
 * `AthenaMcpPanel`'s widget→conversation wiring (ATH-07, ATH-09).
 *
 * @remarks
 * `McpAppView` already proves the protocol reaches this panel's `onMessage`/`onModelContext`
 * props (`mcp-app-view.test.tsx`). What that suite does NOT cover — and what was the actual
 * gap — is what this panel DOES with them. Before this test existed, both callbacks only wrote to
 * local `useState`: a widget's `ui/message` never reached the conversation, and its
 * `ui/update-model-context` never reached the model's next turn. These tests drive the real
 * `McpAppView` bridge through a fake proxy frame (the same technique `mcp-app-view.test.tsx` uses)
 * and assert on the one HTTP call that actually matters: `POST /v1/me/athena/chat/messages`, the
 * same endpoint the conversation's own composer calls.
 */
import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
          connections: { $post: vi.fn() },
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
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete process.env['NEXT_PUBLIC_API_URL'];
});

describe('AthenaMcpPanel: ui/message reaches the conversation', () => {
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

describe('AthenaMcpPanel: ui/update-model-context reaches the model', () => {
  it('appends the context to the canonical chat, framed as a card update rather than user speech', async () => {
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
      expect(chatMessagesPost).toHaveBeenCalledWith({
        json: {
          body: `${WIDGET.connectionName} card update — The user advanced the release checklist from the card.`,
        },
      });
    });
    // Never framed as if the person typed it verbatim — that is what `ui/message` is for.
    const [call] = chatMessagesPost.mock.calls;
    expect((call as [{ json: { body: string } }])[0].json.body).not.toBe(
      'The user advanced the release checklist from the card.',
    );
  });
});

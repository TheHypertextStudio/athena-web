import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

const { chatGet, chatPost } = vi.hoisted(() => ({
  chatGet: vi.fn(),
  chatPost: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          sessions: {
            chat: {
              $get: chatGet,
              messages: { $post: chatPost },
            },
          },
        },
      },
    },
  },
}));

import AthenaConversation from '../../src/components/athena/athena-conversation';

// jsdom has no scrollIntoView; the component pins the latest turn with it on every append.
Element.prototype.scrollIntoView = vi.fn();

const PRESENTATION = {
  connectionId: 'connection-1',
  serverName: 'Weather Service',
  tool: 'weather_card',
  arguments: { city: 'Las Vegas' },
  result: { content: [{ type: 'text', text: '72 degrees' }], isError: false },
  resource: {
    uri: 'ui://weather/card',
    mimeType: 'text/html;profile=mcp-app',
    text: '<!doctype html><title>Weather</title>',
    meta: { prefersBorder: true },
  },
} as const;

function thread(activities: readonly Record<string, unknown>[]) {
  return {
    id: 'chat_session',
    kind: 'chat',
    status: 'completed',
    objective: 'Chat',
    startedAt: '2026-08-30T10:00:00.000Z',
    endedAt: null,
    createdAt: '2026-08-30T10:00:00.000Z',
    activities,
    result: null,
  };
}

function actionActivity(result: Record<string, unknown>) {
  return {
    id: 'activity_action',
    sessionId: 'chat_session',
    organizationId: null,
    type: 'action',
    body: {
      action: {
        kind: 'remote_tool',
        summary: 'Show Las Vegas weather',
        result,
      },
    },
    createdAt: '2026-08-30T10:01:00.000Z',
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AthenaConversation orgId="org_1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete process.env['NEXT_PUBLIC_API_URL'];
});

describe('AthenaConversation MCP app cards', () => {
  it('renders the quiet work chip with the interactive card beneath it', async () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://api.docket.test';
    chatGet.mockResolvedValue(
      okResponse(
        thread([
          actionActivity({
            content: 'Completed: Show Las Vegas weather',
            isError: false,
            presentation: PRESENTATION,
          }),
        ]),
      ),
    );
    mount();

    const chip = await screen.findByText('Show Las Vegas weather');
    const frame = await screen.findByTestId('mcp-app-view');
    expect(chip.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the owned fallback when the tool declared UI that was not retained', async () => {
    chatGet.mockResolvedValue(
      okResponse(
        thread([
          actionActivity({
            content: 'Completed: Show Las Vegas weather',
            isError: false,
            presentationUnavailable: true,
          }),
        ]),
      ),
    );
    mount();

    expect(await screen.findByText('Show Las Vegas weather')).toBeVisible();
    expect(await screen.findByText('Interactive view unavailable.')).toBeVisible();
    expect(screen.queryByTestId('mcp-app-view')).not.toBeInTheDocument();
  });

  it('drops a presentation that fails client-side revalidation to the fallback', async () => {
    chatGet.mockResolvedValue(
      okResponse(
        thread([
          actionActivity({
            content: 'Completed: Show Las Vegas weather',
            isError: false,
            presentation: { ...PRESENTATION, resource: { uri: 'https://not-a-widget' } },
          }),
        ]),
      ),
    );
    mount();

    expect(await screen.findByText('Interactive view unavailable.')).toBeVisible();
    expect(screen.queryByTestId('mcp-app-view')).not.toBeInTheDocument();
  });

  it('sends composer messages to this org thread and renders the returned turn', async () => {
    chatGet.mockResolvedValue(okResponse(thread([])));
    chatPost.mockResolvedValue(
      okResponse(
        thread([
          {
            id: 'activity_user',
            sessionId: 'chat_session',
            organizationId: null,
            type: 'response',
            body: { text: 'Plan my day', author: 'user' },
            createdAt: '2026-08-30T10:02:00.000Z',
          },
        ]),
      ),
    );
    mount();

    const composer = await screen.findByRole('combobox');
    fireEvent.change(composer, { target: { value: 'Plan my day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(chatPost).toHaveBeenCalledWith({
        param: { orgId: 'org_1' },
        json: { body: 'Plan my day' },
      });
    });
    expect(await screen.findByText('Plan my day')).toBeVisible();
  });
});

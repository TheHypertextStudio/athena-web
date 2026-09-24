import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

const { chatGet, elicitationsGet } = vi.hoisted(() => ({
  chatGet: vi.fn(),
  elicitationsGet: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: { ':orgId': { sessions: { chat: { $get: chatGet } } } },
      me: {
        athena: { chat: { messages: { $post: vi.fn() } } },
        elicitations: { $get: elicitationsGet, presence: { $post: vi.fn() } },
      },
    },
  },
}));

import AthenaConversation from '../../src/components/athena/athena-conversation';

describe('Athena failed turn', () => {
  it('explains a persisted failed turn that has no answer after reload', async () => {
    elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
    chatGet.mockResolvedValue(
      okResponse({
        id: 'chat_session',
        kind: 'chat',
        status: 'failed',
        objective: 'Chat',
        startedAt: '2026-08-30T10:00:00.000Z',
        endedAt: null,
        createdAt: '2026-08-30T10:00:00.000Z',
        activities: [
          {
            id: 'user_1',
            sessionId: 'chat_session',
            organizationId: null,
            type: 'response',
            body: { text: 'Help me plan', author: 'user' },
            createdAt: '2026-08-30T10:01:00.000Z',
          },
        ],
        result: null,
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AthenaConversation orgId="01ARZ3NDEKTSV4RRFFQ69G5FAV" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Athena couldn't finish this reply.")).toBeVisible();
    expect(screen.getByText('Help me plan')).toBeVisible();
  });
});

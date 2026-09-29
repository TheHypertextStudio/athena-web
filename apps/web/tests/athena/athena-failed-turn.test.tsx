import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
        athena: {
          chat: {
            messages: { $post: vi.fn() },
            chapters: {
              $get: vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ sessionId: 'chat_session', items: [] }),
              }),
            },
          },
        },
        elicitations: { $get: elicitationsGet, presence: { $post: vi.fn() } },
      },
    },
  },
}));

import AthenaConversation from '../../src/components/athena/athena-conversation';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Athena failed turn', () => {
  it('explains a persisted failed turn that has no answer after reload', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-30T12:05:00.000Z'));
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
    expect(await screen.findByText("Athena couldn't answer.")).toBeVisible();
    expect(screen.getByText('Help me plan')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry message' }));
    expect(screen.getByRole('combobox', { name: 'Message Athena' })).toHaveValue('Help me plan');
  });

  it('names the offline Studio and keeps the saved prompt available to retry', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-30T10:05:00.000Z'));
    elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
    chatGet.mockResolvedValue(
      okResponse({
        id: 'chat_session',
        kind: 'chat',
        status: 'failed',
        objective: 'Chat',
        startedAt: '2026-08-30T10:00:00.000Z',
        endedAt: '2026-08-30T10:01:00.000Z',
        createdAt: '2026-08-30T10:00:00.000Z',
        activities: [
          {
            id: 'user_offline',
            sessionId: 'chat_session',
            organizationId: null,
            type: 'response',
            body: { text: 'Help me plan', author: 'user' },
            createdAt: '2026-08-30T10:00:01.000Z',
          },
          {
            id: 'error_offline',
            sessionId: 'chat_session',
            organizationId: null,
            type: 'error',
            body: {
              source: 'lattice',
              code: 'device_offline',
              text: 'private gateway diagnostic',
            },
            createdAt: '2026-08-30T10:00:02.000Z',
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

    expect(
      await screen.findByText(/That computer is not reachable.*Lattice is running/),
    ).toBeVisible();
    expect(screen.queryByText('private gateway diagnostic')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry message' }));
    expect(screen.getByRole('combobox', { name: 'Message Athena' })).toHaveValue('Help me plan');
  });
});

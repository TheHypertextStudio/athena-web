import type { JSX } from 'react';
import { Activity } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AthenaConversation from '@/components/athena/athena-conversation';
import { okResponse } from '../support/query';

const { chatGet } = vi.hoisted(() => ({ chatGet: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: { ':orgId': { sessions: { chat: { $get: chatGet } } } },
      me: {
        athena: {
          chat: {
            chapters: {
              $get: vi
                .fn()
                .mockResolvedValue(
                  new Response(JSON.stringify({ sessionId: 'chat_session', items: [] })),
                ),
            },
          },
        },
        elicitations: {
          $get: vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }))),
          presence: { $post: vi.fn().mockResolvedValue(new Response('{}')) },
        },
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('keeps an edited launch message when a retained conversation reconnects its effects', async () => {
  chatGet.mockResolvedValue(
    okResponse({
      id: 'chat_session',
      kind: 'chat',
      status: 'completed',
      objective: 'Chat',
      startedAt: '2026-08-30T10:00:00.000Z',
      endedAt: null,
      createdAt: '2026-08-30T10:00:00.000Z',
      activities: [],
      result: null,
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const conversation = (visible: boolean): JSX.Element => (
    <QueryClientProvider client={client}>
      <Activity mode={visible ? 'visible' : 'hidden'}>
        <AthenaConversation
          orgId="01ARZ3NDEKTSV4RRFFQ69G5FAV"
          draftRequest={{ text: 'Help me plan Q3', version: 1 }}
        />
      </Activity>
    </QueryClientProvider>
  );
  const view = render(conversation(true));
  const composer = await screen.findByRole('combobox', { name: 'Message Athena' });
  expect(composer).toHaveValue('Help me plan Q3');
  fireEvent.change(composer, { target: { value: 'My unfinished plan question' } });
  view.rerender(conversation(false));
  expect(screen.queryByRole('combobox', { name: 'Message Athena' })).not.toBeInTheDocument();
  view.rerender(conversation(true));
  expect(await screen.findByRole('combobox', { name: 'Message Athena' })).toHaveValue(
    'My unfinished plan question',
  );
});

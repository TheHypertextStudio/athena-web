import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AthenaConversation from '../../src/components/athena/athena-conversation';
import { queryKeys } from '../../src/lib/query';
import { okResponse } from '../support/query';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

const { chatGet, personalPost, elicitationsGet, presencePost } = vi.hoisted(() => ({
  chatGet: vi.fn(),
  personalPost: vi.fn(),
  elicitationsGet: vi.fn(),
  presencePost: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: { ':orgId': { sessions: { chat: { $get: chatGet } } } },
      me: {
        athena: {
          chat: {
            messages: { $post: personalPost },
            chapters: {
              $get: vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ sessionId: 'chat_session', items: [] }),
              }),
            },
          },
        },
        elicitations: { $get: elicitationsGet, presence: { $post: presencePost } },
      },
    },
  },
}));

Element.prototype.scrollIntoView = vi.fn();

function response(id: string, text: string, author: 'user' | 'athena') {
  return {
    id,
    sessionId: 'chat_session',
    organizationId: null,
    type: 'response',
    body: { text, author },
    createdAt: '2026-08-30T10:01:00.000Z',
  };
}

function thread(activities: readonly ReturnType<typeof response>[]) {
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

function mount(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AthenaConversation orgId={ORG_ID} />
    </QueryClientProvider>,
  );
  return client;
}

async function send(text: string): Promise<HTMLElement> {
  const composer = await screen.findByRole('combobox', { name: 'Message Athena' });
  fireEvent.change(composer, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  return composer;
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-30T12:05:00.000Z'));
  elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Athena send reconciliation', () => {
  it('does not offer a duplicate send when the server saved an answer despite a failed response', async () => {
    const saved = thread([
      response('user_after_send', 'What is 17 + 25?', 'user'),
      response('answer_after_send', '42', 'athena'),
    ]);
    chatGet.mockResolvedValueOnce(okResponse(thread([]))).mockResolvedValue(okResponse(saved));
    personalPost.mockRejectedValue(new Error('response lost after completion'));
    mount();

    const composer = await send('What is 17 + 25?');
    expect(await screen.findByText('42')).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
      expect(composer).toHaveValue('');
    });
    expect(personalPost).toHaveBeenCalledTimes(1);
  });

  it('keeps a real failure when only an earlier identical prompt exists', async () => {
    chatGet.mockResolvedValue(
      okResponse(thread([response('user_before_send', 'Plan my day', 'user')])),
    );
    personalPost.mockRejectedValue(new Error('request refused'));
    mount();

    await screen.findByText('Plan my day');
    const composer = await send('Plan my day');
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(composer).toHaveValue('Plan my day');
  });

  it('clears a stale failure after a later reply without discarding a new draft', async () => {
    chatGet.mockResolvedValue(okResponse(thread([])));
    personalPost.mockRejectedValue(new Error('response lost'));
    const client = mount();

    const composer = await send('What is 17 + 25?');
    expect(await screen.findByRole('alert')).toBeVisible();
    fireEvent.change(composer, { target: { value: 'Another question' } });
    act(() => {
      client.setQueryData(
        queryKeys.chatThread(ORG_ID),
        thread([
          response('user_after_send', 'What is 17 + 25?', 'user'),
          response('answer_after_send', '42', 'athena'),
        ]),
      );
    });

    expect(await screen.findByText('42')).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(composer).toHaveValue('Another question');
    expect(personalPost).toHaveBeenCalledTimes(1);
  });
});

import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

const { chatGet, messagePost } = vi.hoisted(() => ({ chatGet: vi.fn(), messagePost: vi.fn() }));

vi.mock('../../src/lib/api', () => ({
  api: { v1: { me: { athena: { chat: { $get: chatGet, messages: { $post: messagePost } } } } } },
}));

import { sendPersonalMessage, usePersonalThread } from '../../src/lib/athena/thread-defs';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (event: MessageEvent) => void>();
  readonly close = vi.fn();
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(name, listener);
  }
}

function thread(status: string, activities: readonly Record<string, unknown>[] = []) {
  return {
    id: 'chat_1',
    kind: 'chat',
    status,
    objective: 'Chat',
    startedAt: '2026-09-13T10:00:00.000Z',
    endedAt: null,
    createdAt: '2026-09-13T10:00:00.000Z',
    activities,
    result: null,
  };
}

function Readout(): JSX.Element {
  const query = usePersonalThread();
  return <output data-testid="count">{query.data?.activities.length ?? 'none'}</output>;
}

function renderThread(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Readout />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  FakeEventSource.instances = [];
  vi.unstubAllGlobals();
});

describe('sendPersonalMessage', () => {
  it('posts the body with a wire-shaped context', async () => {
    messagePost.mockResolvedValue(okResponse(thread('running')));
    await sendPersonalMessage('What is at risk here?', {
      workspaceId: '01J11111111111111111111111',
      workspaceName: 'Harbor Health',
      source: { type: 'project', id: 'project_1', label: 'Fall fundraiser launch' },
    });
    expect(messagePost).toHaveBeenCalledWith({
      json: {
        body: 'What is at risk here?',
        context: {
          workspaceId: '01J11111111111111111111111',
          source: { type: 'project', id: 'project_1' },
        },
      },
    });
  });

  it('omits context when there is none', async () => {
    messagePost.mockResolvedValue(okResponse(thread('running')));
    await sendPersonalMessage('Plan my afternoon');
    expect(messagePost).toHaveBeenCalledWith({ json: { body: 'Plan my afternoon' } });
  });
});

describe('usePersonalThread', () => {
  it('tails the stream while a turn is in flight and merges what arrives', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    chatGet.mockResolvedValue(okResponse(thread('running')));
    renderThread();

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0');
    });
    expect(FakeEventSource.instances[0]?.url).toBe('/v1/me/athena/sessions/chat_1/stream');

    const listener = FakeEventSource.instances[0]?.listeners.get('response');
    act(() => {
      listener?.({
        data: JSON.stringify({
          id: 'act_1',
          sessionId: 'chat_1',
          type: 'response',
          body: { text: 'Two things.', author: 'athena' },
          createdAt: '2026-09-13T10:00:01.000Z',
        }),
      } as MessageEvent);
    });
    // The cache updates synchronously, but TanStack Query's notifyManager flushes the resulting
    // observer notification on its own microtask tick rather than within `act`'s synchronous
    // flush, so the DOM update is awaited rather than asserted immediately.
    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1');
    });
  });

  it('invalidates and refetches the thread when the stream errors', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    chatGet.mockResolvedValue(okResponse(thread('running')));
    renderThread();

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0');
    });
    const callsBeforeError = chatGet.mock.calls.length;

    const source = FakeEventSource.instances[0];
    act(() => {
      source?.onerror?.();
    });

    await waitFor(() => {
      expect(chatGet.mock.calls.length).toBe(callsBeforeError + 1);
    });
    expect(source?.close).toHaveBeenCalledTimes(1);
  });

  it('opens no stream for a settled thread', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    chatGet.mockResolvedValue(okResponse(thread('completed')));
    renderThread();

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0');
    });
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});

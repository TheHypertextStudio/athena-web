/**
 * Behavior tests for the Athena suggestions lane.
 *
 * @remarks
 * The critical contract is edit-then-accept: editing fields before accepting must submit
 * ONLY the changed fields as accept-time overrides (the API applies them on the
 * materialized task), and a plain Accept submits an empty override object. The thread
 * preview must fetch lazily — no provider round-trip until the user expands it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { listGet, acceptPost, dismissPost, threadGet } = vi.hoisted(() => ({
  listGet: vi.fn(),
  acceptPost: vi.fn(),
  dismissPost: vi.fn(),
  threadGet: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          'email-suggestions': {
            $get: listGet,
            ':id': {
              accept: { $post: acceptPost },
              dismiss: { $post: dismissPost },
              thread: { $get: threadGet },
            },
          },
        },
      },
    },
  },
}));

import SuggestionsLane from '../../../src/components/triage/suggestions-lane';

/** A `Response`-like stub whose `ok`/`json()` the query layer reads. */
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const SUGGESTION = {
  id: 'sugg_1',
  organizationId: 'org_1',
  integrationId: 'intg_1',
  externalThreadId: 'thread_1',
  title: 'Schedule the SWE interview',
  description: 'They proposed slots.',
  dueDate: null,
  priority: 'high',
  suggestedProjectId: null,
  suggestedProgramId: null,
  confidence: 84,
  status: 'pending',
  emailMeta: { sender: 'recruiter@google.com', subject: 'Interview', snippet: 'pick a slot' },
  createdTaskId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function renderLane(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SuggestionsLane orgId="org_1" canAct />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SuggestionsLane', () => {
  it('plain Accept submits an empty override object', async () => {
    listGet.mockResolvedValue(jsonResponse({ items: [SUGGESTION] }));
    acceptPost.mockResolvedValue(jsonResponse({ ...SUGGESTION, status: 'accepted' }));
    renderLane();

    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => {
      expect(acceptPost).toHaveBeenCalledWith({
        param: { orgId: 'org_1', id: 'sugg_1' },
        json: {},
      });
    });
  });

  it('edit-then-accept submits only the changed fields as overrides', async () => {
    listGet.mockResolvedValue(jsonResponse({ items: [SUGGESTION] }));
    acceptPost.mockResolvedValue(jsonResponse({ ...SUGGESTION, status: 'accepted' }));
    renderLane();

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Task title'), {
      target: { value: 'Schedule the interview — Thursday slot' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Accept edits' }));

    await waitFor(() => {
      expect(acceptPost).toHaveBeenCalledWith({
        param: { orgId: 'org_1', id: 'sugg_1' },
        json: { title: 'Schedule the interview — Thursday slot' },
      });
    });
  });

  it('fetches the source thread lazily, only on expand', async () => {
    listGet.mockResolvedValue(jsonResponse({ items: [SUGGESTION] }));
    threadGet.mockResolvedValue(
      jsonResponse({
        threadId: 'thread_1',
        subject: 'Interview',
        externalUrl: 'https://mail.example/thread_1',
        messages: [
          {
            id: 'm1',
            from: 'recruiter@google.com',
            to: ['ada@example.com'],
            subject: 'Interview',
            snippet: 'pick a slot',
            sentAt: '2026-01-01T00:00:00.000Z',
            rfc822MessageId: null,
            bodyHtml: null,
          },
        ],
      }),
    );
    renderLane();

    await screen.findByRole('button', { name: 'Show thread' });
    expect(threadGet).not.toHaveBeenCalled(); // lazy: nothing fetched while collapsed

    fireEvent.click(screen.getByRole('button', { name: 'Show thread' }));
    await waitFor(() => {
      expect(threadGet).toHaveBeenCalledWith({ param: { orgId: 'org_1', id: 'sugg_1' } });
    });
    await screen.findByText('Open email');
  });
});

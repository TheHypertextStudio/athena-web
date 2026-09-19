import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

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
        athena: { chat: { messages: { $post: personalPost } } },
        elicitations: { $get: elicitationsGet, presence: { $post: presencePost } },
      },
    },
  },
}));

import { AthenaWorkspace } from '../../src/components/athena/athena-workspace';
import type { PersonalAthenaSessionSummary } from '../../src/lib/athena/presentation';
import type { PersonalAthenaTransport } from '../../src/lib/athena/query-defs';

// jsdom has no scrollIntoView; the conversation pins the latest turn with it on every append.
Element.prototype.scrollIntoView = vi.fn();

const WORKSPACE_ID = 'workspace_1';

/** The org's persistent chat thread, empty by default. */
function chatThread() {
  return {
    id: 'chat_1',
    kind: 'chat',
    status: 'completed',
    objective: 'Chat',
    startedAt: '2026-09-18T10:00:00.000Z',
    endedAt: null,
    createdAt: '2026-09-18T10:00:00.000Z',
    activities: [],
    result: null,
  };
}

function job(overrides: Partial<PersonalAthenaSessionSummary> = {}): PersonalAthenaSessionSummary {
  return {
    id: 'working_1',
    objective: 'Prepare the launch review',
    status: 'running',
    queueState: 'working',
    workspace: { id: WORKSPACE_ID, name: 'Hypertext Studio' },
    createdAt: '2026-07-15T15:00:00.000Z',
    updatedAt: '2026-07-15T16:00:00.000Z',
    ...overrides,
  };
}

/** A queue with one job in each lane, all scoped to {@link WORKSPACE_ID}. */
function transport(): PersonalAthenaTransport {
  return {
    pulse: vi.fn(),
    queue: vi.fn().mockResolvedValue(
      okResponse({
        counts: { needsYou: 1, working: 1, finished: 1 },
        currentChat: null,
        sessions: {
          needsYou: [
            job({
              id: 'needs_1',
              objective: 'Approve the recap email',
              status: 'awaiting_approval',
              queueState: 'needs_you',
            }),
          ],
          working: [job()],
          finished: [
            job({
              id: 'finished_1',
              objective: 'Send the weekly recap',
              status: 'completed',
              queueState: 'finished',
            }),
          ],
        },
      }),
    ),
    detail: vi.fn((id: string) => Promise.resolve(okResponse({ ...job({ id }), activities: [] }))),
    activity: vi.fn(),
    create: vi.fn(),
    sendMessage: vi.fn(),
    decide: vi.fn(),
    lifecycle: vi.fn(),
    undoChange: vi.fn(),
    proposals: vi.fn(),
  };
}

function renderWorkspace(props: Partial<Parameters<typeof AthenaWorkspace>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AthenaWorkspace transport={transport()} workspaceFilter={WORKSPACE_ID} {...props} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AthenaWorkspace', () => {
  it('shows the Work ledger filters with counts drawn from the queue payload', async () => {
    chatGet.mockResolvedValue(okResponse(chatThread()));
    elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
    renderWorkspace();

    const runningTab = await screen.findByRole('tab', { name: /running/i });
    const needsYouTab = screen.getByRole('tab', { name: /needs you/i });
    const doneTab = screen.getByRole('tab', { name: /done/i });
    expect(within(runningTab).getByText('1')).toBeInTheDocument();
    expect(within(needsYouTab).getByText('1')).toBeInTheDocument();
    expect(within(doneTab).getByText('1')).toBeInTheDocument();
  });

  it('renders a queued job as a card in the thread', async () => {
    chatGet.mockResolvedValue(okResponse(chatThread()));
    elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
    renderWorkspace();

    expect(await screen.findByRole('article', { name: /Prepare the launch review/ })).toBeVisible();
  });

  it('shows the composer with the workspace context chip', async () => {
    chatGet.mockResolvedValue(okResponse(chatThread()));
    elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
    renderWorkspace({
      invocationContext: {
        workspaceId: WORKSPACE_ID,
        source: { type: 'project', id: 'project_1', label: 'Fall fundraiser launch' },
      },
    });

    const form = await screen.findByRole('form', { name: /Message Athena/ });
    expect(within(form).getByRole('group', { name: /Fall fundraiser launch/ })).toBeVisible();
  });

  it('scrolls a ledger row to its card once the card has mounted in the thread', async () => {
    chatGet.mockResolvedValue(okResponse(chatThread()));
    elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderWorkspace();

    await screen.findByRole('article', { name: /Prepare the launch review/ });
    const before = scroll.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /Prepare the launch review/ }));

    await waitFor(() => {
      expect(scroll.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it('asks the thread to scroll to a ledger row instead of pinning a duplicate card', async () => {
    chatGet.mockResolvedValue(okResponse(chatThread()));
    elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
    const scrollTargets: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrollTargets.push(this);
    };
    renderWorkspace();

    await screen.findByRole('article', { name: /Prepare the launch review/ });
    fireEvent.click(screen.getByRole('button', { name: /Prepare the launch review/ }));

    await waitFor(() => {
      expect(scrollTargets.at(-1)?.id).toBe('athena-job-working_1');
    });
    expect(screen.getAllByRole('article', { name: /Prepare the launch review/ })).toHaveLength(1);
  });

  it('does not run a second presence heartbeat for the wide view', async () => {
    chatGet.mockResolvedValue(okResponse(chatThread()));
    elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
    renderWorkspace();

    await screen.findByRole('article', { name: /Prepare the launch review/ });
    expect(elicitationsGet).not.toHaveBeenCalled();
  });
});

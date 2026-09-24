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
  it('shows only the ledger filters that have work, with no counts', async () => {
    chatGet.mockResolvedValue(okResponse(chatThread()));
    elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
    renderWorkspace();

    await screen.findByRole('tab', { name: /running/i });
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) expect(tab.textContent).not.toMatch(/\d/);
  });

  it('keeps each piece of work in the ledger only, never also in the thread', async () => {
    chatGet.mockResolvedValue(okResponse(chatThread()));
    elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
    renderWorkspace();

    // The ledger opens on waiting work first.
    const entry = await screen.findByRole('article', { name: /Approve the recap email/ });
    expect(entry.closest('[data-slot="athena-work-ledger"]')).not.toBeNull();
    expect(screen.getAllByRole('article', { name: /Approve the recap email/ })).toHaveLength(1);
    expect(document.querySelector('[data-slot="athena-thread"] [data-athena-job]')).toBeNull();
  });

  it('keeps context and Talk with the composer, without a promotional header', async () => {
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
    expect(within(form).getByRole('button', { name: 'Talk' })).toBeVisible();
    expect(document.querySelector('[data-slot="athena-workspace-header"]')).toBeNull();
  });

  it('opens on a linked job: switches to its filter and scrolls to its entry', async () => {
    chatGet.mockResolvedValue(okResponse(chatThread()));
    elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
    const scrollTargets: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrollTargets.push(this);
    };
    renderWorkspace({ initialSessionId: 'needs_1' });

    await screen.findByRole('article', { name: /Approve the recap email/ });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(/needs you/i);
    await waitFor(() => {
      expect(
        scrollTargets.some((target) => target.getAttribute('data-athena-job') === 'needs_1'),
      ).toBe(true);
    });
  });

  it('switches the ledger when another filter is picked', async () => {
    chatGet.mockResolvedValue(okResponse(chatThread()));
    elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
    renderWorkspace();

    fireEvent.click(await screen.findByRole('tab', { name: /done/i }));

    expect(
      await screen.findByRole('article', { name: /Send the weekly recap/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: /Approve the recap email/ })).toBeNull();
  });

  it('owns the page’s questions, since no rail conversation sits beside it', async () => {
    chatGet.mockResolvedValue(okResponse(chatThread()));
    elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
    renderWorkspace();

    await screen.findByRole('form', { name: /Message Athena/ });
    await waitFor(() => {
      expect(elicitationsGet).toHaveBeenCalled();
    });
  });
});

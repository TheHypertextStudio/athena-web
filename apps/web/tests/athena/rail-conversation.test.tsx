import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

const { chatGet, personalPost, pulseGet, elicitationsGet, presencePost } = vi.hoisted(() => ({
  chatGet: vi.fn(),
  personalPost: vi.fn(),
  pulseGet: vi.fn(),
  elicitationsGet: vi.fn(),
  presencePost: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: { ':orgId': { sessions: { chat: { $get: chatGet } } } },
      me: {
        athena: { chat: { messages: { $post: personalPost } }, pulse: { $get: pulseGet } },
        elicitations: { $get: elicitationsGet, presence: { $post: presencePost } },
      },
    },
  },
}));

import { AthenaRailConversation } from '../../src/components/athena/athena-rail-conversation';
import { AthenaPanelProvider } from '../../src/components/athena/athena-panel-provider';
import { PageContextProvider, PageSource } from '../../src/components/athena/page-context';
import type { PersonalAthenaSessionSummary } from '../../src/lib/athena/presentation';
import type { PersonalAthenaTransport } from '../../src/lib/athena/query-defs';

// jsdom has no scrollIntoView; the conversation pins the latest turn with it on every append.
Element.prototype.scrollIntoView = vi.fn();

const ORG_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

function thread() {
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

/** A queue transport reporting no open work, for the tests that only care about the header/thread. */
function emptyQueueTransport(): PersonalAthenaTransport {
  return {
    pulse: vi.fn(),
    queue: vi.fn().mockResolvedValue(
      okResponse({
        counts: { needsYou: 0, working: 0, finished: 0 },
        currentChat: null,
        sessions: { needsYou: [], working: [], finished: [] },
      }),
    ),
    detail: vi.fn(),
    activity: vi.fn(),
    create: vi.fn(),
    sendMessage: vi.fn(),
    decide: vi.fn(),
    lifecycle: vi.fn(),
  };
}

beforeEach(() => {
  elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
});

afterEach(cleanup);

describe('AthenaRailConversation', () => {
  it('names itself, links to the wide view for the workspace, and shows the page chip', async () => {
    chatGet.mockResolvedValue(okResponse(thread()));
    pulseGet.mockResolvedValue(okResponse({ needsYou: 0, working: 0 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PageContextProvider workspace={{ workspaceId: ORG_ID, workspaceName: 'Harbor Health' }}>
          <PageSource type="project" id="project_1" label="Fall fundraiser launch" />
          <AthenaPanelProvider railVisible onRevealRail={vi.fn()}>
            <AthenaRailConversation orgId={ORG_ID} transport={emptyQueueTransport()} />
          </AthenaPanelProvider>
        </PageContextProvider>
      </QueryClientProvider>,
    );
    const link = screen.getByRole('link', { name: /Open the Athena page/ });
    expect(link).toHaveAttribute('href', `/athena?workspace=${ORG_ID}`);
    const form = await screen.findByRole('form', { name: /Message Athena/ });
    expect(within(form).getByRole('group', { name: /Fall fundraiser launch/ })).toBeVisible();
  });

  it('shows the Working strip and the job as a thread card while work is running', async () => {
    chatGet.mockResolvedValue(okResponse(thread()));
    pulseGet.mockResolvedValue(okResponse({ needsYou: 0, working: 1 }));
    const runningJob: PersonalAthenaSessionSummary = {
      id: 'job_1',
      objective: 'Draft the launch update',
      status: 'running',
      queueState: 'working',
      createdAt: '2026-09-18T09:00:00.000Z',
      updatedAt: '2026-09-18T09:00:00.000Z',
    };
    const transport: PersonalAthenaTransport = {
      pulse: vi.fn(),
      queue: vi.fn().mockResolvedValue(
        okResponse({
          counts: { needsYou: 0, working: 1, finished: 0 },
          currentChat: null,
          sessions: { needsYou: [], working: [runningJob], finished: [] },
        }),
      ),
      detail: vi.fn().mockResolvedValue(okResponse({ ...runningJob, activities: [] })),
      activity: vi.fn(),
      create: vi.fn(),
      sendMessage: vi.fn(),
      decide: vi.fn(),
      lifecycle: vi.fn(),
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PageContextProvider workspace={{ workspaceId: ORG_ID }}>
          <AthenaPanelProvider railVisible onRevealRail={vi.fn()}>
            <AthenaRailConversation orgId={ORG_ID} transport={transport} />
          </AthenaPanelProvider>
        </PageContextProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: /Working ·/ })).toBeVisible();
    expect(screen.getByRole('article', { name: /Draft the launch update/ })).toBeVisible();
  });

  it('shows no strip when the working lane holds only the person’s own conversation', async () => {
    chatGet.mockResolvedValue(okResponse(thread()));
    pulseGet.mockResolvedValue(okResponse({ needsYou: 0, working: 1 }));
    const chatSession: PersonalAthenaSessionSummary = {
      id: 'chat_1',
      objective: 'Chat',
      status: 'running',
      queueState: 'working',
      createdAt: '2026-09-18T09:00:00.000Z',
      updatedAt: '2026-09-18T09:00:00.000Z',
    };
    const transport: PersonalAthenaTransport = {
      pulse: vi.fn(),
      queue: vi.fn().mockResolvedValue(
        okResponse({
          counts: { needsYou: 0, working: 1, finished: 0 },
          currentChat: chatSession,
          sessions: { needsYou: [], working: [chatSession], finished: [] },
        }),
      ),
      detail: vi.fn(),
      activity: vi.fn(),
      create: vi.fn(),
      sendMessage: vi.fn(),
      decide: vi.fn(),
      lifecycle: vi.fn(),
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PageContextProvider workspace={{ workspaceId: ORG_ID }}>
          <AthenaPanelProvider railVisible onRevealRail={vi.fn()}>
            <AthenaRailConversation orgId={ORG_ID} transport={transport} />
          </AthenaPanelProvider>
        </PageContextProvider>
      </QueryClientProvider>,
    );

    await screen.findByRole('form', { name: /Message Athena/ });
    expect(screen.queryByRole('button', { name: /Working ·/ })).not.toBeInTheDocument();
  });
});

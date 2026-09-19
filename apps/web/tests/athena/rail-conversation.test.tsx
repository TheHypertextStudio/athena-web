import '@testing-library/jest-dom/vitest';

import { RailPresentationProvider, RailSheetBarSlotProvider } from '@docket/ui/components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
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

function job(overrides: Partial<PersonalAthenaSessionSummary>): PersonalAthenaSessionSummary {
  return {
    id: 'job_1',
    objective: 'Draft the launch update',
    status: 'running',
    queueState: 'working',
    createdAt: '2026-09-18T09:00:00.000Z',
    updatedAt: '2026-09-18T09:00:00.000Z',
    ...overrides,
  };
}

/** A transport whose queue answers with `working` (or the successive answers in `reads`). */
function queueTransport(
  reads: readonly (readonly PersonalAthenaSessionSummary[])[],
  currentChat: PersonalAthenaSessionSummary | null = null,
): PersonalAthenaTransport {
  const queue = vi.fn();
  for (const working of reads) {
    queue.mockResolvedValueOnce(
      okResponse({
        counts: { needsYou: 0, working: working.length, finished: 0 },
        currentChat,
        sessions: { needsYou: [], working, finished: [] },
      }),
    );
  }
  const last = reads.at(-1) ?? [];
  queue.mockResolvedValue(
    okResponse({
      counts: { needsYou: 0, working: last.length, finished: 0 },
      currentChat,
      sessions: { needsYou: [], working: last, finished: [] },
    }),
  );
  return {
    pulse: vi.fn(),
    queue,
    detail: vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(okResponse({ ...job({ id }), activities: [] })),
      ),
    activity: vi.fn(),
    create: vi.fn(),
    sendMessage: vi.fn(),
    decide: vi.fn(),
    lifecycle: vi.fn(),
    undoChange: vi.fn(),
    proposals: vi.fn(),
  };
}

/** Props for {@link Harness}. */
interface HarnessProps {
  readonly transport: PersonalAthenaTransport;
  readonly source?: ReactNode;
  readonly client?: QueryClient;
}

function Harness({ transport, source = null, client }: HarnessProps): JSX.Element {
  return (
    <QueryClientProvider
      client={client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PageContextProvider workspace={{ workspaceId: ORG_ID, workspaceName: 'Harbor Health' }}>
        {source}
        <AthenaPanelProvider railVisible onRevealRail={vi.fn()}>
          <AthenaRailConversation orgId={ORG_ID} transport={transport} />
        </AthenaPanelProvider>
      </PageContextProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
  chatGet.mockResolvedValue(okResponse(thread()));
  pulseGet.mockResolvedValue(okResponse({ needsYou: 0, working: 0 }));
});

afterEach(cleanup);

describe('AthenaRailConversation', () => {
  it('heads the panel with the page chip, Talk, and the wide view — and no name', async () => {
    render(
      <Harness
        transport={queueTransport([[]])}
        source={<PageSource type="project" id="project_1" label="Fall fundraiser launch" />}
      />,
    );

    const header = screen.getByTestId('athena-rail-header');
    expect(header).toHaveClass('h-11');
    expect(
      await within(header).findByRole('group', { name: /Fall fundraiser launch/ }),
    ).toBeVisible();
    expect(within(header).getByRole('button', { name: 'Talk' })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: /Open the Athena page/ })).toHaveAttribute(
      'href',
      `/athena?workspace=${ORG_ID}`,
    );
    // Chip, Talk, and the link — nothing else lives in the header.
    expect(header.children).toHaveLength(3);
    const form = await screen.findByRole('form', { name: /Message Athena/ });
    expect(within(form).queryByRole('group')).not.toBeInTheDocument();
  });

  it('moves its header controls into the sheet’s title bar, painting no second header row', async () => {
    const slot = document.createElement('div');
    document.body.append(slot);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PageContextProvider workspace={{ workspaceId: ORG_ID, workspaceName: 'Harbor Health' }}>
          <AthenaPanelProvider railVisible onRevealRail={vi.fn()}>
            <RailPresentationProvider value="sheet">
              <RailSheetBarSlotProvider slot={slot}>
                <AthenaRailConversation orgId={ORG_ID} transport={queueTransport([[]])} />
              </RailSheetBarSlotProvider>
            </RailPresentationProvider>
          </AthenaPanelProvider>
        </PageContextProvider>
      </QueryClientProvider>,
    );

    await screen.findByRole('form', { name: /Message Athena/ });
    expect(screen.queryByTestId('athena-rail-header')).not.toBeInTheDocument();
    expect(within(slot).getByRole('link', { name: /Open the Athena page/ })).toBeInTheDocument();
    expect(within(slot).getByRole('button', { name: 'Talk' })).toBeInTheDocument();
    slot.remove();
  });

  it('reads only this workspace’s queue', async () => {
    const transport = queueTransport([[]]);
    render(<Harness transport={transport} />);

    await waitFor(() => {
      expect(transport.queue).toHaveBeenCalledWith({ workspaceId: ORG_ID });
    });
  });

  it('keeps work started from another page out of the thread', async () => {
    const here = job({ id: 'job_here', objective: 'Summarize the fundraiser' });
    const elsewhere = job({
      id: 'job_elsewhere',
      objective: 'Break the venue task into steps',
      context: { source: { type: 'task', id: 'task_9' } },
    });
    render(<Harness transport={queueTransport([[here, elsewhere]])} />);

    expect(await screen.findByRole('article', { name: /Summarize the fundraiser/ })).toBeVisible();
    expect(
      screen.queryByRole('article', { name: /Break the venue task into steps/ }),
    ).not.toBeInTheDocument();
  });

  it('keeps work started while the conversation is open, wherever it was started from', async () => {
    const elsewhere = job({
      id: 'job_new',
      objective: 'Break the venue task into steps',
      context: { source: { type: 'task', id: 'task_9' } },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<Harness transport={queueTransport([[], [elsewhere]])} client={client} />);

    await screen.findByRole('form', { name: /Message Athena/ });
    await waitFor(() => {
      expect(client.getQueryState(['me', 'athena', 'workspace', ORG_ID])?.status).toBe('success');
    });
    await client.invalidateQueries();

    expect(
      await screen.findByRole('article', { name: /Break the venue task into steps/ }),
    ).toBeVisible();
  });

  it('shows the person’s own conversation as no entry at all', async () => {
    const chatSession = job({ id: 'chat_1', objective: 'Chat' });
    render(<Harness transport={queueTransport([[chatSession]], chatSession)} />);

    await screen.findByRole('form', { name: /Message Athena/ });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

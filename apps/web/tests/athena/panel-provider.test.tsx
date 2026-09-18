import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';

const { chatGet, personalPost, pulseGet, athenaQueueGet, elicitationsGet, presencePost } =
  vi.hoisted(() => ({
    chatGet: vi.fn(),
    personalPost: vi.fn(),
    pulseGet: vi.fn(),
    athenaQueueGet: vi.fn(),
    elicitationsGet: vi.fn(),
    presencePost: vi.fn(),
  }));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: { ':orgId': { sessions: { chat: { $get: chatGet } } } },
      me: {
        athena: {
          $get: athenaQueueGet,
          chat: { messages: { $post: personalPost } },
          pulse: { $get: pulseGet },
        },
        elicitations: { $get: elicitationsGet, presence: { $post: presencePost } },
      },
    },
  },
}));

import {
  AthenaPanelProvider,
  AthenaRailPanel,
  useAthenaPanel,
} from '../../src/components/athena/athena-panel-provider';
import { PageContextProvider, PageSource } from '../../src/components/athena/page-context';
import type { PersonalAthenaTransport } from '../../src/lib/athena/query-defs';
import { okResponse } from '../support/query';

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

beforeEach(() => {
  chatGet.mockReset().mockResolvedValue(okResponse(thread()));
  personalPost.mockReset().mockResolvedValue(okResponse(thread()));
  pulseGet.mockReset().mockResolvedValue(okResponse({ needsYou: 0, working: 0 }));
  athenaQueueGet.mockReset().mockResolvedValue(
    okResponse({
      counts: { needsYou: 0, working: 0, finished: 0 },
      currentChat: null,
      sessions: { needsYou: [], working: [], finished: [] },
    }),
  );
  elicitationsGet.mockReset().mockResolvedValue(okResponse({ items: [] }));
});

function transport(): PersonalAthenaTransport {
  return {
    pulse: vi.fn().mockResolvedValue(okResponse({ needsYou: 1, working: 2 })),
    queue: vi.fn(),
    detail: vi.fn(),
    activity: vi.fn(),
    sendMessage: vi.fn(),
    create: vi.fn(),
    decide: vi.fn(),
    lifecycle: vi.fn(),
  };
}

function AthenaLaunchers(): ReactNode {
  const { openAthena, railStatus } = useAthenaPanel();
  return (
    <>
      <span data-testid="athena-rail-status">{railStatus?.tone ?? 'none'}</span>
      <button
        type="button"
        onClick={() => {
          openAthena({
            workspaceId: 'workspace_1',
            source: { type: 'project', id: 'project_1', label: 'Athena launch' },
          });
        }}
      >
        Open contextual Athena
      </button>
      <button
        type="button"
        onClick={() => {
          openAthena();
        }}
      >
        Open ambient Athena
      </button>
      <button
        type="button"
        onClick={() => {
          openAthena({ workspaceId: ORG_ID }, 'Help me with this');
        }}
      >
        Open with a line
      </button>
    </>
  );
}

function renderPanel(
  options: {
    readonly api?: PersonalAthenaTransport;
    readonly railVisible?: boolean;
    readonly onRevealRail?: (() => void) | undefined;
    readonly onOpenFullAthena?: ((context: unknown, draft: string | undefined) => void) | undefined;
  } = {},
): PersonalAthenaTransport {
  const api = options.api ?? transport();
  const railVisible = options.railVisible ?? true;
  const onRevealRail = 'onRevealRail' in options ? options.onRevealRail : vi.fn();
  const onOpenFullAthena = options.onOpenFullAthena ?? vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PageContextProvider workspace={{ workspaceId: ORG_ID }}>
        <AthenaPanelProvider
          transport={api}
          railVisible={railVisible}
          onRevealRail={onRevealRail}
          onOpenFullAthena={onOpenFullAthena}
        >
          <AthenaLaunchers />
          <AthenaRailPanel />
        </AthenaPanelProvider>
      </PageContextProvider>
    </QueryClientProvider>,
  );
  return api;
}

let pageTreeClient: QueryClient | null = null;

/** The tree `renderPanelWithPage` mounts, reused for the rerender that swaps the page source. */
function pageTree(source: ReactNode): ReactNode {
  pageTreeClient ??= new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={pageTreeClient}>
      <PageContextProvider workspace={{ workspaceId: ORG_ID }}>
        {source}
        <AthenaPanelProvider transport={transport()} railVisible onRevealRail={vi.fn()}>
          <AthenaLaunchers />
          <AthenaRailPanel />
        </AthenaPanelProvider>
      </PageContextProvider>
    </QueryClientProvider>
  );
}

/** Render the rail behind a fresh page source, for a test that then swaps the page under it. */
function renderPanelWithPage(source: ReactNode): ReturnType<typeof render> {
  pageTreeClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(pageTree(source));
}

function RailContentWhileMounted(): ReactNode {
  const { provideRailContent } = useAthenaPanel();
  useEffect(
    () => provideRailContent(<div data-testid="rail-content">Plan thread</div>),
    [provideRailContent],
  );
  return null;
}

function renderWithRailContent(onRevealRail: () => void): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AthenaPanelProvider transport={transport()} railVisible={false} onRevealRail={onRevealRail}>
        <AthenaLaunchers />
        <RailContentWhileMounted />
        <AthenaRailPanel />
      </AthenaPanelProvider>
    </QueryClientProvider>,
  );
}

describe('AthenaPanelProvider with route rail content', () => {
  it('shows the route’s content in the rail panel and still reveals the rail on open', () => {
    const onRevealRail = vi.fn();
    renderWithRailContent(onRevealRail);
    expect(
      within(screen.getByRole('region', { name: /Athena/ })).getByTestId('rail-content'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open contextual Athena/ }));
    expect(onRevealRail).toHaveBeenCalledTimes(1);
  });
});

describe('AthenaPanelProvider', () => {
  it('uses attention before active work in the accessible rail status', async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId('athena-rail-status')).toHaveTextContent('attention');
    });
  });

  it('uses Cmd/Ctrl J to ask the shell to reveal Athena without rendering a floating dialog', async () => {
    const onRevealRail = vi.fn();
    renderPanel({ onRevealRail });

    fireEvent.keyDown(document, { key: 'j', metaKey: true });

    await waitFor(() => {
      expect(onRevealRail).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('dialog', { name: /Athena/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open Athena/ })).not.toBeInTheDocument();
  });

  it('keeps the shortcut out of editable controls', () => {
    const onRevealRail = vi.fn();
    renderPanel({ onRevealRail });
    const input = document.createElement('input');
    document.body.append(input);

    fireEvent.keyDown(input, { key: 'j', metaKey: true });

    expect(onRevealRail).not.toHaveBeenCalled();
    input.remove();
  });

  it('opens Calendar context in the full Athena workspace because Calendar has no rail', () => {
    const onOpenFullAthena = vi.fn();
    renderPanel({ onRevealRail: undefined, onOpenFullAthena });

    fireEvent.click(screen.getByRole('button', { name: /Open contextual Athena/ }));

    expect(onOpenFullAthena).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace_1',
        source: { type: 'project', id: 'project_1', label: 'Athena launch' },
      },
      undefined,
    );
  });

  it('shows the conversation in the rail by default', async () => {
    renderPanel();
    expect(await screen.findByRole('form', { name: /Message Athena/ })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: /Athena work/ })).toBeNull();
  });

  it('seeds the composer from an open with an opening line', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Open contextual Athena/ }));
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /Message Athena/ })).toHaveValue('');
    });
    fireEvent.click(screen.getByRole('button', { name: /Open with a line/ }));
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /Message Athena/ })).toHaveValue(
        'Help me with this',
      );
    });
  });

  it('keeps the composer draft when the page underneath changes', async () => {
    const view = renderPanelWithPage(
      <PageSource type="task" id="task_1" label="Confirm venue contract" />,
    );
    fireEvent.change(await screen.findByRole('combobox', { name: /Message Athena/ }), {
      target: { value: 'Half a thought' },
    });
    view.rerender(
      pageTree(<PageSource type="project" id="project_1" label="Fall fundraiser launch" />),
    );
    expect(screen.getByRole('combobox', { name: /Message Athena/ })).toHaveValue('Half a thought');
    expect(screen.getByRole('group', { name: /Fall fundraiser launch/ })).toBeVisible();
  });

  it('follows the page again after a contextual open', async () => {
    const view = renderPanelWithPage(
      <PageSource type="task" id="task_1" label="Confirm venue contract" />,
    );
    await waitFor(() => {
      expect(screen.getByRole('group', { name: /Confirm venue contract/ })).toBeVisible();
    });

    fireEvent.click(screen.getByRole('button', { name: /Open contextual Athena/ }));
    await waitFor(() => {
      expect(screen.getByRole('group', { name: /Athena launch/ })).toBeVisible();
    });

    view.rerender(
      pageTree(<PageSource type="project" id="project_2" label="Winter grant cycle" />),
    );
    await waitFor(() => {
      expect(screen.getByRole('group', { name: /Winter grant cycle/ })).toBeVisible();
    });
  });

  it('seeds the composer each time an opening line is handed over', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Open with a line/ }));
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /Message Athena/ })).toHaveValue(
        'Help me with this',
      );
    });

    fireEvent.change(screen.getByRole('combobox', { name: /Message Athena/ }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Open with a line/ }));
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /Message Athena/ })).toHaveValue(
        'Help me with this',
      );
    });
  });
});

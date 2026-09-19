import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type JSX, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

/** A ULID-shaped workspace id, valid against `OrganizationId`'s Crockford-base32 pattern. */
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
      orgs: {
        ':orgId': {
          sessions: {
            chat: {
              $get: chatGet,
            },
          },
        },
      },
      me: {
        athena: { chat: { messages: { $post: personalPost } } },
        elicitations: { $get: elicitationsGet, presence: { $post: presencePost } },
      },
    },
  },
}));

import AthenaConversation, {
  type AthenaConversationProps,
} from '../../src/components/athena/athena-conversation';
import type { PersonalAthenaSessionSummary } from '../../src/lib/athena/presentation';
import type { PersonalAthenaTransport } from '../../src/lib/athena/query-defs';

// jsdom has no scrollIntoView; the component pins the latest turn with it on every append.
Element.prototype.scrollIntoView = vi.fn();

const PRESENTATION = {
  connectionId: 'connection-1',
  serverName: 'Weather Service',
  tool: 'weather_card',
  arguments: { city: 'Las Vegas' },
  result: { content: [{ type: 'text', text: '72 degrees' }], isError: false },
  resource: {
    uri: 'ui://weather/card',
    mimeType: 'text/html;profile=mcp-app',
    text: '<!doctype html><title>Weather</title>',
    meta: { prefersBorder: true },
  },
} as const;

function thread(activities: readonly Record<string, unknown>[]) {
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

function actionActivity(result: Record<string, unknown>) {
  return {
    id: 'activity_action',
    sessionId: 'chat_session',
    organizationId: null,
    type: 'action',
    body: {
      action: {
        kind: 'remote_tool',
        summary: 'Show Las Vegas weather',
        result,
      },
    },
    createdAt: '2026-08-30T10:01:00.000Z',
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AthenaConversation orgId="org_1" />
    </QueryClientProvider>,
  );
}

/** Render the conversation with a fixed ULID org id, overridable by the caller's props. */
function renderConversation(props: Partial<AthenaConversationProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AthenaConversation orgId={ORG_ID} {...props} />
    </QueryClientProvider>,
  );
}

/** A job summary that renders as a card among the thread entries. */
function job(overrides: Partial<PersonalAthenaSessionSummary> = {}): PersonalAthenaSessionSummary {
  return {
    id: 'job_1',
    objective: 'Draft the launch update',
    status: 'running',
    queueState: 'working',
    createdAt: '2026-08-30T10:01:00.000Z',
    updatedAt: '2026-08-30T10:01:00.000Z',
    ...overrides,
  };
}

/** A transport whose only wired call is the detail read `AthenaJobCard` makes for its own card. */
function jobTransport(detail: PersonalAthenaSessionSummary): PersonalAthenaTransport {
  return {
    pulse: vi.fn(),
    queue: vi.fn(),
    detail: vi.fn().mockResolvedValue(okResponse({ ...detail, activities: [] })),
    activity: vi.fn(),
    create: vi.fn(),
    sendMessage: vi.fn(),
    decide: vi.fn(),
    lifecycle: vi.fn(),
    undoChange: vi.fn(),
    proposals: vi.fn(),
  };
}

beforeEach(() => {
  elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete process.env['NEXT_PUBLIC_API_URL'];
});

describe('AthenaConversation draft requests', () => {
  it('fills and focuses the composer for each new request version', async () => {
    chatGet.mockResolvedValue(okResponse(thread([])));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <AthenaConversation
          orgId="org_1"
          draftRequest={{ text: 'Help me plan "Q3".', version: 1 }}
        />
      </QueryClientProvider>,
    );
    const composer = await screen.findByRole('combobox');
    expect(composer).toHaveValue('Help me plan "Q3".');
    expect(document.activeElement).toBe(composer);
    fireEvent.change(composer, { target: { value: 'my own words' } });
    view.rerender(
      <QueryClientProvider client={client}>
        <AthenaConversation orgId="org_1" draftRequest={{ text: 'Second ask', version: 2 }} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('combobox')).toHaveValue('Second ask');
  });
});

describe('AthenaConversation MCP app cards', () => {
  it('renders the quiet work chip with the interactive card beneath it', async () => {
    process.env['NEXT_PUBLIC_API_URL'] = 'https://api.docket.test';
    chatGet.mockResolvedValue(
      okResponse(
        thread([
          actionActivity({
            content: 'Completed: Show Las Vegas weather',
            isError: false,
            presentation: PRESENTATION,
          }),
        ]),
      ),
    );
    mount();

    const chip = await screen.findByText('Show Las Vegas weather');
    const frame = await screen.findByTestId('mcp-app-view');
    expect(chip.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the owned fallback when the tool declared UI that was not retained', async () => {
    chatGet.mockResolvedValue(
      okResponse(
        thread([
          actionActivity({
            content: 'Completed: Show Las Vegas weather',
            isError: false,
            presentationUnavailable: true,
          }),
        ]),
      ),
    );
    mount();

    expect(await screen.findByText('Show Las Vegas weather')).toBeVisible();
    expect(await screen.findByText('Interactive view unavailable.')).toBeVisible();
    expect(screen.queryByTestId('mcp-app-view')).not.toBeInTheDocument();
  });

  it('drops a presentation that fails client-side revalidation to the fallback', async () => {
    chatGet.mockResolvedValue(
      okResponse(
        thread([
          actionActivity({
            content: 'Completed: Show Las Vegas weather',
            isError: false,
            presentation: { ...PRESENTATION, resource: { uri: 'https://not-a-widget' } },
          }),
        ]),
      ),
    );
    mount();

    expect(await screen.findByText('Interactive view unavailable.')).toBeVisible();
    expect(screen.queryByTestId('mcp-app-view')).not.toBeInTheDocument();
  });

  it('sends composer messages through the personal door and renders the re-read turn', async () => {
    chatGet.mockResolvedValueOnce(okResponse(thread([])));
    personalPost.mockResolvedValue(okResponse(thread([])));
    chatGet.mockResolvedValueOnce(
      okResponse(
        thread([
          {
            id: 'activity_user',
            sessionId: 'chat_session',
            organizationId: null,
            type: 'response',
            body: { text: 'Plan my day', author: 'user' },
            createdAt: '2026-08-30T10:02:00.000Z',
          },
        ]),
      ),
    );
    mount();

    const composer = await screen.findByRole('combobox');
    fireEvent.change(composer, { target: { value: 'Plan my day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(personalPost).toHaveBeenCalledWith({ json: { body: 'Plan my day' } });
    });
    expect(await screen.findByText('Plan my day')).toBeVisible();
  });
});

describe('AthenaConversation page context', () => {
  it('leaves the page chip out of the composer unless the door asks for it', async () => {
    chatGet.mockResolvedValue(okResponse(thread([])));
    renderConversation({
      context: {
        workspaceId: ORG_ID,
        source: { type: 'project', id: 'project_1', label: 'Fall fundraiser launch' },
      },
    });
    const form = await screen.findByRole('form', { name: /Message Athena/ });
    expect(within(form).queryByRole('group')).not.toBeInTheDocument();
    expect(within(form).getByRole('combobox')).toHaveAttribute('rows', '2');
  });

  it('shows the attached page in the composer when asked, and sends it with the message', async () => {
    chatGet.mockResolvedValue(okResponse(thread([])));
    personalPost.mockResolvedValue(okResponse(thread([])));
    renderConversation({
      composerChip: true,
      context: {
        workspaceId: ORG_ID,
        source: { type: 'project', id: 'project_1', label: 'Fall fundraiser launch' },
      },
    });
    const form = await screen.findByRole('form', { name: /Message Athena/ });
    expect(within(form).getByRole('group', { name: /Fall fundraiser launch/ })).toBeVisible();

    fireEvent.change(screen.getByRole('combobox', { name: 'Message Athena' }), {
      target: { value: 'What is at risk?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(personalPost).toHaveBeenCalledWith({
        json: {
          body: 'What is at risk?',
          context: { workspaceId: ORG_ID, source: { type: 'project', id: 'project_1' } },
        },
      });
    });
  });

  it('omits context on a detached send, then shows the chip attached again for the next message', async () => {
    chatGet.mockResolvedValue(okResponse(thread([])));
    personalPost.mockResolvedValue(okResponse(thread([])));

    function Harness(): JSX.Element {
      const [attached, setAttached] = useState(false);
      return (
        <AthenaConversation
          orgId={ORG_ID}
          composerChip
          context={{
            workspaceId: ORG_ID,
            source: { type: 'project', id: 'project_1', label: 'Fall fundraiser launch' },
          }}
          contextAttached={attached}
          onDetachContext={() => {
            setAttached(false);
          }}
          onAttachContext={() => {
            setAttached(true);
          }}
        />
      );
    }

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('button', { name: /Include Fall fundraiser launch/ }),
    ).toBeVisible();

    fireEvent.change(screen.getByRole('combobox', { name: 'Message Athena' }), {
      target: { value: 'What is at risk?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(personalPost).toHaveBeenCalledWith({ json: { body: 'What is at risk?' } });
    });
    await waitFor(() => {
      expect(screen.getByRole('group', { name: /Fall fundraiser launch/ })).toBeVisible();
    });
  });

  it('fills the composer from a suggestion without sending', async () => {
    chatGet.mockResolvedValue(okResponse(thread([])));
    renderConversation({
      context: {
        workspaceId: ORG_ID,
        source: { type: 'task', id: 'task_1', label: 'Confirm venue' },
      },
    });
    const list = await screen.findByRole('list', { name: /Suggestions/ });
    const [first] = within(list).getAllByRole('button');
    if (!first) throw new Error('expected at least one suggestion button');
    fireEvent.click(first);
    expect(screen.getByRole('combobox', { name: 'Message Athena' })).toHaveValue(first.textContent);
    expect(personalPost).not.toHaveBeenCalled();
  });
});

describe('AthenaConversation heads-up', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('shows one heads-up at the bottom of the thread; Review scrolls the thread’s own entry', async () => {
    chatGet.mockResolvedValue(okResponse(thread([])));
    const waitingJob = job({
      id: 'job_waiting',
      status: 'awaiting_approval',
      queueState: 'needs_you',
      updatedAt: '2020-01-01T00:00:00.000Z',
    });
    renderConversation({ jobs: [waitingJob], transport: jobTransport(waitingJob) });

    const article = await screen.findByRole('article', { name: /Draft the launch update/ });
    const headsUp = await waitFor(() => {
      const row = document.querySelector<HTMLElement>('[data-slot="athena-heads-up"]');
      if (!row) throw new Error('no heads-up yet');
      return row;
    });
    expect(
      article.compareDocumentPosition(headsUp) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(headsUp.closest('[data-slot="athena-thread"]')).not.toBeNull();

    const scrollIntoView = vi.fn();
    article.scrollIntoView = scrollIntoView;
    fireEvent.click(within(headsUp).getByRole('button', { name: 'Review' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });

    fireEvent.click(within(headsUp).getByRole('button', { name: 'Dismiss' }));
    expect(document.querySelector('[data-slot="athena-heads-up"]')).toBeNull();
  });
});

describe('AthenaConversation delegated work', () => {
  it('renders a job as a card among the thread entries and skips the empty state', async () => {
    chatGet.mockResolvedValue(okResponse(thread([])));
    const theJob = job();
    renderConversation({ jobs: [theJob], transport: jobTransport(theJob) });

    expect(await screen.findByRole('article', { name: /Draft the launch update/ })).toBeVisible();
  });

  it('keeps a job card in time order alongside the thread activities', async () => {
    chatGet.mockResolvedValue(
      okResponse(
        thread([
          {
            id: 'activity_user',
            sessionId: 'chat_session',
            organizationId: null,
            type: 'response',
            body: { text: 'Plan my day', author: 'user' },
            createdAt: '2026-08-30T10:02:00.000Z',
          },
        ]),
      ),
    );
    const theJob = job({ createdAt: '2026-08-30T10:00:00.000Z' });
    renderConversation({ jobs: [theJob], transport: jobTransport(theJob) });

    const message = await screen.findByText('Plan my day');
    const article = await screen.findByRole('article', { name: /Draft the launch update/ });
    expect(
      article.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

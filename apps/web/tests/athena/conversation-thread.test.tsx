/**
 * Structure tests for the conversation's one scrolling region.
 *
 * @remarks
 * Only the header and the composer may live outside the thread's scroller, so everything else —
 * the empty suggestions, a failed send, a question, the jump to waiting work — must be found
 * inside it, in the thread's own order.
 */
import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

Element.prototype.scrollIntoView = vi.fn();

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

function renderConversation(props: Partial<AthenaConversationProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AthenaConversation orgId={ORG_ID} {...props} />
    </QueryClientProvider>,
  );
}

const WAITING_JOB: PersonalAthenaSessionSummary = {
  id: 'job_waiting',
  objective: 'Draft the launch update',
  status: 'awaiting_approval',
  queueState: 'needs_you',
  createdAt: '2026-08-30T10:01:00.000Z',
  updatedAt: '2026-08-30T10:01:00.000Z',
};

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

/** The element inside the thread's scroller matched by `selector`, once it renders. */
async function inThread(selector: string): Promise<HTMLElement> {
  return waitFor(() => {
    const element = document.querySelector<HTMLElement>(`[data-slot="athena-thread"] ${selector}`);
    if (!element) throw new Error(`${selector} is not in the thread yet`);
    return element;
  });
}

/** An `IntersectionObserver` stand-in that records callbacks so a test can report visibility. */
class RecordingObserver {
  static callbacks: IntersectionObserverCallback[] = [];

  constructor(callback: IntersectionObserverCallback) {
    RecordingObserver.callbacks.push(callback);
  }

  observe(): void {
    // The test reports visibility itself through the recorded callback.
  }

  disconnect(): void {
    // Nothing to release: this stand-in holds no targets.
  }
}

beforeEach(() => {
  elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('AthenaConversation thread structure', () => {
  it('keeps an empty thread to its suggestions: no heading, no icon', async () => {
    chatGet.mockResolvedValue(okResponse(thread([])));
    renderConversation();

    const suggestions = await inThread('ul');
    const scroller = suggestions.closest<HTMLElement>('[data-slot="athena-thread"]');
    if (!scroller) throw new Error('no scroller');
    expect(within(scroller).queryByRole('heading')).not.toBeInTheDocument();
    expect(scroller.querySelector('svg')).toBeNull();
  });

  it('puts a failed send inside the thread, never the exception text', async () => {
    chatGet.mockResolvedValue(okResponse(thread([])));
    personalPost.mockRejectedValue(new Error('network down'));
    renderConversation();

    fireEvent.change(await screen.findByRole('combobox', { name: 'Message Athena' }), {
      target: { value: 'Plan my day' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const alert = await inThread('[role="alert"]');
    expect(alert).not.toHaveTextContent('network down');
  });

  it('renders a question as a thread entry at the time it was asked', async () => {
    chatGet.mockResolvedValue(
      okResponse(
        thread([
          {
            id: 'activity_late',
            sessionId: 'chat_session',
            organizationId: null,
            type: 'response',
            body: { text: 'Later reply', author: 'athena' },
            createdAt: '2026-08-30T12:00:00.000Z',
          },
        ]),
      ),
    );
    elicitationsGet.mockResolvedValue(
      okResponse({
        items: [
          {
            id: 'question_1',
            sessionId: 'job_1',
            task: { id: 'task_1', title: 'Confirm venue', href: `/orgs/${ORG_ID}/tasks/task_1` },
            question: 'Should I also book the caterer?',
            actionSummary: 'Book the caterer for the launch',
            spec: {
              type: 'object',
              properties: { confirmed: { type: 'boolean', title: 'Proceed?' } },
              required: ['confirmed'],
            },
            status: 'pending',
            timeoutPolicy: 'safe',
            timeSensitive: false,
            expiresAt: '2099-01-01T00:00:00.000Z',
            createdAt: '2026-08-30T11:00:00.000Z',
            settledAt: null,
            resolver: null,
            answer: null,
            autoResolveReason: null,
            live: true,
          },
        ],
      }),
    );
    renderConversation();

    const question = await inThread('[data-elicitation="question_1"]');
    const reply = await screen.findByText('Later reply');
    expect(question.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('floats a jump to the waiting entry only while it is scrolled out of view', async () => {
    RecordingObserver.callbacks = [];
    vi.stubGlobal('IntersectionObserver', RecordingObserver);
    chatGet.mockResolvedValue(okResponse(thread([])));
    renderConversation({ jobs: [WAITING_JOB], transport: jobTransport(WAITING_JOB) });

    const article = await screen.findByRole('article', { name: WAITING_JOB.objective });
    await waitFor(() => {
      expect(RecordingObserver.callbacks.length).toBeGreaterThan(0);
    });
    const report = (isIntersecting: boolean): void => {
      act(() => {
        RecordingObserver.callbacks.at(-1)?.(
          [{ isIntersecting } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
    };
    const jumpControl = (): Element | null =>
      document.querySelector('[data-slot="athena-jump-to-waiting"]');

    expect(jumpControl()).toBeNull();
    report(false);
    const jump = await waitFor(() => {
      const control = jumpControl();
      if (!control) throw new Error('no jump control yet');
      return control;
    });
    const scrollIntoView = vi.fn();
    article.scrollIntoView = scrollIntoView;
    fireEvent.click(jump);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });

    report(true);
    await waitFor(() => {
      expect(jumpControl()).toBeNull();
    });
  });
});

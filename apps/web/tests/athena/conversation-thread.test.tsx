/**
 * Structure tests for the conversation's one scrolling region.
 *
 * @remarks
 * Only the header and the composer may live outside the thread's scroller, so everything else —
 * the empty suggestions, a question, the jump to waiting work — must be found inside it, in the
 * thread's own order. A failed send is the exception: it is reported once, as a notice.
 */
import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

const { chatGet, personalPost, elicitationsGet, presencePost, chaptersGet, chaptersPost } =
  vi.hoisted(() => ({
    chatGet: vi.fn(),
    personalPost: vi.fn(),
    elicitationsGet: vi.fn(),
    presencePost: vi.fn(),
    chaptersGet: vi.fn(),
    chaptersPost: vi.fn(),
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
              $get: chaptersGet,
              $post: chaptersPost,
            },
          },
        },
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
  const view = render(
    <QueryClientProvider client={client}>
      <AthenaConversation orgId={ORG_ID} {...props} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    rerenderConversation: (next: Partial<AthenaConversationProps>) => {
      view.rerender(
        <QueryClientProvider client={client}>
          <AthenaConversation orgId={ORG_ID} {...next} />
        </QueryClientProvider>,
      );
    },
  };
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
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-30T12:05:00.000Z'));
  elicitationsGet.mockResolvedValue(okResponse({ items: [] }));
  chaptersGet.mockResolvedValue(okResponse({ sessionId: 'chat_session', items: [] }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('AthenaConversation thread structure', () => {
  it('opens an old conversation fresh and reveals history by the top control or upward scroll', async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-09-28T10:00:00.000Z'));
    chatGet.mockResolvedValue(
      okResponse(
        thread([
          {
            id: 'old_user',
            sessionId: 'chat_session',
            organizationId: null,
            type: 'response',
            body: { text: 'Old question', author: 'user' },
            createdAt: '2026-09-27T10:00:00.000Z',
          },
          {
            id: 'old_reply',
            sessionId: 'chat_session',
            organizationId: null,
            type: 'response',
            body: { text: 'Old answer', author: 'athena' },
            createdAt: '2026-09-27T10:01:00.000Z',
          },
        ]),
      ),
    );
    renderConversation();

    const earlier = await screen.findByRole('button', { name: 'Earlier messages' });
    expect(screen.queryByText('Old answer')).not.toBeInTheDocument();
    fireEvent.click(earlier);
    expect(screen.getByText('Old answer')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Recent messages' }));
    expect(screen.queryByText('Old answer')).not.toBeInTheDocument();
    const scroller = document.querySelector('[data-slot="athena-thread"]');
    if (!scroller) throw new Error('no thread scroller');
    fireEvent.wheel(scroller, { deltaY: -40 });
    expect(screen.getByText('Old answer')).toBeVisible();
  });

  it('starts a fresh view when a mounted rail reopens after an idle gap', async () => {
    chatGet.mockResolvedValue(
      okResponse(
        thread([
          {
            id: 'earlier_reply',
            sessionId: 'chat_session',
            organizationId: null,
            type: 'response',
            body: { text: 'Earlier answer', author: 'athena' },
            createdAt: '2026-08-30T12:00:00.000Z',
          },
        ]),
      ),
    );
    const view = renderConversation({ active: true });
    expect(await screen.findByText('Earlier answer')).toBeVisible();

    view.rerenderConversation({ active: false });
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-08-30T19:00:00.000Z'));
    view.rerenderConversation({ active: true });
    expect(await screen.findByRole('button', { name: 'Earlier messages' })).toBeVisible();
    expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument();
  });

  it('names a chapter at a saved message', async () => {
    chatGet.mockResolvedValue(
      okResponse(
        thread([
          {
            id: 'chapter_start',
            sessionId: 'chat_session',
            organizationId: null,
            type: 'response',
            body: { text: 'Plan the launch', author: 'user' },
            createdAt: '2026-08-30T12:00:00.000Z',
          },
        ]),
      ),
    );
    chaptersPost.mockResolvedValue(okResponse({ id: 'chapter_1' }));
    renderConversation();

    const message = await inThread('[data-athena-activity="chapter_start"]');
    fireEvent.pointerDown(within(message).getByRole('button', { name: 'Section options' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Section name' }), {
      target: { value: 'Launch planning' },
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start section here' }));
    await waitFor(() => {
      expect(chaptersPost).toHaveBeenCalledWith({
        json: { startActivityId: 'chapter_start', title: 'Launch planning' },
      });
    });
  });

  it.each([
    { reducedMotion: false, behavior: 'smooth' },
    { reducedMotion: true, behavior: 'auto' },
  ])(
    'reveals older messages and centers a section with $behavior scrolling',
    async ({ reducedMotion, behavior }) => {
      vi.mocked(Date.now).mockReturnValue(Date.parse('2026-09-28T10:00:00.000Z'));
      vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      chatGet.mockResolvedValue(
        okResponse(
          thread([
            {
              id: 'section_start',
              sessionId: 'chat_session',
              organizationId: null,
              type: 'response',
              body: { text: 'Plan the launch', author: 'user' },
              createdAt: '2026-09-27T10:00:00.000Z',
            },
          ]),
        ),
      );
      chaptersGet.mockResolvedValue(
        okResponse({
          sessionId: 'chat_session',
          items: [
            {
              id: 'section_1',
              title: 'Launch planning',
              startActivityId: 'section_start',
              endActivityId: null,
              createdAt: '2026-09-27T10:00:00.000Z',
              updatedAt: '2026-09-27T10:00:00.000Z',
            },
          ],
        }),
      );
      renderConversation();

      const sections = await screen.findByRole('button', { name: 'Sections' });
      expect(screen.queryByText('Plan the launch')).not.toBeInTheDocument();
      fireEvent.pointerDown(sections, { button: 0, ctrlKey: false });
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Launch planning · Open' }));

      const target = await inThread('[data-athena-activity="section_start"]');
      expect(target).toBeVisible();
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({
          block: 'center',
          behavior,
        });
      });
    },
  );

  it('keeps an empty thread to its suggestions: no heading, no icon', async () => {
    chatGet.mockResolvedValue(okResponse(thread([])));
    renderConversation();

    const suggestions = await inThread('ul');
    const scroller = suggestions.closest<HTMLElement>('[data-slot="athena-thread"]');
    if (!scroller) throw new Error('no scroller');
    expect(within(scroller).queryByRole('heading')).not.toBeInTheDocument();
    expect(scroller.querySelector('svg')).toBeNull();
  });

  it('keeps a failed send visible in the thread with the draft available to retry', async () => {
    chatGet.mockResolvedValue(okResponse(thread([])));
    personalPost.mockRejectedValue(new Error('network down'));
    renderConversation();

    const composer = await screen.findByRole('combobox', { name: 'Message Athena' });
    fireEvent.change(composer, { target: { value: 'Plan my day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const failure = await screen.findByRole('alert');
    expect(failure).not.toHaveTextContent('network down');
    expect(failure.closest('[data-slot="athena-thread"]')).not.toBeNull();
    expect(composer).toHaveValue('Plan my day');
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

  it('stays at the end as entries finish laying out, unless the person scrolled back', async () => {
    const resized: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resized.push(callback);
        }
        readonly observe = vi.fn();
        readonly disconnect = vi.fn();
      },
    );
    chatGet.mockResolvedValue(okResponse(thread([])));
    renderConversation();
    const scroller = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-slot="athena-thread"]');
      if (!found) throw new Error('no thread yet');
      return found;
    });
    const grow = (height: number): void => {
      Object.defineProperty(scroller, 'scrollHeight', { value: height, configurable: true });
      act(() => {
        resized.at(-1)?.([], {} as ResizeObserver);
      });
    };

    grow(900);
    expect(scroller.scrollTop).toBe(900);

    Object.defineProperty(scroller, 'clientHeight', { value: 300, configurable: true });
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    grow(1200);
    expect(scroller.scrollTop).toBe(100);
    vi.unstubAllGlobals();
  });
});

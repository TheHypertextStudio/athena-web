/** Behavior tests for the task page's Delegated work section. */
import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

const { queueGet, sessionGet, pulseGet } = vi.hoisted(() => ({
  queueGet: vi.fn(),
  sessionGet: vi.fn(),
  pulseGet: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        athena: {
          $get: queueGet,
          pulse: { $get: pulseGet },
          sessions: { ':id': { $get: sessionGet } },
        },
      },
    },
  },
}));

import { AthenaPanelProvider } from '../../src/components/athena/athena-panel-provider';
import {
  focusRailEntry,
  TaskDelegatedWork,
} from '../../src/components/task-detail/task-delegated-work';

const ORG_ID = 'org_1';
const TASK_ID = 'task_1';

function summary(id: string, taskId: string, objective: string) {
  return {
    id,
    kind: 'job',
    status: 'running',
    queueState: 'working',
    objective,
    context: { source: { type: 'task', id: taskId, label: 'A task' } },
    workspace: { id: ORG_ID, name: 'Studio' },
    startedAt: '2026-09-18T10:00:00.000Z',
    endedAt: null,
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:05:00.000Z',
  };
}

const MINE = summary('job_mine', TASK_ID, 'Draft the renewal follow-up email');
const OTHER = summary('job_other', 'task_2', 'Update the roadmap timeline');

function renderSection(railVisible: boolean, extra?: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AthenaPanelProvider railVisible={railVisible} onRevealRail={vi.fn()}>
        {extra}
        <TaskDelegatedWork orgId={ORG_ID} taskId={TASK_ID} />
      </AthenaPanelProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  queueGet.mockReset().mockResolvedValue(
    okResponse({
      counts: { needsYou: 0, working: 2, finished: 0 },
      currentChat: null,
      sessions: { needsYou: [], working: [MINE, OTHER], finished: [] },
    }),
  );
  sessionGet.mockReset().mockResolvedValue(okResponse({ ...MINE, activities: [] }));
  pulseGet.mockReset().mockResolvedValue(okResponse({ needsYou: 0, working: 1 }));
});
afterEach(cleanup);

describe('TaskDelegatedWork', () => {
  it('shows this task’s work as full entries under its own heading while the panel is shut', async () => {
    renderSection(false);

    const section = await screen.findByRole('region', { name: /delegated work/i });
    expect(within(section).getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(
      await within(section).findByRole('article', { name: MINE.objective }),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('article', { name: OTHER.objective })).toBeNull();
  });

  it('shrinks each entry to one line with Open while the panel holds the live copy', async () => {
    const railCopy = (
      <div data-slot="athena-thread">
        <article data-athena-job={MINE.id} tabIndex={-1} aria-label="Rail copy" />
      </div>
    );
    renderSection(true, railCopy);

    const section = await screen.findByRole('region', { name: /delegated work/i });
    expect(within(section).queryByRole('article')).toBeNull();
    const line = section.querySelector(`[data-delegated-job="${MINE.id}"]`);
    expect(line).not.toBeNull();

    fireEvent.click(within(section).getByRole('button', { name: new RegExp(MINE.objective) }));

    expect(screen.getByRole('article', { name: 'Rail copy' })).toHaveFocus();
  });

  it('renders nothing when the task has no delegated work', async () => {
    queueGet.mockResolvedValue(
      okResponse({
        counts: { needsYou: 0, working: 1, finished: 0 },
        currentChat: null,
        sessions: { needsYou: [], working: [OTHER], finished: [] },
      }),
    );
    renderSection(false);

    await vi.waitFor(() => {
      expect(queueGet).toHaveBeenCalled();
    });
    expect(screen.queryByRole('region', { name: /delegated work/i })).toBeNull();
  });
});

describe('focusRailEntry', () => {
  it('reports when the panel holds no copy of the job', () => {
    expect(focusRailEntry('missing')).toBe(false);
  });
});

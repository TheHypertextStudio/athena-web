import '@testing-library/jest-dom/vitest';

import { OrganizationId } from '@docket/identity-access/ids';
import { DailyPlanItemId } from '@docket/planning/ids';
import { TaskId } from '@docket/work/ids';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TodayPage from '../../src/app/(app)/today/page';
import type { TodayPageData } from '../../src/app/(app)/today/use-today-data';
import type { HubTaskItem, HubTodayOut, HubTodayPlanItem } from '../../src/lib/contracts/hub';
import type * as DailyQueries from '../../src/components/daily-planning/daily-planning-queries';

const fixture = vi.hoisted<{ data: HubTodayOut | null; accepted: boolean }>(() => ({
  data: null,
  accepted: false,
}));
vi.mock('../../src/app/(app)/today/use-today-data', () => ({
  useTodayData: (): TodayPageData => ({
    data: fixture.data,
    loading: false,
    error: null,
    refetch: vi.fn(),
    activeOrgId: null,
    orgName: () => 'Personal',
    heading: 'Wednesday, October 7',
    date: '2026-10-07',
    displayTimezone: 'UTC',
  }),
}));
vi.mock('../../src/app/(app)/today/use-today-actions', () => ({
  useTodayActions: () => ({
    completing: false,
    suggestionBusy: false,
    complete: vi.fn(),
    defer: vi.fn(),
    promote: vi.fn(),
    timebox: vi.fn(),
    add: vi.fn(),
    start: vi.fn(),
  }),
}));
vi.mock('../../src/components/athena/athena-panel-provider', () => ({
  useAthenaPanel: () => ({ railVisible: false }),
}));
vi.mock('../../src/components/daily-planning/daily-planning-entry', () => ({
  DailyPlanningEntry: () => null,
}));
vi.mock('../../src/components/today/today-prompt', () => ({
  TodayPrompt: () => <section aria-label="Capture work">Today composer</section>,
}));
vi.mock('../../src/components/today/day-recap-entry', () => ({ DayRecapEntry: () => null }));
vi.mock('../../src/components/time-tracking/task-timer-button', () => ({
  TaskTimerButton: () => <button>Start task</button>,
}));
vi.mock('../../src/lib/use-org-capability', () => ({ useOrgCapability: () => false }));
vi.mock('../../src/components/daily-planning/daily-planning-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof DailyQueries>()),
  useDailyPlanningDay: () => ({
    data: fixture.accepted
      ? {
          accepted: { current: { snapshot: { sessions: [], tasks: [] } } },
          actual: [],
          agenda: { entries: [] },
        }
      : null,
  }),
}));

const organizationId = OrganizationId.parse('00000000000000000000000001');
function task(index: number, title: string): HubTaskItem {
  return {
    id: TaskId.parse(String(index).padStart(26, '0')),
    organizationId,
    title,
    summary: null,
    state: 'todo',
    stateType: 'unstarted',
    priority: 'none',
  };
}
const current: HubTodayPlanItem = {
  ...task(1, 'Execute the accepted first task'),
  planItemId: DailyPlanItemId.parse('00000000000000000000000001'),
  planStatus: 'planned',
  sort: 0,
  position: 0,
  estimateMinutes: 30,
  timeboxStartsAt: null,
  timeboxEndsAt: null,
  blocked: false,
  dependencyImpact: 0,
  reason: 'Timer running',
};
function renderToday(planState: HubTodayOut['planState']): void {
  fixture.data = {
    date: '2026-10-07',
    planState,
    brief: { text: '', href: null, attentionCount: 49 },
    plan: planState === 'active' ? [current] : [],
    focus: { now: planState === 'active' ? current : null, after: null },
    statusCards: [],
    suggestions: [],
    calendar: [],
    needsAttention: {
      approvals: [current],
      blocked: Array.from({ length: 48 }, (_, index) =>
        task(index + 2, `Blocked task ${index + 1}`),
      ),
      dueToday: [],
      inbox: 0,
    },
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TodayPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  fixture.data = null;
  fixture.accepted = false;
});

describe('Today execution order', () => {
  it.each([false, true])(
    'shows the active plan before 48 blocked rows with accepted ledger %s',
    (accepted) => {
      fixture.accepted = accepted;
      renderToday('active');
      expect(screen.queryByRole('region', { name: 'Capture work' })).not.toBeInTheDocument();
      const plan = screen.getByRole('region', { name: 'Plan' });
      const attention = screen.getByRole('region', { name: 'Needs attention' });
      const now = screen.getByRole('article', { name: `Now: ${current.title}` });
      expect(plan.compareDocumentPosition(attention) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
        0,
      );
      expect(now.compareDocumentPosition(attention) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      expect(within(attention).getByText(current.title)).toBeInTheDocument();
      expect(within(attention).getAllByText(/^Blocked task \d+$/)).toHaveLength(48);
      expect(screen.getAllByRole('heading', { name: 'Plan' })).toHaveLength(1);
      expect(screen.getAllByRole('heading', { name: 'Needs attention' })).toHaveLength(1);
    },
  );

  it('keeps attention before the empty plan when the day has not been planned', () => {
    renderToday('unplanned');
    expect(screen.getByRole('region', { name: 'Capture work' })).toBeVisible();
    const plan = screen.getByRole('region', { name: 'Plan' });
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    expect(attention.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(screen.queryByRole('article', { name: /^Now:/ })).not.toBeInTheDocument();
  });
});

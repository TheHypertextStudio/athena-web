import '@testing-library/jest-dom/vitest';

import {
  type HubTodayPlanItem,
  type HubTodayStatusCard,
  type HubTodaySuggestion,
  InitiativeId,
  MilestoneId,
  OrganizationId,
  ProjectId,
} from '@docket/types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FocusSequence from '../../src/components/today/focus-sequence';
import KeepTheMomentum from '../../src/components/today/keep-the-momentum';
import PlanTodayCard from '../../src/components/today/plan-today-card';
import WorkInMotion from '../../src/components/today/work-in-motion';

vi.mock('../../src/components/time-tracking/task-timer-button', () => ({
  TaskTimerButton: ({ taskId }: { taskId: string }) => <button>Track {taskId}</button>,
}));

const item = (id: string, position: number): HubTodayPlanItem =>
  ({
    id,
    organizationId: '01JQ000000000000000000000A',
    title: `Task ${id}`,
    state: 'todo',
    priority: 'high',
    assigneeId: null,
    projectId: null,
    dueDate: null,
    planItemId: `plan-${id}`,
    planStatus: 'planned',
    sort: position,
    position,
    estimateMinutes: 30,
    timeboxStartsAt: null,
    timeboxEndsAt: null,
    blocked: false,
    dependencyImpact: 0,
    reason: position === 0 ? 'You chose this first' : 'Next in your plan',
  }) as HubTodayPlanItem;

const ORG = OrganizationId.parse('01JQ000000000000000000000A');

afterEach(cleanup);

describe('PlanTodayCard', () => {
  it('makes planning with Athena the prominent empty-day action', () => {
    const onPlan = vi.fn();
    render(<PlanTodayCard onPlan={onPlan} />);

    fireEvent.click(screen.getByRole('button', { name: 'Plan today with Athena' }));

    expect(onPlan).toHaveBeenCalledOnce();
    expect(screen.getByText(/time you actually have/i)).toBeInTheDocument();
  });
});

describe('FocusSequence', () => {
  it('renders exactly Now and After this with semantic inline actions', () => {
    const complete = vi.fn();
    const defer = vi.fn();
    const promote = vi.fn();
    const timebox = vi.fn();
    render(
      <FocusSequence
        focus={{ now: item('now', 0), after: item('after', 1) }}
        orgName={() => 'Acme'}
        completing={false}
        onComplete={complete}
        onDefer={defer}
        onPromote={promote}
        onTimebox={timebox}
        date="2026-08-13"
        displayTimezone="UTC"
      />,
    );

    const now = screen.getByRole('article', { name: 'Now: Task now' });
    const after = screen.getByRole('article', { name: 'After this: Task after' });
    expect(within(now).getByText('You chose this first')).toBeInTheDocument();
    expect(within(after).getByText('Next in your plan')).toBeInTheDocument();
    fireEvent.click(within(now).getByRole('button', { name: 'Mark complete' }));
    fireEvent.click(within(after).getByRole('button', { name: 'Defer' }));
    fireEvent.click(within(after).getByRole('button', { name: 'Make next' }));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ id: 'now' }));
    expect(defer).toHaveBeenCalledWith(expect.objectContaining({ id: 'after' }));
    expect(promote).toHaveBeenCalledWith(expect.objectContaining({ id: 'after' }), 0);
    expect(screen.getByText('Task after is now first in your plan.')).toBeInTheDocument();
    expect(within(now).getByRole('button', { name: /timebox/i })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });
});

describe('WorkInMotion', () => {
  it('gives Projects progress and Initiatives connected-work health', () => {
    const cards: HubTodayStatusCard[] = [
      {
        kind: 'project',
        id: ProjectId.parse('01JQ000000000000000000000P'),
        organizationId: ORG,
        name: 'Launch Docket',
        status: 'active',
        health: 'at_risk',
        latestUpdate: {
          excerpt: 'Final review is underway.',
          createdAt: '2026-08-13T12:00:00.000Z',
        },
        nextMilestone: {
          id: MilestoneId.parse('01JQ000000000000000000000M'),
          name: 'Launch review',
          targetDate: '2026-08-20',
        },
        progress: { completed: 3, total: 5 },
      },
      {
        kind: 'initiative',
        id: InitiativeId.parse('01JQ000000000000000000000H'),
        organizationId: ORG,
        name: 'Operational calm',
        status: 'active',
        health: 'on_track',
        latestUpdate: null,
        targetDate: '2026-09-01',
        connectedWork: { onTrack: 2, atRisk: 1, offTrack: 0, total: 3 },
      },
    ];
    render(<WorkInMotion cards={cards} orgName={() => 'Acme'} />);

    expect(screen.getByText('3 of 5 tasks complete')).toBeInTheDocument();
    expect(screen.getByText('2 on track · 1 at risk')).toBeInTheDocument();
    expect(screen.getByText('Final review is underway.')).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
    expect(screen.getByText(/Launch review/)).toBeInTheDocument();
    expect(screen.getByText(/Target/)).toBeInTheDocument();
    expect(screen.getByText('No update yet')).toBeInTheDocument();
  });
});

describe('KeepTheMomentum', () => {
  it('shows at most three feasible tasks and dismisses only the local suggestion', () => {
    const suggestions = ['a', 'b', 'c', 'd'].map<HubTodaySuggestion>(
      (id) =>
        ({
          id: `01JQ000000000000000000000${id.toUpperCase()}`,
          organizationId: '01JQ000000000000000000000A',
          title: `Suggestion ${id}`,
          state: 'todo',
          priority: 'medium',
          estimateMinutes: 20,
          dependencyImpact: 0,
          reason: 'Fits the time left today',
        }) as HubTodaySuggestion,
    );
    render(
      <KeepTheMomentum
        suggestions={suggestions}
        orgName={() => 'Acme'}
        onAdd={vi.fn()}
        onStart={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
    expect(screen.queryByText('Suggestion a')).not.toBeInTheDocument();
    expect(screen.getByText('Suggestion d')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('prevents duplicate suggestion writes while one action is pending', () => {
    const suggestion = {
      id: '01JQ000000000000000000000A',
      organizationId: '01JQ000000000000000000000B',
      title: 'One honest next step',
      state: 'todo',
      priority: 'medium',
      estimateMinutes: 20,
      dependencyImpact: 0,
      reason: 'Fits the time left today',
    } as HubTodaySuggestion;
    render(
      <KeepTheMomentum
        suggestions={[suggestion]}
        orgName={() => 'Acme'}
        onAdd={vi.fn()}
        onStart={vi.fn()}
        busy
      />,
    );

    expect(screen.getByRole('button', { name: 'Start now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add to today' })).toBeDisabled();
  });

  it('describes a blocked plan as blocked instead of claiming it is clear', () => {
    render(
      <KeepTheMomentum
        suggestions={[]}
        orgName={() => 'Acme'}
        onAdd={vi.fn()}
        onStart={vi.fn()}
        blockedPlan
      />,
    );

    expect(screen.getByText(/remaining plan is blocked/i)).toBeInTheDocument();
    expect(screen.queryByText('You’re clear.')).not.toBeInTheDocument();
  });
});

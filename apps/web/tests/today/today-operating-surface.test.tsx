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

import { FocusCard } from '../../src/components/today/focus-card';
import SuggestedTasks from '../../src/components/today/suggested-tasks';
import ProjectStatus from '../../src/components/today/project-status';
import { assertDefined } from '@docket/test-utils';

vi.mock('../../src/components/time-tracking/task-timer-button', () => ({
  TaskTimerButton: ({ taskId }: { taskId: string }) => <button>Track {taskId}</button>,
}));

const item = (id: string, position: number): HubTodayPlanItem =>
  ({
    id,
    organizationId: '01JQ000000000000000000000A',
    title: `Task ${id}`,
    summary: null,
    state: 'todo',
    stateType: 'unstarted',
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
    reason: 'Due today',
  }) as HubTodayPlanItem;

const ORG = OrganizationId.parse('01JQ000000000000000000000A');

afterEach(cleanup);

describe('FocusCard', () => {
  it('carries the inline actions that only make sense for the item in hand', () => {
    const complete = vi.fn();
    const defer = vi.fn();
    const timebox = vi.fn();
    render(
      <FocusCard
        item={item('now', 0)}
        orgName={() => 'Acme'}
        completing={false}
        onComplete={complete}
        onDefer={defer}
        onTimebox={timebox}
        date="2026-08-13"
        displayTimezone="UTC"
      />,
    );

    // One promoted card, not a two-card sequence: "After this" is an ordinary row in the day's
    // list now, so a second article here would be the old shape leaking back in.
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(1);
    const now = assertDefined(cards[0]);

    // Completing is the primary action and the only filled control; everything that is not
    // "finish this" or "start the clock" sits behind the overflow menu, so the card does not ask
    // the reader to rank five identically-weighted buttons.
    fireEvent.click(within(now).getByRole('button', { name: /complete/i }));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ id: 'now' }));
    expect(within(now).getByRole('button', { name: 'More actions' })).toBeInTheDocument();

    // Timebox and defer are reachable, but not as peers of the primary action.
    expect(within(now).queryByRole('button', { name: /timebox/i })).not.toBeInTheDocument();
    expect(within(now).queryByRole('button', { name: 'Defer' })).not.toBeInTheDocument();
    expect(defer).not.toHaveBeenCalled();
  });
});

describe('ProjectStatus', () => {
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
    render(<ProjectStatus cards={cards} orgName={() => 'Acme'} />);

    // Each card is one row that links to its entity — not a tile with a separate "Open" affordance.
    const rows = screen.getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(assertDefined(rows[0])).toHaveAttribute(
      'href',
      `/orgs/${ORG}/projects/01JQ000000000000000000000P`,
    );
    expect(assertDefined(rows[1])).toHaveAttribute(
      'href',
      `/orgs/${ORG}/initiatives/01JQ000000000000000000000H`,
    );

    // A project reports completion as a progress bar; an initiative reports connected-work health.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
    expect(within(assertDefined(rows[1])).queryByRole('progressbar')).not.toBeInTheDocument();

    // An update that exists is shown; one that does not leaves no placeholder behind.
    expect(screen.getByText('Final review is underway.')).toBeInTheDocument();
    expect(screen.queryByText(/no update/i)).not.toBeInTheDocument();

    // A health chip is spent only on off-nominal health: `on_track` is the expected state, and a
    // chip on every row is a column rather than a signal.
    expect(within(assertDefined(rows[0])).getByText(/at risk/i)).toBeInTheDocument();
    expect(within(assertDefined(rows[1])).queryByText(/on track$/i)).not.toBeInTheDocument();
  });

  it('says a project has no tasks rather than drawing an empty progress bar', () => {
    const cards: HubTodayStatusCard[] = [
      {
        kind: 'project',
        id: ProjectId.parse('01JQ000000000000000000000P'),
        organizationId: ORG,
        name: 'Nothing started',
        status: 'active',
        health: 'on_track',
        latestUpdate: null,
        nextMilestone: null,
        progress: { completed: 0, total: 0 },
      },
    ];
    render(<ProjectStatus cards={cards} orgName={() => 'Acme'} />);

    // A 0% track and a 0-of-0 project look identical, and mean opposite things.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('SuggestedTasks', () => {
  it('shows at most three feasible tasks and dismisses only the local suggestion', () => {
    const suggestions = ['a', 'b', 'c', 'd'].map<HubTodaySuggestion>(
      (id) =>
        ({
          id: `01JQ000000000000000000000${id.toUpperCase()}`,
          organizationId: '01JQ000000000000000000000A',
          title: `Suggestion ${id}`,
          summary: null,
          state: 'todo',
          priority: 'medium',
          estimateMinutes: 20,
          dependencyImpact: 0,
          reason: 'Fits the time left today',
        }) as HubTodaySuggestion,
    );
    render(
      <SuggestedTasks
        suggestions={suggestions}
        orgName={() => 'Acme'}
        onAdd={vi.fn()}
        onStart={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(assertDefined(screen.getAllByRole('button', { name: 'Dismiss' })[0]));
    expect(screen.queryByText('Suggestion a')).not.toBeInTheDocument();
    expect(screen.getByText('Suggestion d')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('prevents duplicate suggestion writes while one action is pending', () => {
    const suggestion = {
      id: '01JQ000000000000000000000A',
      organizationId: '01JQ000000000000000000000B',
      title: 'One honest next step',
      summary: null,
      state: 'todo',
      priority: 'medium',
      estimateMinutes: 20,
      dependencyImpact: 0,
      reason: 'Fits the time left today',
    } as HubTodaySuggestion;
    render(
      <SuggestedTasks
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

  it('tells the two situations apart instead of always claiming the plan is clear', () => {
    // Asserting the *difference* rather than either wording: a blocked plan and a finished plan
    // produce suggestions for opposite reasons, and the supporting line has to say which. Pinning
    // the exact sentence here would make the copy uneditable.
    const clear = render(
      <SuggestedTasks suggestions={[]} orgName={() => 'Acme'} onAdd={vi.fn()} onStart={vi.fn()} />,
    );
    const clearText = screen.getByRole('region', { name: 'Suggested tasks' }).textContent;
    clear.unmount();

    render(
      <SuggestedTasks
        suggestions={[]}
        orgName={() => 'Acme'}
        onAdd={vi.fn()}
        onStart={vi.fn()}
        blockedPlan
      />,
    );
    const blockedText = screen.getByRole('region', { name: 'Suggested tasks' }).textContent;

    expect(blockedText).not.toEqual(clearText);
  });
});

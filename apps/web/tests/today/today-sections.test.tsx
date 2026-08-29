import '@testing-library/jest-dom/vitest';

import type { HubTaskItem, HubTodayPlanItem } from '@docket/types';
import { OrganizationId, TaskId } from '@docket/types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NeedsYou from '../../src/components/today/needs-you';
import TodaysWork from '../../src/components/today/todays-work';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../src/components/time-tracking/task-timer-button', () => ({
  TaskTimerButton: ({ taskId }: { taskId: string }) => <button>Track {taskId}</button>,
}));
vi.mock('../../src/components/org-chip', () => ({
  OrgChip: ({ name }: { name: string }) => <span data-org-chip="">{name}</span>,
}));

const ORG_A = OrganizationId.parse('01JQ000000000000000000000A');
const ORG_B = OrganizationId.parse('01JQ000000000000000000000B');

/**
 * Short, readable ids ('a1', 't2', …) padded out to a real ULID shape so they parse as branded
 * {@link TaskId}s — nothing in this file asserts on the id itself, only on title/heading text.
 */
function taskId(label: string) {
  return TaskId.parse(label.toUpperCase().padEnd(26, '0'));
}

/** {@link task}'s overrides — `id`/`organizationId` take the short unbranded labels above. */
type TaskOverrides = Omit<Partial<HubTaskItem>, 'id' | 'organizationId'> & {
  id: string;
  title: string;
  organizationId?: string;
};

function task(overrides: TaskOverrides): HubTaskItem {
  const { id, organizationId, ...rest } = overrides;
  return {
    organizationId: ORG_A,
    state: 'todo',
    stateType: 'unstarted',
    priority: null,
    assigneeId: null,
    projectId: null,
    dueDate: null,
    ...rest,
    id: taskId(id),
    ...(organizationId !== undefined
      ? { organizationId: OrganizationId.parse(organizationId) }
      : {}),
  } as HubTaskItem;
}

const orgName = (orgId: string): string => (orgId === ORG_A ? 'Acme' : 'Hope Fund');

/** {@link task} plus the accepted-plan enrichment `TodaysWork` reads. */
function planItem(overrides: TaskOverrides & { sort?: number }): HubTodayPlanItem {
  const { sort = 0, ...rest } = overrides;
  return {
    ...task(rest),
    planItemId: `plan-${rest.id}`,
    planStatus: 'planned',
    sort,
    position: sort,
    estimateMinutes: null,
    timeboxStartsAt: null,
    timeboxEndsAt: null,
    blocked: false,
    dependencyImpact: 0,
    reason: 'On your plan',
  } as HubTodayPlanItem;
}

afterEach(cleanup);

describe('NeedsYou', () => {
  it('renders nothing at all when nothing is waiting', () => {
    const { container } = render(<NeedsYou approvals={[]} blocked={[]} orgName={orgName} />);
    // A clear day is a short page. An empty "Needs you" heading over two empty groups would be
    // three lines of chrome announcing the absence of work.
    expect(container).toBeEmptyDOMElement();
  });

  it('puts approvals above blockers, because only one of them has an agent waiting on a human', () => {
    render(
      <NeedsYou
        approvals={[task({ id: 'a1', title: 'Send the donor notes' })]}
        blocked={[task({ id: 'b1', title: 'Ship the rollout' })]}
        orgName={orgName}
      />,
    );

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toContain('Waiting on your approval');
    expect(headings[1]).toContain('Blocked');
  });

  it('shows only the group that has something in it', () => {
    render(
      <NeedsYou
        approvals={[]}
        blocked={[task({ id: 'b1', title: 'Ship it' })]}
        orgName={orgName}
      />,
    );
    expect(screen.queryByRole('heading', { name: /approval/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /blocked/i })).toBeInTheDocument();
  });
});

describe('TodaysWork', () => {
  it('renders every planned task, not a truncated few', () => {
    const plan = Array.from({ length: 7 }, (_, i) =>
      planItem({ id: `t${String(i)}`, title: `Task ${String(i)}`, sort: i }),
    );
    render(<TodaysWork plan={plan} orgName={orgName} loading={false} />);

    // The section this replaces rendered `focus.now` and `focus.after` only — two of however many
    // tasks the day actually held, and none at all before a plan was accepted.
    expect(screen.getAllByRole('link')).toHaveLength(7);
  });

  it('promotes the current item and does not repeat it as a row', () => {
    const now = planItem({ id: 't1', title: 'One', sort: 0 });
    render(
      <TodaysWork
        plan={[now, planItem({ id: 't2', title: 'Two', sort: 1 })]}
        now={now}
        orgName={orgName}
        loading={false}
        onComplete={vi.fn()}
        onDefer={vi.fn()}
        onTimebox={vi.fn()}
      />,
    );

    expect(screen.getByRole('article', { name: 'Now: One' })).toBeInTheDocument();
    // Two plan items, one of them promoted: exactly one ordinary row remains. Scoped to the row
    // list, because the promoted card carries links of its own (its title, and "Open").
    const rows = screen.getByRole('group', { name: 'Acme' });
    expect(within(rows).getAllByRole('link')).toHaveLength(1);
    expect(within(rows).getByText('Two')).toBeInTheDocument();
  });

  it('carries the state glyph and due date the row used to drop', () => {
    render(
      <TodaysWork
        plan={[
          planItem({
            id: 't1',
            title: 'Finalise the budget',
            state: 'done',
            stateType: 'completed',
            dueDate: '2026-08-07',
          }),
        ]}
        orgName={orgName}
        loading={false}
      />,
    );
    const row = screen.getByRole('link');
    expect(within(row).getByText('Finalise the budget')).toBeInTheDocument();
    expect(within(row).getByText(/Aug 7/)).toBeInTheDocument();
    expect(within(row).getByText('Acme')).toBeInTheDocument();
  });

  it('marks a blocked item so the row says why it will not move', () => {
    render(
      <TodaysWork
        plan={[{ ...planItem({ id: 't1', title: 'Waiting' }), blocked: true, dependencyImpact: 3 }]}
        orgName={orgName}
        loading={false}
      />,
    );
    const row = screen.getByRole('link');
    expect(within(row).getByText(/blocked/i)).toBeInTheDocument();
    expect(within(row).getByText(/unblocks 3/i)).toBeInTheDocument();
  });

  it('groups by workspace only when the day actually spans more than one', () => {
    const single = render(
      <TodaysWork
        plan={[planItem({ id: 't1', title: 'One' })]}
        orgName={orgName}
        loading={false}
      />,
    );
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    single.unmount();

    render(
      <TodaysWork
        plan={[
          planItem({ id: 't1', title: 'One' }),
          planItem({ id: 't2', title: 'Two', organizationId: ORG_B }),
        ]}
        orgName={orgName}
        loading={false}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Acme',
      'Hope Fund',
    ]);
  });

  it('keeps its heading painted while loading rather than replacing a known word with a grey bar', () => {
    render(<TodaysWork plan={[]} orgName={orgName} loading />);
    expect(screen.getByRole('heading', { level: 2, name: 'The day' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers a way to fill an empty day instead of only stating it is empty', () => {
    const onPlan = vi.fn();
    render(<TodaysWork plan={[]} orgName={orgName} loading={false} unplanned onPlan={onPlan} />);

    // Planning is the empty state's own action now — it used to be a banner above every section,
    // announcing Athena where the day's work should have been.
    fireEvent.click(screen.getByRole('button', { name: /plan today/i }));
    expect(onPlan).toHaveBeenCalledOnce();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/tasks');
  });
});

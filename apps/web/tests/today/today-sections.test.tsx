import '@testing-library/jest-dom/vitest';

import type { HubTaskItem } from '@docket/types';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NeedsYou from '../../src/components/today/needs-you';
import TodaysWork from '../../src/components/today/todays-work';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../src/components/org-chip', () => ({
  OrgChip: ({ name }: { name: string }) => <span data-org-chip="">{name}</span>,
}));

const ORG_A = '01JQ000000000000000000000A';
const ORG_B = '01JQ000000000000000000000B';

function task(overrides: Partial<HubTaskItem> & { id: string; title: string }): HubTaskItem {
  return {
    organizationId: ORG_A,
    state: 'todo',
    priority: null,
    assigneeId: null,
    projectId: null,
    dueDate: null,
    ...overrides,
  } as HubTaskItem;
}

const orgName = (orgId: string): string => (orgId === ORG_A ? 'Acme' : 'Hope Fund');

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
    expect(screen.queryByText(/Waiting on your approval/)).not.toBeInTheDocument();
    expect(screen.getByText(/Blocked/)).toBeInTheDocument();
  });
});

describe('TodaysWork', () => {
  it('renders every planned task, not a truncated few', () => {
    const plan = Array.from({ length: 7 }, (_, i) =>
      task({ id: `t${String(i)}`, title: `Task ${String(i)}` }),
    );
    render(<TodaysWork plan={plan} orgName={orgName} loading={false} />);

    // The list this replaced capped at three and, worse, hid due-today tasks entirely whenever any
    // calendar block was timeboxed.
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  it('carries the state glyph and due date the row used to drop', () => {
    render(
      <TodaysWork
        plan={[
          task({ id: 't1', title: 'Finalise the budget', state: 'done', dueDate: '2026-08-07' }),
        ]}
        orgName={orgName}
        loading={false}
      />,
    );
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Finalise the budget')).toBeInTheDocument();
    expect(within(row).getByText(/Aug 7/)).toBeInTheDocument();
    expect(within(row).getByText('Acme')).toBeInTheDocument();
  });

  it('groups by workspace only when the day actually spans more than one', () => {
    const single = render(
      <TodaysWork plan={[task({ id: 't1', title: 'One' })]} orgName={orgName} loading={false} />,
    );
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    single.unmount();

    render(
      <TodaysWork
        plan={[
          task({ id: 't1', title: 'One' }),
          task({ id: 't2', title: 'Two', organizationId: ORG_B }),
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
    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByText('Nothing planned yet.')).not.toBeInTheDocument();
  });

  it('offers a way to fill an empty day instead of only stating it is empty', () => {
    render(<TodaysWork plan={[]} orgName={orgName} loading={false} />);
    expect(screen.getByText('Nothing planned yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pull in work' })).toHaveAttribute('href', '/tasks');
  });
});

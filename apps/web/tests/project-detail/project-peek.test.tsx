/**
 * `tests/project-detail` — what selecting a project on the dependency canvas shows.
 *
 * @remarks
 * The launch finding was that a click produced a bounding box and nothing else. The fix is only
 * real if the panel is *populated*, so these assertions name the five properties the requirement
 * lists — name, status, lead, dates, dependencies — and check each is present with the row's own
 * data rather than a placeholder. The upstream/downstream split is asserted separately because a
 * dependency panel that lists neighbours without saying which direction they run in is worse than
 * none: it inverts the only question the lens exists to answer.
 */
import type { ProjectOverviewItem } from '@docket/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ProjectPeek, { type ProjectPeekNeighbor } from '@/components/canvas/project-peek';

afterEach(cleanup);

/** A portfolio row with every field the panel reads. */
function project(overrides: Partial<ProjectOverviewItem> = {}): ProjectOverviewItem {
  return {
    id: 'p-1',
    organizationId: 'org-1',
    name: 'Payments migration',
    summary: 'Move settlement onto the new ledger.',
    description: null,
    status: 'active',
    health: 'at_risk',
    leadId: 'actor-1',
    teamId: null,
    programId: null,
    startDate: '2026-03-02',
    targetDate: '2026-05-14',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    display: {
      subjectType: 'project',
      subjectId: 'p-1',
      iconKey: 'target',
      colorKey: 'indigo',
      customColor: null,
      customized: false,
    },
    milestones: [],
    taskCount: 8,
    completedTaskCount: 3,
    blockedByIds: [],
    blocksIds: [],
    ...overrides,
  } as unknown as ProjectOverviewItem;
}

const UPSTREAM: readonly ProjectPeekNeighbor[] = [
  { id: 'p-2', name: 'Ledger rewrite', status: 'active', onCanvas: true },
];
const DOWNSTREAM: readonly ProjectPeekNeighbor[] = [
  { id: 'p-3', name: 'Billing invoices', status: 'planned', onCanvas: true },
  { id: 'p-4', name: 'Filtered out', status: 'planned', onCanvas: false },
];

describe('selecting a project shows the project, not a bounding box', () => {
  it('states its name, status, health, lead, dates, and task progress', () => {
    render(
      <ProjectPeek
        project={project()}
        orgId="org-1"
        leadName="Ada Lovelace"
        blockedBy={UPSTREAM}
        blocks={DOWNSTREAM}
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('Payments migration')).toBeTruthy();
    expect(screen.getByText('Move settlement onto the new ledger.')).toBeTruthy();
    expect(screen.getByText('At risk')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText(/Mar 2\s*→\s*May 14/)).toBeTruthy();
    expect(screen.getByText(/3 of 8 done \(38%\)/)).toBeTruthy();
    // …and a way out of the canvas into the project itself.
    expect(screen.getByRole('link', { name: /Open project/ }).getAttribute('href')).toBe(
      '/orgs/org-1/projects/p-1',
    );
  });

  it('splits the dependencies by direction', () => {
    render(
      <ProjectPeek
        project={project()}
        orgId="org-1"
        leadName={null}
        blockedBy={UPSTREAM}
        blocks={DOWNSTREAM}
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('Waiting on')).toBeTruthy();
    expect(screen.getByText('Blocking')).toBeTruthy();
    expect(screen.getByText('Ledger rewrite')).toBeTruthy();
    expect(screen.getByText('Billing invoices')).toBeTruthy();
  });

  it('walks the graph: a neighbour on the canvas moves the selection, one filtered out cannot', () => {
    const onSelect = vi.fn();
    render(
      <ProjectPeek
        project={project()}
        orgId="org-1"
        leadName={null}
        blockedBy={UPSTREAM}
        blocks={DOWNSTREAM}
        onSelect={onSelect}
        onClose={() => undefined}
      />,
    );
    const reachable = screen.getByRole('button', { name: /Ledger rewrite/ });
    reachable.click();
    expect(onSelect).toHaveBeenCalledWith('p-2');

    // A blocker outside the current filter is still listed — a hidden blocker is the dangerous
    // kind — but there is no node to move the selection to, so it is not actionable.
    const unreachable = screen.getByRole('button', { name: /Filtered out/ });
    expect(unreachable.hasAttribute('disabled')).toBe(true);
  });

  it('says so plainly when a property is unset instead of inventing one', () => {
    render(
      <ProjectPeek
        project={project({ health: null, leadId: null, startDate: null, targetDate: null })}
        orgId="org-1"
        leadName={null}
        blockedBy={[]}
        blocks={[]}
        onSelect={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('Not set')).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
    expect(screen.getByText('Not scheduled')).toBeTruthy();
    expect(screen.getAllByText('None')).toHaveLength(2);
  });
});

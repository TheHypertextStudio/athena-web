/**
 * The task detail property rail: no rules, one grid, one type token, and a settable start date.
 *
 * @remarks
 * Every assertion here pins something the rail was measured doing wrong on the live app, so each
 * one is a regression guard rather than a restatement of the implementation:
 *
 * - the rows sat inside `divide-y`, drawing a hairline between all seven of them;
 * - rows measured 49/49/35/49/35/35/34px because a picker row and a text row had different
 *   heights, so nothing lined up vertically;
 * - there was no anticipated-start control at all, even though `startDate` is a real column that
 *   round-trips through the API;
 * - a badge read **"Native"** — a word describing the implementation, on the majority of tasks.
 */
import '@testing-library/jest-dom/vitest';

import type { TaskDetail, TaskProvenance } from '@docket/types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TaskPropertiesRail } from '../../src/components/task-detail/task-properties-rail';

afterEach(cleanup);

const NATIVE: TaskProvenance = { source: 'native' };
const LINKED: TaskProvenance = {
  source: 'linked',
  sourceIntegrationId: '01HZZZ0000000000000000INT',
  externalId: '412',
  externalUrl: 'https://github.com/acme/widgets/issues/412',
};

/** A minimal-but-complete task detail; `overrides` swaps only what a case is about. */
function task(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: '01HZZZ00000000000000000TSK',
    organizationId: '01HZZZ00000000000000000ORG',
    title: 'Ship the roster',
    teamId: '01HZZZ0000000000000000TEAM',
    state: 'todo',
    priority: 'none',
    provenance: NATIVE,
    createdAt: '2026-08-01T09:00:00.000Z',
    labels: [],
    blocking: [],
    blockedBy: [],
    subtasks: [],
    ...overrides,
  } as TaskDetail;
}

/** Render the rail with sensible defaults; `props` overrides any of them. */
function renderRail(
  props: Partial<React.ComponentProps<typeof TaskPropertiesRail>> = {},
): HTMLElement {
  const { container } = render(
    <TaskPropertiesRail
      task={task()}
      projectLabel="Project"
      programLabel="Program"
      cycleLabel="Cycle"
      labelOptions={[]}
      onCreateLabel={() => undefined}
      projectOptions={[]}
      programOptions={[]}
      milestoneOptions={[]}
      cycleOptions={[]}
      estimationScale="fibonacci"
      canEdit
      onPatch={vi.fn()}
      {...props}
    />,
  );
  const aside = container.querySelector('aside');
  if (!aside) throw new Error('the rail did not render an <aside>');
  return aside;
}

describe('TaskPropertiesRail — structure without rules', () => {
  it('draws no line between any two properties, at any breakpoint', () => {
    const aside = renderRail();

    // `divide-*` puts a border on every child but the first; `border-t`/`border-b` (including the
    // container-query variants the rail used to carry) draw the same rule a breakpoint at a time.
    expect(aside.querySelectorAll('hr')).toHaveLength(0);
    for (const element of [aside, ...aside.querySelectorAll('*')]) {
      const classes = element.className;
      if (typeof classes !== 'string') continue;
      for (const token of classes.split(/\s+/)) {
        // Strip any responsive/container prefix (`@4xl:border-l`, `md:border-t`) before matching.
        const utility = token.slice(token.lastIndexOf(':') + 1);
        expect(utility).not.toMatch(/^divide-/);
        expect(utility).not.toMatch(/^border(-[trbl])?$/);
      }
    }
  });

  it('groups the rows by spacing, with a larger gap between groups than within one', () => {
    const aside = renderRail();

    // Groups are announced but unheaded: the structure is spacing, not a second type style.
    expect(screen.getByRole('group', { name: 'Placement' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Schedule' })).toBeInTheDocument();
    expect(screen.queryByText('Placement')).not.toBeInTheDocument();
    expect(screen.queryByText('Schedule')).not.toBeInTheDocument();

    // Larger between (`gap-6` on the panel) than within (no gap on a group) is the whole signal.
    expect(aside.className).toContain('gap-6');
    expect(screen.getByRole('group', { name: 'Placement' }).className).not.toMatch(/\bgap-\d/);
  });

  it('gives every property row the same height class, so the column cannot stagger', () => {
    const aside = renderRail();

    const rows = [...aside.querySelectorAll('div')].filter((element) =>
      element.className.split(/\s+/).includes('h-9'),
    );
    // Four Placement rows + one Labels row + four Schedule rows.
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row.className).toContain('items-center');
      expect(row.className).not.toContain('items-start');
      expect(row.className).not.toContain('flex-wrap');
    }
  });

  it('sets one type token on the panel and forces every control onto it', () => {
    const aside = renderRail();

    expect(aside.className).toContain('text-body-medium');
    // The heading names the region without adding a second type style to it.
    const heading = screen.getByRole('heading', { name: 'Properties' });
    expect(heading.className).toContain('sr-only');
    expect(heading.className).not.toMatch(/text-(xs|sm|lg)/);

    // Every picker trigger carries the panel's token explicitly, because `Button size="sm"`
    // contributes `text-xs` and would otherwise render "Set project" smaller than "Aug 1, 2026".
    for (const trigger of screen.getAllByRole('button')) {
      expect(trigger.className).toContain('text-body-medium');
      expect(trigger.className).toContain('h-9');
    }
  });
});

describe('TaskPropertiesRail — anticipated start', () => {
  it('exposes an anticipated-start control distinct from the due date', () => {
    renderRail({ task: task({ startDate: '2026-09-15', dueDate: '2026-10-01' }) });

    expect(screen.getByRole('button', { name: /^Anticipated start —/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Due —/ })).toBeInTheDocument();
  });

  it('patches `startDate` with a bare YYYY-MM-DD when a date is chosen', async () => {
    const onPatch = vi.fn();
    renderRail({ task: task({ startDate: '2026-09-01' }), onPatch });

    fireEvent.click(screen.getByRole('button', { name: /^Anticipated start —/ }));
    // `DatePicker` presents a WAI-ARIA date grid whose day buttons are named by their ISO day, so
    // the choice is made the way a person makes it rather than by writing to a hidden field.
    fireEvent.click(await screen.findByRole('button', { name: '2026-09-15' }));

    // The API validates this as `z.iso.date()` and 422s on a full datetime.
    expect(onPatch).toHaveBeenCalledWith({ startDate: '2026-09-15' });
  });

  it('narrows a stored ISO timestamp to the calendar day the date field expects', async () => {
    renderRail({ task: task({ startDate: '2026-09-15T00:00:00.000Z' }) });

    // The trigger states the day, and the grid opens on that month with that day selected — both
    // of which are impossible if the timestamp reached the date control unnarrowed.
    expect(screen.getByRole('button', { name: 'Anticipated start — Sep 15, 2026' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Anticipated start —/ }));
    const selected = await screen.findByRole('gridcell', { selected: true });
    expect(within(selected).getByRole('button')).toHaveAccessibleName('2026-09-15');
  });

  it('clears the start date through the same control', async () => {
    const onPatch = vi.fn();
    renderRail({ task: task({ startDate: '2026-09-15' }), onPatch });

    fireEvent.click(screen.getByRole('button', { name: /^Anticipated start —/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));

    expect(onPatch).toHaveBeenCalledWith({ startDate: null });
  });
});

describe('TaskPropertiesRail — estimate', () => {
  it('hides the row entirely when the workspace has no estimates configured', () => {
    renderRail({ estimationScale: 'none' });
    expect(screen.queryByText('Estimate')).not.toBeInTheDocument();
  });

  it('hides the row while the workspace scale is still loading', () => {
    renderRail({ estimationScale: null });
    expect(screen.queryByText('Estimate')).not.toBeInTheDocument();
  });

  it("offers the workspace scale's values and patches `estimate` on selection", async () => {
    const onPatch = vi.fn();
    renderRail({ estimationScale: 'fibonacci', onPatch });

    expect(screen.getByRole('button', { name: 'Estimate — not set' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Estimate — not set' }));
    // The listbox row's accessible `option` role sits on the `<li>` wrapper; the click handler
    // lives on its inner `<button>`, which is what a real click actually lands on.
    fireEvent.click(await screen.findByRole('button', { name: '8' }));

    expect(onPatch).toHaveBeenCalledWith({ estimate: 8 });
  });

  it('clears a set estimate back to null through the clear row', async () => {
    const onPatch = vi.fn();
    renderRail({ task: task({ estimate: 3 }), estimationScale: 'fibonacci', onPatch });

    fireEvent.click(screen.getByRole('button', { name: 'Estimate — 3' }));
    fireEvent.click(await screen.findByRole('button', { name: 'None' }));

    expect(onPatch).toHaveBeenCalledWith({ estimate: null });
  });
});

describe('TaskPropertiesRail — origin', () => {
  it('says nothing at all about a task created in Docket', () => {
    const aside = renderRail();

    expect(aside.textContent).not.toMatch(/Native/i);
    expect(screen.queryByText('Source')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Origin' })).not.toBeInTheDocument();
  });

  it('names where an imported task came from, and links to the original', () => {
    renderRail({ task: task({ provenance: LINKED }) });

    expect(screen.getByRole('group', { name: 'Origin' })).toBeInTheDocument();
    expect(screen.getByText('Imported from')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'github.com' });
    expect(link).toHaveAttribute('href', LINKED.externalUrl);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('still names the row when an imported task carries no link', () => {
    renderRail({ task: task({ provenance: { source: 'linked' } }) });

    expect(screen.getByText('Imported from')).toBeInTheDocument();
    expect(screen.getByText('An external tool')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

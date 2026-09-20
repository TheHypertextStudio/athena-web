/**
 * The task's secondary properties, in both presentations.
 *
 * @remarks
 * `rows` is the docked aside: no rules, one grid, one type token, and a settable start date. Each
 * assertion pins something the panel was measured doing wrong on the live app, so each is a
 * regression guard rather than a restatement of the implementation:
 *
 * - the rows sat inside `divide-y`, drawing a hairline between all of them;
 * - rows measured 49/49/35/49/35/35/34px because a picker row and a text row had different
 *   heights, so nothing lined up vertically;
 * - there was no anticipated-start control at all, even though `startDate` is a real column that
 *   round-trips through the API;
 * - a badge read "Native", a word describing the implementation, on the majority of tasks.
 *
 * `chips` is the metadata row: the same fields as prioritized items that demote into the row's
 * overflow as the pane narrows.
 */
import '@testing-library/jest-dom/vitest';

import { assertDefined } from '@docket/test-utils';
import type { TaskDetail, TaskProvenance } from '@docket/work/task-model';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TaskSecondaryProperties,
  type TaskSecondaryHostModel,
  type TaskSecondaryModel,
  type TaskSecondaryPresentation,
  type TaskSecondaryPropertiesProps,
} from '../../src/components/task-detail/task-secondary-properties';
import { EntityMetadataRow } from '../../src/components/views/entity-detail-layout';
import { mockWideMetadataRow } from '../support/metadata-row-layout';

vi.mock('@/components/pickers/future-cycle-picker', () => ({
  FutureCyclePicker: ({
    noun = 'Cycle',
    onChange,
    triggerClassName,
  }: {
    noun?: string;
    onChange: (id: string, revision: number) => void;
    triggerClassName?: string;
  }) => (
    <button
      type="button"
      aria-label={`${noun} — not set`}
      className={triggerClassName}
      onClick={() => {
        onChange('cycle_1', 3);
      }}
    >
      Set {noun.toLowerCase()}
    </button>
  ),
}));

beforeEach(() => {
  mockWideMetadataRow();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

/** What a case is about, flat: the model's shared fields, its secondary fields, and the layout. */
type CaseOverrides = Partial<Omit<TaskSecondaryHostModel, 'secondary'> & TaskSecondaryModel> & {
  readonly presentation?: TaskSecondaryPresentation;
};

/** The props both presentations share; `overrides` replaces any of the fields. */
function propsFor(overrides: CaseOverrides = {}): TaskSecondaryPropertiesProps {
  const { presentation, task: subject, canEdit, onPatch, projectLabel, ...secondary } = overrides;
  return {
    presentation: presentation ?? 'rows',
    model: {
      task: subject ?? task(),
      canEdit: canEdit ?? true,
      onPatch: onPatch ?? vi.fn(),
      projectLabel: projectLabel ?? 'Project',
      secondary: {
        programLabel: 'Program',
        cycleLabel: 'Cycle',
        labelOptions: [],
        onCreateLabel: () => undefined,
        programOptions: [],
        milestoneOptions: [],
        estimationScale: 'fibonacci',
        ...secondary,
      },
    },
  };
}

/** Render the docked rows; returns the panel element. */
function renderRows(props: CaseOverrides = {}): HTMLElement {
  const { container } = render(<TaskSecondaryProperties {...propsFor(props)} />);
  const panel = container.firstElementChild;
  if (!panel) throw new Error('the properties did not render');
  return panel as HTMLElement;
}

describe('TaskSecondaryProperties rows — structure without rules', () => {
  it('draws no line between any two properties, at any breakpoint', () => {
    const panel = renderRows();

    // `divide-*` puts a border on every child but the first; `border-t`/`border-b` (including the
    // container-query variants the panel used to carry) draw the same rule a breakpoint at a time.
    expect(panel.querySelectorAll('hr')).toHaveLength(0);
    for (const element of [panel, ...panel.querySelectorAll('*')]) {
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
    const panel = renderRows();

    // Groups are announced but unheaded: the structure is spacing, not a second type style.
    expect(screen.getByRole('group', { name: 'Placement' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Schedule' })).toBeInTheDocument();
    expect(screen.queryByText('Placement')).not.toBeInTheDocument();
    expect(screen.queryByText('Schedule')).not.toBeInTheDocument();

    // Larger between (`gap-6` on the panel) than within (no gap on a group) is the whole signal.
    expect(panel.className).toContain('gap-6');
    expect(screen.getByRole('group', { name: 'Placement' }).className).not.toMatch(/\bgap-\d/);
  });

  it('gives every property row the same height class, so the column cannot stagger', () => {
    const panel = renderRows();

    const rows = [...panel.querySelectorAll('div')].filter((element) =>
      element.className.split(/\s+/).includes('h-9'),
    );
    // Three Placement rows + one Labels row + three Schedule rows.
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.className).toContain('items-center');
      expect(row.className).not.toContain('items-start');
      expect(row.className).not.toContain('flex-wrap');
    }
  });

  it('sets one type token on the panel and forces every control onto it', () => {
    const panel = renderRows();

    expect(panel.className).toContain('text-body-medium');
    // The heading names the region without adding a second type style to it.
    const heading = screen.getByRole('heading', { name: 'Properties' });
    expect(heading.className).toContain('sr-only');
    expect(heading.className).not.toMatch(/text-(xs|sm|lg)/);

    // Every picker trigger carries the panel's token explicitly, because `Button size="sm"`
    // contributes `text-xs` and would otherwise render "Set program" smaller than "Aug 1, 2026".
    for (const trigger of screen.getAllByRole('button')) {
      expect(trigger.className).toContain('text-body-medium');
      expect(trigger.className).toContain('h-9');
    }
  });

  it('leaves the lead properties to the masthead', () => {
    renderRows({ task: task({ dueDate: '2026-10-01' }) });

    expect(screen.queryByRole('button', { name: /^Due —/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Project —/ })).not.toBeInTheDocument();
  });

  it('names the delegate when the work is handed to someone', () => {
    renderRows({ delegate: { name: 'Ada Lovelace', kind: 'human' } });

    expect(screen.getByText('Delegate')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });
});

describe('TaskSecondaryProperties rows — anticipated start', () => {
  it('exposes an anticipated-start control', () => {
    renderRows({ task: task({ startDate: '2026-09-15' }) });

    expect(screen.getByRole('button', { name: /^Anticipated start —/ })).toBeInTheDocument();
  });

  it('patches `startDate` with a bare YYYY-MM-DD when a date is chosen', async () => {
    const onPatch = vi.fn();
    renderRows({ task: task({ startDate: '2026-09-01' }), onPatch });

    fireEvent.click(screen.getByRole('button', { name: /^Anticipated start —/ }));
    // `DatePicker` presents a WAI-ARIA date grid whose day buttons are named by their ISO day, so
    // the choice is made the way a person makes it rather than by writing to a hidden field.
    fireEvent.click(await screen.findByRole('button', { name: '2026-09-15' }));

    // The API validates this as `z.iso.date()` and 422s on a full datetime.
    expect(onPatch).toHaveBeenCalledWith({ startDate: '2026-09-15' });
  });

  it('narrows a stored ISO timestamp to the calendar day the date field expects', async () => {
    renderRows({ task: task({ startDate: '2026-09-15T00:00:00.000Z' }) });

    // The trigger states the day, and the grid opens on that month with that day selected — both
    // of which are impossible if the timestamp reached the date control unnarrowed.
    expect(screen.getByRole('button', { name: 'Anticipated start — Sep 15, 2026' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Anticipated start —/ }));
    const selected = await screen.findByRole('gridcell', { selected: true });
    expect(within(selected).getByRole('button')).toHaveAccessibleName('2026-09-15');
  });

  it('clears the start date through the same control', async () => {
    const onPatch = vi.fn();
    renderRows({ task: task({ startDate: '2026-09-15' }), onPatch });

    fireEvent.click(screen.getByRole('button', { name: /^Anticipated start —/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));

    expect(onPatch).toHaveBeenCalledWith({ startDate: null });
  });
});

describe('TaskSecondaryProperties rows — estimate', () => {
  it('hides the row entirely when the workspace has no estimates configured', () => {
    renderRows({ estimationScale: 'none' });
    expect(screen.queryByText('Estimate')).not.toBeInTheDocument();
  });

  it('hides the row while the workspace scale is still loading', () => {
    renderRows({ estimationScale: null });
    expect(screen.queryByText('Estimate')).not.toBeInTheDocument();
  });

  it("offers the workspace scale's values and patches `estimate` on selection", async () => {
    const onPatch = vi.fn();
    renderRows({ estimationScale: 'fibonacci', onPatch });

    expect(screen.getByRole('button', { name: 'Estimate — not set' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Estimate — not set' }));
    // The listbox row's accessible `option` role sits on the `<li>` wrapper; the click handler
    // lives on its inner `<button>`, which is what a real click actually lands on.
    fireEvent.click(await screen.findByRole('button', { name: '8' }));

    expect(onPatch).toHaveBeenCalledWith({ estimate: 8 });
  });

  it('clears a set estimate back to null through the clear row', async () => {
    const onPatch = vi.fn();
    renderRows({ task: task({ estimate: 3 }), estimationScale: 'fibonacci', onPatch });

    fireEvent.click(screen.getByRole('button', { name: 'Estimate — 3' }));
    fireEvent.click(await screen.findByRole('button', { name: 'None' }));

    expect(onPatch).toHaveBeenCalledWith({ estimate: null });
  });
});

describe('TaskSecondaryProperties rows — origin', () => {
  it('says nothing at all about a task created in Docket', () => {
    const panel = renderRows();

    expect(panel.textContent).not.toMatch(/Native/i);
    expect(screen.queryByText('Source')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Origin' })).not.toBeInTheDocument();
  });

  it('names where an imported task came from, and links to the original', () => {
    renderRows({ task: task({ provenance: LINKED }) });

    expect(screen.getByRole('group', { name: 'Origin' })).toBeInTheDocument();
    expect(screen.getByText('Imported from')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'github.com' });
    expect(link).toHaveAttribute('href', LINKED.externalUrl);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('still names the row when an imported task carries no link', () => {
    renderRows({ task: task({ provenance: { source: 'linked' } }) });

    expect(screen.getByText('Imported from')).toBeInTheDocument();
    expect(screen.getByText('An external tool')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

/** Render the chips inside the metadata row they are built for. */
function renderChips(props: CaseOverrides = {}): void {
  render(
    <EntityMetadataRow ariaLabel="Task properties">
      <TaskSecondaryProperties {...propsFor({ presentation: 'chips', ...props })} />
    </EntityMetadataRow>,
  );
}

/** Queries scoped to the properties the row shows inline, as opposed to its overflow. */
function inlineLane(): ReturnType<typeof within> {
  const row = screen.getByRole('group', { name: 'Task properties' });
  return within(assertDefined(row.querySelector<HTMLElement>('[data-entity-metadata-inline]')));
}

describe('TaskSecondaryProperties chips', () => {
  it('leads the row with estimate, labels, and cycle, and leaves the rest to the overflow', async () => {
    renderChips();

    const inline = inlineLane();
    expect(inline.getByRole('button', { name: 'Estimate — not set' })).toBeVisible();
    expect(inline.getByRole('button', { name: /^Labels/ })).toBeVisible();
    expect(inline.getByRole('button', { name: /^Cycle/ })).toBeVisible();
    // Supplemental properties are hidden inline whatever the row's width.
    expect(inline.queryByRole('button', { name: /^Milestone/ })).not.toBeInTheDocument();
    expect(inline.queryByRole('button', { name: /^Anticipated start/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'More Task properties' }));
    const overflow = within(await screen.findByRole('group', { name: 'More Task properties' }));
    // A milestone belongs to a project, so a task in none states it rather than offering it.
    expect(overflow.getByLabelText(/^Milestone/)).toBeVisible();
    expect(overflow.getByRole('button', { name: /^Program/ })).toBeVisible();
    expect(overflow.getByRole('button', { name: /^Anticipated start/ })).toBeVisible();
    expect(overflow.getByLabelText(/^Task — Created/)).toBeVisible();
    // Each property exists once: the inline set is not repeated in the overflow.
    expect(overflow.queryByRole('button', { name: /^Labels/ })).not.toBeInTheDocument();
  });

  it('offers no estimate chip when the workspace has estimation turned off', () => {
    renderChips({ estimationScale: 'none' });

    expect(screen.queryByRole('button', { name: /^Estimate/ })).not.toBeInTheDocument();
  });

  it('carries the delegate and the origin into the overflow when the task has them', async () => {
    renderChips({
      task: task({ provenance: LINKED }),
      delegate: { name: 'Ada Lovelace', kind: 'human' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'More Task properties' }));
    const overflow = within(await screen.findByRole('group', { name: 'More Task properties' }));
    expect(overflow.getByLabelText(/^Delegate/)).toBeVisible();
    expect(overflow.getByRole('link', { name: 'github.com' })).toHaveAttribute(
      'href',
      LINKED.externalUrl,
    );
  });

  it('patches the cycle through its chip', () => {
    const onPatch = vi.fn();
    renderChips({ onPatch });

    fireEvent.click(inlineLane().getByRole('button', { name: /^Cycle/ }));

    expect(onPatch).toHaveBeenCalledWith({ cycleId: 'cycle_1', cycleCadenceRevision: 3 });
  });
});

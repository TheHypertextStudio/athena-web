/**
 * The task's secondary properties as chips in the masthead's metadata row.
 *
 * @remarks
 * The same fields the properties sidebar shows as rows (`task-properties-panel.test.tsx`), here as
 * prioritized items that demote into the row's overflow as the pane narrows.
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

/** What a case is about, flat: the model's shared fields and its secondary fields. */
type CaseOverrides = Partial<Omit<TaskSecondaryHostModel, 'secondary'> & TaskSecondaryModel>;

/** The chips' props; `overrides` replaces any of the fields. */
function propsFor(overrides: CaseOverrides = {}): { readonly model: TaskSecondaryHostModel } {
  const { task: subject, canEdit, onPatch, projectLabel, ...secondary } = overrides;
  return {
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

/** Render the chips inside the metadata row they are built for. */
function renderChips(props: CaseOverrides = {}): void {
  render(
    <EntityMetadataRow ariaLabel="Task properties">
      <TaskSecondaryProperties {...propsFor(props)} />
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
    expect(overflow.getByRole('button', { name: /^Created/ })).toBeVisible();
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

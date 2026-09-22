/**
 * The task's properties sidebar: every property once, as one flush column of rows.
 *
 * @remarks
 * Each assertion pins something the sidebar was measured doing wrong on the live app:
 *
 * - the rows sat inside `divide-y`, drawing a hairline between all of them;
 * - rows measured 49/49/35/49/35/35/34px because a picker row and a text row had different
 *   heights, so nothing lined up vertically;
 * - properties were split between header chips and the sidebar, so a person looked in two places;
 * - unlabeled 24px gaps between groups read as a layout bug rather than grouping;
 * - there was no anticipated-start control and no way to set the task's parent;
 * - a badge read "Native", a word describing the implementation, on the majority of tasks.
 */
import '@testing-library/jest-dom/vitest';

import type { TaskDetail, TaskProvenance } from '@docket/work/task-model';
import { DEFAULT_WORKFLOW_STATES } from '@docket/work/workflow';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskPropertyModel } from '../../src/components/task-detail/task-masthead-properties';
import { TaskPropertiesPanel } from '../../src/components/task-detail/task-properties-panel';
import type { TaskSecondaryModel } from '../../src/components/task-detail/task-secondary-properties';
import { makeQueryWrapper } from '../support/query';

vi.mock('@/components/pickers/future-cycle-picker', () => ({
  FutureCyclePicker: ({ triggerClassName }: { triggerClassName?: string }) => (
    <button type="button" aria-label="Cycle — not set" className={triggerClassName}>
      Set cycle
    </button>
  ),
}));

afterEach(() => {
  cleanup();
});

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
    provenance: { source: 'native' },
    createdAt: '2026-08-01T09:00:00.000Z',
    labels: [],
    blocking: [],
    blockedBy: [],
    subtasks: [],
    relatedTasks: [],
    ...overrides,
  } as TaskDetail;
}

/** What a case is about: the task, whether it can be edited, the write, and secondary fields. */
interface CaseOverrides extends Partial<TaskSecondaryModel> {
  readonly task?: TaskDetail;
  readonly canEdit?: boolean;
  readonly onPatch?: TaskPropertyModel['onPatch'];
}

function modelFor(overrides: CaseOverrides = {}): TaskPropertyModel {
  const { task: subject, canEdit, onPatch, ...secondary } = overrides;
  return {
    task: subject ?? task(),
    canEdit: canEdit ?? true,
    workflowStates: DEFAULT_WORKFLOW_STATES,
    statusPending: false,
    priorityPending: false,
    onSetState: vi.fn(),
    onSetPriority: vi.fn(),
    onPatch: onPatch ?? vi.fn(),
    memberOptions: [],
    membersLoading: false,
    onMembersOpenChange: vi.fn(),
    projectLabel: 'Project',
    projectOptions: [],
    projectLoading: false,
    onProjectOpenChange: vi.fn(),
    secondary: {
      programLabel: 'Program',
      cycleLabel: 'Cycle',
      programOptions: [],
      milestoneOptions: [],
      labelOptions: [],
      onCreateLabel: vi.fn(),
      estimationScale: 'fibonacci',
      ...secondary,
    },
  };
}

/** Render the sidebar; returns the panel element. */
function renderPanel(overrides: CaseOverrides = {}): HTMLElement {
  const { wrapper } = makeQueryWrapper();
  const { container } = render(<TaskPropertiesPanel model={modelFor(overrides)} />, {
    wrapper,
  });
  const panel = container.firstElementChild;
  if (!panel) throw new Error('the properties did not render');
  return panel as HTMLElement;
}

/** Every property row: the elements that own the shared 36px row height. */
function propertyRows(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>('div')].filter((element) =>
    element.className.split(/\s+/).includes('h-9'),
  );
}

describe('TaskPropertiesPanel structure', () => {
  it('draws no line between any two properties, at any breakpoint', () => {
    const panel = renderPanel();

    expect(panel.querySelectorAll('hr')).toHaveLength(0);
    for (const element of [panel, ...panel.querySelectorAll('*')]) {
      const classes = element.className;
      if (typeof classes !== 'string') continue;
      for (const token of classes.split(/\s+/)) {
        const utility = token.slice(token.lastIndexOf(':') + 1);
        expect(utility).not.toMatch(/^divide-/);
        expect(utility).not.toMatch(/^border(-[trbl])?$/);
      }
    }
  });

  it('holds every property, lead set included, as one flush column of equal rows', () => {
    const panel = renderPanel({ task: task({ projectId: 'project_1' } as Partial<TaskDetail>) });

    for (const name of [
      /^Status —/,
      /^Priority —/,
      /^Assignee —/,
      /^Project —/,
      /^Parent —/,
      /^Cycle —/,
      /^Program —/,
      /^Labels/,
      /^Due —/,
      /^Anticipated start —/,
      /^Estimate —/,
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // Status, priority, assignee, project, parent, milestone, cycle, program, labels, due, start,
    // estimate: one row each, all sharing one height, none wrapping.
    const rows = propertyRows(panel);
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.className).toContain('items-center');
      expect(row.className).not.toContain('flex-wrap');
    }
    // One list: the rows share a parent, with no spacing groups between them.
    expect(new Set(rows.map((row) => row.parentElement)).size).toBe(1);
  });

  it('leaves the milestone out until the task has a project to choose one from', () => {
    renderPanel();

    expect(screen.queryByText('Milestone')).not.toBeInTheDocument();
  });

  it('sets one type token on the panel and forces every control onto it', () => {
    const panel = renderPanel();

    expect(panel.className).toContain('text-body-medium');
    expect(screen.getByRole('heading', { name: 'Properties' }).className).toContain('sr-only');
    for (const row of propertyRows(panel)) {
      for (const trigger of within(row).queryAllByRole('button')) {
        expect(trigger.className).toContain('text-body-medium');
        expect(trigger.className).toContain('h-9');
      }
    }
  });

  it('names the delegate when the work is handed to someone', () => {
    renderPanel({ delegate: { name: 'Ada Lovelace', kind: 'human' } });

    expect(screen.getByText('Delegate')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('shows every property read-only when the viewer cannot edit', () => {
    renderPanel({ canEdit: false });

    expect(screen.getByRole('button', { name: /^Status —/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Parent —/ })).not.toBeInTheDocument();
  });
});

describe('TaskPropertiesPanel fields', () => {
  it('patches `startDate` with a bare YYYY-MM-DD when a date is chosen', async () => {
    const onPatch = vi.fn();
    renderPanel({ task: task({ startDate: '2026-09-01' }), onPatch });

    fireEvent.click(screen.getByRole('button', { name: /^Anticipated start —/ }));
    fireEvent.click(await screen.findByRole('button', { name: '2026-09-15' }));

    expect(onPatch).toHaveBeenCalledWith({ startDate: '2026-09-15' });
  });

  it('hides the estimate when the workspace has no estimates configured, or while it loads', () => {
    renderPanel({ estimationScale: 'none' });
    expect(screen.queryByText('Estimate')).not.toBeInTheDocument();
    cleanup();

    renderPanel({ estimationScale: null });
    expect(screen.queryByText('Estimate')).not.toBeInTheDocument();
  });

  it("offers the workspace scale's values and patches `estimate` on selection", async () => {
    const onPatch = vi.fn();
    renderPanel({ estimationScale: 'fibonacci', onPatch });

    fireEvent.click(screen.getByRole('button', { name: 'Estimate — not set' }));
    fireEvent.click(await screen.findByRole('button', { name: '8' }));

    expect(onPatch).toHaveBeenCalledWith({ estimate: 8 });
  });
});

describe('TaskPropertiesPanel provenance', () => {
  it('says nothing at all about where a task created in Docket came from', () => {
    const panel = renderPanel();

    expect(panel.textContent).not.toMatch(/Native/i);
    expect(screen.queryByText('Imported from')).not.toBeInTheDocument();
  });

  it('states when the task was created as a fact, not an editable row', () => {
    const panel = renderPanel();

    const created = screen.getByText('Created');
    expect(created.tagName).toBe('DT');
    expect(propertyRows(panel)).not.toContain(created.parentElement);
  });

  it('names where an imported task came from, and links to the original', () => {
    renderPanel({ task: task({ provenance: LINKED }) });

    expect(screen.getByText('Imported from')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'github.com' });
    expect(link).toHaveAttribute('href', LINKED.externalUrl);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('still names the origin when an imported task carries no link', () => {
    renderPanel({ task: task({ provenance: { source: 'linked' } }) });

    expect(screen.getByText('An external tool')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

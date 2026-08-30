import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import {
  ProgramViewDefinition,
  ProgramViewRow,
  TaskViewDefinition,
  TaskViewRow,
} from '@docket/types';
import { describe, expect, it, vi } from 'vitest';

import { WorkCards } from '../../src/components/work-views/work-cards';

const definition = TaskViewDefinition.parse({
  version: 2,
  target: 'task',
  filter: null,
  arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
  presentation: {
    layout: 'cards',
    properties: ['status', 'priority'],
    density: 'compact',
    showEmptyGroups: false,
  },
});

const task = TaskViewRow.parse({
  target: 'task',
  organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
  id: '01ARZ3NDEKTSV4RRFFQ69G5FA1',
  title: 'Ship the roster',
  status: 'todo',
  priority: 'high',
  assignee: null,
  delegate: null,
  team: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
  project: null,
  program: null,
  cycle: null,
  milestone: null,
  parent: null,
  labels: [],
  creator: null,
  startDate: null,
  dueDate: null,
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
  estimate: null,
  estimateMinutes: null,
  blocked: false,
  blocking: false,
  unfiled: true,
  archived: false,
  manualRank: 'a0',
  isContext: false,
});

/** Fixture values the assertions share with the row, so neither drifts from the other. */
const PROGRAM_SUMMARY = 'Coordinate advocacy with regional partners.';
const PROGRAM_LAST_ACTIVE = '2026-08-23T00:00:00.000Z';

const programDefinition = ProgramViewDefinition.parse({
  version: 2,
  target: 'program',
  filter: null,
  arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
  presentation: {
    layout: 'cards',
    properties: ['status', 'health', 'owner', 'projectCount', 'taskCount'],
    density: 'compact',
    showEmptyGroups: false,
  },
});

const program = ProgramViewRow.parse({
  target: 'program',
  organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
  id: '01ARZ3NDEKTSV4RRFFQ69G5FA2',
  name: 'Transit coalition partnerships',
  summary: PROGRAM_SUMMARY,
  status: 'active',
  health: 'at_risk',
  owner: '01ARZ3NDEKTSV4RRFFQ69G5FE0',
  ownerActor: {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FE0',
    kind: 'human',
    displayName: 'Willie Chalmers III',
    avatar: null,
  },
  initiatives: [],
  labels: [],
  visibility: 'private',
  creator: null,
  updatedAt: '2026-08-23T00:00:00.000Z',
  projectCount: 4,
  taskCount: 8,
  manualRank: 'a0',
  isContext: false,
  activity: {
    weeks: [0, 2, 1, 3, 0, 4, 2, 5],
    latestOccurredAt: PROGRAM_LAST_ACTIVE,
  },
});

describe('WorkCards', () => {
  it('renders a target-neutral card grid with selection and activation', () => {
    const onActivate = vi.fn();
    const onSelectionChange = vi.fn();
    render(
      <WorkCards
        target="task"
        definition={definition}
        rows={[task]}
        selectedIds={new Set()}
        onSelectionChange={onSelectionChange}
        onActivate={onActivate}
      />,
    );

    expect(screen.getByRole('list', { name: 'Task cards' })).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Select Ship the roster' }).parentElement?.parentElement,
    ).toHaveClass('opacity-0');
    const link = screen.getByRole('link', { name: /Ship the roster/ });
    expect(link).toHaveAttribute('href', `/orgs/${task.organizationId}/tasks/${task.id}`);
    fireEvent.click(link);
    expect(onActivate).toHaveBeenCalledWith(task);
    onActivate.mockClear();
    fireEvent.click(link, { metaKey: true });
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ship the roster' }));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set([task.id]));
  });

  it('continues the root roster after the first page', () => {
    const onLoadMoreRows = vi.fn();
    const props = {
      target: 'task' as const,
      definition,
      rows: [task],
      selectedIds: new Set<string>(),
      onSelectionChange: vi.fn(),
      onActivate: vi.fn(),
      hasMoreRows: true,
      loadingMoreRows: false,
      onLoadMoreRows,
    };

    render(<WorkCards {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Load more tasks' }));
    expect(onLoadMoreRows).toHaveBeenCalledOnce();
  });

  it('renders the projected assignee name instead of the relation id', () => {
    const assignedTask = TaskViewRow.parse({
      ...task,
      assignee: '01ARZ3NDEKTSV4RRFFQ69G5FE0',
      assigneeActor: {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FE0',
        kind: 'human',
        displayName: 'Willie Chalmers III',
        avatar: null,
      },
    });
    const assigneeDefinition = TaskViewDefinition.parse({
      ...definition,
      presentation: { ...definition.presentation, properties: ['assignee'] },
    });

    render(
      <WorkCards
        target="task"
        definition={assigneeDefinition}
        rows={[assignedTask]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={vi.fn()}
      />,
    );

    expect(screen.getByText('Willie Chalmers III')).toBeVisible();
  });

  it('renders a Program card around its own name, verdict, owner, and visible activity', () => {
    const { container } = render(
      <WorkCards
        target="program"
        definition={programDefinition}
        rows={[program]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={vi.fn()}
      />,
    );

    expect(screen.getByRole('link', { name: /Transit coalition partnerships/ })).toBeVisible();
    expect(screen.getByText(PROGRAM_SUMMARY)).toBeVisible();

    // The roll-up the List lens shows: the owner by name and both child counts, so switching lens
    // changes how the roster is arranged rather than how much of it you are allowed to see.
    expect(screen.getByText('Willie Chalmers III')).toBeVisible();
    expect(screen.getByText(String(program.projectCount))).toBeVisible();
    expect(screen.getByText(String(program.taskCount))).toBeVisible();

    // Recency stays a real `<time>`, so it carries the machine-readable instant as well as its
    // rendered phrasing.
    expect(container.querySelector('time')).toHaveAttribute('dateTime', PROGRAM_LAST_ACTIVE);

    // Every week keeps its own bucket and its own accessible name, including the quiet ones — a
    // week with no events is an empty track rather than a missing bar.
    expect(
      screen.getByLabelText('Activity over the last 8 weeks: 0, 2, 1, 3, 0, 4, 2, 5'),
    ).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(9);
    expect(screen.getByRole('listitem', { name: 'Week 1: 0 events' })).toBeVisible();
    expect(screen.getByRole('listitem', { name: 'Week 3: 1 event' })).toBeVisible();
    expect(screen.getByRole('listitem', { name: 'Week 8: 5 events' })).toBeVisible();

    // The generic property list is what the Program card replaces, not something it also renders.
    expect(screen.queryByText('Project count')).not.toBeInTheDocument();
    expect(screen.queryByText('Task count')).not.toBeInTheDocument();
  });

  it('leaves the selection checkbox in the leading slot rather than a per-target corner', () => {
    render(
      <WorkCards
        target="program"
        definition={programDefinition}
        rows={[program]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={vi.fn()}
      />,
    );

    // Programs used to be the one target whose checkbox was pinned to the opposite corner, where
    // it sat in the card's padding gutter instead of over the identity glyph it replaces.
    const slot = screen.getByRole('checkbox', { name: 'Select Transit coalition partnerships' })
      .parentElement?.parentElement;
    expect(slot).toHaveClass('left-4');
  });

  it('says nothing at all about a Program nobody owns', () => {
    render(
      <WorkCards
        target="program"
        definition={programDefinition}
        rows={[ProgramViewRow.parse({ ...program, owner: null, ownerActor: null })]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={vi.fn()}
      />,
    );

    // The owner property is switched on and there is no owner, so the slot renders nothing at all.
    // On a roster where most Programs are unassigned, a placeholder would be the most repeated
    // thing on the screen. The counts keep their place in the roll-up without it.
    expect(programDefinition.presentation.properties).toContain('owner');
    expect(screen.queryByText('Willie Chalmers III')).not.toBeInTheDocument();
    expect(screen.getByText(String(program.projectCount))).toBeVisible();
  });

  it('shows only the properties the view has switched on', () => {
    const bareDefinition = ProgramViewDefinition.parse({
      ...programDefinition,
      presentation: { ...programDefinition.presentation, properties: [] },
    });

    render(
      <WorkCards
        target="program"
        definition={bareDefinition}
        rows={[program]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={vi.fn()}
      />,
    );

    // Name, summary, and activity are the card itself and always render; everything else answers
    // to Display → Properties, which used to do nothing at all on this lens.
    expect(screen.getByRole('link', { name: /Transit coalition partnerships/ })).toBeVisible();
    expect(
      screen.getByLabelText('Activity over the last 8 weeks: 0, 2, 1, 3, 0, 4, 2, 5'),
    ).toBeVisible();
    expect(screen.queryByText('Willie Chalmers III')).not.toBeInTheDocument();
    expect(screen.queryByText(String(program.projectCount))).not.toBeInTheDocument();
    expect(screen.queryByText(String(program.taskCount))).not.toBeInTheDocument();
  });

  it('renders a quiet Program pulse when its activity summary has no events', () => {
    render(
      <WorkCards
        target="program"
        definition={programDefinition}
        rows={[
          ProgramViewRow.parse({
            ...program,
            summary: null,
            health: null,
            activity: { weeks: [0, 0, 0, 0, 0, 0, 0, 0], latestOccurredAt: null },
          }),
        ]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={vi.fn()}
      />,
    );

    // An empty window collapses to one flat baseline instead of eight tall empty tracks, so a
    // roster of quiet Programs is not a wall of slots drawing the eye to missing information.
    expect(screen.getByRole('img', { name: 'No activity in the last 8 weeks' })).toBeVisible();
    expect(screen.queryByRole('listitem', { name: /^Week 1:/ })).not.toBeInTheDocument();
    expect(screen.getByText('No recent activity')).toBeVisible();

    // No verdict set means no verdict shown — the em dash a table column needs for alignment
    // would just be a stray mark here.
    expect(screen.queryByText('At risk')).not.toBeInTheDocument();
  });
});

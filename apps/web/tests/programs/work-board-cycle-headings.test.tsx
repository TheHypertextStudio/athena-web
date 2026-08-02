import '@testing-library/jest-dom/vitest';

/**
 * How the Program work board names its cycle groups.
 *
 * @remarks
 * The board groups a program's work by cadence, so the group heading is the *only* place a reader
 * is told which cadence they are looking at. It used to read `Cycle 1000137` off the stored
 * auto-roll key; removing that leak left the bare vocabulary noun behind, which is worse in the one
 * case that matters — a program running work in two unnamed cadences rendered two groups headed
 * "Cycle" and "Cycle". These pin the fix: the heading is the server-derived `displayName` (the
 * author's name, else the window), so two unnamed cadences are always distinguishable and neither
 * ever shows the number.
 */
import { CycleId, type ProgramWorkOut, TaskOut } from '@docket/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkBoard } from '../../src/components/programs/work-board';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const TEAM_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA4';

/** The auto-roll key range the audit found leaking into headings as "Cycle 1000137". */
const RAW_NUMBER_NAME = /Cycle \d{5,}/;

/**
 * A minimal task row for a heading test.
 *
 * @remarks
 * Parsed through the schema rather than cast, so the fixture carries the branded ids the board's
 * props demand and a DTO change fails here instead of type-checking silently.
 */
function task(id: string, title: string): TaskOut {
  return TaskOut.parse({
    id,
    organizationId: ORG_ID,
    title,
    description: null,
    teamId: TEAM_ID,
    state: 'backlog',
    priority: 'medium',
    assigneeId: null,
    delegateId: null,
    projectId: null,
    programId: null,
    dueDate: null,
    provenance: {
      source: 'native',
      sourceIntegrationId: null,
      externalId: null,
      externalUrl: null,
      syncMode: null,
    },
    createdAt: '2026-07-28T00:00:00.000Z',
  });
}

/** The cycle fields a heading test cares about, before the id carries its brand. */
type CycleFixture = Omit<ProgramWorkOut['groups'][number]['cycle'], 'id'> & {
  /** The cycle id, or `null` for the board's "no cycle" group. */
  readonly id: string | null;
};

/**
 * One cycle group holding a single task attached straight to the program.
 *
 * @remarks
 * The id is parsed through {@link CycleId} rather than cast, for the same reason {@link task} parses
 * its row: a cast would let a malformed id — or a future change to what a cycle id *is* — sail past
 * the type checker and fail somewhere less obvious.
 */
function group(
  cycle: CycleFixture,
  taskId: string,
  title: string,
): ProgramWorkOut['groups'][number] {
  return {
    cycle: { ...cycle, id: cycle.id === null ? null : CycleId.parse(cycle.id) },
    segments: [{ project: { id: null }, tasks: [task(taskId, title)] }],
  };
}

/** Render the board with the given groups and the default vocabulary. */
function renderBoard(groups: ProgramWorkOut['groups']): { readonly container: HTMLElement } {
  return render(
    <WorkBoard
      work={{ groups }}
      loading={false}
      error={null}
      cycleLabel="Cycle"
      taskNoun="task"
      taskNounPlural="tasks"
      projectNoun="project"
      canEdit={false}
      onOpenTask={vi.fn()}
    />,
  );
}

describe('Program work board cycle headings', () => {
  it('tells two unnamed cadences apart by their windows', () => {
    renderBoard([
      group(
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FA1',
          name: null,
          displayName: 'Jul 27 – Aug 2',
          number: 1_000_137,
        },
        '01ARZ3NDEKTSV4RRFFQ69G5FB1',
        'Ship the cadence overview',
      ),
      group(
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FA2',
          name: null,
          displayName: 'Aug 3 – Aug 9',
          number: 1_000_138,
        },
        '01ARZ3NDEKTSV4RRFFQ69G5FB2',
        'Close the loop',
      ),
    ]);

    expect(screen.getByRole('heading', { name: 'Jul 27 – Aug 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Aug 3 – Aug 9' })).toBeInTheDocument();
    // The bare noun was the old fallback for an unnamed cycle; it must not head either group.
    expect(screen.queryByRole('heading', { name: 'Cycle' })).not.toBeInTheDocument();
  });

  it('prefers the author’s name and never renders the auto-roll number', () => {
    const { container } = renderBoard([
      group(
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FA1',
          name: 'Launch week',
          displayName: 'Launch week',
          number: 1_000_137,
        },
        '01ARZ3NDEKTSV4RRFFQ69G5FB1',
        'Ship the cadence overview',
      ),
    ]);

    expect(screen.getByRole('heading', { name: 'Launch week' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(RAW_NUMBER_NAME);
    expect(container.textContent).not.toContain('1000137');
  });

  it('still labels the unscheduled group with the vocabulary noun', () => {
    renderBoard([group({ id: null }, '01ARZ3NDEKTSV4RRFFQ69G5FB3', 'Unscheduled work')]);

    expect(screen.getByRole('heading', { name: 'No cycle' })).toBeInTheDocument();
  });
});

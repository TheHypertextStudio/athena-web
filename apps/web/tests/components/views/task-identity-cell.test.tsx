/**
 * Behavior tests for the task-row hierarchy rails ({@link TaskHierarchyRails}).
 *
 * @remarks
 * Rails are drawn so they join across rows of any height: full-height lines carry an ancestor's or
 * a parent's rail through a row, and an elbow anchored at the row's center turns the parent's rail
 * into the row. These pin which rails a row draws and at which depth, since a wrong index would
 * leave a rail hanging or disconnected with nothing else failing.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TaskHierarchyRails } from '../../../src/components/views/task-identity-cell';
import {
  HIERARCHY_DEPTH_PX,
  HIERARCHY_ELBOW_RADIUS_PX,
  HIERARCHY_SLOT_CENTER_PX,
  type HierarchyPosition,
} from '../../../src/components/work-views/hierarchy-rails';

afterEach(cleanup);

/** The rail x for an entity icon at a one-based depth (the icon slot's center). */
function railX(depth: number): number {
  return (depth - 1) * HIERARCHY_DEPTH_PX + HIERARCHY_SLOT_CENTER_PX;
}

/** The own-subtasks stub: from the bottom of the icon's center line down past the row. */
function stub(depth: number): string {
  return `M ${String(railX(depth))} ${String(HIERARCHY_SLOT_CENTER_PX)} V 1000`;
}

/** A position with the facts each case varies. */
function position(overrides: Partial<HierarchyPosition>): HierarchyPosition {
  return {
    depth: 1,
    ancestorRailContinues: [],
    hasChildren: false,
    isLastSibling: true,
    posInSet: 1,
    setSize: 1,
    ...overrides,
  };
}

/** The x of every full-height line the rail layer draws. */
function throughRailXs(): readonly number[] {
  return Array.from(screen.getByTestId('hierarchy-rail').querySelectorAll('line')).map((line) =>
    Number(line.getAttribute('x1')),
  );
}

/** The `d` of every path (elbow or child stub) the rail layer draws. */
function paths(): readonly string[] {
  return Array.from(screen.getByTestId('hierarchy-rail').querySelectorAll('path')).map(
    (path) => path.getAttribute('d') ?? '',
  );
}

describe('TaskHierarchyRails', () => {
  it('draws nothing for a top-level task without subtasks', () => {
    render(<TaskHierarchyRails position={position({})} />);

    expect(screen.queryByTestId('hierarchy-rail')).toBeNull();
  });

  it('runs a parent rail down from its glyph into its subtasks', () => {
    render(<TaskHierarchyRails position={position({ hasChildren: true })} />);

    expect(throughRailXs()).toEqual([]);
    expect(paths()).toEqual([stub(1)]);
  });

  it('carries the parent rail through a subtask that has later siblings', () => {
    render(<TaskHierarchyRails position={position({ depth: 2, isLastSibling: false })} />);

    expect(throughRailXs()).toEqual([railX(1)]);
    const [elbow] = paths();
    // The elbow starts just above the row center and turns into this row's glyph.
    expect(elbow).toMatch(
      new RegExp(`^M ${String(railX(1))} -${String(HIERARCHY_ELBOW_RADIUS_PX)} Q`),
    );
    expect(elbow).toMatch(new RegExp(`H ${String(HIERARCHY_DEPTH_PX)}$`));
  });

  it('ends the parent rail at the elbow on the last subtask', () => {
    render(<TaskHierarchyRails position={position({ depth: 2, isLastSibling: true })} />);

    expect(throughRailXs()).toEqual([]);
    expect(paths()[0]).toMatch(new RegExp(`^M ${String(railX(1))} -1000 V -`));
  });

  it("keeps an ancestor's rail running through a deep row when that branch continues", () => {
    render(
      <TaskHierarchyRails
        position={position({
          depth: 3,
          ancestorRailContinues: [true],
          isLastSibling: false,
          hasChildren: true,
        })}
      />,
    );

    // The root's rail (depth 1) continues past this branch, and the parent's rail (depth 2) runs
    // on to this row's later siblings; this row also starts its own rail down to its subtasks.
    expect(throughRailXs()).toEqual([railX(1), railX(2)]);
    expect(paths()).toHaveLength(2);
    expect(paths()[1]).toBe(stub(3));
  });

  it('does not draw an ancestor rail whose branch has ended', () => {
    render(
      <TaskHierarchyRails
        position={position({ depth: 3, ancestorRailContinues: [false], isLastSibling: true })}
      />,
    );

    expect(throughRailXs()).toEqual([]);
  });
});

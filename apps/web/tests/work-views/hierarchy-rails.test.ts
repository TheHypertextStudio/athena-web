import { describe, expect, it } from 'vitest';

import {
  deriveHierarchyPositions,
  hierarchyRowAria,
} from '../../src/components/work-views/hierarchy-rails';

function node(key: string, parentKey: string | null) {
  return { key, parentKey };
}

describe('deriveHierarchyPositions', () => {
  it('derives continuation rails above the immediate-parent branch', () => {
    const positions = deriveHierarchyPositions([
      node('root-a', null),
      node('a-1', 'root-a'),
      node('a-1-i', 'a-1'),
      node('a-2', 'root-a'),
      node('a-2-i', 'a-2'),
      node('root-b', null),
      node('b-1', 'root-b'),
      node('b-1-i', 'b-1'),
    ]);

    expect(positions.get('a-1-i')).toMatchObject({
      ancestorRailContinues: [true],
      isLastSibling: true,
    });
    expect(positions.get('a-2')).toMatchObject({
      ancestorRailContinues: [],
      isLastSibling: true,
    });
    expect(positions.get('a-2-i')).toMatchObject({
      ancestorRailContinues: [false],
      isLastSibling: true,
    });
    expect(positions.get('b-1-i')).toMatchObject({
      ancestorRailContinues: [false],
      isLastSibling: true,
    });
  });

  it('continues an ancestor rail when the next path node has a later sibling', () => {
    const positions = deriveHierarchyPositions([
      node('root', null),
      node('first', 'root'),
      node('first-grandchild', 'first'),
      node('second', 'root'),
    ]);

    expect(positions.get('first')).toMatchObject({
      ancestorRailContinues: [],
      isLastSibling: false,
    });
    expect(positions.get('first-grandchild')).toMatchObject({
      ancestorRailContinues: [true],
      isLastSibling: true,
    });
  });

  it('does not continue a single-child ancestor rail because another root follows', () => {
    const positions = deriveHierarchyPositions([
      node('root-a', null),
      node('only-child', 'root-a'),
      node('grandchild', 'only-child'),
      node('root-b', null),
    ]);

    expect(positions.get('grandchild')).toMatchObject({
      ancestorRailContinues: [false],
      isLastSibling: true,
    });
  });

  it('treats a missing or collapsed parent as a visible root', () => {
    const positions = deriveHierarchyPositions([node('visible-child', 'collapsed-parent')]);

    expect(positions.get('visible-child')).toEqual({
      depth: 1,
      ancestorRailContinues: [],
      hasChildren: false,
      isLastSibling: true,
      posInSet: 1,
      setSize: 1,
    });
  });

  it('keys duplicate context paths independently', () => {
    const positions = deriveHierarchyPositions([
      node('active:root', null),
      node('active:child', 'active:root'),
      node('active:grandchild', 'active:child'),
      node('active:later', 'active:root'),
      node('planned:root', null),
      node('planned:child', 'planned:root'),
      node('planned:grandchild', 'planned:child'),
    ]);

    expect(positions.get('active:grandchild')?.ancestorRailContinues).toEqual([true]);
    expect(positions.get('planned:grandchild')?.ancestorRailContinues).toEqual([false]);
  });

  it('breaks a corrupt cycle at the first displayed membership', () => {
    const positions = deriveHierarchyPositions([
      node('cycle-a', 'cycle-b'),
      node('cycle-b', 'cycle-a'),
    ]);

    expect([...positions]).toEqual([
      [
        'cycle-a',
        {
          depth: 1,
          ancestorRailContinues: [],
          hasChildren: true,
          isLastSibling: true,
          posInSet: 1,
          setSize: 1,
        },
      ],
      [
        'cycle-b',
        {
          depth: 2,
          ancestorRailContinues: [],
          hasChildren: false,
          isLastSibling: true,
          posInSet: 1,
          setSize: 1,
        },
      ],
    ]);
  });
});

describe('hierarchyRowAria', () => {
  it('describes a row by level and sibling position, without claiming it can collapse', () => {
    const positions = deriveHierarchyPositions([
      node('parent', null),
      node('first', 'parent'),
      node('second', 'parent'),
    ]);

    expect(hierarchyRowAria(positions.get('parent'))).toEqual({
      level: 1,
      posInSet: 1,
      setSize: 1,
    });
    expect(hierarchyRowAria(positions.get('second'))).toEqual({
      level: 2,
      posInSet: 2,
      setSize: 2,
    });
    expect(hierarchyRowAria(undefined)).toEqual({ level: 1, posInSet: 1, setSize: 1 });
  });
});

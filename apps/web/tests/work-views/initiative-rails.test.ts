import { describe, expect, it } from 'vitest';

import { deriveInitiativeTreePositions } from '../../src/components/work-views/initiative-rails';

describe('deriveInitiativeTreePositions', () => {
  it('derives continuation rails above the immediate-parent branch', () => {
    const positions = deriveInitiativeTreePositions([
      { id: 'root-a', parentId: null },
      { id: 'a-1', parentId: 'root-a' },
      { id: 'a-1-i', parentId: 'a-1' },
      { id: 'a-2', parentId: 'root-a' },
      { id: 'a-2-i', parentId: 'a-2' },
      { id: 'root-b', parentId: null },
      { id: 'b-1', parentId: 'root-b' },
      { id: 'b-1-i', parentId: 'b-1' },
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
      ancestorRailContinues: [true],
      isLastSibling: true,
    });
    expect(positions.get('b-1-i')).toMatchObject({
      ancestorRailContinues: [false],
      isLastSibling: true,
    });
  });

  it('handles a last root with several children and a single-child chain', () => {
    const positions = deriveInitiativeTreePositions([
      { id: 'root', parentId: null },
      { id: 'first', parentId: 'root' },
      { id: 'second', parentId: 'root' },
      { id: 'only-grandchild', parentId: 'second' },
    ]);

    expect(positions.get('first')).toMatchObject({
      ancestorRailContinues: [],
      isLastSibling: false,
    });
    expect(positions.get('only-grandchild')).toMatchObject({
      ancestorRailContinues: [false],
      isLastSibling: true,
    });
  });

  it('treats a missing or collapsed parent as a visible root', () => {
    const positions = deriveInitiativeTreePositions([
      { id: 'visible-child', parentId: 'collapsed-parent' },
    ]);

    expect(positions.get('visible-child')).toEqual({
      depth: 1,
      ancestorRailContinues: [],
      hasChildren: false,
      isLastSibling: true,
    });
  });
});

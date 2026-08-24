import { describe, expect, it } from 'vitest';

import { deriveInitiativeTreePositions } from '../../src/components/work-views/initiative-rails';

describe('deriveInitiativeTreePositions', () => {
  it('keeps each ancestor rail only while that ancestor has a following sibling', () => {
    const positions = deriveInitiativeTreePositions([
      { id: 'root-a', parentId: null },
      { id: 'a-1', parentId: 'root-a' },
      { id: 'a-1-i', parentId: 'a-1' },
      { id: 'a-2', parentId: 'root-a' },
      { id: 'root-b', parentId: null },
      { id: 'b-1', parentId: 'root-b' },
      { id: 'b-1-i', parentId: 'b-1' },
    ]);

    expect(positions.get('a-1-i')).toMatchObject({
      ancestorHasFollowingSibling: [true, true],
      isLastSibling: true,
    });
    expect(positions.get('a-2')).toMatchObject({
      ancestorHasFollowingSibling: [true],
      isLastSibling: true,
    });
    expect(positions.get('b-1-i')).toMatchObject({
      ancestorHasFollowingSibling: [false, false],
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
      ancestorHasFollowingSibling: [false],
      isLastSibling: false,
    });
    expect(positions.get('only-grandchild')).toMatchObject({
      ancestorHasFollowingSibling: [false, false],
      isLastSibling: true,
    });
  });

  it('treats a missing or collapsed parent as a visible root', () => {
    const positions = deriveInitiativeTreePositions([
      { id: 'visible-child', parentId: 'collapsed-parent' },
    ]);

    expect(positions.get('visible-child')).toEqual({
      depth: 1,
      ancestorHasFollowingSibling: [],
      hasChildren: false,
      isLastSibling: true,
    });
  });
});

/** `@docket/web` — pure task hierarchy index tests. */
import { describe, expect, it } from 'vitest';

import { createTaskHierarchy } from '@/components/tasks/task-hierarchy-model';

interface FixtureTask {
  readonly id: string;
  readonly title: string;
  readonly parentTaskId: string | null;
  readonly projectId?: string;
}

const tasks: readonly FixtureTask[] = [
  { id: 'a', title: 'Alpha', parentTaskId: null, projectId: 'one' },
  { id: 'b', title: 'Bravo', parentTaskId: 'a', projectId: 'two' },
  { id: 'c', title: 'Charlie', parentTaskId: 'b' },
  { id: 'd', title: 'Delta', parentTaskId: 'c' },
  { id: 'e', title: 'Echo match', parentTaskId: 'd' },
  { id: 'f', title: 'Foxtrot', parentTaskId: 'a' },
  { id: 'g', title: 'Golf', parentTaskId: null },
  { id: 'orphan', title: 'Orphan', parentTaskId: 'missing' },
];

describe('task hierarchy model', () => {
  it('builds an orphan-safe forest with stable parent-before-child order and depth', () => {
    const hierarchy = createTaskHierarchy(tasks);

    expect(hierarchy.roots.map(({ id }) => id)).toEqual(['a', 'g', 'orphan']);
    expect(hierarchy.preorder.map(({ id }) => id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'orphan',
    ]);
    expect(hierarchy.depthOf('e')).toBe(4);
    expect(hierarchy.depthOf('orphan')).toBe(0);
  });

  it('returns ordered ancestor and descendant sets across five levels', () => {
    const hierarchy = createTaskHierarchy(tasks);

    expect(hierarchy.ancestorsOf('e')).toEqual(['a', 'b', 'c', 'd']);
    expect(hierarchy.descendantsOf('a')).toEqual(['b', 'c', 'd', 'e', 'f']);
    expect(hierarchy.descendantsOf('g')).toEqual([]);
  });

  it('reduces overlapping selections to their hierarchy roots', () => {
    const hierarchy = createTaskHierarchy(tasks);

    expect(hierarchy.selectedRoots(['e', 'a', 'g', 'c'])).toEqual(['a', 'g']);
    expect(hierarchy.selectedRoots(['e', 'c'])).toEqual(['c']);
  });

  it('excludes selected roots and their descendants from valid parent candidates', () => {
    const hierarchy = createTaskHierarchy(tasks);

    expect(hierarchy.validParentCandidates(['b']).map(({ id }) => id)).toEqual([
      'a',
      'f',
      'g',
      'orphan',
    ]);
    expect(hierarchy.validParentCandidates(['c', 'g']).map(({ id }) => id)).toEqual([
      'a',
      'b',
      'f',
      'orphan',
    ]);
  });

  it('describes continuation rails from ancestors with later siblings', () => {
    const hierarchy = createTaskHierarchy(tasks);

    expect(hierarchy.continuationDepths('e')).toEqual([1]);
    expect(hierarchy.continuationDepths('f')).toEqual([]);
    expect(hierarchy.continuationDepths('g')).toEqual([]);
  });

  it('retains the complete ancestor chain for filtered matches', () => {
    const hierarchy = createTaskHierarchy(tasks);

    expect(hierarchy.retainAncestors(['e'])).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(hierarchy.retainAncestors(['f', 'orphan'])).toEqual(['a', 'f', 'orphan']);
  });
});

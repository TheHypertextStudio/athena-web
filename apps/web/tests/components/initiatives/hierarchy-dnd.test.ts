import { describe, expect, it } from 'vitest';

import {
  planReparent,
  selfOrDescendantPredicate,
  type InitiativeDragObject,
} from '../../../src/components/initiatives/hierarchy-dnd';

/** A dragged-row fixture; a root row has no parent edge. */
function dragged(id: string, parent?: { id: string; linkId: string }): InitiativeDragObject {
  return {
    id,
    parentInitiativeId: parent?.id ?? null,
    parentLinkId: parent?.linkId ?? null,
  };
}

// Tree:  a → b → c ,  a → d ,  e (root)
const parentById = new Map<string, string | null>([
  ['a', null],
  ['b', 'a'],
  ['c', 'b'],
  ['d', 'a'],
  ['e', null],
]);
const isSelfOrDescendant = selfOrDescendantPredicate(parentById);

describe('planReparent', () => {
  it('creates an edge when a root initiative is dropped onto another', () => {
    expect(planReparent({ dragged: dragged('e'), targetId: 'a', isSelfOrDescendant })).toEqual({
      kind: 'create',
      parentInitiativeId: 'a',
      childInitiativeId: 'e',
    });
  });

  it('moves the existing edge when a nested initiative is dropped onto a new parent', () => {
    expect(
      planReparent({
        dragged: dragged('d', { id: 'a', linkId: 'link-ad' }),
        targetId: 'b',
        isSelfOrDescendant,
      }),
    ).toEqual({ kind: 'move', linkId: 'link-ad', parentInitiativeId: 'b' });
  });

  it('detaches to the root when dropped on the root zone', () => {
    expect(
      planReparent({
        dragged: dragged('b', { id: 'a', linkId: 'link-ab' }),
        targetId: null,
        isSelfOrDescendant,
      }),
    ).toEqual({ kind: 'detach', linkId: 'link-ab' });
  });

  it('is a no-op dropping a root row onto the root zone', () => {
    expect(planReparent({ dragged: dragged('e'), targetId: null, isSelfOrDescendant })).toEqual({
      kind: 'noop',
    });
  });

  it('is a no-op dropping onto itself or its current parent', () => {
    expect(
      planReparent({
        dragged: dragged('b', { id: 'a', linkId: 'link-ab' }),
        targetId: 'b',
        isSelfOrDescendant,
      }),
    ).toEqual({ kind: 'noop' });
    expect(
      planReparent({
        dragged: dragged('b', { id: 'a', linkId: 'link-ab' }),
        targetId: 'a',
        isSelfOrDescendant,
      }),
    ).toEqual({ kind: 'noop' });
  });

  it('refuses to nest an initiative under its own descendant (cycle)', () => {
    // a dropped onto c (a → b → c) would make a a child of its own grandchild.
    expect(planReparent({ dragged: dragged('a'), targetId: 'c', isSelfOrDescendant })).toEqual({
      kind: 'noop',
    });
  });
});

describe('selfOrDescendantPredicate', () => {
  it('recognizes descendants and rejects unrelated rows', () => {
    expect(isSelfOrDescendant('a', 'c')).toBe(true); // c is under a
    expect(isSelfOrDescendant('a', 'a')).toBe(true); // reflexive
    expect(isSelfOrDescendant('b', 'd')).toBe(false); // d is under a, not b
    expect(isSelfOrDescendant('c', 'a')).toBe(false); // a is above c
  });

  it('terminates on a malformed cycle instead of hanging', () => {
    const cyclic = new Map<string, string | null>([
      ['x', 'y'],
      ['y', 'x'],
    ]);
    const predicate = selfOrDescendantPredicate(cyclic);
    expect(predicate('z', 'x')).toBe(false);
  });
});

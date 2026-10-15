import { describe, expect, it } from 'vitest';
import { reflowBlueprint } from '../src/blueprints/dates';
import { context, existing, present } from './blueprint-fixtures';

function facts() {
  const [root, child] = existing();
  const original = present(child);
  const binding = present(original.dateBindings.dueDate);
  const parent = {
    ...original,
    id: 'readonly-parent',
    path: ['parent'],
    parentId: present(root).id,
    dates: { dueDate: '2026-10-09' },
    dateBindings: {
      dueDate: {
        ...binding,
        rule: {
          kind: 'anchor' as const,
          anchor: { kind: 'parent' as const },
          offset: { days: -1, unit: 'working' as const },
        },
        lastDerivedDate: '2026-10-09',
      },
    },
  };
  const affected = {
    ...original,
    id: 'affected',
    path: ['parent', 'child'],
    parentPath: parent.path,
    parentId: parent.id,
    dates: { dueDate: null },
    dateBindings: {
      dueDate: {
        ...binding,
        rule: {
          kind: 'anchor' as const,
          anchor: { kind: 'parent' as const },
          offset: { days: 1, unit: 'calendar' as const },
        },
        lastDerivedDate: null,
      },
    },
  };
  return { root: present(root), parent, affected };
}

describe('affected blueprint reflow selection', () => {
  it('uses the actual date of a read-only managed prerequisite without recomputing it', () => {
    const f = facts();
    const changes = reflowBlueprint({
      nodes: [f.root, f.parent, f.affected],
      context: context(),
      anchorChanges: [],
      affectedNodeIds: new Set([f.affected.id]),
    });
    expect(changes.map((change) => [change.id, change.value])).toEqual([
      [f.affected.id, '2026-10-10'],
    ]);
  });

  it('reads an explicit proposed anchor outside the affected descendant write set', () => {
    const f = facts();
    const changes = reflowBlueprint({
      nodes: [f.root, f.parent, f.affected],
      context: context(),
      anchorChanges: [
        { id: f.parent.id, path: f.parent.path, field: 'dueDate', value: '2026-10-20' },
      ],
      affectedNodeIds: new Set([f.affected.id]),
    });
    expect(changes.map((change) => [change.id, change.value])).toEqual([
      [f.affected.id, '2026-10-21'],
    ]);
  });

  it('counts affected descendants separately from read-only prerequisite facts', () => {
    const f = facts();
    const references = Array.from({ length: 501 }, (_, index) => ({
      ...f.parent,
      id: `reference-${index}`,
      path: [`reference_${index}`],
    }));
    const changes = reflowBlueprint({
      nodes: [f.root, f.parent, ...references, f.affected],
      context: context(),
      anchorChanges: [],
      affectedNodeIds: new Set([f.affected.id]),
    });
    expect(changes.map((change) => change.id)).toEqual([f.affected.id]);
  });

  it('refuses 501 affected descendants rather than truncating', () => {
    const f = facts();
    const children = Array.from({ length: 501 }, (_, index) => ({
      ...f.affected,
      id: `affected-${index}`,
      path: ['parent', `child_${index}`],
    }));
    expect(() =>
      reflowBlueprint({
        nodes: [f.root, f.parent, ...children],
        context: context(),
        anchorChanges: [],
        affectedNodeIds: new Set(children.map((child) => child.id)),
      }),
    ).toThrow(/500 affected descendants/);
  });

  it('refuses an unknown affected row instead of treating it as an authorized graph member', () => {
    const f = facts();
    expect(() =>
      reflowBlueprint({
        nodes: [f.root, f.parent, f.affected],
        context: context(),
        anchorChanges: [],
        affectedNodeIds: new Set(['foreign-row']),
      }),
    ).toThrow(/affected/);
  });

  it('writes no managed fields for an explicit empty affected selection', () => {
    const f = facts();
    expect(
      reflowBlueprint({
        nodes: [f.root, f.parent, f.affected],
        context: context(),
        anchorChanges: [],
        affectedNodeIds: new Set(),
      }),
    ).toEqual([]);
  });

  it('preserves complete-graph reflow when no affected selection is supplied', () => {
    const f = facts();
    expect(
      reflowBlueprint({
        nodes: [f.root, f.parent, f.affected],
        context: context(),
        anchorChanges: [],
      }).map((change) => [change.id, change.value]),
    ).toEqual([
      [f.parent.id, '2026-10-07'],
      [f.affected.id, '2026-10-08'],
    ]);
  });
});

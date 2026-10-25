import { describe, expect, it } from 'vitest';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { WorkScheduleForest } from '@docket/work/work-schedule-forest';
import { BlueprintError, type ExistingBlueprintNode } from '@docket/work/blueprints';
import type { NativeScheduleDateOwnership } from '@docket/db';
import {
  planScheduleBlueprint,
  compileScheduleCommand,
} from '../../src/lib/recurrence/schedule-compiler';
import {
  nativeDateOwnership,
  planNativeScheduleReflow,
  pinNativeScheduleDates,
} from '../../src/lib/recurrence/schedule-native-timing';
import { actor, input, team, ulid, context } from './work-schedule-fixture';
import { dateBinding, existingNode } from './existing-blueprint-node-fixture';

function fixture(dates: Record<string, string | null> = {}, stepOverrides: unknown[] = []) {
  const document = WorkScheduleDraft.parse({
    kind: 'schedule',
    revision: 1,
    template: { targetType: 'project', workTypeId: ulid(2), selection: { kind: 'latest' } },
    titlePattern: '{month} Dinner',
    timezone: 'America/Los_Angeles',
    root: { kind: 'project', fields: {}, dates, placement: {}, teamId: team },
    stepOverrides,
    optionalChoices: [],
  });
  const command = compileScheduleCommand({
    caller: { orgId: ulid(1), actorId: actor, roleId: null, capabilities: ['manage'] },
    seriesId: ulid(3),
    ownerProgramId: null,
    document,
    runDate: '2026-10-08',
  });
  const root = command.roots[0];
  if (!root) throw new Error('Missing root');
  const tree = planScheduleBlueprint(root.command, input()).tree;
  const nodes = tree.nodes.map((node, index): ExistingBlueprintNode => ({
    ...node,
    id: ulid(20 + index),
    parentId: index ? ulid(20) : null,
    state: 'unstarted',
    everStarted: false,
    cancellable: node.kind === 'task',
  }));
  const roots = [
    {
      key: 'root',
      kind: 'project' as const,
      id: ulid(20),
      resolvedManifest: tree.manifest,
      selectedWork: nodes.map((node) => ({
        path: [...node.path],
        kind: node.kind as 'project' | 'task',
        id: node.id,
      })),
    },
  ];
  return { document, nodes, roots };
}

describe('native occurrence date ownership', () => {
  it('caps affected writes while keeping more than500 read-only prerequisites unchanged', () => {
    const f = fixture();
    const root = f.nodes[0],
      child = f.nodes[1];
    if (!root || !child) throw new Error('Missing root or child');
    const prerequisites = Array.from({ length: 510 }, (_, index) => ({
      ...root,
      id: `readonly-${index}`,
    }));
    const result = planNativeScheduleReflow({
      nodes: [...f.nodes, ...prerequisites],
      ownership: nativeDateOwnership(f.document, f.roots, f.nodes),
      runDate: '2026-10-15',
      context: context(),
      affectedNodeIds: new Set([child.id]),
    });
    expect(result.dates.every((change) => change.id === child.id)).toBe(true);
    expect(result.ownership[0]?.lastDerivedDate).toBe('2026-10-08');
  });
  it('moves one event and its managed preparation without rewriting work titles', () => {
    const f = fixture();
    const ownership = nativeDateOwnership(f.document, f.roots, f.nodes);
    expect(ownership[0]).toEqual({
      rootKey: 'root',
      path: [],
      kind: 'project',
      id: ulid(20),
      field: 'targetDate',
      anchor: { kind: 'run' },
      manual: false,
      lastDerivedDate: '2026-10-08',
    });
    const result = planNativeScheduleReflow({
      ...f,
      ownership,
      runDate: '2026-10-15',
      context: context(),
    });
    expect(result.dates).toEqual(
      expect.arrayContaining([
        { id: ulid(20), field: 'targetDate', value: '2026-10-15' },
        { id: ulid(21), field: 'dueDate', value: '2026-09-24' },
      ]),
    );
    expect(f.nodes[0]?.fields).toMatchObject({ name: 'Root' });
  });
  it('retains explicit authored null and string anchors', () => {
    for (const targetDate of [null, '2026-10-11']) {
      const f = fixture({ targetDate });
      const ownership = nativeDateOwnership(f.document, f.roots, f.nodes);
      const result = planNativeScheduleReflow({
        ...f,
        ownership,
        runDate: '2026-10-15',
        context: context(),
      });
      expect(result.dates.some((entry) => entry.id === ulid(20))).toBe(false);
    }
  });
  it('retains a same-value explicit pin and an explicit null pin on later moves', () => {
    const f = fixture();
    const ownership = nativeDateOwnership(f.document, f.roots, f.nodes);
    const pinned = pinNativeScheduleDates(ownership, ulid(20), ['targetDate']);
    for (const targetDate of ['2026-10-08', null]) {
      const nodes = f.nodes.map((node) =>
        node.id === ulid(20) ? { ...node, dates: { targetDate } } : node,
      );
      const result = planNativeScheduleReflow({
        ...f,
        nodes,
        ownership: pinned,
        runDate: '2026-10-15',
        context: context(),
      });
      expect(result.dates.some((entry) => entry.id === ulid(20))).toBe(false);
    }
  });
  it('keeps deleted descendants absent and terminal roots unchanged', () => {
    const f = fixture();
    const ownership = nativeDateOwnership(f.document, f.roots, f.nodes);
    const nodes = f.nodes.slice(0, 1).map((node) => ({ ...node, state: 'completed' as const }));
    const result = planNativeScheduleReflow({
      ...f,
      nodes,
      ownership,
      runDate: '2026-10-15',
      context: context(),
    });
    expect(result.dates).toEqual([]);
  });
  it('reflows private forest timing even when the creation planner marked its derived field manual', () => {
    const f = fixture();
    const other = f.nodes.map((node, index) => ({
      ...node,
      id: ulid(30 + index),
      parentId: index ? ulid(30) : null,
    }));
    const nodes = [
      ...f.nodes.map((node) =>
        node.id === ulid(21) && node.dateBindings.dueDate
          ? {
              ...node,
              dates: { dueDate: '2026-09-18' },
              dateBindings: { dueDate: { ...node.dateBindings.dueDate, manual: true } },
            }
          : node,
      ),
      ...other,
    ];
    const firstRoot = f.roots[0];
    if (!firstRoot) throw new Error('Missing root');
    const roots = [
      { ...firstRoot, key: 'one' },
      {
        ...firstRoot,
        key: 'two',
        id: ulid(30),
        selectedWork: other.map((node) => ({
          path: [...node.path],
          kind: node.kind as 'project' | 'task',
          id: node.id,
        })),
      },
    ];
    const document = WorkScheduleForest.parse({
      kind: 'forest',
      revision: 1,
      state: 'published',
      roots: [
        { key: 'one', draft: f.document },
        { key: 'two', draft: f.document },
      ],
      dependencies: [],
      timing: [
        {
          target: { rootKey: 'one', path: ['child'] },
          prerequisite: { rootKey: 'two', path: ['child'] },
          offsetDays: 1,
        },
      ],
    });
    const ownership = nativeDateOwnership(document, roots, nodes);
    expect(ownership.find((entry) => entry.id === ulid(21))?.manual).toBe(false);
    const result = planNativeScheduleReflow({
      nodes,
      ownership,
      runDate: '2026-10-15',
      context: context(),
    });
    expect(result.dates).toContainEqual({ id: ulid(21), field: 'dueDate', value: '2026-09-25' });
  });
});

/** One-root forest whose child due date follows the root's actual target date. */
function childTimingForest(f: ReturnType<typeof fixture>, offsetDays = 2) {
  return WorkScheduleForest.parse({
    kind: 'forest',
    revision: 1,
    state: 'published',
    roots: [{ key: 'root', draft: f.document }],
    dependencies: [],
    timing: [
      {
        target: { rootKey: 'root', path: ['child'] },
        prerequisite: { rootKey: 'root', path: [] },
        offsetDays,
      },
    ],
  });
}

function blueprintCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof BlueprintError) return error.code;
    throw error;
  }
}

describe('native occurrence private timing registration', () => {
  it('pins a private timing target whose child date was authored in the saved draft', () => {
    const f = fixture({}, [{ kind: 'task', path: ['child'], dates: { dueDate: '2026-09-20' } }]);
    const ownership = nativeDateOwnership(childTimingForest(f), f.roots, f.nodes);
    expect(ownership.find((entry) => entry.id === ulid(21))).toMatchObject({
      field: 'dueDate',
      anchor: { kind: 'work', id: ulid(20), offsetDays: 2 },
      manual: true,
    });
  });

  it('keeps an override without dates managed', () => {
    const f = fixture({}, [{ kind: 'task', path: ['child'], fields: { title: 'Renamed' } }]);
    const ownership = nativeDateOwnership(childTimingForest(f), f.roots, f.nodes);
    expect(ownership.find((entry) => entry.id === ulid(21))?.manual).toBe(false);
  });

  it('refuses timing whose prerequisite has no accepted actual work', () => {
    const f = fixture();
    const roots = f.roots.map((root) => ({ ...root, selectedWork: [] }));
    expect(blueprintCode(() => nativeDateOwnership(childTimingForest(f), roots, f.nodes))).toBe(
      'blueprint_invalid',
    );
  });

  it('refuses registration when the accepted work row is gone', () => {
    const f = fixture();
    expect(blueprintCode(() => nativeDateOwnership(f.document, f.roots, []))).toBe(
      'blueprint_invalid',
    );
  });
});

describe('native occurrence private reflow refusals', () => {
  it('refuses to reflow more than 500 work items without an affected set', () => {
    const f = fixture();
    const root = f.nodes[0];
    if (!root) throw new Error('Missing root');
    const nodes = Array.from({ length: 501 }, (_, index) => ({ ...root, id: `copy-${index}` }));
    expect(
      blueprintCode(() =>
        planNativeScheduleReflow({
          nodes,
          ownership: nativeDateOwnership(f.document, f.roots, f.nodes),
          runDate: '2026-10-15',
          context: context(),
        }),
      ),
    ).toBe('blueprint_limit');
  });

  it('refuses an ownership entry with an unknown private policy', () => {
    const f = fixture();
    const [entry] = nativeDateOwnership(f.document, f.roots, f.nodes);
    if (!entry) throw new Error('Missing ownership');
    const unknown = {
      ...entry,
      anchor: { kind: 'later' },
    } as unknown as NativeScheduleDateOwnership;
    expect(
      blueprintCode(() =>
        planNativeScheduleReflow({
          nodes: f.nodes,
          ownership: [unknown],
          runDate: '2026-10-15',
          context: context(),
        }),
      ),
    ).toBe('blueprint_invalid');
  });

  it('refuses a private root anchor that loops through its own descendant', () => {
    const f = fixture();
    const [entry] = nativeDateOwnership(f.document, f.roots, f.nodes);
    if (!entry) throw new Error('Missing ownership');
    const looped: NativeScheduleDateOwnership = {
      ...entry,
      anchor: { kind: 'work', id: ulid(21), offsetDays: 1 },
    };
    expect(
      blueprintCode(() =>
        planNativeScheduleReflow({
          nodes: f.nodes,
          ownership: [looped],
          runDate: '2026-10-15',
          context: context(),
        }),
      ),
    ).toBe('blueprint_loop');
  });
});

describe('native occurrence private reflow outcomes', () => {
  it('treats a diverged private date as an explicit pin and skips departed work', () => {
    const f = fixture();
    const [entry] = nativeDateOwnership(f.document, f.roots, f.nodes);
    if (!entry) throw new Error('Missing ownership');
    const nodes = f.nodes.map((node) =>
      node.id === ulid(20) ? { ...node, dates: { targetDate: '2026-10-01' } } : node,
    );
    const result = planNativeScheduleReflow({
      nodes,
      ownership: [entry, { ...entry, id: 'departed' }],
      runDate: '2026-10-15',
      context: context(),
    });
    expect(result.dates.some((change) => change.id === ulid(20))).toBe(false);
    expect(result.ownership[0]?.manual).toBe(true);
    expect(result.ownership[1]?.manual).toBe(false);
  });

  it('fills an undated run-anchored root and leaves unmanaged siblings alone', () => {
    const f = fixture();
    const [entry] = nativeDateOwnership(f.document, f.roots, f.nodes);
    if (!entry) throw new Error('Missing ownership');
    const sibling: ExistingBlueprintNode = existingNode({
      id: 'sibling',
      kind: 'task',
      path: ['sibling'],
      parentId: ulid(20),
      dateBindings: { startDate: dateBinding({ kind: 'none' }) },
    });
    const nodes = [
      ...f.nodes.map((node) => (node.id === ulid(20) ? { ...node, dates: {} } : node)),
      sibling,
    ];
    const result = planNativeScheduleReflow({
      nodes,
      ownership: [{ ...entry, lastDerivedDate: null }],
      runDate: '2026-10-15',
      context: context(),
    });
    expect(result.dates).toContainEqual({ id: ulid(20), field: 'targetDate', value: '2026-10-15' });
    expect(result.dates.some((change) => change.id === 'sibling')).toBe(false);
    expect(result.ownership[0]?.lastDerivedDate).toBe('2026-10-15');
  });

  it('clears a work-anchored date whose source work has no date', () => {
    const f = fixture();
    const forest = childTimingForest(f);
    const ownership = nativeDateOwnership(forest, f.roots, f.nodes);
    const nodes = f.nodes.map((node) => (node.id === ulid(20) ? { ...node, dates: {} } : node));
    const result = planNativeScheduleReflow({
      nodes,
      ownership: ownership.filter((entry) => entry.id === ulid(21)),
      runDate: '2026-10-15',
      context: context(),
    });
    expect(result.dates).toContainEqual({ id: ulid(21), field: 'dueDate', value: null });
  });
});

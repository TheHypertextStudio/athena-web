import { describe, expect, it } from 'vitest';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { WorkScheduleForest } from '@docket/work/work-schedule-forest';
import type { ExistingBlueprintNode } from '@docket/work/blueprints';
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

function fixture(dates: Record<string, string | null> = {}) {
  const document = WorkScheduleDraft.parse({
    kind: 'schedule',
    revision: 1,
    template: { targetType: 'project', workTypeId: ulid(2), selection: { kind: 'latest' } },
    titlePattern: '{month} Dinner',
    timezone: 'America/Los_Angeles',
    root: { kind: 'project', fields: {}, dates, placement: {}, teamId: team },
    stepOverrides: [],
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

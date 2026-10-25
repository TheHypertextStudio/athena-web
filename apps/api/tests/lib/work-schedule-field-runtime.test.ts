import { expect, it } from 'vitest';
import { parseScheduleDocument } from '../../src/lib/recurrence/schedule-compiler';
import { compileScheduleTiming } from '../../src/lib/recurrence/schedule-timing';
import {
  context,
  input,
  ulid,
  graph,
  publication,
  resolution,
  step,
} from './work-schedule-fixture';
import { actual, document, planned } from './work-schedule-field-runtime-fixture';
import type { ExistingBlueprintNode } from '@docket/work/blueprints';
import {
  nativeDateOwnership,
  planNativeScheduleReflow,
  pinNativeScheduleDates,
} from '../../src/lib/recurrence/schedule-native-timing';
import { affectedBlueprintNodes } from '../../src/lib/work-template-blueprints/reflow-selection';
import { ConflictError } from '../../src/error';

it('parses a bound private v2 forest while keeping actual-completion timing distinct from creation containment', () => {
  expect(parseScheduleDocument(document())).toMatchObject({
    kind: 'forest',
    revision: 2,
    creationMode: 'when_ready',
    timing: { kind: 'field_timing' },
  });
});

it('renders every authored legacy root and child title while preserving blank document replacement', () => {
  const { command, plans } = planned();
  expect(command.roots[0]?.command.body).toMatchObject({ name: '10 October {unknown}' });
  expect(plans[0]?.tree.nodes[1]?.fields).toMatchObject({
    title: 'Child 10 2026 {unknown}',
    description: '',
  });
});

it('eagerly keeps the full selected tree with a waiting Project start and an explicitly absent target date', () => {
  const { command, plans } = planned();
  const result = compileScheduleTiming(command, plans);
  const root = result.roots[0];
  if (!root) throw new Error('Missing root');
  const tree = plans[0]?.replan(root.command);
  expect(tree?.nodes).toHaveLength(2);
  expect(tree?.nodes[0]?.dates).toMatchObject({ startDate: null, targetDate: null });
  expect(tree?.nodes[1]?.dates.dueDate).toBeNull();
});

it('suppresses absent native defaults before validating independent literal-offset date windows', () => {
  const { command, plans } = planned({
    timing: {
      kind: 'field_timing',
      revision: 2,
      rules: [
        {
          target: { rootKey: 'root', path: [], field: 'startDate' },
          source: { kind: 'run' },
          offset: { days: 3, unit: 'calendar' },
        },
      ],
    },
  });
  const result = compileScheduleTiming(command, plans);
  const root = result.roots[0];
  if (!root) throw new Error('Missing root');
  expect(plans[0]?.replan(root.command).nodes[0]?.dates).toMatchObject({
    startDate: '2026-10-11',
    targetDate: null,
  });
});

it('registers exact actual completion ownership independently from planned dates and absence', () => {
  const f = actual();
  expect(nativeDateOwnership(f.document, f.roots, f.nodes)).toEqual([
    {
      rootKey: 'root',
      path: [],
      kind: 'project',
      id: ulid(20),
      field: 'startDate',
      anchor: {
        kind: 'field',
        source: { kind: 'after_completion', works: [{ kind: 'task', id: ulid(21) }] },
        offset: { days: 2, unit: 'calendar' },
      },
      manual: false,
      lastDerivedDate: null,
    },
    {
      rootKey: 'root',
      path: [],
      kind: 'project',
      id: ulid(20),
      field: 'targetDate',
      anchor: { kind: 'absent' },
      manual: false,
      lastDerivedDate: null,
    },
  ]);
});

it('reflows actual completion in the saved timezone and never substitutes a planned due date', () => {
  const f = actual();
  const ownership = nativeDateOwnership(f.document, f.roots, f.nodes);
  const result = planNativeScheduleReflow({
    ...f,
    ownership,
    runDate: '2026-10-08',
    context: context({
      timezone: 'America/Los_Angeles',
      completions: [
        {
          id: ulid(21),
          path: ['child'],
          state: 'completed',
          completedAt: '2026-10-10T06:30:00.000Z',
        },
      ],
    }),
  });
  expect(result.dates).toContainEqual({ id: ulid(20), field: 'startDate', value: '2026-10-11' });
  expect(result.dates.some((change) => change.field === 'targetDate')).toBe(false);
});

it('does not request writes to completion-only consumers when a prerequisite planned date changes', () => {
  const f = actual(),
    source = f.nodes[1];
  if (!source) throw new Error('Missing source');
  const binding = source.dateBindings.dueDate;
  if (!binding) throw new Error('Missing source binding');
  const consumer: ExistingBlueprintNode = {
    ...source,
    id: ulid(22),
    parentId: null,
    dateReferences: {
      dueDate: { parentId: null, milestoneIds: {}, completionIds: { child: source.id } },
    },
    dateBindings: {
      dueDate: {
        ...binding,
        rule: {
          kind: 'after_completion',
          stepKeys: ['child'],
          offset: { days: 1, unit: 'calendar' },
        },
        manual: false,
        lastDerivedDate: null,
      },
    },
  };
  expect(
    affectedBlueprintNodes([...f.nodes, consumer], new Set([source.id]), new Set([source.id]), {
      dates: new Map([[source.id, new Set(['dueDate' as const])]]),
      completions: new Set(),
    }),
  ).toEqual(new Set());
  expect(
    affectedBlueprintNodes([...f.nodes, consumer], new Set([source.id]), new Set(), {
      dates: new Map(),
      completions: new Set([source.id]),
    }),
  ).toEqual(new Set([consumer.id]));
});

it('compiles independent Task start/due and Milestone target fields through the same selected tree', () => {
  const base = publication(9, 'task');
  const resolved = input({
    graph: graph(
      publication(2, 'project', [
        step('checkpoint', 'milestone', { fields: { name: 'Checkpoint' } }),
        step('child'),
      ]),
      [base],
      [resolution(['child'], base)],
    ),
  });
  const rules = [
    {
      target: { rootKey: 'root', path: [], field: 'startDate' },
      source: { kind: 'run' },
      offset: { days: 0, unit: 'calendar' },
    },
    {
      target: { rootKey: 'root', path: ['child'], field: 'startDate' },
      source: { kind: 'run' },
      offset: { days: -2, unit: 'calendar' },
    },
    {
      target: { rootKey: 'root', path: ['child'], field: 'dueDate' },
      source: { kind: 'run' },
      offset: { days: 5, unit: 'calendar' },
    },
    {
      target: { rootKey: 'root', path: ['checkpoint'], field: 'targetDate' },
      source: { kind: 'run' },
      offset: { days: 2, unit: 'working' },
    },
  ];
  const { command, plans } = planned(
    {
      timing: { kind: 'field_timing', revision: 2, rules },
      titles: [
        { target: { rootKey: 'root', path: [] }, kind: 'project', pattern: 'Root {month}' },
        { target: { rootKey: 'root', path: ['child'] }, kind: 'task', pattern: 'Task {date}' },
        {
          target: { rootKey: 'root', path: ['checkpoint'] },
          kind: 'milestone',
          pattern: 'Checkpoint {monthName} {unknown}',
        },
      ],
    },
    resolved,
  );
  const result = compileScheduleTiming(command, plans),
    root = result.roots[0];
  if (!root) throw new Error('Missing root');
  const tree = plans[0]?.replan(root.command);
  expect(tree?.nodes.find((node) => node.path.join('/') === 'child')?.dates).toMatchObject({
    startDate: '2026-10-06',
    dueDate: '2026-10-13',
  });
  expect(tree?.nodes.find((node) => node.path.join('/') === 'checkpoint')).toMatchObject({
    dates: { targetDate: '2026-10-12' },
    fields: { name: 'Checkpoint October {unknown}' },
  });
});

it('clears a still-managed completion date on reopen while preserving explicit null and terminal exclusions', () => {
  const f = actual(),
    ownership = nativeDateOwnership(f.document, f.roots, f.nodes);
  const completed = context({
    timezone: 'America/Los_Angeles',
    completions: [
      {
        id: ulid(21),
        path: ['child'],
        state: 'completed',
        completedAt: '2026-10-10T06:30:00.000Z',
      },
    ],
  });
  const applied = planNativeScheduleReflow({
    ...f,
    ownership,
    runDate: '2026-10-08',
    context: completed,
  });
  const nodes = f.nodes.map((node) =>
    node.id === ulid(20) ? { ...node, dates: { ...node.dates, startDate: '2026-10-11' } } : node,
  );
  const reopened = planNativeScheduleReflow({
    nodes,
    ownership: applied.ownership,
    runDate: '2026-10-08',
    context: context({ timezone: 'America/Los_Angeles' }),
  });
  expect(reopened.dates).toContainEqual({ id: ulid(20), field: 'startDate', value: null });
  const pinned = planNativeScheduleReflow({
    ...f,
    ownership: pinNativeScheduleDates(ownership, ulid(20), ['startDate']),
    runDate: '2026-10-08',
    context: completed,
  });
  expect(pinned.dates).toEqual([]);
  const terminal = planNativeScheduleReflow({
    ...f,
    nodes: f.nodes.map((node) =>
      node.id === ulid(20) ? { ...node, state: 'completed' as const } : node,
    ),
    ownership,
    runDate: '2026-10-08',
    context: completed,
  });
  expect(terminal.dates).toEqual([]);
});

it('keeps more than500 read-only prerequisites outside the affected-write limit and rejects a501st write', () => {
  const f = actual();
  const root = f.nodes[0];
  if (!root) throw new Error('Missing root');
  const nodes = [
    ...f.nodes,
    ...Array.from({ length: 510 }, (_, index) => ({ ...root, id: `readonly-${index}` })),
  ];
  const request = {
    nodes,
    ownership: nativeDateOwnership(f.document, f.roots, f.nodes),
    runDate: '2026-10-08',
    context: context({
      timezone: 'America/Los_Angeles',
      completions: [
        {
          id: ulid(21),
          path: ['child'],
          state: 'completed' as const,
          completedAt: '2026-10-10T06:30:00.000Z',
        },
      ],
    }),
    affectedNodeIds: new Set([root.id]),
  };
  expect(planNativeScheduleReflow(request).dates).toEqual([
    { id: root.id, field: 'startDate', value: '2026-10-11' },
  ]);
  expect(() =>
    planNativeScheduleReflow({
      ...request,
      affectedNodeIds: new Set(nodes.slice(0, 501).map((node) => node.id)),
    }),
  ).toThrow('500 affected');
});

it('returns an owned invalid-title failure instead of truncating oversized or blank authored work', () => {
  for (const pattern of ['', '{monthName}'.repeat(1000)])
    expect(() =>
      planned({ titles: [{ target: { rootKey: 'root', path: [] }, kind: 'project', pattern }] }),
    ).toThrow(ConflictError);
});

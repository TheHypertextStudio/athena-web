import { expect, it } from 'vitest';
import { BlueprintError } from '@docket/work/blueprints';
import type { BlueprintOccurrenceRoot } from '@docket/db';
import { ConflictError } from '../../src/error';
import { compileScheduleFieldTiming } from '../../src/lib/recurrence/schedule-field-timing-compile';
import {
  nativeFieldDateOwnership,
  nativeScheduleAnchorSources,
} from '../../src/lib/recurrence/schedule-native-field-ownership';
import type { ScheduleTimingPlan } from '../../src/lib/recurrence/schedule-timing';
import type { ScheduleDocument } from '../../src/lib/recurrence/schedule-compiler';
import type { WorkScheduleForestV2 } from '@docket/work/work-schedule-forest-v2';
import type { OrdinaryWorkCommand } from '../../src/lib/work-creation/types';
import { actual, planned } from './work-schedule-field-runtime-fixture';
import { team, ulid } from './work-schedule-fixture';

function v2(document: ScheduleDocument): WorkScheduleForestV2 {
  if (document.kind !== 'forest' || document.revision !== 2)
    throw new Error('Expected a v2 field-timing forest');
  return document;
}
function rootsWith(dates: Record<string, string | null>, stepOverrides: unknown[]): unknown[] {
  return [
    {
      key: 'root',
      draft: {
        kind: 'schedule',
        revision: 1,
        template: { targetType: 'project', workTypeId: ulid(2), selection: { kind: 'latest' } },
        titlePattern: 'Dinner',
        timezone: 'America/Los_Angeles',
        root: { kind: 'project', fields: {}, placement: {}, dates, teamId: team },
        stepOverrides,
        optionalChoices: [],
      },
    },
  ];
}
const pinnedRoots = {
  roots: rootsWith({ startDate: '2026-10-20', targetDate: '2026-11-01' }, [
    { kind: 'task', path: ['child'], dates: { dueDate: null } },
  ]),
};
function withoutScheduleContext(command: OrdinaryWorkCommand): OrdinaryWorkCommand {
  const { scheduleContext, ...invocation } = command.invocation;
  expect(scheduleContext).toBeDefined();
  return { ...command, invocation };
}
/** Duplicate the single planned root under a second key so multi-root edges can be exercised. */
function twoRoots(transform: (command: OrdinaryWorkCommand) => OrdinaryWorkCommand) {
  const { command, plans } = planned();
  const [first] = command.roots;
  if (!first) throw new Error('Missing root');
  return {
    command: {
      ...command,
      roots: [first, { key: 'other', command: transform(first.command) }],
    },
    plans,
  };
}

it('keeps authored root and child pins, including an explicitly absent field pin, over private rules', () => {
  const { command, plans } = planned(pinnedRoots);
  const root = compileScheduleFieldTiming(command, plans).roots[0];
  if (!root) throw new Error('Missing root');
  const tree = plans[0]?.replan(root.command);
  expect(tree?.nodes[0]?.dates).toMatchObject({
    startDate: '2026-10-20',
    targetDate: '2026-11-01',
  });
  expect(tree?.nodes[1]?.dates.dueDate).toBeNull();
});

it('returns a command without private field timing unchanged', () => {
  const { command, plans } = planned();
  const { scheduleFieldTiming, ...legacy } = command;
  expect(scheduleFieldTiming).toBeDefined();
  expect(compileScheduleFieldTiming(legacy, plans)).toBe(legacy);
});

it('refuses private field timing without the actual planning calendar', () => {
  const { command, plans } = planned();
  const uncalendared: ScheduleTimingPlan[] = plans.map(({ tree, replan }) => ({ tree, replan }));
  expect(() => compileScheduleFieldTiming(command, uncalendared)).toThrow(ConflictError);
});

it('refuses selected work that is not a Task, Project or Milestone', () => {
  const { command, plans } = planned();
  const retyped = plans.map((plan) => ({
    ...plan,
    tree: {
      ...plan.tree,
      nodes: plan.tree.nodes.map((node) => ({ ...node, kind: 'initiative' as const })),
    },
  }));
  expect(() => compileScheduleFieldTiming(command, retyped)).toThrow(ConflictError);
});

it('refuses a secondary root that lost its installed schedule context', () => {
  const { command, plans } = twoRoots(withoutScheduleContext);
  const [plan] = plans;
  if (!plan) throw new Error('Missing plan');
  expect(() => compileScheduleFieldTiming(command, [plan, plan])).toThrow(ConflictError);
});

it('refuses a root whose planning context is missing', () => {
  const { command, plans } = twoRoots((root) => root);
  expect(() => compileScheduleFieldTiming(command, plans)).toThrow(ConflictError);
});

it('refuses private field timing for a root that is neither a Task nor a Project', () => {
  const { command, plans } = planned();
  const milestone = {
    ...command,
    roots: command.roots.map((root) => ({
      ...root,
      command: { ...root.command, kind: 'milestone' } as unknown as OrdinaryWorkCommand,
    })),
  };
  expect(() => compileScheduleFieldTiming(milestone, plans)).toThrow(ConflictError);
});

it('registers work-date anchors for child targets from their exact accepted source', () => {
  const f = actual({
    timing: {
      kind: 'field_timing',
      revision: 2,
      rules: [
        {
          target: { rootKey: 'root', path: ['child'], field: 'dueDate' },
          source: { kind: 'work_date', work: { rootKey: 'root', path: [] }, field: 'targetDate' },
          offset: { days: -3, unit: 'calendar' },
        },
      ],
    },
    absentFields: [],
  });
  expect(nativeFieldDateOwnership(v2(f.document), f.roots, f.nodes)).toEqual([
    expect.objectContaining({
      path: ['child'],
      kind: 'task',
      id: ulid(21),
      field: 'dueDate',
      anchor: {
        kind: 'field',
        source: { kind: 'work_date', work: { kind: 'project', id: ulid(20) }, field: 'targetDate' },
        offset: { days: -3, unit: 'calendar' },
      },
      manual: false,
    }),
  ]);
});

it('marks a field authored on the saved draft as manual', () => {
  const f = actual(pinnedRoots);
  const ownership = nativeFieldDateOwnership(v2(f.document), f.roots, f.nodes);
  expect(ownership.map(({ field, manual }) => ({ field, manual }))).toEqual([
    { field: 'startDate', manual: true },
    { field: 'targetDate', manual: true },
  ]);
});

it('refuses date ownership without the exact accepted physical work', () => {
  const f = actual();
  expect(() => nativeFieldDateOwnership(v2(f.document), [], f.nodes)).toThrow(BlueprintError);
  expect(() => nativeFieldDateOwnership(v2(f.document), f.roots, [])).toThrow(BlueprintError);
  const initiativeChild = f.roots.map((root) => ({
    ...root,
    selectedWork: root.selectedWork.map((work) =>
      work.path.length ? { ...work, kind: 'initiative' } : work,
    ),
  })) as unknown as BlueprintOccurrenceRoot[];
  expect(() => nativeFieldDateOwnership(v2(f.document), initiativeChild, f.nodes)).toThrow(
    BlueprintError,
  );
});

it('lists only actual prerequisite identities for each saved anchor shape', () => {
  const offset = { days: 0, unit: 'calendar' as const };
  const task = { kind: 'task' as const, id: 'task-id' };
  expect(nativeScheduleAnchorSources({ kind: 'work', id: 'legacy', offsetDays: 1 })).toEqual([
    'legacy',
  ]);
  expect(nativeScheduleAnchorSources({ kind: 'absent' })).toEqual([]);
  expect(nativeScheduleAnchorSources({ kind: 'field', source: { kind: 'run' }, offset })).toEqual(
    [],
  );
  expect(
    nativeScheduleAnchorSources({
      kind: 'field',
      source: { kind: 'work_date', work: task, field: 'dueDate' },
      offset,
    }),
  ).toEqual(['task-id']);
  expect(
    nativeScheduleAnchorSources({
      kind: 'field',
      source: { kind: 'after_completion', works: [task, { kind: 'milestone', id: 'm' }] },
      offset,
    }),
  ).toEqual(['task-id', 'm']);
});

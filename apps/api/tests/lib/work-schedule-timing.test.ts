import { describe, expect, it } from 'vitest';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { WorkScheduleForest } from '@docket/work/work-schedule-forest';
import {
  compileScheduleCommand,
  planScheduleBlueprint,
} from '../../src/lib/recurrence/schedule-compiler';
import { compileScheduleTiming } from '../../src/lib/recurrence/schedule-timing';
import type {
  OrdinaryWorkCommand,
  WorkCreationBatchCommand,
} from '../../src/lib/work-creation/types';
import type { ScheduleTimingPlan } from '../../src/lib/recurrence/schedule-timing';
import type { PlannedWorkNode, PlannedWorkTree } from '@docket/work/blueprints';
import { addCalendarDays } from '@docket/work/calendar-date';
import { ConflictError } from '../../src/error';
import { actor, input, team, ulid } from './work-schedule-fixture';

function draft(dates: Record<string, string | null> = {}) {
  return WorkScheduleDraft.parse({
    kind: 'schedule',
    revision: 1,
    template: { targetType: 'project', workTypeId: ulid(2), selection: { kind: 'latest' } },
    titlePattern: '{month} Dinner',
    timezone: 'UTC',
    root: { kind: 'project', fields: {}, dates, placement: {}, teamId: team },
    stepOverrides: [],
    optionalChoices: [],
  });
}
const ref = (rootKey: string, path: string[] = []) => ({ rootKey, path });
function forest(
  timing: WorkCreationBatchCommand['scheduleTiming'],
  dates: Record<string, string | null> = {},
  sourceDates: Record<string, string | null> = {},
) {
  const document = WorkScheduleForest.parse({
    kind: 'forest',
    revision: 1,
    state: 'published',
    roots: [
      { key: 'one', draft: draft(dates) },
      { key: 'two', draft: draft(sourceDates) },
    ],
    timing,
    dependencies: [],
  });
  const command = compileScheduleCommand({
    caller: { orgId: ulid(1), actorId: actor, roleId: null, capabilities: ['manage'] },
    seriesId: ulid(3),
    ownerProgramId: null,
    document,
    runDate: '2026-10-08',
  });
  const plans = command.roots.map((root) => ({
    tree: planScheduleBlueprint(root.command, input()).tree,
    replan: (next: typeof root.command) => planScheduleBlueprint(next, input()).tree,
  }));
  return { command, plans };
}
describe('private qualified forest timing', () => {
  it('uses qualified descendant dates and reflows the target root children with the ordinary planner', () => {
    const { command, plans } = forest([
      { target: ref('one'), prerequisite: ref('two', ['child']), offsetDays: 1 },
    ]);
    const compiled = compileScheduleTiming(command, plans);
    expect(compiled.roots[0]?.command.body).toMatchObject({ targetDate: '2026-09-18' });
    const root = compiled.roots[0];
    if (!root) throw new Error('Missing checked root');
    const tree = plans[0]?.replan(root.command);
    expect(tree?.nodes[0]?.dates.targetDate).toBe('2026-09-18');
    expect(tree?.nodes[1]?.dates.dueDate).toBe('2026-08-28');
    expect(compiled.roots).toHaveLength(2);
  });
  it('preserves explicit null and hand-set root dates over private derived timing', () => {
    for (const targetDate of [null, '2026-10-10']) {
      const { command, plans } = forest(
        [{ target: ref('one'), prerequisite: ref('two'), offsetDays: -7 }],
        { targetDate },
      );
      const compiled = compileScheduleTiming(command, plans);
      const root = compiled.roots[0];
      if (!root) throw new Error('Missing checked root');
      expect(plans[0]?.replan(root.command).nodes[0]?.dates.targetDate).toBe(targetDate);
    }
  });
  it('rejects a private timing cycle through implicit parent date rules', () => {
    const { command, plans } = forest([
      { target: ref('one'), prerequisite: ref('one', ['child']), offsetDays: 1 },
    ]);
    expect(() => compileScheduleTiming(command, plans)).toThrow('cannot form a cycle');
  });
  it('rejects missing or unselected paths and ambiguous multiple anchors', () => {
    for (const timing of [
      [{ target: ref('one', ['missing']), prerequisite: ref('two'), offsetDays: 0 }],
      [
        { target: ref('one'), prerequisite: ref('two'), offsetDays: 0 },
        { target: ref('one'), prerequisite: ref('two', ['child']), offsetDays: 0 },
      ],
    ]) {
      const { command, plans } = forest(timing);
      expect(() => compileScheduleTiming(command, plans)).toThrow();
    }
  });
});

function taskDraft() {
  return WorkScheduleDraft.parse({
    kind: 'schedule',
    revision: 1,
    template: { targetType: 'task', workTypeId: ulid(4), selection: { kind: 'latest' } },
    titlePattern: '{month} Prep',
    timezone: 'UTC',
    root: { kind: 'task', fields: {}, dates: {}, placement: {}, teamId: team },
    stepOverrides: [],
    optionalChoices: [],
  });
}
function fixedPlan(tree: PlannedWorkTree): ScheduleTimingPlan {
  return { tree, replan: () => tree };
}
function retyped(tree: PlannedWorkTree, kind: PlannedWorkNode['kind']): PlannedWorkTree {
  const [root] = tree.nodes;
  if (!root) throw new Error('Missing planned root');
  return { ...tree, nodes: [{ ...root, kind, dates: {} }], dependencies: [] };
}
/** Task root `task` anchored to the Project root `two`, with a fixed single-node Task plan. */
function taskForest(sourceDates: Record<string, string | null> = {}) {
  const document = WorkScheduleForest.parse({
    kind: 'forest',
    revision: 1,
    state: 'published',
    roots: [
      { key: 'task', draft: taskDraft() },
      { key: 'two', draft: draft(sourceDates) },
    ],
    timing: [{ target: ref('task'), prerequisite: ref('two'), offsetDays: 2 }],
    dependencies: [],
  });
  const command = compileScheduleCommand({
    caller: { orgId: ulid(1), actorId: actor, roleId: null, capabilities: ['manage'] },
    seriesId: ulid(3),
    ownerProgramId: null,
    document,
    runDate: '2026-10-08',
  });
  const source = command.roots[1]?.command;
  if (!source) throw new Error('Missing source root');
  const sourceTree = planScheduleBlueprint(source, input()).tree;
  const plans: ScheduleTimingPlan[] = [
    fixedPlan(retyped(sourceTree, 'task')),
    {
      tree: sourceTree,
      replan: (next: OrdinaryWorkCommand) => planScheduleBlueprint(next, input()).tree,
    },
  ];
  return { command, plans, sourceTree };
}
function withoutScheduleContext(command: OrdinaryWorkCommand): OrdinaryWorkCommand {
  const { scheduleContext, ...invocation } = command.invocation;
  expect(scheduleContext).toBeDefined();
  return { ...command, invocation };
}
describe('private forest timing edges', () => {
  it('derives a Task root due date from a Project prerequisite target date', () => {
    const { command, plans, sourceTree } = taskForest();
    const sourceDate = sourceTree.nodes[0]?.dates.targetDate;
    if (!sourceDate) throw new Error('Missing planned source date');
    const compiled = compileScheduleTiming(command, plans);
    const root = compiled.roots[0]?.command;
    expect(root?.kind).toBe('task');
    expect(root?.body).toMatchObject({ dueDate: addCalendarDays(sourceDate, 2) });
    expect(compiled.scheduleTiming).toEqual([]);
  });
  it('records a waiting null override when the prerequisite has no date', () => {
    const { command, plans } = taskForest({ targetDate: null });
    const root = compileScheduleTiming(command, plans).roots[0]?.command;
    expect(root?.body).not.toHaveProperty('dueDate', expect.any(String));
    expect(root?.invocation.scheduleContext?.timingOverrides).toEqual([
      { path: [], dates: { dueDate: null } },
    ]);
  });
  it('leaves a Project target unset when its prerequisite date is explicitly empty', () => {
    const { command, plans } = forest(
      [{ target: ref('one'), prerequisite: ref('two'), offsetDays: 3 }],
      {},
      { targetDate: null },
    );
    const root = compileScheduleTiming(command, plans).roots[0]?.command;
    expect(root?.body).not.toHaveProperty('targetDate', expect.any(String));
    expect(root?.invocation.scheduleContext?.timingOverrides).toEqual([
      { path: [], dates: { targetDate: null } },
    ]);
  });
  it('returns untouched roots when a root has no plan or the command carries no timing', () => {
    const { command, plans } = forest([]);
    const partial = compileScheduleTiming(command, plans.slice(0, 1));
    expect(partial.roots).toEqual(command.roots);
    expect(partial.scheduleTiming).toEqual([]);
    const { scheduleTiming, ...legacy } = command;
    expect(scheduleTiming).toEqual([]);
    expect(compileScheduleTiming(legacy, plans).roots).toEqual(command.roots);
  });
  it('treats a child without an authored parent date rule as independent of its parent', () => {
    const { command, plans } = forest([
      { target: ref('one'), prerequisite: ref('one', ['child']), offsetDays: 1 },
    ]);
    const [plan] = plans;
    if (!plan) throw new Error('Missing plan');
    const tree = {
      ...plan.tree,
      nodes: plan.tree.nodes.map((node) => ({ ...node, step: null, prerequisitePaths: [] })),
    };
    const childDue = tree.nodes[1]?.dates.dueDate;
    if (!childDue) throw new Error('Missing child due date');
    const compiled = compileScheduleTiming(command, [{ ...plan, tree }, ...plans.slice(1)]);
    expect(compiled.roots[0]?.command.body).toMatchObject({
      targetDate: addCalendarDays(childDue, 1),
    });
  });
  it('refuses a prerequisite whose planned kind carries no schedulable date', () => {
    const { command, plans } = forest([
      { target: ref('one'), prerequisite: ref('two'), offsetDays: 0 },
    ]);
    const [first, second] = plans;
    if (!first || !second) throw new Error('Missing plans');
    expect(() =>
      compileScheduleTiming(command, [first, fixedPlan(retyped(second.tree, 'initiative'))]),
    ).toThrow(ConflictError);
  });
  it('refuses to apply timing to a root without its canonical schedule context', () => {
    const { command, plans } = forest([
      { target: ref('one'), prerequisite: ref('two'), offsetDays: 0 },
    ]);
    const bare = {
      ...command,
      roots: command.roots.map((root, index) =>
        index === 0 ? { ...root, command: withoutScheduleContext(root.command) } : root,
      ),
    };
    expect(() => compileScheduleTiming(bare, plans)).toThrow(ConflictError);
  });
  it('refuses root timing for a root that is neither a Task nor a Project', () => {
    const { command, plans } = forest([
      { target: ref('one'), prerequisite: ref('two'), offsetDays: 0 },
    ]);
    const milestone = {
      ...command,
      roots: command.roots.map((root, index) =>
        index === 0
          ? {
              ...root,
              command: { ...root.command, kind: 'milestone' } as unknown as OrdinaryWorkCommand,
            }
          : root,
      ),
    };
    expect(() => compileScheduleTiming(milestone, plans)).toThrow(ConflictError);
  });
});

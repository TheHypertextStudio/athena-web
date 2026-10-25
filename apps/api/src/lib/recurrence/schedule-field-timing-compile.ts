import type {
  BlueprintDateField,
  BlueprintNodeOverride,
  PlannedWorkTree,
} from '@docket/work/blueprints';
import { deriveScheduleFieldTiming } from '@docket/work/schedule-field-timing';
import type { WorkScheduleFieldTarget } from '@docket/work/work-schedule-field-timing';
import type { WorkScheduleDraft } from '@docket/work/work-schedule';
import {
  validateScheduleFieldTiming,
  type ScheduleTimingSelection,
  type ScheduleTimingPin,
  type ScheduleTimingDates,
} from '@docket/work/schedule-field-timing';
import type { OrdinaryWorkCommand, WorkCreationBatchCommand } from '../work-creation/types';
import { ConflictError } from '../../error';
import type { ScheduleTimingPlan } from './schedule-timing';
import { plannedScheduleFieldGraph } from './schedule-field-planned-graph';

function selections(
  command: WorkCreationBatchCommand,
  trees: readonly PlannedWorkTree[],
): ScheduleTimingSelection[] {
  return command.roots.flatMap((root, index) =>
    (trees[index]?.nodes ?? []).map((node) => {
      if (node.kind !== 'task' && node.kind !== 'project' && node.kind !== 'milestone')
        throw new ConflictError('Private timing requires selected Tasks, Projects or Milestones.');
      return { reference: { rootKey: root.key, path: [...node.path] }, kind: node.kind };
    }),
  );
}
function draftPins(rootKey: string, draft: WorkScheduleDraft): ScheduleTimingPin[] {
  return [{ path: [], dates: draft.root.dates }, ...draft.stepOverrides].flatMap((entry) =>
    Object.entries('dates' in entry ? (entry.dates ?? {}) : {}).flatMap(([field, value]) =>
      typeof value === 'string' || value === null
        ? [{ target: { rootKey, path: entry.path, field: field as BlueprintDateField }, value }]
        : [],
    ),
  );
}
function snapshots(
  command: WorkCreationBatchCommand,
  trees: readonly PlannedWorkTree[],
  absent: readonly { readonly target: WorkScheduleFieldTarget; readonly value: string | null }[],
): ScheduleTimingDates[] {
  return command.roots.flatMap((root, index) =>
    (trees[index]?.nodes ?? []).map((node) => ({
      reference: { rootKey: root.key, path: [...node.path] },
      dates: {
        ...node.dates,
        ...Object.fromEntries(
          absent
            .filter(
              ({ target }) =>
                target.rootKey === root.key &&
                JSON.stringify(target.path) === JSON.stringify(node.path),
            )
            .map(({ target, value }) => [target.field, value]),
        ),
      },
    })),
  );
}
function overlay(
  command: OrdinaryWorkCommand,
  values: readonly { readonly target: WorkScheduleFieldTarget; readonly value: string | null }[],
): OrdinaryWorkCommand {
  const context = command.invocation.scheduleContext;
  if (!context) throw new ConflictError('Private timing requires its installed schedule context.');
  const overrides = new Map<string, BlueprintNodeOverride>(
    (context.timingOverrides ?? []).map((entry) => [JSON.stringify(entry.path), entry]),
  );
  const rootDates: Partial<Record<BlueprintDateField, string | undefined>> = {};
  for (const { target, value } of values) {
    const key = JSON.stringify(target.path),
      previous = overrides.get(key);
    overrides.set(key, {
      ...previous,
      path: target.path,
      dates: { ...previous?.dates, [target.field]: value },
    });
    if (!target.path.length) rootDates[target.field] = value ?? undefined;
  }
  const invocation = {
    ...command.invocation,
    scheduleContext: { ...context, timingOverrides: [...overrides.values()] },
  };
  if (command.kind === 'task')
    return { ...command, body: { ...command.body, ...rootDates }, invocation };
  if (command.kind === 'project')
    return { ...command, body: { ...command.body, ...rootDates }, invocation };
  throw new ConflictError('Private field timing requires a Task or Project root.');
}
/** Derive every private field before eager creation, preserving waiting nulls and explicit pins. */
export function compileScheduleFieldTiming(
  command: WorkCreationBatchCommand,
  plans: readonly ScheduleTimingPlan[],
): WorkCreationBatchCommand {
  const policy = command.scheduleFieldTiming;
  if (!policy) return command;
  const context = command.roots[0]?.command.invocation.scheduleContext;
  const weekdays = plans[0]?.workingWeekdays;
  if (!context || !weekdays)
    throw new ConflictError('Private field timing requires the actual planning calendar.');
  let trees = plans.map((plan) => plan.tree);
  const selected = selections(command, trees);
  const dependencies = [
    ...command.edges.map((edge) => ({
      blocker: { ...edge.blocker, path: [...edge.blocker.path] },
      blocked: { ...edge.blocked, path: [...edge.blocked.path] },
    })),
    ...command.roots.flatMap((root, index) =>
      (trees[index]?.dependencies ?? []).map((edge) => ({
        blocker: { rootKey: root.key, path: [...edge.blockerPath] },
        blocked: { rootKey: root.key, path: [...edge.blockedPath] },
      })),
    ),
  ];
  validateScheduleFieldTiming(
    plannedScheduleFieldGraph(command.roots, trees, policy.timing, policy.absentFields),
    selected,
    dependencies,
  );
  const pins = command.roots.flatMap((root) => {
    const draft = root.command.invocation.scheduleContext?.draft;
    return draft ? draftPins(root.key, draft) : [];
  });
  const absent = policy.absentFields.map((target) => ({
    target,
    value: pins.find((pin) => JSON.stringify(pin.target) === JSON.stringify(target))?.value ?? null,
  }));
  let output = command,
    previous: string | null = null;
  for (let pass = 0; pass <= policy.timing.rules.length + 1; pass++) {
    const derived = deriveScheduleFieldTiming({
      timing: policy.timing,
      selections: selected,
      declaredDependencies: dependencies,
      dates: snapshots(command, trees, absent),
      actualMappings: [],
      completionFacts: [],
      pins,
      runDate: context.runDate,
      timezone: context.draft.timezone,
      workingWeekdays: weekdays,
    });
    const values = [...derived, ...absent];
    output = {
      ...output,
      roots: output.roots.map((root) => ({
        ...root,
        command: overlay(
          root.command,
          values.filter((entry) => entry.target.rootKey === root.key),
        ),
      })),
    };
    trees = output.roots.map((root, index) => {
      const plan = plans[index];
      if (!plan) throw new ConflictError('Missing private root planning context.');
      return plan.replan(root.command);
    });
    const fingerprint = JSON.stringify(trees.map((tree) => tree.nodes.map((node) => node.dates)));
    if (fingerprint === previous) return output;
    previous = fingerprint;
  }
  throw new ConflictError('Private date dependencies must converge before creating work.');
}

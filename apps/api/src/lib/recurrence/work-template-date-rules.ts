import type { BlueprintInvocationOverride, RetainedDateSourceScope } from '@docket/db';
import { BlueprintDateRule } from '@docket/work/work-template-blueprint';
import type {
  deriveBlueprintDate,
  BlueprintDateField,
  BlueprintCompletionFact,
} from '@docket/work/blueprints';
import type { TemplateTransaction } from '../templates/persistence';
import {
  requireRetainedOccurrenceAuthority,
  type RetainedOccurrenceAuthority,
  type AuthorizedRetainedOccurrence,
  type RetainedOccurrenceWork,
} from '../work-creation/retained-authority';
import { loadBlueprintSnapshot } from '../work-template-blueprints/snapshot';

/** Private accepted source plus shared pure derivation inputs; never a public stored blueprint binding. */
export interface RetainedDateRulePlan {
  readonly scope: RetainedDateSourceScope;
  readonly field: BlueprintDateField;
  readonly derivation: Parameters<typeof deriveBlueprintDate>[0];
}
function completionKey(sourceId: string): string {
  return `s_${sourceId.toLowerCase()}`;
}
/** Translate legacy private timing into the shared relative-rule vocabulary, excluding non-managed absent dates. */
export function retainedDateRule(
  preset: BlueprintInvocationOverride,
  field: BlueprintDateField,
): BlueprintDateRule | null {
  const offsetKey = {
    startDate: 'start_offset_days',
    dueDate: 'due_offset_days',
    targetDate: 'target_offset_days',
  }[field];
  const literal = preset.fields[offsetKey];
  if (typeof literal === 'number')
    return BlueprintDateRule.parse({
      kind: 'anchor',
      anchor: { kind: 'parent' },
      offset: { days: literal, unit: 'calendar' },
    });
  const primary = { task: 'dueDate', project: 'startDate', milestone: 'targetDate' }[preset.kind];
  if (field !== primary) return null;
  const offset = { days: preset.timing.offsetDays ?? 0, unit: 'calendar' };
  if (preset.timing.kind === 'after_step_completion')
    return BlueprintDateRule.parse({
      kind: 'after_completion',
      stepKeys: [completionKey(preset.timing.afterStepId ?? 'missing')],
      offset,
    });
  return BlueprintDateRule.parse({
    kind: 'anchor',
    anchor: { kind: 'parent' },
    offset: { ...offset, days: preset.timing.kind === 'on_trigger' ? 0 : offset.days },
  });
}
type Snapshot = Awaited<ReturnType<typeof loadBlueprintSnapshot>>;
interface PrivateDateFacts {
  readonly facts: AuthorizedRetainedOccurrence;
  readonly snapshots: ReadonlyMap<string, Snapshot>;
  readonly completions: readonly BlueprintCompletionFact[];
  readonly consumers: readonly RetainedOccurrenceWork[];
}
async function privateDateFacts(
  tx: TemplateTransaction,
  authority: RetainedOccurrenceAuthority,
  affectedSourceStepIds: ReadonlySet<string> | undefined,
): Promise<PrivateDateFacts> {
  const facts = requireRetainedOccurrenceAuthority(tx, authority);
  const presets = facts.overrides.filter(
    (entry) =>
      !affectedSourceStepIds ||
      (entry.timing.kind === 'after_step_completion' &&
        entry.timing.afterStepId !== null &&
        affectedSourceStepIds.has(entry.timing.afterStepId)),
  );
  const consumerIds = new Set(presets.map((entry) => entry.sourceStepId));
  const consumers = [...facts.mappedWork.values()].filter((mapped) =>
    consumerIds.has(mapped.sourceStepId),
  );
  const requiredIds = new Set([
    ...consumerIds,
    ...presets.flatMap((entry) => (entry.timing.afterStepId ? [entry.timing.afterStepId] : [])),
  ]);
  const required = [...facts.mappedWork.values()].filter((mapped) =>
    requiredIds.has(mapped.sourceStepId),
  );
  const snapshots = new Map<string, Snapshot>();
  const completions: BlueprintCompletionFact[] = [];
  for (const mapped of required) {
    const snapshot = await loadBlueprintSnapshot(
      tx,
      authority,
      { kind: mapped.kind, id: mapped.id },
      { scope: 'reference' },
    );
    snapshots.set(mapped.sourceStepId, snapshot);
    const work = snapshot.rowsByRef.get(`${mapped.kind}:${mapped.id}`);
    if (work?.kind === 'task')
      completions.push({
        id: work.id,
        path: [completionKey(mapped.sourceStepId)],
        state: completionState(snapshot.root.state),
        completedAt: work.row.completedAt?.toISOString() ?? null,
      });
  }
  return { facts, snapshots, completions, consumers };
}
function completionState(state: Snapshot['root']['state']): BlueprintCompletionFact['state'] {
  if (state === 'completed') return 'completed';
  return state === 'canceled' ? 'canceled' : 'open';
}
const dateFields: Readonly<Record<RetainedOccurrenceWork['kind'], readonly BlueprintDateField[]>> =
  {
    task: ['startDate', 'dueDate'],
    project: ['startDate', 'targetDate'],
    milestone: ['targetDate'],
  };
function plansForWork(
  input: PrivateDateFacts,
  mapped: RetainedOccurrenceWork,
): RetainedDateRulePlan[] {
  const { facts, snapshots, completions } = input;
  const preset = facts.overrides.find((preset) => preset.sourceStepId === mapped.sourceStepId);
  const snapshot = snapshots.get(mapped.sourceStepId);
  if (!preset || !snapshot) return [];
  const source = facts.manifest.steps.find((source) => source.sourceStepId === mapped.sourceStepId);
  const root = facts.manifest.roots.find((root) => root.key === source?.rootKey);
  const rootSnapshot = root ? snapshots.get(root.sourceStepId) : undefined;
  const context = rootSnapshot?.context ?? snapshot.context;
  return dateFields[mapped.kind].flatMap((field) => {
    const rule = retainedDateRule(preset, field);
    if (!rule) return [];
    return [
      {
        field,
        scope: {
          organizationId: facts.organizationId,
          occurrenceId: facts.occurrenceId,
          invocationId: facts.invocationId,
          sourceStepId: mapped.sourceStepId,
          workKind: mapped.kind,
          workId: mapped.id,
        },
        derivation: {
          rule,
          parentAnchor: facts.runDate,
          milestoneAnchors: {},
          scopePath: [],
          completions,
          timezone: facts.scheduleTimezone ?? context.timezone,
          workingWeekdays: context.workingWeekdays,
        },
      },
    ];
  });
}
/** Read exact cross-root completion facts and create transient shared-engine inputs under a registered occurrence capability. */
export async function loadRetainedDateRules(
  tx: TemplateTransaction,
  authority: RetainedOccurrenceAuthority,
  affectedSourceStepIds?: ReadonlySet<string>,
): Promise<readonly RetainedDateRulePlan[]> {
  const input = await privateDateFacts(tx, authority, affectedSourceStepIds);
  return input.consumers.flatMap((mapped) => plansForWork(input, mapped));
}

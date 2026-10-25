import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { WorkScheduleForest } from '@docket/work/work-schedule-forest';
import {
  WorkScheduleForestV2,
  orderPrivateScheduleRoots,
} from '@docket/work/work-schedule-forest-v2';
import type { AcceptedScheduleRoot } from '@docket/work/work-schedule-claim';
import { renderScheduleTitlePattern } from '@docket/work/schedule-title-pattern';
import { BlueprintCivilDate } from '@docket/work/work-template-blueprint';
import { TaskCreate } from '@docket/work/task-model';
import { WorkTypeId, WorkTypeVersionId } from '@docket/work/ids';
import {
  planBlueprint,
  type BlueprintNodeOverride,
  type BlueprintDateField,
  type PlannedWorkTree,
  type BlueprintCreationContext,
  type ResolvedBlueprintInput,
} from '@docket/work/blueprints';
import { ConflictError } from '../../error';
import { ProjectCreate } from '../../contracts/project';
import type { WorkCreationBatchCommand, OrdinaryWorkCommand } from '../work-creation/types';
import { originFor, ruleProvenance } from '../provenance/context';
import { blueprintFingerprint } from '../work-template-blueprints/fingerprint';
import {
  legacyScheduleNodeTitles,
  legacyScheduleRootTitle,
  legacyScheduleTitles,
  legacyScheduleDocument,
} from './schedule-v2';

/** Canonical private revision document; this data alone confers no execution authority. */
export type ScheduleDocument = WorkScheduleDraft | WorkScheduleForest | WorkScheduleForestV2;
/** Normalize a private document without exposing legacy source identities or fabricating a root. */
export function parseScheduleDocument(value: unknown): ScheduleDocument {
  const native = WorkScheduleDraft.safeParse(value);
  if (native.success) return native.data;
  const forest = WorkScheduleForest.safeParse(value);
  return forest.success ? forest.data : WorkScheduleForestV2.parse(value);
}
/** Stable exact private draft identity used by both persisted fallback and immutable run claim. */
export function scheduleDraftFingerprint(value: ScheduleDocument): string {
  return blueprintFingerprint(parseScheduleDocument(value));
}
/** Independently authored roots; a native schedule has one stable internal root key. */
export function scheduleDocumentRoots(
  value: ScheduleDocument,
): readonly { readonly key: string; readonly draft: WorkScheduleDraft }[] {
  if (value.kind === 'schedule') return [{ key: 'root', draft: value }];
  return value.revision === 2
    ? orderPrivateScheduleRoots(value.roots, value.placements)
    : value.roots;
}
/** Pure input to the ordinary shared creation forest, still subject to live creation preflight. */
export interface CompileScheduleCommand {
  readonly caller: OrdinaryWorkCommand['caller'];
  readonly seriesId: string;
  readonly ownerProgramId: string | null;
  readonly runDate: string;
  readonly document: ScheduleDocument;
  readonly acceptedRoots?: readonly AcceptedScheduleRoot[];
}
function nonNullFields(value: Readonly<Record<string, unknown>>) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null));
}
/** Preserve explicit null dates while removing schema-accepted undefined optional values. */
export function scheduleDates(
  value: Readonly<Record<string, unknown>>,
): Partial<Record<BlueprintDateField, string | null>> {
  const dates: Partial<Record<BlueprintDateField, string | null>> = {};
  for (const field of ['startDate', 'dueDate', 'targetDate'] as const) {
    const date = value[field];
    if (typeof date === 'string' || date === null) dates[field] = date;
  }
  return dates;
}
/** Assignment and date overlays retain explicit unassigned choices without optional undefined values. */
export function scheduleAssignmentOverrides(draft: WorkScheduleDraft): BlueprintNodeOverride[] {
  return [
    { path: [], dates: scheduleDates(draft.root.dates) },
    ...draft.stepOverrides.map((override) => ({
      path: override.path,
      ...('teamId' in override && override.teamId !== undefined ? { teamId: override.teamId } : {}),
      ...('responsibleActorId' in override && override.responsibleActorId !== undefined
        ? { responsibleActorId: override.responsibleActorId }
        : {}),
      ...('cycleId' in override && override.cycleId !== undefined
        ? { cycleId: override.cycleId }
        : {}),
      ...('dates' in override && override.dates ? { dates: scheduleDates(override.dates) } : {}),
    })),
  ];
}
function compileRootInvocation(
  input: CompileScheduleCommand,
  key: string,
  draft: WorkScheduleDraft,
) {
  const legacy = legacyScheduleDocument(input.document);
  const placement =
    input.document.kind === 'forest' && input.document.revision === 2
      ? input.document.placements?.find((entry) => entry.rootKey === key)
      : undefined;
  const title = legacy
    ? legacyScheduleRootTitle(legacy, key, draft.root.kind, input.runDate)
    : renderScheduleTitlePattern(draft.titlePattern, input.runDate);
  const origin = originFor(
    'recurrence_materialize',
    {},
    ruleProvenance('recurrence', { seriesId: input.seriesId }),
  );
  const invocation = {
    origin,
    placement: { programId: input.ownerProgramId },
    scheduleContext: {
      draft,
      runDate: input.runDate,
      ...(legacy ? { legacyTitles: legacyScheduleTitles(legacy, key) } : {}),
      ...(placement ? { rootPlacement: placement } : {}),
    },
  };
  return { title, invocation };
}
function compileRoot(
  input: CompileScheduleCommand,
  key: string,
  draft: WorkScheduleDraft,
): OrdinaryWorkCommand {
  const accepted = input.acceptedRoots?.find((root) => root.key === key);
  assertAcceptedSelection(draft, accepted);
  const { title, invocation } = compileRootInvocation(input, key, draft);
  const common = rootValues(draft, input.runDate, accepted);
  const blueprint = { optionalChoices: accepted?.optionalChoices ?? draft.optionalChoices };
  if (draft.root.kind === 'task')
    return withCaller(input.caller, {
      kind: 'task',
      invocation,
      blueprint,
      body: TaskCreate.parse({
        ...common,
        ...nonNullFields(draft.root.placement),
        title,
        assigneeId: draft.root.responsibleActorId ?? undefined,
        cycleId: draft.root.cycleId ?? undefined,
      }),
    });
  return withCaller(input.caller, {
    kind: 'project',
    invocation,
    blueprint,
    body: ProjectCreate.parse({
      ...common,
      ...nonNullFields(draft.root.placement),
      name: title,
      programId: projectDestination(draft.root.placement.programId, input.ownerProgramId),
      leadId: draft.root.responsibleActorId ?? undefined,
    }),
  });
}
function assertAcceptedSelection(
  draft: WorkScheduleDraft,
  accepted: AcceptedScheduleRoot | undefined,
): void {
  if (
    accepted &&
    (accepted.kind !== draft.root.kind || accepted.workTypeId !== draft.template.workTypeId)
  )
    throw new ConflictError('The accepted schedule selection changed.');
  if (
    accepted &&
    draft.template.selection.kind === 'pinned' &&
    accepted.versionId !== draft.template.selection.workTypeVersionId
  )
    throw new ConflictError('The accepted schedule pin changed.');
}
function projectDestination(
  specified: string | null | undefined,
  owner: string | null,
): string | undefined {
  if (owner && specified !== undefined && specified !== owner)
    throw new ConflictError('The schedule destination must match its owning Program.');
  return owner ?? specified ?? undefined;
}
function rootValues(
  draft: WorkScheduleDraft,
  runDate: string,
  accepted: AcceptedScheduleRoot | undefined,
) {
  const pinned =
    draft.template.selection.kind === 'pinned'
      ? draft.template.selection.workTypeVersionId
      : undefined;
  const version = accepted?.versionId ?? pinned;
  const fields = Object.fromEntries(
    Object.entries(draft.root.fields).filter(
      ([key, value]) => value !== null || key === 'health' || key === 'estimateMinutes',
    ),
  );
  const dates = {
    [draft.root.kind === 'task' ? 'dueDate' : 'targetDate']: runDate,
    ...draft.root.dates,
  };
  return {
    ...fields,
    ...nonNullFields(dates),
    workTypeId: WorkTypeId.parse(draft.template.workTypeId),
    ...(version ? { workTypeVersionId: WorkTypeVersionId.parse(version) } : {}),
    teamId: draft.root.teamId ?? undefined,
  };
}
function withCaller(
  caller: OrdinaryWorkCommand['caller'],
  command:
    | Omit<Extract<OrdinaryWorkCommand, { kind: 'task' }>, 'caller'>
    | Omit<Extract<OrdinaryWorkCommand, { kind: 'project' }>, 'caller'>,
): OrdinaryWorkCommand {
  return 'kind' in caller ? { ...command, caller } : { ...command, caller };
}
/** Compile title, real destination and ordinary root inputs; no work is inserted or authority granted. */
export function compileScheduleCommand(input: CompileScheduleCommand): WorkCreationBatchCommand {
  BlueprintCivilDate.parse(input.runDate);
  const document = parseScheduleDocument(input.document);
  if (document.kind === 'forest' && document.state !== 'published')
    throw new ConflictError('Publish the schedule before running it.');
  const roots = scheduleDocumentRoots(document).map(({ key, draft }) => ({
    key,
    command: compileRoot(input, key, draft),
  }));
  const first = roots[0];
  if (!first) throw new ConflictError('The schedule has no selected work.');
  if (input.acceptedRoots && input.acceptedRoots.length !== roots.length)
    throw new ConflictError('The accepted schedule roots changed.');
  return {
    roots,
    edges: document.kind === 'forest' ? document.dependencies : [],
    invocation: first.command.invocation,
    ...(document.kind === 'forest' && document.revision === 1
      ? { scheduleTiming: document.timing }
      : {}),
    ...(document.kind === 'forest' && document.revision === 2
      ? { scheduleFieldTiming: { timing: document.timing, absentFields: document.absentFields } }
      : {}),
  };
}
/** Merge private partial fields onto the exact planned kind and reject unknown or unselected paths. */
export function scheduleNodeOverrides(
  draft: WorkScheduleDraft,
  tree: PlannedWorkTree,
): BlueprintNodeOverride[] {
  const assignments = scheduleAssignmentOverrides(draft);
  const steps = draft.stepOverrides.map((override, index) => {
    const node = tree.nodes.find(
      (entry) => JSON.stringify(entry.path) === JSON.stringify(override.path),
    );
    if (node?.kind !== override.kind)
      throw new ConflictError('A schedule override requires a selected matching template step.');
    const context = assignments[index + 1];
    if (!context) throw new ConflictError('The schedule override changed.');
    const fields = override.fields
      ? Object.fromEntries(
          Object.entries(override.fields).filter(([, value]) => value !== undefined),
        )
      : undefined;
    // The first planner pass already merged the template and authored step document.
    // Private fields replace this prepared result, including an explicitly blank document.
    return {
      ...context,
      ...(fields ? { fields: { ...node.fields, ...fields }, documentPrepared: true } : {}),
    };
  });
  return [assignments[0] ?? { path: [] }, ...steps];
}
/** Run schedule context through the ordinary pure planner, including live assignment choices and partial fields. */
export function planScheduleBlueprint<T extends BlueprintCreationContext>(
  command: OrdinaryWorkCommand,
  input: Omit<ResolvedBlueprintInput, 'context'> & { readonly context: T },
): { readonly context: T; readonly tree: PlannedWorkTree } {
  const schedule = command.invocation.scheduleContext;
  if (!schedule) return { context: input.context, tree: planBlueprint(input) };
  const context = {
    ...input.context,
    runDate: schedule.runDate,
    timezone: schedule.draft.timezone,
    overrides: mergeScheduleTiming(
      scheduleAssignmentOverrides(schedule.draft),
      schedule.timingOverrides,
    ),
  };
  const first = planBlueprint({ ...input, context });
  const finalContext = {
    ...context,
    overrides: mergeScheduleTiming(
      legacyScheduleNodeTitles(
        first,
        schedule.legacyTitles ?? [],
        schedule.runDate,
        scheduleNodeOverrides(schedule.draft, first),
      ),
      schedule.timingOverrides,
    ),
  };
  return { context: finalContext, tree: planBlueprint({ ...input, context: finalContext }) };
}
function mergeScheduleTiming(
  authored: readonly BlueprintNodeOverride[],
  timing: readonly BlueprintNodeOverride[] = [],
): BlueprintNodeOverride[] {
  const overrides = new Map(timing.map((entry) => [JSON.stringify(entry.path), entry]));
  for (const entry of authored) {
    const key = JSON.stringify(entry.path);
    const derived = overrides.get(key);
    overrides.set(key, { ...derived, ...entry, dates: { ...derived?.dates, ...entry.dates } });
  }
  return [...overrides.values()];
}

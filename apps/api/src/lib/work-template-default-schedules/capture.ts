import {
  calendarProcessBinding,
  recurrenceSeries,
  recurrenceSeriesRevision,
  recurrenceSeriesWeekday,
} from '@docket/db';
import {
  captureDefaultScheduleOutline,
  ProgramDefaultSchedules,
  type ProgramDefaultSchedule,
} from '@docket/work/work-schedule-defaults';
import {
  completionCivilDate,
  BlueprintError,
  type BlueprintWarning,
} from '@docket/work/blueprints';
import { WorkScheduleDraft } from '@docket/work/work-schedule';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { ActorCtx } from '../../context';
import type { TemplateTransaction } from '../templates/persistence';
import type { AuthorizedBlueprintSnapshot } from '../work-template-blueprints/snapshot';
import { requireScheduleAccess } from '../recurrence/schedule-access';
import { triggerFromStorage } from '../recurrence/series';
import { blueprintFingerprint } from '../work-template-blueprints/fingerprint';

/** Reusable root Program schedules and bounded warnings; raw provider and assignment details stay private. */
export interface CapturedProgramSchedules {
  readonly defaults: ProgramDefaultSchedule[];
  readonly warnings: BlueprintWarning[];
  readonly sourceFingerprint: string;
}

/** Read owned schedules under current visibility and remove private location and provider facts. */
export async function captureProgramDefaultSchedules(
  tx: TemplateTransaction,
  actor: ActorCtx,
  snapshot: AuthorizedBlueprintSnapshot,
): Promise<CapturedProgramSchedules> {
  if (snapshot.root.kind !== 'program')
    return { defaults: [], warnings: [], sourceFingerprint: blueprintFingerprint([]) };
  const rows = await tx
    .selectDistinctOn([recurrenceSeries.id], {
      series: recurrenceSeries,
      revision: recurrenceSeriesRevision,
    })
    .from(recurrenceSeries)
    .innerJoin(
      recurrenceSeriesRevision,
      and(
        eq(recurrenceSeriesRevision.seriesId, recurrenceSeries.id),
        eq(recurrenceSeriesRevision.organizationId, recurrenceSeries.organizationId),
      ),
    )
    .where(
      and(
        eq(recurrenceSeries.organizationId, actor.orgId),
        eq(recurrenceSeries.ownerProgramId, snapshot.root.id),
        isNull(recurrenceSeries.archivedAt),
      ),
    )
    .orderBy(recurrenceSeries.id, desc(recurrenceSeriesRevision.number))
    .limit(21);
  if (rows.length > 20)
    throw new BlueprintError('blueprint_limit', 'Capture at most 20 Program default schedules.');
  const current = rows;
  const defaults: ProgramDefaultSchedule[] = [],
    warnings: BlueprintWarning[] = [];
  const sources: string[] = [];
  for (const [index, row] of current.entries()) {
    await requireScheduleAccess(tx, {
      organizationId: actor.orgId,
      actorId: actor.actorId,
      seriesId: row.series.id,
    });
    const captured = await captureOwnedSchedule(tx, snapshot, row, `schedule_${index + 1}`);
    sources.push(captured.sourceFingerprint ?? blueprintFingerprint(row));
    if (captured.outline) defaults.push(captured.outline);
    warnings.push(...captured.warnings.map((code) => ({ code, paths: [[]], count: 1 })));
  }
  const grouped = new Map<BlueprintWarning['code'], number>();
  for (const warning of warnings)
    grouped.set(warning.code, (grouped.get(warning.code) ?? 0) + warning.count);
  return {
    defaults: ProgramDefaultSchedules.parse(defaults),
    sourceFingerprint: blueprintFingerprint({ rows, sources }),
    warnings: [...grouped].map(([code, count]) => ({ code, paths: [[]], count })),
  };
}

async function captureOwnedSchedule(
  tx: TemplateTransaction,
  snapshot: AuthorizedBlueprintSnapshot,
  row: {
    series: typeof recurrenceSeries.$inferSelect;
    revision: typeof recurrenceSeriesRevision.$inferSelect;
  },
  key: string,
): Promise<{
  outline?: ProgramDefaultSchedule;
  warnings: BlueprintWarning['code'][];
  sourceFingerprint?: string;
}> {
  const bindings = await tx
    .select()
    .from(calendarProcessBinding)
    .where(
      and(
        eq(calendarProcessBinding.organizationId, row.series.organizationId),
        eq(calendarProcessBinding.seriesId, row.series.id),
      ),
    )
    .limit(1);
  const omitted = (): { warnings: BlueprintWarning['code'][]; sourceFingerprint: string } => ({
    warnings: [
      'capture_schedule_cadence',
      ...(bindings.length ? ['capture_schedule_provider' as const] : []),
    ],
    sourceFingerprint: blueprintFingerprint({ row, bindings }),
  });
  const parsed = WorkScheduleDraft.safeParse(row.revision.scheduleDraft);
  if (!parsed.success || row.revision.triggerKind !== 'calendar') return omitted();
  const weekdays = await tx
    .select({ weekday: recurrenceSeriesWeekday.weekday })
    .from(recurrenceSeriesWeekday)
    .where(eq(recurrenceSeriesWeekday.seriesRevisionId, row.revision.id));
  const trigger = triggerFromStorage(
    row.revision,
    weekdays.map((day) => day.weekday),
  );
  if (trigger.kind !== 'calendar') return omitted();
  const program = snapshot.rowsByRef.get(`program:${snapshot.root.id}`);
  if (program?.kind !== 'program') return omitted();
  const draft = parsed.data;
  const assignments = draft.stepOverrides.some(
    (override) => 'teamId' in override || 'responsibleActorId' in override || 'cycleId' in override,
  );
  const privateDraft =
    Object.keys(draft.root.fields).length > 0 ||
    Object.keys(draft.root.dates).length > 0 ||
    Object.keys(draft.root.placement).length > 0 ||
    draft.stepOverrides.length > 0 ||
    draft.optionalChoices.length > 0;
  const captured = captureDefaultScheduleOutline({
    key,
    name: row.series.name,
    template: draft.template,
    titlePattern: draft.titlePattern,
    cadence: trigger.schedule,
    creationDate: completionCivilDate(program.row.createdAt.toISOString(), draft.timezone),
    parent: snapshot.root,
    root: {
      teamId: draft.root.teamId ?? null,
      responsibleActorId: draft.root.responsibleActorId ?? null,
    },
    hasPrivateAssignments: assignments,
    hasPrivateDraft: privateDraft,
    providerBound: bindings.length > 0,
  });
  return { ...captured, sourceFingerprint: blueprintFingerprint({ row, bindings }) };
}

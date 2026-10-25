import {
  recurrenceSeries,
  recurrenceSeriesRevision,
  recurrenceSeriesWeekday,
  template,
  type Database,
} from '@docket/db';
import { WorkScheduleRevisionFallback } from '@docket/work/work-schedule-fallback';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../../error';
import { ProcessTrigger, type ProcessTrigger as Trigger } from '../../contracts/recurrence';
import { loadCreationActor } from '../work-creation/context';
import { requireWorkAccess } from '../work-template-selection';
import type { TemplateTransaction } from '../templates/persistence';
import {
  compileScheduleCommand,
  parseScheduleDocument,
  scheduleDocumentRoots,
  scheduleDraftFingerprint,
  type ScheduleDocument,
} from './schedule-compiler';
import { authorizeScheduleRevisionContinuity } from './schedule-authority';
import type { WorkCreationBatchCommand } from '../work-creation/types';
import { preflightScheduleClaim } from './schedule-preflight';
import { triggerStorage } from './series-trigger-storage';
import { requireScheduleAccess } from './schedule-access';
import { firstScheduleRunDate } from './schedule-review-date';
import { requireFutureScheduleBoundary } from './schedule-future-boundary';
import {
  bindCanonicalPrivateSchedule,
  requireCanonicalPrivatePublication,
  type CanonicalPrivatePublicationBinding,
} from './private-definition-binding';

/** Native schedule authoring command; only this private service receives the location draft. */
export interface CreateWorkScheduleCommand {
  readonly organizationId: string;
  readonly actorId: string;
  readonly ownerProgramId?: string | null | undefined;
  readonly name: string;
  readonly document: ScheduleDocument;
  readonly trigger: Trigger;
  readonly effectiveFrom: string;
}
/** Future-only revision command; the saved owning Program cannot change. */
export interface ReviseWorkScheduleCommand extends Omit<
  CreateWorkScheduleCommand,
  'ownerProgramId' | 'name'
> {
  readonly seriesId: string;
  readonly expectedRevisionId: string;
  readonly name?: string | undefined;
}
/** Existing revision preview/edit input; no caller-provided retained manifest is accepted. */
export interface WorkScheduleRevisionPreviewCommand {
  readonly organizationId: string;
  readonly actorId: string;
  readonly seriesId: string;
  readonly expectedRevisionId: string;
  readonly document: ScheduleDocument;
  readonly runDate: string;
  readonly effectiveFrom: string;
}
/** Persisted native schedule and its immutable newly registered revision. */
export interface WorkScheduleAuthoringResult {
  readonly series: typeof recurrenceSeries.$inferSelect;
  readonly revision: typeof recurrenceSeriesRevision.$inferSelect;
}
/** Prepare authorized future work against live selection or the persisted source revision's archive closure. */
export async function prepareWorkScheduleRevisionCommand(
  tx: TemplateTransaction,
  input: WorkScheduleRevisionPreviewCommand,
): Promise<WorkCreationBatchCommand> {
  await tx
    .select({ id: recurrenceSeries.id })
    .from(recurrenceSeries)
    .where(
      and(
        eq(recurrenceSeries.id, input.seriesId),
        eq(recurrenceSeries.organizationId, input.organizationId),
      ),
    )
    .for('update');
  const { series } = await requireScheduleAccess(tx, input, 'manage');
  const [latest] = await tx
    .select({
      id: recurrenceSeriesRevision.id,
      effectiveFrom: recurrenceSeriesRevision.effectiveFrom,
      document: recurrenceSeriesRevision.scheduleDraft,
    })
    .from(recurrenceSeriesRevision)
    .where(
      and(
        eq(recurrenceSeriesRevision.seriesId, series.id),
        eq(recurrenceSeriesRevision.organizationId, input.organizationId),
      ),
    )
    .orderBy(desc(recurrenceSeriesRevision.number))
    .for('update')
    .limit(1);
  if (latest?.id !== input.expectedRevisionId)
    throw new ConflictError('The schedule revision changed.');
  const document = parseScheduleDocument(input.document);
  if (!latest.document) throw new ConflictError('The schedule revision requires conversion.');
  const savedDocument = parseScheduleDocument(latest.document);
  const savedRoot = scheduleDocumentRoots(savedDocument)[0];
  if (!savedRoot) throw new ConflictError('The schedule has no saved work.');
  requireFutureScheduleBoundary({
    status: series.status,
    latestEffectiveFrom: latest.effectiveFrom,
    effectiveFrom: input.effectiveFrom,
    timezone: savedRoot.draft.timezone,
  });
  const ids = scheduleDocumentRoots(document).map((root) => root.draft.template.workTypeId);
  const definitions = await tx
    .select({ archivedAt: template.archivedAt, state: template.publicationState })
    .from(template)
    .where(and(eq(template.organizationId, input.organizationId), inArray(template.id, ids)));
  if (definitions.some((row) => row.archivedAt !== null || row.state === 'archived'))
    return authorizeScheduleRevisionContinuity(tx, { ...input, document });
  const caller = await loadCreationActor(tx, input.organizationId, input.actorId);
  return compileScheduleCommand({
    caller,
    seriesId: series.id,
    ownerProgramId: series.ownerProgramId,
    document,
    runDate: input.runDate,
  });
}
interface ScheduleRevisionSource {
  readonly revisionId?: string;
  readonly publication?: CanonicalPrivatePublicationBinding;
}
function checkedPrivateRevisionSource(
  tx: TemplateTransaction,
  caller: Awaited<ReturnType<typeof loadCreationActor>>,
  document: ScheduleDocument,
  publication: CanonicalPrivatePublicationBinding | undefined,
) {
  if (!publication) return null;
  const aliases = requireCanonicalPrivatePublication(tx, caller, publication);
  const timezone = scheduleDocumentRoots(document)[0]?.draft.timezone;
  if (
    !timezone ||
    scheduleDraftFingerprint(bindCanonicalPrivateSchedule(tx, caller, publication, timezone)) !==
      scheduleDraftFingerprint(document)
  )
    throw new ConflictError('The private schedule publication changed.');
  return aliases;
}
async function prepareRevisionInput(
  tx: TemplateTransaction,
  input: CreateWorkScheduleCommand,
  seriesId: string,
  source?: ScheduleRevisionSource,
) {
  const sourceRevisionId = source?.revisionId,
    publication = source?.publication;
  const document = parseScheduleDocument(input.document);
  const trigger = ProcessTrigger.parse(input.trigger);
  if (
    trigger.kind === 'calendar' &&
    (document.kind === 'schedule' ? document.timezone : document.roots[0]?.draft.timezone) !==
      trigger.schedule.timezone
  )
    throw new ConflictError('The schedule cadence and draft must share their saved timezone.');
  const caller = await loadCreationActor(tx, input.organizationId, input.actorId);
  const aliases = checkedPrivateRevisionSource(tx, caller, document, publication);
  if (input.ownerProgramId) await requireWorkAccess(tx, caller, 'program', input.ownerProgramId);
  const runDate = firstScheduleRunDate(trigger, input.effectiveFrom);
  if (!runDate) throw new ConflictError('The selected cadence has no future run.');
  const command = sourceRevisionId
    ? await prepareWorkScheduleRevisionCommand(tx, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        seriesId,
        expectedRevisionId: sourceRevisionId,
        document,
        runDate,
        effectiveFrom: input.effectiveFrom,
      })
    : compileScheduleCommand({
        caller,
        seriesId,
        document,
        ownerProgramId: input.ownerProgramId ?? null,
        runDate,
      });
  const roots = await preflightScheduleClaim(tx, command, document);
  return { document, trigger, roots, aliases };
}
async function insertRevision(
  tx: TemplateTransaction,
  input: CreateWorkScheduleCommand,
  seriesId: string,
  number: number,
  source?: ScheduleRevisionSource,
) {
  const { document, trigger, roots, aliases } = await prepareRevisionInput(
    tx,
    input,
    seriesId,
    source,
  );
  const stored = triggerStorage(trigger);
  const [revision] = await tx
    .insert(recurrenceSeriesRevision)
    .values({
      organizationId: input.organizationId,
      seriesId,
      number,
      effectiveFrom: input.effectiveFrom,
      createdBy: input.actorId,
      ...(aliases
        ? { processRevisionId: aliases.revisionId, blueprintInvocationId: aliases.invocationId }
        : {}),
      scheduleDraft: document,
      ...stored.values,
    })
    .returning();
  if (!revision) throw new ConflictError('The schedule revision could not be created.');
  const fallback = WorkScheduleRevisionFallback.parse({
    kind: 'schedule_fallback',
    revision: 1,
    seriesRevisionId: revision.id,
    sourceInvocationId: aliases?.invocationId ?? null,
    draftFingerprint: scheduleDraftFingerprint(document),
    roots,
  });
  const [saved] = await tx
    .update(recurrenceSeriesRevision)
    .set({ authoringFallback: fallback })
    .where(eq(recurrenceSeriesRevision.id, revision.id))
    .returning();
  if (!saved) throw new ConflictError('The schedule fallback could not be registered.');
  if (stored.weekdays.length)
    await tx
      .insert(recurrenceSeriesWeekday)
      .values(stored.weekdays.map((weekday) => ({ seriesRevisionId: revision.id, weekday })));
  return saved;
}
/** Append an exact private publication through the same current preflight, cadence and fallback writer. */
export async function appendBoundPrivateScheduleRevision(
  tx: TemplateTransaction,
  input: CreateWorkScheduleCommand,
  target: {
    readonly seriesId: string;
    readonly number: number;
    readonly publication: CanonicalPrivatePublicationBinding;
  },
): Promise<WorkScheduleAuthoringResult['revision']> {
  return insertRevision(tx, input, target.seriesId, target.number, {
    publication: target.publication,
  });
}
/** Create a real schedule and its authoring-time exact fallback in the same transaction. */
export async function createWorkSchedule(
  database: Database,
  input: CreateWorkScheduleCommand,
): Promise<WorkScheduleAuthoringResult> {
  return database.transaction((tx) => createWorkScheduleInTransaction(tx, input));
}
/** Install one independently owned schedule in its enclosing Program/work creation transaction. */
export async function createWorkScheduleInTransaction(
  tx: TemplateTransaction,
  input: CreateWorkScheduleCommand,
  publication?: CanonicalPrivatePublicationBinding,
): Promise<WorkScheduleAuthoringResult> {
  const aliases = publication
    ? requireCanonicalPrivatePublication(
        tx,
        { orgId: input.organizationId, actorId: input.actorId },
        publication,
      )
    : null;
  const [series] = await tx
    .insert(recurrenceSeries)
    .values({
      organizationId: input.organizationId,
      ownerProgramId: input.ownerProgramId ?? null,
      name: input.name.trim(),
      createdBy: input.actorId,
      ...(aliases ? { definitionId: aliases.definitionId } : {}),
    })
    .returning();
  if (!series) throw new ConflictError('The schedule could not be created.');
  const revision = await insertRevision(
    tx,
    input,
    series.id,
    1,
    publication ? { publication } : undefined,
  );
  return { series, revision };
}
/** Append an independently validated future revision without modifying accepted past runs. */
export async function reviseWorkSchedule(
  database: Database,
  input: ReviseWorkScheduleCommand,
): Promise<WorkScheduleAuthoringResult> {
  return database.transaction(async (tx) => {
    await requireScheduleAccess(tx, input, 'manage');
    const [series] = await tx
      .select()
      .from(recurrenceSeries)
      .where(
        and(
          eq(recurrenceSeries.id, input.seriesId),
          eq(recurrenceSeries.organizationId, input.organizationId),
        ),
      )
      .for('update')
      .limit(1);
    if (!series || series.archivedAt) throw new NotFoundError('Schedule not found');
    const [latest] = await tx
      .select()
      .from(recurrenceSeriesRevision)
      .where(
        and(
          eq(recurrenceSeriesRevision.seriesId, series.id),
          eq(recurrenceSeriesRevision.organizationId, input.organizationId),
        ),
      )
      .orderBy(desc(recurrenceSeriesRevision.number))
      .limit(1);
    if (latest?.id !== input.expectedRevisionId)
      throw new ConflictError('The schedule revision changed.');
    const revision = await insertRevision(
      tx,
      { ...input, name: input.name ?? series.name, ownerProgramId: series.ownerProgramId },
      series.id,
      latest.number + 1,
      { revisionId: latest.id },
    );
    if (input.name !== undefined)
      await tx
        .update(recurrenceSeries)
        .set({ name: input.name.trim() })
        .where(eq(recurrenceSeries.id, series.id));
    return { series: { ...series, name: input.name?.trim() ?? series.name }, revision };
  });
}

import { processOccurrence, recurrenceSeriesRevision, type Database } from '@docket/db';
import { and, desc, eq, lte } from 'drizzle-orm';
import type { NativeScheduleFacts } from './schedule-native-facts';
import {
  authorizeNativeScheduleOccurrence,
  findNativeScheduleOccurrence,
} from './schedule-native-facts';
import { readNativeScheduleStatus } from './schedule-native-status';
import { nativeNextCompletionDate } from './schedule-native-completion-plan';
import { executeScheduleOccurrence } from './schedule-runtime';
import type { NativeScheduleCallerRequest } from './schedule-native-caller';
import { ConflictError } from '../../error';

/** Completion outcome from actual roots and descendants, sharing the durable occurrence's continuation key. */
export interface NativeScheduleAdvanceResult {
  readonly completed: boolean;
  readonly nextOccurrenceId: string | null;
}
function actualCompletionAt(
  facts: NativeScheduleFacts,
  completedInstants: readonly (string | null)[],
): Date {
  if (facts.occurrence.completedAt) return facts.occurrence.completedAt;
  const times = completedInstants.flatMap((instant) =>
    instant ? [new Date(instant).getTime()] : [],
  );
  if (
    facts.document.kind === 'forest' &&
    facts.document.revision === 2 &&
    facts.document.completionPolicy.kind === 'legacy_authored_tasks'
  )
    return new Date(times.length ? Math.max(...times) : Date.now());
  // A Project's status transition has no independent completion timestamp; this durable run records it once.
  return new Date(
    facts.roots.some((root) => root.kind === 'project') || times.length === 0
      ? Date.now()
      : Math.max(...times),
  );
}
async function continueCompletedSchedule(
  database: Database,
  organizationId: string,
  facts: NativeScheduleFacts,
  completedAt: Date,
): Promise<string | null> {
  const existing = await existingContinuation(database, organizationId, facts);
  if (existing) return existing;
  const revision = facts.revision;
  if (
    facts.series.status !== 'active' ||
    facts.series.archivedAt ||
    revision.triggerKind !== 'after_completion' ||
    revision.interval === null ||
    revision.intervalUnit === null
  )
    return null;
  const scheduledFor = nativeNextCompletionDate(
    completedAt.toISOString(),
    facts.timezone,
    revision.interval,
    revision.intervalUnit,
  );
  const [next] = await database
    .select({ id: recurrenceSeriesRevision.id })
    .from(recurrenceSeriesRevision)
    .where(
      and(
        eq(recurrenceSeriesRevision.seriesId, facts.series.id),
        eq(recurrenceSeriesRevision.organizationId, organizationId),
        lte(recurrenceSeriesRevision.effectiveFrom, scheduledFor),
      ),
    )
    .orderBy(desc(recurrenceSeriesRevision.effectiveFrom), desc(recurrenceSeriesRevision.number))
    .limit(1);
  if (!next) return null;
  try {
    const result = await executeScheduleOccurrence(database, {
      organizationId,
      seriesId: facts.series.id,
      seriesRevisionId: next.id,
      scheduledFor,
      continuedFromOccurrenceId: facts.occurrence.id,
    });
    return result.occurrenceId;
  } catch (error) {
    // A competing continuation can reserve a later attempt between the lookup
    // and execution phases. Reuse only the same durable unique successor; the
    // executor retains its stale-attempt CAS and failure/recovery behavior.
    if (!(error instanceof ConflictError)) throw error;
    const concurrent = await existingContinuation(database, organizationId, facts);
    if (!concurrent) throw error;
    return concurrent;
  }
}
async function existingContinuation(
  database: Database,
  organizationId: string,
  facts: NativeScheduleFacts,
): Promise<string | null> {
  const [existing] = await database
    .select({ id: processOccurrence.id })
    .from(processOccurrence)
    .where(
      and(
        eq(processOccurrence.organizationId, organizationId),
        eq(processOccurrence.seriesId, facts.series.id),
        eq(processOccurrence.continuedFromOccurrenceId, facts.occurrence.id),
      ),
    )
    .limit(1);
  return existing?.id ?? null;
}
/** Persist actual completion once, then advance outside that transaction through accepted native claims. */
export async function advanceNativeScheduleOccurrence(
  database: Database,
  input: NativeScheduleCallerRequest & { readonly occurrenceId: string },
): Promise<NativeScheduleAdvanceResult> {
  const transition = await database.transaction(async (tx) => {
    const facts = await authorizeNativeScheduleOccurrence(tx, input);
    if (facts.occurrence.status === 'canceled') return null;
    if (facts.occurrence.status === 'completed' && facts.occurrence.completedAt)
      return { facts, completedAt: facts.occurrence.completedAt };
    const status = await readNativeScheduleStatus(tx, facts);
    const state = status.state;
    if (state === 'open') return null;
    if (state === 'canceled') {
      await tx
        .update(processOccurrence)
        .set({ status: 'canceled', resolvedAt: new Date() })
        .where(eq(processOccurrence.id, facts.occurrence.id));
      return null;
    }
    const completedAt = actualCompletionAt(facts, [status.completedAt]);
    if (facts.occurrence.status !== 'completed')
      await tx
        .update(processOccurrence)
        .set({ status: 'completed', completedAt, resolvedAt: completedAt })
        .where(eq(processOccurrence.id, facts.occurrence.id));
    return { facts, completedAt };
  });
  return transition
    ? {
        completed: true,
        nextOccurrenceId: await continueCompletedSchedule(
          database,
          input.organizationId,
          transition.facts,
          transition.completedAt,
        ),
      }
    : { completed: false, nextOccurrenceId: null };
}
/** Dispatch one actual Task or Project transition before the legacy compatibility instance adapter. */
export async function advanceNativeScheduleWork(
  database: Database,
  input: {
    readonly organizationId: string;
    readonly actorId?: string | undefined;
    readonly work: { readonly kind: 'task' | 'project'; readonly id: string };
  },
): Promise<NativeScheduleAdvanceResult | null> {
  const occurrenceId = await findNativeScheduleOccurrence(
    database,
    input.organizationId,
    input.work,
  );
  return occurrenceId
    ? advanceNativeScheduleOccurrence(database, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        ...(input.actorId ? { initiatingWork: input.work } : {}),
        occurrenceId,
      })
    : null;
}

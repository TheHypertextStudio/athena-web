/**
 * `time/reporting` — immutable, recipient-scoped Time Ledger report snapshots.
 *
 * @remarks
 * Reporting is deliberately separate from live commands: it reads current personal facts, then
 * persists an explicit snapshot. Workspace recipients never receive raw Hub ids or private record
 * identifiers through this module.
 */
import { db, timeRecord, timeSubmission, timeSubmissionItem } from '@docket/db';
import type {
  TimeRecordOut,
  TimeSubmissionCreate,
  TimeSubmissionOut,
  TimeSubmissionRecipientOut,
} from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../error';
import { assertOrganizationReadable, resolveTimeHubId } from './access';
import { hydrateTimeRecords, measureRecordInRange } from './read-models';

type TimeRecordInput = z.input<typeof TimeRecordOut>;
type TimeSubmissionInput = z.input<typeof TimeSubmissionOut>;
type TimeSubmissionRecipientInput = z.input<typeof TimeSubmissionRecipientOut>;

/** Load a record under its Hub boundary or hide it as not found. */
async function getOwnedRecord(id: string, hubId: string): Promise<typeof timeRecord.$inferSelect> {
  const rows = await db
    .select()
    .from(timeRecord)
    .where(and(eq(timeRecord.id, id), eq(timeRecord.hubId, hubId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Time record not found');
  return row;
}

/** Serialize a submission with its immutable reportable credits. */
async function toTimeSubmissionOut(
  submission: typeof timeSubmission.$inferSelect,
): Promise<TimeSubmissionInput> {
  const items = await db
    .select()
    .from(timeSubmissionItem)
    .where(eq(timeSubmissionItem.submissionId, submission.id))
    .orderBy(asc(timeSubmissionItem.createdAt));
  return {
    id: submission.id,
    hubId: submission.hubId,
    organizationId: submission.organizationId,
    status: submission.status,
    periodStartsAt: submission.periodStartsAt.toISOString(),
    periodEndsAt: submission.periodEndsAt.toISOString(),
    timezone: submission.timezone,
    measure: submission.measure as TimeSubmissionInput['measure'],
    roundingPolicy: submission.roundingPolicy,
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    withdrawnAt: submission.withdrawnAt?.toISOString() ?? null,
    createdAt: submission.createdAt.toISOString(),
    items: items.map((item) => ({
      id: item.id,
      timeRecordId: item.timeRecordId,
      allocationId: item.allocationId,
      targetKind: item.targetKind,
      targetId: item.targetId,
      basisPoints: item.basisPoints,
      durationMs: item.durationMs,
    })),
  };
}

/** Extract the one visible duration a report chose from a record's labeled measures. */
function submissionDuration(
  record: TimeRecordInput,
  measure: TimeSubmissionCreate['measure'],
): number {
  switch (measure) {
    case 'human_effort':
      return record.measures.humanEffortMs;
    case 'agent_effort':
      return record.measures.agentEffortMs;
    case 'combined_effort':
      return record.measures.combinedEffortMs;
    case 'elapsed_delivery':
      return record.measures.elapsedMs;
  }
}

/** Create an immutable explicit reporting snapshot from caller-owned, fully allocated records. */
export async function createTimeSubmission(
  userId: string,
  input: TimeSubmissionCreate,
): Promise<TimeSubmissionInput> {
  const hubId = await resolveTimeHubId(userId);
  if (input.organizationId) await assertOrganizationReadable(userId, input.organizationId);
  const ownedRows = await Promise.all(input.timeRecordIds.map((id) => getOwnedRecord(id, hubId)));
  const records = await hydrateTimeRecords(ownedRows, userId);
  const allocationsByRecord = records.map((record) => ({
    record,
    allocations: input.organizationId
      ? record.allocations.filter(
          (allocation) => allocation.organizationId === input.organizationId,
        )
      : record.allocations,
  }));
  const notReportable = allocationsByRecord.find(({ allocations }) => allocations.length === 0);
  if (notReportable) {
    throw new ConflictError(
      input.organizationId
        ? 'Every submitted record needs an allocation in the selected workspace'
        : 'Every submitted time record must have explicit allocations',
    );
  }
  const now = new Date();
  const [submission] = await db
    .insert(timeSubmission)
    .values({
      hubId,
      submittedByUserId: userId,
      organizationId: input.organizationId ?? null,
      status: 'submitted',
      periodStartsAt: new Date(input.periodStartsAt),
      periodEndsAt: new Date(input.periodEndsAt),
      timezone: input.timezone,
      measure: input.measure,
      roundingPolicy: input.roundingPolicy,
      submittedAt: now,
    })
    .returning();
  if (!submission) throw new Error('time submission insert returned no row');
  const periodStart = new Date(input.periodStartsAt);
  const periodEnd = new Date(input.periodEndsAt);
  const items = allocationsByRecord.flatMap(({ record, allocations }) => {
    const duration = submissionDuration(
      { ...record, measures: measureRecordInRange(record, periodStart, periodEnd, now) },
      input.measure,
    );
    return allocations.map((allocation) => ({
      submissionId: submission.id,
      timeRecordId: record.id,
      allocationId: allocation.id,
      targetKind: allocation.targetKind,
      targetId: allocation.targetId,
      basisPoints: allocation.basisPoints,
      durationMs: Math.floor((duration * allocation.basisPoints) / 10_000),
    }));
  });
  if (items.length > 0) await db.insert(timeSubmissionItem).values(items);
  return toTimeSubmissionOut(submission);
}

/** Read a personal submission under the caller's Hub boundary. */
export async function getTimeSubmission(userId: string, id: string): Promise<TimeSubmissionInput> {
  const hubId = await resolveTimeHubId(userId);
  const rows = await db
    .select()
    .from(timeSubmission)
    .where(and(eq(timeSubmission.id, id), eq(timeSubmission.hubId, hubId)))
    .limit(1);
  const submission = rows[0];
  if (!submission) throw new NotFoundError('Time submission not found');
  return toTimeSubmissionOut(submission);
}

/** Read recipient-safe snapshots an organization can see without exposing personal record data. */
export async function listOrganizationTimeSubmissions(
  organizationId: string,
): Promise<TimeSubmissionRecipientInput[]> {
  const submissions = await db
    .select()
    .from(timeSubmission)
    .where(
      and(
        eq(timeSubmission.organizationId, organizationId),
        eq(timeSubmission.status, 'submitted'),
      ),
    )
    .orderBy(asc(timeSubmission.periodStartsAt));
  return Promise.all(
    submissions.map(async (submission) => {
      const items = await db
        .select({
          targetKind: timeSubmissionItem.targetKind,
          targetId: timeSubmissionItem.targetId,
          basisPoints: timeSubmissionItem.basisPoints,
          durationMs: timeSubmissionItem.durationMs,
        })
        .from(timeSubmissionItem)
        .where(eq(timeSubmissionItem.submissionId, submission.id))
        .orderBy(asc(timeSubmissionItem.createdAt));
      if (!submission.organizationId || !submission.submittedAt) {
        throw new NotFoundError('Submitted time report not found');
      }
      return {
        id: submission.id,
        organizationId: submission.organizationId,
        status: 'submitted',
        periodStartsAt: submission.periodStartsAt.toISOString(),
        periodEndsAt: submission.periodEndsAt.toISOString(),
        timezone: submission.timezone,
        measure: submission.measure as TimeSubmissionRecipientInput['measure'],
        roundingPolicy: submission.roundingPolicy,
        submittedAt: submission.submittedAt.toISOString(),
        items,
      };
    }),
  );
}

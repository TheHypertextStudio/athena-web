import { and, asc, eq, inArray, lte } from 'drizzle-orm';

import { projectSearchDocumentFromSource } from './registry';
import type { SearchDocumentDraft } from './types';

/** Options controlling one search-index worker batch. */
export interface ProcessSearchIndexJobsOptions {
  limit?: number;
  now?: Date;
}

/** Processing counts returned by one search-index worker batch. */
export interface ProcessSearchIndexJobsResult {
  processed: number;
  succeeded: number;
  failed: number;
}

/** Lease and process pending search index jobs. */
export async function processSearchIndexJobs(
  options: ProcessSearchIndexJobsOptions = {},
): Promise<ProcessSearchIndexJobsResult> {
  const schema = await import('@docket/db');
  const now = options.now ?? new Date();
  const limit = options.limit ?? 25;
  const jobs = await schema.db
    .select()
    .from(schema.searchIndexJob)
    .where(
      and(
        inArray(schema.searchIndexJob.status, ['pending', 'failed']),
        lte(schema.searchIndexJob.runAfter, now),
      ),
    )
    .orderBy(asc(schema.searchIndexJob.createdAt))
    .limit(limit);

  let succeeded = 0;
  let failed = 0;
  for (const job of jobs) {
    await schema.db
      .update(schema.searchIndexJob)
      .set({ status: 'processing', lockedAt: now })
      .where(eq(schema.searchIndexJob.id, job.id));

    try {
      if (job.operation === 'delete') {
        await schema.db
          .update(schema.searchDocument)
          .set({ archivedAt: now, updatedAt: now })
          .where(
            and(
              eq(schema.searchDocument.sourceTable, job.sourceTable),
              eq(schema.searchDocument.entityId, job.entityId),
            ),
          );
      } else {
        const draft = await projectSearchDocumentFromSource(job.sourceTable, job.entityId);
        if (!draft) throw new Error(`Source row not found: ${job.sourceTable}:${job.entityId}`);
        await upsertSearchDocument(draft, now);
      }

      await schema.db
        .update(schema.searchIndexJob)
        .set({ status: 'succeeded', processedAt: now, lockedAt: null, lastError: null })
        .where(eq(schema.searchIndexJob.id, job.id));
      succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = job.attempts + 1;
      const retryMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
      await schema.db
        .update(schema.searchIndexJob)
        .set({
          status: 'failed',
          attempts,
          lockedAt: null,
          lastError: message,
          runAfter: new Date(now.getTime() + retryMs),
        })
        .where(eq(schema.searchIndexJob.id, job.id));
      failed += 1;
    }
  }

  return { processed: jobs.length, succeeded, failed };
}

async function upsertSearchDocument(draft: SearchDocumentDraft, now: Date): Promise<void> {
  const schema = await import('@docket/db');
  await schema.db
    .insert(schema.searchDocument)
    .values({
      ...draft,
      indexedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.searchDocument.id,
      set: {
        organizationId: draft.organizationId,
        userId: draft.userId,
        kind: draft.kind,
        family: draft.family,
        sourceTable: draft.sourceTable,
        entityId: draft.entityId,
        subjectKind: draft.subjectKind,
        subjectId: draft.subjectId,
        sourceSystem: draft.sourceSystem,
        externalUrl: draft.externalUrl,
        title: draft.title,
        summary: draft.summary,
        body: draft.body,
        facet: draft.facet,
        route: draft.route,
        visibility: draft.visibility,
        baseRank: draft.baseRank,
        occurredAt: draft.occurredAt,
        sourceUpdatedAt: draft.sourceUpdatedAt,
        indexedAt: now,
        updatedAt: now,
        archivedAt: draft.archivedAt,
      },
    });
}

import type { SyncJobOut } from '@docket/types';
import type { z } from 'zod';

/**
 * A sync/import job, materialized in-process from a {@link Connector} run.
 *
 * @remarks
 * The data model carries no `sync_job` table; a job is the auditable record of one
 * `Connector.importWork` run. Retained in a process-scoped registry for follow-up
 * status reads. Scoped by `organizationId` for tenant isolation.
 */
export interface SyncJob {
  readonly jobId: string;
  readonly organizationId: string;
  readonly integrationId: string;
  readonly status: z.infer<typeof SyncJobOut>['status'];
  readonly processed: number;
  readonly total: number;
  readonly error: string | null;
  readonly createdAt: string;
}

/**
 * Process-scoped registry of {@link SyncJob}s.
 *
 * @remarks
 * In-memory because the data model has no `sync_job` table. A monotonic counter yields
 * deterministic, collision-free job ids within a process.
 */
export const SYNC_JOBS = new Map<string, SyncJob>();
let syncJobCounter = 0;

/** Evict jobs older than 24 hours to prevent unbounded Map growth. */
function pruneOldJobs(): void {
  const cutoff = Date.now() - 86_400_000;
  for (const [id, job] of SYNC_JOBS) {
    if (new Date(job.createdAt).getTime() < cutoff) SYNC_JOBS.delete(id);
  }
}

/** Mint the next process-unique sync-job id, evicting stale entries first. */
export function nextSyncJobId(): string {
  pruneOldJobs();
  syncJobCounter += 1;
  return `syncjob_${syncJobCounter.toString().padStart(8, '0')}`;
}

/** Serialize a {@link SyncJob} to its {@link SyncJobOut} representation. */
export function toSyncJobOut(job: SyncJob): z.input<typeof SyncJobOut> {
  return {
    jobId: job.jobId,
    integrationId: job.integrationId,
    status: job.status,
    processed: job.processed,
    total: job.total,
    error: job.error,
    createdAt: job.createdAt,
  };
}

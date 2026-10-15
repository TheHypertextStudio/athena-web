import { canActor } from '@docket/authz';
import { processOccurrence, type Database } from '@docket/db';
import {
  WorkScheduleRunOut,
  WorkScheduleRunPage,
  type WorkScheduleFailureCode,
} from '@docket/work/work-schedule-management';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { NotFoundError } from '../../error';
import { pageResultById, seekAfterId } from '../list-cursor';
import { requireScheduleAccess, type ScheduleAccessRequest } from './schedule-access';
import { canRetryScheduleOccurrence } from './schedule-run-recovery';

const failureCodes: Readonly<Record<string, WorkScheduleFailureCode>> = {
  schedule_permission_changed: 'permission_changed',
  schedule_unavailable: 'template_unavailable',
  schedule_invalid: 'invalid_work',
  schedule_limit: 'work_limit',
  schedule_execution_failed: 'creation_failed',
};
/** Serialize only owned failure classifications, never stored legacy exception details. */
export function publicScheduleFailure(code: string | null): WorkScheduleFailureCode | null {
  return code === null ? null : (failureCodes[code] ?? 'creation_failed');
}
/** Count outstanding failures after the enclosing read has authorized this private schedule. */
export async function countUnresolvedScheduleRuns(
  database: Database,
  input: ScheduleAccessRequest,
): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(processOccurrence)
    .where(
      and(
        eq(processOccurrence.organizationId, input.organizationId),
        eq(processOccurrence.seriesId, input.seriesId),
        eq(processOccurrence.runKind, 'scheduled'),
        inArray(processOccurrence.status, ['failed', 'needs_resolution']),
      ),
    );
  return row?.count ?? 0;
}
async function serializeRun(
  database: Database,
  input: ScheduleAccessRequest,
  row: typeof processOccurrence.$inferSelect,
  canEdit: boolean,
): Promise<WorkScheduleRunOut> {
  const visible = await Promise.all(
    (row.blueprintRootRefs ?? []).map(async (root) => {
      const decision = await canActor(
        input.actorId,
        'view',
        { kind: root.kind, id: root.id, orgId: input.organizationId },
        database,
      );
      return decision.allow ? root : null;
    }),
  );
  const roots = visible.filter((root) => root !== null);
  const templates = new Map(
    roots.flatMap((root) =>
      (root.resolvedManifest ?? [])
        .filter((version) => version.path.length === 0)
        .map(
          (version) =>
            [
              version.versionId,
              { workTypeId: version.workTypeId, workTypeVersionId: version.versionId },
            ] as const,
        ),
    ),
  );
  return WorkScheduleRunOut.parse({
    id: row.id,
    seriesId: row.seriesId,
    scheduledFor: row.scheduledFor,
    originalScheduledFor: row.originalScheduledFor,
    status: row.status,
    attempt: row.attempt,
    failureCode: publicScheduleFailure(row.failureCode),
    failedAt: row.failedAt?.toISOString() ?? null,
    retryAvailableAt: row.retryAvailableAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    canRetry: canEdit && canRetryScheduleOccurrence(row),
    roots: roots.map(({ kind, id }) => ({ kind, id })),
    templates: [...templates.values()],
  });
}
/** Load one tenant-qualified run only after authorizing its actual owning schedule. */
export async function loadWorkScheduleRun(
  database: Database,
  input: ScheduleAccessRequest,
  occurrenceId: string,
): Promise<WorkScheduleRunOut> {
  const { canEdit, series } = await requireScheduleAccess(database, input);
  const [row] = await database
    .select()
    .from(processOccurrence)
    .where(
      and(
        eq(processOccurrence.id, occurrenceId),
        eq(processOccurrence.organizationId, input.organizationId),
        eq(processOccurrence.seriesId, input.seriesId),
        eq(processOccurrence.runKind, 'scheduled'),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Run not found');
  return serializeRun(database, input, row, canEdit && series.status === 'active');
}
/** Read a bounded newest-first run page without exposing private source aliases or documents. */
export async function listWorkScheduleRuns(
  database: Database,
  input: ScheduleAccessRequest,
  page: { readonly limit: number; readonly cursor?: string | undefined },
): Promise<WorkScheduleRunPage> {
  const { canEdit, series } = await requireScheduleAccess(database, input);
  const rows = await database
    .select()
    .from(processOccurrence)
    .where(
      and(
        eq(processOccurrence.organizationId, input.organizationId),
        eq(processOccurrence.seriesId, input.seriesId),
        eq(processOccurrence.runKind, 'scheduled'),
        seekAfterId(processOccurrence.id, page.cursor, 'desc'),
      ),
    )
    .orderBy(desc(processOccurrence.id))
    .limit(page.limit + 1);
  const selected = pageResultById(rows, page.limit);
  return WorkScheduleRunPage.parse({
    ...selected,
    items: await Promise.all(
      selected.items.map((row) =>
        serializeRun(database, input, row, canEdit && series.status === 'active'),
      ),
    ),
  });
}

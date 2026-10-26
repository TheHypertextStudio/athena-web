import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';

/** One schedule-managed date's ownership, whichever path recorded it. */
export interface GeneratedDateOwnership {
  readonly field: string;
  readonly manual: boolean;
  readonly lastDerivedDate: string | null;
}

/**
 * Date ownership for one generated work item: retained rows, or the canonical occurrence's
 * native ownership entries.
 */
export async function generatedDateOwnership(
  schema: typeof DbModule,
  organizationId: string,
  workId: string,
): Promise<GeneratedDateOwnership[]> {
  const retained = await schema.db
    .select()
    .from(schema.retainedDateOwnership)
    .where(
      and(
        eq(schema.retainedDateOwnership.organizationId, organizationId),
        eq(schema.retainedDateOwnership.workId, workId),
      ),
    );
  if (retained.length)
    return retained.map((row) => ({
      field: row.field,
      manual: row.manual,
      lastDerivedDate: row.lastDerivedDate,
    }));
  const occurrences = await schema.db
    .select({ ownership: schema.processOccurrence.scheduleDateOwnership })
    .from(schema.processOccurrence)
    .where(eq(schema.processOccurrence.organizationId, organizationId));
  return occurrences.flatMap(({ ownership }) =>
    (ownership ?? [])
      .filter((entry) => entry.id === workId)
      .map((entry) => ({
        field: entry.field,
        manual: entry.manual,
        lastDerivedDate: entry.lastDerivedDate,
      })),
  );
}

/** Which generated runs to read: one run by its compatibility instance id, or every run in a workspace. */
export interface GeneratedWorkScope {
  readonly organizationId: string;
  readonly instanceId?: string | undefined;
}

/**
 * Task ids a schedule run generated, on either the retained or the canonical path.
 * Retained runs map Tasks through process instances; canonical runs record them on the occurrence,
 * whose id is also the run's compatibility instance id.
 */
export async function generatedTaskIds(
  schema: typeof DbModule,
  scope: GeneratedWorkScope,
): Promise<string[]> {
  const retained = await schema.db
    .select({ id: schema.processInstanceTask.taskId })
    .from(schema.processInstanceTask)
    .where(
      and(
        eq(schema.processInstanceTask.organizationId, scope.organizationId),
        ...(scope.instanceId ? [eq(schema.processInstanceTask.instanceId, scope.instanceId)] : []),
      ),
    );
  const occurrences = await schema.db
    .select({ roots: schema.processOccurrence.blueprintRootRefs })
    .from(schema.processOccurrence)
    .where(
      and(
        eq(schema.processOccurrence.organizationId, scope.organizationId),
        ...(scope.instanceId ? [eq(schema.processOccurrence.id, scope.instanceId)] : []),
      ),
    );
  const canonical = occurrences.flatMap(({ roots }) =>
    (roots ?? []).flatMap((root) => [
      ...(root.kind === 'task' ? [root.id] : []),
      ...(root.selectedWork ?? [])
        .filter((work) => work.kind === 'task' && work.path.length > 0)
        .map((work) => work.id),
    ]),
  );
  return [...new Set([...retained.map((row) => row.id), ...canonical])];
}

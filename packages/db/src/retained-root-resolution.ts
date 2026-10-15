import { ResolvedVersionAtPath } from '@docket/work/work-template-blueprint';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client';
import { processOccurrence } from './schema/recurrence';
import { migrationRows } from './work-template-blueprint-migration/query';

/** Exact checked original root, supplied only after opaque occurrence authority validation. */
export interface RetainedRootResolutionScope {
  readonly organizationId: string;
  readonly occurrenceId: string;
  readonly invocationId: string;
  readonly sourceKey: string;
  readonly kind: 'task' | 'project';
  readonly workId: string;
}
type Connection = Pick<Database, 'select' | 'update' | 'execute'>;
/** Recover and freeze an applied old root only from its exact original recurrence creation receipt. */
export async function recoverRetainedRootResolution(
  tx: Connection,
  scope: RetainedRootResolutionScope,
): Promise<readonly ResolvedVersionAtPath[] | undefined> {
  const where = and(
    eq(processOccurrence.organizationId, scope.organizationId),
    eq(processOccurrence.id, scope.occurrenceId),
    eq(processOccurrence.blueprintInvocationId, scope.invocationId),
  );
  const [occurrence] = await tx
    .select({
      roots: processOccurrence.blueprintRootRefs,
      appliedAt: processOccurrence.blueprintAppliedAt,
    })
    .from(processOccurrence)
    .where(where)
    .limit(1)
    .for('update');
  const ref = occurrence?.roots?.find(
    (root) => root.key === scope.sourceKey && root.kind === scope.kind && root.id === scope.workId,
  );
  if (!ref || !occurrence) return undefined;
  if (ref.resolvedManifest) return ref.resolvedManifest;
  if (!occurrence.appliedAt) return undefined;
  const [proof] = await migrationRows<{ manifest: unknown }>(
    tx,
    sql`select docket_retained_root_receipt_manifest(${scope.organizationId},${scope.occurrenceId},${JSON.stringify(ref)}::jsonb) as manifest`,
  );
  if (proof?.manifest == null) return undefined;
  const parsed = ResolvedVersionAtPath.array().min(1).max(500).safeParse(proof.manifest);
  if (!parsed.success) throw new Error('Original retained resolution receipt is invalid.');
  await tx
    .update(processOccurrence)
    .set({
      blueprintRootRefs: freezeRecoveredManifest(occurrence.roots, ref, parsed.data),
    })
    .where(where);
  return parsed.data;
}

function freezeRecoveredManifest(
  roots: typeof processOccurrence.$inferSelect.blueprintRootRefs,
  ref: NonNullable<typeof processOccurrence.$inferSelect.blueprintRootRefs>[number],
  manifest: readonly ResolvedVersionAtPath[],
): NonNullable<typeof processOccurrence.$inferSelect.blueprintRootRefs> {
  return (roots ?? []).map((root) =>
    root === ref ? { ...root, resolvedManifest: manifest } : root,
  );
}

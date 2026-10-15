import { template, workTypeVersion } from '@docket/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from './change-set';

/** A checked existing receipt's prior identity; caller must first verify the recorded after-state. */
export interface RecordedIdentityBefore {
  readonly entityKind: string;
  readonly before: Record<string, unknown> | null;
}
/** Authorize only exact same-tenant/kind archived pairs recorded before an undoable mutation. */
export async function authorizeRecordedIdentities(
  tx: Tx,
  orgId: string,
  entries: readonly RecordedIdentityBefore[],
): Promise<void> {
  const requested = entries.flatMap((entry) => {
    const id = entry.before?.['workTypeId'],
      version = entry.before?.['workTypeVersionId'];
    return ['task', 'project', 'program', 'initiative'].includes(entry.entityKind) &&
      typeof id === 'string' &&
      typeof version === 'string'
      ? [{ kind: entry.entityKind, id, version }]
      : [];
  });
  if (!requested.length) return;
  const versions = await tx
    .select({ workTypeId: template.id, versionId: workTypeVersion.id, kind: template.targetType })
    .from(workTypeVersion)
    .innerJoin(
      template,
      and(eq(template.id, workTypeVersion.workTypeId), eq(template.organizationId, orgId)),
    )
    .where(
      and(
        eq(workTypeVersion.organizationId, orgId),
        inArray(
          workTypeVersion.id,
          requested.map((pair) => pair.version),
        ),
        eq(template.scope, 'organization'),
        eq(template.publicationState, 'archived'),
      ),
    );
  const exact = new Set(requested.map((pair) => `${pair.kind}:${pair.id}:${pair.version}`));
  const allowed = versions
    .filter((pair) => exact.has(`${pair.kind}:${pair.workTypeId}:${pair.versionId}`))
    .map(({ workTypeId, versionId }) => ({ workTypeId, versionId }));
  if (!allowed.length) return;
  await tx.execute(
    sql`select set_config('docket.work_template_authorized_archived_versions',(coalesce(nullif(current_setting('docket.work_template_authorized_archived_versions',true),''),'[]')::jsonb || ${JSON.stringify(allowed)}::jsonb)::text,true)`,
  );
}

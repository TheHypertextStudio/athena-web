import { blueprintConversion, blueprintInvocation } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
/** Bind a new schedule revision to its exact published canonical private invocation. */
export async function recurrenceBlueprintBinding(
  tx: TemplateTransaction,
  organizationId: string,
  processRevisionId: string,
): Promise<{
  blueprintInvocationId: string;
  workTypeId: string | null;
  workTypeVersionId: string | null;
}> {
  const [row] = await tx
    .select({ invocation: blueprintInvocation })
    .from(blueprintConversion)
    .innerJoin(
      blueprintInvocation,
      and(
        eq(blueprintInvocation.id, blueprintConversion.invocationId),
        eq(blueprintInvocation.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(blueprintConversion.organizationId, organizationId),
        eq(blueprintConversion.legacyProcessRevisionId, processRevisionId),
      ),
    )
    .limit(1);
  if (!row) throw new ConflictError('Publish the process before scheduling it.');
  const manifest = row.invocation.manifest;
  if (
    manifest.kind !== 'published' ||
    manifest.legacyProcessRevisionId !== processRevisionId ||
    !manifest.roots.length
  )
    throw new ConflictError('Publish the process before scheduling it.');
  const root = manifest.roots.length === 1 ? manifest.roots[0] : undefined;
  return {
    blueprintInvocationId: row.invocation.id,
    workTypeId: root?.workTypeId ?? null,
    workTypeVersionId: root?.workTypeVersionId ?? null,
  };
}

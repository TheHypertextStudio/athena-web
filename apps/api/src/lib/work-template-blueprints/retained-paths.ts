import { blueprintStep, type BlueprintInvocationStep } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import {
  requireRetainedOccurrenceAuthority,
  type RetainedOccurrenceAuthority,
} from '../work-creation/retained-authority';
/** Resolve immutable projection coordinates independently of historical physical-hierarchy paths. */
export async function retainedBlueprintSources(
  tx: TemplateTransaction,
  authority: RetainedOccurrenceAuthority,
): Promise<readonly BlueprintInvocationStep[]> {
  const facts = requireRetainedOccurrenceAuthority(tx, authority);
  const ids = facts.manifest.steps.flatMap((source) =>
    source.blueprintStepId ? [source.blueprintStepId] : [],
  );
  const rows = ids.length
    ? await tx
        .select()
        .from(blueprintStep)
        .where(
          and(
            eq(blueprintStep.organizationId, facts.organizationId),
            inArray(blueprintStep.id, ids),
          ),
        )
    : [];
  const projections = new Map(rows.map((row) => [row.id, row]));
  return facts.manifest.steps.map((source) => {
    if (!source.blueprintStepId) {
      if (source.path.length) throw new ConflictError('Retained blueprint projection changed');
      return source;
    }
    const projection = projections.get(source.blueprintStepId);
    const root = facts.manifest.roots.find((value) => value.key === source.rootKey);
    if (
      projection?.versionId !== source.sourceVersionId ||
      root?.workTypeVersionId !== projection.versionId
    )
      throw new ConflictError('Retained blueprint projection changed');
    return { ...source, path: [projection.key] };
  });
}

import { blueprintStep, type BlueprintOccurrenceRoot } from '@docket/db';
import { BlueprintError } from '@docket/work/blueprints';
import { and, eq, or } from 'drizzle-orm';
import type { TemplateTransaction } from '../templates/persistence';

/** Exact saved source projection for one actual selected descendant. */
export interface NativeOriginReference {
  readonly id: string;
  readonly kind: string;
  readonly versionId: string;
  readonly key: string;
}
/** Bound source reads to selected exact scope/step pairs; unselected optional definitions grant no authority. */
export function nativeOriginReferences(
  roots: readonly BlueprintOccurrenceRoot[],
): NativeOriginReference[] {
  return roots.flatMap((root) =>
    (root.selectedWork ?? []).flatMap((work) => {
      if (!work.path.length) return [];
      const scope = work.path.slice(0, -1);
      const publication = root.resolvedManifest?.find(
        (entry) => JSON.stringify(entry.path) === JSON.stringify(scope),
      );
      const key = work.path.at(-1);
      if (!publication || !key)
        throw new BlueprintError('blueprint_invalid', 'Missing accepted native source scope.');
      return [{ id: work.id, kind: work.kind, versionId: publication.versionId, key }];
    }),
  );
}
/** Exact publication/step origin pairs eligible at each immutable actual selected path. */
export async function loadNativeScheduleOrigins(
  tx: TemplateTransaction,
  organizationId: string,
  roots: readonly BlueprintOccurrenceRoot[],
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const references = nativeOriginReferences(roots);
  const steps = references.length
    ? await tx
        .select({
          id: blueprintStep.id,
          versionId: blueprintStep.versionId,
          kind: blueprintStep.kind,
          key: blueprintStep.key,
        })
        .from(blueprintStep)
        .where(
          and(
            eq(blueprintStep.organizationId, organizationId),
            or(
              ...references.map((ref) =>
                and(eq(blueprintStep.versionId, ref.versionId), eq(blueprintStep.key, ref.key)),
              ),
            ),
          ),
        )
    : [];
  return new Map(
    references.map((ref) => [
      ref.id,
      new Set(
        steps
          .filter(
            (step) =>
              step.versionId === ref.versionId && step.key === ref.key && step.kind === ref.kind,
          )
          .map((step) => `${step.versionId}:${step.id}`),
      ),
    ]),
  );
}

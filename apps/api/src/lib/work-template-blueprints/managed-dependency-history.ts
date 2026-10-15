import { changeSet, changeSetEntry } from '@docket/db';
import { BlueprintState } from '@docket/work/work-template-blueprint';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { edgeKey } from '../../mcp/change-set';
import type { TemplateTransaction } from '../templates/persistence';
import type { ManagedBlueprintDependency } from './managed-dependencies';
import type { AuthorizedBlueprintSnapshot } from './snapshot-types';

interface DependencyReceipt {
  readonly entry: typeof changeSetEntry.$inferSelect;
  readonly receiptId: string;
}

/** Read at most one latest live receipt per bounded concrete edge. */
export async function latestDependencyReceipts(
  tx: TemplateTransaction,
  orgId: string,
  edges: readonly ManagedBlueprintDependency[],
): Promise<readonly DependencyReceipt[]> {
  if (!edges.length) return [];
  return tx
    .selectDistinctOn([changeSetEntry.entityId], { entry: changeSetEntry, receiptId: changeSet.id })
    .from(changeSetEntry)
    .innerJoin(changeSet, eq(changeSet.id, changeSetEntry.changeSetId))
    .where(
      and(
        eq(changeSet.organizationId, orgId),
        eq(changeSetEntry.entityKind, 'blocks'),
        inArray(
          changeSetEntry.entityId,
          edges.map((edge) => edgeKey(edge.blockerId, edge.blockedId)),
        ),
        isNull(changeSet.undoneAt),
      ),
    )
    .orderBy(asc(changeSetEntry.entityId), desc(changeSet.createdAt), desc(changeSet.id));
}
function owns(
  value: Record<string, unknown> | null,
  edge: ManagedBlueprintDependency,
  generation: string,
): boolean {
  const state = BlueprintState.safeParse(value?.['blueprintState']);
  return (
    state.success &&
    state.data.generationKey === generation &&
    (state.data.managedDependencies ?? []).some(
      (saved) => saved.blockerId === edge.blockerId && saved.blockedId === edge.blockedId,
    )
  );
}
/** A person recreating an edge breaks its generated ownership, even if the endpoint IDs are identical. */
export async function loadSavedManagedDependencies(
  tx: TemplateTransaction,
  snapshot: AuthorizedBlueprintSnapshot,
  saved: readonly ManagedBlueprintDependency[],
): Promise<readonly ManagedBlueprintDependency[]> {
  const root = snapshot.rowsByRef.get(`${snapshot.root.kind}:${snapshot.root.id}`);
  const generation = root?.row.blueprintState?.generationKey;
  if (!generation || !saved.length) return [];
  const existing = new Set(
    snapshot.dependencies.map((edge) => edgeKey(edge.blockerId, edge.blockedId)),
  );
  const history = await latestDependencyReceipts(tx, snapshot.context.organizationId, saved);
  if (!history.length) return [];
  const roots = await tx
    .select()
    .from(changeSetEntry)
    .where(
      and(
        eq(changeSetEntry.entityKind, snapshot.root.kind),
        eq(changeSetEntry.entityId, snapshot.root.id),
        inArray(
          changeSetEntry.changeSetId,
          history.map((entry) => entry.receiptId),
        ),
      ),
    );
  return saved.filter((edge) => {
    const key = edgeKey(edge.blockerId, edge.blockedId);
    const latest = history.find(({ entry }) => entry.entityId === key);
    const owner = roots.find((entry) => entry.changeSetId === latest?.receiptId);
    return (
      existing.has(key) &&
      latest?.entry.after !== null &&
      Boolean(
        owner &&
        owns(owner.after, edge, generation) &&
        (owner.op === 'create' || !owns(owner.before, edge, generation)),
      )
    );
  });
}

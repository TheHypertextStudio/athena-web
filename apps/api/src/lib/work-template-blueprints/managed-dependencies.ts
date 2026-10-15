import { blueprintDependency, changeSet, changeSetEntry } from '@docket/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { edgeKey } from '../../mcp/change-set';
import type { TemplateTransaction } from '../templates/persistence';
import {
  latestDependencyReceipts,
  loadSavedManagedDependencies,
} from './managed-dependency-history';
import type { AuthorizedBlueprintSnapshot } from './snapshot-types';

/** Concrete generated edge ownership; this is invocation provenance, never reusable template placement. */
export interface ManagedBlueprintDependency {
  readonly blockerId: string;
  readonly blockedId: string;
}
function pair(value: Record<string, unknown> | null): ManagedBlueprintDependency | null {
  return typeof value?.['from'] === 'string' && typeof value['to'] === 'string'
    ? { blockerId: value['from'], blockedId: value['to'] }
    : null;
}
/** Read only actual edges recorded by this action and whose endpoints belong to its generated tree. */
export async function receiptManagedDependencies(
  tx: TemplateTransaction,
  receiptId: string,
  ids: ReadonlySet<string>,
): Promise<ManagedBlueprintDependency[]> {
  const entries = await tx
    .select({ after: changeSetEntry.after })
    .from(changeSetEntry)
    .where(and(eq(changeSetEntry.changeSetId, receiptId), eq(changeSetEntry.entityKind, 'blocks')))
    .orderBy(asc(changeSetEntry.entityId));
  return entries.flatMap((entry) => {
    const edge = pair(entry.after);
    return edge && ids.has(edge.blockerId) && ids.has(edge.blockedId) ? [edge] : [];
  });
}
async function originalRootReceipt(tx: TemplateTransaction, snapshot: AuthorizedBlueprintSnapshot) {
  const orgId = snapshot.context.organizationId;
  const creation = await tx
    .select({ id: changeSet.id })
    .from(changeSetEntry)
    .innerJoin(changeSet, eq(changeSet.id, changeSetEntry.changeSetId))
    .where(
      and(
        eq(changeSet.organizationId, orgId),
        eq(changeSetEntry.entityKind, snapshot.root.kind),
        eq(changeSetEntry.entityId, snapshot.root.id),
        eq(changeSetEntry.op, 'create'),
        isNull(changeSet.undoneAt),
      ),
    )
    .orderBy(asc(changeSet.createdAt))
    .limit(1);
  return creation[0]?.id;
}

/** Conservatively recover historical ownership only from original creation receipts and immutable authored edges. */
export async function loadManagedBlueprintDependencies(
  tx: TemplateTransaction,
  snapshot: AuthorizedBlueprintSnapshot,
): Promise<readonly ManagedBlueprintDependency[]> {
  const rootWork = snapshot.rowsByRef.get(`${snapshot.root.kind}:${snapshot.root.id}`);
  const saved = rootWork?.row.blueprintState?.managedDependencies;
  if (saved) return loadSavedManagedDependencies(tx, snapshot, saved);
  const orgId = snapshot.context.organizationId;
  const receiptId = await originalRootReceipt(tx, snapshot);
  if (!receiptId) return [];
  const ids = new Set(snapshot.nodes.map((node) => node.id));
  const candidates = await receiptManagedDependencies(tx, receiptId, ids);
  if (!candidates.length) return [];
  const versions = [
    ...new Set(
      [...snapshot.rowsByRef.values()].flatMap((work) =>
        work.row.blueprintSourceVersionId ? [work.row.blueprintSourceVersionId] : [],
      ),
    ),
  ];
  const authored = versions.length
    ? await tx
        .select()
        .from(blueprintDependency)
        .where(
          and(
            eq(blueprintDependency.organizationId, orgId),
            inArray(blueprintDependency.versionId, versions),
          ),
        )
    : [];
  const existing = new Set(
    snapshot.dependencies.map((edge) => edgeKey(edge.blockerId, edge.blockedId)),
  );
  const endpoint = new Map([...snapshot.rowsByRef.values()].map((work) => [work.id, work.row]));
  const history = await latestDependencyReceipts(tx, orgId, candidates);
  return candidates.filter((edge) => {
    const blocker = endpoint.get(edge.blockerId),
      blocked = endpoint.get(edge.blockedId);
    const key = edgeKey(edge.blockerId, edge.blockedId);
    const latest = history.find(({ entry }) => entry.entityId === key);
    return (
      existing.has(key) &&
      latest?.receiptId === receiptId &&
      authored.some(
        (rule) =>
          rule.blockerStepId === blocker?.blueprintStepId &&
          rule.blockedStepId === blocked?.blueprintStepId,
      )
    );
  });
}

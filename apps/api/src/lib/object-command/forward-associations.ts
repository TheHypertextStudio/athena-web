/** Forward handlers for the operations that attach or detach Labels and Initiatives. */
import { initiativeProject } from '@docket/db';
import type { project, task } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';

import type { ObjectCommandIn } from '../../contracts/object-command';
import { ConflictError, NotFoundError } from '../../error';
import {
  applyExclusivity,
  resolveLabelCatalog,
  type ResolvedLabel,
  type ScopedResolvedLabel,
} from '../labels';
import { edgeKey } from '../../mcp/change-set';
import { inBatches } from './batching';
import {
  deleteInitiativeEdges,
  deleteLabelEdges,
  insertInitiativeEdges,
  insertLabelEdges,
  loadAttachedLabels,
  type RelationEdge,
} from './relation-edges';
import type { ForwardContext, Tx } from './types';

type TaskRow = typeof task.$inferSelect;
type ProjectRow = typeof project.$inferSelect;
type LabelItem = ScopedResolvedLabel;
type AssociationOperation = Extract<
  ObjectCommandIn['operation'],
  { type: 'add_association' | 'remove_association' }
>;

/**
 * The Labels one object carries after the command, with exclusive groups collapsed. A Label scoped
 * to another Team is invisible from here, so attaching it reads as a missing Label.
 */
function nextLabelSet(
  existing: readonly LabelItem[],
  requested: readonly LabelItem[],
  requestedIds: ReadonlySet<string>,
  shouldExist: boolean,
  teamId: string | null,
): readonly ResolvedLabel[] {
  const kept = existing.filter((item) => !requestedIds.has(item.id));
  if (!shouldExist) return kept;
  for (const item of requested) {
    if (item.teamId !== null && item.teamId !== teamId) throw new NotFoundError('Label not found');
  }
  return applyExclusivity([...kept, ...requested]);
}

/** Record one Label edge change on the receipt and the audit log. */
function pushLabelChange(
  context: ForwardContext,
  objectId: string,
  relatedId: string,
  after: boolean,
): void {
  context.entries.push({
    kind: 'relation',
    objectId,
    relation: 'label',
    relatedId,
    before: !after,
    after,
  });
  context.audit.push({
    kind: context.command.objectKind === 'task' ? 'task_has_label' : 'project_has_label',
    from: objectId,
    to: relatedId,
    linked: after,
  });
}

/** Everything a Label command needs to know about the Labels already in play. */
interface LabelCatalog {
  readonly labelsById: ReadonlyMap<string, LabelItem>;
  readonly attachedByObject: ReadonlyMap<string, readonly string[]>;
  readonly requested: readonly LabelItem[];
  readonly requestedIds: ReadonlySet<string>;
}

async function loadLabelCatalog(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  objectIds: readonly string[],
  associationIds: readonly string[],
): Promise<LabelCatalog> {
  const attached = await loadAttachedLabels(tx, orgId, objectKind, objectIds);
  const catalog = await resolveLabelCatalog(
    orgId,
    [...new Set([...attached.map((edge) => edge.relatedId), ...associationIds])],
    tx,
  );
  const labelsById = new Map(catalog.map((item) => [item.id, item]));
  const requested = associationIds.map((id) => labelsById.get(id));
  if (requested.some((item) => item === undefined)) throw new NotFoundError('Label not found');
  const attachedByObject = new Map<string, string[]>();
  for (const edge of attached) {
    attachedByObject.set(edge.objectId, [
      ...(attachedByObject.get(edge.objectId) ?? []),
      edge.relatedId,
    ]);
  }
  return {
    labelsById,
    attachedByObject,
    requested: requested as readonly LabelItem[],
    requestedIds: new Set(associationIds),
  };
}

/** Diff each object's Labels against the command and record every edge that actually moves. */
function planLabelChanges(
  context: ForwardContext,
  rows: readonly (TaskRow | ProjectRow)[],
  catalog: LabelCatalog,
  shouldExist: boolean,
): { readonly added: RelationEdge[]; readonly removed: RelationEdge[] } {
  const added: RelationEdge[] = [];
  const removed: RelationEdge[] = [];
  for (const row of rows) {
    const existing = (catalog.attachedByObject.get(row.id) ?? [])
      .map((id) => catalog.labelsById.get(id))
      .filter((item): item is LabelItem => item !== undefined);
    const next = nextLabelSet(
      existing,
      catalog.requested,
      catalog.requestedIds,
      shouldExist,
      row.teamId,
    );
    const beforeIds = new Set(existing.map((item) => item.id));
    const afterIds = new Set(next.map((item) => item.id));
    for (const relatedId of new Set([...beforeIds, ...afterIds])) {
      const after = afterIds.has(relatedId);
      if (beforeIds.has(relatedId) === after) continue;
      pushLabelChange(context, row.id, relatedId, after);
      (after ? added : removed).push({ objectId: row.id, relatedId });
    }
  }
  return { added, removed };
}

async function applyLabelAssociations(
  context: ForwardContext,
  rows: readonly (TaskRow | ProjectRow)[],
  op: AssociationOperation,
): Promise<void> {
  const { scope, command } = context;
  const { database: tx, orgId } = scope;
  const objectKind = command.objectKind;
  const shouldExist = op.type === 'add_association';
  const catalog = await loadLabelCatalog(
    tx,
    orgId,
    objectKind,
    command.objectIds,
    op.associationIds,
  );
  const { added, removed } = planLabelChanges(context, rows, catalog, shouldExist);
  for (const batch of inBatches(removed)) {
    if ((await deleteLabelEdges(tx, orgId, objectKind, batch)).length !== batch.length) {
      throw new ConflictError('Label associations changed concurrently');
    }
  }
  for (const batch of inBatches(added)) {
    if ((await insertLabelEdges(tx, orgId, objectKind, batch)).length !== batch.length) {
      throw new ConflictError('Label associations changed concurrently');
    }
  }
}

async function writeInitiativeEdges(
  tx: Tx,
  orgId: string,
  shouldExist: boolean,
  batch: readonly RelationEdge[],
): Promise<number> {
  const written = shouldExist
    ? await insertInitiativeEdges(tx, orgId, batch)
    : await deleteInitiativeEdges(tx, orgId, batch);
  return written.length;
}

async function applyInitiativeAssociations(
  context: ForwardContext,
  op: AssociationOperation,
): Promise<void> {
  const { scope, command, entries, audit } = context;
  const { database: tx, orgId } = scope;
  const shouldExist = op.type === 'add_association';
  const existing = await tx
    .select({
      projectId: initiativeProject.projectId,
      initiativeId: initiativeProject.initiativeId,
    })
    .from(initiativeProject)
    .where(
      and(
        eq(initiativeProject.organizationId, orgId),
        inArray(initiativeProject.projectId, command.objectIds as string[]),
        inArray(initiativeProject.initiativeId, op.associationIds as string[]),
      ),
    );
  const existingKeys = new Set(existing.map((edge) => edgeKey(edge.projectId, edge.initiativeId)));
  const changed = command.objectIds.flatMap((objectId) =>
    op.associationIds.flatMap((relatedId) => {
      const existed = existingKeys.has(edgeKey(objectId, relatedId));
      return existed === shouldExist ? [] : [{ objectId, relatedId, existed }];
    }),
  );
  for (const batch of inBatches(changed)) {
    if ((await writeInitiativeEdges(tx, orgId, shouldExist, batch)) !== batch.length) {
      throw new ConflictError('Initiative associations changed concurrently');
    }
  }
  for (const edge of changed) {
    entries.push({
      kind: 'relation',
      objectId: edge.objectId,
      relation: 'initiative',
      relatedId: edge.relatedId,
      before: edge.existed,
      after: shouldExist,
    });
    audit.push({
      kind: 'project_contributes_to',
      from: edge.objectId,
      to: edge.relatedId,
      linked: shouldExist,
    });
  }
}

/** Apply an add_association or remove_association command to the locked rows. */
export async function applyAssociationOperation(
  context: ForwardContext,
  rows: readonly (TaskRow | ProjectRow)[],
): Promise<void> {
  const op = context.command.operation as AssociationOperation;
  if (op.association === 'label') {
    await applyLabelAssociations(context, rows, op);
    return;
  }
  await applyInitiativeAssociations(context, op);
}

/** Reading and rewriting the relation half of a replayed command. */
import { initiative, initiativeProject, projectDependency, taskDependency } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';

import type { ObjectCommandRelationReceiptEntry } from '../../contracts/object-command';
import { resolveLabelCatalog, type ScopedResolvedLabel } from '../labels';
import { inBatches } from './batching';
import { projectCycleWouldClose, taskCycleWouldClose } from './graph-cycles';
import {
  deleteDependencyEdges,
  deleteInitiativeEdges,
  deleteLabelEdges,
  insertDependencyEdges,
  insertInitiativeEdges,
  insertLabelEdges,
  loadAttachedLabels,
  type RelationEdge,
} from './relation-edges';
import type { Tx, TxScope } from './types';

type RelationEntry = ObjectCommandRelationReceiptEntry;
type Relation = RelationEntry['relation'];
type LabelItem = ScopedResolvedLabel;

/** Identify one edge the way both the facts index and the write results spell it. */
export function replayRelationKey(entry: RelationEntry): string {
  return `${entry.relation}:${entry.objectId}:${entry.relatedId}`;
}

/** What the database already says about the edges a replay is about to touch. */
export interface ReplayRelationFacts {
  readonly existing: ReadonlySet<string>;
  readonly targetIds: ReadonlySet<string>;
  readonly attachedLabelIdsByObject: ReadonlyMap<string, readonly string[]>;
  readonly labelsById: ReadonlyMap<string, LabelItem>;
}

interface FactAccumulator {
  readonly existing: Set<string>;
  readonly targetIds: Set<string>;
  readonly attachedLabelIdsByObject: Map<string, string[]>;
  readonly labelsById: Map<string, LabelItem>;
}

async function collectLabelFacts(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  entries: readonly RelationEntry[],
  facts: FactAccumulator,
): Promise<void> {
  if (entries.length === 0) return;
  const objectIds = [...new Set(entries.map((entry) => entry.objectId))];
  const requestedIds = new Set(entries.map((entry) => entry.relatedId));
  const attached = await loadAttachedLabels(tx, orgId, objectKind, objectIds);
  for (const edge of attached) {
    facts.attachedLabelIdsByObject.set(edge.objectId, [
      ...(facts.attachedLabelIdsByObject.get(edge.objectId) ?? []),
      edge.relatedId,
    ]);
    if (requestedIds.has(edge.relatedId)) {
      facts.existing.add(`label:${edge.objectId}:${edge.relatedId}`);
    }
  }
  const catalog = await resolveLabelCatalog(
    orgId,
    [...new Set([...attached.map((edge) => edge.relatedId), ...requestedIds])],
    tx,
  );
  for (const item of catalog) {
    facts.labelsById.set(item.id, item);
    facts.targetIds.add(`label:${item.id}`);
  }
}

async function collectInitiativeFacts(
  tx: Tx,
  orgId: string,
  entries: readonly RelationEntry[],
  facts: FactAccumulator,
): Promise<void> {
  if (entries.length === 0) return;
  const objectIds = [...new Set(entries.map((entry) => entry.objectId))];
  const relatedIds = [...new Set(entries.map((entry) => entry.relatedId))];
  const [targets, attached] = await Promise.all([
    tx
      .select({ id: initiative.id })
      .from(initiative)
      .where(and(eq(initiative.organizationId, orgId), inArray(initiative.id, relatedIds))),
    tx
      .select({
        objectId: initiativeProject.projectId,
        relatedId: initiativeProject.initiativeId,
      })
      .from(initiativeProject)
      .where(
        and(
          eq(initiativeProject.organizationId, orgId),
          inArray(initiativeProject.projectId, objectIds),
          inArray(initiativeProject.initiativeId, relatedIds),
        ),
      ),
  ]);
  for (const row of targets) facts.targetIds.add(`initiative:${row.id}`);
  for (const edge of attached) facts.existing.add(`initiative:${edge.objectId}:${edge.relatedId}`);
}

async function collectDependencyFacts(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  entries: readonly RelationEntry[],
  facts: FactAccumulator,
): Promise<void> {
  if (entries.length === 0) return;
  const objectIds = [...new Set(entries.map((entry) => entry.objectId))];
  const relatedIds = [...new Set(entries.map((entry) => entry.relatedId))];
  const attached =
    objectKind === 'task'
      ? await tx
          .select({
            objectId: taskDependency.blockingTaskId,
            relatedId: taskDependency.blockedTaskId,
          })
          .from(taskDependency)
          .where(
            and(
              eq(taskDependency.organizationId, orgId),
              inArray(taskDependency.blockingTaskId, objectIds),
              inArray(taskDependency.blockedTaskId, relatedIds),
            ),
          )
      : await tx
          .select({
            objectId: projectDependency.blockingProjectId,
            relatedId: projectDependency.blockedProjectId,
          })
          .from(projectDependency)
          .where(
            and(
              eq(projectDependency.organizationId, orgId),
              inArray(projectDependency.blockingProjectId, objectIds),
              inArray(projectDependency.blockedProjectId, relatedIds),
            ),
          );
  for (const edge of attached) facts.existing.add(`dependency:${edge.objectId}:${edge.relatedId}`);
}

/** Load every edge and edge target the receipt's relation entries depend on. */
export async function loadReplayRelationFacts(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  entries: readonly RelationEntry[],
): Promise<ReplayRelationFacts> {
  const facts: FactAccumulator = {
    existing: new Set<string>(),
    targetIds: new Set<string>(),
    attachedLabelIdsByObject: new Map<string, string[]>(),
    labelsById: new Map<string, LabelItem>(),
  };
  const byRelation = (relation: Relation): RelationEntry[] =>
    entries.filter((entry) => entry.relation === relation);
  await collectLabelFacts(tx, orgId, objectKind, byRelation('label'), facts);
  await collectInitiativeFacts(tx, orgId, byRelation('initiative'), facts);
  await collectDependencyFacts(tx, orgId, objectKind, byRelation('dependency'), facts);
  return facts;
}

/** Bucket entries by the relation and the direction-resolved edge state they are moving toward. */
function groupByRelationAction(
  entries: readonly RelationEntry[],
  direction: 'undo' | 'redo',
): ReadonlyMap<string, RelationEntry[]> {
  const groups = new Map<string, RelationEntry[]>();
  for (const entry of entries) {
    const shouldExist = direction === 'undo' ? entry.before : entry.after;
    const key = `${entry.relation}:${shouldExist ? 'add' : 'remove'}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return groups;
}

async function writeRelationBatch(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  group: { readonly relation: Relation; readonly action: 'add' | 'remove' },
  batch: readonly RelationEdge[],
): Promise<RelationEdge[]> {
  const adding = group.action === 'add';
  if (group.relation === 'label') {
    return adding
      ? insertLabelEdges(tx, orgId, objectKind, batch)
      : deleteLabelEdges(tx, orgId, objectKind, batch);
  }
  if (group.relation === 'initiative') {
    return adding
      ? insertInitiativeEdges(tx, orgId, batch)
      : deleteInitiativeEdges(tx, orgId, batch);
  }
  return adding
    ? insertDependencyEdges(tx, orgId, objectKind, batch)
    : deleteDependencyEdges(tx, orgId, objectKind, batch);
}

/** Drop the entries whose new blocking edge would close a cycle, marking them conflicting. */
async function withoutCycleClosers(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  entries: readonly RelationEntry[],
  conflicting: Set<string>,
): Promise<RelationEntry[]> {
  const safe: RelationEntry[] = [];
  for (const entry of entries) {
    const closesCycle =
      objectKind === 'task'
        ? await taskCycleWouldClose(tx, orgId, entry.objectId, entry.relatedId)
        : await projectCycleWouldClose(tx, orgId, entry.objectId, entry.relatedId);
    if (closesCycle) conflicting.add(entry.objectId);
    else safe.push(entry);
  }
  return safe;
}

/** An entry the database did not move lost a race, so its object reports a conflict. */
function recordBatchOutcome(
  batch: readonly RelationEntry[],
  written: ReadonlySet<string>,
  successfulKeys: Set<string>,
  conflicting: Set<string>,
): void {
  for (const entry of batch) {
    const key = replayRelationKey(entry);
    if (written.has(key)) successfulKeys.add(key);
    else conflicting.add(entry.objectId);
  }
}

const REPLAY_RELATIONS: readonly Relation[] = ['label', 'initiative', 'dependency'];

/** Apply the receipt's relation entries, returning the ones the database actually moved. */
export async function applyReplayRelationEntries(
  scope: TxScope,
  objectKind: 'task' | 'project',
  direction: 'undo' | 'redo',
  entries: readonly RelationEntry[],
  conflicting: Set<string>,
): Promise<RelationEntry[]> {
  const { database: tx, orgId } = scope;
  const successfulKeys = new Set<string>();
  const groups = groupByRelationAction(entries, direction);
  for (const action of ['add', 'remove'] as const) {
    for (const relation of REPLAY_RELATIONS) {
      const grouped = groups.get(`${relation}:${action}`) ?? [];
      const attempted =
        relation === 'dependency' && action === 'add'
          ? await withoutCycleClosers(tx, orgId, objectKind, grouped, conflicting)
          : grouped;
      for (const batch of inBatches(attempted)) {
        const written = await writeRelationBatch(
          tx,
          orgId,
          objectKind,
          { relation, action },
          batch,
        );
        recordBatchOutcome(
          batch,
          new Set(written.map((row) => `${relation}:${row.objectId}:${row.relatedId}`)),
          successfulKeys,
          conflicting,
        );
      }
    }
  }
  return entries.filter((entry) => successfulKeys.has(replayRelationKey(entry)));
}

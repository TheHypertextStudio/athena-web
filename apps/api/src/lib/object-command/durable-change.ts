/** Proof that a replayed receipt is the one this actor's canvas command actually recorded. */
import { changeSet, changeSetEntry } from '@docket/db';
import { and, eq } from 'drizzle-orm';

import type {
  ObjectCommandReceipt,
  ObjectCommandRelationReceiptEntry,
} from '../../contracts/object-command';
import { edgeKey, objectCommandChangeSetId } from '../../mcp/change-set';
import { ownedValidation } from './receipt-validator';
import type { CommandScope } from './types';

type RecordedEntry = typeof changeSetEntry.$inferSelect;

function durableValueMatches(left: unknown, right: unknown): boolean {
  const normalized = (value: unknown): unknown =>
    value instanceof Date ? value.toISOString() : value;
  return normalized(left) === normalized(right);
}

function durablePropertyMatches(
  objectKind: 'task' | 'project',
  property: string,
  left: unknown,
  right: unknown,
): boolean {
  if (
    objectKind === 'task' &&
    ['startDate', 'dueDate'].includes(property) &&
    typeof left === 'string' &&
    typeof right === 'string'
  ) {
    return left.slice(0, 10) === right;
  }
  return durableValueMatches(left, right);
}

/** The change-set entity kind a receipt relation is recorded under. */
function durableRelationKind(
  objectKind: 'task' | 'project',
  relation: ObjectCommandRelationReceiptEntry['relation'],
): string {
  if (relation === 'dependency') return objectKind === 'task' ? 'blocks' : 'project_blocks';
  if (relation === 'initiative') return 'project_contributes_to';
  return objectKind === 'task' ? 'task_has_label' : 'project_has_label';
}

function objectEntryMatches(
  objectKind: 'task' | 'project',
  property: string,
  before: unknown,
  after: unknown,
  match: RecordedEntry | undefined,
): boolean {
  return Boolean(
    match?.before &&
    match.after &&
    Object.hasOwn(match.before, property) &&
    Object.hasOwn(match.after, property) &&
    durablePropertyMatches(objectKind, property, match.before[property], before) &&
    durablePropertyMatches(objectKind, property, match.after[property], after),
  );
}

function relationEntryMatches(
  entry: ObjectCommandRelationReceiptEntry,
  match: RecordedEntry | undefined,
): boolean {
  if (!match) return false;
  const beforeEdge = match.before;
  const afterEdge = match.after;
  const edge = afterEdge ?? beforeEdge;
  return (
    edge?.['from'] === entry.objectId &&
    edge['to'] === entry.relatedId &&
    Boolean(beforeEdge) === entry.before &&
    Boolean(afterEdge) === entry.after
  );
}

/** Index recorded entries by object property and by relation edge for O(1) receipt comparison. */
function indexRecordedEntries(recorded: readonly RecordedEntry[]): {
  readonly objectsByIdentity: ReadonlyMap<string, RecordedEntry>;
  readonly relationsByIdentity: ReadonlyMap<string, RecordedEntry>;
} {
  const objectsByIdentity = new Map<string, RecordedEntry>();
  const relationsByIdentity = new Map<string, RecordedEntry>();
  for (const candidate of recorded) {
    for (const property of new Set([
      ...Object.keys(candidate.before ?? {}),
      ...Object.keys(candidate.after ?? {}),
    ])) {
      objectsByIdentity.set(`${candidate.entityKind}:${candidate.entityId}:${property}`, candidate);
    }
    relationsByIdentity.set(`${candidate.entityKind}:${candidate.entityId}`, candidate);
  }
  return { objectsByIdentity, relationsByIdentity };
}

async function loadRecordedCommand(
  scope: CommandScope,
  receipt: ObjectCommandReceipt,
): Promise<readonly RecordedEntry[]> {
  const { database, orgId, actorId } = scope;
  const durableId = objectCommandChangeSetId(orgId, actorId, receipt.commandId);
  const [set] = await database
    .select({ summary: changeSet.summary, origin: changeSet.origin })
    .from(changeSet)
    .where(
      and(
        eq(changeSet.id, durableId),
        eq(changeSet.organizationId, orgId),
        eq(changeSet.actorId, actorId),
      ),
    )
    .limit(1);
  if (set?.origin.tool !== 'canvas' || set.summary !== receipt.action.replaceAll('_', ' ')) {
    throw ownedValidation('Receipt does not match a recorded canvas command');
  }
  return database.select().from(changeSetEntry).where(eq(changeSetEntry.changeSetId, durableId));
}

/** Reject a receipt that this actor's recorded canvas command does not vouch for entry by entry. */
export async function assertReceiptMatchesDurableChange(
  scope: CommandScope,
  receipt: ObjectCommandReceipt,
): Promise<void> {
  const recorded = await loadRecordedCommand(scope, receipt);
  const { objectsByIdentity, relationsByIdentity } = indexRecordedEntries(recorded);
  for (const entry of receipt.entries) {
    const matched =
      entry.kind === 'object'
        ? objectEntryMatches(
            receipt.objectKind,
            entry.property,
            entry.before,
            entry.after,
            objectsByIdentity.get(`${receipt.objectKind}:${entry.objectId}:${entry.property}`),
          )
        : relationEntryMatches(
            entry,
            relationsByIdentity.get(
              `${durableRelationKind(receipt.objectKind, entry.relation)}:${edgeKey(entry.objectId, entry.relatedId)}`,
            ),
          );
    if (!matched) throw ownedValidation('Receipt differs from its recorded canvas command');
  }
}

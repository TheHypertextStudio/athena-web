/**
 * `@docket/api` — recording and reversing where an Initiative sits in its workspace hierarchy.
 *
 * @remarks
 * An Initiative has at most one parent in a workspace's hierarchy, stored as a row in
 * `initiative_hierarchy_link` that carries its own id and the workspace that owns it. That is not
 * the `organization_id`-scoped join every relation in `change-set.ts` reverses, so the parent is
 * recorded as a snapshot instead: `{ parentInitiativeId }` before and after, keyed by the child.
 * A move is then one entry rather than an unlink and a link, and undo asks one question — does the
 * child still sit where this change left it? If someone has moved it since, the entry is skipped.
 */
import { initiativeHierarchyLink, organization } from '@docket/db';
import { and, eq } from 'drizzle-orm';

import { ConflictError } from '../error';
import { initiativeHierarchyDepth } from '../routes/initiative-hierarchy';

import type { StoredChange, Tx } from './change-set';
import type { RevertResult, StoredEntry } from './change-set-companions';

/** The entry kind an Initiative's parent snapshot is stored under. */
export const INITIATIVE_PARENT_KIND = 'initiative_parent';

/** Whether an entry kind is an Initiative parent snapshot. */
export function isInitiativeParentKind(kind: string): boolean {
  return kind === INITIATIVE_PARENT_KIND;
}

/**
 * Record a change to where an Initiative sits.
 *
 * @param childId - The Initiative that moved.
 * @param before - Its parent before the write, or null when it was top level.
 * @param after - Its parent after the write, or null when it is now top level.
 * @returns the change to add to a change set.
 */
export function initiativeParentChange(
  childId: string,
  before: string | null,
  after: string | null,
): StoredChange {
  return {
    kind: INITIATIVE_PARENT_KIND,
    id: childId,
    op: 'update',
    before: { parentInitiativeId: before },
    after: { parentInitiativeId: after },
  };
}

/** Read the parent out of a stored side: a string, null for top level, undefined when malformed. */
function parentOf(side: Record<string, unknown> | null): string | null | undefined {
  const value = side?.['parentInitiativeId'];
  if (value === null || typeof value === 'string') return value;
  return undefined;
}

/** Check the whole current graph before restoring a parent that was valid in an older graph. */
async function canRestoreParent(
  orgId: string,
  childId: string,
  parentId: string,
  maxDepth: number,
  tx: Tx,
): Promise<boolean> {
  const edges = await tx
    .select()
    .from(initiativeHierarchyLink)
    .where(eq(initiativeHierarchyLink.contextOrganizationId, orgId));
  const candidate = [
    ...edges.filter((edge) => edge.childInitiativeId !== childId),
    { childInitiativeId: childId, parentInitiativeId: parentId },
  ];
  try {
    return initiativeHierarchyDepth(candidate) <= maxDepth;
  } catch (error) {
    if (error instanceof ConflictError) return false;
    throw error;
  }
}

/**
 * Put an Initiative back under the parent it had before the recorded change.
 *
 * @remarks
 * The workspace lock serializes restores with hierarchy moves. A prior parent is restored only
 * when the child still matches and the current graph permits it; unrelated moves can invalidate
 * a previously valid placement.
 *
 * @param entry - The stored snapshot entry.
 * @param orgId - The workspace whose hierarchy it changed.
 * @param tx - The transaction to read and write in.
 * @returns what happened; `changed_since` when the Initiative moved after the change.
 */
export async function revertInitiativeParent(
  entry: StoredEntry,
  orgId: string,
  tx: Tx,
): Promise<RevertResult> {
  const ref = { kind: entry.entityKind, id: entry.entityId };
  const before = parentOf(entry.before);
  const after = parentOf(entry.after);
  if (before === undefined || after === undefined) {
    return { outcome: { ...ref, reverted: false, reason: 'no_prior_state' } };
  }
  const [settings] = await tx
    .select({ maxDepth: organization.initiativeMaxDepth })
    .from(organization)
    .where(eq(organization.id, orgId))
    .for('update');
  if (!settings) return { outcome: { ...ref, reverted: false, reason: 'gone' } };
  const where = and(
    eq(initiativeHierarchyLink.contextOrganizationId, orgId),
    eq(initiativeHierarchyLink.childInitiativeId, entry.entityId),
  );
  const [current] = await tx.select().from(initiativeHierarchyLink).where(where).limit(1);
  if ((current?.parentInitiativeId ?? null) !== after) {
    return { outcome: { ...ref, reverted: false, reason: 'changed_since' } };
  }
  if (
    before !== null &&
    !(await canRestoreParent(orgId, entry.entityId, before, settings.maxDepth, tx))
  ) {
    return { outcome: { ...ref, reverted: false, reason: 'changed_since' } };
  }
  if (before === null) {
    await tx.delete(initiativeHierarchyLink).where(where);
  } else if (current) {
    await tx
      .update(initiativeHierarchyLink)
      .set({ parentInitiativeId: before })
      .where(eq(initiativeHierarchyLink.id, current.id));
  } else {
    await tx.insert(initiativeHierarchyLink).values({
      contextOrganizationId: orgId,
      parentInitiativeId: before,
      childInitiativeId: entry.entityId,
    });
  }
  return { outcome: { ...ref, reverted: true } };
}

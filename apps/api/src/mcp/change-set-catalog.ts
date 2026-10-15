/**
 * `@docket/api` — recording and reversing changes to labels, label groups, and templates.
 *
 * @remarks
 * Labels and groups have no archived state, so undoing their creation deletes unused rows.
 * Template undo preserves immutable publications: creation is archived, and an edit is restored
 * by appending another publication. Unpublished drafts may be deleted while unused. Labels placed
 * on work and groups that gained members are reported as `in_use` and left alone. Undoing
 * an edit restores the recorded fields, and only when nobody has edited them since.
 */
import { label, labelGroup, template } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import { labelInUse } from '../lib/labels';
import { reconcileTemplateImages } from '../lib/templates/write';
import { restoreTemplateSnapshot, lockTemplateRestorations } from '../lib/templates/persistence';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';
import type { CatalogKind } from './catalog-rows';
import type { StoredChange, Tx } from './change-set';
import type { RevertResult, StoredEntry } from './change-set-companions';

/** Each catalog kind's table and the fields a change records. */
const CATALOG = {
  label: { table: label, fields: ['name', 'color', 'groupId', 'teamId'] },
  label_group: { table: labelGroup, fields: ['name', 'exclusive', 'sortOrder', 'teamId'] },
  template: {
    table: template,
    fields: [
      'name',
      'description',
      'scope',
      'ownerActorId',
      'teamId',
      'payload',
      'draftRevision',
      'latestPublishedVersionId',
      'publicationState',
      'draftDefinition',
      'icon',
    ],
  },
} as const satisfies Record<CatalogKind, { table: PgTable; fields: readonly string[] }>;

/** The columns every catalog table exposes to a revert. */
type CatalogTable = PgTable & { id: AnyPgColumn; organizationId: AnyPgColumn };

/** Whether an entry kind is a catalog kind. */
export function isCatalogKind(kind: string): kind is CatalogKind {
  return kind in CATALOG;
}

/** Project a row down to the fields a change records for its kind. */
function tracked(kind: CatalogKind, row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(CATALOG[kind].fields.map((key) => [key, row[key] ?? null]));
}

/** Prelock all reversible template closures together before an undo starts locking catalog roots. */
export async function prelockCatalogTemplates(
  entries: readonly StoredEntry[],
  orgId: string,
  tx: Tx,
): Promise<void> {
  const templates = entries.filter((entry) => entry.entityKind === 'template');
  if (templates.length === 0) return;
  const rows = await tx
    .select()
    .from(template)
    .where(
      and(
        eq(template.organizationId, orgId),
        inArray(
          template.id,
          templates.map((entry) => entry.entityId),
        ),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const eligible = templates.filter((entry) => {
    const current = byId.get(entry.entityId);
    return current && (!entry.after || unchanged(current, entry.after));
  });
  await lockTemplateRestorations(
    tx,
    orgId,
    eligible.map((entry) => ({
      id: entry.entityId,
      operation: entry.op,
      before: entry.before,
    })),
  );
}

/**
 * Record the creation or edit of a label, label group, or template.
 *
 * @param kind - Which catalog row changed.
 * @param before - The row before an edit, or null for a create.
 * @param after - The row after the write.
 * @returns The change to add to a change set.
 */
export function catalogChange(
  kind: CatalogKind,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> & { id: string },
): StoredChange {
  return {
    kind,
    id: after.id,
    op: before === null ? 'create' : 'update',
    before: before === null ? null : tracked(kind, before),
    after: tracked(kind, after),
  };
}

/**
 * Serialize a value with sorted object keys.
 *
 * @remarks
 * Postgres `jsonb` does not keep key order, so a template payload read back can list its keys in a
 * different order from the one recorded, and a plain `JSON.stringify` comparison would call that
 * an edit.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** Whether every recorded field still holds the value this change left. */
function unchanged(current: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return Object.entries(after).every(
    ([key, value]) => canonical(current[key] ?? null) === canonical(value),
  );
}

/** Whether a created row has picked up dependents that deleting it would take with it. */
async function inUse(kind: CatalogKind, orgId: string, id: string, tx: Tx): Promise<boolean> {
  if (kind === 'label') return labelInUse(orgId, id, tx);
  if (kind !== 'label_group') return false;
  const members = await tx
    .select({ id: label.id })
    .from(label)
    .where(and(eq(label.groupId, id), eq(label.organizationId, orgId)))
    .limit(1);
  return members.length > 0;
}

/** Keep search and document-image projections in step with a reverted row. */
async function afterRevert(
  kind: CatalogKind,
  orgId: string,
  id: string,
  deleted: boolean,
): Promise<void> {
  if (kind === 'label') {
    await (deleted ? enqueueSearchDelete : enqueueSearchUpsert)(orgId, 'label', id);
  } else if (kind === 'template') {
    await reconcileTemplateImages(orgId, id, deleted ? 'delete' : 'upsert');
  }
}

/**
 * Restore a label group's recorded fields, carrying its member labels to its old team.
 *
 * @remarks
 * A group and its labels share one scope, so restoring the group's team without its members would
 * split them.
 */
async function restoreGroupMembers(
  orgId: string,
  id: string,
  before: Record<string, unknown>,
  tx: Tx,
): Promise<void> {
  const teamId = before['teamId'];
  if (teamId !== null && typeof teamId !== 'string') return;
  await tx
    .update(label)
    .set({ teamId })
    .where(and(eq(label.groupId, id), eq(label.organizationId, orgId)));
}

/**
 * Reverse one recorded catalog change.
 *
 * @param kind - Which catalog row changed.
 * @param entry - The stored entry.
 * @param orgId - The organization it happened in.
 * @param tx - The transaction to read and write in.
 * @returns What happened (`gone`, `changed_since`, or `in_use` when it was left alone), and the
 *   projection work to run after commit.
 */
export async function revertCatalogEntry(
  kind: CatalogKind,
  entry: StoredEntry,
  orgId: string,
  tx: Tx,
): Promise<RevertResult> {
  const ref = { kind, id: entry.entityId };
  const skip = (reason: string): RevertResult => ({ outcome: { ...ref, reverted: false, reason } });
  const table = CATALOG[kind].table as CatalogTable;
  const where = and(eq(table.id, entry.entityId), eq(table.organizationId, orgId));
  const [current] = await tx.select().from(table).where(where).limit(1).for('update');
  if (!current) return skip('gone');
  if (entry.after && !unchanged(current, entry.after)) return skip('changed_since');
  if (kind === 'template') {
    const restored = await restoreTemplateSnapshot(
      tx,
      orgId,
      entry.entityId,
      entry.op,
      entry.before,
    );
    if (restored !== 'restored') return skip(restored);
    return {
      outcome: { ...ref, reverted: true },
      settle: () => reconcileTemplateImages(orgId, entry.entityId, 'upsert'),
    };
  }
  if (entry.op === 'create') {
    if (await inUse(kind, orgId, entry.entityId, tx)) return skip('in_use');
    await tx.delete(table).where(where);
  } else if (entry.op === 'update' && entry.before) {
    await tx.update(table).set(entry.before).where(where);
    if (kind === 'label_group') await restoreGroupMembers(orgId, entry.entityId, entry.before, tx);
  } else {
    return skip('no_prior_state');
  }
  return {
    outcome: { ...ref, reverted: true },
    settle: () => afterRevert(kind, orgId, entry.entityId, entry.op === 'create'),
  };
}

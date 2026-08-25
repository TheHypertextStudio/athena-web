/**
 * `@docket/api` — the Notion mirror's decision logic. Pure; no database, no network.
 *
 * @remarks
 * Two decisions, both isolated here so they can be exercised exhaustively without standing up a
 * Notion workspace: which way a change flows on a two-way entity, and whether a projected row
 * needs writing at all.
 *
 * The conflict rule is the same one the linked-database reconciler already applies
 * (`planTaskReconcile`): **Docket is the source of truth on a contested edit**, and the losing
 * remote value is recorded rather than discarded. Repeating the semantics rather than the code is
 * deliberate — the two operate on different shapes (a linked task with provenance columns, versus
 * a projected row with a mirror row) and collapsing them would fit neither.
 *
 * @see `docs/engineering/specs/notion-sync.md`
 */
import type { NotionMirrorDirection } from '@docket/connections/notion/mirror-contract';

/** What Docket knows about one projected row, going into a sync. */
export interface MirrorLocalRow {
  /** The Docket entity's id. */
  readonly entityId: string;
  /** The Notion page it is mirrored to. */
  readonly externalPageId: string;
  /** When the Docket entity last changed. */
  readonly updatedAt: Date;
  /** The page's `last_edited_time` as of the last sync — the remote-change anchor. */
  readonly externalUpdatedAt: Date | null;
  /** When Docket last wrote this page — the echo guard. */
  readonly lastPushedAt: Date | null;
  /** Hash of the values last projected, so an unchanged entity costs no write. */
  readonly contentHash: string | null;
  /** Hash of the entity's current projectable values, when the caller has loaded them. */
  readonly currentContentHash?: string | null;
  /** Whether the Docket entity has been archived. */
  readonly archived: boolean;
}

/** What Notion reports about the same page. */
export interface MirrorRemoteRow {
  readonly externalPageId: string;
  /** RFC3339 `last_edited_time`. */
  readonly externalUpdatedAt: string;
  /** Whether the page is in Notion's trash. */
  readonly archived: boolean;
}

/** The losing remote values, recorded before they are overwritten. */
export interface MirrorConflict {
  readonly externalPageId: string;
  readonly remoteUpdatedAt: string;
  readonly localUpdatedAt: string;
  /** Why Docket won: a contested edit, or drift on a projection-only entity. */
  readonly reason: 'contested_edit' | 'push_only_drift';
}

/** What to do with one row this sync. */
export type MirrorAction =
  | { readonly kind: 'noop' }
  /** Create the page — Docket has an entity Notion does not. */
  | { readonly kind: 'create' }
  /** Overwrite the page with Docket's values. Carries the losing remote values when contested. */
  | { readonly kind: 'push'; readonly conflict?: MirrorConflict }
  /** Read the page's values into Docket. */
  | { readonly kind: 'pull' }
  /** Trash the page — the Docket entity was archived. */
  | { readonly kind: 'trash' }
  /** Notion's page was trashed; adopt that on a two-way entity. */
  | { readonly kind: 'archiveLocal' }
  /** A row created in Notion that Docket has never seen. */
  | { readonly kind: 'adopt' };

/**
 * Whether the Docket entity changed since Docket last wrote the page.
 *
 * @remarks
 * Measured by the projected content hash when the caller has loaded the current entity. Mirror-row
 * timestamps change when Docket updates sync bookkeeping, so treating them as entity timestamps
 * makes every successful push dirty again. A row Docket has never pushed is dirty by definition.
 *
 * @param local - The projected row's local state.
 * @returns true when Docket holds an unpushed change.
 */
export function isLocallyDirty(local: MirrorLocalRow): boolean {
  if (local.lastPushedAt === null) return true;
  if (local.currentContentHash !== undefined) {
    return local.currentContentHash !== local.contentHash;
  }
  return local.updatedAt.getTime() > local.lastPushedAt.getTime();
}

/**
 * Whether Notion reports an edit newer than Docket's own write.
 *
 * @remarks
 * **The echo guard, in timestamp form.** Docket's own push bumps `last_edited_time`, so a naive
 * "is the remote newer than the anchor" test treats every push as a remote change and loops. The
 * comparison is therefore against the newest timestamp Docket has acknowledged. That timestamp
 * is either Docket's last push or the last Notion edit Docket pulled. Comparing only against the
 * push would make every accepted Notion edit look new again on every later poll.
 *
 * The webhook path has a stronger guard available (the payload names its authors), but the
 * polling path has only timestamps — and polling is the safety net that has to keep working when
 * webhooks are missed, so it cannot rely on the stronger signal.
 *
 * @param local - The projected row's local state.
 * @param remote - What Notion reports.
 * @returns true when the remote edit is genuinely not ours.
 */
export function isRemoteEdited(local: MirrorLocalRow, remote: MirrorRemoteRow): boolean {
  const remoteMs = Date.parse(remote.externalUpdatedAt);
  if (Number.isNaN(remoteMs)) return false;
  const acknowledgedMs = Math.max(
    local.lastPushedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
    local.externalUpdatedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
  );
  // A page Docket wrote reports a `last_edited_time` at or a hair after the write. A page Docket
  // pulled reports the same timestamp again on later polls. Strictly greater rejects both echoes.
  return remoteMs > acknowledgedMs;
}

/**
 * Decide which way one projected row flows this sync.
 *
 * @remarks
 * The `push` entities are projections: an edit made in Notion is drift, and it is reverted — but
 * **recorded as a conflict while it is reverted**, because a revert the user cannot see is
 * indistinguishable from data loss. That is the single most important difference between this and
 * a plain one-way mirror.
 *
 * On a `two_way` entity the matrix matches the linked-database reconciler:
 *
 * | Local dirty | Remote edited | Action |
 * |---|---|---|
 * | no | no | `noop` |
 * | no | yes | `pull` — a one-sided remote change is not a conflict; Docket still learns |
 * | yes | no | `push` |
 * | yes | yes | `push` with a conflict — Docket wins regardless of which is newer |
 *
 * A remote tombstone is the one case a remote wins outright on a two-way entity: a trashed page
 * cannot be resurrected by pushing values at it.
 *
 * @param local - The projected row, or undefined when Notion has a page Docket has never seen.
 * @param remote - What Notion reports, or undefined when the page was not in this read.
 * @param direction - Whether the entity accepts edits from Notion.
 * @returns the action to take.
 */
export function planMirrorRow(
  local: MirrorLocalRow | undefined,
  remote: MirrorRemoteRow | undefined,
  direction: NotionMirrorDirection,
): MirrorAction {
  if (local === undefined) {
    // A page Docket has no mirror row for. On a two-way entity somebody created a row in Notion
    // and it becomes a real Docket entity; on a projection-only one it is not ours to adopt.
    if (remote === undefined || remote.archived) return { kind: 'noop' };
    return direction === 'two_way' ? { kind: 'adopt' } : { kind: 'noop' };
  }

  if (local.archived) {
    // Docket archived the entity. Trash the page unless Notion already has.
    return remote?.archived === true ? { kind: 'noop' } : { kind: 'trash' };
  }

  if (remote === undefined) {
    // Not in this read — an incremental query only returns what changed, so absence means
    // "unchanged", never "deleted". Only an unpushed local change needs to escape.
    return isLocallyDirty(local) ? { kind: 'push' } : { kind: 'noop' };
  }

  if (remote.archived) {
    // A trashed page cannot be revived by writing values at it, so a two-way entity adopts the
    // deletion. A projection-only entity is Docket's to restate, so the page is re-created.
    return direction === 'two_way' ? { kind: 'archiveLocal' } : { kind: 'create' };
  }

  const dirty = isLocallyDirty(local);
  const edited = isRemoteEdited(local, remote);

  if (direction === 'push') {
    if (!edited) return dirty ? { kind: 'push' } : { kind: 'noop' };
    // Drift on a projection-only entity. Docket's values are restored AND the loss is recorded:
    // silently reverting somebody's edit is the failure this whole invariant exists to prevent.
    return {
      kind: 'push',
      conflict: {
        externalPageId: local.externalPageId,
        remoteUpdatedAt: remote.externalUpdatedAt,
        localUpdatedAt: local.updatedAt.toISOString(),
        reason: 'push_only_drift',
      },
    };
  }

  if (dirty && edited) {
    // Both sides changed. Docket wins regardless of which timestamp is later, and the remote's
    // losing values ride along so the caller records them before the overwrite.
    return {
      kind: 'push',
      conflict: {
        externalPageId: local.externalPageId,
        remoteUpdatedAt: remote.externalUpdatedAt,
        localUpdatedAt: local.updatedAt.toISOString(),
        reason: 'contested_edit',
      },
    };
  }
  if (dirty) return { kind: 'push' };
  if (edited) return { kind: 'pull' };
  return { kind: 'noop' };
}

/**
 * Whether a projected row's values differ from what was last written.
 *
 * @remarks
 * Notion allows roughly three requests a second, so the cost of a redundant write is not a wasted
 * millisecond — it is budget taken from a row that genuinely changed. Comparing a hash of the
 * projected values means an entity whose `updated_at` moved for an unrelated reason costs nothing.
 *
 * @param local - The projected row.
 * @param nextHash - The hash of the values about to be written.
 * @returns true when the write would change something.
 */
export function contentChanged(local: MirrorLocalRow, nextHash: string): boolean {
  return local.contentHash !== nextHash;
}

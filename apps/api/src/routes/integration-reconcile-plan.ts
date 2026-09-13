/**
 * `@docket/api` — the direction decision for two-way connector task sync.
 *
 * @remarks
 * Pure: given one local linked task and the item the provider returned for it, decide which way
 * data flows. {@link reconcileTasks} in `./integration-reconcile` runs the database reads and
 * writes and the connector pushes around it, so every branch here is unit tested without either.
 */
import { createHash } from 'node:crypto';

import { type WorkStatusCategory } from '@docket/work/work-status-contract';
import type { ImportedItem } from '@docket/integrations';

/** A linked task projected to just the fields reconciliation needs to decide a direction. */
export interface ReconcileLocalTask {
  /** The Docket task id. */
  readonly id: string;
  /** Current title. */
  readonly title: string;
  /** Current description (null when unset). */
  readonly description: string | null;
  /** The task's status key. */
  readonly state: string;
  /** The category {@link ReconcileLocalTask.state} behaves as (drives completion/cancel mapping). */
  readonly stateType: WorkStatusCategory;
  /** Current due date (null when unset). */
  readonly dueDate: Date | null;
  /** Last local modification (auto-bumped on every write that doesn't set it explicitly). */
  readonly updatedAt: Date;
  /** The provider's external id for this task (a linked task always has one). */
  readonly externalId: string;
  /** The LWW anchor: the provider's last-write timestamp as of the last sync (null = never). */
  readonly externalUpdatedAt: Date | null;
  /** The provider entity tag for optimistic-concurrency writes. */
  readonly externalEtag: string | null;
  /** The external list the task belongs to (for addressing the write-back). */
  readonly externalListId: string | null;
  /** {@link descriptionHash} of the description as of the last sync of the provider's copy. */
  readonly externalBodyHash: string | null;
}

/**
 * Hash a task description for the body anchor, without storing its content in sync state.
 *
 * @param description - The description; `null` hashes the same as an empty one.
 * @returns a 32-character hex digest.
 */
export function descriptionHash(description: string | null): string {
  return createHash('sha256')
    .update(description ?? '')
    .digest('hex')
    .slice(0, 32);
}

/**
 * The body anchor to store after applying a pulled item onto an existing task.
 *
 * @remarks
 * A complete body is the provider's copy, so it becomes the anchor. A body the provider could not
 * hand over in full leaves the local description in place and anchors to that instead: the local
 * copy is then "unchanged" until someone edits it, and a push leaves the provider's page alone.
 *
 * @param item - The pulled item.
 * @param currentDescription - The task's description before the pull.
 * @returns the hash to store as `task.externalBodyHash`.
 */
export function pulledBodyHash(item: ImportedItem, currentDescription: string | null): string {
  return descriptionHash(item.bodyUnavailable === true ? currentDescription : (item.body ?? null));
}

/**
 * The record of a genuine two-sided conflict: both Docket and the provider changed the same
 * linked item since the last sync.
 *
 * @remarks
 * Emitted by {@link planTaskReconcile} alongside the `push` it resolves to, so the losing remote
 * values are *data* the caller persists rather than something discarded on the way to a decision.
 * `remoteTitle`/`remoteDueDate`/`remoteCompleted` are the provider's values at the moment they
 * lost — the conflict log's whole reason to exist (see `recordSyncConflict`).
 */
export interface TaskSyncConflict {
  /** The provider's external id for the conflicted item. */
  readonly externalId: string;
  /** The provider's last-write timestamp (RFC3339) that lost. */
  readonly remoteUpdatedAt: string;
  /** Docket's `updatedAt` at the moment it won (ISO-8601). */
  readonly localUpdatedAt: string;
  /** The provider's title at the moment it lost. */
  readonly remoteTitle: string;
  /** The provider's body/description at the moment it lost, when it carried one. */
  readonly remoteBody: string | null;
  /** The provider's due date at the moment it lost (`null` = explicitly unset, `undefined` = absent). */
  readonly remoteDueDate: string | null | undefined;
  /** The provider's completion flag at the moment it lost, when the provider carries one. */
  readonly remoteCompleted: boolean | undefined;
}

/** One reconciliation decision for a (local, remote) pair. */
export type ReconcileAction =
  | { readonly kind: 'noop' }
  /** Remote item with no local counterpart → create a linked task. */
  | { readonly kind: 'insert' }
  /** Remote is the newer side → apply its fields to the local task. */
  | { readonly kind: 'pull' }
  /**
   * Local is the newer/dirty side → push its fields to the provider.
   *
   * @remarks
   * `conflict` is set only when the REMOTE ALSO changed since the last sync and Docket won
   * anyway. An ordinary uncontested push carries no conflict.
   */
  | { readonly kind: 'push'; readonly conflict?: TaskSyncConflict }
  /** Local task was canceled → delete it at the provider. */
  | { readonly kind: 'pushDelete' }
  /** Remote tombstone → archive the local linked task. */
  | { readonly kind: 'archive' };

/** Direction switches for {@link planTaskReconcile}. */
export interface ReconcilePlanOptions {
  /** Whether the connection may write back to the provider. */
  readonly writeBack: boolean;
  /**
   * Whether a remote absent from this read is known to be unchanged: the provider returned only
   * rows changed since a cursor, and the task belongs to a container this read covered.
   */
  readonly absentIsUnchanged?: boolean;
}

/** Whether a linked task has local edits not yet pushed (the dirty rule). */
function isDirty(local: ReconcileLocalTask): boolean {
  return (
    local.externalUpdatedAt !== null &&
    local.updatedAt.getTime() > local.externalUpdatedAt.getTime()
  );
}

/**
 * Decide which way one task should flow this sync — the pure heart of reconciliation.
 *
 * @remarks
 * `writeBack` gates every local→remote direction: a read-only mirror never pushes, so a locally
 * dirty mirrored task simply yields to the provider (or no-ops when the provider hasn't changed).
 * A remote is only ever *archived* on an explicit tombstone (`removed`), never on mere absence —
 * a task missing from the pull is most likely filtered out by the integration's `listIds`, not
 * deleted, so absence must not destroy local work.
 *
 * **Docket is the source of truth on conflict.** When BOTH sides changed since the last sync,
 * Docket's value wins regardless of which timestamp is newer, and the losing remote values are
 * returned on the action as a {@link TaskSyncConflict} so the caller can record them. This
 * replaces the previous last-write-wins tie-break, under which a later external edit silently
 * overwrote local work and the losing value was kept nowhere — the opposite of what a two-way
 * sync whose purpose is to let Docket supersede the incumbent tool has to do.
 *
 * A one-sided remote change is NOT a conflict: if Docket is clean, the provider's newer value is
 * simply pulled. "Docket wins" settles contested edits; it does not stop Docket from learning.
 *
 * @param local - The local linked task, or `undefined` when the provider has one we don't.
 * @param remote - The pulled item, or `undefined` when we have a linked task the pull didn't return.
 * @param opts - `writeBack` enables the push directions; `absentIsUnchanged` says an absent remote
 *   was left out because it did not change.
 * @returns the direction for this task.
 */
export function planTaskReconcile(
  local: ReconcileLocalTask | undefined,
  remote: ImportedItem | undefined,
  opts: ReconcilePlanOptions,
): ReconcileAction {
  if (!local) return remote && !remote.removed ? { kind: 'insert' } : { kind: 'noop' };
  if (!remote) return planAbsentRemote(local, opts);
  if (remote.removed) return { kind: 'archive' };
  return planReturnedRemote(local, remote, opts.writeBack);
}

/** Decide for a linked task the provider's read did not return. */
function planAbsentRemote(local: ReconcileLocalTask, opts: ReconcilePlanOptions): ReconcileAction {
  if (!opts.writeBack || !isDirty(local)) return { kind: 'noop' };
  if (local.stateType === 'canceled') return { kind: 'pushDelete' };
  // A remote missing from a changed-rows-only read is unchanged at the provider, so the local
  // edit goes out now instead of waiting for the next full read. Any other absence is most
  // likely a list filter, and only a local cancel escapes it.
  return opts.absentIsUnchanged === true ? { kind: 'push' } : { kind: 'noop' };
}

/** Decide for a linked task the provider's read returned, live. */
function planReturnedRemote(
  local: ReconcileLocalTask,
  remote: ImportedItem,
  writeBack: boolean,
): ReconcileAction {
  const remoteMs = remote.provenance.externalUpdatedAt
    ? Date.parse(remote.provenance.externalUpdatedAt)
    : undefined;
  const anchorMs = local.externalUpdatedAt?.getTime();
  const remoteNewer = remoteMs !== undefined && (anchorMs === undefined || remoteMs > anchorMs);

  if (!writeBack || !isDirty(local)) return remoteNewer ? { kind: 'pull' } : { kind: 'noop' };
  if (local.stateType === 'canceled') return { kind: 'pushDelete' };
  // `remoteNewer` is only ever true when `remoteMs` is a real number (see its definition), so
  // this single check narrows both facts at once.
  if (!remoteNewer) return { kind: 'push' };
  // Both sides changed since the last sync. Docket is the source of truth, so Docket's value
  // wins even when the remote edit is newer — and the remote's losing values ride along so the
  // caller can record them instead of dropping them.
  return {
    kind: 'push',
    conflict: {
      externalId: local.externalId,
      remoteUpdatedAt: new Date(remoteMs).toISOString(),
      localUpdatedAt: local.updatedAt.toISOString(),
      remoteTitle: remote.title,
      remoteBody: remote.body ?? null,
      remoteDueDate: remote.dueDate,
      remoteCompleted: remote.completed,
    },
  };
}

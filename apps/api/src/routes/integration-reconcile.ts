/**
 * `@docket/api` — two-way task reconciliation for connector sync.
 *
 * @remarks
 * The pull-only {@link importItems} was insert-or-skip; this module makes a synced connector
 * *bidirectional*. It operates on the union of (a) the local `linked` tasks for one integration
 * and (b) the items pulled from the provider this run, keyed by `externalId`, and decides per
 * task which way data flows using last-write-wins (LWW):
 *
 * - the **anchor** `task.externalUpdatedAt` is both the LWW comparison point and the echo guard;
 * - a linked task is **dirty** (locally edited since the last sync) iff
 *   `externalUpdatedAt IS NOT NULL AND updatedAt > externalUpdatedAt`;
 * - every reconcile write sets `updatedAt = externalUpdatedAt = <remote updated>` *explicitly*
 *   (overriding Drizzle's `$onUpdate`), so the task is clean afterward and the next pull is a
 *   no-op — without this the anchor write would itself bump `updatedAt` and the task would look
 *   perpetually dirty.
 *
 * The direction decision ({@link planTaskReconcile}) is a pure function so each branch is unit
 * tested without a database; {@link reconcileTasks} orchestrates the DB reads/writes and the
 * connector pushes.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, task, team } from '@docket/db';
import type { WorkflowStateType } from '@docket/db';
import { ConnectorConfig } from '@docket/types';
import type { ImportedItem } from '@docket/integrations';
import type { WritableConnector } from '@docket/integrations';

import { ConflictError } from '../error';

import { type IntegrationRow } from './integration-provider';

/** A linked task projected to just the fields reconciliation needs to decide a direction. */
export interface ReconcileLocalTask {
  /** The Docket task id. */
  readonly id: string;
  /** Current title. */
  readonly title: string;
  /** Current description (null when unset). */
  readonly description: string | null;
  /** The task's workflow-state key. */
  readonly state: string;
  /** The canonical type of {@link ReconcileLocalTask.state} (drives completion/cancel mapping). */
  readonly stateType: WorkflowStateType;
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
}

/** One reconciliation decision for a (local, remote) pair. */
export type ReconcileAction =
  | { readonly kind: 'noop' }
  /** Remote item with no local counterpart → create a linked task. */
  | { readonly kind: 'insert' }
  /** Remote is the newer side → apply its fields to the local task. */
  | { readonly kind: 'pull' }
  /** Local is the newer/dirty side → push its fields to the provider. */
  | { readonly kind: 'push' }
  /** Local task was canceled → delete it at the provider. */
  | { readonly kind: 'pushDelete' }
  /** Remote tombstone → archive the local linked task. */
  | { readonly kind: 'archive' };

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
 * @param local - The local linked task, or `undefined` when the provider has one we don't.
 * @param remote - The pulled item, or `undefined` when we have a linked task the pull didn't return.
 * @param opts - `writeBack` enables the push directions.
 */
export function planTaskReconcile(
  local: ReconcileLocalTask | undefined,
  remote: ImportedItem | undefined,
  opts: { readonly writeBack: boolean },
): ReconcileAction {
  if (!local) {
    if (!remote || remote.removed) return { kind: 'noop' };
    return { kind: 'insert' };
  }
  if (!remote) {
    // The remote wasn't in this pull (likely list-filtered). Only a local cancel needs to escape.
    if (opts.writeBack && local.stateType === 'canceled' && isDirty(local)) {
      return { kind: 'pushDelete' };
    }
    return { kind: 'noop' };
  }
  if (remote.removed) return { kind: 'archive' };

  const dirty = isDirty(local);
  const remoteMs = remote.provenance.externalUpdatedAt
    ? Date.parse(remote.provenance.externalUpdatedAt)
    : undefined;
  const anchorMs = local.externalUpdatedAt?.getTime();
  const remoteNewer = remoteMs !== undefined && (anchorMs === undefined || remoteMs > anchorMs);

  if (opts.writeBack && dirty) {
    if (local.stateType === 'canceled') return { kind: 'pushDelete' };
    if (!remoteNewer) return { kind: 'push' };
    // Both sides changed since the last sync: the newer timestamp wins.
    return local.updatedAt.getTime() >= remoteMs ? { kind: 'push' } : { kind: 'pull' };
  }
  return remoteNewer ? { kind: 'pull' } : { kind: 'noop' };
}

/** The per-team workflow-state keys reconciliation maps completion/cancellation onto. */
interface StateKeys {
  /** New-task / reopened default (first state). */
  readonly openKey: string;
  /** First `completed`-type state. */
  readonly completedKey: string;
  /** First `canceled`-type state. */
  readonly canceledKey: string;
  /** Resolve a state key to its canonical type. */
  readonly typeOf: (key: string) => WorkflowStateType;
}

/** Build the {@link StateKeys} for a team from its workflow-state list. */
function resolveStateKeys(states: readonly { key: string; type: WorkflowStateType }[]): StateKeys {
  const byType = (t: WorkflowStateType): string | undefined =>
    states.find((s) => s.type === t)?.key;
  const openKey = byType('unstarted') ?? states[0]?.key ?? 'backlog';
  const completedKey = byType('completed') ?? states[states.length - 1]?.key ?? 'done';
  const canceledKey = byType('canceled') ?? completedKey;
  const typeMap = new Map(states.map((s) => [s.key, s.type] as const));
  return { openKey, completedKey, canceledKey, typeOf: (k) => typeMap.get(k) ?? 'backlog' };
}

/** Outcome tallies for one reconcile pass (surfaced on the sync run / for tests). */
export interface ReconcileResult {
  /** Items newly inserted as linked tasks. */
  readonly inserted: number;
  /** Linked tasks updated from a newer remote. */
  readonly pulled: number;
  /** Linked tasks whose local edits were pushed to the provider. */
  readonly pushed: number;
  /** Local canceled tasks deleted at the provider. */
  readonly deleted: number;
  /** Linked tasks archived from a remote tombstone. */
  readonly archived: number;
  /** Native tasks created at the provider and converted to linked. */
  readonly created: number;
}

/** Options for {@link reconcileTasks}. */
export interface ReconcileOptions {
  /** Assignee for newly-inserted linked tasks, or null to leave unassigned. */
  readonly assigneeId: string | null;
  /** The write-back seam, when the connector supports it (null = read-only). */
  readonly writable: WritableConnector | null;
}

/**
 * Reconcile one integration's linked tasks against the items pulled this sync, applying
 * last-write-wins in both directions and persisting the new sync anchors.
 *
 * @param orgId - The active organization.
 * @param actorId - The actor funding the run (recorded as `createdBy` on inserts).
 * @param row - The integration being synced (its `writeBack`/`config`/`id` drive behavior).
 * @param teamId - The team linked tasks attach to.
 * @param items - The items pulled from the provider this run.
 * @param options - Assignee + the optional write-back seam.
 * @returns the per-direction tallies for this pass.
 * @throws {ConflictError} When the team can't be resolved.
 */
export async function reconcileTasks(
  orgId: string,
  actorId: string,
  row: IntegrationRow,
  teamId: string,
  items: readonly ImportedItem[],
  options: ReconcileOptions,
): Promise<ReconcileResult> {
  const teamRows = await db
    .select({ workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  const states = teamRows[0]?.workflowStates;
  if (!states) throw new ConflictError('Organization has no team to reconcile work into');
  const keys = resolveStateKeys(states);

  const writable = options.writable;
  const writeBack = row.writeBack && writable !== null;
  const config = ConnectorConfig.safeParse(row.config).data ?? {};

  // Load the integration's linked tasks and index them by external id.
  const localRows = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.organizationId, orgId),
        eq(task.source, 'linked'),
        eq(task.sourceIntegrationId, row.id),
      ),
    );
  const localById = new Map<string, (typeof localRows)[number]>();
  for (const t of localRows) if (t.externalId) localById.set(t.externalId, t);

  const remoteById = new Map<string, ImportedItem>();
  for (const item of items) remoteById.set(item.provenance.externalId, item);

  const tally = { inserted: 0, pulled: 0, pushed: 0, deleted: 0, archived: 0, created: 0 };

  const externalIds = new Set<string>([...localById.keys(), ...remoteById.keys()]);
  for (const externalId of externalIds) {
    const localRow = localById.get(externalId);
    const remote = remoteById.get(externalId);
    const local: ReconcileLocalTask | undefined = localRow
      ? {
          id: localRow.id,
          title: localRow.title,
          description: localRow.description,
          state: localRow.state,
          stateType: keys.typeOf(localRow.state),
          dueDate: localRow.dueDate,
          updatedAt: localRow.updatedAt,
          externalId, // the map key — localById only holds tasks that have an external id
          externalUpdatedAt: localRow.externalUpdatedAt,
          externalEtag: localRow.externalEtag,
          externalListId: localRow.externalListId,
        }
      : undefined;

    // The action kind guarantees which of local/remote/writable are present; the explicit
    // guards re-narrow that for the type system (the repo forbids non-null assertions).
    const action = planTaskReconcile(local, remote, { writeBack });
    if (action.kind === 'insert' && remote) {
      await insertLinked(orgId, actorId, row.id, teamId, remote, keys, options.assigneeId);
      tally.inserted += 1;
    } else if (action.kind === 'pull' && local && remote) {
      await applyPull(local.id, remote, keys);
      tally.pulled += 1;
    } else if (action.kind === 'push' && local && writable) {
      await pushUpdate(row, local, writable);
      tally.pushed += 1;
    } else if (action.kind === 'pushDelete' && local && writable) {
      await pushDelete(local, writable, row.provider);
      tally.deleted += 1;
    } else if (action.kind === 'archive' && local && remote) {
      await archiveLocal(local.id, remote, keys);
      tally.archived += 1;
    }
  }

  // Optionally push brand-new native tasks in the target team out to the provider.
  if (writable && row.writeBack && config.pushNativeTasks && config.defaultListId) {
    tally.created = await pushNativeCreates(
      orgId,
      row,
      teamId,
      config.defaultListId,
      keys,
      writable,
    );
  }

  return tally;
}

/** Insert a remote item as a new linked task, persisting the two-way anchors. */
async function insertLinked(
  orgId: string,
  actorId: string,
  integrationId: string,
  teamId: string,
  item: ImportedItem,
  keys: StateKeys,
  assigneeId: string | null,
): Promise<void> {
  const anchor = item.provenance.externalUpdatedAt
    ? new Date(item.provenance.externalUpdatedAt)
    : null;
  await db.insert(task).values({
    organizationId: orgId,
    title: item.title,
    description: item.body ?? null,
    teamId,
    state: item.completed ? keys.completedKey : keys.openKey,
    ...(item.completed ? { completedAt: anchor ?? new Date() } : {}),
    ...(assigneeId !== null ? { assigneeId } : {}),
    ...(item.dueDate ? { dueDate: new Date(item.dueDate) } : {}),
    source: 'linked',
    sourceIntegrationId: integrationId,
    externalId: item.provenance.externalId,
    externalUrl: item.provenance.externalUrl ?? null,
    sourceSyncMode: 'mirror',
    externalListId: item.provenance.externalListId ?? null,
    externalEtag: item.provenance.externalEtag ?? null,
    // Echo guard: stamp updatedAt == externalUpdatedAt so the task is born clean.
    ...(anchor ? { externalUpdatedAt: anchor, updatedAt: anchor } : {}),
    createdBy: actorId,
  });
}

/** Apply a newer remote's fields onto a local linked task and restamp the anchors. */
async function applyPull(taskId: string, item: ImportedItem, keys: StateKeys): Promise<void> {
  const anchor = item.provenance.externalUpdatedAt
    ? new Date(item.provenance.externalUpdatedAt)
    : new Date();
  await db
    .update(task)
    .set({
      title: item.title,
      description: item.body ?? null,
      state: item.completed ? keys.completedKey : keys.openKey,
      completedAt: item.completed ? anchor : null,
      dueDate: item.dueDate ? new Date(item.dueDate) : null,
      externalListId: item.provenance.externalListId ?? null,
      externalEtag: item.provenance.externalEtag ?? null,
      // Echo guard: updatedAt == externalUpdatedAt → clean, next pull is a no-op.
      externalUpdatedAt: anchor,
      updatedAt: anchor,
    })
    .where(eq(task.id, taskId));
}

/** Push a dirty local task's fields to the provider and restamp the anchors from the echo. */
async function pushUpdate(
  row: IntegrationRow,
  local: ReconcileLocalTask,
  writable: WritableConnector,
): Promise<void> {
  const listId = local.externalListId ?? '@default';
  const result = await writable.pushTask({
    connectionId: row.id,
    provider: asProvider(row.provider),
    op: {
      kind: 'update',
      listId,
      externalId: local.externalId,
      ...(local.externalEtag ? { etag: local.externalEtag } : {}),
      title: local.title,
      notes: local.description,
      dueDate: local.dueDate ? local.dueDate.toISOString() : null,
      completed: local.stateType === 'completed',
    },
  });
  if (!result) return;
  const anchor = new Date(result.externalUpdatedAt);
  await db
    .update(task)
    .set({
      externalEtag: result.externalEtag ?? null,
      lastPushedAt: anchor,
      externalUpdatedAt: anchor,
      updatedAt: anchor,
    })
    .where(eq(task.id, local.id));
}

/** Delete a locally-canceled task at the provider and mark the local row clean. */
async function pushDelete(
  local: ReconcileLocalTask,
  writable: WritableConnector,
  provider: string,
): Promise<void> {
  await writable.pushTask({
    connectionId: local.externalListId ?? local.id,
    provider: asProvider(provider),
    op: {
      kind: 'delete',
      listId: local.externalListId ?? '@default',
      externalId: local.externalId,
    },
  });
  const now = new Date();
  await db
    .update(task)
    .set({ lastPushedAt: now, externalUpdatedAt: now, updatedAt: now })
    .where(eq(task.id, local.id));
}

/** Archive a local linked task whose remote was tombstoned. */
async function archiveLocal(taskId: string, item: ImportedItem, keys: StateKeys): Promise<void> {
  const anchor = item.provenance.externalUpdatedAt
    ? new Date(item.provenance.externalUpdatedAt)
    : new Date();
  await db
    .update(task)
    .set({
      state: keys.canceledKey,
      canceledAt: anchor,
      externalUpdatedAt: anchor,
      updatedAt: anchor,
    })
    .where(eq(task.id, taskId));
}

/** Push every native task in the target team with no external id out as a new provider task. */
async function pushNativeCreates(
  orgId: string,
  row: IntegrationRow,
  teamId: string,
  defaultListId: string,
  keys: StateKeys,
  writable: WritableConnector,
): Promise<number> {
  const natives = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.organizationId, orgId),
        eq(task.teamId, teamId),
        eq(task.source, 'native'),
        isNull(task.externalId),
      ),
    );
  let created = 0;
  for (const t of natives) {
    const result = await writable.pushTask({
      connectionId: row.id,
      provider: asProvider(row.provider),
      op: {
        kind: 'create',
        listId: defaultListId,
        title: t.title,
        notes: t.description,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
        completed: keys.typeOf(t.state) === 'completed',
      },
    });
    if (!result) continue;
    const anchor = new Date(result.externalUpdatedAt);
    await db
      .update(task)
      .set({
        source: 'linked',
        sourceIntegrationId: row.id,
        sourceSyncMode: 'mirror',
        externalId: result.externalId,
        externalListId: defaultListId,
        externalEtag: result.externalEtag ?? null,
        lastPushedAt: anchor,
        externalUpdatedAt: anchor,
        updatedAt: anchor,
      })
      .where(eq(task.id, t.id));
    created += 1;
  }
  return created;
}

/** Narrow a stored provider string for the connector push input (already validated upstream). */
function asProvider(provider: string): ImportedItem['provenance']['provider'] {
  return provider as ImportedItem['provenance']['provider'];
}

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
import { and, eq } from 'drizzle-orm';
import { db, task, team } from '@docket/db';
import { type WorkStatusCategory } from '@docket/work/work-status-contract';
import type { ExternalWriteResult, ImportedItem } from '@docket/integrations';
import type { WritableConnector } from '@docket/integrations';

import { ConflictError } from '../error';
import {
  applySubtaskCompletionPolicyForParents,
  finishTaskStateTransition,
  type TaskStateMutation,
  writeTaskStateTransition,
} from '../lib/task-state';
import { loadStatusSets, type ResolvedStatus, type StatusSets } from '../lib/work-status';
import { serializableTx } from '../lib/serializable-tx';
import { enqueueSearchUpsert } from '../search/write-through';

import { type IntegrationRow } from './integration-provider';
import {
  descriptionHash,
  planTaskReconcile,
  pulledBodyHash,
  type ReconcileLocalTask,
} from './integration-reconcile-plan';
import {
  countWriteContent,
  pushDelete,
  pushLocalEdit,
  pushNativeCreates,
  type ReconcileTally,
} from './integration-reconcile-push';
import { loadTaskReconcileInputs } from './integration-import-scope';
import { wouldCreateSubtaskCycle } from './task-helpers';

export { planTaskReconcile, type ReconcileLocalTask } from './integration-reconcile-plan';

/** The statuses reconciliation moves a linked task between, from one team's Task set. */
export interface ReconcileStatuses {
  /** Where a newly-inserted or reopened task lands. */
  readonly open: ResolvedStatus;
  /** The status a completed remote maps onto. */
  readonly completed: ResolvedStatus;
  /** The status a locally canceled task or a tombstoned remote maps onto. */
  readonly canceled: ResolvedStatus;
  /** The category a stored status key behaves as. */
  readonly typeOf: (key: string) => WorkStatusCategory;
}

/**
 * Resolve the three statuses reconciliation writes for a team.
 *
 * @remarks
 * Each one comes from {@link StatusSets.firstOfCategory}, whose fallback chain walks outward
 * through the taxonomy and settles on the set's default — so a workspace that names no `canceled`
 * status still gets an answer, and it is a status the set genuinely contains. Every write pairs
 * the returned status's key with its id, which is what the composite foreign key holds together.
 *
 * @param sets - The workspace's loaded status sets.
 * @param teamId - The team linked tasks attach to, which decides whether a forked set applies.
 * @returns the statuses to write, plus the category of any key already stored on a local task.
 * @throws {ConflictError} When the workspace has no Task statuses at all.
 */
export function resolveStateKeys(sets: StatusSets, teamId: string): ReconcileStatuses {
  const open = sets.firstOfCategory('task', 'unstarted', teamId);
  const completed = sets.firstOfCategory('task', 'completed', teamId);
  const canceled = sets.firstOfCategory('task', 'canceled', teamId);
  if (open === undefined || completed === undefined || canceled === undefined) {
    throw new ConflictError('This workspace has no task statuses to reconcile work into');
  }
  const categories = new Map(
    sets.for('task', teamId).map((status) => [status.key, status.category] as const),
  );
  // A key the set no longer has belongs to a status that was renamed or removed out from under an
  // older row; reading it as `backlog` keeps such a task open rather than pushing it as finished.
  return { open, completed, canceled, typeOf: (key) => categories.get(key) ?? 'backlog' };
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
  /**
   * Two-sided edits Docket won this pass, each written to the sync conflict log.
   *
   * @remarks
   * Always equal to the number of `audit_event` conflict rows written by this pass — the tally
   * and the durable record cannot disagree, because they are incremented by the same branch.
   */
  readonly conflicts: number;
  /** Pushes whose long-form content the provider accepted. */
  readonly contentWritten: number;
  /** Pushes whose fields landed but whose long-form content the connection may not edit. */
  readonly contentInaccessible: number;
  /** Pushes whose fields landed but whose long-form content the provider would not replace. */
  readonly contentRejected: number;
}

/** Options for {@link reconcileTasks}. */
export interface ReconcileOptions {
  /** Assignee for newly-inserted linked tasks, or null to leave unassigned. */
  readonly assigneeId: string | null;
  /** The write-back seam, when the connector supports it (null = read-only). */
  readonly writable: WritableConnector | null;
  /**
   * Whether `items` holds only the rows the provider reports changed since a cursor. A linked
   * task missing from such a read, in a container the read covered, is unchanged at the provider,
   * so its local edits are pushed.
   */
  readonly readChangedOnly?: boolean;
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
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  if (teamRows.length === 0) {
    throw new ConflictError('Organization has no team to reconcile work into');
  }
  const sets = await loadStatusSets(orgId, { entityTypes: ['task'], teamIds: [teamId] });
  const keys = resolveStateKeys(sets, teamId);

  const writable = options.writable;
  const writeBack = row.writeBack && writable !== null;
  const { config, defaultListId, localRows, remoteById } = await loadTaskReconcileInputs(
    row,
    orgId,
    items,
  );
  const localById = new Map<string, (typeof localRows)[number]>();
  for (const t of localRows) if (t.externalId) localById.set(t.externalId, t);

  // Parent linkage (`ImportedItem.parentExternalId`) resolves against this map, which starts as
  // the already-linked tasks and grows as inserts land — so a child inserted in the same batch as
  // its parent still finds a real task id, provided the parent is processed first (see the
  // depth ordering below).
  const taskIdByExternalId = new Map<string, string>();
  for (const t of localRows) if (t.externalId) taskIdByExternalId.set(t.externalId, t.id);

  const tally: ReconcileTally = {
    inserted: 0,
    pulled: 0,
    pushed: 0,
    deleted: 0,
    archived: 0,
    created: 0,
    conflicts: 0,
    contentWritten: 0,
    contentInaccessible: 0,
    contentRejected: 0,
  };
  const countContent = (state: ExternalWriteResult['contentState']): void => {
    countWriteContent(tally, state);
  };
  const absentIsUnchanged = absentUnchangedRule(options.readChangedOnly, config.listIds);

  const externalIds = new Set<string>([...localById.keys(), ...remoteById.keys()]);
  for (const externalId of orderParentsFirst(externalIds, remoteById)) {
    const localRow = localById.get(externalId);
    const remote = remoteById.get(externalId);
    const local = localRow && toReconcileLocal(localRow, externalId, keys);

    // The action kind guarantees which of local/remote/writable are present; the explicit
    // guards re-narrow that for the type system (the repo forbids non-null assertions).
    const action = planTaskReconcile(local, remote, {
      writeBack,
      absentIsUnchanged: absentIsUnchanged(local),
    });
    if (action.kind === 'insert' && remote) {
      const insertedId = await insertLinked(
        orgId,
        actorId,
        row.id,
        teamId,
        remote,
        keys,
        options.assigneeId,
        resolveParentTaskId(remote, taskIdByExternalId),
      );
      taskIdByExternalId.set(externalId, insertedId);
      tally.inserted += 1;
    } else if (action.kind === 'pull' && local && remote) {
      await applyPull(orgId, local.id, remote, keys, taskIdByExternalId);
      await enqueueSearchUpsert(orgId, 'task', local.id);
      tally.pulled += 1;
    } else if (action.kind === 'push' && local && writable) {
      const pass = { orgId, actorId, row, writable, tally };
      await pushLocalEdit(pass, local, action.conflict, remote);
    } else if (action.kind === 'pushDelete' && local && writable) {
      await pushDelete(local, writable, row.provider);
      await enqueueSearchUpsert(orgId, 'task', local.id);
      tally.deleted += 1;
    } else if (action.kind === 'archive' && local && remote) {
      await archiveLocal(orgId, local.id, remote, keys);
      await enqueueSearchUpsert(orgId, 'task', local.id);
      tally.archived += 1;
    }
  }

  // Optionally push brand-new native tasks in the target team out to the provider.
  if (writable && row.writeBack && config.pushNativeTasks && defaultListId) {
    tally.created = await pushNativeCreates(orgId, row, writable, {
      teamId,
      defaultListId,
      keys,
      countContent,
    });
  }

  return tally;
}

/**
 * Build the rule for whether a linked task missing from this read is unchanged at the provider.
 *
 * @param readChangedOnly - Whether the read returned only rows changed since a cursor.
 * @param listIds - The containers the read covered; absent or empty means all of them.
 * @returns a predicate that is true for a task in a covered container of a changed-rows-only read.
 */
function absentUnchangedRule(
  readChangedOnly: boolean | undefined,
  listIds: readonly string[] | undefined,
): (local: ReconcileLocalTask | undefined) => boolean {
  if (readChangedOnly !== true) return () => false;
  if (listIds === undefined || listIds.length === 0) return () => true;
  const covered = new Set(listIds);
  return (local) => {
    const listId = local?.externalListId;
    return typeof listId === 'string' && covered.has(listId);
  };
}

/**
 * Order external ids so every parent precedes its children.
 *
 * @remarks
 * `insertLinked` resolves `parentExternalId` against the tasks that exist at the moment it runs,
 * so a child inserted before its parent would degrade to a top-level task. Sorting by depth in
 * the pulled batch's parent chain (a top-level item is depth 0, its children 1, and so on) makes
 * the degradation impossible for any batch that carries the parent. The sort is stable, so items
 * at the same depth keep the pull's order. A malformed parent cycle cannot recurse forever: each
 * id pre-seeds its own depth as 0 before walking to its parent, so the walk that re-enters the
 * cycle reads that placeholder and stops — members of a multi-node cycle end up with finite,
 * entry-order-dependent depths (e.g. a↔b memoizes as b=1, a=2), which is meaningless as
 * hierarchy but harmless as an ordering.
 */
function orderParentsFirst(
  externalIds: ReadonlySet<string>,
  remoteById: ReadonlyMap<string, ImportedItem>,
): readonly string[] {
  const depths = new Map<string, number>();
  const depthOf = (id: string): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    depths.set(id, 0); // pre-seed so a parent cycle terminates at this id instead of recursing
    const parentId = remoteById.get(id)?.parentExternalId;
    const depth = typeof parentId === 'string' && parentId !== id ? depthOf(parentId) + 1 : 0;
    depths.set(id, depth);
    return depth;
  };
  return [...externalIds].sort((a, b) => depthOf(a) - depthOf(b));
}

/**
 * Resolve an item's `parentExternalId` to the linked parent task's id, or null when the item is
 * top-level or the parent cannot be found (see {@link ImportedItem.parentExternalId}).
 */
function resolveParentTaskId(
  item: ImportedItem,
  taskIdByExternalId: ReadonlyMap<string, string>,
): string | null {
  if (typeof item.parentExternalId !== 'string') return null;
  return taskIdByExternalId.get(item.parentExternalId) ?? null;
}

/** Publish subtask-policy state changes only after their enclosing write commits. */
async function finishHierarchyCascades(cascades: readonly TaskStateMutation[]): Promise<void> {
  for (const cascade of cascades) {
    await finishTaskStateTransition({ actorId: null }, cascade);
  }
}

/** Insert a remote item as a new linked task, persisting the two-way anchors. */
async function insertLinked(
  orgId: string,
  actorId: string,
  integrationId: string,
  teamId: string,
  item: ImportedItem,
  keys: ReconcileStatuses,
  assigneeId: string | null,
  parentTaskId: string | null,
): Promise<string> {
  const anchor = item.provenance.externalUpdatedAt
    ? new Date(item.provenance.externalUpdatedAt)
    : null;
  const status = item.completed ? keys.completed : keys.open;
  const { row, cascades } = await serializableTx(async (tx) => {
    const inserted = await tx
      .insert(task)
      .values({
        organizationId: orgId,
        title: item.title,
        description: item.body ?? null,
        teamId,
        state: status.key,
        statusId: status.id,
        ...(item.completed ? { completedAt: anchor ?? new Date() } : {}),
        ...(assigneeId !== null ? { assigneeId } : {}),
        ...(item.dueDate ? { dueDate: new Date(item.dueDate) } : {}),
        ...(item.startDate ? { startDate: new Date(item.startDate) } : {}),
        // Zero is a real estimate ("no work left"), so test for the type, not truthiness.
        ...(typeof item.estimateMinutes === 'number'
          ? { estimateMinutes: item.estimateMinutes }
          : {}),
        ...(parentTaskId !== null ? { parentTaskId } : {}),
        source: 'linked',
        sourceIntegrationId: integrationId,
        externalId: item.provenance.externalId,
        externalUrl: item.provenance.externalUrl ?? null,
        sourceSyncMode: 'mirror',
        externalListId: item.provenance.externalListId ?? null,
        externalEtag: item.provenance.externalEtag ?? null,
        // The new task's description is `item.body`, so that is the copy it starts in step with.
        externalBodyHash: descriptionHash(item.body ?? null),
        // Echo guard: stamp updatedAt == externalUpdatedAt so the task is born clean.
        ...(anchor ? { externalUpdatedAt: anchor, updatedAt: anchor } : {}),
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
    if (!row) throw new Error('linked task insert returned no row');
    return {
      row,
      cascades: await applySubtaskCompletionPolicyForParents(tx, orgId, [row.parentTaskId]),
    };
  });
  await finishHierarchyCascades(cascades);
  await enqueueSearchUpsert(orgId, 'task', row.id);
  return row.id;
}

/** Apply a newer remote's fields onto a local linked task and restamp the anchors. */
async function applyPull(
  orgId: string,
  taskId: string,
  item: ImportedItem,
  keys: ReconcileStatuses,
  taskIdByExternalId: ReadonlyMap<string, string>,
): Promise<void> {
  /* v8 ignore next -- @preserve defensive: applyPull's one call site only runs when
   * planTaskReconcile returned 'pull', which requires `remoteNewer`, which itself requires
   * `remote.provenance.externalUpdatedAt` to be parseable — so it is always truthy here. */
  const anchor = item.provenance.externalUpdatedAt
    ? new Date(item.provenance.externalUpdatedAt)
    : new Date();
  // `startDate`/`estimateMinutes`/`parentExternalId` are patched only when the provider carries
  // the concept (`undefined` means it does not — see the ImportedItem field docs), so a connector
  // without them cannot clear a value the user set locally. An explicit `null` DOES clear. An
  // unresolvable (or self-referencing) parent id leaves the local parent alone: hierarchy is
  // metadata, and a broken reference must not detach or corrupt existing structure.
  const status = item.completed ? keys.completed : keys.open;
  const patch = {
    title: item.title,
    // A body the provider could not hand over in full leaves the local description as it is.
    ...(item.bodyUnavailable === true ? {} : { description: item.body ?? null }),
    dueDate: item.dueDate ? new Date(item.dueDate) : null,
    ...(item.startDate !== undefined
      ? { startDate: item.startDate ? new Date(item.startDate) : null }
      : {}),
    ...(item.estimateMinutes !== undefined ? { estimateMinutes: item.estimateMinutes } : {}),
    ...(item.parentExternalId === null ? { parentTaskId: null } : {}),
    externalListId: item.provenance.externalListId ?? null,
    externalEtag: item.provenance.externalEtag ?? null,
    // Echo guard: updatedAt == externalUpdatedAt → clean, next pull is a no-op.
    externalUpdatedAt: anchor,
    updatedAt: anchor,
  };

  const resolvedParent =
    typeof item.parentExternalId === 'string'
      ? taskIdByExternalId.get(item.parentExternalId)
      : undefined;
  if (resolvedParent !== undefined && resolvedParent !== taskId) {
    // Re-parenting to a non-null parent must uphold the same acyclic invariant the PATCH route
    // enforces (tasks.ts): check + write atomically under SERIALIZABLE, via the same
    // `wouldCreateSubtaskCycle` walk, so a pull racing another reparent can't commit a loop the
    // per-row CHECK (length-1 only) would miss. Where PATCH rejects with a 409, a pull DROPS the
    // parent link and keeps the rest of the update: hierarchy is metadata here (an unresolvable
    // parent already degrades the same way), and refusing the whole item over it would abort a
    // sync run because of one bad remote edge.
    const result = await serializableTx(async (tx) => {
      const before = await tx
        .select()
        .from(task)
        .where(and(eq(task.id, taskId), eq(task.organizationId, orgId)))
        .for('update')
        .limit(1);
      const current = before[0];
      if (!current) return null;
      const cyclic = await wouldCreateSubtaskCycle(tx, orgId, taskId, resolvedParent);
      await tx
        .update(task)
        .set({
          ...patch,
          externalBodyHash: pulledBodyHash(item, current.description),
          ...(cyclic ? {} : { parentTaskId: resolvedParent }),
        })
        .where(eq(task.id, taskId))
        .returning();
      const mutation = await writeTaskStateTransition(tx, {
        before: current,
        statusId: status.id,
        state: status.key,
        completedAt: item.completed ? anchor : null,
        canceledAt: null,
        updatedAt: anchor,
      });
      if (!mutation) return null;
      return {
        mutation,
        cascades: await applySubtaskCompletionPolicyForParents(tx, orgId, [
          current.parentTaskId,
          mutation.after.parentTaskId,
        ]),
      };
    });
    if (!result) return;
    await finishTaskStateTransition({ actorId: null }, result.mutation);
    await finishHierarchyCascades(result.cascades);
    return;
  }
  const result = await serializableTx(async (tx) => {
    const before = await tx
      .select()
      .from(task)
      .where(and(eq(task.id, taskId), eq(task.organizationId, orgId)))
      .for('update')
      .limit(1);
    const current = before[0];
    if (!current) return null;
    await tx
      .update(task)
      .set({ ...patch, externalBodyHash: pulledBodyHash(item, current.description) })
      .where(eq(task.id, taskId))
      .returning();
    const mutation = await writeTaskStateTransition(tx, {
      before: current,
      statusId: status.id,
      state: status.key,
      completedAt: item.completed ? anchor : null,
      canceledAt: null,
      updatedAt: anchor,
    });
    if (!mutation) return null;
    return {
      mutation,
      cascades: await applySubtaskCompletionPolicyForParents(tx, orgId, [
        current.parentTaskId,
        mutation.after.parentTaskId,
      ]),
    };
  });
  if (!result) return;
  await finishTaskStateTransition({ actorId: null }, result.mutation);
  await finishHierarchyCascades(result.cascades);
}

/** Project a stored linked task to what {@link planTaskReconcile} decides from. */
function toReconcileLocal(
  row: typeof task.$inferSelect,
  externalId: string,
  keys: ReconcileStatuses,
): ReconcileLocalTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    state: row.state,
    stateType: keys.typeOf(row.state),
    dueDate: row.dueDate,
    updatedAt: row.updatedAt,
    externalId, // the map key — only tasks that have an external id are indexed
    externalUpdatedAt: row.externalUpdatedAt,
    externalEtag: row.externalEtag,
    externalListId: row.externalListId,
    externalBodyHash: row.externalBodyHash,
  };
}

/** Archive a local linked task whose remote was tombstoned. */
async function archiveLocal(
  orgId: string,
  taskId: string,
  item: ImportedItem,
  keys: ReconcileStatuses,
): Promise<void> {
  const anchor = item.provenance.externalUpdatedAt
    ? new Date(item.provenance.externalUpdatedAt)
    : new Date();
  const result = await serializableTx(async (tx) => {
    const before = await tx
      .select()
      .from(task)
      .where(and(eq(task.id, taskId), eq(task.organizationId, orgId)))
      .for('update')
      .limit(1);
    const current = before[0];
    if (!current) return null;
    await tx
      .update(task)
      .set({
        externalUpdatedAt: anchor,
        updatedAt: anchor,
      })
      .where(eq(task.id, taskId))
      .returning();
    const mutation = await writeTaskStateTransition(tx, {
      before: current,
      statusId: keys.canceled.id,
      state: keys.canceled.key,
      completedAt: null,
      canceledAt: anchor,
      updatedAt: anchor,
    });
    if (!mutation) return null;
    return {
      mutation,
      cascades: await applySubtaskCompletionPolicyForParents(tx, orgId, [
        current.parentTaskId,
        mutation.after.parentTaskId,
      ]),
    };
  });
  if (!result) return;
  await finishTaskStateTransition({ actorId: null }, result.mutation);
  await finishHierarchyCascades(result.cascades);
}

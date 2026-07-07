/**
 * `@docket/api` — work-graph reconciliation (the two-way mirror for Linear).
 *
 * @remarks
 * The rich sibling of {@link import('./integration-reconcile')} (which mirrors flat Google
 * Tasks): this module consumes a {@link WorkGraphSnapshot} pulled from a work-graph connector
 * and reconciles its users, labels, projects, cycles, and work items into first-party rows,
 * with the same last-write-wins (LWW) + echo-guard timestamp discipline the gtasks reconciler
 * proved out:
 *
 * - the **anchor** `externalUpdatedAt` (on `task`/`project`/`cycle`) is both the LWW comparison
 *   point and the echo guard; a mirrored row is **dirty** (locally edited since the last sync)
 *   iff `externalUpdatedAt IS NOT NULL AND updatedAt > externalUpdatedAt`;
 * - every provider-sourced write stamps `updatedAt = externalUpdatedAt = <remote updatedAt>`
 *   *explicitly* (overriding Drizzle's `$onUpdate`) so the row is clean afterward and the next
 *   pull — or the webhook echo of our own push — is a no-op;
 * - after a successful push we stamp `lastPushedAt = externalUpdatedAt = updatedAt =
 *   pushResult.externalUpdatedAt`, so the echo webhook (`incoming.updatedAt <=
 *   row.externalUpdatedAt`) is suppressed;
 * - **absence from a snapshot is a NOOP** — a row is only ever archived/canceled on an explicit
 *   `removed: true` tombstone, never because a scoped/incremental pull didn't return it.
 *
 * The per-item direction decision ({@link planWorkItemReconcile}) is a pure function (a twin of
 * `planTaskReconcile`, richer-field but same LWW skeleton — see the forking note in the T6a
 * report); {@link reconcileWorkGraph} orchestrates the phased DB reads/writes and the push.
 *
 * Labels carry no timestamp columns, so their idempotency is content-comparison, not LWW:
 * a label write fires only when the mirrored name/color actually changed.
 *
 * The single-entity appliers ({@link applyLabel}/{@link applyProject}/{@link applyCycle}/
 * {@link applyWorkItem}) are the same upsert logic the phases use, factored so the Slice-3b
 * webhook applier can apply one entity outside a full snapshot. They trust the
 * {@link GraphApplyContext} maps as authoritative for existence (a miss means insert), so the
 * orchestrator (a phase here, the webhook applier there) is responsible for preloading the
 * integration's existing rows — this keeps existence checks batched, never per-item selects.
 */
import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { cycle, db, label, project, task, taskLabel, team } from '@docket/db';
import type { WorkflowState, WorkflowStateType } from '@docket/db';
import { ConnectorConfig } from '@docket/types';
import type {
  ExternalCycle,
  ExternalLabel,
  ExternalPriority,
  ExternalProject,
  ExternalStateType,
  ExternalWorkflowState,
  ExternalWorkItem,
  WorkGraphConnector,
  WorkGraphSnapshot,
  WorkItemPushFields,
} from '@docket/integrations';

import { ConflictError } from '../error';

import { externalActorReverseMap, syncExternalActors } from './integration-identity';
import { resolveImportTeam } from './integration-import';
import { type IntegrationRow } from './integration-provider';

/** Selected row shapes reconciliation reads. */
type LabelRow = typeof label.$inferSelect;
type ProjectRow = typeof project.$inferSelect;
type CycleRow = typeof cycle.$inferSelect;
type TaskRow = typeof task.$inferSelect;

/** Per-entity-kind outcome tally for one reconcile pass. */
export interface KindTally {
  /** Rows newly inserted from the provider. */
  created: number;
  /** Rows whose fields were updated from a newer/changed provider entity. */
  updated: number;
  /** Rows skipped this pass (no-op: not newer, not dirty, or nothing changed). */
  skipped: number;
  /** Rows removed via an explicit tombstone (task archived; project canceled). */
  removed: number;
  /** Dirty rows whose local edits were pushed to the provider (tasks only). */
  pushed: number;
}

/** The per-entity-kind tallies for a whole {@link reconcileWorkGraph} pass. */
export interface WorkGraphReconcileResult {
  readonly labels: KindTally;
  readonly projects: KindTally;
  readonly cycles: KindTally;
  readonly tasks: KindTally;
}

const emptyTally = (): KindTally => ({ created: 0, updated: 0, skipped: 0, removed: 0, pushed: 0 });

/**
 * The shared context every single-entity applier reads and mutates.
 *
 * @remarks
 * The `existing*` maps are authoritative for existence: a miss means "insert", never "go
 * query" — the orchestrator preloads the integration's existing rows once (batched). The
 * `*IdByExternal` result maps are populated as rows are upserted so later phases resolve
 * cross-references (a task's project/cycle/labels/parent) without further reads.
 */
export interface GraphApplyContext {
  readonly orgId: string;
  readonly actorId: string;
  readonly integrationId: string;
  /** Whether local→provider pushes are enabled for this integration. */
  readonly writeBack: boolean;
  /** The reconcile clock (cycle-status derivation, tombstone stamps). */
  readonly now: Date;
  /** `externalUserId → actorId | null` for this snapshot's users (from {@link syncExternalActors}). */
  readonly identityMap: ReadonlyMap<string, string | null>;
  /** Resolve an external team id to its mapped Docket team id, or `undefined` when unmapped. */
  readonly resolveTeam: (externalTeamId: string) => string | undefined;
  /** The mapped Docket team's workflow states, keyed by Docket team id (for state resolution). */
  readonly statesByTeam: ReadonlyMap<string, readonly WorkflowState[]>;
  readonly existingLabelsByExternal: ReadonlyMap<string, LabelRow>;
  readonly existingLabelsByScopeName: ReadonlyMap<string, LabelRow>;
  readonly existingProjectsByExternal: ReadonlyMap<string, ProjectRow>;
  readonly existingCyclesByExternal: ReadonlyMap<string, CycleRow>;
  readonly existingTasksByExternal: ReadonlyMap<string, TaskRow>;
  readonly labelIdByExternal: Map<string, string>;
  readonly projectIdByExternal: Map<string, string>;
  readonly cycleIdByExternal: Map<string, string>;
  readonly taskIdByExternal: Map<string, string>;
  /**
   * The accumulating per-entity-kind tallies this apply writes into.
   *
   * @remarks
   * {@link reconcileWorkGraph} owns one and threads it through every phase; a standalone caller
   * (the Slice-3b webhook applier) passes its own to observe the single-entity outcome.
   */
  readonly result: WorkGraphReconcileResult;
}

/** The direction a snapshot work item flows in the pull pass. */
export type WorkItemPullAction =
  /** New external item → create a linked task. */
  | 'insert'
  /** Provider is the newer side → apply its fields onto the local task. */
  | 'pull'
  /** Explicit tombstone → archive the local task. */
  | 'archive'
  /** Nothing to do in the pull pass (unchanged, or local-dirty-wins → the push phase handles it). */
  | 'noop';

/** Whether a mirrored row has local edits not yet reflected at the provider (the dirty rule). */
function isDirty(updatedAt: Date, externalUpdatedAt: Date | null): boolean {
  return externalUpdatedAt !== null && updatedAt.getTime() > externalUpdatedAt.getTime();
}

/**
 * Decide which way one snapshot work item flows in the pull pass — the pure heart of
 * work-item reconciliation, a twin of `planTaskReconcile`'s LWW skeleton.
 *
 * @remarks
 * Unlike the gtasks twin there is no `pushDelete`: a work item is never deleted, and a locally
 * canceled task simply pushes the team's canceled-type state. The push directions therefore
 * collapse to `noop` here (the local row stays dirty and the separate push phase drains it), so
 * this function only ever decides the *pull* side. `writeBack` gates whether a dirty local is
 * even allowed to win: a read-only mirror always yields to a newer provider.
 *
 * @param local - The local linked task's timestamps, or `undefined` when the provider has one
 *   we don't.
 * @param remote - The pulled work item, or `undefined` when this integration has a linked task
 *   the snapshot didn't return.
 * @param opts - `writeBack` enables the local-dirty-wins branch.
 */
export function planWorkItemReconcile(
  local: { readonly updatedAt: Date; readonly externalUpdatedAt: Date | null } | undefined,
  remote: ExternalWorkItem | undefined,
  opts: { readonly writeBack: boolean },
): WorkItemPullAction {
  if (!local) {
    if (!remote || remote.removed) return 'noop';
    return 'insert';
  }
  // Absence never destroys local work — a scoped/incremental pull most likely just filtered it.
  if (!remote) return 'noop';

  const remoteMs = Date.parse(remote.updatedAt);
  const anchorMs = local.externalUpdatedAt?.getTime();
  const remoteNewer = anchorMs === undefined || remoteMs > anchorMs;
  const dirty = opts.writeBack && isDirty(local.updatedAt, local.externalUpdatedAt);

  // A tombstone archives instead of pulling, but rides the SAME LWW/anchor skeleton as a live
  // update — it only wins when it is genuinely newer than the anchor. An already-applied tombstone
  // (`removed` with `remoteMs <= anchorMs`) is a no-op, so a second full sync doesn't rewrite the
  // archived row; and a dirty local edit that post-dates the removal wins (LWW), never silently
  // re-archived — the push phase drains it.
  const pullAction: WorkItemPullAction = remote.removed ? 'archive' : 'pull';

  if (dirty) {
    if (!remoteNewer) return 'noop'; // local will push
    // Both sides changed since the last sync: the newer timestamp wins.
    return local.updatedAt.getTime() >= remoteMs ? 'noop' : pullAction;
  }
  return remoteNewer ? pullAction : 'noop';
}

/* ────────────────────────────── field mapping ────────────────────────────── */

/** Map an external project lifecycle state onto Docket's {@link projectStatus} enum. */
function mapProjectStatus(
  state: ExternalProject['state'],
): 'planned' | 'active' | 'completed' | 'canceled' {
  switch (state) {
    case 'backlog':
    case 'planned':
    case 'paused':
      return 'planned';
    case 'started':
      return 'active';
    case 'completed':
      return 'completed';
    case 'canceled':
      return 'canceled';
  }
}

/**
 * Derive a Docket {@link cycleStatus} from an external cycle's dates.
 *
 * @remarks
 * The `cycle` table has no external status field to mirror — its model is date-driven — so we
 * classify from `completedAt`/`startsAt`/`endsAt` against the reconcile clock: an explicit
 * `completedAt` (or a window fully in the past) is `completed`, a window not yet begun is
 * `upcoming`, and an in-flight window is `active`.
 */
function deriveCycleStatus(
  external: ExternalCycle,
  now: Date,
): 'upcoming' | 'active' | 'completed' {
  if (external.completedAt) return 'completed';
  const startsMs = Date.parse(external.startsAt);
  const endsMs = Date.parse(external.endsAt);
  const nowMs = now.getTime();
  if (nowMs < startsMs) return 'upcoming';
  if (nowMs >= endsMs) return 'completed';
  return 'active';
}

/** The Docket workflow-state type an external state type maps onto (triage folds into backlog). */
function toWorkflowStateType(stateType: ExternalStateType): WorkflowStateType {
  return stateType === 'triage' ? 'backlog' : stateType;
}

/**
 * Resolve the Docket team state key for an external state type (first by type, else the team's
 * first/backlog-ish state).
 *
 * @remarks
 * Unreachable in the batch path (the orchestrator only maps items on teams whose states it
 * preloaded), but the exported single-entity appliers can be driven with an unpreloaded
 * `statesByTeam` — so an EMPTY state list throws a descriptive mapping error rather than silently
 * inventing a `'backlog'` key that no team defines.
 */
function resolveStateKey(states: readonly WorkflowState[], stateType: ExternalStateType): string {
  const want = toWorkflowStateType(stateType);
  const byType = states.find((s) => s.type === want);
  if (byType) return byType.key;
  const first = states[0];
  if (first) return first.key;
  throw new ConflictError('Team has no workflow states to map an external work item onto');
}

/** The canonical type of a Docket team state key (defaults to backlog for an unknown key). */
function stateTypeOfKey(states: readonly WorkflowState[], key: string): WorkflowStateType {
  return states.find((s) => s.key === key)?.type ?? 'backlog';
}

/** Parse an RFC3339 date/timestamp to a Date, or null when absent. */
function toDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

/** The task-completion/cancel timestamps a pulled item implies (explicit stamp, else the anchor). */
function lifecycleStamps(
  item: ExternalWorkItem,
  anchor: Date,
): { completedAt: Date | null; canceledAt: Date | null } {
  const completedAt = toDate(item.completedAt) ?? (item.stateType === 'completed' ? anchor : null);
  const canceledAt = toDate(item.canceledAt) ?? (item.stateType === 'canceled' ? anchor : null);
  return { completedAt, canceledAt };
}

/** The scope key a label dedupes on: its Docket team (or the org, when workspace-level) + name. */
function labelScopeKey(teamId: string | null, name: string): string {
  return `${teamId ?? '@org'}::${name}`;
}

/* ────────────────────────────── single-entity appliers ───────────────────── */

/**
 * Upsert one external label into its Docket scope, adopting a name-colliding native label.
 *
 * @remarks
 * A workspace-level label (`externalTeamId` absent) lands org-level (`teamId = null`); a
 * team-scoped label lands in the mapped Docket team, and is skipped when that team is unmapped.
 * Provenance `(sourceIntegrationId, externalId)` is the identity: an existing linked row is
 * updated in place (rename/recolor propagation). When no linked row exists but a NATIVE label of
 * the same name occupies the scope, that row is ADOPTED (stamped with provenance) rather than
 * duplicated — the scope's name uniqueness makes a second insert impossible anyway. Records into
 * {@link GraphApplyContext.labelIdByExternal} for the task-label join phase.
 */
export async function applyLabel(ctx: GraphApplyContext, ext: ExternalLabel): Promise<void> {
  const scopeTeamId = ext.externalTeamId ? ctx.resolveTeam(ext.externalTeamId) : null;
  // A team-scoped label whose team isn't mapped is not synced (explicit, no fallback).
  if (ext.externalTeamId && scopeTeamId === undefined) return;
  const teamId = ext.externalTeamId ? (scopeTeamId ?? null) : null;

  const linked = ctx.existingLabelsByExternal.get(ext.externalId);
  if (linked) {
    ctx.labelIdByExternal.set(ext.externalId, linked.id);
    if (linked.name !== ext.name || linked.color !== ext.color) {
      await db
        .update(label)
        .set({ name: ext.name, color: ext.color })
        .where(eq(label.id, linked.id));
      ctx.result.labels.updated += 1;
    } else {
      ctx.result.labels.skipped += 1;
    }
    return;
  }

  const native = ctx.existingLabelsByScopeName.get(labelScopeKey(teamId, ext.name));
  if (native) {
    if (native.externalId === null) {
      // Adopt the native row: stamp provenance (and refresh color) instead of duplicating.
      await db
        .update(label)
        .set({
          sourceIntegrationId: ctx.integrationId,
          externalId: ext.externalId,
          color: ext.color,
        })
        .where(eq(label.id, native.id));
      ctx.labelIdByExternal.set(ext.externalId, native.id);
      ctx.result.labels.updated += 1;
      return;
    }
    // A same-name label already belongs to another integration — can't adopt or duplicate.
    ctx.result.labels.skipped += 1;
    return;
  }

  const inserted = await db
    .insert(label)
    .values({
      organizationId: ctx.orgId,
      name: ext.name,
      color: ext.color,
      ...(teamId !== null ? { teamId } : {}),
      sourceIntegrationId: ctx.integrationId,
      externalId: ext.externalId,
    })
    .returning({ id: label.id });
  const row = inserted[0];
  if (!row) throw new Error('label insert returned no row');
  ctx.labelIdByExternal.set(ext.externalId, row.id);
  ctx.result.labels.created += 1;
}

/**
 * Upsert one external project into its mapped Docket team with LWW conflict handling.
 *
 * @remarks
 * Projects are pull-only (no push phase), so a locally-edited mirrored project is preserved only
 * while the provider hasn't changed; once the provider is newer it overwrites the stale local
 * edit (documented, not silent). The Docket team is the mapped team of the FIRST of the project's
 * shared external teams that resolves (m2m flattening); a project shared only with unmapped teams
 * is skipped. `removed: true` sets status `canceled` (never a delete). Lead resolves via the
 * identity map (unmatched ⇒ null lead, never a fallback).
 */
export async function applyProject(ctx: GraphApplyContext, ext: ExternalProject): Promise<void> {
  const teamId = firstMappedTeam(ctx, ext.externalTeamIds);
  if (teamId === undefined) {
    ctx.result.projects.skipped += 1;
    return;
  }
  const anchor = new Date(ext.updatedAt);
  const leadExternal = ext.leadExternalId;
  const leadId = leadExternal ? (ctx.identityMap.get(leadExternal) ?? null) : null;
  const status = ext.removed ? 'canceled' : mapProjectStatus(ext.state);
  const fields = {
    name: ext.name,
    description: ext.description ?? null,
    leadId,
    teamId,
    status,
    startDate: toDate(ext.startDate),
    targetDate: toDate(ext.targetDate),
    externalUrl: ext.url,
    externalUpdatedAt: anchor,
    updatedAt: anchor,
  };

  const existing = ctx.existingProjectsByExternal.get(ext.externalId);
  if (!existing) {
    // A tombstone for a project we never mirrored is a no-op — materializing an already-archived
    // Linear project as a `canceled` row from nothing is noise (consistent with the work-item rule
    // that removal never creates).
    if (ext.removed) {
      ctx.result.projects.skipped += 1;
      return;
    }
    const inserted = await db
      .insert(project)
      .values({
        organizationId: ctx.orgId,
        source: 'linked',
        sourceIntegrationId: ctx.integrationId,
        externalId: ext.externalId,
        createdBy: ctx.actorId,
        ...fields,
      })
      .returning({ id: project.id });
    const row = inserted[0];
    if (!row) throw new Error('project insert returned no row');
    ctx.projectIdByExternal.set(ext.externalId, row.id);
    ctx.result.projects.created += 1;
    return;
  }

  ctx.projectIdByExternal.set(ext.externalId, existing.id);
  const remoteNewer = existing.externalUpdatedAt === null || anchor > existing.externalUpdatedAt;
  const localDirty = isDirty(existing.updatedAt, existing.externalUpdatedAt);
  if (localDirty && !remoteNewer) {
    ctx.result.projects.skipped += 1;
    return;
  }
  if (!remoteNewer) {
    ctx.result.projects.skipped += 1;
    return;
  }
  await db.update(project).set(fields).where(eq(project.id, existing.id));
  if (ext.removed) ctx.result.projects.removed += 1;
  else ctx.result.projects.updated += 1;
}

/**
 * Upsert one external cycle into its mapped Docket team with LWW conflict handling.
 *
 * @remarks
 * Cycles are pull-only like projects. Status is derived from the cycle's dates (see
 * {@link deriveCycleStatus}) since there is no external status to mirror. A cycle on an unmapped
 * team is skipped; a `removed: true` tombstone soft-archives the row (`archivedAt`) rather than
 * deleting it, since the `cycleStatus` enum has no canceled member.
 */
export async function applyCycle(ctx: GraphApplyContext, ext: ExternalCycle): Promise<void> {
  const teamId = ctx.resolveTeam(ext.externalTeamId);
  if (teamId === undefined) {
    ctx.result.cycles.skipped += 1;
    return;
  }
  const anchor = new Date(ext.updatedAt);
  const fields = {
    teamId,
    number: ext.number,
    name: ext.name ?? null,
    startsAt: new Date(ext.startsAt),
    endsAt: new Date(ext.endsAt),
    status: deriveCycleStatus(ext, ctx.now),
    externalUrl: null,
    externalUpdatedAt: anchor,
    updatedAt: anchor,
    ...(ext.removed ? { archivedAt: ctx.now } : {}),
  };

  const existing = ctx.existingCyclesByExternal.get(ext.externalId);
  if (!existing) {
    // A tombstone for a cycle we never mirrored is a no-op — don't materialize an already-archived
    // Linear cycle from nothing (consistent with the work-item rule that removal never creates).
    if (ext.removed) {
      ctx.result.cycles.skipped += 1;
      return;
    }
    const inserted = await db
      .insert(cycle)
      .values({
        organizationId: ctx.orgId,
        source: 'linked',
        sourceIntegrationId: ctx.integrationId,
        externalId: ext.externalId,
        createdBy: ctx.actorId,
        ...fields,
      })
      .returning({ id: cycle.id });
    const row = inserted[0];
    if (!row) throw new Error('cycle insert returned no row');
    ctx.cycleIdByExternal.set(ext.externalId, row.id);
    ctx.result.cycles.created += 1;
    return;
  }

  ctx.cycleIdByExternal.set(ext.externalId, existing.id);
  const remoteNewer = existing.externalUpdatedAt === null || anchor > existing.externalUpdatedAt;
  const localDirty = isDirty(existing.updatedAt, existing.externalUpdatedAt);
  if ((localDirty && !remoteNewer) || !remoteNewer) {
    ctx.result.cycles.skipped += 1;
    return;
  }
  await db.update(cycle).set(fields).where(eq(cycle.id, existing.id));
  if (ext.removed) ctx.result.cycles.removed += 1;
  else ctx.result.cycles.updated += 1;
}

/**
 * Upsert one external work item into a linked task with LWW conflict handling.
 *
 * @remarks
 * The item's Docket team is the mapped team of its `externalTeamId`; an item on an unmapped team
 * is skipped entirely. State resolves against that team's workflow states by type; priority is
 * 1:1 with the task enum; assignee, project, and cycle resolve via the identity/provenance maps
 * (each unmatched ⇒ null, never a fallback). Completion/cancel timestamps follow the item's own
 * `completedAt`/`canceledAt`, falling back to the anchor for a completed/canceled state with no
 * explicit stamp. Records into {@link GraphApplyContext.taskIdByExternal} (for parent + label
 * linkage) whether the item was inserted, pulled, archived, or a no-op — every mapped item that
 * has a Docket row is tracked. Parent linkage and label joins are applied in the second pass.
 */
export async function applyWorkItem(ctx: GraphApplyContext, item: ExternalWorkItem): Promise<void> {
  const teamId = ctx.resolveTeam(item.externalTeamId);
  if (teamId === undefined) {
    ctx.result.tasks.skipped += 1;
    return;
  }
  const existing = ctx.existingTasksByExternal.get(item.externalId);
  const local = existing
    ? { updatedAt: existing.updatedAt, externalUpdatedAt: existing.externalUpdatedAt }
    : undefined;
  const action = planWorkItemReconcile(local, item, { writeBack: ctx.writeBack });

  if (existing) ctx.taskIdByExternal.set(item.externalId, existing.id);

  if (action === 'insert') {
    const id = await insertLinkedItem(ctx, item, teamId);
    ctx.taskIdByExternal.set(item.externalId, id);
    ctx.result.tasks.created += 1;
    return;
  }
  if (action === 'pull' && existing) {
    await applyItemFields(ctx, existing.id, item, teamId);
    ctx.result.tasks.updated += 1;
    return;
  }
  if (action === 'archive' && existing) {
    await archiveLinkedItem(existing.id, item, ctx.statesByTeam.get(teamId) ?? []);
    ctx.result.tasks.removed += 1;
    return;
  }
  ctx.result.tasks.skipped += 1;
}

/** The provider-sourced column set shared by insert and pull (echo-guarded stamps included). */
function itemColumns(
  ctx: GraphApplyContext,
  item: ExternalWorkItem,
  teamId: string,
): {
  title: string;
  description: string | null;
  teamId: string;
  state: string;
  priority: ExternalPriority;
  assigneeId: string | null;
  projectId: string | null;
  cycleId: string | null;
  estimate: number | null;
  dueDate: Date | null;
  externalUrl: string;
  externalListId: string;
  completedAt: Date | null;
  canceledAt: Date | null;
  externalUpdatedAt: Date;
  updatedAt: Date;
} {
  const anchor = new Date(item.updatedAt);
  const states = ctx.statesByTeam.get(teamId) ?? [];
  const assigneeId = item.assigneeExternalId
    ? (ctx.identityMap.get(item.assigneeExternalId) ?? null)
    : null;
  const projectId = item.projectExternalId
    ? (ctx.projectIdByExternal.get(item.projectExternalId) ?? null)
    : null;
  const cycleId = item.cycleExternalId
    ? (ctx.cycleIdByExternal.get(item.cycleExternalId) ?? null)
    : null;
  const { completedAt, canceledAt } = lifecycleStamps(item, anchor);
  return {
    title: item.title,
    description: item.description ?? null,
    teamId,
    state: resolveStateKey(states, item.stateType),
    priority: item.priority,
    assigneeId,
    projectId,
    cycleId,
    estimate: item.estimate === undefined ? null : Math.round(item.estimate),
    dueDate: toDate(item.dueDate),
    externalUrl: item.url,
    externalListId: item.externalTeamId,
    completedAt,
    canceledAt,
    externalUpdatedAt: anchor,
    updatedAt: anchor,
  };
}

/** Insert a work item as a new linked task, born clean (updatedAt == externalUpdatedAt). */
async function insertLinkedItem(
  ctx: GraphApplyContext,
  item: ExternalWorkItem,
  teamId: string,
): Promise<string> {
  const cols = itemColumns(ctx, item, teamId);
  const inserted = await db
    .insert(task)
    .values({
      organizationId: ctx.orgId,
      source: 'linked',
      sourceIntegrationId: ctx.integrationId,
      externalId: item.externalId,
      sourceSyncMode: 'mirror',
      createdBy: ctx.actorId,
      ...cols,
    })
    .returning({ id: task.id });
  const row = inserted[0];
  if (!row) throw new Error('linked task insert returned no row');
  return row.id;
}

/** Apply a newer provider item's fields onto an existing linked task and restamp the anchors. */
async function applyItemFields(
  ctx: GraphApplyContext,
  taskId: string,
  item: ExternalWorkItem,
  teamId: string,
): Promise<void> {
  await db
    .update(task)
    .set(itemColumns(ctx, item, teamId))
    .where(eq(task.id, taskId));
}

/**
 * Archive a linked task whose provider item was tombstoned (canceled state + stamp).
 *
 * @remarks
 * Resolves the team's canceled-type state (falling back to its last state), throwing a descriptive
 * mapping error on an EMPTY state list rather than stamping a silent `'canceled'` literal no team
 * defines. Unreachable in the batch path (states are preloaded), but the exported appliers can be
 * driven with an unpreloaded `statesByTeam`.
 */
async function archiveLinkedItem(
  taskId: string,
  item: ExternalWorkItem,
  states: readonly WorkflowState[],
): Promise<void> {
  const anchor = new Date(item.updatedAt);
  const canceledKey =
    states.find((s) => s.type === 'canceled')?.key ?? states[states.length - 1]?.key;
  if (canceledKey === undefined) {
    throw new ConflictError('Team has no workflow states to archive a tombstoned work item into');
  }
  await db
    .update(task)
    .set({
      state: canceledKey,
      canceledAt: anchor,
      archivedAt: anchor,
      externalUpdatedAt: anchor,
      updatedAt: anchor,
    })
    .where(eq(task.id, taskId));
}

/** The mapped Docket team of the first external team id that resolves, or `undefined`. */
function firstMappedTeam(
  ctx: GraphApplyContext,
  externalTeamIds: readonly string[],
): string | undefined {
  for (const extId of externalTeamIds) {
    const teamId = ctx.resolveTeam(extId);
    if (teamId !== undefined) return teamId;
  }
  return undefined;
}

/* ────────────────────────────── orchestration ────────────────────────────── */

/**
 * Reconcile one integration's work graph against a pulled snapshot — the two-way mirror.
 *
 * @remarks
 * Runs the ordered phases (users → labels → projects → cycles → work items → parent/label
 * linkage → push), each applying the same LWW + echo-guard discipline. Team routing comes from
 * `config.teamMappings` when present (an unmapped external team is not synced); otherwise the
 * legacy `listIds` + single-`teamId`/`resolveImportTeam` interpretation applies. Absence from the
 * snapshot never deletes; only explicit tombstones archive/cancel.
 *
 * @param input.orgId - The active organization.
 * @param input.actorId - The sync-runner actor (recorded as `createdBy` on inserts).
 * @param input.row - The integration being synced (`id`/`config`/`writeBack`/`provider`).
 * @param input.snapshot - The pulled work graph.
 * @param input.connector - The work-graph connector (push + `listTeamStates`).
 * @param input.now - The reconcile clock.
 * @returns the per-entity-kind tallies for the pass.
 * @throws {ConflictError} When the compat path can't resolve a single landing team.
 */
export async function reconcileWorkGraph(input: {
  orgId: string;
  actorId: string;
  row: IntegrationRow;
  snapshot: WorkGraphSnapshot;
  connector: WorkGraphConnector;
  now: Date;
}): Promise<WorkGraphReconcileResult> {
  const { orgId, actorId, row, snapshot, connector, now } = input;
  const result: WorkGraphReconcileResult = {
    labels: emptyTally(),
    projects: emptyTally(),
    cycles: emptyTally(),
    tasks: emptyTally(),
  };

  // Phase 1 — users → identity map.
  const identityMap = await syncExternalActors(orgId, row.id, snapshot.users);

  // Team routing (explicit config interpretation; documented precedence, no hidden fallback).
  const resolveTeam = await buildTeamResolver(orgId, row);

  // Preload every Docket team any snapshot entity could land in, plus its workflow states.
  const statesByTeam = await loadTeamStates(orgId, snapshot, resolveTeam);

  // Preload the integration's existing mirrored rows (authoritative existence — no per-item reads).
  const [existingLabels, existingProjects, existingCycles, existingTasks] = await Promise.all([
    db.select().from(label).where(eq(label.organizationId, orgId)),
    db
      .select()
      .from(project)
      .where(and(eq(project.sourceIntegrationId, row.id), eq(project.source, 'linked'))),
    db
      .select()
      .from(cycle)
      .where(and(eq(cycle.sourceIntegrationId, row.id), eq(cycle.source, 'linked'))),
    db
      .select()
      .from(task)
      .where(and(eq(task.sourceIntegrationId, row.id), eq(task.source, 'linked'))),
  ]);

  const existingLabelsByExternal = new Map<string, LabelRow>();
  const existingLabelsByScopeName = new Map<string, LabelRow>();
  for (const l of existingLabels) {
    existingLabelsByScopeName.set(labelScopeKey(l.teamId, l.name), l);
    if (l.sourceIntegrationId === row.id && l.externalId) {
      existingLabelsByExternal.set(l.externalId, l);
    }
  }
  const existingProjectsByExternal = indexByExternal(existingProjects);
  const existingCyclesByExternal = indexByExternal(existingCycles);
  const existingTasksByExternal = indexByExternal(existingTasks);

  const ctx: GraphApplyContext = {
    orgId,
    actorId,
    integrationId: row.id,
    writeBack: row.writeBack,
    now,
    identityMap,
    resolveTeam,
    statesByTeam,
    existingLabelsByExternal,
    existingLabelsByScopeName,
    existingProjectsByExternal,
    existingCyclesByExternal,
    existingTasksByExternal,
    labelIdByExternal: new Map(),
    projectIdByExternal: new Map(),
    cycleIdByExternal: new Map(),
    taskIdByExternal: new Map(),
    result,
  };

  // Phase 2–4 — labels, then projects, then cycles (tasks depend on the latter two's maps).
  for (const l of snapshot.labels) await applyLabel(ctx, l);
  for (const p of snapshot.projects) await applyProject(ctx, p);
  for (const c of snapshot.cycles) await applyCycle(ctx, c);

  // Phase 5 — work items, pass A: legacy re-key healing, then per-item LWW.
  await healLegacyReKeys(ctx, snapshot.items, existingTasksByExternal);
  for (const item of snapshot.items) await applyWorkItem(ctx, item);

  // Phase 6 — pass B: parent linkage + task-label join diff.
  await linkParents(ctx, snapshot.items);
  await diffTaskLabels(ctx, snapshot.items);

  // Phase 7 — push dirty local edits back to the provider.
  if (row.writeBack) await pushDirtyTasks(ctx, connector);

  return result;
}

/** Index mirror rows by their (non-null) external id. */
function indexByExternal<T extends { externalId: string | null }>(
  rows: readonly T[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const r of rows) if (r.externalId) map.set(r.externalId, r);
  return map;
}

/**
 * Build the external-team → Docket-team resolver from config.
 *
 * @remarks
 * `teamMappings` (when non-empty) is authoritative: only its external teams resolve. Otherwise
 * the legacy interpretation — `listIds` selects which external teams sync (absent ⇒ all) and
 * `resolveImportTeam` (honoring `config.teamId`) is the single landing team for all of them.
 */
async function buildTeamResolver(
  orgId: string,
  row: IntegrationRow,
): Promise<(externalTeamId: string) => string | undefined> {
  const config = ConnectorConfig.safeParse(row.config).data ?? {};
  const mappings = config.teamMappings;
  if (mappings && mappings.length > 0) {
    const byExternal = new Map(mappings.map((m) => [m.externalTeamId, m.teamId] as const));
    return (externalTeamId) => byExternal.get(externalTeamId);
  }
  const singleTeam = await resolveImportTeam(orgId, row);
  const allowed = config.listIds && config.listIds.length > 0 ? new Set(config.listIds) : null;
  return (externalTeamId) =>
    allowed === null || allowed.has(externalTeamId) ? singleTeam : undefined;
}

/** Load the workflow states of every Docket team a snapshot entity could land in. */
async function loadTeamStates(
  orgId: string,
  snapshot: WorkGraphSnapshot,
  resolveTeam: (externalTeamId: string) => string | undefined,
): Promise<Map<string, readonly WorkflowState[]>> {
  const teamIds = new Set<string>();
  const add = (extTeamId: string) => {
    const teamId = resolveTeam(extTeamId);
    if (teamId !== undefined) teamIds.add(teamId);
  };
  for (const item of snapshot.items) add(item.externalTeamId);
  for (const c of snapshot.cycles) add(c.externalTeamId);
  for (const p of snapshot.projects) for (const t of p.externalTeamIds) add(t);
  const states = new Map<string, readonly WorkflowState[]>();
  if (teamIds.size === 0) return states;
  const rows = await db
    .select({ id: team.id, workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.organizationId, orgId), inArray(team.id, [...teamIds])));
  for (const t of rows) states.set(t.id, t.workflowStates);
  return states;
}

/**
 * Re-key legacy tasks keyed by human identifier to the item's stable UUID (pass-A healing).
 *
 * @remarks
 * Migration-era imports keyed a linked task on the human identifier (`ENG-123`) rather than the
 * provider UUID. When a snapshot item's UUID has no row but its identifier does, the identifier
 * row is re-keyed to the UUID (preserving all local state), so the item reconciles normally
 * afterward. Idempotent: on a later run the UUID row already exists and no re-key happens.
 *
 * The re-key explicitly re-sets the row's OWN `updatedAt` (the anchor invariant): a bare update
 * would let Drizzle's `$onUpdate` stamp wall-clock now, forging `updatedAt > externalUpdatedAt`
 * on a clean row — a phantom-dirty state the pull pass wouldn't heal (its in-memory row holds
 * the pre-bump timestamp, so a not-newer provider item no-ops) and the push phase would then
 * spuriously push forever.
 */
async function healLegacyReKeys(
  ctx: GraphApplyContext,
  items: readonly ExternalWorkItem[],
  byExternal: Map<string, TaskRow>,
): Promise<void> {
  for (const item of items) {
    if (byExternal.has(item.externalId)) continue;
    const legacy = byExternal.get(item.identifier);
    if (!legacy) continue;
    await db
      .update(task)
      .set({ externalId: item.externalId, updatedAt: legacy.updatedAt })
      .where(eq(task.id, legacy.id));
    byExternal.delete(item.identifier);
    byExternal.set(item.externalId, { ...legacy, externalId: item.externalId });
  }
}

/**
 * Reconcile child→parent linkage against the snapshot: set changed parents AND clear ones removed
 * at the provider (only writing rows that actually change).
 *
 * @remarks
 * The linkage write explicitly re-sets each row's OWN `updatedAt` (the anchor invariant): a
 * bare update would let Drizzle's `$onUpdate` stamp wall-clock now, forging
 * `updatedAt > externalUpdatedAt` on a just-inserted born-clean child — which the SAME run's
 * push phase would then read as dirty and spuriously push every freshly-imported sub-issue.
 *
 * Clearing: a snapshot item with NO `parentExternalId` whose local row still points at a parent
 * that is another linked task of THIS integration means the parent link was removed at the
 * provider (it was ours, set by a prior sync) — so we clear it, again preserving the anchor. A
 * NATIVE/user-set parent (parent not one of this integration's linked tasks) is never disturbed,
 * and a DIRTY row (local edit newer than the anchor) is left untouched so its newer local state
 * wins LWW and the push phase can drain it — never silently reverted here.
 */
async function linkParents(
  ctx: GraphApplyContext,
  items: readonly ExternalWorkItem[],
): Promise<void> {
  const wanted = new Map<string, string>(); // childTaskId → parentTaskId (desired link this run)
  const clearCandidates = new Set<string>(); // childTaskId whose snapshot item has NO parent
  for (const item of items) {
    const childId = ctx.taskIdByExternal.get(item.externalId);
    if (!childId) continue;
    if (item.parentExternalId) {
      const parentId = ctx.taskIdByExternal.get(item.parentExternalId);
      if (parentId) wanted.set(childId, parentId);
    } else {
      clearCandidates.add(childId);
    }
  }
  if (wanted.size === 0 && clearCandidates.size === 0) return;

  const affectedIds = new Set<string>([...wanted.keys(), ...clearCandidates]);
  const current = await db
    .select({
      id: task.id,
      parentTaskId: task.parentTaskId,
      updatedAt: task.updatedAt,
      externalUpdatedAt: task.externalUpdatedAt,
    })
    .from(task)
    .where(inArray(task.id, [...affectedIds]));

  // Only a parent that is one of THIS integration's linked tasks was set by sync and is ours to
  // clear — resolve that set once (batched) so a native/cross-integration parent is left alone.
  const parentIdsToCheck = new Set<string>();
  for (const row of current) {
    if (clearCandidates.has(row.id) && row.parentTaskId) parentIdsToCheck.add(row.parentTaskId);
  }
  const ownLinkedParents = new Set<string>();
  if (parentIdsToCheck.size > 0) {
    const parents = await db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          inArray(task.id, [...parentIdsToCheck]),
          eq(task.sourceIntegrationId, ctx.integrationId),
          eq(task.source, 'linked'),
        ),
      );
    for (const p of parents) ownLinkedParents.add(p.id);
  }

  for (const row of current) {
    const parentId = wanted.get(row.id);
    if (parentId !== undefined) {
      if (row.parentTaskId !== parentId) {
        await db
          .update(task)
          .set({ parentTaskId: parentId, updatedAt: row.updatedAt })
          .where(eq(task.id, row.id));
      }
      continue;
    }
    if (
      clearCandidates.has(row.id) &&
      row.parentTaskId !== null &&
      ownLinkedParents.has(row.parentTaskId) &&
      !isDirty(row.updatedAt, row.externalUpdatedAt)
    ) {
      await db
        .update(task)
        .set({ parentTaskId: null, updatedAt: row.updatedAt })
        .where(eq(task.id, row.id));
    }
  }
}

/**
 * Diff each linked task's label set against the snapshot, touching only this integration's labels.
 *
 * @remarks
 * The desired set is the item's mirrored labels resolved through the label-provenance map; stale
 * links are removed and missing ones inserted, but only among labels owned by THIS integration —
 * a native label a user added to a linked task is never disturbed. Idempotent: a matching set
 * produces no writes.
 */
async function diffTaskLabels(
  ctx: GraphApplyContext,
  items: readonly ExternalWorkItem[],
): Promise<void> {
  const mirroredLabelIds = new Set(ctx.labelIdByExternal.values());
  if (mirroredLabelIds.size === 0) return;

  const desiredByTask = new Map<string, Set<string>>();
  for (const item of items) {
    const taskId = ctx.taskIdByExternal.get(item.externalId);
    if (!taskId) continue;
    const desired = new Set<string>();
    for (const extId of item.labelExternalIds) {
      const labelId = ctx.labelIdByExternal.get(extId);
      if (labelId) desired.add(labelId);
    }
    desiredByTask.set(taskId, desired);
  }
  if (desiredByTask.size === 0) return;

  const current = await db
    .select({ taskId: taskLabel.taskId, labelId: taskLabel.labelId })
    .from(taskLabel)
    .where(inArray(taskLabel.taskId, [...desiredByTask.keys()]));
  const currentByTask = new Map<string, Set<string>>();
  for (const link of current) {
    if (!mirroredLabelIds.has(link.labelId)) continue; // only diff this integration's labels
    const set = currentByTask.get(link.taskId) ?? new Set<string>();
    set.add(link.labelId);
    currentByTask.set(link.taskId, set);
  }

  const toInsert: { taskId: string; labelId: string; organizationId: string }[] = [];
  const toDelete: { taskId: string; labelId: string }[] = [];
  for (const [taskId, desired] of desiredByTask) {
    const have = currentByTask.get(taskId) ?? new Set<string>();
    for (const labelId of desired) {
      if (!have.has(labelId)) toInsert.push({ taskId, labelId, organizationId: ctx.orgId });
    }
    for (const labelId of have) {
      if (!desired.has(labelId)) toDelete.push({ taskId, labelId });
    }
  }
  if (toInsert.length > 0) await db.insert(taskLabel).values(toInsert);
  for (const del of toDelete) {
    await db
      .delete(taskLabel)
      .where(and(eq(taskLabel.taskId, del.taskId), eq(taskLabel.labelId, del.labelId)));
  }
}

/**
 * Push every dirty linked task's local edits to the provider and restamp the echo anchors.
 *
 * @remarks
 * A task is dirty iff `updatedAt > externalUpdatedAt` — after the pull pass, that is exactly the
 * set where the local side won LWW (or that the snapshot didn't touch). Each is written field-
 * level via {@link WorkGraphConnector.pushWorkItem}; the response's `externalUpdatedAt` is stamped
 * as `lastPushedAt = externalUpdatedAt = updatedAt`, so the webhook echo of our own write is
 * suppressed. A locally canceled task pushes the team's canceled-type state id (never a delete);
 * an assignee with no reverse identity mapping OMITS the assignee field (never nulls it out).
 */
async function pushDirtyTasks(
  ctx: GraphApplyContext,
  connector: WorkGraphConnector,
): Promise<void> {
  const dirty = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.sourceIntegrationId, ctx.integrationId),
        eq(task.source, 'linked'),
        isNotNull(task.externalUpdatedAt),
        gt(task.updatedAt, task.externalUpdatedAt),
      ),
    );
  if (dirty.length === 0) return;

  const reverseActors = await externalActorReverseMap(ctx.integrationId);
  const labelExternalById = new Map<string, string>(); // docket label id → external id
  for (const [extId, docketId] of ctx.labelIdByExternal) labelExternalById.set(docketId, extId);
  // The dirty tasks may reference mirrored labels not seen in this snapshot's map; backfill from db.
  const dirtyIds = dirty.map((t) => t.id);
  const links = await db
    .select({ taskId: taskLabel.taskId, labelId: taskLabel.labelId, externalId: label.externalId })
    .from(taskLabel)
    .innerJoin(label, eq(taskLabel.labelId, label.id))
    .where(
      and(inArray(taskLabel.taskId, dirtyIds), eq(label.sourceIntegrationId, ctx.integrationId)),
    );
  const labelsByTask = new Map<string, string[]>();
  for (const link of links) {
    if (!link.externalId) continue;
    const list = labelsByTask.get(link.taskId) ?? [];
    list.push(link.externalId);
    labelsByTask.set(link.taskId, list);
  }

  // Cache each external team's states once per run (reverse state resolution).
  const externalStates = new Map<string, readonly ExternalWorkflowState[]>();
  const getExternalStates = async (
    externalTeamId: string,
  ): Promise<readonly ExternalWorkflowState[]> => {
    const cached = externalStates.get(externalTeamId);
    if (cached) return cached;
    const fetched = await connector.listTeamStates(externalTeamId);
    externalStates.set(externalTeamId, fetched);
    return fetched;
  };

  for (const t of dirty) {
    const externalTeamId = t.externalListId;
    if (!t.externalId || !externalTeamId) continue;
    const docketStates = ctx.statesByTeam.get(t.teamId) ?? (await teamStates(ctx.orgId, t.teamId));
    const wantType = stateTypeOfKey(docketStates, t.state);
    const extStates = await getExternalStates(externalTeamId);
    const stateExternalId = extStates.find((s) => s.type === wantType)?.externalId;

    const assigneeExternalId = t.assigneeId ? reverseActors.get(t.assigneeId) : undefined;
    const fields: WorkItemPushFields = {
      title: t.title,
      description: t.description,
      priority: t.priority,
      dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
      estimate: t.estimate,
      labelExternalIds: labelsByTask.get(t.id) ?? [],
      ...(stateExternalId ? { stateExternalId } : {}),
      ...(assigneeExternalId ? { assigneeExternalId } : {}),
    };
    const push = await connector.pushWorkItem({ kind: 'update', externalId: t.externalId, fields });
    const anchor = new Date(push.externalUpdatedAt);
    await db
      .update(task)
      .set({ lastPushedAt: anchor, externalUpdatedAt: anchor, updatedAt: anchor })
      .where(eq(task.id, t.id));
    ctx.result.tasks.pushed += 1;
  }
}

/** Load a single team's workflow states (fallback when it isn't in the preloaded map). */
async function teamStates(orgId: string, teamId: string): Promise<readonly WorkflowState[]> {
  const rows = await db
    .select({ workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  const states = rows[0]?.workflowStates;
  if (!states) throw new ConflictError('Team has no workflow states to reconcile against');
  return states;
}

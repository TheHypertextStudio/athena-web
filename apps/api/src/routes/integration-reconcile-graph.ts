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
import { createHash } from 'node:crypto';

import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import {
  cycle,
  db,
  label,
  organization,
  project,
  task,
  taskDependency,
  taskLabel,
} from '@docket/db';
import { ConnectorConfig, type WorkStatusCategory } from '@docket/types';
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
import { assertPlanningDateRange, planningDatePatch } from '../lib/planning-timeframe';
import {
  applySubtaskCompletionPolicyForParents,
  finishTaskStateTransition,
  type TaskStateMutation,
  writeTaskStateTransition,
} from '../lib/task-state';
import { serializableTx } from '../lib/serializable-tx';
import { loadStatusSets, type ResolvedStatus } from '../lib/work-status';

import { externalActorReverseMap, syncExternalActors } from './integration-identity';
import { resolveImportTeam } from './integration-import';
import { type IntegrationRow } from './integration-provider';
import { wouldCreateCycle, wouldCreateSubtaskCycle } from './task-helpers';

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
  /** The source provider workspace's zero-based fiscal start month for broad Project dates. */
  readonly sourceFiscalYearStartMonth: number;
  /** Whether local→provider pushes are enabled for this integration. */
  readonly writeBack: boolean;
  /** The reconcile clock (cycle-status derivation, tombstone stamps). */
  readonly now: Date;
  /** `externalUserId → actorId | null` for this snapshot's users (from {@link syncExternalActors}). */
  readonly identityMap: ReadonlyMap<string, string | null>;
  /** Resolve an external team id to its mapped Docket team id, or `undefined` when unmapped. */
  readonly resolveTeam: (externalTeamId: string) => string | undefined;
  /** Each mapped Docket team's Task statuses, keyed by Docket team id (for state resolution). */
  readonly statesByTeam: ReadonlyMap<string, readonly ResolvedStatus[]>;
  /** The workspace's Project statuses, in board order (Projects follow the workspace set). */
  readonly projectStatuses: readonly ResolvedStatus[];
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
 * canceled task simply pushes the team's canceled-category status. The push directions therefore
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
    // Both sides changed since the last sync. Docket is the source of truth on conflict, so the
    // local edit is kept and the push phase drains it outward — regardless of which timestamp is
    // newer. (`planTaskReconcile` makes the same call and additionally records the losing remote
    // values; here the pull side has no losing *field* values to record, because the local row is
    // simply left untouched for the push phase.) A remote TOMBSTONE is the one exception: an
    // item deleted at the provider cannot be resurrected by pushing a title at it, so a genuinely
    // newer removal still archives locally rather than pretending the push will land.
    if (!remoteNewer) return 'noop'; // local will push
    return remote.removed ? pullAction : 'noop';
  }
  return remoteNewer ? pullAction : 'noop';
}

/* ────────────────────────────── field mapping ────────────────────────────── */

/**
 * Map an external project lifecycle state onto the category a Docket project status behaves as.
 *
 * @remarks
 * A workspace names its own Project statuses, so the category is what crosses the boundary and
 * {@link applyProject} resolves it against the workspace's set. A `paused` project keeps the
 * reading it has always had here — committed to, not currently running — which is the
 * `unstarted` category the default `Planned` status carries.
 */
function mapProjectCategory(state: ExternalProject['state']): WorkStatusCategory {
  switch (state) {
    case 'backlog':
      return 'backlog';
    case 'planned':
    case 'paused':
      return 'unstarted';
    case 'started':
      return 'started';
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

/** The Docket category an external state type maps onto (triage folds into backlog). */
function toStatusCategory(stateType: ExternalStateType): WorkStatusCategory {
  return stateType === 'triage' ? 'backlog' : stateType;
}

/**
 * The status in a set that behaves as a category, else the set's first.
 *
 * @remarks
 * A workspace defines its own statuses and may name none of a given category, so a connector
 * mapping work in settles on the set's first status — the earliest point on the board — which is
 * a status the set genuinely contains. An empty set has no answer at all, and the callers turn
 * that `undefined` into a descriptive mapping error.
 */
function pickStatus(
  statuses: readonly ResolvedStatus[],
  category: WorkStatusCategory,
): ResolvedStatus | undefined {
  return statuses.find((status) => status.category === category) ?? statuses[0];
}

/**
 * Resolve the Docket status an external state type maps onto, within one team's Task set.
 *
 * @remarks
 * Returns the whole status because a row stores both halves of it: the `state` key and the
 * `status_id` the composite foreign key holds that key to.
 *
 * The empty case is unreachable in the batch path (the orchestrator only maps items on teams
 * whose statuses it preloaded), but the exported single-entity appliers can be driven with an
 * unpreloaded `statesByTeam` — so an EMPTY set throws a descriptive mapping error rather than
 * silently inventing a `'backlog'` key that no workspace defines.
 */
function resolveStatus(
  statuses: readonly ResolvedStatus[],
  stateType: ExternalStateType,
): ResolvedStatus {
  const status = pickStatus(statuses, toStatusCategory(stateType));
  if (status === undefined) {
    throw new ConflictError('Team has no statuses to map an external work item onto');
  }
  return status;
}

/** The category of a Docket status key (defaults to backlog for a key the set no longer has). */
function categoryOfKey(statuses: readonly ResolvedStatus[], key: string): WorkStatusCategory {
  return statuses.find((status) => status.key === key)?.category ?? 'backlog';
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
  /* v8 ignore next -- @preserve defensive: `resolveTeam` never returns `null` (only `string |
   * undefined`), and the guard above already excludes `undefined` when `externalTeamId` is set,
   * so `scopeTeamId` is always a string here — the `?? null` only guards the type, not a real
   * runtime path. */
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
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
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
 * is skipped. `removed: true` lands the project in the workspace's canceled-category Project
 * status (never a delete). Lead resolves via the identity map (unmatched ⇒ null lead, never a
 * fallback).
 *
 * @throws {ConflictError} When the workspace defines no Project statuses to map onto.
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
  const status = pickStatus(
    ctx.projectStatuses,
    ext.removed ? 'canceled' : mapProjectCategory(ext.state),
  );
  if (status === undefined) {
    throw new ConflictError('This workspace has no statuses to map an external project onto');
  }
  const start = planningDatePatch(
    { date: ext.startDate ?? null, resolution: ext.startDateResolution ?? null },
    ctx.sourceFiscalYearStartMonth,
    'start',
    'startDate',
    'startDateResolution',
  );
  const target = planningDatePatch(
    { date: ext.targetDate ?? null, resolution: ext.targetDateResolution ?? null },
    ctx.sourceFiscalYearStartMonth,
    'target',
    'targetDate',
    'targetDateResolution',
  );
  /* v8 ignore next -- @preserve both calls supply an explicit date or null */
  if (start === undefined || target === undefined) throw new Error('external timeframe missing');
  assertPlanningDateRange(start.date, target.date);
  const fields = {
    name: ext.name,
    description: ext.description ?? null,
    leadId,
    teamId,
    status: status.key,
    statusId: status.id,
    startDate: start.date,
    startDateResolution: start.resolution,
    startDateFiscalYearStartMonth: start.fiscalYearStartMonth,
    targetDate: target.date,
    targetDateResolution: target.resolution,
    targetDateFiscalYearStartMonth: target.fiscalYearStartMonth,
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
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
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
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
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
 * is skipped entirely. State resolves against that team's Task statuses by category; priority is
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
    await archiveLinkedItem(ctx.orgId, existing.id, item, ctx.statesByTeam.get(teamId) ?? []);
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
  statusId: string;
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
  const status = resolveStatus(ctx.statesByTeam.get(teamId) ?? [], item.stateType);
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
    state: status.key,
    statusId: status.id,
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
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('linked task insert returned no row');
  return row.id;
}

/** Publish task-state cascades only after the provider row write has committed. */
async function finishHierarchyCascades(cascades: readonly TaskStateMutation[]): Promise<void> {
  for (const cascade of cascades) {
    await finishTaskStateTransition({ actorId: null }, cascade);
  }
}

/** Apply a newer provider item's fields onto an existing linked task and restamp the anchors. */
async function applyItemFields(
  ctx: GraphApplyContext,
  taskId: string,
  item: ExternalWorkItem,
  teamId: string,
): Promise<void> {
  const { state, statusId, completedAt, canceledAt, ...patch } = itemColumns(ctx, item, teamId);
  const cascades = await db.transaction(async (tx) => {
    const before = await tx
      .select()
      .from(task)
      .where(and(eq(task.id, taskId), eq(task.organizationId, ctx.orgId)))
      .for('update')
      .limit(1);
    const current = before[0];
    if (!current) return [];
    await tx.update(task).set(patch).where(eq(task.id, taskId)).returning();
    const mutation = await writeTaskStateTransition(tx, {
      before: current,
      statusId,
      state,
      completedAt,
      canceledAt,
      updatedAt: patch.updatedAt,
    });
    if (!mutation) return [];
    return [
      mutation,
      ...(await applySubtaskCompletionPolicyForParents(tx, ctx.orgId, [
        current.parentTaskId,
        mutation.after.parentTaskId,
      ])),
    ];
  });
  const [mutation, ...hierarchyCascades] = cascades;
  if (mutation) await finishTaskStateTransition({ actorId: null }, mutation);
  await finishHierarchyCascades(hierarchyCascades);
}

/**
 * Archive a linked task whose provider item was tombstoned (canceled status + stamp).
 *
 * @remarks
 * Resolves the team's canceled-category status (falling back to the set's last status), throwing
 * a descriptive mapping error on an EMPTY set rather than stamping a silent `'canceled'` literal
 * no workspace defines. Unreachable in the batch path (statuses are preloaded), but the exported
 * appliers can be driven with an unpreloaded `statesByTeam`.
 */
async function archiveLinkedItem(
  orgId: string,
  taskId: string,
  item: ExternalWorkItem,
  statuses: readonly ResolvedStatus[],
): Promise<void> {
  const anchor = new Date(item.updatedAt);
  const canceled =
    statuses.find((status) => status.category === 'canceled') ?? statuses[statuses.length - 1];
  if (canceled === undefined) {
    throw new ConflictError('Team has no statuses to archive a tombstoned work item into');
  }
  const cascades = await db.transaction(async (tx) => {
    const before = await tx
      .select()
      .from(task)
      .where(and(eq(task.id, taskId), eq(task.organizationId, orgId)))
      .for('update')
      .limit(1);
    const current = before[0];
    if (!current) return [];
    const mutation = await writeTaskStateTransition(tx, {
      before: current,
      statusId: canceled.id,
      state: canceled.key,
      completedAt: null,
      canceledAt: anchor,
    });
    if (!mutation) return [];
    const hierarchyCascades = await applySubtaskCompletionPolicyForParents(tx, orgId, [
      current.parentTaskId,
      mutation.after.parentTaskId,
    ]);
    await tx
      .update(task)
      .set({
        archivedAt: anchor,
        externalUpdatedAt: anchor,
        updatedAt: anchor,
      })
      .where(eq(task.id, taskId))
      .returning();
    return [mutation, ...hierarchyCascades];
  });
  const [mutation, ...hierarchyCascades] = cascades;
  if (mutation) await finishTaskStateTransition({ actorId: null }, mutation);
  await finishHierarchyCascades(hierarchyCascades);
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

  // Preload the statuses every snapshot entity could land in: each mapped team's Task set, and
  // the workspace's Project set.
  const { statesByTeam, projectStatuses } = await loadSnapshotStatuses(
    orgId,
    snapshot,
    resolveTeam,
  );

  const [workspaceSettings] = await db
    .select({ fiscalYearStartMonth: organization.fiscalYearStartMonth })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  if (!workspaceSettings) throw new ConflictError('Workspace settings are unavailable');
  if (row.provider === 'linear' && snapshot.fiscalYearStartMonth === undefined) {
    throw new ConflictError('Linear work graph is missing its fiscal year start month');
  }
  const sourceFiscalYearStartMonth =
    snapshot.fiscalYearStartMonth ?? workspaceSettings.fiscalYearStartMonth;

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
    sourceFiscalYearStartMonth,
    writeBack: row.writeBack,
    now,
    identityMap,
    resolveTeam,
    statesByTeam,
    projectStatuses,
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
  await linkBlockingRelationships(ctx, snapshot.items);
  await diffTaskLabels(ctx, snapshot.items);

  // Phase 7 — push dirty local edits back to the provider.
  if (row.writeBack) {
    await pushNewNativeTasks(ctx, connector, row);
    await pushDirtyTasks(ctx, connector);
  }

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

/**
 * Load every status a snapshot entity could land in, in one query.
 *
 * @remarks
 * One {@link loadStatusSets} call covers both kinds of work this reconciler writes a status onto:
 * the Task set of each mapped team — that team's own statuses when it keeps them, the workspace's
 * otherwise — and the workspace's Project set. A snapshot whose teams all resolve to nothing has
 * no entity to land, so it skips the query entirely.
 */
async function loadSnapshotStatuses(
  orgId: string,
  snapshot: WorkGraphSnapshot,
  resolveTeam: (externalTeamId: string) => string | undefined,
): Promise<{
  statesByTeam: Map<string, readonly ResolvedStatus[]>;
  projectStatuses: readonly ResolvedStatus[];
}> {
  const teamIds = new Set<string>();
  const add = (extTeamId: string) => {
    const teamId = resolveTeam(extTeamId);
    if (teamId !== undefined) teamIds.add(teamId);
  };
  for (const item of snapshot.items) add(item.externalTeamId);
  for (const c of snapshot.cycles) add(c.externalTeamId);
  for (const p of snapshot.projects) for (const t of p.externalTeamIds) add(t);
  const statesByTeam = new Map<string, readonly ResolvedStatus[]>();
  if (teamIds.size === 0) return { statesByTeam, projectStatuses: [] };

  const sets = await loadStatusSets(orgId, {
    entityTypes: ['task', 'project'],
    teamIds: [...teamIds],
  });
  for (const teamId of teamIds) statesByTeam.set(teamId, sets.for('task', teamId));
  return { statesByTeam, projectStatuses: sets.for('project') };
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

  // Lock both ends of every requested edge in the same ID order. Two pulls that swap A and B
  // otherwise lock their children first and deadlock before SERIALIZABLE can reject the loser.
  const affectedIds = new Set<string>([...wanted.keys(), ...wanted.values(), ...clearCandidates]);
  const cascades = await serializableTx(async (tx) => {
    const current = await tx
      .select({
        id: task.id,
        parentTaskId: task.parentTaskId,
        updatedAt: task.updatedAt,
        externalUpdatedAt: task.externalUpdatedAt,
      })
      .from(task)
      .where(and(eq(task.organizationId, ctx.orgId), inArray(task.id, [...affectedIds])))
      .orderBy(task.id)
      .for('update');

    // Only a parent that is one of THIS integration's linked tasks was set by sync and is ours to
    // clear — resolve that set once (batched) so a native/cross-integration parent is left alone.
    const parentIdsToCheck = new Set<string>();
    for (const row of current) {
      if (clearCandidates.has(row.id) && row.parentTaskId) parentIdsToCheck.add(row.parentTaskId);
    }
    const ownLinkedParents = new Set<string>();
    if (parentIdsToCheck.size > 0) {
      const parents = await tx
        .select({ id: task.id })
        .from(task)
        .where(
          and(
            eq(task.organizationId, ctx.orgId),
            inArray(task.id, [...parentIdsToCheck]),
            eq(task.sourceIntegrationId, ctx.integrationId),
            eq(task.source, 'linked'),
          ),
        )
        .orderBy(task.id)
        .for('update');
      for (const p of parents) ownLinkedParents.add(p.id);
    }

    const parentTaskIds: (string | null)[] = [];
    for (const row of current) {
      const parentId = wanted.get(row.id);
      if (parentId !== undefined) {
        if (row.parentTaskId !== parentId) {
          if (await wouldCreateSubtaskCycle(tx, ctx.orgId, row.id, parentId)) continue;
          await tx
            .update(task)
            .set({ parentTaskId: parentId, updatedAt: row.updatedAt })
            .where(eq(task.id, row.id));
          parentTaskIds.push(row.parentTaskId, parentId);
        }
        continue;
      }
      if (
        clearCandidates.has(row.id) &&
        row.parentTaskId !== null &&
        ownLinkedParents.has(row.parentTaskId) &&
        !isDirty(row.updatedAt, row.externalUpdatedAt)
      ) {
        await tx
          .update(task)
          .set({ parentTaskId: null, updatedAt: row.updatedAt })
          .where(eq(task.id, row.id));
        parentTaskIds.push(row.parentTaskId, null);
      }
    }
    return applySubtaskCompletionPolicyForParents(tx, ctx.orgId, parentTaskIds);
  });
  for (const cascade of cascades) {
    await finishTaskStateTransition({ actorId: null }, cascade);
  }
}

/** Reconcile Linear `blocks` relations into Docket's directed task dependency edges. */
async function linkBlockingRelationships(
  ctx: GraphApplyContext,
  items: readonly ExternalWorkItem[],
): Promise<void> {
  const desiredByBlockingTask = new Map<string, Set<string>>();
  for (const item of items) {
    if (item.removed || item.blockingExternalIds === undefined) continue;
    const blockingTaskId = ctx.taskIdByExternal.get(item.externalId);
    if (!blockingTaskId) continue;
    const desired = new Set<string>();
    for (const blockedExternalId of item.blockingExternalIds) {
      const blockedTaskId = ctx.taskIdByExternal.get(blockedExternalId);
      if (blockedTaskId && blockedTaskId !== blockingTaskId) desired.add(blockedTaskId);
    }
    desiredByBlockingTask.set(blockingTaskId, desired);
  }
  if (desiredByBlockingTask.size === 0) return;

  const blockingTaskIds = [...desiredByBlockingTask.keys()];
  const affectedTaskIds = new Set(blockingTaskIds);
  for (const desired of desiredByBlockingTask.values()) {
    for (const blockedTaskId of desired) affectedTaskIds.add(blockedTaskId);
  }
  await serializableTx(async (tx) => {
    const lockedTasks = await tx
      .select({
        id: task.id,
        updatedAt: task.updatedAt,
        externalUpdatedAt: task.externalUpdatedAt,
      })
      .from(task)
      .where(and(eq(task.organizationId, ctx.orgId), inArray(task.id, [...affectedTaskIds])))
      .orderBy(task.id)
      .for('update');
    const cleanBlockingTasks = new Set(
      lockedTasks
        .filter(
          (row) =>
            desiredByBlockingTask.has(row.id) && !isDirty(row.updatedAt, row.externalUpdatedAt),
        )
        .map((row) => row.id),
    );
    if (cleanBlockingTasks.size === 0) return;

    const current = await tx
      .select({
        blockingTaskId: taskDependency.blockingTaskId,
        blockedTaskId: taskDependency.blockedTaskId,
        blockedSourceIntegrationId: task.sourceIntegrationId,
      })
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.blockedTaskId, task.id))
      .where(inArray(taskDependency.blockingTaskId, [...cleanBlockingTasks]));
    const currentOwn = new Set<string>();
    for (const edge of current) {
      if (edge.blockedSourceIntegrationId !== ctx.integrationId) continue;
      const key = `${edge.blockingTaskId}:${edge.blockedTaskId}`;
      currentOwn.add(key);
      if (!desiredByBlockingTask.get(edge.blockingTaskId)?.has(edge.blockedTaskId)) {
        await tx
          .delete(taskDependency)
          .where(
            and(
              eq(taskDependency.blockingTaskId, edge.blockingTaskId),
              eq(taskDependency.blockedTaskId, edge.blockedTaskId),
            ),
          );
      }
    }
    for (const blockingTaskId of cleanBlockingTasks) {
      for (const blockedTaskId of desiredByBlockingTask.get(blockingTaskId) ?? []) {
        if (currentOwn.has(`${blockingTaskId}:${blockedTaskId}`)) continue;
        if (await wouldCreateCycle(tx, ctx.orgId, blockingTaskId, blockedTaskId)) continue;
        await tx
          .insert(taskDependency)
          .values({ organizationId: ctx.orgId, blockingTaskId, blockedTaskId })
          .onConflictDoNothing();
      }
    }
  });
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
 * suppressed. A locally canceled task pushes the external canceled-type state id (never a delete);
 * an assignee with no reverse identity mapping OMITS the assignee field (never nulls it out).
 */
function stableExternalIssueId(integrationId: string, taskId: string): string {
  const bytes = createHash('sha256').update(`${integrationId}:${taskId}`).digest().subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Create opted-in native tasks in Linear before normal linked-task write-back. */
async function pushNewNativeTasks(
  ctx: GraphApplyContext,
  connector: WorkGraphConnector,
  row: IntegrationRow,
): Promise<void> {
  const config = ConnectorConfig.safeParse(row.config).data ?? {};
  if (!config.pushNativeTasks) return;
  const externalTeamByTeam = new Map<string, string | null>();
  if (config.teamMappings && config.teamMappings.length > 0) {
    for (const mapping of config.teamMappings) {
      const existing = externalTeamByTeam.get(mapping.teamId);
      externalTeamByTeam.set(
        mapping.teamId,
        existing === undefined || existing === mapping.externalTeamId
          ? mapping.externalTeamId
          : null,
      );
    }
  } else if (config.defaultListId) {
    const teamId = ctx.resolveTeam(config.defaultListId);
    if (teamId) externalTeamByTeam.set(teamId, config.defaultListId);
  }
  const teamIds = [...externalTeamByTeam]
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([teamId]) => teamId);
  if (teamIds.length === 0) return;

  const nativeTasks = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.organizationId, ctx.orgId),
        eq(task.source, 'native'),
        inArray(task.teamId, teamIds),
      ),
    )
    .orderBy(task.id);
  if (nativeTasks.length === 0) return;
  const taskIds = nativeTasks.map((nativeTask) => nativeTask.id);
  const reverseActors = await externalActorReverseMap(ctx.integrationId);
  const nativeLabels = await db
    .select({ taskId: taskLabel.taskId, externalId: label.externalId })
    .from(taskLabel)
    .innerJoin(label, eq(taskLabel.labelId, label.id))
    .where(
      and(inArray(taskLabel.taskId, taskIds), eq(label.sourceIntegrationId, ctx.integrationId)),
    );
  const labelsByTask = new Map<string, string[]>();
  for (const linkedLabel of nativeLabels) {
    if (!linkedLabel.externalId) continue;
    const values = labelsByTask.get(linkedLabel.taskId) ?? [];
    values.push(linkedLabel.externalId);
    labelsByTask.set(linkedLabel.taskId, values);
  }
  const externalStates = new Map<string, readonly ExternalWorkflowState[]>();
  const createdExternalByTask = new Map<string, string>();
  for (const nativeTask of nativeTasks) {
    const externalTeamId = externalTeamByTeam.get(nativeTask.teamId);
    if (!externalTeamId) continue;
    let states = externalStates.get(externalTeamId);
    if (!states) {
      states = await connector.listTeamStates(externalTeamId);
      externalStates.set(externalTeamId, states);
    }
    const statuses =
      ctx.statesByTeam.get(nativeTask.teamId) ?? (await teamStatuses(ctx.orgId, nativeTask.teamId));
    const stateExternalId = states.find(
      (state) => state.type === categoryOfKey(statuses, nativeTask.state),
    )?.externalId;
    const assigneeExternalId = nativeTask.assigneeId
      ? reverseActors.get(nativeTask.assigneeId)
      : undefined;
    const push = await connector.pushWorkItem({
      kind: 'create',
      externalTeamId,
      idempotencyKey: stableExternalIssueId(ctx.integrationId, nativeTask.id),
      fields: {
        title: nativeTask.title,
        description: nativeTask.description,
        priority: nativeTask.priority,
        dueDate: nativeTask.dueDate ? nativeTask.dueDate.toISOString().slice(0, 10) : null,
        estimate: nativeTask.estimate,
        labelExternalIds: labelsByTask.get(nativeTask.id) ?? [],
        ...(stateExternalId ? { stateExternalId } : {}),
        ...(assigneeExternalId ? { assigneeExternalId } : {}),
      },
    });
    const anchor = new Date(push.externalUpdatedAt);
    await db
      .update(task)
      .set({
        source: 'linked',
        sourceIntegrationId: ctx.integrationId,
        sourceSyncMode: 'mirror',
        externalId: push.externalId,
        externalUrl: push.externalUrl ?? null,
        lastPushedAt: anchor,
        externalUpdatedAt: anchor,
        updatedAt: anchor,
      })
      .where(and(eq(task.id, nativeTask.id), eq(task.source, 'native')));
    createdExternalByTask.set(nativeTask.id, push.externalId);
    ctx.result.tasks.pushed += 1;
  }

  if (createdExternalByTask.size === 0) return;
  const linkedTasks = await db
    .select({ id: task.id, externalId: task.externalId })
    .from(task)
    .where(
      and(
        eq(task.organizationId, ctx.orgId),
        eq(task.sourceIntegrationId, ctx.integrationId),
        eq(task.source, 'linked'),
      ),
    );
  const externalByTask = new Map(
    linkedTasks.flatMap((linkedTask) =>
      linkedTask.externalId ? ([[linkedTask.id, linkedTask.externalId]] as const) : [],
    ),
  );
  const dependencyRows = await db
    .select({
      blockingTaskId: taskDependency.blockingTaskId,
      blockedTaskId: taskDependency.blockedTaskId,
    })
    .from(taskDependency)
    .where(inArray(taskDependency.blockingTaskId, [...createdExternalByTask.keys()]));
  const dependenciesByTask = new Map<string, string[]>();
  const unresolvedDependencies = new Set<string>();
  for (const dependency of dependencyRows) {
    const blockedExternalId = externalByTask.get(dependency.blockedTaskId);
    if (!blockedExternalId) {
      unresolvedDependencies.add(dependency.blockingTaskId);
      continue;
    }
    const values = dependenciesByTask.get(dependency.blockingTaskId) ?? [];
    values.push(blockedExternalId);
    dependenciesByTask.set(dependency.blockingTaskId, values);
  }
  for (const nativeTask of nativeTasks) {
    const externalId = createdExternalByTask.get(nativeTask.id);
    if (!externalId) continue;
    const parentExternalId = nativeTask.parentTaskId
      ? externalByTask.get(nativeTask.parentTaskId)
      : undefined;
    const hasDependencies = dependencyRows.some(
      (dependency) => dependency.blockingTaskId === nativeTask.id,
    );
    const fields: WorkItemPushFields = {
      ...(parentExternalId ? { parentExternalId } : {}),
      ...(hasDependencies && !unresolvedDependencies.has(nativeTask.id)
        ? { blockingExternalIds: dependenciesByTask.get(nativeTask.id) ?? [] }
        : {}),
    };
    if (Object.keys(fields).length === 0) continue;
    const push = await connector.pushWorkItem({ kind: 'update', externalId, fields });
    const anchor = new Date(push.externalUpdatedAt);
    await db
      .update(task)
      .set({ lastPushedAt: anchor, externalUpdatedAt: anchor, updatedAt: anchor })
      .where(eq(task.id, nativeTask.id));
  }
}

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
  const parentIds = dirty.flatMap((t) => (t.parentTaskId ? [t.parentTaskId] : []));
  const parentRows =
    parentIds.length === 0
      ? []
      : await db
          .select({
            id: task.id,
            externalId: task.externalId,
            sourceIntegrationId: task.sourceIntegrationId,
          })
          .from(task)
          .where(inArray(task.id, parentIds));
  const parentExternalById = new Map(
    parentRows.flatMap((parent) =>
      parent.externalId && parent.sourceIntegrationId === ctx.integrationId
        ? ([[parent.id, parent.externalId]] as const)
        : [],
    ),
  );
  const dependencyRows = await db
    .select({
      blockingTaskId: taskDependency.blockingTaskId,
      blockedExternalId: task.externalId,
      blockedSourceIntegrationId: task.sourceIntegrationId,
    })
    .from(taskDependency)
    .leftJoin(task, eq(taskDependency.blockedTaskId, task.id))
    .where(inArray(taskDependency.blockingTaskId, dirtyIds));
  const blockingExternalByTask = new Map<string, string[]>();
  const unresolvedBlockingTasks = new Set<string>();
  for (const dependency of dependencyRows) {
    if (
      !dependency.blockedExternalId ||
      dependency.blockedSourceIntegrationId !== ctx.integrationId
    ) {
      unresolvedBlockingTasks.add(dependency.blockingTaskId);
      continue;
    }
    const list = blockingExternalByTask.get(dependency.blockingTaskId) ?? [];
    list.push(dependency.blockedExternalId);
    blockingExternalByTask.set(dependency.blockingTaskId, list);
  }
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
    const docketStatuses =
      ctx.statesByTeam.get(t.teamId) ?? (await teamStatuses(ctx.orgId, t.teamId));
    const wantCategory = categoryOfKey(docketStatuses, t.state);
    const extStates = await getExternalStates(externalTeamId);
    const stateExternalId = extStates.find((s) => s.type === wantCategory)?.externalId;

    const assigneeExternalId = t.assigneeId ? reverseActors.get(t.assigneeId) : undefined;
    const parentExternalId = t.parentTaskId ? parentExternalById.get(t.parentTaskId) : null;
    const fields: WorkItemPushFields = {
      title: t.title,
      description: t.description,
      priority: t.priority,
      dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
      estimate: t.estimate,
      labelExternalIds: labelsByTask.get(t.id) ?? [],
      ...(stateExternalId ? { stateExternalId } : {}),
      ...(assigneeExternalId ? { assigneeExternalId } : {}),
      ...(parentExternalId !== undefined ? { parentExternalId } : {}),
      ...(!unresolvedBlockingTasks.has(t.id)
        ? { blockingExternalIds: blockingExternalByTask.get(t.id) ?? [] }
        : {}),
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

/** Load a single team's Task statuses (fallback when it isn't in the preloaded map). */
async function teamStatuses(orgId: string, teamId: string): Promise<readonly ResolvedStatus[]> {
  const sets = await loadStatusSets(orgId, { entityTypes: ['task'], teamIds: [teamId] });
  const statuses = sets.for('task', teamId);
  if (statuses.length === 0) throw new ConflictError('Team has no statuses to reconcile against');
  return statuses;
}

/**
 * `@docket/api` — confirming plan draft nodes into real work.
 *
 * @remarks
 * Confirming is the one moment a plan touches the workspace. The selected refs are closed over
 * their unconfirmed ancestors, mapped onto the organize tool's item shape, and placed through the
 * same reconciling create-or-match walk in one serializable transaction. A task filed under
 * another task is created as its subtask, after the parent and in the parent's project, whether
 * that parent lands in this commit or was confirmed by an earlier one. Inside that transaction
 * the document is rewritten with the real ids, the many-to-many initiative links and the
 * dependency edges whose ends both exist are written, and the whole thing is recorded as a change
 * set the `undo` tool understands. A failure anywhere leaves nothing behind.
 *
 * Both doors — the canvas's own commit route and Athena's `plan_commit` tool — call
 * {@link commitPlanNodes} with an actor they have already authorized.
 */
import {
  db,
  initiativeProject,
  planDraft,
  projectDependency,
  task,
  taskDependency,
  type ChangeOrigin,
} from '@docket/db';
import { canActor } from '@docket/authz';
import type {
  PlanCommitCounts,
  PlanDocument,
  PlanNode,
  PlanPlaced,
} from '@docket/work/plan-draft-contract';
import { planCommitCounts, planCounts, planNodeClosure } from '@docket/work/plan-draft';
import { and, eq, inArray } from 'drizzle-orm';

import { CapabilityError, NotFoundError, ValidationError } from '../../error';
import { recordChangeSetInTx, type RecordedChange } from '../../mcp/change-set';
import {
  assertPriorities,
  inParentOrder,
  placeItem,
  resolveItem,
  type OrganizeItem,
  type Placed,
  type Placement,
  type Tx,
} from '../organize/place';
import { resolveLandingTarget } from '../task-landing';
import { serializableTx } from '../serializable-tx';
import { applySubtaskCompletionPolicyForParents, finishTaskStateTransition } from '../task-state';
import { resolveStateTransition } from '../../mcp/tools-shared';
import { enqueueSearchUpsert } from '../../search/write-through';
import { loadOwnedPlan, ownerActorInOrg, type PlanDraftRow } from './store';

/** What a commit produced. */
export interface CommitPlanResult {
  /** The plan after its confirmed nodes were written back. */
  readonly row: PlanDraftRow;
  /** Every node the commit touched, parents first. */
  readonly placed: PlanPlaced[];
  /** What was created, per kind, for the confirmation line the client renders. */
  readonly createdCounts: PlanCommitCounts;
  /** The change set `undo` accepts, or null when nothing was created. */
  readonly changeSetId: string | null;
}

/** What {@link commitPlanNodes} needs from its caller. */
export interface CommitPlanInput {
  readonly row: PlanDraftRow;
  readonly refs: readonly string[];
  /** The owner's actor in the plan's workspace, already authorized to contribute. */
  readonly actorId: string;
  readonly origin: ChangeOrigin;
}

/** The parent a node lands under when that parent is already real. */
function existingParentRefs(
  node: PlanNode,
  byRef: ReadonlyMap<string, PlanNode>,
  closure: ReadonlySet<string>,
): Pick<OrganizeItem, 'parent' | 'project' | 'program' | 'initiative'> {
  if (node.parentRef === null) return {};
  if (closure.has(node.parentRef)) return { parent: node.parentRef };
  const parent = byRef.get(node.parentRef);
  const objectId = parent?.objectId ?? null;
  if (!parent || objectId === null) return {};
  switch (parent.kind) {
    case 'project':
      return { project: objectId };
    case 'program':
      return { program: objectId };
    case 'initiative':
      return { initiative: objectId };
    case 'task':
      // A subtask whose feature task is already real carries no organize descriptor — there is no
      // "parent task" field on an item — so it is resolved separately by
      // {@link loadConfirmedParentTasks} and applied straight onto the placement.
      return {};
  }
}

/** Where a subtask's feature task already lives, once that task is a real record. */
interface ConfirmedParentTask {
  /** The real task the subtask hangs from. */
  readonly taskId: string;
  /** The project that task sits in, which the subtask inherits. */
  readonly projectId: string | null;
}

/** The real task id each subtask in the closure hangs from, for parents outside this commit. */
function alreadyRealParents(
  closureRefs: readonly string[],
  byRef: ReadonlyMap<string, PlanNode>,
  closure: ReadonlySet<string>,
): Map<string, string> {
  const wanted = new Map<string, string>();
  for (const ref of closureRefs) {
    const node = byRef.get(ref);
    if (node?.kind !== 'task' || node.parentRef === null || closure.has(node.parentRef)) continue;
    const parent = byRef.get(node.parentRef);
    if (parent?.kind !== 'task' || parent.objectId === null) continue;
    wanted.set(ref, parent.objectId);
  }
  return wanted;
}

/**
 * The already-real tasks that draft subtasks in this closure hang from.
 *
 * @remarks
 * A person often confirms a feature task in one pass and its engineering subtasks in the next, so
 * the parent is not in this commit's closure at all. Read before the transaction opens, like every
 * other lookup here, so a reference that has gone missing fails before anything is written.
 *
 * @param orgId - The workspace the plan writes into.
 * @param closureRefs - The nodes this commit will create.
 * @param byRef - Every node of the document, by ref.
 * @param closure - The same refs as a set, for asking whether a parent lands in this commit.
 * @returns the parent task per child node ref, for children whose parent is already real.
 */
async function loadConfirmedParentTasks(
  orgId: string,
  closureRefs: readonly string[],
  byRef: ReadonlyMap<string, PlanNode>,
  closure: ReadonlySet<string>,
): Promise<Map<string, ConfirmedParentTask>> {
  const wanted = alreadyRealParents(closureRefs, byRef, closure);
  if (wanted.size === 0) return new Map();
  const rows = await db
    .select({ id: task.id, projectId: task.projectId })
    .from(task)
    .where(and(eq(task.organizationId, orgId), inArray(task.id, [...new Set(wanted.values())])));
  const projectByTaskId = new Map(rows.map((row) => [row.id, row.projectId]));
  const resolved = new Map<string, ConfirmedParentTask>();
  for (const [ref, taskId] of wanted) {
    if (!projectByTaskId.has(taskId)) continue;
    resolved.set(ref, { taskId, projectId: projectByTaskId.get(taskId) ?? null });
  }
  return resolved;
}

/** Everything the link and finalize steps share inside the commit transaction. */
interface CommitContext {
  readonly tx: Tx;
  readonly orgId: string;
  readonly document: PlanDocument;
  readonly byRef: ReadonlyMap<string, PlanNode>;
  readonly placedByRef: ReadonlyMap<string, Placed>;
  readonly changes: RecordedChange[];
}

/** Project a plan node onto the organize item shape the placement walk understands. */
function toOrganizeItem(
  node: PlanNode,
  byRef: ReadonlyMap<string, PlanNode>,
  closure: ReadonlySet<string>,
): OrganizeItem {
  const { fields } = node;
  return {
    ref: node.ref,
    kind: node.kind,
    title: fields.title,
    ...(fields.description !== undefined ? { description: fields.description } : {}),
    ...existingParentRefs(node, byRef, closure),
    ...(fields.assigneeId ? { assignee: fields.assigneeId } : {}),
    ...(fields.ownerId ? { owner: fields.ownerId } : {}),
    ...(fields.leadId ? { lead: fields.leadId } : {}),
    ...(fields.teamId ? { team: fields.teamId } : {}),
    ...(fields.priority !== undefined ? { priority: fields.priority } : {}),
    ...(node.kind === 'task' && fields.status !== undefined ? { state: fields.status } : {}),
    ...(fields.dueDate ? { dueDate: fields.dueDate } : {}),
    ...(fields.targetDate ? { targetDate: fields.targetDate } : {}),
  };
}

/** The real id a ref resolves to after this commit, from the document or the placements. */
function realId(
  ref: string,
  byRef: ReadonlyMap<string, PlanNode>,
  placedByRef: ReadonlyMap<string, Placed>,
): string | null {
  return placedByRef.get(ref)?.id ?? byRef.get(ref)?.objectId ?? null;
}

/** Write the many-to-many initiative links every placed project declares. */
async function linkInitiatives(context: CommitContext): Promise<void> {
  const { tx, orgId, document, byRef, placedByRef, changes } = context;
  for (const node of document.nodes) {
    if (node.kind !== 'project' || !placedByRef.has(node.ref)) continue;
    const projectId = placedByRef.get(node.ref)?.id ?? '';
    const initiativeIds = [
      ...node.initiativeIds,
      ...node.initiativeRefs
        .map((ref) => realId(ref, byRef, placedByRef))
        .filter((id): id is string => id !== null),
    ];
    for (const initiativeId of new Set(initiativeIds)) {
      const inserted = await tx
        .insert(initiativeProject)
        .values({ organizationId: orgId, initiativeId, projectId })
        .onConflictDoNothing()
        .returning({ projectId: initiativeProject.projectId });
      if (inserted.length > 0) {
        changes.push({
          kind: 'project_contributes_to',
          from: projectId,
          to: initiativeId,
          linked: true,
        });
      }
    }
  }
}

/** Write every dependency edge whose two ends are real after this commit. */
async function linkDependencies(context: CommitContext): Promise<void> {
  const { tx, orgId, document, byRef, placedByRef, changes } = context;
  for (const edge of document.edges) {
    if (!placedByRef.has(edge.fromRef) && !placedByRef.has(edge.toRef)) continue;
    const from = realId(edge.fromRef, byRef, placedByRef);
    const to = realId(edge.toRef, byRef, placedByRef);
    const kind = byRef.get(edge.fromRef)?.kind;
    if (from === null || to === null || from === to) continue;
    if (kind === 'project') {
      const inserted = await tx
        .insert(projectDependency)
        .values({ organizationId: orgId, blockingProjectId: from, blockedProjectId: to })
        .onConflictDoNothing()
        .returning({ id: projectDependency.blockedProjectId });
      if (inserted.length > 0) changes.push({ kind: 'project_blocks', from, to, linked: true });
    } else if (kind === 'task') {
      const inserted = await tx
        .insert(taskDependency)
        .values({ organizationId: orgId, blockingTaskId: from, blockedTaskId: to })
        .onConflictDoNothing()
        .returning({ id: taskDependency.blockedTaskId });
      if (inserted.length > 0) changes.push({ kind: 'blocks', from, to, linked: true });
    }
  }
}

/** The document with every placed node marked confirmed and carrying its real id. */
function confirmDocument(
  document: PlanDocument,
  placedByRef: ReadonlyMap<string, Placed>,
): PlanDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const placed = placedByRef.get(node.ref);
      return placed ? { ...node, status: 'confirmed', objectId: placed.id } : node;
    }),
  };
}

/** What the placement walk builds up as it goes, and what the steps after it read. */
interface PlacementLedger {
  /** Every node placed, in the order it was placed. */
  readonly placed: Placed[];
  /** The same placements by plan ref. */
  readonly placedByRef: Map<string, Placed>;
  /** The project each placed task landed in, by plan ref. */
  readonly projectByRef: Map<string, string | null>;
  /** The creates to record on the change set. */
  readonly changes: RecordedChange[];
  /** The parent of every task this commit actually created, for the completion policy. */
  readonly parentTaskIds: (string | null)[];
}

/** Where a commit lands work by default, when the item names nothing narrower. */
interface CommitLanding {
  readonly orgId: string;
  readonly actorId: string;
  readonly landingTeamId: string;
}

/** Place every prepared item in order, recording what each became on the ledger. */
async function placePrepared(
  tx: Tx,
  landing: CommitLanding,
  prepared: readonly PreparedItem[],
  confirmedParents: ReadonlyMap<string, ConfirmedParentTask>,
  ledger: PlacementLedger,
): Promise<void> {
  for (const entry of prepared) {
    const at = placementFor(entry.item, entry.refs, { ...ledger, confirmedParents });
    const result = await placeItem(tx, {
      orgId: landing.orgId,
      actorId: landing.actorId,
      item: entry.item,
      at,
      teamId: entry.refs.teamId ?? landing.landingTeamId,
      state: entry.state,
      assigneeId: entry.refs.assigneeId,
      ownerId: entry.refs.ownerId,
      leadId: entry.refs.leadId,
    });
    ledger.placed.push(result.placed);
    ledger.placedByRef.set(entry.item.ref, result.placed);
    if (result.placed.kind === 'task') ledger.projectByRef.set(entry.item.ref, at.projectId);
    if (result.change) ledger.changes.push(result.change);
    if (result.placed.kind === 'task' && result.placed.created) {
      ledger.parentTaskIds.push(at.parentTaskId);
    }
  }
}

/**
 * Create the named draft nodes, plus their unconfirmed ancestors, as real objects.
 *
 * @throws {ValidationError} When no named ref is a draft node.
 * @throws {NotFoundError} When the workspace has no team to land work in.
 */
export async function commitPlanNodes(input: CommitPlanInput): Promise<CommitPlanResult> {
  const { row, actorId } = input;
  const orgId = row.organizationId;
  const closureRefs = planNodeClosure(row.document, input.refs);
  if (closureRefs.length === 0) {
    throw new ValidationError([{ message: 'Nothing here is still a draft.', path: ['refs'] }]);
  }
  const closure = new Set(closureRefs);
  const byRef = new Map(row.document.nodes.map((node) => [node.ref, node]));
  const items = closureRefs.map((ref) => {
    const node = byRef.get(ref);
    /* v8 ignore next -- @preserve defensive: closure refs come from the document */
    if (!node) throw new Error('closure named an unknown ref');
    return toOrganizeItem(node, byRef, closure);
  });

  const ordered = inParentOrder(items);
  assertPriorities(ordered);
  const landing = await resolveLandingTarget(orgId, actorId);
  if (!landing) throw new NotFoundError('No team to plan into');

  const prepared = await prepareItems(orgId, ordered, landing);
  const confirmedParents = await loadConfirmedParentTasks(orgId, closureRefs, byRef, closure);

  const ledger: PlacementLedger = {
    placed: [],
    placedByRef: new Map(),
    projectByRef: new Map(),
    changes: [],
    parentTaskIds: [],
  };
  const { placed, placedByRef, changes } = ledger;
  let outcome: { readonly row: PlanDraftRow; readonly changeSetId: string | null } | undefined;

  const cascades = await serializableTx(async (tx) => {
    await placePrepared(
      tx,
      { orgId, actorId, landingTeamId: landing.teamId },
      prepared,
      confirmedParents,
      ledger,
    );
    const context: CommitContext = {
      tx,
      orgId,
      document: row.document,
      byRef,
      placedByRef,
      changes,
    };
    await linkInitiatives(context);
    await linkDependencies(context);
    outcome = await finalizeCommit(
      context,
      { row, actorId, origin: planOrigin(input.origin, row), firstTitle: ordered[0]?.title },
      placed,
    );
    return applySubtaskCompletionPolicyForParents(tx, orgId, ledger.parentTaskIds);
  });

  for (const entry of placed) {
    if (entry.created) await enqueueSearchUpsert(orgId, entry.kind, entry.id);
  }
  for (const cascade of cascades) await finishTaskStateTransition({ actorId: null }, cascade);

  /* v8 ignore next -- @preserve defensive: the transaction always sets the outcome */
  if (!outcome) throw new Error('plan commit produced no outcome');
  return {
    row: outcome.row,
    placed,
    createdCounts: planCommitCounts(row.document, placed),
    changeSetId: outcome.changeSetId,
  };
}

/** One item resolved and ready to place: its descriptors and its workflow state. */
interface PreparedItem {
  readonly item: OrganizeItem;
  readonly refs: Awaited<ReturnType<typeof resolveItem>>;
  readonly state: Awaited<ReturnType<typeof resolveStateTransition>>;
}

/**
 * Resolve every item's descriptors and workflow state before the transaction opens, exactly as
 * `organize` does: a bad reference fails before a single row is written, and no read runs on a
 * connection the transaction already holds.
 */
async function prepareItems(
  orgId: string,
  ordered: readonly OrganizeItem[],
  landing: NonNullable<Awaited<ReturnType<typeof resolveLandingTarget>>>,
): Promise<PreparedItem[]> {
  return Promise.all(
    ordered.map(async (item, index) => {
      const refs = await resolveItem(orgId, item);
      const state =
        item.state === undefined
          ? {
              statusId: landing.statusId,
              state: landing.state,
              completedAt: null,
              canceledAt: null,
            }
          : await resolveStateTransition(
              orgId,
              refs.teamId ?? landing.teamId,
              item.state,
              `refs.${index}.status`,
            );
      return { item, refs, state };
    }),
  );
}

/** What {@link placementFor} reads to resolve one item's parents. */
interface PlacementContext {
  /** Nodes already placed in this commit, by plan ref. */
  readonly placedByRef: ReadonlyMap<string, Placed>;
  /** The project each placed task landed in, by plan ref, so its subtasks inherit it. */
  readonly projectByRef: ReadonlyMap<string, string | null>;
  /** Feature tasks confirmed by an earlier commit, keyed by the subtask's plan ref. */
  readonly confirmedParents: ReadonlyMap<string, ConfirmedParentTask>;
}

/** The real task a subtask hangs from: one placed in this commit, or one confirmed earlier. */
function subtaskParent(
  item: OrganizeItem,
  context: PlacementContext,
): ConfirmedParentTask | undefined {
  const confirmed = context.confirmedParents.get(item.ref);
  if (confirmed) return confirmed;
  const local = item.parent === undefined ? undefined : context.placedByRef.get(item.parent);
  if (local?.kind !== 'task') return undefined;
  return { taskId: local.id, projectId: context.projectByRef.get(local.ref) ?? null };
}

/**
 * Where one item lands: a parent placed in this commit wins over a resolved descriptor.
 *
 * @remarks
 * A subtask takes its parent's project rather than none at all, so the engineering work under a
 * feature task shows up in the same project as the feature — the real subtask route does the same
 * inheritance, and a plan should not be the one path that drops it.
 */
function placementFor(
  item: OrganizeItem,
  refs: Awaited<ReturnType<typeof resolveItem>>,
  context: PlacementContext,
): Placement {
  const local = item.parent === undefined ? undefined : context.placedByRef.get(item.parent);
  const localId = (kind: Placed['kind']): string | undefined =>
    local?.kind === kind ? local.id : undefined;
  const parentTask = subtaskParent(item, context);
  return {
    projectId: localId('project') ?? parentTask?.projectId ?? refs.projectId,
    programId: localId('program') ?? refs.programId,
    initiativeId: localId('initiative') ?? refs.initiativeId,
    parentTaskId: parentTask?.taskId ?? null,
  };
}

/**
 * The caller's origin with the plan and its owner stamped on.
 *
 * @remarks
 * Recorded for both doors, not just Athena's. A commit from the canvas carries no agent session,
 * and the undo route answers "is this yours?" from the origin alone, so without the plan on it the
 * person who pressed Confirm would have nothing to undo.
 */
function planOrigin(origin: ChangeOrigin, row: PlanDraftRow): ChangeOrigin {
  return { ...origin, planId: row.id, planOwnerUserId: row.ownerUserId };
}

/** Who is committing what, for the change set header. */
interface CommitMeta {
  readonly row: PlanDraftRow;
  readonly actorId: string;
  readonly origin: ChangeOrigin;
  /** The first placed item's title, for a one-item summary. */
  readonly firstTitle: string | undefined;
}

/** Write the confirmed document back and record the change set, inside the transaction. */
async function finalizeCommit(
  context: CommitContext,
  meta: CommitMeta,
  placed: readonly Placed[],
): Promise<{ readonly row: PlanDraftRow; readonly changeSetId: string | null }> {
  const { row, actorId, origin, firstTitle } = meta;
  const document = confirmDocument(row.document, context.placedByRef);
  const status = planCounts(document).draft === 0 ? 'committed' : 'active';
  const written = await context.tx
    .update(planDraft)
    .set({ document, status, revision: row.revision + 1 })
    .where(eq(planDraft.id, row.id))
    .returning();
  const updated = written[0];
  /* v8 ignore next -- @preserve defensive: update always returns a row */
  if (!updated) throw new Error('plan update returned no row');
  const created = placed.filter((entry) => entry.created).length;
  const changeSetId = await recordChangeSetInTx(context.tx, {
    orgId: context.orgId,
    actorId,
    origin,
    summary:
      created === 1 && firstTitle !== undefined
        ? `Created "${firstTitle}"`
        : `Created ${created} items`,
    changes: context.changes,
  });
  return { row: updated, changeSetId };
}

/**
 * Confirm nodes on behalf of the plan's owner, authorizing them in the plan's workspace first.
 *
 * @throws {NotFoundError} When the plan is missing, archived, foreign, or the owner is no longer a
 *   member of its workspace.
 * @throws {CapabilityError} When the owner may view the workspace but not contribute to it.
 */
export async function commitOwnedPlan(
  ownerUserId: string,
  id: string,
  refs: readonly string[],
  origin: ChangeOrigin = { tool: 'plan_commit' },
): Promise<CommitPlanResult> {
  const row = await loadOwnedPlan(ownerUserId, id);
  if (row.status === 'archived') throw new NotFoundError('Plan not found');
  const actorId = await ownerActorInOrg(ownerUserId, row.organizationId);
  if (actorId === null) throw new NotFoundError('Workspace not found');
  const decision = await canActor(
    actorId,
    'contribute',
    { kind: 'organization', id: row.organizationId, orgId: row.organizationId },
    db,
  );
  if (!decision.allow) {
    if (decision.effectiveCapability === null) throw new NotFoundError('Workspace not found');
    throw new CapabilityError();
  }
  return commitPlanNodes({ row, refs, actorId, origin });
}

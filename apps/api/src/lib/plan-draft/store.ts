/**
 * `@docket/api` — reading and editing personal plan drafts.
 *
 * @remarks
 * Every plan read or edit, whether from the `/v1/me/plans` router or from Athena's plan tools,
 * goes through here. A plan belongs to one user; nothing in this module ever returns another
 * user's row, and a missing or foreign id is a `NotFoundError` either way.
 *
 * Edits are optimistic: a patch names the revision it was written against and is refused with
 * `412 precondition_failed` when the row has moved on, which is what lets the canvas and Athena
 * edit the same document without one silently overwriting the other. The document itself is only
 * ever changed by the shared reducer in `@docket/work/plan-draft`.
 */
import {
  actor,
  db,
  initiative,
  planDraft,
  program,
  project,
  task,
  template,
  workStatus,
} from '@docket/db';
import type {
  PlanDocument,
  PlanDraftCreate,
  PlanDraftOut,
  PlanDraftPatch,
  PlanNodeKind,
  PlanObjectSnapshot,
  PlanTemplateOption,
} from '@docket/work/plan-draft-contract';
import {
  EMPTY_PLAN_DOCUMENT,
  PlanOpError,
  applyPlanOps,
  planCounts,
  type PlanOpEnvironment,
} from '@docket/work/plan-draft';
import type { TemplateDraft } from '@docket/work/template-contract';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { NotFoundError, PreconditionFailedError, ValidationError } from '../../error';
import { seedDefaultTemplates } from '../templates/defaults';
import { visibleTemplateWhere } from '../templates/visibility';

/** A stored plan. */
export type PlanDraftRow = typeof planDraft.$inferSelect;

/** The ref the root initiative node carries when a plan is rooted on an existing initiative. */
export const ROOT_REF = 'root';

/** The canvas route for a plan. */
export function planHref(row: Pick<PlanDraftRow, 'id' | 'organizationId'>): string {
  return `/orgs/${row.organizationId}/plans/${row.id}`;
}

/**
 * The owner's human actor in a workspace, or null when they are not a member.
 *
 * @remarks
 * Plans are personal, so a workspace is only ever named on one, never used to authorize a read;
 * this exists so creation can refuse a workspace the person does not belong to and so template
 * visibility can be evaluated as the actor the composer would use.
 */
export async function ownerActorInOrg(ownerUserId: string, orgId: string): Promise<string | null> {
  const rows = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(eq(actor.userId, ownerUserId), eq(actor.organizationId, orgId), eq(actor.kind, 'human')),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Load a plan the caller owns, or 404. */
export async function loadOwnedPlan(ownerUserId: string, id: string): Promise<PlanDraftRow> {
  const rows = await db
    .select()
    .from(planDraft)
    .where(and(eq(planDraft.id, id), eq(planDraft.ownerUserId, ownerUserId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Plan not found');
  return row;
}

/** The caller's plans that are not archived, newest first. */
export async function listOwnedPlans(ownerUserId: string): Promise<PlanDraftRow[]> {
  return db
    .select()
    .from(planDraft)
    .where(and(eq(planDraft.ownerUserId, ownerUserId), isNull(planDraft.archivedAt)))
    .orderBy(desc(planDraft.updatedAt));
}

/** What creating a plan needs beyond the request body. */
export interface CreatePlanInput extends PlanDraftCreate {
  /** The Athena session that opened the plan, when one did. */
  readonly sessionId?: string | null | undefined;
}

/**
 * Start a plan, or reopen the caller's active plan rooted on the same initiative.
 *
 * @throws {NotFoundError} When the caller is not a member of the workspace, or the initiative is
 *   not in it.
 */
export async function createOrReopenPlan(
  ownerUserId: string,
  input: CreatePlanInput,
): Promise<PlanDraftRow> {
  const actorId = await ownerActorInOrg(ownerUserId, input.organizationId);
  if (actorId === null) throw new NotFoundError('Workspace not found');

  const root = input.initiativeId === undefined ? null : await loadRootInitiative(input);
  if (root) {
    const existing = await activePlanForRoot(ownerUserId, root.id);
    if (existing) return existing;
  }

  const inserted = await db
    .insert(planDraft)
    .values(newPlanValues(ownerUserId, input, root))
    .returning();
  const row = inserted[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('plan insert returned no row');
  return row;
}

/** The row a fresh plan starts as. */
function newPlanValues(
  ownerUserId: string,
  input: CreatePlanInput,
  root: { id: string; name: string } | null,
): typeof planDraft.$inferInsert {
  return {
    ownerUserId,
    organizationId: input.organizationId,
    sessionId: input.sessionId ?? null,
    rootInitiativeId: root?.id ?? null,
    title: input.title ?? root?.name ?? 'New plan',
    document: root ? rootedDocument(root) : EMPTY_PLAN_DOCUMENT,
  };
}

/** The caller's open plan rooted on an initiative, when one exists. */
async function activePlanForRoot(
  ownerUserId: string,
  initiativeId: string,
): Promise<PlanDraftRow | undefined> {
  const rows = await db
    .select()
    .from(planDraft)
    .where(
      and(
        eq(planDraft.ownerUserId, ownerUserId),
        eq(planDraft.rootInitiativeId, initiativeId),
        eq(planDraft.status, 'active'),
      ),
    )
    .limit(1);
  return rows[0];
}

/** A document whose only node is the real initiative the plan is rooted on. */
function rootedDocument(root: { id: string; name: string }): PlanDocument {
  return {
    nodes: [
      {
        ref: ROOT_REF,
        kind: 'initiative',
        parentRef: null,
        initiativeRefs: [],
        initiativeIds: [],
        fields: { title: root.name },
        templateId: null,
        status: 'confirmed',
        objectId: root.id,
      },
    ],
    edges: [],
  };
}

async function loadRootInitiative(input: CreatePlanInput): Promise<{ id: string; name: string }> {
  const rows = await db
    .select({ id: initiative.id, name: initiative.name })
    .from(initiative)
    .where(
      and(
        eq(initiative.id, input.initiativeId ?? ''),
        eq(initiative.organizationId, input.organizationId),
        isNull(initiative.archivedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Initiative not found');
  return row;
}

/** Attach the hosting Athena session to a plan that has none yet. */
export async function attachPlanSession(
  row: PlanDraftRow,
  sessionId: string,
): Promise<PlanDraftRow> {
  if (row.sessionId !== null) return row;
  const updated = await db
    .update(planDraft)
    .set({ sessionId })
    .where(eq(planDraft.id, row.id))
    .returning();
  return updated[0] ?? row;
}

/** The template payloads the plan's owner may apply in its workspace. */
export async function planTemplateEnvironment(
  row: Pick<PlanDraftRow, 'ownerUserId' | 'organizationId'>,
): Promise<PlanOpEnvironment> {
  const actorId = await ownerActorInOrg(row.ownerUserId, row.organizationId);
  if (actorId === null) return { templatePayload: () => undefined };
  const rows = await db
    .select({ id: template.id, payload: template.payload })
    .from(template)
    .where(visibleTemplateWhere(row.organizationId, actorId, {}));
  const byId = new Map<string, TemplateDraft>(rows.map((entry) => [entry.id, entry.payload]));
  return { templatePayload: (templateId) => byId.get(templateId) };
}

/** The templates Athena and the inspector may offer, seeding the workspace defaults first. */
export async function listPlanTemplates(
  row: Pick<PlanDraftRow, 'ownerUserId' | 'organizationId'>,
): Promise<PlanTemplateOption[]> {
  const actorId = await ownerActorInOrg(row.ownerUserId, row.organizationId);
  if (actorId === null) return [];
  await seedDefaultTemplates(row.organizationId, actorId);
  const rows = await db
    .select({
      id: template.id,
      targetType: template.targetType,
      name: template.name,
      description: template.description,
    })
    .from(template)
    .where(visibleTemplateWhere(row.organizationId, actorId, {}));
  return rows.map((entry) => ({
    id: entry.id,
    targetType: entry.targetType,
    name: entry.name,
    description: entry.description,
  })) as PlanTemplateOption[];
}

/** Translate a reducer rejection into the API's field-error shape. */
function rejectionToValidation(error: PlanOpError): ValidationError {
  return new ValidationError([{ message: error.reason, path: error.path.split('.') }]);
}

/**
 * Apply a batch of ops against the revision they were written for.
 *
 * @throws {PreconditionFailedError} When the plan's revision has moved on.
 * @throws {ValidationError} When the reducer rejects an op; the failing path is named.
 * @throws {NotFoundError} When the plan is missing, archived, or not the caller's.
 */
export async function patchPlan(
  ownerUserId: string,
  id: string,
  patch: PlanDraftPatch,
): Promise<PlanDraftRow> {
  const current = await loadOwnedPlan(ownerUserId, id);
  if (current.status === 'archived') throw new NotFoundError('Plan not found');
  const env = await planTemplateEnvironment(current);
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(planDraft)
      .where(eq(planDraft.id, id))
      .for('update')
      .limit(1);
    const row = locked[0];
    if (!row) throw new NotFoundError('Plan not found');
    if (row.revision !== patch.revision) {
      throw new PreconditionFailedError('The plan changed since that revision.');
    }
    let document: PlanDocument;
    try {
      document = applyPlanOps(row.document, patch.ops, env);
    } catch (error) {
      if (error instanceof PlanOpError) throw rejectionToValidation(error);
      throw error;
    }
    const title = patch.ops.reduce(
      (value, op) => (op.op === 'set_title' ? op.title : value),
      row.title,
    );
    const status =
      planCounts(document).draft === 0 && document.nodes.length > 0 ? 'committed' : 'active';
    const updated = await tx
      .update(planDraft)
      .set({ document, title, status, revision: row.revision + 1 })
      .where(eq(planDraft.id, id))
      .returning();
    const next = updated[0];
    /* v8 ignore next -- @preserve defensive: update always returns a row */
    if (!next) throw new Error('plan update returned no row');
    return next;
  });
}

/** Archive a plan without creating anything. Idempotent. */
export async function archivePlan(ownerUserId: string, id: string): Promise<PlanDraftRow> {
  const current = await loadOwnedPlan(ownerUserId, id);
  if (current.status === 'archived') return current;
  const updated = await db
    .update(planDraft)
    .set({ status: 'archived', archivedAt: new Date() })
    .where(eq(planDraft.id, id))
    .returning();
  return updated[0] ?? current;
}

interface SnapshotRow {
  readonly id: string;
  readonly name: string;
  readonly statusId: string | null;
  readonly health: PlanObjectSnapshot['health'];
  readonly archived: boolean;
}

async function snapshotRows(kind: PlanNodeKind, ids: readonly string[]): Promise<SnapshotRow[]> {
  if (ids.length === 0) return [];
  switch (kind) {
    case 'initiative': {
      const rows = await db
        .select({
          id: initiative.id,
          name: initiative.name,
          statusId: initiative.statusId,
          health: initiative.health,
          archivedAt: initiative.archivedAt,
        })
        .from(initiative)
        .where(inArray(initiative.id, [...ids]));
      return rows.map((row) => ({ ...row, archived: row.archivedAt !== null }));
    }
    case 'program': {
      const rows = await db
        .select({
          id: program.id,
          name: program.name,
          statusId: program.statusId,
          health: program.health,
          archivedAt: program.archivedAt,
        })
        .from(program)
        .where(inArray(program.id, [...ids]));
      return rows.map((row) => ({ ...row, archived: row.archivedAt !== null }));
    }
    case 'project': {
      const rows = await db
        .select({
          id: project.id,
          name: project.name,
          statusId: project.statusId,
          health: project.health,
          archivedAt: project.archivedAt,
        })
        .from(project)
        .where(inArray(project.id, [...ids]));
      return rows.map((row) => ({ ...row, archived: row.archivedAt !== null }));
    }
    case 'task': {
      const rows = await db
        .select({
          id: task.id,
          name: task.title,
          statusId: task.statusId,
          archivedAt: task.archivedAt,
        })
        .from(task)
        .where(inArray(task.id, [...ids]));
      return rows.map((row) => ({ ...row, health: null, archived: row.archivedAt !== null }));
    }
  }
}

const HREF_SEGMENT: Readonly<Record<PlanNodeKind, string>> = {
  initiative: 'initiatives',
  program: 'programs',
  project: 'projects',
  task: 'tasks',
};

/** The plan as the API returns it, with every confirmed node hydrated from its real record. */
export async function presentPlan(row: PlanDraftRow): Promise<PlanDraftOut> {
  const confirmed = row.document.nodes.filter((node) => node.objectId !== null);
  const byKind = new Map<PlanNodeKind, string[]>();
  for (const node of confirmed) {
    const list = byKind.get(node.kind) ?? [];
    list.push(node.objectId ?? '');
    byKind.set(node.kind, list);
  }
  const snapshots = new Map<string, SnapshotRow>();
  for (const [kind, ids] of byKind) {
    for (const snapshot of await snapshotRows(kind, ids)) snapshots.set(snapshot.id, snapshot);
  }
  const statusIds = [...snapshots.values()]
    .map((snapshot) => snapshot.statusId)
    .filter((id): id is string => id !== null);
  const statusNames = new Map<string, string>(
    statusIds.length === 0
      ? []
      : (
          await db
            .select({ id: workStatus.id, name: workStatus.name })
            .from(workStatus)
            .where(inArray(workStatus.id, statusIds))
        ).map((status) => [status.id, status.name]),
  );
  const objects: Record<string, PlanObjectSnapshot> = {};
  for (const node of confirmed) {
    const snapshot = node.objectId === null ? undefined : snapshots.get(node.objectId);
    if (!snapshot) continue;
    objects[node.ref] = {
      name: snapshot.name,
      statusName: snapshot.statusId === null ? null : (statusNames.get(snapshot.statusId) ?? null),
      health: snapshot.health,
      href: `/orgs/${row.organizationId}/${HREF_SEGMENT[node.kind]}/${snapshot.id}`,
      archived: snapshot.archived,
    };
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    sessionId: row.sessionId,
    rootInitiativeId: row.rootInitiativeId,
    title: row.title,
    status: row.status,
    revision: row.revision,
    document: row.document,
    objects,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as PlanDraftOut;
}

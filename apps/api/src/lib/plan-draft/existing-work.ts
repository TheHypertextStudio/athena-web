import { templateReferenceWriteError } from '../templates/copy-reference-errors';
/**
 * `@docket/api` — showing the work already under a plan's root initiative.
 *
 * @remarks
 * A plan rooted on an existing initiative is drafted beside the work that initiative already has.
 * Without that work on the canvas a plan cannot say "the new launch project waits on the existing
 * migration project", and a new task has nowhere to go but a new project. So the projects linked
 * to the root, and the open top-level tasks in them, appear as confirmed nodes: draft work may sit
 * under them and depend on them, and a commit resolves them to their real ids like any other
 * confirmed node. Confirmed nodes stay read-only in the document — the real records are changed
 * with `update` and `link`.
 *
 * The set is bounded by {@link MAX_EXISTING_NODES}, projects first, because a canvas that shows an
 * initiative's whole backlog stops being a planning surface.
 */
import { db, initiativeProject, planDraft, project, task } from '@docket/db';
import type { PlanDocument, PlanNode } from '@docket/work/plan-draft-contract';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { resourceAccessKey, viewableResourceKeys } from '../../permissions/resource-access';

/** The most existing records one plan adds to its document. */
export const MAX_EXISTING_NODES = 150;

/** A plan row, as far as hydration reads it. */
type PlanRow = typeof planDraft.$inferSelect;

/** A confirmed node standing for an existing record. */
function confirmedNode(
  kind: 'project' | 'task',
  id: string,
  title: string,
  parentRef: string,
): PlanNode {
  return {
    ref: `${kind}-${id}`,
    kind,
    parentRef,
    initiativeRefs: [],
    initiativeIds: [],
    fields: { title },
    templateId: null,
    status: 'confirmed',
    objectId: id,
  };
}

/** The live projects linked to an initiative, by name. */
async function linkedProjects(
  orgId: string,
  initiativeId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: project.id, name: project.name })
    .from(initiativeProject)
    .innerJoin(project, eq(initiativeProject.projectId, project.id))
    .where(
      and(
        eq(initiativeProject.organizationId, orgId),
        eq(initiativeProject.initiativeId, initiativeId),
        isNull(project.archivedAt),
      ),
    )
    .orderBy(asc(project.name), asc(project.id));
}

/** The open top-level tasks in a set of projects, oldest first. */
async function openTasks(
  orgId: string,
  projectIds: readonly string[],
  limit: number,
): Promise<{ id: string; title: string; projectId: string | null }[]> {
  if (projectIds.length === 0 || limit <= 0) return [];
  return db
    .select({ id: task.id, title: task.title, projectId: task.projectId })
    .from(task)
    .where(
      and(
        eq(task.organizationId, orgId),
        inArray(task.projectId, [...projectIds]),
        isNull(task.parentTaskId),
        isNull(task.archivedAt),
        isNull(task.completedAt),
        isNull(task.canceledAt),
      ),
    )
    .orderBy(asc(task.createdAt), asc(task.id))
    .limit(limit);
}

/** Filter candidate work through the owner's current resource grants and public baseline. */
async function visibleRows<Row extends { id: string }>(
  ownerUserId: string,
  orgId: string,
  kind: 'project' | 'task',
  rows: readonly Row[],
): Promise<Row[]> {
  const ref = (id: string) => ({ organizationId: orgId, kind, id });
  const keys = await viewableResourceKeys(
    ownerUserId,
    rows.map((row) => ref(row.id)),
  );
  return rows.filter((row) => keys.has(resourceAccessKey(ref(row.id))));
}

/**
 * The confirmed nodes a plan is missing for work already under its root initiative.
 *
 * @param ownerUserId - The owner whose current grants bound existing work.
 * @param orgId - The plan's workspace.
 * @param rootInitiativeId - The initiative the plan is rooted on.
 * @param document - The document as it stands; records it already names are skipped.
 * @returns new nodes, parents first, to append to the document.
 */
export async function missingExistingWork(
  ownerUserId: string,
  orgId: string,
  rootInitiativeId: string,
  document: PlanDocument,
): Promise<PlanNode[]> {
  const root = document.nodes.find((node) => node.objectId === rootInitiativeId);
  if (!root) return [];
  const refByObject = new Map<string, string>();
  for (const node of document.nodes) {
    if (node.objectId !== null) refByObject.set(node.objectId, node.ref);
  }
  const added: PlanNode[] = [];
  const projects = await visibleRows(
    ownerUserId,
    orgId,
    'project',
    await linkedProjects(orgId, rootInitiativeId),
  );
  for (const row of projects.slice(0, MAX_EXISTING_NODES)) {
    if (refByObject.has(row.id)) continue;
    const node = confirmedNode('project', row.id, row.name, root.ref);
    refByObject.set(row.id, node.ref);
    added.push(node);
  }
  const shown = projects.filter((row) => refByObject.has(row.id)).map((row) => row.id);
  const tasks = await visibleRows(
    ownerUserId,
    orgId,
    'task',
    await openTasks(orgId, shown, MAX_EXISTING_NODES - added.length),
  );
  for (const row of tasks) {
    const parentRef = row.projectId === null ? undefined : refByObject.get(row.projectId);
    if (parentRef === undefined || refByObject.has(row.id)) continue;
    added.push(confirmedNode('task', row.id, row.title, parentRef));
  }
  return added;
}

/**
 * A rooted plan's document with the root initiative's existing work added.
 *
 * @param ownerUserId - The owner whose current grants bound existing work.
 * @param orgId - The plan's workspace.
 * @param rootInitiativeId - The initiative the plan is rooted on.
 * @param document - The document to extend.
 * @returns the document, unchanged when nothing was missing.
 */
export async function withExistingWork(
  ownerUserId: string,
  orgId: string,
  rootInitiativeId: string,
  document: PlanDocument,
): Promise<PlanDocument> {
  const added = await missingExistingWork(ownerUserId, orgId, rootInitiativeId, document);
  return added.length === 0 ? document : { ...document, nodes: [...document.nodes, ...added] };
}

/**
 * Bring a reopened rooted plan up to date with the work its initiative has gained since.
 *
 * @remarks
 * Work linked to the initiative after the plan was opened appears on reopen, so the plan never
 * shows less than the initiative has. The new nodes are confirmed, so this only ever adds what is
 * already real; the revision moves so the canvas and Athena re-read the document.
 *
 * @param row - The reopened plan.
 * @returns the plan, rewritten when anything was added.
 */
export async function refreshExistingWork(row: PlanRow): Promise<PlanRow> {
  if (row.rootInitiativeId === null) return row;
  const added = await missingExistingWork(
    row.ownerUserId,
    row.organizationId,
    row.rootInitiativeId,
    row.document,
  );
  if (added.length === 0) return row;
  const updated = await db
    .update(planDraft)
    .set({
      document: { ...row.document, nodes: [...row.document.nodes, ...added] },
      revision: row.revision + 1,
    })
    .where(and(eq(planDraft.id, row.id), eq(planDraft.revision, row.revision)))
    .returning()
    .catch(templateReferenceWriteError);
  if (updated[0]) return updated[0];
  // Someone edited the plan in between; return what they left rather than a stale copy.
  const current = await db.select().from(planDraft).where(eq(planDraft.id, row.id)).limit(1);
  return current[0] ?? row;
}

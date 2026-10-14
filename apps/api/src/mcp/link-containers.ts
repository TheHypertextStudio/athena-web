/**
 * `@docket/api` — the container relations: `contributes_to` and `nested_under`.
 *
 * @remarks
 * A project or program may contribute to any number of initiatives, so `contributes_to` is a plain
 * many-to-many edge. An initiative has one parent in a workspace's hierarchy, so `nested_under` is
 * single-valued: nesting under a new parent moves it, exactly as the hierarchy route's move does,
 * and goes through the same validator for depth, cycles, and visibility.
 */
import { canActorBatch } from '@docket/authz';
import {
  db,
  initiativeHierarchyLink,
  initiativeProgram,
  initiativeProject,
  organization,
} from '@docket/db';
import { and, eq } from 'drizzle-orm';

import {
  validateInitiativeHierarchyChange,
  type InitiativeAccess,
} from '../routes/initiative-hierarchy';
import { initiativeParentChange } from './change-set-hierarchy';
import { resolveAcross, resolveDescriptor } from './descriptors';
import { rejectSelf, unchanged, type RelationRequest, type RelationResult } from './link-types';

/**
 * Hierarchy access for an MCP actor: the Initiatives that actor's own grants let it view.
 *
 * @remarks
 * A session reaches Initiatives in every workspace its user belongs to; an MCP actor belongs to one
 * workspace, so an Initiative from another workspace is simply not visible to it, and a hierarchy
 * that runs through one is refused the same way the route refuses a hidden node.
 */
export function actorInitiativeAccess(actorId: string): InitiativeAccess {
  return async (nodes, database) => {
    const decisions = await canActorBatch(
      actorId,
      'view',
      nodes.map((node) => ({ kind: 'initiative', id: node.id, orgId: node.organizationId })),
      database,
    );
    return new Set(nodes.filter((_, index) => decisions[index]?.allow === true).map((n) => n.id));
  };
}

/**
 * `contributes_to`: a project or program rolls up to an initiative.
 *
 * @param request - The call; `from` is the project or program, `to` the initiative.
 * @returns what was written.
 */
export async function applyContributesTo(request: RelationRequest): Promise<RelationResult> {
  const { orgId, remove, guard } = request;
  const initiativeId = await resolveDescriptor(orgId, 'initiative', request.to, 'to');
  // The subject may be either kind, and the sentence "the migration project contributes to Q3"
  // never mentions a table — so both pools are searched at once, which also means a name that
  // matches a project AND a program is reported as ambiguous rather than silently taking one.
  const subject = await resolveAcross(orgId, ['project', 'program'] as const, request.from, 'from');
  await guard(subject.kind, subject.id);
  await guard('initiative', initiativeId);

  const link =
    subject.kind === 'project'
      ? {
          table: initiativeProject,
          where: and(
            eq(initiativeProject.organizationId, orgId),
            eq(initiativeProject.projectId, subject.id),
            eq(initiativeProject.initiativeId, initiativeId),
          ),
          values: { organizationId: orgId, projectId: subject.id, initiativeId },
          kind: 'project_contributes_to' as const,
        }
      : {
          table: initiativeProgram,
          where: and(
            eq(initiativeProgram.organizationId, orgId),
            eq(initiativeProgram.programId, subject.id),
            eq(initiativeProgram.initiativeId, initiativeId),
          ),
          values: { organizationId: orgId, programId: subject.id, initiativeId },
          kind: 'program_contributes_to' as const,
        };

  const ends = {
    from: subject.id,
    to: initiativeId,
    fromKind: subject.kind,
    toKind: 'initiative' as const,
  };
  const existing = await db.select().from(link.table).where(link.where).limit(1);
  if (remove ? !existing[0] : existing[0]) return unchanged(ends);
  if (remove) await db.delete(link.table).where(link.where);
  else await db.insert(link.table).values(link.values);
  return {
    ...ends,
    changed: true,
    changes: [{ kind: link.kind, from: subject.id, to: initiativeId, linked: !remove }],
    reindex: [],
  };
}

/** Where the child sat before and after the write, or null when nothing moved. */
type ParentMove = { readonly before: string | null; readonly after: string | null } | null;

/**
 * Write the child's parent inside the hierarchy transaction.
 *
 * @remarks
 * The workspace row is locked first, as the hierarchy routes lock it, so two concurrent moves are
 * validated one after the other against the graph the first one left.
 */
async function moveUnder(
  request: RelationRequest,
  childId: string,
  parentId: string,
): Promise<ParentMove> {
  const { orgId } = request;
  return db.transaction(async (tx) => {
    await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, orgId))
      .for('update');
    const [current] = await tx
      .select()
      .from(initiativeHierarchyLink)
      .where(
        and(
          eq(initiativeHierarchyLink.contextOrganizationId, orgId),
          eq(initiativeHierarchyLink.childInitiativeId, childId),
        ),
      )
      .limit(1);
    const before = current?.parentInitiativeId ?? null;
    if (request.remove) {
      if (!current || before !== parentId) return null;
      await tx.delete(initiativeHierarchyLink).where(eq(initiativeHierarchyLink.id, current.id));
      return { before, after: null };
    }
    if (before === parentId) return null;
    await validateInitiativeHierarchyChange(
      {
        contextOrganizationId: orgId,
        parentInitiativeId: parentId,
        childInitiativeId: childId,
        access: request.access,
        ...(current ? { excludeLinkId: current.id } : {}),
      },
      tx,
    );
    if (current) {
      await tx
        .update(initiativeHierarchyLink)
        .set({ parentInitiativeId: parentId })
        .where(eq(initiativeHierarchyLink.id, current.id));
    } else {
      await tx.insert(initiativeHierarchyLink).values({
        contextOrganizationId: orgId,
        parentInitiativeId: parentId,
        childInitiativeId: childId,
        createdBy: request.actorId,
      });
    }
    return { before, after: parentId };
  });
}

/**
 * `nested_under`: an initiative sits under a parent initiative in this workspace.
 *
 * @param request - The call; `from` is the child and `to` the parent.
 * @returns what was written, recorded as one parent snapshot so undo restores a move whole.
 * @throws {ConflictError} When the nesting would close a cycle or exceed the workspace's depth.
 */
export async function applyNestedUnder(request: RelationRequest): Promise<RelationResult> {
  const { orgId, guard } = request;
  const childId = await resolveDescriptor(orgId, 'initiative', request.from, 'from');
  const parentId = await resolveDescriptor(orgId, 'initiative', request.to, 'to');
  if (childId === parentId) rejectSelf('to', request.to);
  await guard('initiative', childId);
  await guard('initiative', parentId);

  const ends = {
    from: childId,
    to: parentId,
    fromKind: 'initiative' as const,
    toKind: 'initiative' as const,
  };
  const moved = await moveUnder(request, childId, parentId);
  if (!moved) return unchanged(ends);
  return {
    ...ends,
    changed: true,
    changes: [initiativeParentChange(childId, moved.before, moved.after)],
    reindex: [],
  };
}

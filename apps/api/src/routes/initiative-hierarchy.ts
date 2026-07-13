/**
 * Context-owned Initiative hierarchy validation.
 *
 * @remarks
 * Hierarchy edges arrange independently owned Initiatives without granting access to them.
 * Every write therefore rechecks the caller's memberships, validates the entire context graph,
 * and enforces the workspace's configured total depth.
 */
import { actor, db, initiative, initiativeHierarchyLink, organization } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';

import type { AuthSession } from '../context';
import { ConflictError, NotFoundError } from '../error';

type HierarchyLinkRow = typeof initiativeHierarchyLink.$inferSelect;

/** Return every organization the current session can independently view. */
export async function accessibleInitiativeOrganizationIds(
  contextOrganizationId: string,
  session: AuthSession,
): Promise<Set<string>> {
  const ids = new Set([contextOrganizationId]);
  if (!session?.user) return ids;
  const memberships = await db
    .select({ organizationId: actor.organizationId })
    .from(actor)
    .where(
      and(eq(actor.userId, session.user.id), eq(actor.kind, 'human'), eq(actor.status, 'active')),
    );
  for (const membership of memberships) ids.add(membership.organizationId);
  return ids;
}

/** Calculate the deepest path in an acyclic hierarchy edge set. */
export function initiativeHierarchyDepth(
  edges: readonly Pick<HierarchyLinkRow, 'parentInitiativeId' | 'childInitiativeId'>[],
): number {
  if (edges.length === 0) return 1;
  const parentByChild = new Map(
    edges.map((edge) => [edge.childInitiativeId, edge.parentInitiativeId]),
  );
  const nodes = new Set(edges.flatMap((edge) => [edge.parentInitiativeId, edge.childInitiativeId]));
  let maximum = 1;
  for (const node of nodes) {
    let depth = 1;
    let cursor: string | undefined = node;
    const visited = new Set<string>();
    while (cursor !== undefined) {
      if (visited.has(cursor))
        throw new ConflictError('Initiative hierarchy would contain a cycle');
      visited.add(cursor);
      cursor = parentByChild.get(cursor);
      if (cursor !== undefined) depth += 1;
    }
    maximum = Math.max(maximum, depth);
  }
  return maximum;
}

/** Validate a hierarchy create or move and return the current context edges. */
export async function validateInitiativeHierarchyChange(input: {
  readonly contextOrganizationId: string;
  readonly parentInitiativeId: string;
  readonly childInitiativeId: string;
  readonly session: AuthSession;
  readonly excludeLinkId?: string;
}): Promise<HierarchyLinkRow[]> {
  if (input.parentInitiativeId === input.childInitiativeId) {
    throw new ConflictError('An Initiative cannot be its own parent');
  }

  const [settingsRows, nodeRows, currentEdges, accessibleIds] = await Promise.all([
    db
      .select({ initiativeMaxDepth: organization.initiativeMaxDepth })
      .from(organization)
      .where(eq(organization.id, input.contextOrganizationId))
      .limit(1),
    db
      .select({ id: initiative.id, organizationId: initiative.organizationId })
      .from(initiative)
      .where(inArray(initiative.id, [input.parentInitiativeId, input.childInitiativeId])),
    db
      .select()
      .from(initiativeHierarchyLink)
      .where(eq(initiativeHierarchyLink.contextOrganizationId, input.contextOrganizationId)),
    accessibleInitiativeOrganizationIds(input.contextOrganizationId, input.session),
  ]);

  const settings = settingsRows[0];
  if (!settings) throw new NotFoundError('Workspace not found');
  const nodesById = new Map(nodeRows.map((node) => [node.id, node]));
  const parent = nodesById.get(input.parentInitiativeId);
  const child = nodesById.get(input.childInitiativeId);
  if (
    !parent ||
    !child ||
    !accessibleIds.has(parent.organizationId) ||
    !accessibleIds.has(child.organizationId)
  ) {
    throw new NotFoundError('Initiative not found');
  }

  const edges = currentEdges.filter((edge) => edge.id !== input.excludeLinkId);
  if (edges.some((edge) => edge.childInitiativeId === input.childInitiativeId)) {
    throw new ConflictError('Initiative already has a parent in this workspace');
  }

  const visibleNodeIds = new Set(
    edges.flatMap((edge) => [edge.parentInitiativeId, edge.childInitiativeId]),
  );
  if (parent.organizationId !== input.contextOrganizationId && !visibleNodeIds.has(parent.id)) {
    throw new ConflictError('A hierarchy root must belong to the context workspace');
  }

  const candidateEdges = [
    ...edges,
    {
      parentInitiativeId: input.parentInitiativeId,
      childInitiativeId: input.childInitiativeId,
    },
  ];
  const depth = initiativeHierarchyDepth(candidateEdges);
  if (depth > settings.initiativeMaxDepth) {
    throw new ConflictError(
      `Initiative hierarchy exceeds the workspace maximum depth of ${settings.initiativeMaxDepth}`,
    );
  }
  return currentEdges;
}

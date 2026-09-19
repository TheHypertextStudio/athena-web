/**
 * Context-owned Initiative hierarchy validation.
 *
 * @remarks
 * Hierarchy edges arrange independently owned Initiatives without granting access to them.
 * Every write therefore rechecks the caller's memberships, validates the entire context graph,
 * and enforces the workspace's configured total depth.
 */
import { actor, db, initiative, initiativeHierarchyLink, organization } from '@docket/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { AuthSession } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { resourceAccessKey, viewableResourceKeys } from '../permissions/resource-access';

type HierarchyLinkRow = typeof initiativeHierarchyLink.$inferSelect;
type HierarchyTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type HierarchyDatabase = typeof db | HierarchyTransaction;

/** Minimal Initiative identity required to authorize one hierarchy projection. */
export interface AccessibleInitiativeHierarchyNode {
  readonly id: string;
  readonly organizationId: string;
}

/** Minimal hierarchy edge required to calculate an authorized route projection. */
export interface AccessibleInitiativeHierarchyLink {
  readonly parentInitiativeId: string;
  readonly childInitiativeId: string;
}

/** Route-rooted Initiative nodes and links whose complete parent chain is accessible. */
export interface AccessibleInitiativeHierarchyProjection<
  Link extends AccessibleInitiativeHierarchyLink,
> {
  readonly nodeIds: ReadonlySet<string>;
  readonly links: readonly Link[];
}

/** An authorized context graph used by Initiative routes that start from one route id. */
export interface AccessibleInitiativeHierarchyGraph {
  /** Every context-owned hierarchy edge. */
  readonly links: readonly HierarchyLinkRow[];
  /** Every Initiative referenced by the graph plus the explicitly requested route ids. */
  readonly nodes: readonly (typeof initiative.$inferSelect)[];
  /** The route-rooted projection after canonical resource authorization. */
  readonly projection: AccessibleInitiativeHierarchyProjection<HierarchyLinkRow>;
}

/**
 * Project raw context edges through accessible nodes rooted in route-owned Initiatives.
 *
 * @param contextOrganizationId - Workspace that owns the hierarchy projection.
 * @param nodes - Every accessible Initiative referenced by the route graph plus local roots.
 * @param links - Raw route-owned edges. Hidden edges remain here for integrity checks elsewhere.
 * @returns Reachable node ids and the links whose complete route-rooted chain is accessible.
 */
export function accessibleInitiativeHierarchyProjection<
  Link extends AccessibleInitiativeHierarchyLink,
>(
  contextOrganizationId: string,
  nodes: readonly AccessibleInitiativeHierarchyNode[],
  links: readonly Link[],
): AccessibleInitiativeHierarchyProjection<Link> {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const parentByChild = new Map(links.map((link) => [link.childInitiativeId, link]));
  const childrenByParent = new Map<string, Link[]>();
  for (const link of links) {
    const children = childrenByParent.get(link.parentInitiativeId) ?? [];
    children.push(link);
    childrenByParent.set(link.parentInitiativeId, children);
  }

  const nodeIds = new Set<string>();
  const pending = nodes
    .filter((node) => node.organizationId === contextOrganizationId && !parentByChild.has(node.id))
    .map((node) => node.id);
  for (const nodeId of pending) {
    if (nodeIds.has(nodeId)) continue;
    nodeIds.add(nodeId);
    for (const link of childrenByParent.get(nodeId) ?? []) {
      if (nodesById.has(link.childInitiativeId)) pending.push(link.childInitiativeId);
    }
  }

  return {
    nodeIds,
    links: links.filter(
      (link) => nodeIds.has(link.parentInitiativeId) && nodeIds.has(link.childInitiativeId),
    ),
  };
}

/**
 * Return the organization ids that bound an Initiative candidate query.
 *
 * @remarks
 * This is only a query-size bound. Membership does not authorize any Initiative row. Call
 * {@link accessibleInitiativeNodeIds} before returning or mutating a candidate.
 */
export async function activeInitiativeOrganizationIds(
  contextOrganizationId: string,
  session: AuthSession,
  database: HierarchyDatabase = db,
): Promise<Set<string>> {
  const ids = new Set([contextOrganizationId]);
  if (!session?.user) return ids;
  const memberships = await database
    .select({ organizationId: actor.organizationId })
    .from(actor)
    .where(
      and(
        eq(actor.userId, session.user.id),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    );
  for (const membership of memberships) ids.add(membership.organizationId);
  return ids;
}

/**
 * Resolve the Initiative nodes the current session can view through canonical resource grants.
 *
 * @param session - Authenticated user whose grants should be resolved.
 * @param nodes - Candidate Initiative identities from the route-owned graph.
 * @param database - Optional transaction that owns the hierarchy validation snapshot.
 * @returns The Initiative ids that passed resource-level authorization.
 */
export async function accessibleInitiativeNodeIds(
  session: AuthSession,
  nodes: readonly AccessibleInitiativeHierarchyNode[],
  database?: HierarchyDatabase,
): Promise<Set<string>> {
  if (!session?.user || nodes.length === 0) return new Set();
  const uniqueNodes = [
    ...new Map(
      nodes.map((node) => [
        resourceAccessKey({
          organizationId: node.organizationId,
          kind: 'initiative',
          id: node.id,
        }),
        node,
      ]),
    ).values(),
  ];
  const refs = uniqueNodes.map((node) => ({
    organizationId: node.organizationId,
    kind: 'initiative' as const,
    id: node.id,
  }));
  const viewableKeys = await viewableResourceKeys(session.user.id, refs, database);
  return new Set(
    uniqueNodes
      .filter((node) =>
        viewableKeys.has(
          resourceAccessKey({
            organizationId: node.organizationId,
            kind: 'initiative',
            id: node.id,
          }),
        ),
      )
      .map((node) => node.id),
  );
}

/**
 * Load and authorize a complete Initiative context graph for route-rooted reads.
 *
 * @param contextOrganizationId - Workspace that owns the hierarchy edges.
 * @param routeInitiativeIds - Unlinked local route roots that must be considered with linked nodes.
 * @param session - Authenticated viewer whose resource grants define the projection.
 * @param database - Optional transaction that owns the read snapshot.
 * @returns The raw graph, its candidate Initiative rows, and the authorized route projection.
 */
export async function loadAccessibleInitiativeHierarchyGraph(
  contextOrganizationId: string,
  routeInitiativeIds: readonly string[],
  session: AuthSession,
  database: HierarchyDatabase = db,
): Promise<AccessibleInitiativeHierarchyGraph> {
  const links = await database
    .select()
    .from(initiativeHierarchyLink)
    .where(eq(initiativeHierarchyLink.contextOrganizationId, contextOrganizationId));
  const nodeIds = [
    ...new Set([
      ...routeInitiativeIds,
      ...links.flatMap((link) => [link.parentInitiativeId, link.childInitiativeId]),
    ]),
  ];
  const nodes =
    nodeIds.length === 0
      ? []
      : await database.select().from(initiative).where(inArray(initiative.id, nodeIds));
  const accessibleNodeIds = await accessibleInitiativeNodeIds(session, nodes, database);
  return {
    links,
    nodes,
    projection: accessibleInitiativeHierarchyProjection(
      contextOrganizationId,
      nodes.filter((node) => accessibleNodeIds.has(node.id)),
      links,
    ),
  };
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

/**
 * Validate that a potential parent-child pair exists and is accessible.
 * @throws NotFoundError if either initiative is inaccessible
 */
async function assertInitiativeIdsAccessible(
  input: {
    readonly contextOrganizationId: string;
    readonly parentInitiativeId: string;
    readonly childInitiativeId: string;
    readonly session: AuthSession;
  },
  nodeRows: readonly (typeof initiative.$inferSelect)[],
  accessibleNodeIds: Set<string>,
): Promise<{ parent: typeof initiative.$inferSelect; child: typeof initiative.$inferSelect }> {
  const nodesById = new Map(nodeRows.map((node) => [node.id, node]));
  const parent = nodesById.get(input.parentInitiativeId);
  const child = nodesById.get(input.childInitiativeId);
  if (!parent || !child || !accessibleNodeIds.has(parent.id) || !accessibleNodeIds.has(child.id)) {
    throw new NotFoundError('Initiative not found');
  }
  return { parent, child };
}

/**
 * Validate that the child has no existing parent in the workspace.
 * @throws ConflictError if child already has a parent
 * @throws NotFoundError if existing parent is not accessible
 */
function assertChildHasNoExistingParent(
  childInitiativeId: string,
  excludeLinkId: string | undefined,
  currentEdges: readonly HierarchyLinkRow[],
  visibleCurrentLinkIds: Set<string>,
): void {
  const edges = currentEdges.filter((edge) => edge.id !== excludeLinkId);
  const existingParent = edges.find((edge) => edge.childInitiativeId === childInitiativeId);
  if (existingParent && !visibleCurrentLinkIds.has(existingParent.id)) {
    throw new NotFoundError('Initiative not found');
  }
  if (existingParent) {
    throw new ConflictError('Initiative already has a parent in this workspace');
  }
}

/**
 * Validate that parent remains visible after applying the new edge.
 * @throws ConflictError if parent is not visible in the resulting projection
 */
function assertParentVisibleInProjection(
  contextOrganizationId: string,
  parentInitiativeId: string,
  edges: readonly HierarchyLinkRow[],
  accessibleNodes: readonly AccessibleInitiativeHierarchyNode[],
): void {
  const projection = accessibleInitiativeHierarchyProjection(
    contextOrganizationId,
    accessibleNodes,
    edges,
  );
  if (!projection.nodeIds.has(parentInitiativeId)) {
    throw new ConflictError('A hierarchy parent must be visible in the context workspace');
  }
}

/**
 * Validate that adding the edge does not exceed the workspace depth limit.
 * @throws ConflictError if depth would be exceeded
 */
function assertHierarchyDepthAllowed(
  parentInitiativeId: string,
  childInitiativeId: string,
  edges: readonly HierarchyLinkRow[],
  maxDepth: number,
): void {
  const candidateEdges = [
    ...edges,
    {
      parentInitiativeId,
      childInitiativeId,
    },
  ] as HierarchyLinkRow[];
  const depth = initiativeHierarchyDepth(candidateEdges);
  if (depth > maxDepth) {
    throw new ConflictError(
      `Initiative hierarchy exceeds the workspace maximum depth of ${maxDepth}`,
    );
  }
}

/** Validate a hierarchy create or move and return the current context edges. */
export async function validateInitiativeHierarchyChange(
  input: {
    readonly contextOrganizationId: string;
    readonly parentInitiativeId: string;
    readonly childInitiativeId: string;
    readonly session: AuthSession;
    readonly excludeLinkId?: string;
  },
  database: HierarchyDatabase = db,
): Promise<HierarchyLinkRow[]> {
  if (input.parentInitiativeId === input.childInitiativeId) {
    throw new ConflictError('An Initiative cannot be its own parent');
  }

  const [settingsRows, currentEdges] = await Promise.all([
    database
      .select({ initiativeMaxDepth: organization.initiativeMaxDepth })
      .from(organization)
      .where(eq(organization.id, input.contextOrganizationId))
      .limit(1),
    database
      .select()
      .from(initiativeHierarchyLink)
      .where(eq(initiativeHierarchyLink.contextOrganizationId, input.contextOrganizationId)),
  ]);

  const settings = settingsRows[0];
  if (!settings) throw new NotFoundError('Workspace not found');

  const graphNodeIds = [
    ...new Set([
      input.parentInitiativeId,
      input.childInitiativeId,
      ...currentEdges.flatMap((edge) => [edge.parentInitiativeId, edge.childInitiativeId]),
    ]),
  ];

  const nodeRows = await database
    .select({ id: initiative.id, organizationId: initiative.organizationId })
    .from(initiative)
    .where(inArray(initiative.id, graphNodeIds));

  const accessibleNodeIds = await accessibleInitiativeNodeIds(input.session, nodeRows, database);
  const { parent } = await assertInitiativeIdsAccessible(
    input,
    nodeRows,
    accessibleNodeIds,
    database,
  );

  const accessibleNodes = nodeRows.filter((node) => accessibleNodeIds.has(node.id));
  const currentProjection = accessibleInitiativeHierarchyProjection(
    input.contextOrganizationId,
    accessibleNodes,
    currentEdges,
  );

  const visibleCurrentLinkIds = new Set(currentProjection.links.map((edge) => edge.id));
  if (input.excludeLinkId !== undefined && !visibleCurrentLinkIds.has(input.excludeLinkId)) {
    throw new NotFoundError('Initiative hierarchy link not found');
  }

  const edges = currentEdges.filter((edge) => edge.id !== input.excludeLinkId);
  assertChildHasNoExistingParent(
    input.childInitiativeId,
    input.excludeLinkId,
    currentEdges,
    visibleCurrentLinkIds,
  );
  assertParentVisibleInProjection(input.contextOrganizationId, parent.id, edges, accessibleNodes);
  assertHierarchyDepthAllowed(
    input.parentInitiativeId,
    input.childInitiativeId,
    edges,
    settings.initiativeMaxDepth,
  );

  return currentEdges;
}

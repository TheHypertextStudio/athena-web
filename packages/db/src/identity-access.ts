/**
 * `@docket/db/identity-access` — persistence facts for explicit authorization.
 *
 * @remarks
 * This adapter owns Athena's actor, containment, and grant queries. It deliberately returns
 * normalized facts instead of deciding access: callers pass those facts to the pure
 * `@docket/identity-access` evaluator along with the capability and time for their request.
 */
import type { Database } from './client';
import { actor, grant, project, role, task } from './schema';
import type {
  ExplicitGrant,
  GrantPrincipal,
  GrantResourceChain,
  GrantResourceKind,
} from '@docket/identity-access/grants';
import { and, eq, inArray } from 'drizzle-orm';

/** Compatibility name for Identity & Access's explicit-grant resource vocabulary. */
export type ResourceKind = GrantResourceKind;

/** A reference to a containment node (kind + id + owning organization). */
export interface ResourceRef {
  /** The node kind. */
  readonly kind: ResourceKind;
  /** The node id. */
  readonly id: string;
  /** The owning organization id. */
  readonly orgId: string;
}

/** The persistence facts required by the pure explicit-allow evaluator. */
export interface ExplicitAuthorizationFacts {
  /** The actor and authoritative role selected for the authorization decision. */
  readonly principal: GrantPrincipal;
  /** The target-first containment facts for the resource. */
  readonly resourceChain: GrantResourceChain;
  /** The candidate explicit grants for the actor, role, and containment chain. */
  readonly grants: readonly ExplicitGrant[];
}

/** A reason this adapter could not load authorization facts for an actor. */
export type ExplicitAuthorizationFactsDenial =
  'actor_not_found' | 'cross_org' | 'actor_suspended' | 'actor_archived';

/** The result of loading explicit authorization facts from Athena's database. */
export type LoadExplicitAuthorizationFactsResult =
  | { readonly kind: 'ready'; readonly facts: ExplicitAuthorizationFacts }
  | { readonly kind: ExplicitAuthorizationFactsDenial };

function explicitGrantFromRow(row: typeof grant.$inferSelect): ExplicitGrant {
  const {
    organizationId,
    subjectKind,
    subjectId,
    resourceKind,
    resourceId,
    capabilities,
    effect,
    cascades,
    expiresAt,
  } = row;
  return {
    organizationId,
    subjectKind,
    subjectId,
    resourceKind,
    resourceId,
    capabilities,
    effect,
    cascades,
    expiresAt,
  };
}

/**
 * Builds the containment chain for `target`: the target itself, its FK ancestors, and the
 * organization root.
 *
 * @param target - The resource whose explicit grants are being considered.
 * @param db - The database client.
 * @returns the chain from most-specific to the organization root.
 */
export async function ancestorChain(target: ResourceRef, db: Database): Promise<ResourceRef[]> {
  const organizationRoot: ResourceRef = {
    kind: 'organization',
    id: target.orgId,
    orgId: target.orgId,
  };
  if (target.kind === 'organization') return [organizationRoot];

  const chain: ResourceRef[] = [target];

  if (target.kind === 'task') {
    const rows = await db.select().from(task).where(eq(task.id, target.id)).limit(1);
    const taskRow = rows[0];
    if (taskRow) {
      chain.push({ kind: 'team', id: taskRow.teamId, orgId: target.orgId });
      if (taskRow.projectId) {
        chain.push({ kind: 'project', id: taskRow.projectId, orgId: target.orgId });
      }
      if (taskRow.programId) {
        chain.push({ kind: 'program', id: taskRow.programId, orgId: target.orgId });
      }
    }
  } else if (target.kind === 'project') {
    const rows = await db.select().from(project).where(eq(project.id, target.id)).limit(1);
    const projectRow = rows[0];
    if (projectRow) {
      if (projectRow.teamId) {
        chain.push({ kind: 'team', id: projectRow.teamId, orgId: target.orgId });
      }
      if (projectRow.programId) {
        chain.push({ kind: 'program', id: projectRow.programId, orgId: target.orgId });
      }
    }
  }

  chain.push(organizationRoot);
  return chain;
}

/**
 * Loads the actor, containment, and explicit-grant facts needed for a pure authorization decision.
 *
 * @remarks
 * The same-organization role join makes a malformed cross-organization `actor.roleId` inert. This
 * accepts every active actor kind; callers decide separately whether an action permits a human,
 * agent, or team principal. It does not apply grant policy, visibility, or archive policy to the
 * target resource.
 *
 * @param actorId - The acting Actor id.
 * @param target - The resource being acted on.
 * @param db - The database client.
 * @returns denial state or the normalized facts for `evaluateExplicitAllow`.
 */
export async function loadExplicitAuthorizationFacts(
  actorId: string,
  target: ResourceRef,
  db: Database,
): Promise<LoadExplicitAuthorizationFactsResult> {
  const actorRows = await db
    .select({ actor, role })
    .from(actor)
    .leftJoin(role, and(eq(actor.roleId, role.id), eq(actor.organizationId, role.organizationId)))
    .where(eq(actor.id, actorId))
    .limit(1);

  const actorRow = actorRows[0];
  if (!actorRow) return { kind: 'actor_not_found' };
  if (actorRow.actor.organizationId !== target.orgId) return { kind: 'cross_org' };
  if (actorRow.actor.status !== 'active') return { kind: 'actor_suspended' };
  if (actorRow.actor.archivedAt !== null) return { kind: 'actor_archived' };

  const chain = await ancestorChain(target, db);
  const roleId = actorRow.role?.id ?? null;
  const subjectIds = [actorId, roleId].filter((id): id is string => id !== null);
  const resourceIds = chain.map((resource) => resource.id);
  const grantRows = await db
    .select()
    .from(grant)
    .where(
      and(
        eq(grant.organizationId, target.orgId),
        inArray(grant.subjectId, subjectIds),
        inArray(grant.resourceId, resourceIds),
      ),
    );

  const facts: ExplicitAuthorizationFacts = {
    principal: {
      organizationId: actorRow.actor.organizationId,
      actorId,
      roleId,
    },
    resourceChain: {
      organizationId: target.orgId,
      resources: chain.map(({ kind, id }) => ({ kind, id })),
    },
    grants: grantRows.map(explicitGrantFromRow),
  };

  return { kind: 'ready', facts };
}

/**
 * Load explicit authorization facts for many targets with one principal and grant hydration.
 *
 * @param actorId - The acting Actor id shared by every decision.
 * @param targets - Resources to resolve in result order.
 * @param db - The database client.
 * @returns one denial or normalized fact set for each target.
 */
export async function loadExplicitAuthorizationFactsBatch(
  actorId: string,
  targets: readonly ResourceRef[],
  db: Database,
): Promise<LoadExplicitAuthorizationFactsResult[]> {
  if (targets.length === 0) return [];
  const actorRows = await db
    .select({ actor, role })
    .from(actor)
    .leftJoin(role, and(eq(actor.roleId, role.id), eq(actor.organizationId, role.organizationId)))
    .where(eq(actor.id, actorId))
    .limit(1);
  const actorRow = actorRows[0];
  if (!actorRow) return targets.map(() => ({ kind: 'actor_not_found' as const }));
  if (actorRow.actor.status !== 'active') {
    return targets.map(() => ({ kind: 'actor_suspended' as const }));
  }
  if (actorRow.actor.archivedAt !== null) {
    return targets.map(() => ({ kind: 'actor_archived' as const }));
  }

  const localTargets = targets.filter((target) => target.orgId === actorRow.actor.organizationId);
  const taskIds = localTargets
    .filter((target) => target.kind === 'task')
    .map((target) => target.id);
  const projectIds = localTargets
    .filter((target) => target.kind === 'project')
    .map((target) => target.id);
  const taskRows =
    taskIds.length === 0
      ? []
      : await db
          .select({
            id: task.id,
            teamId: task.teamId,
            projectId: task.projectId,
            programId: task.programId,
          })
          .from(task)
          .where(inArray(task.id, taskIds));
  const projectRows =
    projectIds.length === 0
      ? []
      : await db
          .select({ id: project.id, teamId: project.teamId, programId: project.programId })
          .from(project)
          .where(inArray(project.id, projectIds));
  const tasksById = new Map(taskRows.map((row) => [row.id, row]));
  const projectsById = new Map(projectRows.map((row) => [row.id, row]));
  const chains = targets.map((target): ResourceRef[] => {
    const root: ResourceRef = { kind: 'organization', id: target.orgId, orgId: target.orgId };
    if (target.kind === 'organization') return [root];
    const chain: ResourceRef[] = [target];
    if (target.kind === 'task') {
      const row = tasksById.get(target.id);
      if (row) {
        chain.push({ kind: 'team', id: row.teamId, orgId: target.orgId });
        if (row.projectId) chain.push({ kind: 'project', id: row.projectId, orgId: target.orgId });
        if (row.programId) chain.push({ kind: 'program', id: row.programId, orgId: target.orgId });
      }
    } else if (target.kind === 'project') {
      const row = projectsById.get(target.id);
      if (row?.teamId) chain.push({ kind: 'team', id: row.teamId, orgId: target.orgId });
      if (row?.programId) chain.push({ kind: 'program', id: row.programId, orgId: target.orgId });
    }
    chain.push(root);
    return chain;
  });
  const roleId = actorRow.role?.id ?? null;
  const subjectIds = [actorId, roleId].filter((id): id is string => id !== null);
  const resourceIds = [
    ...new Set(
      chains
        .filter((_, index) => targets[index]?.orgId === actorRow.actor.organizationId)
        .flatMap((chain) => chain.map((resource) => resource.id)),
    ),
  ];
  const grantRows =
    resourceIds.length === 0
      ? []
      : await db
          .select()
          .from(grant)
          .where(
            and(
              eq(grant.organizationId, actorRow.actor.organizationId),
              inArray(grant.subjectId, subjectIds),
              inArray(grant.resourceId, resourceIds),
            ),
          );

  return targets.map((target, index) => {
    if (target.orgId !== actorRow.actor.organizationId) return { kind: 'cross_org' as const };
    const chain = chains[index] ?? [];
    const chainIds = new Set(chain.map((resource) => resource.id));
    return {
      kind: 'ready' as const,
      facts: {
        principal: { organizationId: target.orgId, actorId, roleId },
        resourceChain: {
          organizationId: target.orgId,
          resources: chain.map(({ kind, id }) => ({ kind, id })),
        },
        grants: grantRows.filter((row) => chainIds.has(row.resourceId)).map(explicitGrantFromRow),
      },
    };
  });
}

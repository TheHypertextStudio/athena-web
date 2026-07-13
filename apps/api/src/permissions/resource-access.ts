import { type Capability, CAPABILITY_RANK } from '@docket/authz';
import { and, eq, inArray } from 'drizzle-orm';

/** A resource kind whose visibility can be resolved through grants. */
export type GrantableResourceKind =
  | 'organization'
  | 'team'
  | 'initiative'
  | 'program'
  | 'project'
  | 'cycle'
  | 'task';

/** An organization-scoped resource whose access should be resolved. */
export interface ResourceAccessRef {
  /** The organization the caller says owns the resource. */
  readonly organizationId: string;
  /** The resource kind. Unsupported kinds resolve to no access. */
  readonly kind: string;
  /** The resource identifier. */
  readonly id: string;
}

/** The caller's effective read access to one resource. */
export interface ResourceAccessResult {
  /** Whether the caller can view the resource. */
  readonly canView: boolean;
  /** The strongest applicable explicit or public-baseline capability. */
  readonly effectiveCapability: Capability | null;
}

interface CallerOrgAccess {
  readonly organizationId: string;
  readonly actorId: string;
  readonly roleId: string | null;
  readonly isGuest: boolean;
}

interface ResourceFacts {
  readonly organizationId: string;
  readonly visibility: 'public' | 'private';
  readonly chain: readonly { kind: GrantableResourceKind; id: string }[];
}

interface CallerGrant {
  readonly organizationId: string;
  readonly subjectKind: 'actor' | 'role';
  readonly subjectId: string;
  readonly resourceKind: GrantableResourceKind;
  readonly resourceId: string;
  readonly capabilities: readonly Capability[];
  readonly effect: 'allow' | 'deny';
  readonly cascades: boolean;
  readonly expiresAt: Date | null;
}

/**
 * Build the stable key used by batched resource-access results.
 *
 * @param ref - The organization-scoped resource reference.
 * @returns A stable organization, kind, and resource identifier key.
 */
export function resourceAccessKey(ref: ResourceAccessRef): string {
  return `${ref.organizationId}:${ref.kind}:${ref.id}`;
}

/**
 * Resolve view access and the effective capability for a batch of resources.
 *
 * @remarks
 * Only active human memberships participate. Public resources give non-guests a `view`
 * baseline, while actor and same-organization role grants can raise that capability. Private
 * resources and guests require a direct or cascading allow grant.
 *
 * @param userId - The user whose active organization memberships should be resolved.
 * @param refs - Resource references to resolve in one batch.
 * @returns A map containing an entry for every input reference, keyed by
 * {@link resourceAccessKey}.
 */
export async function resolveResourceAccess(
  userId: string,
  refs: readonly ResourceAccessRef[],
): Promise<Map<string, ResourceAccessResult>> {
  const result = new Map<string, ResourceAccessResult>();
  for (const ref of refs) {
    result.set(resourceAccessKey(ref), { canView: false, effectiveCapability: null });
  }
  if (refs.length === 0) return result;

  const organizationIds = [...new Set(refs.map((ref) => ref.organizationId))];
  const accesses = await loadCallerOrgAccess(userId, organizationIds);
  const accessByOrg = new Map(accesses.map((access) => [access.organizationId, access]));
  const [facts, grants] = await Promise.all([loadResourceFacts(refs), loadCallerGrants(accesses)]);

  for (const ref of refs) {
    const key = resourceAccessKey(ref);
    const access = accessByOrg.get(ref.organizationId);
    const fact = facts.get(key);
    if (!access || !fact) continue;

    const baseline: Capability | null =
      fact.visibility === 'public' && !access.isGuest ? 'view' : null;
    const explicit = strongestGrantCapability(fact, grants, access);
    const effectiveCapability = strongestCapability(baseline, explicit);
    result.set(key, {
      canView: effectiveCapability !== null,
      effectiveCapability,
    });
  }

  return result;
}

async function loadCallerOrgAccess(
  userId: string,
  organizationIds: readonly string[],
): Promise<CallerOrgAccess[]> {
  const schema = await import('@docket/db');
  const rows = await schema.db
    .select({
      organizationId: schema.actor.organizationId,
      actorId: schema.actor.id,
      roleId: schema.role.id,
      roleKey: schema.role.key,
      roleDefaultVisibility: schema.role.defaultVisibility,
    })
    .from(schema.actor)
    .leftJoin(
      schema.role,
      and(
        eq(schema.actor.roleId, schema.role.id),
        eq(schema.actor.organizationId, schema.role.organizationId),
      ),
    )
    .where(
      and(
        eq(schema.actor.userId, userId),
        eq(schema.actor.kind, 'human'),
        eq(schema.actor.status, 'active'),
        inArray(schema.actor.organizationId, organizationIds),
      ),
    );
  return rows.map((row) => ({
    organizationId: row.organizationId,
    actorId: row.actorId,
    roleId: row.roleId,
    isGuest: row.roleKey === 'guest' || row.roleDefaultVisibility === 'private',
  }));
}

async function loadResourceFacts(
  refs: readonly ResourceAccessRef[],
): Promise<Map<string, ResourceFacts>> {
  const schema = await import('@docket/db');
  const facts = new Map<string, ResourceFacts>();
  const refsByKind = new Map<string, ResourceAccessRef[]>();
  for (const ref of refs) {
    const bucket = refsByKind.get(ref.kind) ?? [];
    bucket.push(ref);
    refsByKind.set(ref.kind, bucket);
  }

  const taskRefs = refsByKind.get('task') ?? [];
  if (taskRefs.length > 0) {
    const rows = await schema.db
      .select({
        id: schema.task.id,
        organizationId: schema.task.organizationId,
        visibility: schema.task.visibility,
        teamId: schema.task.teamId,
        projectId: schema.task.projectId,
        programId: schema.task.programId,
      })
      .from(schema.task)
      .where(
        inArray(
          schema.task.id,
          taskRefs.map((ref) => ref.id),
        ),
      );
    for (const row of rows) {
      const ref = matchingRef(taskRefs, row.id, row.organizationId);
      if (!ref) continue;
      facts.set(resourceAccessKey(ref), {
        organizationId: row.organizationId,
        visibility: row.visibility,
        chain: [
          { kind: 'task', id: row.id },
          { kind: 'team', id: row.teamId },
          ...(row.projectId ? [{ kind: 'project' as const, id: row.projectId }] : []),
          ...(row.programId ? [{ kind: 'program' as const, id: row.programId }] : []),
          { kind: 'organization', id: row.organizationId },
        ],
      });
    }
  }

  const projectRefs = refsByKind.get('project') ?? [];
  if (projectRefs.length > 0) {
    const rows = await schema.db
      .select({
        id: schema.project.id,
        organizationId: schema.project.organizationId,
        visibility: schema.project.visibility,
        teamId: schema.project.teamId,
        programId: schema.project.programId,
      })
      .from(schema.project)
      .where(
        inArray(
          schema.project.id,
          projectRefs.map((ref) => ref.id),
        ),
      );
    for (const row of rows) {
      const ref = matchingRef(projectRefs, row.id, row.organizationId);
      if (!ref) continue;
      facts.set(resourceAccessKey(ref), {
        organizationId: row.organizationId,
        visibility: row.visibility,
        chain: [
          { kind: 'project', id: row.id },
          ...(row.teamId ? [{ kind: 'team' as const, id: row.teamId }] : []),
          ...(row.programId ? [{ kind: 'program' as const, id: row.programId }] : []),
          { kind: 'organization', id: row.organizationId },
        ],
      });
    }
  }

  const programRefs = refsByKind.get('program') ?? [];
  if (programRefs.length > 0) {
    const rows = await schema.db
      .select({
        id: schema.program.id,
        organizationId: schema.program.organizationId,
        visibility: schema.program.visibility,
      })
      .from(schema.program)
      .where(
        inArray(
          schema.program.id,
          programRefs.map((ref) => ref.id),
        ),
      );
    for (const row of rows) {
      const ref = matchingRef(programRefs, row.id, row.organizationId);
      if (!ref) continue;
      facts.set(resourceAccessKey(ref), {
        organizationId: row.organizationId,
        visibility: row.visibility,
        chain: [
          { kind: 'program', id: row.id },
          { kind: 'organization', id: row.organizationId },
        ],
      });
    }
  }

  const initiativeRefs = refsByKind.get('initiative') ?? [];
  if (initiativeRefs.length > 0) {
    const rows = await schema.db
      .select({
        id: schema.initiative.id,
        organizationId: schema.initiative.organizationId,
      })
      .from(schema.initiative)
      .where(
        inArray(
          schema.initiative.id,
          initiativeRefs.map((ref) => ref.id),
        ),
      );
    for (const row of rows) {
      const ref = matchingRef(initiativeRefs, row.id, row.organizationId);
      if (!ref) continue;
      facts.set(resourceAccessKey(ref), {
        organizationId: row.organizationId,
        visibility: 'public',
        chain: [
          { kind: 'initiative', id: row.id },
          { kind: 'organization', id: row.organizationId },
        ],
      });
    }
  }

  const teamRefs = refsByKind.get('team') ?? [];
  if (teamRefs.length > 0) {
    const rows = await schema.db
      .select({
        id: schema.team.id,
        organizationId: schema.team.organizationId,
        visibility: schema.team.visibility,
      })
      .from(schema.team)
      .where(
        inArray(
          schema.team.id,
          teamRefs.map((ref) => ref.id),
        ),
      );
    for (const row of rows) {
      const ref = matchingRef(teamRefs, row.id, row.organizationId);
      if (!ref) continue;
      facts.set(resourceAccessKey(ref), {
        organizationId: row.organizationId,
        visibility: row.visibility,
        chain: [
          { kind: 'team', id: row.id },
          { kind: 'organization', id: row.organizationId },
        ],
      });
    }
  }

  const cycleRefs = refsByKind.get('cycle') ?? [];
  if (cycleRefs.length > 0) {
    const rows = await schema.db
      .select({
        id: schema.cycle.id,
        organizationId: schema.cycle.organizationId,
        teamId: schema.cycle.teamId,
      })
      .from(schema.cycle)
      .where(
        inArray(
          schema.cycle.id,
          cycleRefs.map((ref) => ref.id),
        ),
      );
    for (const row of rows) {
      const ref = matchingRef(cycleRefs, row.id, row.organizationId);
      if (!ref) continue;
      facts.set(resourceAccessKey(ref), {
        organizationId: row.organizationId,
        visibility: 'public',
        chain: [
          { kind: 'cycle', id: row.id },
          { kind: 'team', id: row.teamId },
          { kind: 'organization', id: row.organizationId },
        ],
      });
    }
  }

  const orgRefs = refsByKind.get('organization') ?? [];
  if (orgRefs.length > 0) {
    const rows = await schema.db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(
        inArray(
          schema.organization.id,
          orgRefs.map((ref) => ref.id),
        ),
      );
    for (const row of rows) {
      const ref = orgRefs.find(
        (candidate) => candidate.id === row.id && candidate.organizationId === row.id,
      );
      if (!ref) continue;
      facts.set(resourceAccessKey(ref), {
        organizationId: row.id,
        visibility: 'public',
        chain: [{ kind: 'organization', id: row.id }],
      });
    }
  }

  return facts;
}

function matchingRef(
  refs: readonly ResourceAccessRef[],
  id: string,
  organizationId: string,
): ResourceAccessRef | undefined {
  return refs.find(
    (candidate) => candidate.id === id && candidate.organizationId === organizationId,
  );
}

async function loadCallerGrants(accesses: readonly CallerOrgAccess[]): Promise<CallerGrant[]> {
  if (accesses.length === 0) return [];
  const schema = await import('@docket/db');
  const organizationIds = [...new Set(accesses.map((access) => access.organizationId))];
  const subjectIds = [
    ...new Set(
      accesses.flatMap((access) =>
        [access.actorId, access.roleId].filter((id): id is string => Boolean(id)),
      ),
    ),
  ];
  if (subjectIds.length === 0) return [];
  return schema.db
    .select({
      organizationId: schema.grant.organizationId,
      subjectKind: schema.grant.subjectKind,
      subjectId: schema.grant.subjectId,
      resourceKind: schema.grant.resourceKind,
      resourceId: schema.grant.resourceId,
      capabilities: schema.grant.capabilities,
      effect: schema.grant.effect,
      cascades: schema.grant.cascades,
      expiresAt: schema.grant.expiresAt,
    })
    .from(schema.grant)
    .where(
      and(
        inArray(schema.grant.organizationId, organizationIds),
        inArray(schema.grant.subjectId, subjectIds),
      ),
    );
}

function strongestGrantCapability(
  fact: ResourceFacts,
  grants: readonly CallerGrant[],
  access: CallerOrgAccess,
): Capability | null {
  const now = Date.now();
  let best: Capability | null = null;

  for (const grant of grants) {
    if (grant.organizationId !== fact.organizationId) continue;
    if (!grantMatchesCaller(grant, access)) continue;
    if (grant.effect !== 'allow') continue;
    if (grant.expiresAt && grant.expiresAt.getTime() < now) continue;

    const resourceIndex = fact.chain.findIndex(
      (resource) => resource.kind === grant.resourceKind && resource.id === grant.resourceId,
    );
    if (resourceIndex < 0 || (resourceIndex > 0 && !grant.cascades)) continue;

    for (const capability of grant.capabilities) {
      best = strongestCapability(best, capability);
    }
  }

  return best;
}

function grantMatchesCaller(grant: CallerGrant, access: CallerOrgAccess): boolean {
  if (grant.subjectKind === 'actor') return grant.subjectId === access.actorId;
  return access.roleId !== null && grant.subjectId === access.roleId;
}

function strongestCapability(left: Capability | null, right: Capability | null): Capability | null {
  if (left === null) return right;
  if (right === null) return left;
  return CAPABILITY_RANK[right] > CAPABILITY_RANK[left] ? right : left;
}

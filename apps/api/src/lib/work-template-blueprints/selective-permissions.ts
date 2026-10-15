import { actor, grant, role } from '@docket/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { ActorCtx } from '../../context';
import type { TemplateTransaction } from '../templates/persistence';
import type { AuthorizedBlueprintSnapshot } from './snapshot-types';

/** Bind review to live membership and grants on actual containment, team and cycle scopes. */
export async function selectivePermissionFacts(
  tx: TemplateTransaction,
  caller: ActorCtx,
  snapshot: AuthorizedBlueprintSnapshot,
): Promise<unknown> {
  const [membership] = await tx
    .select({ actor, role })
    .from(actor)
    .leftJoin(role, and(eq(role.id, actor.roleId), eq(role.organizationId, caller.orgId)))
    .where(and(eq(actor.id, caller.actorId), eq(actor.organizationId, caller.orgId)))
    .limit(1);
  const resources = new Set([caller.orgId]);
  for (const work of snapshot.rowsByRef.values()) {
    resources.add(work.id);
    for (const key of [
      'programId',
      'projectId',
      'milestoneId',
      'parentTaskId',
      'teamId',
      'leadTeamId',
      'cycleId',
    ]) {
      const value = Reflect.get(work.row, key) as unknown;
      if (typeof value === 'string') resources.add(value);
    }
  }
  const subjects = [caller.actorId, membership?.actor.roleId].filter((id): id is string => !!id);
  const grants = await tx
    .select()
    .from(grant)
    .where(
      and(
        eq(grant.organizationId, caller.orgId),
        inArray(grant.subjectId, subjects),
        inArray(grant.resourceId, [...resources]),
      ),
    )
    .orderBy(asc(grant.id));
  return { membership, grants };
}

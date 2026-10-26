/** Shared visibility for graph data and metadata added to existing MCP cards. */
import { actor, db, role } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { resolveResourceAccessForActors, resourceAccessKey } from '../permissions/resource-access';
import type { McpActor } from '../mcp/auth';
import type { GraphWork } from './contract';

/** Return authorized container keys for the live actor, including public-baseline and grant access. */
export async function graphViewableKeys(
  actorContext: McpActor,
  nodes: readonly Pick<GraphWork, 'id' | 'kind'>[],
): Promise<Set<string>> {
  const { orgId, actorId } = actorContext;
  const [caller] = await db
    .select({
      id: actor.id,
      roleId: actor.roleId,
      roleKey: role.key,
      visibility: role.defaultVisibility,
    })
    .from(actor)
    .leftJoin(role, and(eq(actor.roleId, role.id), eq(role.organizationId, orgId)))
    .where(
      and(
        eq(actor.id, actorId),
        eq(actor.organizationId, orgId),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    );
  if (!caller) return new Set<string>();
  const refs = nodes
    .filter((n) => n.kind !== 'task')
    .map((n) => ({ organizationId: orgId, kind: n.kind, id: n.id }));
  const access = await resolveResourceAccessForActors(
    [
      {
        organizationId: orgId,
        actorId,
        roleId: caller.roleId,
        isGuest: caller.roleKey === 'guest' || caller.visibility === 'private',
      },
    ],
    refs,
  );
  return new Set(
    refs
      .filter((ref) => access.get(resourceAccessKey(ref))?.canView)
      .map((ref) => `${ref.kind}:${ref.id}`),
  );
}

import { actorAlias, db } from '@docket/db';
import { and, eq } from 'drizzle-orm';

/** Resolve an old person ID without changing historical references. */
export async function resolvePersonAlias(orgId: string, actorId: string): Promise<string> {
  const [alias] = await db
    .select()
    .from(actorAlias)
    .where(and(eq(actorAlias.organizationId, orgId), eq(actorAlias.actorId, actorId)))
    .limit(1);
  return alias?.canonicalActorId ?? actorId;
}

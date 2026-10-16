/** Persisted authorization fixtures for template-backed Program creation. */
import type * as DbModule from '@docket/db';
import { seedMcpUpdateOrg } from './mcp-update-tool-fixtures';

/** Keep the ordinary contributor role and authorize Program creation through a real grant. */
export async function seedMcpTemplateManager(
  db: typeof DbModule.db,
  schema: typeof DbModule,
): Promise<Awaited<ReturnType<typeof seedMcpUpdateOrg>>> {
  const seed = await seedMcpUpdateOrg(db, schema, ['view', 'contribute']);
  await db.insert(schema.grant).values({
    organizationId: seed.orgId,
    subjectKind: 'actor',
    subjectId: seed.actorId,
    resourceKind: 'organization',
    resourceId: seed.orgId,
    capabilities: ['manage'],
    effect: 'allow',
  });
  return seed;
}

import { db, externalResource } from '@docket/db';
import { canonicalizeResourceUrl } from '@docket/connections/resource-contract';
import { and, eq, isNull } from 'drizzle-orm';
import { invalidResourceField } from './resource-validation';
import type { ResourceMaterial } from './resource-write-input';

/** Resolve a readable URL pointer to the existing workspace-canonical Library identity. */
export async function linkedResourceMaterial(
  orgId: string,
  actorId: string,
  url: string,
  title: string,
): Promise<ResourceMaterial> {
  const canonical = canonicalizeResourceUrl(url);
  if (!canonical) invalidResourceField('url');
  await db
    .insert(externalResource)
    .values({
      organizationId: orgId,
      createdBy: actorId,
      provider: canonical.provider,
      canonicalKey: canonical.canonicalKey,
      canonicalUrl: canonical.canonicalUrl,
      externalId: canonical.externalId,
      resourceType: canonical.resourceType,
    })
    .onConflictDoNothing();
  const [row] = await db
    .select()
    .from(externalResource)
    .where(
      and(
        eq(externalResource.organizationId, orgId),
        eq(externalResource.canonicalKey, canonical.canonicalKey),
        isNull(externalResource.archivedAt),
      ),
    )
    .limit(1);
  if (!row) invalidResourceField('url');
  return {
    kind: 'url',
    title,
    url: row.canonicalUrl,
    externalResourceId: row.id,
    disposition: 'linked',
  };
}

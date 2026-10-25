import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';

/** Read only authored non-base drafts for an isolated test workspace. */
export async function templates(schema: typeof DbModule, orgId: string) {
  return schema.db
    .select()
    .from(schema.template)
    .where(
      and(
        eq(schema.template.organizationId, orgId),
        eq(schema.template.isSeed, false),
        eq(schema.template.isBase, false),
      ),
    );
}
/** Read publications belonging only to authored non-base definitions. */
export async function publications(schema: typeof DbModule, orgId: string) {
  return schema.db
    .select()
    .from(schema.workTypeVersion)
    .innerJoin(schema.template, eq(schema.template.id, schema.workTypeVersion.workTypeId))
    .where(
      and(
        eq(schema.template.organizationId, orgId),
        eq(schema.template.isSeed, false),
        eq(schema.template.isBase, false),
      ),
    );
}

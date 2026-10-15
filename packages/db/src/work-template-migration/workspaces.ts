import { and, eq, isNotNull, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { organization, template } from './schema';
import { provisionMigrationBases } from './bases';
import type { WorkTemplateBackfillObserver } from '../work-template-backfill';

/** Provision missing bases in bounded, individually atomic workspace transactions. */
export async function provisionTemplateWorkspaces(
  database: Database,
  batchSize: number,
  committed: WorkTemplateBackfillObserver,
): Promise<void> {
  for (;;) {
    const missing = await database
      .select({ id: organization.id })
      .from(organization)
      .leftJoin(
        template,
        and(
          eq(template.organizationId, organization.id),
          eq(template.isBase, true),
          isNotNull(template.latestPublishedVersionId),
        ),
      )
      .groupBy(organization.id)
      .having(sql`count(${template.id}) < 4`)
      .orderBy(organization.id)
      .limit(batchSize);
    if (missing.length === 0) return;
    for (const workspace of missing)
      await database.transaction((transaction) =>
        provisionMigrationBases(transaction, workspace.id),
      );
    await committed({ phase: 'workspaces', count: missing.length });
  }
}

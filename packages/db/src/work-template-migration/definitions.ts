import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { and, eq, getTableColumns, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { genId } from '../id';
import { template, workTypeVersion } from './schema';
import type { WorkTemplateBackfillObserver } from '../work-template-backfill';

/** Convert pending legacy definitions in committed batches without widening private/team access. */
export async function backfillTemplateDefinitions(
  database: Database,
  batchSize: number,
  committed: WorkTemplateBackfillObserver,
): Promise<void> {
  for (;;) {
    const count = await database.transaction(async (transaction) => {
      const rows = await transaction
        .select({
          ...getTableColumns(template),
          draftDefinition: sql<WorkTemplateDefinition | null>`${template.draftDefinition}`,
        })
        .from(template)
        .where(eq(template.publicationState, 'legacy_pending'))
        .orderBy(template.id)
        .limit(batchSize)
        .for('update', { skipLocked: true });
      for (const row of rows) {
        const definition = WorkTemplateDefinition.parse({
          name: row.name,
          description: row.description,
          icon: row.icon,
          payload: row.payload,
          defaultStatusKey: row.draftDefinition?.defaultStatusKey ?? null,
        });
        if (definition.payload.targetType !== row.targetType)
          throw new Error(`Legacy template kind mismatch: ${row.id}`);
        let versionId: string | null = null;
        if (row.scope === 'organization') {
          versionId = genId();
          await transaction.insert(workTypeVersion).values({
            id: versionId,
            organizationId: row.organizationId,
            workTypeId: row.id,
            number: 1,
            definition,
            publishedByActorId: row.createdBy,
          });
        }
        const publicationState = row.archivedAt ? 'archived' : versionId ? 'published' : 'draft';
        await transaction
          .update(template)
          .set({
            draftDefinition: definition,
            publicationState,
            latestPublishedVersionId: versionId,
          })
          .where(and(eq(template.id, row.id), eq(template.organizationId, row.organizationId)));
      }
      return rows.length;
    });
    if (count === 0) return;
    await committed({ phase: 'definitions', count });
  }
}

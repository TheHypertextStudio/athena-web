import type { TemplateTargetType } from '@docket/work/template-contract';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { initiative, program, project, task, template } from './schema';
import { provisionMigrationBases, type MigrationBases, type MigrationConnection } from './bases';
import type { WorkTemplateBackfillObserver } from '../work-template-backfill';

const TABLES = { initiative, program, project, task } as const;

interface RetainedWork {
  readonly id: string;
  readonly organizationId: string;
  readonly workTypeId: string | null;
  readonly workTypeVersionId: string | null;
  readonly legacyTemplateId: string | null;
}

async function retainedIdentity(
  connection: MigrationConnection,
  row: RetainedWork,
  kind: TemplateTargetType,
) {
  const explicit = row.workTypeId;
  if (row.workTypeVersionId !== null && explicit === null)
    throw new Error(`Work-template version is missing its definition: ${row.id}`);
  const selected = explicit ?? (kind === 'task' ? row.legacyTemplateId : null);
  if (selected) {
    const [definition] = await connection
      .select({ id: template.id, versionId: template.latestPublishedVersionId })
      .from(template)
      .where(
        and(
          eq(template.id, selected),
          eq(template.organizationId, row.organizationId),
          eq(template.targetType, kind),
          eq(template.scope, 'organization'),
          inArray(template.publicationState, ['published', 'archived']),
          isNotNull(template.latestPublishedVersionId),
        ),
      )
      .limit(1);
    if (definition?.versionId)
      return { workTypeId: definition.id, workTypeVersionId: definition.versionId };
    if (explicit)
      throw new Error(`Incomplete work-template selection cannot be backfilled: ${row.id}`);
  }
  return null;
}

/** Backfill one kind without regenerating its body, children, dates, or original legacy pointer. */
export async function backfillTemplateWork(
  database: Database,
  kind: TemplateTargetType,
  batchSize: number,
  committed: WorkTemplateBackfillObserver,
): Promise<void> {
  const table = TABLES[kind];
  for (;;) {
    const count = await database.transaction(async (transaction) => {
      const rows: RetainedWork[] = await transaction
        .select({
          id: table.id,
          organizationId: table.organizationId,
          workTypeId: sql<string | null>`${table.workTypeId}`,
          workTypeVersionId: sql<string | null>`${table.workTypeVersionId}`,
          legacyTemplateId: kind === 'task' ? task.templateId : sql<string | null>`NULL`,
        })
        .from(table)
        .where(or(isNull(table.workTypeId), isNull(table.workTypeVersionId)))
        .orderBy(table.id)
        .limit(batchSize)
        .for('update', { skipLocked: true });
      const bases = new Map<string, MigrationBases>();
      for (const row of rows) {
        let identity = await retainedIdentity(transaction, row, kind);
        if (!identity) {
          let workspace = bases.get(row.organizationId);
          if (!workspace) {
            workspace = await provisionMigrationBases(transaction, row.organizationId);
            bases.set(row.organizationId, workspace);
          }
          identity = workspace.get(kind) ?? null;
        }
        if (!identity) throw new Error('A required base template is missing.');
        await transaction
          .update(table)
          .set({
            ...identity,
            workTypeAssignedAt: new Date(),
            workTypeAssignmentSource: 'migration_baseline',
          })
          .where(and(eq(table.id, row.id), eq(table.organizationId, row.organizationId)));
      }
      return rows.length;
    });
    if (count === 0) return;
    await committed({ phase: kind, count });
  }
}

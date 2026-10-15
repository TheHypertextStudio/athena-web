import { db, initiative, organization, template, type Database } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import { NotFoundError, ValidationError } from '../../error';
import { visibleTemplateWhere } from '../templates/visibility';

/** Validate and deduplicate the ordinary Project's Initiative associations on its transaction. */
export async function validatedInitiativeIds(
  orgId: string,
  ids: readonly string[] | undefined,
  database: Database = db,
): Promise<string[]> {
  const unique = [...new Set(ids ?? [])];
  if (!unique.length) return [];
  const rows = await database
    .select({ id: initiative.id })
    .from(initiative)
    .where(and(inArray(initiative.id, unique), eq(initiative.organizationId, orgId)));
  const found = new Set(rows.map((row) => row.id));
  for (const id of unique) if (!found.has(id)) throw new NotFoundError('Initiative not found');
  return unique;
}

/** Preserve the legacy Task template visibility/kind guard through either pool or transaction. */
export async function assertTaskTemplate(
  orgId: string,
  actorId: string,
  templateId: string | null | undefined,
  database: Database = db,
): Promise<void> {
  if (templateId === null || templateId === undefined) return;
  const [row] = await database
    .select({ targetType: template.targetType })
    .from(template)
    .where(visibleTemplateWhere(orgId, actorId, { id: templateId }))
    .limit(1);
  if (!row) throw new NotFoundError('Template not found');
  if (row.targetType !== 'task')
    throw new ValidationError([{ message: 'Template must create tasks', path: ['templateId'] }]);
}

/** Read the fiscal calendar used by existing broad Project and Initiative date semantics. */
export async function creationFiscalMonth(orgId: string, database: Database): Promise<number> {
  const [row] = await database
    .select({ month: organization.fiscalYearStartMonth })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  if (!row) throw new NotFoundError('Organization not found');
  return row.month;
}

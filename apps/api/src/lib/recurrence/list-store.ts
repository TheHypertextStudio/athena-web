/** Cursor-backed reads shared by process-definition and recurrence-series services. */
import { processDefinition, recurrenceSeries, type Database } from '@docket/db';
import { and, asc, eq, isNull, ne } from 'drizzle-orm';

import { seekAfterId } from '../list-cursor';

interface ListPage {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

/** Read one page of active process definitions. */
export async function listActiveProcessDefinitionRows(
  database: Database,
  organizationId: string,
  page: ListPage,
): Promise<(typeof processDefinition.$inferSelect)[]> {
  return database
    .select()
    .from(processDefinition)
    .where(
      and(
        eq(processDefinition.organizationId, organizationId),
        isNull(processDefinition.archivedAt),
        ne(processDefinition.status, 'archived'),
        seekAfterId(processDefinition.id, page.cursor, 'asc'),
      ),
    )
    .orderBy(asc(processDefinition.id))
    .limit(page.limit + 1);
}

/** Read one page of active recurrence-series identifiers. */
export async function listRecurrenceSeriesIds(
  database: Database,
  organizationId: string,
  page: ListPage,
): Promise<{ id: string }[]> {
  return database
    .select({ id: recurrenceSeries.id })
    .from(recurrenceSeries)
    .where(
      and(
        eq(recurrenceSeries.organizationId, organizationId),
        isNull(recurrenceSeries.archivedAt),
        seekAfterId(recurrenceSeries.id, page.cursor, 'asc'),
      ),
    )
    .orderBy(asc(recurrenceSeries.id))
    .limit(page.limit + 1);
}

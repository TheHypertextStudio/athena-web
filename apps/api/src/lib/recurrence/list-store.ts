/** Cursor-backed reads shared by process-definition and recurrence-series services. */
import { processDefinition, recurrenceSeries, invocationHead, type Database } from '@docket/db';
import { and, asc, eq, isNull, isNotNull, ne } from 'drizzle-orm';

import { encodeIdCursor, seekAfterId } from '../list-cursor';
import { canonicalDefinitionHead } from './canonical-definition';
import { NotFoundError } from '../../error';
import { requireLegacyActor, requireLegacyDefinitionAccess } from './legacy-definition-access';
import { canonicalAliasReferencesEnforced } from './private-alias-references';

interface ListPage {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

/** Fill a page using only live-authorized private definitions, before reading their prose. */
export async function listActiveProcessDefinitionRows(
  database: Database,
  organizationId: string,
  actorId: string | undefined,
  page: ListPage,
): Promise<(typeof processDefinition.$inferSelect)[]> {
  requireLegacyActor(actorId);
  const visible: (typeof processDefinition.$inferSelect)[] = [];
  let cursor = page.cursor;
  while (visible.length <= page.limit) {
    const ids = await activeDefinitionIds(database, organizationId, cursor);
    for (const { id } of ids) {
      const row = await visibleDefinition(database, { organizationId, actorId, definitionId: id });
      if (row) visible.push(row);
      if (visible.length > page.limit) break;
    }
    const last = ids.at(-1);
    if (ids.length < 100 || !last || visible.length > page.limit) break;
    cursor = encodeIdCursor(last.id);
  }
  return visible;
}
async function visibleDefinition(
  database: Database,
  identity: {
    readonly organizationId: string;
    readonly actorId: string | undefined;
    readonly definitionId: string;
  },
): Promise<typeof processDefinition.$inferSelect | undefined> {
  try {
    await requireLegacyDefinitionAccess(database, identity);
    const head = await canonicalDefinitionHead(database, identity);
    if (head) return head;
    const [row] = await database
      .select()
      .from(processDefinition)
      .where(
        and(
          eq(processDefinition.organizationId, identity.organizationId),
          eq(processDefinition.id, identity.definitionId),
        ),
      )
      .limit(1);
    return row;
  } catch (error) {
    if (error instanceof NotFoundError) return undefined;
    throw error;
  }
}
async function activeDefinitionIds(
  database: Database,
  organizationId: string,
  cursor: string | undefined,
): Promise<{ id: string }[]> {
  const canonical = activeCanonicalDefinitionIds(database, organizationId, cursor);
  if (await canonicalAliasReferencesEnforced(database)) return canonical;
  // Each ordered branch contributes at most one page. Selecting the first page of
  // their merge preserves the shared identifier cursor even when hidden rows are
  // skipped by the caller. Canonical ownership excludes the old source branch.
  const [retained, canonicalIds] = await Promise.all([
    activeRetainedDefinitionIds(database, organizationId, cursor),
    canonical,
  ]);
  return [...retained, ...canonicalIds].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 100);
}
function activeCanonicalDefinitionIds(
  database: Database,
  organizationId: string,
  cursor: string | undefined,
) {
  return database
    .select({ id: invocationHead.id })
    .from(invocationHead)
    .where(
      and(
        eq(invocationHead.organizationId, organizationId),
        isNotNull(invocationHead.canonicalAuthoringAt),
        isNull(invocationHead.archivedAt),
        ne(invocationHead.status, 'archived'),
        seekAfterId(invocationHead.id, cursor, 'asc'),
      ),
    )
    .orderBy(asc(invocationHead.id))
    .limit(100);
}
async function activeRetainedDefinitionIds(
  database: Database,
  organizationId: string,
  cursor: string | undefined,
): Promise<{ id: string }[]> {
  return database
    .select({ id: processDefinition.id })
    .from(processDefinition)
    .leftJoin(
      invocationHead,
      and(
        eq(invocationHead.id, processDefinition.id),
        eq(invocationHead.organizationId, processDefinition.organizationId),
      ),
    )
    .where(
      and(
        eq(processDefinition.organizationId, organizationId),
        isNull(invocationHead.canonicalAuthoringAt),
        isNull(processDefinition.archivedAt),
        ne(processDefinition.status, 'archived'),
        seekAfterId(processDefinition.id, cursor, 'asc'),
      ),
    )
    .orderBy(asc(processDefinition.id))
    .limit(100);
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

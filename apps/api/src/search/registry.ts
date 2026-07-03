import { eq } from 'drizzle-orm';

import { activitySearchProjectors } from './projectors/activity';
import { calendarSearchProjectors } from './projectors/calendar';
import { contentSearchProjectors } from './projectors/content';
import { peopleSearchProjectors } from './projectors/people';
import { workSearchProjectors } from './projectors/work';
import type { SearchDocumentDraft, SearchProjector } from './types';

/** All source-table projectors that can materialize semantic search documents. */
export const searchProjectors: readonly SearchProjector[] = [
  ...peopleSearchProjectors,
  ...workSearchProjectors,
  ...contentSearchProjectors,
  ...calendarSearchProjectors,
  ...activitySearchProjectors,
];

const projectorsBySourceTable = new Map(searchProjectors.map((p) => [p.sourceTable, p]));

/** Lookup a projector by source table, throwing for programmer/configuration errors. */
export function getSearchProjector(sourceTable: string): SearchProjector {
  const projector = projectorsBySourceTable.get(sourceTable);
  if (!projector) throw new Error(`No search projector registered for ${sourceTable}`);
  return projector;
}

/** Project an already-loaded row; used by unit tests and future write-through paths. */
export async function projectPreloadedSearchDocument(
  sourceTable: string,
  row: unknown,
): Promise<SearchDocumentDraft | null> {
  return getSearchProjector(sourceTable).project({
    entityId: typeof row === 'object' && row && 'id' in row ? String(row.id) : '',
    row,
  });
}

/** Fetch one source row by id and project it through the registered projector. */
export async function projectSearchDocumentFromSource(
  sourceTable: string,
  entityId: string,
): Promise<SearchDocumentDraft | null> {
  const row = await fetchSearchSourceRow(sourceTable, entityId);
  if (!row) return null;
  return projectPreloadedSearchDocument(sourceTable, row);
}

/** Fetch source rows for backfill. */
export async function listSearchSourceRows(
  sourceTable: string,
  limit: number,
): Promise<readonly unknown[]> {
  const { db, table } = await resolveSourceTable(sourceTable);
  return db.select().from(table).limit(limit);
}

async function fetchSearchSourceRow(sourceTable: string, entityId: string) {
  const schema = await import('@docket/db');
  const { db, table } = await resolveSourceTable(sourceTable);
  const rows = await db.select().from(table).where(eq(table.id, entityId)).limit(1);
  const row = rows[0] ?? null;
  if (!row) return null;
  if (sourceTable !== 'task') return row;
  const labelRows = await db
    .select({ labelId: schema.taskLabel.labelId })
    .from(schema.taskLabel)
    .where(eq(schema.taskLabel.taskId, entityId));
  return { ...row, labelIds: labelRows.map((labelRow) => labelRow.labelId) };
}

async function resolveSourceTable(sourceTable: string) {
  const schema = await import('@docket/db');
  const tables = {
    organization: schema.organization,
    team: schema.team,
    actor: schema.actor,
    agent: schema.agent,
    agent_session: schema.agentSession,
    task: schema.task,
    project: schema.project,
    program: schema.program,
    initiative: schema.initiative,
    milestone: schema.milestone,
    cycle: schema.cycle,
    label: schema.label,
    saved_view: schema.savedView,
    comment: schema.comment,
    update: schema.update,
    attachment: schema.attachment,
    calendar_event: schema.calendarEvent,
    event: schema.event,
  } as const;
  if (!(sourceTable in tables))
    throw new Error(`No search projector registered for ${sourceTable}`);
  const table = tables[sourceTable as keyof typeof tables];
  return { db: schema.db, table };
}

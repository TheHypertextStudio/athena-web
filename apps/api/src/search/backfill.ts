import { listSearchSourceRows } from './registry';
import { enqueueSearchIndexJob } from './enqueue';

const DEFAULT_SOURCE_TABLES = [
  'organization',
  'team',
  'actor',
  'agent',
  'agent_session',
  'task',
  'project',
  'program',
  'initiative',
  'milestone',
  'cycle',
  'label',
  'saved_view',
  'comment',
  'update',
  'attachment',
  'calendar_event',
  'event',
] as const;

export interface BackfillSearchIndexOptions {
  sourceTables?: readonly string[];
  limit?: number;
}

export interface BackfillSearchIndexResult {
  scanned: number;
  enqueued: number;
}

/** Enqueue search jobs by scanning source tables. */
export async function backfillSearchIndex(
  options: BackfillSearchIndexOptions = {},
): Promise<BackfillSearchIndexResult> {
  const sourceTables = options.sourceTables ?? DEFAULT_SOURCE_TABLES;
  const limit = options.limit ?? 500;
  let scanned = 0;
  let enqueued = 0;

  for (const sourceTable of sourceTables) {
    const rows = await listSearchSourceRows(sourceTable, limit);
    scanned += rows.length;
    for (const row of rows) {
      if (!isRowWithId(row)) continue;
      await enqueueSearchIndexJob({
        organizationId: typeof row.organizationId === 'string' ? row.organizationId : null,
        userId: typeof row.userId === 'string' ? row.userId : null,
        sourceTable,
        entityId: row.id,
        operation: 'upsert',
        reason: 'backfill',
      });
      enqueued += 1;
    }
  }

  return { scanned, enqueued };
}

function isRowWithId(
  row: unknown,
): row is { id: string; organizationId?: unknown; userId?: unknown } {
  return typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'string';
}

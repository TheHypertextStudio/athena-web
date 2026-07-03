import { and, desc, eq, gt, inArray } from 'drizzle-orm';

import { enqueueSearchIndexJob } from './enqueue';
import { eventSearchReindexTarget } from './event-log';
import { listSearchSourceRows } from './registry';

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
  /** Opaque resume cursor returned by a previous paged scan. */
  cursor?: string;
}

export interface BackfillSearchIndexResult {
  scanned: number;
  enqueued: number;
  /** Opaque cursor for the next source-table page, omitted when the scan is exhausted. */
  nextCursor?: string;
}

/** Options for a freshness-aware workspace-search repair sweep. */
export interface RepairSearchIndexOptions {
  /** Source tables to inspect; defaults to every registered searchable source. */
  sourceTables?: readonly string[];
  /** Maximum source rows to scan per table, and maximum newer event rows to reconcile. */
  limit?: number;
}

/** Counts returned by a workspace-search repair sweep. */
export interface RepairSearchIndexResult {
  /** Source rows inspected for stale/missing projections. */
  scanned: number;
  /** Repair jobs requested; active-job dedupe may collapse repeated calls. */
  enqueued: number;
}

/** Enqueue search jobs by scanning source tables. */
export async function backfillSearchIndex(
  options: BackfillSearchIndexOptions = {},
): Promise<BackfillSearchIndexResult> {
  const sourceTables = options.sourceTables ?? DEFAULT_SOURCE_TABLES;
  const limit = options.limit ?? 500;
  const cursor = decodeSourceScanCursor(options.cursor);
  const startIndex = Math.min(cursor?.sourceTableIndex ?? 0, sourceTables.length);
  let scanned = 0;
  let enqueued = 0;
  let nextCursor: string | undefined;

  for (let index = startIndex; index < sourceTables.length; index += 1) {
    const sourceTable = sourceTables[index];
    if (!sourceTable) break;
    const afterId = index === cursor?.sourceTableIndex ? cursor.rowId : null;
    const rows = await listSearchSourceRows(sourceTable, limit, afterId);
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
    const lastRow = [...rows].reverse().find(isRowWithId);
    if (rows.length >= limit && lastRow) {
      nextCursor = encodeSourceScanCursor({ sourceTableIndex: index, rowId: lastRow.id });
      break;
    }
  }

  return { scanned, enqueued, ...(nextCursor ? { nextCursor } : {}) };
}

/**
 * Enqueue repair jobs for stale search documents and event-log rows not yet projected.
 *
 * @remarks
 * Backfill is intentionally broad and enqueue-only; repair is freshness-aware. It compares
 * source-row freshness to the current `search_document` projection and separately reconciles
 * canonical events newer than the newest indexed activity row, including the Docket entity an
 * event points at when one exists.
 */
export async function repairSearchIndex(
  options: RepairSearchIndexOptions = {},
): Promise<RepairSearchIndexResult> {
  const sourceTables = options.sourceTables ?? DEFAULT_SOURCE_TABLES;
  const limit = options.limit ?? 500;
  let scanned = 0;
  let enqueued = 0;

  for (const sourceTable of sourceTables) {
    if (sourceTable === 'event') continue;
    const rows = await listSearchSourceRows(sourceTable, limit);
    scanned += rows.length;
    enqueued += await enqueueStaleRows(sourceTable, rows);
  }

  if (sourceTables.includes('event')) {
    const eventResult = await repairEventRows(limit);
    scanned += eventResult.scanned;
    enqueued += eventResult.enqueued;
  }

  return { scanned, enqueued };
}

async function enqueueStaleRows(sourceTable: string, rows: readonly unknown[]): Promise<number> {
  const schema = await import('@docket/db');
  const sourceRows = rows.filter(isRowWithId);
  if (sourceRows.length === 0) return 0;
  const docs = await schema.db
    .select({
      entityId: schema.searchDocument.entityId,
      indexedAt: schema.searchDocument.indexedAt,
      sourceUpdatedAt: schema.searchDocument.sourceUpdatedAt,
    })
    .from(schema.searchDocument)
    .where(
      and(
        eq(schema.searchDocument.sourceTable, sourceTable),
        inArray(
          schema.searchDocument.entityId,
          sourceRows.map((row) => row.id),
        ),
      ),
    );
  const docsByEntityId = new Map(docs.map((doc) => [doc.entityId, doc]));
  let enqueued = 0;

  for (const row of sourceRows) {
    const doc = docsByEntityId.get(row.id);
    const freshness = sourceFreshness(row);
    const indexedFreshness = doc?.sourceUpdatedAt ?? doc?.indexedAt ?? null;
    if (doc && freshness && indexedFreshness && freshness.getTime() <= indexedFreshness.getTime()) {
      continue;
    }
    await enqueueSearchIndexJob({
      organizationId: typeof row.organizationId === 'string' ? row.organizationId : null,
      userId: typeof row.userId === 'string' ? row.userId : null,
      sourceTable,
      entityId: row.id,
      operation: 'upsert',
      reason: 'repair',
    });
    enqueued += 1;
  }

  return enqueued;
}

async function repairEventRows(limit: number): Promise<RepairSearchIndexResult> {
  const schema = await import('@docket/db');
  const [lastIndexed] = await schema.db
    .select({ occurredAt: schema.searchDocument.occurredAt })
    .from(schema.searchDocument)
    .where(eq(schema.searchDocument.sourceTable, 'event'))
    .orderBy(desc(schema.searchDocument.occurredAt))
    .limit(1);
  const since = lastIndexed?.occurredAt ?? new Date(0);
  const rows = await schema.db
    .select()
    .from(schema.event)
    .where(gt(schema.event.occurredAt, since))
    .orderBy(desc(schema.event.occurredAt))
    .limit(limit);
  let enqueued = 0;

  for (const row of rows) {
    await enqueueSearchIndexJob({
      organizationId: row.organizationId,
      userId: row.userId,
      sourceTable: 'event',
      entityId: row.id,
      operation: 'upsert',
      reason: 'repair',
      sourceEventId: row.id,
    });
    enqueued += 1;

    const target = eventSearchReindexTarget(row.entity);
    if (!target) continue;
    await enqueueSearchIndexJob({
      organizationId: row.organizationId,
      userId: row.userId,
      sourceTable: target.sourceTable,
      entityId: target.entityId,
      operation: 'upsert',
      reason: 'repair',
      sourceEventId: row.id,
    });
    enqueued += 1;
  }

  return { scanned: rows.length, enqueued };
}

function isRowWithId(row: unknown): row is {
  id: string;
  organizationId?: unknown;
  userId?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  occurredAt?: unknown;
} {
  return typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'string';
}

function sourceFreshness(row: { createdAt?: unknown; updatedAt?: unknown; occurredAt?: unknown }) {
  for (const value of [row.updatedAt, row.occurredAt, row.createdAt]) {
    if (value instanceof Date) return value;
  }
  return null;
}

interface SourceScanCursor {
  sourceTableIndex: number;
  rowId: string;
}

function encodeSourceScanCursor(cursor: SourceScanCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeSourceScanCursor(value: string | undefined): SourceScanCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<SourceScanCursor>;
    if (
      typeof parsed.sourceTableIndex === 'number' &&
      Number.isInteger(parsed.sourceTableIndex) &&
      parsed.sourceTableIndex >= 0 &&
      typeof parsed.rowId === 'string'
    ) {
      return { sourceTableIndex: parsed.sourceTableIndex, rowId: parsed.rowId };
    }
  } catch {
    return null;
  }
  return null;
}

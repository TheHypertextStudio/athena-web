import type { CanonicalEntityKind } from '@docket/connections/event-contract';
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

/** Options for a paged scan that enqueues search-index backfill jobs. */
export interface BackfillSearchIndexOptions {
  sourceTables?: readonly string[] | undefined;
  limit?: number | undefined;
  /** Opaque resume cursor returned by a previous paged scan. */
  cursor?: string | undefined;
}

/** Counts and continuation state returned by a search-index backfill scan. */
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

function extractJobParamsFromRow(row: { id: string; organizationId?: unknown; userId?: unknown }): {
  organizationId: string | null;
  userId: string | null;
} {
  return {
    organizationId: typeof row.organizationId === 'string' ? row.organizationId : null,
    userId: typeof row.userId === 'string' ? row.userId : null,
  };
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
      const { organizationId, userId } = extractJobParamsFromRow(row);
      await enqueueSearchIndexJob({
        organizationId,
        userId,
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

function isRowStale(
  row: { createdAt?: unknown; updatedAt?: unknown; occurredAt?: unknown },
  doc:
    | {
        sourceUpdatedAt: Date | null | undefined;
        indexedAt: Date | null | undefined;
      }
    | undefined,
): boolean {
  if (!doc) return true;
  const freshness = sourceFreshness(row);
  const indexedFreshness = doc.sourceUpdatedAt ?? doc.indexedAt ?? null;
  if (!freshness || !indexedFreshness || !(indexedFreshness instanceof Date)) return true;
  return freshness.getTime() > indexedFreshness.getTime();
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
    if (!isRowStale(row, doc)) continue;
    const { organizationId, userId } = extractJobParamsFromRow(row);
    await enqueueSearchIndexJob({
      organizationId,
      userId,
      sourceTable,
      entityId: row.id,
      operation: 'upsert',
      reason: 'repair',
    });
    enqueued += 1;
  }

  return enqueued;
}

/** One canonical event row, reduced to what a repair pass reindexes from it. */
interface RepairableEventRow {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string | null;
  readonly entityKind: CanonicalEntityKind | null;
  readonly docketEntityId: string | null;
}

async function enqueueEventAndTargetJobs(row: RepairableEventRow): Promise<number> {
  let enqueued = 0;
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

  const target = eventSearchReindexTarget(row.entityKind, row.docketEntityId);
  if (target) {
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
    enqueued += await enqueueEventAndTargetJobs(row);
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

function isValidSourceScanCursor(parsed: unknown): parsed is SourceScanCursor {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const obj = parsed as Record<PropertyKey, unknown>;
  return (
    typeof obj['sourceTableIndex'] === 'number' &&
    Number.isInteger(obj['sourceTableIndex']) &&
    obj['sourceTableIndex'] >= 0 &&
    typeof obj['rowId'] === 'string'
  );
}

function decodeSourceScanCursor(value: string | undefined): SourceScanCursor | null {
  if (!value) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return isValidSourceScanCursor(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

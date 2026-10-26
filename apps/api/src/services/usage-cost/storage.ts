/**
 * `@docket/api` — the storage meters.
 *
 * @remarks
 * Storage is a stock: the ledger records what was held when the nightly snapshot ran, and a day's
 * row counts as one byte-day. Postgres bytes are attributed by splitting each table's real on-disk
 * size, indexes and TOAST included, in proportion to each owner's share of its row bytes. The parts
 * therefore sum to what the disk holds, and what no source claims is written as one unattributed line
 * instead of being spread across people.
 */
import { db, usageDaily } from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { rawResultRows } from '../../lib/raw-result';
import { OBJECT_SOURCES, POSTGRES_SOURCES, type PostgresSource } from './storage-sources';

/** Above this many rows a table is sampled rather than scanned in full. */
const SAMPLE_ABOVE_ROWS = 1_000_000;

/** Postgres aggregates arrive as strings from `postgres-js` and numbers from PGlite. */
const Count = z.coerce.number();

const OwnerRow = z.object({
  owner_user_id: z.string().nullable(),
  organization_id: z.string().nullable(),
  bytes: Count,
});

const SizeRow = z.object({ total: Count, tuples: Count });

const DatabaseRow = z.object({ bytes: Count });

type LedgerRow = typeof usageDaily.$inferInsert;

/**
 * The share of a large table to read, as a percentage.
 *
 * @param tuples - Postgres' row estimate for the table.
 * @returns 100 for a table small enough to scan in full, otherwise the percentage that reads about
 * {@link SAMPLE_ABOVE_ROWS} rows.
 */
export function samplePercent(tuples: number): number {
  if (tuples <= SAMPLE_ABOVE_ROWS) return 100;
  return Math.max(1, Math.ceil((SAMPLE_ABOVE_ROWS / tuples) * 100));
}

/**
 * Split a table's on-disk size among its owners.
 *
 * @param total - The table's total size in bytes, indexes and TOAST included.
 * @param owners - Each owner's measured row bytes.
 * @returns each owner's share of {@link total}, which sum to it to within rounding.
 */
export function splitByRowBytes<T extends { readonly bytes: number }>(
  total: number,
  owners: readonly T[],
): (T & { readonly attributed: number })[] {
  const measured = owners.reduce((sum, owner) => sum + owner.bytes, 0);
  if (measured <= 0) return [];
  return owners.map((owner) => ({
    ...owner,
    attributed: Math.round((total * owner.bytes) / measured),
  }));
}

/** SQL measuring each owner's row bytes in one table, sampled when the table is large. */
function ownerBytesSql(source: PostgresSource, percent: number): string {
  const sample = percent < 100 ? ` tablesample system (${String(percent)})` : '';
  return `select x.owner_user_id, x.organization_id, sum(x.row_bytes)::bigint as bytes from (
    select pg_column_size(t.*) as row_bytes, ${source.user} as owner_user_id, ${source.organization} as organization_id
    from ${source.table} t${sample} ${source.joins ?? ''}
  ) x group by 1, 2`;
}

/**
 * Take the Postgres storage snapshot for a day.
 *
 * @remarks
 * Replaces the day's `postgres_bytes` rows, so repeating a snapshot is safe.
 *
 * @param day - The UTC day, `YYYY-MM-DD`.
 * @returns the number of ledger rows written.
 */
export async function snapshotPostgresStorage(day: string): Promise<number> {
  const rows: LedgerRow[] = [];
  let attributedTotal = 0;

  for (const source of POSTGRES_SOURCES) {
    const size = z
      .array(SizeRow)
      .parse(
        rawResultRows<unknown>(
          await db.execute(
            sql`select pg_total_relation_size(${source.table}::regclass)::bigint as total, (select reltuples from pg_class where oid = ${source.table}::regclass)::bigint as tuples`,
          ),
        ),
      )[0];
    if (!size) continue;

    const owners = z
      .array(OwnerRow)
      .parse(
        rawResultRows<unknown>(
          await db.execute(sql.raw(ownerBytesSql(source, samplePercent(size.tuples)))),
        ),
      );
    const split = splitByRowBytes(
      size.total,
      owners.map((owner) => ({ ...owner })),
    );
    if (split.length === 0) continue;

    attributedTotal += size.total;
    for (const owner of split) {
      rows.push({
        day,
        userId: owner.owner_user_id,
        organizationId: owner.organization_id,
        resource: 'postgres_bytes',
        dimension: source.table,
        quantity: owner.attributed,
      });
    }
  }

  const database = z
    .array(DatabaseRow)
    .parse(
      rawResultRows<unknown>(
        await db.execute(sql`select pg_database_size(current_database())::bigint as bytes`),
      ),
    )[0];
  rows.push({
    day,
    userId: null,
    organizationId: null,
    resource: 'postgres_bytes',
    dimension: 'unattributed',
    quantity: Math.max(0, (database?.bytes ?? 0) - attributedTotal),
  });

  await replaceDay('postgres_bytes', day, rows);
  return rows.length;
}

/**
 * Take the object storage snapshot for a day.
 *
 * @remarks
 * Sums the sizes recorded on each blob-backed row. Mail blobs and account exports record no size and
 * are not counted here.
 *
 * @param day - The UTC day, `YYYY-MM-DD`.
 * @returns the number of ledger rows written.
 */
export async function snapshotObjectStorage(day: string): Promise<number> {
  const rows: LedgerRow[] = [];
  for (const source of OBJECT_SOURCES) {
    const owners = z
      .array(OwnerRow)
      .parse(
        rawResultRows<unknown>(
          await db.execute(
            sql.raw(
              `select owner_user_id, organization_id, sum(bytes)::bigint as bytes from (${source.select}) x group by 1, 2`,
            ),
          ),
        ),
      );
    for (const owner of owners) {
      if (owner.bytes <= 0) continue;
      rows.push({
        day,
        userId: owner.owner_user_id,
        organizationId: owner.organization_id,
        resource: 'object_bytes',
        dimension: source.store,
        quantity: owner.bytes,
      });
    }
  }
  await replaceDay('object_bytes', day, rows);
  return rows.length;
}

/** Replace one resource's rows for one day, atomically. */
async function replaceDay(
  resource: 'postgres_bytes' | 'object_bytes',
  day: string,
  rows: readonly LedgerRow[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(usageDaily)
      .where(and(eq(usageDaily.resource, resource), eq(usageDaily.day, day)));
    if (rows.length > 0) await tx.insert(usageDaily).values([...rows]);
  });
}

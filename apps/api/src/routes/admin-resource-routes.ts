/**
 * `@docket/api` — platform resource usage for the operator back-office (mounted at `/resources`).
 *
 * @remarks
 * Kept off `GET /admin/metrics` deliberately. That route is polled once a minute to drive the
 * console's nav badges and runs nothing but indexed counts; these reads scan three tables and ask
 * Postgres for its own size, so folding them in would make every badge refresh pay for a scan.
 */
import { attachment, billingDiscountEvidence, db, documentImage } from '@docket/db';
import { count, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { AdminResourcesOut, type AdminStorageStore } from '../admin-dto';
import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { rawResultRows } from '../lib/raw-result';

/**
 * A Postgres size aggregate as a driver hands it back.
 *
 * @remarks
 * `bigint` and `numeric` arrive as strings from `postgres-js` (so a value past
 * `Number.MAX_SAFE_INTEGER` is not silently truncated) and as numbers from PGlite, and `SUM` over
 * an empty set is `NULL`. Accepting all three here keeps the coercion in one place.
 */
const ByteCount = z.union([z.string(), z.number(), z.null()]);

/** The single row of the database-size read. */
const DatabaseSizeRow = z.object({ bytes: ByteCount });

/** One row of a per-store storage read. */
interface StorageTotals {
  readonly objects: number;
  readonly bytes: string | number | null;
}

/**
 * Coerce a Postgres `bigint`/`numeric` aggregate to a JavaScript number.
 *
 * @remarks
 * `postgres-js` returns both as strings to avoid silently truncating past `Number.MAX_SAFE_INTEGER`,
 * and `SUM` over an empty set is `NULL` rather than zero.
 *
 * @param value - The aggregate as the driver returned it.
 * @returns the value as a number, or zero when the aggregate matched no rows.
 */
function bytesOf(value: string | number | null): number {
  if (value === null) return 0;
  return typeof value === 'number' ? value : Number(value);
}

/**
 * Total the objects and bytes held in one blob-backed table.
 *
 * @param store - The store's name in the response.
 * @param totals - The single aggregate row for that table.
 * @returns the store's entry in the storage breakdown.
 */
function storeTotals(
  store: AdminStorageStore['store'],
  totals: StorageTotals | undefined,
): AdminStorageStore {
  return {
    store,
    objectCount: totals?.objects ?? 0,
    byteSize: bytesOf(totals?.bytes ?? null),
  };
}

/**
 * Sub-router for platform resource usage.
 *
 * @remarks
 * Mounted under `/admin`, so every route here already runs behind `staffMiddleware`.
 */
export const adminResourceRoutes = new Hono<AppEnv>().get(
  '/',
  apiDoc({
    tag: 'Admin',
    summary: 'Get platform resource usage',
    response: AdminResourcesOut,
    description: `Returns what the deployment is currently consuming, across object storage and the database.

**Storage.** Object counts and byte totals for each blob-backed table, reported per store rather than as one figure, so it is visible which store is growing. \`attachment\` records size as nullable and rows without one count as zero bytes; \`document_image\` and \`discount_evidence\` always record it. \`storageByteSize\` is the sum across every store.

**Database.** \`databaseByteSize\` is the total size of the database including indexes.

**Cost.** These are aggregate scans rather than indexed counts, so this route is separate from \`GET /admin/metrics\` and is not suited to frequent polling.

**Access.** Behind \`staffMiddleware\` (any staff tier — a read). Non-operator → \`403\`; anonymous → \`401\`.

**Side effects.** None.

**Related.** \`GET /admin/metrics\` for account and queue counts.`,
  }),
  async (c) => {
    const [attachments, images, evidence, database] = await Promise.all([
      db
        .select({ objects: count(), bytes: sql<string | null>`sum(${attachment.byteSize})` })
        .from(attachment),
      db
        .select({ objects: count(), bytes: sql<string | null>`sum(${documentImage.byteSize})` })
        .from(documentImage),
      db
        .select({
          objects: count(),
          bytes: sql<string | null>`sum(${billingDiscountEvidence.byteSize})`,
        })
        .from(billingDiscountEvidence),
      db.execute(sql`select pg_database_size(current_database()) as bytes`),
    ]);

    const storage: AdminStorageStore[] = [
      storeTotals('attachment', attachments[0]),
      storeTotals('document_image', images[0]),
      storeTotals('discount_evidence', evidence[0]),
    ];

    const databaseSize = z.array(DatabaseSizeRow).parse(rawResultRows<unknown>(database))[0];

    return ok(c, AdminResourcesOut, {
      storage,
      storageByteSize: storage.reduce((total, store) => total + store.byteSize, 0),
      databaseByteSize: bytesOf(databaseSize?.bytes ?? null),
    });
  },
);

/**
 * Local repair utility for the workspace search index.
 *
 * @remarks
 * Scans source tables and enqueues durable `search_index_job` rows. A cron/API worker
 * can process those jobs independently; this script is intentionally enqueue-only so a
 * repair run is safe to repeat.
 */
import { backfillSearchIndex } from '../apps/api/src/search/backfill';

const sourceTables = process.argv.slice(2);
const result = await backfillSearchIndex({
  sourceTables: sourceTables.length > 0 ? sourceTables : undefined,
});

console.log(`search backfill enqueued ${result.enqueued} jobs from ${result.scanned} scanned rows`);

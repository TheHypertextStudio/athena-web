/**
 * Local repair utility for the workspace search index.
 *
 * @remarks
 * Scans source tables and enqueues durable `search_index_job` rows. A cron/API worker
 * can process those jobs independently; this script is intentionally enqueue-only so a
 * repair run is safe to repeat.
 */
import { backfillSearchIndex, repairSearchIndex } from '../apps/api/src/search/backfill';

const args = process.argv.slice(2);
const repair = args.includes('--repair');
const sourceTables = args.filter((arg) => arg !== '--repair');
const result = repair
  ? await repairSearchIndex({
      sourceTables: sourceTables.length > 0 ? sourceTables : undefined,
    })
  : await backfillSearchIndex({
      sourceTables: sourceTables.length > 0 ? sourceTables : undefined,
    });

console.log(
  `search ${repair ? 'repair' : 'backfill'} enqueued ${result.enqueued} jobs from ${result.scanned} scanned rows`,
);

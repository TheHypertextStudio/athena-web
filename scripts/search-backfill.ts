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
const cursorArg = args.find((arg) => arg.startsWith('--cursor='));
const cursor = cursorArg ? cursorArg.slice('--cursor='.length) : undefined;
const sourceTables = args.filter((arg) => arg !== '--repair' && !arg.startsWith('--cursor='));
const result = repair
  ? await repairSearchIndex({
      sourceTables: sourceTables.length > 0 ? sourceTables : undefined,
    })
  : await backfillSearchIndex({
      sourceTables: sourceTables.length > 0 ? sourceTables : undefined,
      cursor,
    });

console.log(
  `search ${repair ? 'repair' : 'backfill'} enqueued ${result.enqueued} jobs from ${result.scanned} scanned rows`,
);
if ('nextCursor' in result && result.nextCursor) {
  const nextCursor = result.nextCursor;
  if (typeof nextCursor === 'string') {
    console.log(`next cursor: ${nextCursor}`);
  }
}

/**
 * Local worker utility for draining queued workspace-search index jobs.
 *
 * @remarks
 * The API cron endpoint uses the same worker; this script exists so development and one-off
 * repair runs can enqueue with `search:backfill` / `search:repair` and then process locally
 * without waiting for the platform scheduler.
 */
import { processSearchIndexJobs } from '../apps/api/src/search/process-jobs';

const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const parsedLimit = limitArg ? Number(limitArg.slice('--limit='.length)) : undefined;
const limit =
  parsedLimit && Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : 50;
const result = await processSearchIndexJobs({ limit });

console.log(
  `search index processed ${result.processed} jobs: ${result.succeeded} succeeded, ${result.failed} failed`,
);

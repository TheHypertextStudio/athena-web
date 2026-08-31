/**
 * `pnpm sync:failure` — print why a connector's most recent sync runs failed.
 *
 * @remarks
 * The sync spine records each failure in `sync_run.error`. The web error-source policy keeps that
 * text off product surfaces, so this read-only operator tool is where it can be read.
 *
 * Talks to Postgres directly rather than importing the workspace's Drizzle client, as
 * `migration-0080-org-slug-unify.ts` does, so it can run against any database.
 *
 * @example
 * ```bash
 * pnpm sync:failure --prod --provider=notion --failed-only   # reads production's URL itself
 * DATABASE_URL=postgres://... pnpm sync:failure --provider=notion --limit=25
 * DATABASE_URL=postgres://... pnpm sync:failure --purpose=notion_mirror --failed-only
 * ```
 */
import { execFileSync } from 'node:child_process';

import postgres from 'postgres';

/** Where production's connection string lives, mirroring `deploy.yml`'s migration step. */
const PROD_SECRET = process.env['DOCKET_DB_SECRET'] ?? 'docket-database-url-unpooled';
/** The Google Cloud project holding {@link PROD_SECRET} (`vars.GCP_PROJECT_ID`). */
const PROD_PROJECT = process.env['DOCKET_GCP_PROJECT'] ?? 'athena-services';

/**
 * Read production's connection string from Secret Manager.
 *
 * @remarks
 * The same call `deploy.yml` makes before migrating. Requires a live `gcloud` login.
 */
function productionUrl(): string {
  try {
    return execFileSync(
      'gcloud',
      [
        'secrets',
        'versions',
        'access',
        'latest',
        `--secret=${PROD_SECRET}`,
        `--project=${PROD_PROJECT}`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } catch {
    console.error(
      `Could not read ${PROD_SECRET} from Google Secret Manager (project ${PROD_PROJECT}).\n` +
        'If your session has expired, run: gcloud auth login',
    );
    process.exit(1);
  }
}

/** One `--name=value` argument, or undefined when it was not supplied. */
function flag(name: string): string | undefined {
  const found = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`));
  return found?.slice(name.length + 3);
}

/**
 * The purposes a run can have.
 *
 * @see `packages/db/src/enums.ts` — the source of truth this copy tracks.
 */
const PURPOSES: readonly string[] = ['task_sync', 'email_ingest', 'notion_mirror', 'activity_pull'];

const provider = flag('provider');
const purpose = flag('purpose');
// An unrecognized purpose would match nothing and read as "never failed".
if (purpose !== undefined && !PURPOSES.includes(purpose)) {
  console.error(`Unknown --purpose=${purpose}. Expected one of: ${PURPOSES.join(', ')}`);
  process.exit(1);
}
const failedOnly = process.argv.slice(2).includes('--failed-only');
const prod = process.argv.slice(2).includes('--prod');
const parsedLimit = Number(flag('limit') ?? '10');
const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.trunc(parsedLimit) : 10;

/**
 * Read a connection string, treating a blank one as absent.
 *
 * @remarks
 * The committed `.env.local` ships `DATABASE_URL_UNPOOLED=` empty, which `??` would accept.
 */
function envUrl(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

const url = prod ? productionUrl() : (envUrl('DATABASE_URL_UNPOOLED') ?? envUrl('DATABASE_URL'));
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error(
    'Set DATABASE_URL (or DATABASE_URL_UNPOOLED) to a postgres:// connection string,\n' +
      'or pass --prod to read production’s from Google Secret Manager.\n' +
      "A local pglite:// URL will not work here — this reads a server's recorded sync history.",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => undefined });

try {
  // Joined because a run's provider lives on the integration.
  const rows = await sql<
    {
      started_at: string;
      status: string;
      purpose: string;
      trigger: string;
      processed: number;
      total: number;
      error: string | null;
      provider: string;
      integration_id: string;
      integration_status: string;
    }[]
  >`
    select to_char(r.started_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as started_at,
           r.status, r.purpose, r.trigger, r.processed, r.total, r.error,
           i.provider, i.id as integration_id, i.status as integration_status
      from sync_run r
      join integration i on i.id = r.integration_id
     where (${provider ?? null}::text is null or i.provider = ${provider ?? null})
       and (${purpose ?? null}::text is null or r.purpose::text = ${purpose ?? null})
       and (${!failedOnly} or r.status = 'failed')
     order by r.started_at desc
     limit ${limit}
  `;

  if (rows.length === 0) {
    console.log('No sync runs matched.');
  }
  for (const row of rows) {
    const counts = `${String(row.processed)}/${String(row.total)}`;
    console.log(
      `${row.started_at}  ${row.provider}  ${row.purpose}  ` +
        `${row.status}  ${counts}  (${row.trigger})`,
    );
    console.log(`  integration ${row.integration_id} — currently ${row.integration_status}`);
    // On its own line: provider validation messages are long.
    if (row.error !== null) console.log(`  reason: ${row.error}`);
  }
} finally {
  await sql.end();
}

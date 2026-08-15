/**
 * `pnpm sync:failure` — print why a connector's most recent sync runs failed.
 *
 * @remarks
 * Every failure is already recorded: the sync spine writes the reason to `sync_run.error` and
 * mirrors it onto `integration.last_error`. Neither reaches a screen, and deliberately so — the
 * web error-source policy bars provider diagnostics from production UI, and `lastError` is named
 * in its ban list. That leaves a real gap for whoever is *operating* Docket rather than using it:
 * a connection reads "needs attention" while the one fact that would explain it is unreachable
 * without a database client.
 *
 * This closes that gap where the policy does not apply. It is a read-only operator tool rather
 * than a product surface, so it may print the stored text verbatim.
 *
 * Standalone via `tsx`, so it talks to Postgres directly rather than importing the workspace's
 * Drizzle client — the same choice `migration-0080-org-slug-unify.ts` makes, and the reason a
 * root script can run against a database the monorepo was not built for.
 *
 * @example
 * ```bash
 * DATABASE_URL=postgres://... pnpm sync:failure
 * DATABASE_URL=postgres://... pnpm sync:failure --provider=notion --limit=25
 * DATABASE_URL=postgres://... pnpm sync:failure --purpose=notion_mirror --failed-only
 * ```
 */
import postgres from 'postgres';

/** One `--name=value` argument, or undefined when it was not supplied. */
function flag(name: string): string | undefined {
  const found = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`));
  return found?.slice(name.length + 3);
}

/**
 * The purposes a run can have.
 *
 * @remarks
 * A literal copy of the `sync_run_purpose` enum rather than an import, for the reason
 * `migration-0080-org-slug-unify.ts` states about its own copied list: this script runs standalone
 * under `tsx`, outside the workspace build graph.
 *
 * @see `packages/db/src/enums.ts` — the source of truth.
 */
const PURPOSES: readonly string[] = ['task_sync', 'email_ingest', 'notion_mirror', 'activity_pull'];

const provider = flag('provider');
const purpose = flag('purpose');
// Checked rather than passed through. An unrecognized purpose matches nothing, and "No sync runs
// matched" is indistinguishable from "this connection has never failed" — the one answer a tool
// for diagnosing failures must never give by accident.
if (purpose !== undefined && !PURPOSES.includes(purpose)) {
  console.error(`Unknown --purpose=${purpose}. Expected one of: ${PURPOSES.join(', ')}`);
  process.exit(1);
}
const failedOnly = process.argv.slice(2).includes('--failed-only');
const parsedLimit = Number(flag('limit') ?? '10');
const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.trunc(parsedLimit) : 10;

/**
 * Read a connection string, treating a blank one as absent.
 *
 * @remarks
 * Not `??`: the committed `.env.local` ships `DATABASE_URL_UNPOOLED=` with no value, and nullish
 * coalescing would accept that empty string and then fail to connect rather than falling through
 * to `DATABASE_URL`.
 */
function envUrl(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

// The unpooled URL first when one is set, because that is the connection the deploy already uses
// for schema work against production and so the one most likely to be to hand.
const url = envUrl('DATABASE_URL_UNPOOLED') ?? envUrl('DATABASE_URL');
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error(
    'Set DATABASE_URL (or DATABASE_URL_UNPOOLED) to a postgres:// connection string.\n' +
      "A local pglite:// URL will not work here — this reads a server's recorded sync history.",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => undefined });

try {
  // Joined rather than queried separately: a run's provider lives on the integration, and the
  // question being asked ("why did Notion fail") is phrased in those terms.
  const rows = await sql<
    {
      started_at: Date;
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
    select r.started_at, r.status, r.purpose, r.trigger, r.processed, r.total, r.error,
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
      `${row.started_at.toISOString()}  ${row.provider}  ${row.purpose}  ` +
        `${row.status}  ${counts}  (${row.trigger})`,
    );
    console.log(`  integration ${row.integration_id} — currently ${row.integration_status}`);
    // The whole reason this script exists. On its own line because a provider's validation
    // message is long, and the surrounding columns are not what anybody ran this to read.
    if (row.error !== null) console.log(`  reason: ${row.error}`);
  }
} finally {
  await sql.end();
}

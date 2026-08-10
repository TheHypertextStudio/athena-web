/**
 * `scripts/notion-webhook-token.ts` — retrieve the Notion webhook subscription's one-time
 * verification token from the `inbound_event` row it was recorded into.
 *
 * @remarks
 * Notion sends `{ verification_token }` exactly once, unsigned, the moment a webhook
 * subscription is created (`RealNotionObserver`, `packages/integrations/src/observer-notion.ts`).
 * There is no second way to see it — not in Notion's own UI, not by re-creating the subscription.
 * The handshake delivery is durably recorded like any other inbound event rather than only ever
 * printed to a log, specifically so it can be read back after the fact; this is that read-back.
 *
 * Standalone: `pnpm notion:webhook-token -- --env production`. Also called directly by
 * `pnpm integrations`'s guided Notion setup, which polls this while the operator is over in
 * Notion's Webhooks tab creating the subscription.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';

import postgres from 'postgres';

import { resolveDatabaseUrl } from '../packages/db/drizzle-url';

export type TokenEnvironment = 'local' | 'staging' | 'production';

/** GCP Secret Manager name for a var in a given environment (mirrors `integrations-setup.ts`). */
function secretName(env: TokenEnvironment, varName: string): string {
  const kebab = varName.toLowerCase().replace(/_/g, '-');
  return env === 'production' ? `docket-${kebab}` : `docket-${env}-${kebab}`;
}

/** Read one Secret Manager version, trimmed. Throws with the operator-facing reason on failure. */
function readSecret(name: string, project: string): string {
  return execFileSync(
    'gcloud',
    [
      'secrets',
      'versions',
      'access',
      'latest',
      `--secret=${name}`,
      `--project=${project}`,
      '--quiet',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

/**
 * Query the most recent Notion verification handshake out of `inbound_event`.
 *
 * @param databaseUrl - An UNPOOLED Postgres connection string (migrations/one-shot scripts only —
 *   never the pooled app connection).
 * @returns the token, or undefined when no handshake has arrived yet.
 */
export async function queryNotionVerificationToken(
  databaseUrl: string,
): Promise<string | undefined> {
  const pgUrl = databaseUrl.startsWith('neon:')
    ? databaseUrl.replace(/^neon:/, 'postgres:')
    : databaseUrl;
  const sql = postgres(pgUrl, { max: 1, prepare: false });
  try {
    const rows = await sql<{ payload: { verification_token?: string } }[]>`
      select payload from inbound_event
      where provider = 'notion' and event_type = 'notion.verification'
      order by received_at desc
      limit 1
    `;
    return rows[0]?.payload.verification_token;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/**
 * Resolve the target environment's database and look up the token.
 *
 * @param env - `staging`/`production` read `DATABASE_URL_UNPOOLED` from GCP Secret Manager;
 *   `local` reads it straight from `process.env` (already loaded via `dotenv -e .env.local` by
 *   every `pnpm db:*`/`pnpm integrations` invocation).
 * @param project - Required for `staging`/`production`; ignored for `local`.
 * @returns the token, or undefined when no handshake has arrived yet — never throws for "not
 *   found yet", only for a genuine connection/secret failure, so a caller can distinguish
 *   "keep polling" from "something is actually broken."
 */
export async function fetchNotionWebhookToken(
  env: TokenEnvironment,
  project?: string,
): Promise<string | undefined> {
  const databaseUrl =
    env === 'local'
      ? resolveDatabaseUrl()
      : readSecret(secretName(env, 'DATABASE_URL_UNPOOLED'), requireProject(env, project));
  if (!databaseUrl) throw new Error(`No DATABASE_URL(_UNPOOLED) available for ${env}.`);
  if (databaseUrl.startsWith('pglite:')) return undefined; // local PGlite has no live handshake to read
  return queryNotionVerificationToken(databaseUrl);
}

function requireProject(env: TokenEnvironment, project: string | undefined): string {
  if (!project) throw new Error(`A GCP project id is required to read ${env} secrets.`);
  return project;
}

function parseArgs(argv: readonly string[]): { env: TokenEnvironment; project?: string } {
  let env: TokenEnvironment = 'production';
  let project: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--env') env = argv[++i] as TokenEnvironment;
    if (argv[i] === '--project') project = argv[++i];
  }
  return { env, project };
}

async function main(): Promise<void> {
  const { env, project } = parseArgs(process.argv.slice(2));
  const token = await fetchNotionWebhookToken(env, project);
  if (!token) {
    console.error(
      `No Notion verification handshake found yet for ${env}. Create the webhook subscription ` +
        'in Notion (Connection → Webhooks tab) first, then re-run this.',
    );
    process.exitCode = 1;
    return;
  }
  console.log(token);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();

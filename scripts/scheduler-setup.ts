/**
 * `pnpm scheduler:setup` — provision the Cloud Scheduler jobs that drive Docket's
 * secret-guarded cron endpoints.
 *
 * @remarks
 * The cron endpoints (`POST /internal/cron/sync-connectors`, `POST /internal/cron/lifecycle-sweep`)
 * only ever run when something calls them on a cadence. Background connector auto-mirror is
 * a core feature, so a missing scheduler is a silent failure — this script makes the jobs
 * config-as-code instead of a manual `gcloud` incantation. It is the single source of truth,
 * run both manually (`pnpm scheduler:setup`) and automatically after every API deploy (see
 * `.github/workflows/deploy.yml`).
 *
 * Idempotent — each job is `describe`d, then `update`d if present or `create`d if not, so
 * re-running converges the live job to the definitions below. The Cloud Run services are
 * `--allow-unauthenticated`, so each job authenticates purely with the `x-cron-secret`
 * header (read from Secret Manager, never logged) — no OIDC / `run.invoker` needed.
 *
 * Best-effort by design: the one-time prerequisites (the Cloud Scheduler API enabled and the
 * deploy account holding `roles/cloudscheduler.admin`) are applied by `pnpm bootstrap`, not the
 * deploy account itself. Until those are in place, provisioning is *skipped with a loud,
 * actionable warning and a zero exit* so it never blocks shipping the API — a genuine fault
 * (bad flag, unreachable host) still exits non-zero. This keeps the deploy honest: a warning is
 * surfaced, never a fabricated success.
 *
 * Config comes from env (the same names CI passes): `GCP_PROJECT_ID`, `GCP_REGION`, `API_URL`.
 * Pass `--dry-run` (or set `DRY_RUN=1`) to print the exact `gcloud` commands — with the secret
 * redacted — without calling GCP. Requires an authenticated `gcloud` for a real run.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** The Secret Manager secret holding the shared `CRON_SECRET` (created by `pnpm bootstrap`). */
const SECRET_NAME = 'docket-cron-secret';
const SECRET_REDACTED = '***REDACTED***';

/** A scheduled HTTP cron job: an endpoint to hit and how often. */
export interface CronJob {
  /** Cloud Scheduler job id. */
  readonly name: string;
  /** Path under the API host to POST (joined with `API_URL`). */
  readonly path: string;
  /** Unix-cron schedule (interpreted in `Etc/UTC`). */
  readonly schedule: string;
  /** Human description stored on the job. */
  readonly description: string;
}

/** The jobs Docket needs. All target secret-guarded, idempotent, retry-safe sweeps. */
export const JOBS: readonly CronJob[] = [
  {
    name: 'docket-sync-connectors',
    path: '/internal/cron/sync-connectors',
    schedule: '*/15 * * * *',
    description:
      'Docket: background connector auto-mirror (re-syncs every due mirror integration).',
  },
  {
    name: 'docket-lifecycle-sweep',
    path: '/internal/cron/lifecycle-sweep',
    schedule: '0 3 * * *',
    description: 'Docket: org data-lifecycle sweep (export_window → pending_deletion → deleted).',
  },
  {
    name: 'docket-process-events',
    path: '/internal/cron/process-events',
    schedule: '*/2 * * * *',
    description:
      'Docket: ambient-intelligence drain (normalize inbound webhook events into canonical events).',
  },
  {
    name: 'docket-pull-activity',
    path: '/internal/cron/pull-activity',
    schedule: '*/15 * * * *',
    description:
      'Docket: activity poll (asks every connected tool with no webhook — sent mail, pull-request ' +
      'authorship, attended meetings — what the person did, into the canonical event log).',
  },
  {
    name: 'docket-daily-digests',
    path: '/internal/cron/daily-digests',
    schedule: '*/15 * * * *',
    description:
      "Docket: daily-digest sweep (email each opted-in user's end-of-day summary at their local time).",
  },
  {
    name: 'docket-account-deletion-sweep',
    path: '/internal/cron/account-deletion-sweep',
    schedule: '30 3 * * *',
    description: 'Docket: account-deletion sweep (purge accounts past their 14-day grace window).',
  },
  {
    name: 'docket-account-export-sweep',
    path: '/internal/cron/account-export-sweep',
    schedule: '*/10 * * * *',
    description:
      'Docket: account-export sweep (generate pending personal-data exports + email the link).',
  },
  {
    name: 'docket-email-suggestions',
    path: '/internal/cron/email-suggestions',
    schedule: '*/15 * * * *',
    description:
      'Docket: email-to-task ingest sweep (cursored mailbox pull -> funnel -> Athena synthesis -> suggestions for every opted-in mail integration).',
  },
  {
    name: 'docket-sync-calendars',
    path: '/internal/cron/sync-calendars',
    schedule: '*/10 * * * *',
    description:
      'Docket: calendar sweep (re-syncs every connected user, drains the write outbox, renews push-notification watches).',
  },
  {
    name: 'docket-sync-work-locations',
    path: '/internal/cron/sync-work-locations',
    schedule: '*/10 * * * *',
    description:
      'Docket: work-location sweep (bootstraps linked accounts, converges canonical edits, drains projection writes, renews watches).',
  },
  {
    name: 'docket-recurrence-materialization',
    path: '/internal/cron/recurrence-materialization',
    schedule: '*/15 * * * *',
    description:
      'Docket: recurrence sweep (keeps rolling planning windows materialized and applies missed-work policies).',
  },
  {
    name: 'docket-run-linear-agent-sessions',
    path: '/internal/cron/run-linear-agent-sessions',
    schedule: '*/1 * * * *',
    description:
      'Docket: Linear Agent session-run sweep (drives queued agent runs via driveSession and relays the resulting activity back to the Linear thread).',
  },
  {
    name: 'docket-expired-sessions-sweep',
    path: '/internal/cron/expired-sessions-sweep',
    schedule: '0 * * * *',
    description:
      'Docket: expired-session sweep (deletes session rows past their expiresAt — Better Auth only prunes these lazily).',
  },
  // User schedules have a five-minute floor (AthenaTriggerCreate.scheduleMinutes min 5), so a
  // one-minute sweep keeps a run within a minute of its due time; the row claim and cooldown
  // make an overlapping tick harmless.
  {
    name: 'docket-athena-triggers',
    path: '/internal/cron/athena-triggers',
    schedule: '*/1 * * * *',
    description:
      'Docket: Athena assignment-trigger sweep (runs every due user-owned scheduled trigger).',
  },
  {
    name: 'docket-elicitation-deadlines',
    path: '/internal/cron/elicitation-deadlines',
    schedule: '*/5 * * * *',
    description:
      'Docket: elicitation-deadline sweep (auto-answers derivable overdue questions, parks the rest).',
  },
  // The projection queue is durable, so cadence is purely search staleness; two minutes matches
  // the process-events precedent for user-visible freshness.
  {
    name: 'docket-search-index',
    path: '/internal/cron/search-index',
    schedule: '*/2 * * * *',
    description:
      'Docket: search-index drain (processes durable projection jobs from entity writes and backfills).',
  },
  // Self-limiting backfill: once no legacy row remains, each tick is one indexed scan that finds
  // nothing — hourly is plenty, offset to avoid the top-of-hour pile-up.
  {
    name: 'docket-legacy-mentions',
    path: '/internal/cron/legacy-mentions',
    schedule: '15 * * * *',
    description:
      'Docket: legacy-mention sweep (one-way conversion of prose still holding the old shortcode form).',
  },
  {
    name: 'docket-unfurl-resources',
    path: '/internal/cron/unfurl-resources',
    schedule: '*/5 * * * *',
    description:
      'Docket: resource-unfurl drain (resolves titles/icons/previews for pending referenced URLs).',
  },
  {
    name: 'docket-directive-posture',
    path: '/internal/cron/directive-posture',
    schedule: '*/5 * * * *',
    description:
      "Docket: directive-posture sweep (recomputes each configured Hub's daily posture and notifies subscribed clients only on change).",
  },
  // Matches the posture cadence: a check-in is only worth firing within half an hour of its
  // scheduled moment, and a drifted day should not sit un-re-cut for longer than the posture
  // that noticed it. The `fired_at` claim and the re-cut cooldown make an overlapping tick
  // harmless.
  {
    name: 'docket-day-cadence',
    path: '/internal/cron/day-cadence',
    schedule: '*/5 * * * *',
    description:
      "Docket: day-cadence sweep (materializes each configured Hub's check-ins, re-cuts a drifted day's remainder, and fires every check-in that has come due).",
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────

function run(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

function tryRun(cmd: string): string {
  try {
    return run(cmd);
  } catch {
    return '';
  }
}

function ok(msg: string): void {
  console.log(`  ✓  ${msg}`);
}

function step(msg: string): void {
  console.log(`  →  ${msg}`);
}

function warn(msg: string): void {
  console.log(`  ⚠  ${msg}`);
}

function section(title: string): void {
  const bar = '─'.repeat(Math.max(0, 62 - title.length));
  console.log(`\n── ${title} ${bar}`);
}

/** A captured gcloud outcome — classified instead of crashing the process. */
type GcloudResult =
  | { readonly ok: true; readonly out: string }
  | { readonly ok: false; readonly err: string };

/** Run a gcloud command, capturing stderr so the caller can classify a failure. */
function gcloud(cmd: string): GcloudResult {
  try {
    return { ok: true, out: run(cmd) };
  } catch (e: unknown) {
    return { ok: false, err: gcloudError(e) };
  }
}

/** Pull the most useful message out of an execSync failure. */
function gcloudError(e: unknown): string {
  if (e && typeof e === 'object') {
    const streams = e as { stderr?: Buffer | string; message?: string };
    const stderr = streams.stderr?.toString().trim();
    if (stderr) return stderr;
    if (streams.message) return streams.message;
  }
  return String(e);
}

/**
 * Whether `err` is the expected "one-time setup not applied yet" condition — the Cloud
 * Scheduler API is disabled, or the caller lacks `roles/cloudscheduler.admin` — rather than a
 * real fault. These are resolved once by `pnpm bootstrap`, so we skip (not fail) on them.
 */
function isPrerequisiteError(err: string): boolean {
  const s = err.toLowerCase();
  return (
    s.includes('permission_denied') ||
    s.includes('permission denied') ||
    s.includes('has not been used in project') ||
    s.includes('service_disabled') ||
    s.includes('accessnotconfigured') ||
    (s.includes('cloudscheduler.googleapis.com') && s.includes('disabled')) ||
    /\b403\b/.test(s)
  );
}

/** Single-quote a value for safe `/bin/sh` interpolation (schedules contain `*`). */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`  ✗  ${name} is required (set it in .env.local or pass it in CI).`);
    process.exit(1);
  }
  return value;
}

interface Ctx {
  readonly project: string;
  readonly region: string;
  readonly apiUrl: string;
  readonly dryRun: boolean;
}

/** Build the `gcloud scheduler jobs {create|update} http` command for a job. */
function jobCommand(job: CronJob, ctx: Ctx, secret: string, exists: boolean): string {
  const verb = exists ? 'update' : 'create';
  // `create http` takes `--headers`; `update http` takes `--update-headers`.
  const headerFlag = exists ? '--update-headers' : '--headers';
  return [
    `gcloud scheduler jobs ${verb} http ${job.name}`,
    `--project=${shq(ctx.project)}`,
    `--location=${shq(ctx.region)}`,
    `--schedule=${shq(job.schedule)}`,
    `--uri=${shq(ctx.apiUrl + job.path)}`,
    `--http-method=POST`,
    `--time-zone=${shq('Etc/UTC')}`,
    `--description=${shq(job.description)}`,
    `${headerFlag}=${shq(`x-cron-secret=${secret}`)}`,
    `--quiet`,
  ].join(' ');
}

/** Create-or-update one scheduler job, printing a secret-redacted view of the command. */
function ensureJob(job: CronJob, ctx: Ctx, secret: string): GcloudResult {
  const describe = `gcloud scheduler jobs describe ${job.name} --location=${shq(ctx.region)} --project=${shq(ctx.project)} --format='value(name)'`;
  const exists = ctx.dryRun ? false : Boolean(tryRun(describe));
  const verb = exists ? 'update' : 'create';

  step(`${verb} ${job.name}  (${job.schedule} → ${job.path})`);
  console.log(`     ${jobCommand(job, ctx, SECRET_REDACTED, exists)}`);

  if (ctx.dryRun) return { ok: true, out: '' };

  const res = gcloud(jobCommand(job, ctx, secret, exists));
  if (res.ok) ok(`${verb}d ${job.name}`);
  return res;
}

/**
 * Handle a failed gcloud step: skip (exit 0) on the expected pre-bootstrap prerequisites,
 * fail (exit 1) on anything else. Never returns.
 */
function failOrSkip(action: string, err: string): never {
  const excerpt = err.split('\n').slice(0, 4).join('\n      ');
  if (isPrerequisiteError(err)) {
    section('Skipped — prerequisites not applied yet');
    warn(`Could not ${action}: the account lacks Cloud Scheduler access or the API is off.`);
    warn('Run `pnpm bootstrap` (enables cloudscheduler.googleapis.com and grants');
    warn('roles/cloudscheduler.admin to the deploy service account), then re-run / redeploy.');
    console.log(`\n      ${excerpt}`);
    warn('Connectors will NOT auto-sync until this is resolved (manual sync still works).');
    process.exit(0);
  }
  section('Failed');
  console.error(`  ✗  Could not ${action}.`);
  console.error(`      ${excerpt}`);
  process.exit(1);
}

/** The route file the drift check reads, relative to the repo root. */
export const CRON_ROUTES_FILE = 'apps/api/src/routes/cron.ts';

/** Parse the cron paths (`.post('/name'`) out of the cron route file's source. */
export function parseCronRoutes(source: string): readonly string[] {
  const routes: string[] = [];
  for (const match of source.matchAll(/\.post\(\s*'\/([A-Za-z0-9-]+)'/g)) {
    const name = match[1];
    if (name) routes.push(`/internal/cron/${name}`);
  }
  return routes;
}

/** Routes and jobs that fail to line up: `unscheduled` never runs, `dangling` POSTs a 404. */
export interface RouteDrift {
  readonly unscheduled: readonly string[];
  readonly dangling: readonly string[];
}

/** Compare the declared routes against the job paths. Pure so the tests can pin it. */
export function computeRouteDrift(
  routes: readonly string[],
  jobs: readonly Pick<CronJob, 'path'>[],
): RouteDrift {
  const routeSet = new Set(routes);
  const scheduled = new Set(jobs.map((job) => job.path));
  return {
    unscheduled: routes.filter((route) => !scheduled.has(route)),
    dangling: jobs.map((job) => job.path).filter((jobPath) => !routeSet.has(jobPath)),
  };
}

/**
 * Warn when `cron.ts` and `JOBS` disagree. The two are hand-maintained views of the same set,
 * and five routes once shipped without a job entry — every scheduled behavior behind them was
 * silently dead in prod. Warn-only: provisioning the jobs that do line up is still worth doing,
 * and the warning surfaces in every deploy log and every manual run.
 */
function warnOnRouteDrift(): void {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let source: string;
  try {
    source = readFileSync(path.join(repoRoot, CRON_ROUTES_FILE), 'utf8');
  } catch {
    warn(`drift check skipped — could not read ${CRON_ROUTES_FILE}`);
    return;
  }
  const drift = computeRouteDrift(parseCronRoutes(source), JOBS);
  for (const route of drift.unscheduled) {
    warn(`cron route ${route} has no scheduler job — it never runs in prod. Add it to JOBS.`);
  }
  for (const jobPath of drift.dangling) {
    warn(`job targets ${jobPath}, but ${CRON_ROUTES_FILE} declares no such route.`);
  }
}

// ── main ───────────────────────────────────────────────────────────────────────

function main(): void {
  const dryRun = process.argv.includes('--dry-run') || process.env['DRY_RUN'] === '1';

  const ctx: Ctx = {
    project: requireEnv('GCP_PROJECT_ID'),
    region: requireEnv('GCP_REGION'),
    // Trim a trailing slash so `${apiUrl}${path}` never doubles up.
    apiUrl: requireEnv('API_URL').replace(/\/+$/, ''),
    dryRun,
  };

  section(`Cloud Scheduler — ${ctx.project} / ${ctx.region}${dryRun ? '  (dry run)' : ''}`);
  console.log(`  API host: ${ctx.apiUrl}`);

  warnOnRouteDrift();

  let secret = SECRET_REDACTED;
  if (!dryRun) {
    const secretRes = gcloud(
      `gcloud secrets versions access latest --secret=${SECRET_NAME} --project=${shq(ctx.project)}`,
    );
    if (!secretRes.ok) failOrSkip(`read secret ${SECRET_NAME}`, secretRes.err);
    secret = secretRes.out;
    if (!secret) {
      console.error(`  ✗  secret ${SECRET_NAME} is empty — run pnpm bootstrap first.`);
      process.exit(1);
    }
  }

  for (const job of JOBS) {
    const res = ensureJob(job, ctx, secret);
    if (!res.ok) failOrSkip(`provision ${job.name}`, res.err);
  }

  section('Done');
  ok(`${JOBS.length} scheduler job(s) ${dryRun ? 'planned' : 'provisioned'}`);
  if (dryRun) console.log('  (dry run — no GCP calls were made)');
}

// Self-invoke only when run directly (the tests import JOBS and the drift helpers).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}

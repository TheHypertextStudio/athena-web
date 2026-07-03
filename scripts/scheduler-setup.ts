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
import process from 'node:process';

/** The Secret Manager secret holding the shared `CRON_SECRET` (created by `pnpm bootstrap`). */
const SECRET_NAME = 'docket-cron-secret';
const SECRET_REDACTED = '***REDACTED***';

/** A scheduled HTTP cron job: an endpoint to hit and how often. */
interface CronJob {
  /** Cloud Scheduler job id. */
  readonly name: string;
  /** Path under the API host to POST (joined with `API_URL`). */
  readonly path: string;
  /** Unix-cron schedule (interpreted in `Etc/UTC`). */
  readonly schedule: string;
  /** Human description stored on the job. */
  readonly description: string;
}

/** The jobs Docket needs. Both target secret-guarded, idempotent, retry-safe sweeps. */
const JOBS: readonly CronJob[] = [
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

main();

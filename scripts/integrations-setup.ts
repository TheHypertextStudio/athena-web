/**
 * `pnpm integrations` — turnkey, environment-aware setup for every third-party
 * integration Docket talks to (OAuth providers, Stripe, Anthropic, email, observability).
 *
 * @remarks
 * Implements the interactive credential flow designed in
 * `docs/engineering/specs/env-and-bootstrap.md` §3.4 and generalizes it to every external
 * credential in the {@link VAR_REGISTRY}. For each provider it prints explicit, copy-pasteable
 * instructions (exact console URL, the exact redirect URI for the chosen environment, the
 * APIs/scopes to enable), then collects values via `@clack/prompts` — real `password()` masking
 * and `select()`/`multiselect()` menus, with each value validated against its own zod schema.
 *
 * Writes are routed by environment:
 *   - `local`               → upsert into the root `.env.local` (non-destructive).
 *   - `staging`/`production`→ server vars to GCP Secret Manager (the `docket-…` /
 *                             `docket-staging-…` names Cloud Run mounts in `deploy.yml`);
 *                             public `NEXT_PUBLIC_*` vars to GitHub environment variables.
 *
 * Credentials are never shared across environments: each environment is configured in its
 * own pass with its own OAuth apps / Stripe mode and its own redirect URIs.
 *
 * Runnable standalone (`pnpm integrations`) or invoked from {@link runIntegrationSetup} by
 * `scripts/bootstrap.ts`.
 */

import { execSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import {
  cancel,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  password,
  select,
  text,
} from '@clack/prompts';

import { findVar } from '../packages/env/src/registry';
import type { VarSpec } from '../packages/env/src/registry';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── prompt + console helpers (all via @clack/prompts) ──────────────────────────

/** Exit cleanly when a clack prompt is cancelled (Ctrl-C); otherwise return its value. */
export function unwrap<T>(value: T | symbol, message = 'Cancelled.'): T {
  if (isCancel(value)) {
    cancel(message);
    process.exit(0);
  }
  return value;
}

function ok(msg: string): void {
  log.success(msg);
}

function warn(msg: string): void {
  log.warn(msg);
}

/** Run a command, returning its trimmed stdout, or '' if it fails (never throws). */
export function tryRun(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return '';
  }
}

/** Run a command with inherited stdio (streams output); throws on failure. */
export function exec(cmd: string): void {
  execSync(cmd, { encoding: 'utf8', stdio: 'inherit' });
}

/** `owner/repo` from the git `origin` remote, or '' if not a GitHub remote. */
export function detectRepo(): string {
  const remote = tryRun('git remote get-url origin');
  return /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote)?.[1] ?? '';
}

/** The value for `key` if present and non-empty, else undefined. */
function nonEmpty(record: Record<string, string>, key: string): string | undefined {
  const v = record[key];
  return v && v.length > 0 ? v : undefined;
}

// ── env-file upsert (non-destructive) ────────────────────────────────────────────

/**
 * Merge `kv` into the env file at `path`, replacing existing keys in place and appending
 * new ones. Preserves comments, ordering, and untouched keys. Writes atomically.
 *
 * @param path - Absolute path to the `.env` file (created if absent).
 * @param kv - Keys to set; empty-string values are skipped (a skip never clears a key).
 */
export function upsertEnvVars(path: string, kv: Record<string, string>): void {
  let existing: string;
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    existing = '';
  }
  const lines = existing.length > 0 ? existing.split('\n') : [];
  const remaining = new Map(Object.entries(kv).filter(([, v]) => v !== ''));

  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (remaining.has(key)) {
      const value = remaining.get(key) ?? '';
      remaining.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });

  // Drop trailing blank lines so appended keys don't get an orphaned gap before them.
  while (next.length > 0 && next[next.length - 1]?.trim() === '') next.pop();
  for (const [key, value] of remaining) next.push(`${key}=${value}`);

  const body = next.join('\n').replace(/\n*$/, '\n');
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
}

/** Minimal `.env` parser (KEY=VALUE, `#` comments, optional quotes); keeps empty values. */
export function parseEnvFile(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const val = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) out[key] = val;
  }
  return out;
}

// ── environments ────────────────────────────────────────────────────────────────

export type Environment = 'local' | 'staging' | 'production';

/**
 * Fallback local API origin (Better Auth base) when `.env.local` has none — matches the
 * project's portless convention (`https://api.docket.localhost`), NOT a bare `localhost:port`.
 */
const DEFAULT_LOCAL_API_URL = 'https://api.docket.localhost';

/**
 * GCP Secret Manager name for a var in a given environment. Production keeps the existing
 * unqualified `docket-…` names (so `deploy.yml` is unchanged); staging is suffixed.
 */
function secretName(env: Environment, varName: string): string {
  const kebab = varName.toLowerCase().replace(/_/g, '-');
  return env === 'production' ? `docket-${kebab}` : `docket-${env}-${kebab}`;
}

// ── provider groups (curated order + DX copy; metadata comes from the registry) ──

interface ProviderGroup {
  readonly title: string;
  /** Registry var names to prompt for, in order. */
  readonly vars: readonly string[];
  /** Explicit, copy-pasteable setup instructions for the chosen environment. */
  readonly instructions: (env: Environment, base: string) => readonly string[];
}

/** Suggested OAuth-app name so each environment gets its own clearly-labelled app. */
function appName(env: Environment): string {
  return `Docket (${env})`;
}

const PROVIDER_GROUPS: readonly ProviderGroup[] = [
  {
    title: 'Google — sign-in + Drive / Gmail / Calendar / Tasks connectors',
    vars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    instructions: (env, base) => [
      'Creates an OAuth 2.0 Web-application client. ~5 min. You need a Google account.',
      '',
      '1) Open https://console.cloud.google.com/ and sign in.',
      '2) Top bar → project picker → "New Project" → Name: "Docket" → Create, then make sure',
      '   that project is selected in the picker.',
      '3) Enable the APIs you need: ☰ menu → "APIs & Services" → "Library". Search each, open it,',
      '   click "Enable":',
      '     • "Google People API"   (required — sign-in profile)',
      '     • "Google Drive API", "Gmail API", "Google Calendar API", "Google Tasks API"',
      '       (only the connectors you plan to use)',
      '4) Configure the consent screen (first time only): "APIs & Services" → "OAuth consent screen".',
      '     • User type: "External" (or "Internal" if this is a Google Workspace org) → Create',
      '     • App name: "Docket", User support email: you, Developer contact email: you → Save',
      '     • Scopes: add ".../auth/userinfo.email", ".../auth/userinfo.profile", "openid"',
      '       (+ drive/gmail/calendar/tasks scopes if you enabled those APIs) → Save',
      '     • If the app is in "Testing", add your Google address under "Test users".',
      '5) Create the credential: "APIs & Services" → "Credentials" → "+ Create credentials" →',
      '   "OAuth client ID" → Application type: "Web application" →',
      `   Name: "${appName(env)}".`,
      '6) Under "Authorized redirect URIs" click "+ Add URI" and paste exactly, no trailing slash:',
      `     ${base}/api/auth/callback/google`,
      '7) Click "Create". A dialog shows "Your Client ID" and "Your Client Secret".',
      '8) Copy both now (you can re-open them later from the Credentials list) and paste below.',
    ],
  },
  {
    title: 'GitHub — sign-in + GitHub connector',
    vars: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
    instructions: (env, base) => [
      'Creates a GitHub OAuth App. ~2 min. GitHub allows ONE callback URL per app, so create a',
      'separate app per environment.',
      '',
      '1) Open https://github.com/settings/developers (for an org instead:',
      '   https://github.com/organizations/<org>/settings/applications).',
      '2) Select the "OAuth Apps" tab → click "New OAuth App".',
      `3) Application name: "${appName(env)}".`,
      `4) Homepage URL: ${base}`,
      '5) Authorization callback URL — paste exactly, no trailing slash:',
      `     ${base}/api/auth/callback/github`,
      '6) Leave "Enable Device Flow" unchecked → click "Register application".',
      '7) On the app page, copy the "Client ID".',
      '8) Click "Generate a new client secret" → copy it IMMEDIATELY (GitHub shows it once).',
      '9) Paste both below.',
    ],
  },
  {
    title: 'Linear — sign-in + Linear issue migration',
    vars: ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET'],
    instructions: (env, base) => [
      'Creates a Linear OAuth2 application. ~2 min. You need a Linear workspace admin.',
      '',
      '1) Open https://linear.app/settings/api/applications/new',
      '   (or: Linear → workspace menu (top-left) → Settings → "API" → "OAuth applications" →',
      '   "Create new").',
      `2) Application name: "${appName(env)}". Add a developer name + icon if it asks.`,
      '3) Callback URLs — paste exactly, no trailing slash:',
      `     ${base}/api/auth/oauth2/callback/linear`,
      '4) Scopes: tick "read" (required for sign-in). For the issue-migration feature also tick',
      '   "write" and "issues:create".',
      '5) Keep the app private (untick "Public") unless you intend multi-workspace installs → "Create".',
      '6) Copy the "Client ID" and "Client secret" shown, and paste below.',
    ],
  },
  {
    title: 'Stripe — billing (subscriptions + webhooks)',
    vars: ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'],
    instructions: (env, base) => {
      const mode = env === 'production' ? 'live' : 'test';
      const lines = [
        `Use ${mode}-mode keys for the "${env}" environment. Never mix test and live across envs.`,
        '',
        '1) Open https://dashboard.stripe.com and sign in.',
        `2) Top-right toggle: switch to ${mode} mode (the "Test mode" switch must show "${mode}").`,
        '3) API keys: Developers → API keys (https://dashboard.stripe.com/apikeys).',
        `     • Copy "Secret key"      → starts with ${env === 'production' ? 'sk_live_' : 'sk_test_'}`,
        `     • Copy "Publishable key" → starts with ${env === 'production' ? 'pk_live_' : 'pk_test_'}`,
        '4) Webhook signing secret (whsec_…):',
      ];
      if (env === 'local') {
        lines.push(
          '     • Install the Stripe CLI (https://stripe.com/docs/stripe-cli), then in a SEPARATE',
          '       terminal run:',
          '           stripe login',
          `           stripe listen --forward-to ${base}/api/auth/stripe/webhook`,
          '     • It prints "Ready! ... whsec_…" — copy that whsec_ value.',
          '     • Keep that terminal running while developing so webhooks reach your local API.',
        );
      } else {
        lines.push(
          '     • Developers → Webhooks → "Add endpoint".',
          `     • Endpoint URL (paste exactly): ${base}/api/auth/stripe/webhook`,
          '     • "Select events" → add: checkout.session.completed, customer.subscription.created,',
          '       customer.subscription.updated, customer.subscription.deleted, invoice.paid,',
          '       invoice.payment_failed → "Add endpoint".',
          '     • Open the new endpoint → "Signing secret" → "Reveal" → copy the whsec_… value.',
        );
      }
      lines.push(
        '',
        'Note: plan prices (DOCKET_PRICE_LOOKUP_*) are created separately via the Stripe CLI/',
        'dashboard and are not collected here. Leave all three blank to keep billing on the mock.',
      );
      return lines;
    },
  },
  {
    title: 'Anthropic — built-in Athena agent (optional)',
    vars: ['ANTHROPIC_API_KEY'],
    instructions: (env) => [
      'Powers real Athena/Claude turns. Optional — blank keeps the deterministic mock runtime',
      '(local/test always use the mock regardless of this key).',
      '',
      '1) Open https://console.anthropic.com and sign in.',
      '2) Ensure the workspace has billing/credits (Settings → Billing).',
      '3) Settings → "API keys" → "Create Key".',
      `4) Name it "${appName(env)}" → Create → copy the key (starts with sk-ant-…, shown once).`,
      '5) Paste below, or leave blank to skip.',
    ],
  },
  {
    title: 'Transactional email (SMTP) — optional',
    vars: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'],
    instructions: (env) =>
      env === 'local'
        ? [
            'Local dev uses Mailpit — a fake SMTP server with a web inbox. Blank SMTP_HOST keeps the',
            'no-op mock mailer (emails are just logged).',
            '',
            '1) Start Mailpit (pick one):',
            '     • Docker:  docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit',
            '     • Homebrew: brew install mailpit && mailpit',
            '2) Enter at the prompts below:',
            '     • SMTP_HOST = localhost',
            '     • SMTP_PORT = 1025',
            '     • SMTP_USER / SMTP_PASS = leave blank (Mailpit needs no auth)',
            '     • MAIL_FROM = "Docket <dev@docket.localhost>"',
            '3) View captured email at http://localhost:8025.',
          ]
        : [
            'Use a transactional email provider (Resend, Postmark, Amazon SES, Mailgun, …). Blank',
            'SMTP_HOST keeps the no-op mock mailer.',
            '',
            '1) In your provider, create SMTP credentials and verify a sending domain/address.',
            '2) Enter at the prompts below:',
            '     • SMTP_HOST = the provider host (e.g. smtp.resend.com)',
            '     • SMTP_PORT = 465 (implicit TLS) or 587 (STARTTLS) per the provider',
            '     • SMTP_USER / SMTP_PASS = the provider SMTP username + password/API key',
            '     • MAIL_FROM = a VERIFIED sender, e.g. "Docket <no-reply@your-domain.com>"',
          ],
  },
  {
    title: 'Observability & storage — optional',
    vars: ['SENTRY_DSN', 'BLOB_READ_WRITE_TOKEN', 'EXPORT_BUCKET_URL', 'EXPORT_BUCKET_TOKEN'],
    instructions: () => [
      'All optional. Leave blank to disable each.',
      '',
      'Sentry (error reporting):',
      '  1) https://sentry.io → create/select a project (platform: Node).',
      '  2) Settings → "Client Keys (DSN)" → copy the DSN (https://…@…ingest.sentry.io/…).',
      '',
      'Export storage (only if you use data-export artifacts — provide URL + token together):',
      '  • BLOB_READ_WRITE_TOKEN: Vercel → Storage → Blob → "Read/Write Token".',
      '  • EXPORT_BUCKET_URL + EXPORT_BUCKET_TOKEN: your S3-compatible bucket endpoint + access token.',
    ],
  },
];

// ── core: per-var prompt with schema validation ──────────────────────────────────

interface PromptContext {
  readonly env: Environment;
  /** Current value (from `.env.local` for local, or an existing secret for cloud). */
  readonly current?: string;
}

/**
 * Prompt for one registry var. Empty input keeps the current value (if any) or skips. Each
 * non-empty value is validated against the var's zod schema (clack re-asks on failure).
 *
 * @returns the accepted value, or `undefined` when skipped/left blank.
 */
async function promptVar(spec: VarSpec, ctx: PromptContext): Promise<string | undefined> {
  const message = `${spec.name} — ${spec.where}${ctx.current ? ' (blank = keep current)' : ''}`;
  const validate = (value: string | undefined): string | undefined => {
    if (!value) return undefined; // empty = skip / keep current
    const result = spec.zod.safeParse(value);
    return result.success ? undefined : result.error.issues.map((i) => i.message).join('; ');
  };

  const answer = spec.sensitive
    ? unwrap(await password({ message, validate }))
    : unwrap(
        await text({
          message,
          defaultValue: ctx.current ?? '',
          placeholder: ctx.current ?? '(blank to skip)',
          validate,
        }),
      );

  const value = answer.trim();
  return value || ctx.current;
}

// ── auth account selection (gcloud + gh) ─────────────────────────────────────────

/** An authenticated CLI account (gcloud email or gh login) and whether it is active. */
export interface Account {
  readonly id: string;
  readonly active: boolean;
}

/** The active account's id, or the first, or '' — the natural default selection. */
function activeId(accounts: readonly Account[]): string {
  return accounts.find((a) => a.active)?.id ?? accounts[0]?.id ?? '';
}

let gcloudAccountsCache: Account[] | undefined;
let ghAccountsCache: Account[] | undefined;

/** Every authenticated gcloud account (memoized — the set is stable within one run). */
export function listGcloudAccounts(): Account[] {
  if (gcloudAccountsCache) return gcloudAccountsCache;
  const result: Account[] = [];
  const json = tryRun('gcloud auth list --format=json 2>/dev/null');
  let parsed: unknown;
  try {
    parsed = json ? JSON.parse(json) : [];
  } catch {
    parsed = [];
  }
  if (Array.isArray(parsed)) {
    for (const entry of parsed as unknown[]) {
      if (typeof entry !== 'object' || entry === null) continue;
      if (!('account' in entry) || typeof entry.account !== 'string') continue;
      const status = 'status' in entry && typeof entry.status === 'string' ? entry.status : '';
      result.push({ id: entry.account, active: status.toUpperCase() === 'ACTIVE' });
    }
  }
  gcloudAccountsCache = result;
  return result;
}

/** Every authenticated gh account for github.com (memoized), parsed from `gh auth status`. */
export function listGhAccounts(): Account[] {
  if (ghAccountsCache) return ghAccountsCache;
  const out = tryRun('gh auth status --hostname github.com 2>&1');
  const accounts: { id: string; active: boolean }[] = [];
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    const loggedIn = /Logged in to \S+ account (\S+)/.exec(line);
    if (loggedIn?.[1]) {
      accounts.push({ id: loggedIn[1], active: false });
      continue;
    }
    if (/Active account:\s*true/i.test(line)) {
      const last = accounts[accounts.length - 1];
      if (last) last.active = true;
    }
  }
  if (accounts.length === 0) {
    // Older gh phrasing: "Logged in to github.com as <user>".
    const legacy = /Logged in to \S+ as (\S+)/.exec(out);
    if (legacy?.[1]) accounts.push({ id: legacy[1], active: true });
  }
  ghAccountsCache = accounts;
  return accounts;
}

/** Pick one account id from a list — defaults to active, only prompting when there's a choice. */
async function chooseAccount(message: string, accounts: readonly Account[]): Promise<string> {
  const active = activeId(accounts);
  if (accounts.length <= 1) return active;
  return unwrap(
    await select<string>({
      message,
      initialValue: active,
      options: accounts.map((a) => ({
        value: a.id,
        label: a.id,
        hint: a.active ? 'active' : undefined,
      })),
    }),
  );
}

/**
 * Confirm which gcloud + gh accounts to use — never silently assume the active one.
 *
 * @remarks
 * Sets `CLOUDSDK_CORE_ACCOUNT` for this process (and its child `gcloud` calls) rather than
 * mutating the user's global gcloud config. For gh it switches the active account only when a
 * different one is chosen.
 */
export async function confirmAuthAccounts(): Promise<void> {
  const gcloud = listGcloudAccounts();
  if (gcloud.length === 0) {
    warn('no authenticated gcloud account — run: gcloud auth login (cloud writes will fail)');
  } else {
    const chosen = await chooseAccount('Which gcloud account?', gcloud);
    process.env['CLOUDSDK_CORE_ACCOUNT'] = chosen;
    ok(`gcloud account: ${chosen}`);
  }

  const gh = listGhAccounts();
  if (gh.length === 0) {
    warn('no authenticated gh account — run: gh auth login (GitHub writes will fail)');
  } else {
    const before = activeId(gh);
    const chosen = await chooseAccount('Which GitHub (gh) account?', gh);
    if (chosen && chosen !== before) {
      exec(`gh auth switch --hostname github.com --user ${chosen}`);
      ok(`gh account switched to: ${chosen}`);
    } else {
      ok(`gh account: ${chosen}`);
    }
  }
}

// ── project selection ────────────────────────────────────────────────────────────

/** Sentinel option value meaning "let me type an id that isn't in the list". */
const MANUAL_PROJECT = '__manual__';

let gcloudProjectsCache: string[] | undefined;

/** GCP project ids the chosen account can access (memoized; empty if none/unavailable). */
function listGcloudProjects(): string[] {
  if (gcloudProjectsCache) return gcloudProjectsCache;
  const out = tryRun(
    'gcloud projects list --format="value(projectId)" --sort-by=projectId 2>/dev/null',
  );
  gcloudProjectsCache = out
    ? out
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  return gcloudProjectsCache;
}

/**
 * Pick a GCP project — never just assume the config default. Presents a menu of the projects
 * the active account can access (current flagged), plus a manual-entry option; falls back to a
 * plain prompt when the list can't be fetched.
 *
 * @param fallback - The default project (e.g. `gcloud config get-value project`).
 * @param label - What the project is for (e.g. `'staging'`), shown in the prompt.
 */
export async function chooseGcloudProject(fallback: string, label = ''): Promise<string> {
  const suffix = label ? ` for ${label}` : '';
  const typeId = async (): Promise<string> =>
    unwrap(
      await text({
        message: `GCP project id${suffix}`,
        defaultValue: fallback,
        placeholder: fallback || 'my-gcp-project',
      }),
    );

  const projects = listGcloudProjects();
  if (projects.length === 0) return typeId();

  const chosen = unwrap(
    await select<string>({
      message: `Which GCP project${suffix}?`,
      initialValue: fallback !== '' ? fallback : (projects[0] ?? ''),
      options: [
        ...projects.map((p) => ({
          value: p,
          label: p,
          hint: p === fallback ? 'current' : undefined,
        })),
        { value: MANUAL_PROJECT, label: '✎ Enter a different project id…' },
      ],
    }),
  );
  return chosen === MANUAL_PROJECT ? typeId() : chosen;
}

// ── cloud writers ────────────────────────────────────────────────────────────────

interface CloudTarget {
  readonly repo: string;
  readonly project: string;
}

/**
 * Create or add a new version of a GCP Secret Manager secret (re-runs rotate, never error).
 *
 * @remarks
 * The value is piped via stdin (`--data-file=-`) so a prod/staging secret is held only in memory
 * and written straight to Secret Manager — it never touches local disk or the process arg list.
 */
function pushSecret(env: Environment, target: CloudTarget, varName: string, value: string): void {
  const name = secretName(env, varName);
  const exists = tryRun(
    `gcloud secrets describe ${name} --project=${target.project} --format='value(name)'`,
  );
  const action = exists
    ? `secrets versions add ${name} --project=${target.project}`
    : `secrets create ${name} --project=${target.project} --replication-policy=automatic`;
  execSync(`gcloud ${action} --data-file=-`, {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  ok(`${varName} → secret ${name} (${exists ? 'new version' : 'created'})`);
}

/** Set a GitHub environment-scoped repo variable (for public NEXT_PUBLIC_* build args). */
function pushVariable(env: Environment, target: CloudTarget, key: string, value: string): void {
  // GitHub environment names are typically the env label; staging/production map 1:1.
  exec(`gh variable set ${key} --env ${env} --repo ${target.repo} --body ${JSON.stringify(value)}`);
  ok(`${key} → GitHub ${env} variable`);
}

// ── per-environment setup pass ───────────────────────────────────────────────────

interface SetupOptions {
  /** GitHub owner/repo for cloud writes (detected from git when omitted). */
  readonly repo?: string;
  /** Default GCP project id to seed cloud prompts (e.g. bootstrap's chosen project). */
  readonly defaultProject?: string;
  /** Set when the caller (bootstrap) has already confirmed gcloud/gh accounts. */
  readonly authConfirmed?: boolean;
  /** Set when invoked inside another clack flow (bootstrap) — suppresses our own intro/outro. */
  readonly embedded?: boolean;
  /** Pre-scope the environments to configure; when set, the multiselect prompt is skipped. */
  readonly environments?: Environment[];
}

/**
 * Resolve the API base URL for an environment (drives the OAuth redirect URIs).
 *
 * @remarks
 * `local` is derived from the user's actual `.env.local` (Better Auth base → API → public URL),
 * defaulting to the project's portless `https://api.docket.localhost` — never a hardcoded
 * `localhost:port` — and is offered for confirmation. `staging`/`production` read the GitHub
 * environment's `API_URL`, falling back to a prompt.
 */
async function resolveBaseUrl(
  env: Environment,
  repo: string,
  envLocal: Record<string, string>,
): Promise<string> {
  if (env === 'local') {
    const def =
      nonEmpty(envLocal, 'BETTER_AUTH_URL') ??
      nonEmpty(envLocal, 'API_URL') ??
      nonEmpty(envLocal, 'NEXT_PUBLIC_API_URL') ??
      DEFAULT_LOCAL_API_URL;
    return unwrap(
      await text({
        message: 'Local API base URL (used for OAuth redirect URIs)',
        defaultValue: def,
        placeholder: def,
      }),
    );
  }
  const fromGh = repo ? tryRun(`gh variable get API_URL --env ${env} --repo ${repo}`) : '';
  if (fromGh) {
    ok(`${env} API_URL from GitHub: ${fromGh}`);
    return fromGh;
  }
  return unwrap(
    await text({
      message: `API base URL for ${env}`,
      placeholder: 'https://api.docket.app',
      validate: (v) => (v && v.length > 0 ? undefined : 'required'),
    }),
  );
}

/** Configure every provider for a single environment. */
async function setupEnvironment(
  env: Environment,
  repo: string,
  defaultProject: string,
): Promise<void> {
  note(
    env === 'local'
      ? 'These are local dev values. They are written to your .env.local on this machine only.'
      : `These are ${env} values. They are pushed straight to GCP Secret Manager / GitHub and\n` +
          'are not written to any local file.',
    `Environment: ${env}`,
  );

  // Parse .env.local once (only local reads it) and reuse for the base URL + keep-existing defaults.
  const envLocal = env === 'local' ? parseEnvFile(resolve(ROOT, '.env.local')) : {};
  const base = await resolveBaseUrl(env, repo, envLocal);

  // Cloud targets resolve a GCP project + repo once per environment.
  let cloud: CloudTarget | undefined;
  if (env !== 'local') {
    const repoForCloud =
      repo || unwrap(await text({ message: 'GitHub owner/repo', placeholder: 'owner/repo' }));
    const project = await chooseGcloudProject(defaultProject, env);
    if (!repoForCloud || !project) {
      warn(`skipping ${env} cloud writes — repo/project not provided`);
    } else {
      cloud = { repo: repoForCloud, project };
    }
  }

  const deployHints: string[] = [];

  for (const group of PROVIDER_GROUPS) {
    note(
      [...group.instructions(env, base), '', 'Leave a field blank to skip it.'].join('\n'),
      group.title,
    );

    const collected: Record<string, string> = {};
    for (const varName of group.vars) {
      const spec = findVar(varName);
      if (!spec) {
        warn(`unknown var ${varName} (registry drift) — skipping`);
        continue;
      }
      const current = nonEmpty(envLocal, varName);
      const value = await promptVar(spec, { env, current });
      if (value !== undefined && value !== current) {
        collected[varName] = value;
      }
    }

    if (Object.keys(collected).length === 0) continue;

    if (env === 'local') {
      upsertEnvVars(resolve(ROOT, '.env.local'), collected);
      ok(`wrote ${Object.keys(collected).join(', ')} to .env.local`);
    } else if (cloud) {
      for (const [name, value] of Object.entries(collected)) {
        const spec = findVar(name);
        if (spec?.scope === 'client') {
          pushVariable(env, cloud, name, value);
          deployHints.push(`  build-arg (web/admin): ${name}=\${{ vars.${name} }}`);
        } else {
          pushSecret(env, cloud, name, value);
          deployHints.push(`  secrets: ${name}=${secretName(env, name)}:latest`);
        }
      }
    }
  }

  if (deployHints.length > 0) {
    note(
      [
        'Add any NEW lines below to the docket-api (and web/admin) deploy steps:',
        '',
        ...new Set(deployHints),
      ].join('\n'),
      `${env}: wire these into .github/workflows/deploy.yml`,
    );
  }
}

// ── entrypoint ───────────────────────────────────────────────────────────────────

/**
 * Run the interactive integration setup across one or more environments.
 *
 * @param opts - Optional repo, default GCP project, and auth-confirmed flag (see {@link SetupOptions}).
 */
export async function runIntegrationSetup(opts: SetupOptions = {}): Promise<void> {
  if (!opts.embedded) {
    intro('Docket integrations — OAuth providers, Stripe, Anthropic, email, observability');
  }

  const repo = opts.repo ?? detectRepo();

  // The caller may pre-scope the environments (bootstrap drives one per phase); otherwise ask.
  const chosen =
    opts.environments ??
    unwrap(
      await multiselect<Environment>({
        message: 'Which environments to configure? (each uses its own credentials)',
        initialValues: ['local'],
        required: true,
        options: [
          { value: 'local', label: 'local', hint: 'writes .env.local' },
          { value: 'staging', label: 'staging', hint: 'GCP Secret Manager + GitHub env' },
          { value: 'production', label: 'production', hint: 'GCP Secret Manager + GitHub env' },
        ],
      }),
    );

  // Confirm gcloud/gh accounts before any cloud writes (never assume the active one).
  const needsCloud = chosen.some((env) => env !== 'local');
  if (needsCloud && !opts.authConfirmed) await confirmAuthAccounts();
  const defaultProject =
    opts.defaultProject ?? (needsCloud ? tryRun('gcloud config get-value project') : '');

  for (const env of chosen) {
    await setupEnvironment(env, repo, defaultProject);
  }

  const doneMsg = chosen.includes('local')
    ? 'Integrations done — run `pnpm env:check` to validate the local contract.'
    : 'Integrations done.';
  if (opts.embedded) {
    ok(doneMsg);
  } else {
    outro(doneMsg);
  }
}

// Self-invoke only when run directly (not when imported by bootstrap).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runIntegrationSetup().catch((err: unknown) => {
    log.error(`Integration setup failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

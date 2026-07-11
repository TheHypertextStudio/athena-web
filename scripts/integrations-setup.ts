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

import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import {
  cancel,
  confirm,
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
import {
  PROVIDER_GROUPS,
  providerVars,
  DEFAULT_LOCAL_API_URL,
  copyToClipboard,
  type Environment,
  type ProviderGroup,
  type ProviderId,
  type ProviderStep,
  type SetupUrls,
} from './integration-providers';

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

/**
 * GCP Secret Manager name for a var in a given environment. Production keeps the existing
 * unqualified `docket-…` names (so `deploy.yml` is unchanged); staging is suffixed.
 */
function secretName(env: Environment, varName: string): string {
  const kebab = varName.toLowerCase().replace(/_/g, '-');
  return env === 'production' ? `docket-${kebab}` : `docket-${env}-${kebab}`;
}

// ── note rendering (word-wrap so clack boxes never overflow the terminal) ────────

/** Safe content width for a clack `note()` box on the current terminal. */
function noteWidth(): number {
  // `process.stdout.columns` is typed `number` but is `undefined` on a non-TTY at runtime.
  const cols = Number.isFinite(process.stdout.columns) ? process.stdout.columns : 80;
  return Math.max(40, Math.min(cols - 8, 84));
}

/**
 * Word-wrap each line to fit inside a clack `note()` box on the current terminal.
 *
 * @remarks
 * clack's `note()` sizes its frame to the widest line and does NOT wrap, so any line
 * wider than the terminal overflows and the terminal hard-wraps it mid-word, shattering
 * the box border. Pre-wrapping at word boundaries keeps every line within the frame; each
 * line's leading indentation is preserved so numbered/bulleted structure stays aligned.
 */
export function wrapLines(lines: readonly string[], width = noteWidth()): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const indent = /^\s*/.exec(line)?.[0] ?? '';
    const body = line.slice(indent.length);
    if (body === '' || indent.length + body.length <= width) {
      out.push(line);
      continue;
    }
    // Hang-indent continuation lines under a leading bullet/number marker so wrapped
    // list items align under their text rather than back at the bullet.
    const marker = /^(?:[•\-*]\s+|\d+[).]\s+)/.exec(body)?.[0] ?? '';
    const hang = indent + ' '.repeat(marker.length);
    const segments: string[] = [];
    let current = '';
    for (const word of body.split(' ')) {
      let remainder = word;
      while (remainder !== '') {
        const pad = (segments.length === 0 ? indent : hang).length;
        const available = Math.max(1, width - pad);
        if (current !== '' && current.length + 1 + remainder.length <= available) {
          current += ` ${remainder}`;
          remainder = '';
        } else if (current !== '') {
          segments.push(current);
          current = '';
        } else if (remainder.length <= available) {
          current = remainder;
          remainder = '';
        } else {
          segments.push(remainder.slice(0, available));
          remainder = remainder.slice(available);
        }
      }
    }
    if (current !== '') segments.push(current);
    segments.forEach((seg, i) => out.push((i === 0 ? indent : hang) + seg));
  }
  return out;
}

/** Split a numbered provider guide into operator-sized actions while preserving its preamble. */
export function splitInstructionSteps(lines: readonly string[]): ProviderStep[] {
  const steps: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^\s*\d+\)/.test(line) && current.some((entry) => entry.trim() !== '')) {
      steps.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.some((entry) => entry.trim() !== '')) steps.push(current);
  return steps.map((step) => ({ note: step }));
}

/** Open a provider page using the host OS without routing credentials through a browser helper. */
export function openExternalUrl(url: string): boolean {
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? { file: 'cmd', args: ['/c', 'start', '', url] }
        : { file: 'xdg-open', args: [url] };
  try {
    execFileSync(command.file, command.args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Metadata-only readiness state shown in the provider picker and final handoff. */
export type ProviderConfigurationStatus = 'missing' | 'partial' | 'configured';

const LEGACY_SECRET_NAMES: Readonly<Partial<Record<string, string>>> = {
  GITHUB_APP_CLIENT_ID: 'docket-github-client-id',
  GITHUB_APP_CLIENT_SECRET: 'docket-github-client-secret',
};

/** Classify a provider without reading any credential values. */
export function classifyProviderStatus(
  group: ProviderGroup,
  configuredVars: ReadonlySet<string>,
  env: Environment = 'production',
): ProviderConfigurationStatus {
  const vars = providerVars(group, env);
  const configuredCount = vars.filter((name) => configuredVars.has(name)).length;
  if (configuredCount === 0) return 'missing';
  const required = group.requiredVars?.filter((name) => vars.includes(name)) ?? vars;
  if (required.length === 0) return 'configured';
  return required.every((name) => configuredVars.has(name)) ? 'configured' : 'partial';
}

/** Canonical Cloud Run secret bindings for configured server-side provider variables. */
export function buildApiSecretBindings(
  env: Environment,
  configuredSecrets: ReadonlySet<string>,
): string[] {
  const bindings = [
    'DATABASE_URL=docket-database-url:latest',
    'BETTER_AUTH_SECRET=docket-auth-secret:latest',
    'CRON_SECRET=docket-cron-secret:latest',
  ];
  for (const group of PROVIDER_GROUPS) {
    for (const varName of providerVars(group, env)) {
      if (group.cloudVariables?.includes(varName)) continue;
      const spec = findVar(varName);
      if (!spec || spec.scope === 'client') continue;
      const secret = secretName(env, varName);
      const legacy = env === 'production' ? LEGACY_SECRET_NAMES[varName] : undefined;
      const configuredName = configuredSecrets.has(secret)
        ? secret
        : legacy && configuredSecrets.has(legacy)
          ? legacy
          : undefined;
      if (configuredName) bindings.push(`${varName}=${configuredName}:latest`);
    }
  }
  return bindings;
}

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

interface CloudConfigurationState {
  readonly configuredVars: Set<string>;
  readonly secretNames: Set<string>;
}

/** Read only secret/variable names for rerun status; credential values are never accessed. */
function readCloudConfiguration(env: Environment, target: CloudTarget): CloudConfigurationState {
  const secretNames = new Set(
    tryRun(`gcloud secrets list --project=${target.project} --format='value(name)'`)
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const variableNames = new Set(
    tryRun(`gh variable list --env ${env} --repo ${target.repo} --json name --jq '.[].name'`)
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const configuredVars = new Set<string>();
  for (const group of PROVIDER_GROUPS) {
    for (const varName of providerVars(group, env)) {
      const configured = group.cloudVariables?.includes(varName)
        ? variableNames.has(varName)
        : secretNames.has(secretName(env, varName)) ||
          (env === 'production' &&
            LEGACY_SECRET_NAMES[varName] !== undefined &&
            secretNames.has(LEGACY_SECRET_NAMES[varName]));
      if (configured) configuredVars.add(varName);
    }
  }
  return { configuredVars, secretNames };
}

/** Verify the selected gcloud session before the wizard asks the operator for any credentials. */
async function ensureCloudSession(target: CloudTarget): Promise<void> {
  const probe = (): boolean =>
    Boolean(
      tryRun(`gcloud projects describe ${target.project} --format='value(projectId)' 2>/dev/null`),
    );
  if (probe()) return;
  const account = process.env['CLOUDSDK_CORE_ACCOUNT'] ?? '';
  const reauthenticate = unwrap(
    await confirm({
      message: `The selected gcloud session${account ? ` (${account})` : ''} cannot access ${target.project}. Reauthenticate now?`,
      initialValue: true,
    }),
  );
  if (!reauthenticate) throw new Error(`gcloud access to ${target.project} is required.`);
  exec(`gcloud auth login${account ? ` ${account}` : ''}`);
  if (!probe()) throw new Error(`gcloud still cannot access ${target.project} after login.`);
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
  const projectNumber = tryRun(
    `gcloud projects describe ${target.project} --format='value(projectNumber)'`,
  );
  if (!projectNumber) {
    throw new Error(`Could not resolve the project number for ${target.project}`);
  }
  execFileSync(
    'gcloud',
    [
      'secrets',
      'add-iam-policy-binding',
      name,
      `--project=${target.project}`,
      `--member=serviceAccount:${projectNumber}-compute@developer.gserviceaccount.com`,
      '--role=roles/secretmanager.secretAccessor',
      '--quiet',
    ],
    { stdio: 'inherit' },
  );
  ok(`${varName} → secret ${name} (${exists ? 'new version' : 'created'})`);
}

/** Set a GitHub environment-scoped repo variable (for public NEXT_PUBLIC_* build args). */
function pushVariable(env: Environment, target: CloudTarget, key: string, value: string): void {
  // GitHub environment names are typically the env label; staging/production map 1:1.
  exec(`gh variable set ${key} --env ${env} --repo ${target.repo} --body ${JSON.stringify(value)}`);
  ok(`${key} → GitHub ${env} variable`);
}

/** Publish the non-secret list of Cloud Run env-to-secret bindings consumed by deploy.yml. */
function pushApiSecretBindings(
  env: Environment,
  target: CloudTarget,
  secretNames: ReadonlySet<string>,
): void {
  const body = buildApiSecretBindings(env, secretNames).join('\n');
  execFileSync(
    'gh',
    ['variable', 'set', 'API_SECRET_BINDINGS', '--env', env, '--repo', target.repo, '--body', body],
    { stdio: 'inherit' },
  );
  ok(`API_SECRET_BINDINGS → GitHub ${env} variable`);
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
  /** Pre-scope providers for automation/tests; otherwise the status picker is shown. */
  readonly providers?: ProviderId[];
}

/** Split a comma-separated origins string into trimmed, non-empty entries. */
function splitOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve the two distinct origins a provider's setup URLs hang off (see {@link SetupUrls}):
 * `apiBase` (the public API host — only webhooks point here) and `webBases` (the browser-facing
 * product frontends — OAuth/connect callbacks point here).
 *
 * @remarks
 * `local` derives both straight from `.env.local` (no prompt): `apiBase` from `API_URL`, and
 * `webBases` from `BETTER_AUTH_TRUSTED_ORIGINS` (the configured web + admin origins) — these are the
 * exact hosts the browser is on, which is what OAuth `redirect_uri`s must match. `staging`/`production`
 * read the GitHub environment's `API_URL` + `WEB_URL`, falling back to a prompt.
 */
async function resolveSetupUrls(
  env: Environment,
  repo: string,
  envLocal: Record<string, string>,
): Promise<SetupUrls> {
  if (env === 'local') {
    const apiBase = nonEmpty(envLocal, 'API_URL') ?? DEFAULT_LOCAL_API_URL;
    const webBases = splitOrigins(envLocal['BETTER_AUTH_TRUSTED_ORIGINS']);
    return { apiBase, webBases: webBases.length > 0 ? webBases : ['https://docket.localhost'] };
  }
  const apiFromGh = repo ? tryRun(`gh variable get API_URL --env ${env} --repo ${repo}`) : '';
  const apiBase =
    apiFromGh ||
    unwrap(
      await text({
        message: `API base URL for ${env} (webhook target)`,
        placeholder: 'https://api.docket.app',
        validate: (v) => (v && v.length > 0 ? undefined : 'required'),
      }),
    );
  const webFromGh = repo ? tryRun(`gh variable get WEB_URL --env ${env} --repo ${repo}`) : '';
  const webBase =
    webFromGh ||
    unwrap(
      await text({
        message: `Product (web app) URL for ${env} (OAuth callbacks live here)`,
        placeholder: 'https://app.docket.app',
        validate: (v) => (v && v.length > 0 ? undefined : 'required'),
      }),
    );
  return { apiBase, webBases: [webBase] };
}

type GuidedResult = 'complete' | 'skip' | 'exit';

/** Run provider steps with navigation and an explicit checkpoint after every operator action. */
async function runGuidedSteps(
  group: ProviderGroup,
  steps: readonly ProviderStep[],
  env: Environment,
  envLocal: Record<string, string>,
  configuredVars: ReadonlySet<string>,
  rotate: boolean,
  collected: Record<string, string>,
  generatedValues: Readonly<Record<string, string>>,
  setupUrl?: string,
): Promise<GuidedResult> {
  let index = 0;
  while (index < steps.length) {
    const current = steps[index];
    if (!current) break;
    note(
      wrapLines(current.note).join('\n'),
      `${group.label} — step ${String(index + 1)} of ${String(steps.length)}`,
    );
    const url = current.openUrl ?? (index === 0 ? setupUrl : undefined);
    if (url) {
      const shouldOpen = unwrap(
        await confirm({
          message: `Open ${group.label} setup page in your browser?`,
          initialValue: true,
        }),
      );
      if (shouldOpen && !openExternalUrl(url))
        warn(`Could not open browser. Open manually: ${url}`);
    }

    const alreadyConfigured = current.var ? configuredVars.has(current.var) : false;
    const action = unwrap(
      await select<'continue' | 'back' | 'retry' | 'skip' | 'exit'>({
        message: current.var
          ? alreadyConfigured && !rotate
            ? `${current.var} is already configured. Continue?`
            : `Ready to enter ${current.var}?`
          : 'Finished this step?',
        initialValue: 'continue',
        options: [
          {
            value: 'continue',
            label:
              alreadyConfigured && !rotate
                ? 'Keep existing'
                : current.var
                  ? current.var in generatedValues
                    ? 'Generate and copy'
                    : 'Enter value'
                  : 'Done',
          },
          ...(index > 0 ? [{ value: 'back' as const, label: 'Back' }] : []),
          { value: 'retry', label: 'Show this step again' },
          { value: 'skip', label: 'Skip this provider' },
          { value: 'exit', label: 'Exit integration setup' },
        ],
      }),
    );
    if (action === 'back') {
      index = Math.max(0, index - 1);
      continue;
    }
    if (action === 'retry') continue;
    if (action === 'skip' || action === 'exit') return action;
    if (current.var && (!alreadyConfigured || rotate)) {
      const spec = findVar(current.var);
      if (!spec) throw new Error(`${group.title} references unknown variable ${current.var}.`);
      const generated = generatedValues[current.var];
      if (generated) {
        if (!copyToClipboard(generated)) {
          warn('No supported clipboard utility is available; install one and retry this step.');
          continue;
        }
        collected[current.var] = generated;
        ok(`${current.var} generated and copied without being displayed`);
      } else {
        const value = await promptVar(spec, { env, current: nonEmpty(envLocal, current.var) });
        if (value !== undefined) {
          collected[current.var] = group.transform?.[current.var]?.(value) ?? value;
        }
      }
    }
    index += 1;
  }
  return 'complete';
}

/** Configure selected providers for a single environment. */
async function setupEnvironment(
  env: Environment,
  repo: string,
  defaultProject: string,
  providerIds?: readonly ProviderId[],
): Promise<void> {
  note(
    env === 'local'
      ? 'These are local dev values. They are written to your .env.local on this machine only.'
      : `These are ${env} values. They are pushed straight to GCP Secret Manager / GitHub and\n` +
          'are not written to any local file.',
    `Environment: ${env}`,
  );

  // Parse .env.local once (only local reads it) and reuse for the setup URLs + keep-existing defaults.
  const envLocal = env === 'local' ? parseEnvFile(resolve(ROOT, '.env.local')) : {};
  const urls = await resolveSetupUrls(env, repo, envLocal);

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
      await ensureCloudSession(cloud);
    }
  }

  const cloudState = cloud
    ? readCloudConfiguration(env, cloud)
    : { configuredVars: new Set<string>(), secretNames: new Set<string>() };
  const configuredVars =
    env === 'local'
      ? new Set(
          Object.entries(envLocal)
            .filter(([, value]) => value !== '')
            .map(([name]) => name),
        )
      : cloudState.configuredVars;
  const statuses = new Map(
    PROVIDER_GROUPS.map((group) => [group.id, classifyProviderStatus(group, configuredVars, env)]),
  );
  note(
    PROVIDER_GROUPS.map((group) => {
      const status = statuses.get(group.id) ?? 'missing';
      const icon = status === 'configured' ? '✓' : status === 'partial' ? '◐' : '○';
      return `${icon} ${group.label.padEnd(24)} ${status}`;
    }).join('\n'),
    'Integration status (credential values were not read)',
  );
  const chosenIds =
    providerIds ??
    unwrap(
      await multiselect<ProviderId>({
        message: 'Which providers do you want to configure or rotate?',
        required: true,
        options: PROVIDER_GROUPS.map((group) => ({
          value: group.id,
          label: group.label,
          hint: `${statuses.get(group.id) ?? 'missing'}${group.optional ? ', optional' : ''}`,
        })),
      }),
    );
  const rotateIds = new Set<ProviderId>();
  for (const providerId of chosenIds) {
    if (statuses.get(providerId) !== 'configured') continue;
    const group = PROVIDER_GROUPS.find((candidate) => candidate.id === providerId);
    if (!group) continue;
    const rotate = unwrap(
      await confirm({
        message: `${group.label} is already configured. Add new credential versions?`,
        initialValue: false,
      }),
    );
    if (rotate) rotateIds.add(providerId);
  }

  for (const group of PROVIDER_GROUPS.filter((candidate) => chosenIds.includes(candidate.id))) {
    const vars = providerVars(group, env);
    const rotate = rotateIds.has(group.id);
    if (statuses.get(group.id) === 'configured' && !rotate) {
      ok(`${group.label}: kept existing configuration`);
      continue;
    }
    const collected: Record<string, string> = {};

    const generatedValues = group.generate?.(env) ?? {};
    const setupUrl = group.launchUrl?.(env, urls) ?? group.consoleUrl;

    let guidedResult: GuidedResult;
    if (group.steps) {
      guidedResult = await runGuidedSteps(
        group,
        group.steps(env, urls),
        env,
        envLocal,
        configuredVars,
        rotate,
        collected,
        generatedValues,
        setupUrl,
      );
    } else {
      guidedResult = await runGuidedSteps(
        group,
        splitInstructionSteps(group.instructions?.(env, urls) ?? []),
        env,
        envLocal,
        configuredVars,
        rotate,
        collected,
        generatedValues,
        setupUrl,
      );

      if (guidedResult === 'complete' && group.credentialBundle) {
        const bundle = group.credentialBundle;
        const method = unwrap(
          await select<'manual' | 'bundle'>({
            message: `How do you want to enter ${group.label} credentials?`,
            initialValue: 'manual',
            options: [
              { value: 'manual', label: 'Copy and paste values', hint: 'recommended' },
              { value: 'bundle', label: 'Import downloaded credential file' },
            ],
          }),
        );
        if (method === 'bundle') {
          let parsed: Record<string, string> | undefined;
          const raw = unwrap(
            await text({
              message: bundle.message,
              placeholder: bundle.placeholder,
              validate: (value) => {
                if (!value?.trim()) return 'required';
                try {
                  parsed = bundle.parse(value, urls);
                  return undefined;
                } catch (error) {
                  return error instanceof Error ? error.message : 'Credential file is invalid.';
                }
              },
            }),
          ).trim();
          parsed ??= bundle.parse(raw, urls);
          for (const [varName, value] of Object.entries(parsed)) {
            if (!vars.includes(varName)) {
              throw new Error(`${group.title} imported unknown variable ${varName}.`);
            }
            const spec = findVar(varName);
            const result = spec?.zod.safeParse(value);
            if (!spec || !result?.success) {
              throw new Error(`${group.title} imported an invalid value for ${varName}.`);
            }
            collected[varName] = value;
          }
          ok(`imported ${Object.keys(parsed).join(', ')} from credential file`);
        }
      }

      if (guidedResult === 'complete') {
        const captureSteps = vars
          .filter((varName) => !(varName in collected) && (!configuredVars.has(varName) || rotate))
          .map((varName) => ({
            note: [`Copy ${varName} from ${group.label}, then return to this terminal.`],
            var: varName,
          }));
        guidedResult = await runGuidedSteps(
          group,
          captureSteps,
          env,
          envLocal,
          configuredVars,
          rotate,
          collected,
          generatedValues,
          setupUrl,
        );
      }
    }

    if (guidedResult === 'exit') return;
    if (guidedResult === 'skip') {
      warn(`${group.label}: skipped; no collected values were written`);
      continue;
    }

    if (Object.keys(collected).length === 0) {
      warn(
        `${group.label}: ${classifyProviderStatus(group, configuredVars, env)}; no values were changed`,
      );
      continue;
    }

    if (env === 'local') {
      upsertEnvVars(resolve(ROOT, '.env.local'), collected);
      Object.keys(collected).forEach((name) => configuredVars.add(name));
      ok(`wrote ${Object.keys(collected).join(', ')} to .env.local`);
    } else if (cloud) {
      for (const [name, value] of Object.entries(collected)) {
        const spec = findVar(name);
        if (group.cloudVariables?.includes(name) || spec?.scope === 'client') {
          pushVariable(env, cloud, name, value);
        } else {
          pushSecret(env, cloud, name, value);
          cloudState.secretNames.add(secretName(env, name));
        }
        configuredVars.add(name);
      }
    }
    const finalStatus = classifyProviderStatus(group, configuredVars, env);
    if (finalStatus === 'configured') ok(`${group.label}: configured and ready for deployment`);
    else warn(`${group.label}: ${finalStatus}; rerun setup to provide the remaining values`);
  }

  if (cloud) pushApiSecretBindings(env, cloud, cloudState.secretNames);
  note(
    PROVIDER_GROUPS.map(
      (group) => `${group.label}: ${classifyProviderStatus(group, configuredVars, env)}`,
    ).join('\n'),
    `${env} integration readiness`,
  );
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
    await setupEnvironment(env, repo, defaultProject, opts.providers);
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

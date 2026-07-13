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
import { isRealValue } from '../packages/env/src';
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

/** Capture a command without exposing its output; `null` distinguishes failure from empty output. */
function captureCommand(file: string, args: readonly string[]): string | null {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

/** Read a non-secret GitHub Actions variable, preferring the selected environment. */
function readGitHubVariable(repo: string, env: Environment, name: string): string {
  const scoped = captureCommand('gh', ['variable', 'get', name, '--env', env, '--repo', repo]);
  if (scoped) return scoped;
  return captureCommand('gh', ['variable', 'get', name, '--repo', repo]) ?? '';
}

/** Read non-secret GitHub variables from repository and environment scopes. */
function readGitHubVariables(repo: string, env?: Environment): Map<string, string> {
  const args = ['variable', 'list'];
  if (env) args.push('--env', env);
  args.push('--repo', repo, '--json', 'name,value');
  const raw = captureCommand('gh', args);
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Map();
    const rows: (readonly [string, string])[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const name = typeof record['name'] === 'string' ? record['name'] : '';
      const value = typeof record['value'] === 'string' ? record['value'] : '';
      if (name) rows.push([name, value]);
    }
    return new Map(rows);
  } catch {
    return new Map();
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

/** Value state used to repair placeholders without displaying credential contents. */
export type CredentialStatus = 'missing' | 'placeholder' | 'ready' | 'inaccessible';

const LEGACY_SECRET_NAMES: Readonly<Partial<Record<string, string>>> = {
  GITHUB_APP_CLIENT_ID: 'docket-github-client-id',
  GITHUB_APP_CLIENT_SECRET: 'docket-github-client-secret',
};

/** Classify a value without retaining or displaying its contents. */
export function classifyCredentialValue(value: string | undefined): CredentialStatus {
  if (!value || value.trim().length === 0) return 'missing';
  return isRealValue(value) ? 'ready' : 'placeholder';
}

export function requiredProviderVars(group: ProviderGroup, env: Environment): readonly string[] {
  const vars = providerVars(group, env);
  if (group.requiredVars) return group.requiredVars.filter((name) => vars.includes(name));
  const policy = new Set(group.policyVars ?? []);
  const optional = new Set(group.optionalVars ?? []);
  return vars.filter((name) => !policy.has(name) && !optional.has(name));
}

export function policyProviderVars(group: ProviderGroup, env: Environment): readonly string[] {
  const vars = new Set(providerVars(group, env));
  return (group.policyVars ?? []).filter((name) => vars.has(name));
}

export function optionalProviderVars(group: ProviderGroup, env: Environment): readonly string[] {
  const vars = new Set(providerVars(group, env));
  return (group.optionalVars ?? []).filter((name) => vars.has(name));
}

export function setupProviderVars(
  group: ProviderGroup,
  env: Environment,
  includeOptional: boolean,
): readonly string[] {
  return [
    ...requiredProviderVars(group, env),
    ...policyProviderVars(group, env),
    ...(includeOptional ? optionalProviderVars(group, env) : []),
  ].filter((name, index, all) => all.indexOf(name) === index);
}

/** Classify a provider by its primary capability, not optional connector fields. */
export function classifyProviderStatus(
  group: ProviderGroup,
  configuredVars: ReadonlySet<string>,
  env: Environment = 'production',
): ProviderConfigurationStatus {
  const vars = requiredProviderVars(group, env);
  const configuredCount = vars.filter((name) => configuredVars.has(name)).length;
  if (configuredCount === 0) return 'missing';
  return vars.every((name) => configuredVars.has(name)) ? 'configured' : 'partial';
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
  readonly variableValues: Map<string, string>;
  readonly fieldStatuses: Map<string, CredentialStatus>;
  /** Secret objects whose latest versions contain usable values. */
  readonly usableSecretNames: Set<string>;
}

/** Read cloud readiness without printing credential values. */
function readCloudConfiguration(
  env: Environment,
  target: CloudTarget,
  groups: readonly ProviderGroup[] = PROVIDER_GROUPS,
): CloudConfigurationState {
  const listedSecrets = captureCommand('gcloud', [
    'secrets',
    'list',
    `--project=${target.project}`,
    '--format=value(name)',
  ]);
  const listedSecretNames = new Set(
    (listedSecrets ?? '')
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const secretNames = new Set<string>();
  const usableSecretNames = new Set<string>();
  const variableValues = readGitHubVariables(target.repo);
  for (const [name, value] of readGitHubVariables(target.repo, env)) {
    variableValues.set(name, value);
  }
  const configuredVars = new Set<string>();
  const fieldStatuses = new Map<string, CredentialStatus>();
  for (const group of groups) {
    for (const varName of providerVars(group, env)) {
      if (group.cloudVariables?.includes(varName)) {
        const status = variableValues.has(varName)
          ? classifyCredentialValue(variableValues.get(varName))
          : 'missing';
        fieldStatuses.set(varName, status);
        if (status === 'ready') configuredVars.add(varName);
        continue;
      }

      const canonical = secretName(env, varName);
      const legacy = env === 'production' ? LEGACY_SECRET_NAMES[varName] : undefined;
      const source = listedSecretNames.has(canonical)
        ? canonical
        : legacy && listedSecretNames.has(legacy)
          ? legacy
          : undefined;
      const value = source
        ? captureCommand('gcloud', [
            'secrets',
            'versions',
            'access',
            'latest',
            `--secret=${source}`,
            `--project=${target.project}`,
          ])
        : undefined;
      const status: CredentialStatus = !source
        ? listedSecrets === null
          ? 'inaccessible'
          : 'missing'
        : value === null
          ? 'inaccessible'
          : classifyCredentialValue(value);
      fieldStatuses.set(varName, status);
      if (status === 'ready') {
        configuredVars.add(varName);
        secretNames.add(source);
        usableSecretNames.add(source);
      }
    }
  }
  return { configuredVars, secretNames, variableValues, fieldStatuses, usableSecretNames };
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
 * Normalize one operator-provided secret before it crosses the Secret Manager boundary.
 *
 * @remarks
 * Provider credentials are single logical values, so surrounding clipboard whitespace is never
 * meaningful. Trimming here prevents an invisible trailing newline from becoming part of an OAuth
 * client id while preserving internal spaces such as `Docket <no-reply@example.com>`.
 *
 * @throws When the supplied value contains only whitespace.
 */
export function normalizeCloudSecret(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('Cloud secret value must not be empty.');
  return normalized;
}

/**
 * Create or add a new version of a GCP Secret Manager secret (re-runs rotate, never error).
 *
 * @remarks
 * The value is piped via stdin (`--data-file=-`) so a prod/staging secret is held only in memory
 * and written straight to Secret Manager — it never touches local disk or the process arg list.
 */
function pushSecret(env: Environment, target: CloudTarget, varName: string, value: string): void {
  const normalized = normalizeCloudSecret(value);
  const name = secretName(env, varName);
  const exists = tryRun(
    `gcloud secrets describe ${name} --project=${target.project} --format='value(name)'`,
  );
  const action = exists
    ? `secrets versions add ${name} --project=${target.project}`
    : `secrets create ${name} --project=${target.project} --replication-policy=automatic`;
  execSync(`gcloud ${action} --data-file=-`, {
    input: normalized,
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

export interface IntegrationCliOptions {
  readonly environments?: Environment[];
  readonly providers?: ProviderId[];
  readonly help: boolean;
}

const ENVIRONMENTS: readonly Environment[] = ['local', 'staging', 'production'];
const PROVIDER_IDS: readonly ProviderId[] = PROVIDER_GROUPS.map((group) => group.id);

/** Parse focused standalone wizard flags; repeated flags are accepted and de-duplicated. */
export function parseIntegrationArgs(args: readonly string[]): IntegrationCliOptions {
  const environments: Environment[] = [];
  const providers: ProviderId[] = [];
  let help = false;
  const values = (raw: string, flag: string): string[] =>
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        if (flag === '--env' && !ENVIRONMENTS.includes(value as Environment)) {
          throw new Error(`Unknown integration environment: ${value}`);
        }
        if (flag === '--provider' && !PROVIDER_IDS.includes(value as ProviderId)) {
          throw new Error(`Unknown integration provider: ${value}`);
        }
        return value;
      });

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg === '--') continue;
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    const inline = /^(--env|--provider)=(.*)$/.exec(arg);
    const flag = inline?.[1] ?? (arg === '--env' || arg === '--provider' ? arg : undefined);
    if (!flag) throw new Error(`Unknown integrations flag: ${arg}`);
    const raw = inline?.[2] ?? args[++index];
    if (!raw || raw.startsWith('--')) throw new Error(`${flag} requires a value`);
    for (const value of values(raw, flag)) {
      if (flag === '--env' && !environments.includes(value as Environment)) {
        environments.push(value as Environment);
      }
      if (flag === '--provider' && !providers.includes(value as ProviderId)) {
        providers.push(value as ProviderId);
      }
    }
  }

  return {
    environments: environments.length > 0 ? environments : undefined,
    providers: providers.length > 0 ? providers : undefined,
    help,
  };
}

function integrationHelp(): string {
  return [
    'Usage: pnpm integrations -- [flags]',
    '',
    '  --env <name>       configure local, staging, or production (repeatable)',
    '  --provider <id>    focus on a provider id (repeatable; e.g. github)',
    '  --help, -h         show this help',
    '',
    'Examples:',
    '  pnpm integrations -- --env production --provider github',
    '  pnpm integrations -- --env staging,production --provider google',
    '',
    'With no flags, the wizard asks for the environment and providers interactively.',
  ].join('\n');
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
 * read environment-scoped GitHub `API_URL` + `WEB_URL`, then repository-level variables, falling back
 * to a prompt only when neither scope has a value.
 */
async function resolveSetupUrls(
  env: Environment,
  repo: string,
  envLocal: Record<string, string>,
  projectId?: string,
): Promise<SetupUrls> {
  if (env === 'local') {
    const apiBase = nonEmpty(envLocal, 'API_URL') ?? DEFAULT_LOCAL_API_URL;
    const webBases = splitOrigins(envLocal['BETTER_AUTH_TRUSTED_ORIGINS']);
    return { apiBase, webBases: webBases.length > 0 ? webBases : ['https://docket.localhost'] };
  }
  const apiFromGh = repo ? readGitHubVariable(repo, env, 'API_URL') : '';
  const apiBase =
    apiFromGh ||
    unwrap(
      await text({
        message: `API base URL for ${env} (public webhook target; usually GitHub variable API_URL)`,
        placeholder:
          env === 'production'
            ? 'https://docket-api.hypertext.studio'
            : 'https://<staging-api-host>',
        validate: (v) => (v && v.length > 0 ? undefined : 'required'),
      }),
    );
  const webFromGh = repo ? readGitHubVariable(repo, env, 'WEB_URL') : '';
  const webBase =
    webFromGh ||
    unwrap(
      await text({
        message: `Product URL for ${env} (OAuth callbacks; usually GitHub variable WEB_URL)`,
        placeholder:
          env === 'production' ? 'https://docket.hypertext.studio' : 'https://<staging-web-host>',
        validate: (v) => (v && v.length > 0 ? undefined : 'required'),
      }),
    );
  return { apiBase, webBases: [webBase], projectId };
}

type GuidedResult = 'complete' | 'skip' | 'exit';

/** Run provider steps with navigation and an explicit checkpoint after every operator action. */
async function runGuidedSteps(
  group: ProviderGroup,
  steps: readonly ProviderStep[],
  env: Environment,
  currentValues: ReadonlyMap<string, string>,
  fieldStatuses: ReadonlyMap<string, CredentialStatus>,
  replaceAll: boolean,
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

    const status = current.var ? (fieldStatuses.get(current.var) ?? 'missing') : 'missing';
    const alreadyReady = status === 'ready';
    const shouldCollect = current.var !== undefined && (!alreadyReady || replaceAll);
    const action = unwrap(
      await select<'continue' | 'replace' | 'back' | 'retry' | 'skip' | 'exit'>({
        message: current.var
          ? alreadyReady
            ? `${current.var} is ready. Keep it or replace it?`
            : `${current.var} is ${status}. Enter a value now?`
          : 'Finished this step?',
        initialValue: 'continue',
        options: [
          {
            value: 'continue',
            label: current.var
              ? alreadyReady && !replaceAll
                ? 'Keep existing'
                : current.var in generatedValues
                  ? 'Generate and copy'
                  : 'Enter value'
              : 'Done',
          },
          ...(current.var && alreadyReady && !replaceAll
            ? [{ value: 'replace' as const, label: 'Replace existing' }]
            : []),
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
    if (current.var && (shouldCollect || action === 'replace')) {
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
        const value = await promptVar(spec, {
          env,
          current:
            spec.sensitive || replaceAll || action === 'replace'
              ? undefined
              : status === 'ready'
                ? currentValues.get(current.var)
                : undefined,
        });
        if (value !== undefined) {
          collected[current.var] = group.transform?.[current.var]?.(value) ?? value;
        }
      }
    }
    index += 1;
  }
  return 'complete';
}

function readLocalConfiguration(
  envLocal: Readonly<Record<string, string>>,
  env: Environment,
  groups: readonly ProviderGroup[] = PROVIDER_GROUPS,
): CloudConfigurationState {
  const variableValues = new Map(Object.entries(envLocal));
  const configuredVars = new Set<string>();
  const fieldStatuses = new Map<string, CredentialStatus>();
  for (const group of groups) {
    for (const varName of providerVars(group, env)) {
      const status = classifyCredentialValue(envLocal[varName]);
      fieldStatuses.set(varName, status);
      if (status === 'ready') configuredVars.add(varName);
    }
  }
  return {
    configuredVars,
    secretNames: new Set(),
    variableValues,
    fieldStatuses,
    usableSecretNames: new Set(),
  };
}

function providerFieldNote(group: ProviderGroup, varName: string): readonly string[] {
  if (varName === 'GOOGLE_OAUTH_PUBLIC') {
    return [
      'Docket access policy — GOOGLE_OAUTH_PUBLIC.',
      'Enter false while the Google consent screen is in Testing or Google verification is pending.',
      'Change it to true only after Google public OAuth verification is approved.',
    ];
  }
  if (varName === 'GOOGLE_OAUTH_TEST_EMAILS') {
    return [
      'Docket access policy — GOOGLE_OAUTH_TEST_EMAILS.',
      'Enter the comma-separated Google account emails allowed to sign in while the consent screen',
      'is in Testing. This is a Docket allowlist, not a Google Console credential.',
    ];
  }
  const spec = findVar(varName);
  return [
    `Provider credential — ${varName}.`,
    `Enter it from ${group.label}${spec?.where ? ` (${spec.where})` : ''}.`,
  ];
}

function providerStatusSummary(
  groups: readonly ProviderGroup[],
  env: Environment,
  state: CloudConfigurationState,
): string {
  return groups
    .map((group) => {
      const primary = classifyProviderStatus(group, state.configuredVars, env);
      const optional = optionalProviderVars(group, env);
      if (optional.length === 0) return `${group.label}: ${primary}`;
      const optionalReady = optional.filter((name) => state.configuredVars.has(name)).length;
      return `${group.label}: ${primary} · optional connector ${optionalReady}/${optional.length}`;
    })
    .join('\n');
}

async function reviewCollectedValues(
  group: ProviderGroup,
  collected: Readonly<Record<string, string>>,
): Promise<boolean> {
  const changes = Object.entries(collected).map(([name, value]) => {
    const spec = findVar(name);
    return spec?.sensitive ? `${name} (secret)` : `${name} = ${value}`;
  });
  note(changes.join('\n'), `${group.label} — review before writing`);
  return unwrap(
    await confirm({
      message: `Write these ${String(changes.length)} ${group.label} value(s) now?`,
      initialValue: true,
    }),
  );
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

  // Choose the work first. The wizard only asks for URLs and cloud access after it knows which
  // provider pages are relevant, so a focused run does not begin with unrelated prompts.
  const chosenIds =
    providerIds ??
    unwrap(
      await multiselect<ProviderId>({
        message: 'What do you want to set up in this environment?',
        required: true,
        options: PROVIDER_GROUPS.map((group) => ({
          value: group.id,
          label: group.label,
          hint: group.optional ? 'optional' : undefined,
        })),
      }),
    );
  const chosenGroups = PROVIDER_GROUPS.filter((group) => chosenIds.includes(group.id));
  if (chosenGroups.length === 0) {
    warn(`No providers selected for ${env}.`);
    return;
  }

  const envLocal = env === 'local' ? parseEnvFile(resolve(ROOT, '.env.local')) : {};
  let cloud: CloudTarget | undefined;
  let urls: SetupUrls;
  if (env === 'local') {
    urls = await resolveSetupUrls(env, repo, envLocal);
  } else {
    const repoForCloud =
      repo || unwrap(await text({ message: 'GitHub owner/repo', placeholder: 'owner/repo' }));
    const project = await chooseGcloudProject(defaultProject, env);
    if (!repoForCloud || !project) {
      warn(`Cannot configure ${env} without both a GitHub repo and GCP project.`);
      return;
    }
    cloud = { repo: repoForCloud, project };
    await ensureCloudSession(cloud);
    urls = await resolveSetupUrls(env, repoForCloud, envLocal, project);
  }

  let state: CloudConfigurationState;
  if (env === 'local') {
    state = readLocalConfiguration(envLocal, env, chosenGroups);
  } else {
    if (!cloud) throw new Error(`Cloud target for ${env} was not initialized.`);
    // Read every provider so selecting one provider cannot retire usable mounts for another.
    state = readCloudConfiguration(env, cloud);
  }
  note(
    providerStatusSummary(chosenGroups, env, state),
    'Selected integration status (credential values are never displayed)',
  );

  for (const group of chosenGroups) {
    const primaryStatus = classifyProviderStatus(group, state.configuredVars, env);
    const action = unwrap(
      await select<'keep' | 'configure' | 'replace' | 'skip' | 'exit'>({
        message:
          primaryStatus === 'configured'
            ? `${group.label} is configured. What should happen to its primary sign-in capability?`
            : `${group.label} is ${primaryStatus}. What should happen next?`,
        initialValue: primaryStatus === 'configured' ? 'keep' : 'configure',
        options: [
          ...(primaryStatus === 'configured'
            ? [{ value: 'keep' as const, label: 'Keep existing' }]
            : [{ value: 'configure' as const, label: 'Set up or repair missing fields' }]),
          ...(primaryStatus === 'configured'
            ? [{ value: 'replace' as const, label: 'Replace primary credentials' }]
            : [{ value: 'keep' as const, label: 'Leave it incomplete for now' }]),
          { value: 'skip' as const, label: 'Skip this provider' },
          { value: 'exit' as const, label: 'Exit integration setup' },
        ],
      }),
    );
    if (action === 'exit') return;
    if (action === 'skip') {
      warn(`${group.label}: skipped; no values were changed`);
      continue;
    }

    const configurePrimary = action === 'configure' || action === 'replace';
    const replacePrimary = action === 'replace';
    const optionalVars = optionalProviderVars(group, env);
    let includeOptional = false;
    let replaceOptional = false;
    if (optionalVars.length > 0) {
      const optionalReady = optionalVars.every((name) => state.fieldStatuses.get(name) === 'ready');
      const optionalAction = unwrap(
        await select<'keep' | 'configure' | 'replace'>({
          message: optionalReady
            ? `Optional ${group.optionalLabel ?? 'connector settings'} are ready. What should happen?`
            : `Set up the optional ${group.optionalLabel ?? 'connector settings'} now?`,
          initialValue: optionalReady ? 'keep' : 'keep',
          options: [
            { value: 'keep', label: 'Leave optional settings as they are' },
            { value: 'configure', label: 'Set up or repair optional settings' },
            ...(optionalReady
              ? [{ value: 'replace' as const, label: 'Replace optional settings' }]
              : []),
          ],
        }),
      );
      includeOptional = optionalAction !== 'keep';
      replaceOptional = optionalAction === 'replace';
    }

    let editPolicy = false;
    const policyVars = policyProviderVars(group, env);
    if (policyVars.length > 0) {
      const policyReady = policyVars.every((name) => state.fieldStatuses.get(name) === 'ready');
      const policyAction = unwrap(
        await select<'keep' | 'edit'>({
          message: policyReady
            ? `${group.label} Docket access policy is configured. Keep or edit it?`
            : `${group.label} Docket access policy is incomplete. Configure it now?`,
          initialValue: policyReady ? 'keep' : 'edit',
          options: [
            { value: 'keep', label: 'Keep current policy' },
            { value: 'edit', label: 'Configure or edit policy' },
          ],
        }),
      );
      editPolicy = policyAction === 'edit';
    }

    const collected: Record<string, string> = {};
    const generatedValues = includeOptional ? (group.generate?.(env) ?? {}) : {};
    const setupUrl = group.launchUrl?.(env, urls) ?? group.consoleUrl;
    let guidedResult: GuidedResult = 'complete';

    if (configurePrimary) {
      if (group.steps) {
        guidedResult = await runGuidedSteps(
          group,
          group.steps(env, urls),
          env,
          state.variableValues,
          state.fieldStatuses,
          replacePrimary,
          collected,
          generatedValues,
          setupUrl,
        );
      } else if (group.instructions) {
        guidedResult = await runGuidedSteps(
          group,
          splitInstructionSteps(group.instructions(env, urls)),
          env,
          state.variableValues,
          state.fieldStatuses,
          replacePrimary,
          collected,
          generatedValues,
          setupUrl,
        );
      }
    }
    if (guidedResult === 'exit') return;
    if (guidedResult === 'skip') {
      warn(`${group.label}: skipped; no values were written`);
      continue;
    }

    const requiredVars = requiredProviderVars(group, env);
    const requiredNeedsInput = requiredVars.some(
      (name) => state.fieldStatuses.get(name) !== 'ready' || replacePrimary,
    );
    if (configurePrimary && requiredNeedsInput && group.credentialBundle) {
      const bundle = group.credentialBundle;
      const canImportWithoutReplacingReady = requiredVars.every(
        (name) => state.fieldStatuses.get(name) !== 'ready',
      );
      if (replacePrimary || canImportWithoutReplacingReady) {
        const method = unwrap(
          await select<'manual' | 'bundle'>({
            message: `How do you want to enter ${group.label} credentials?`,
            initialValue: 'manual',
            options: [
              { value: 'manual', label: 'Enter values one at a time', hint: 'recommended' },
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
            if (!requiredVars.includes(varName)) {
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
    }

    if (includeOptional && group.optionalSteps) {
      guidedResult = await runGuidedSteps(
        group,
        group.optionalSteps(env, urls),
        env,
        state.variableValues,
        state.fieldStatuses,
        replaceOptional,
        collected,
        generatedValues,
      );
      if (guidedResult === 'exit') return;
      if (guidedResult === 'skip') {
        warn(`${group.label}: optional setup skipped; no values were written`);
        continue;
      }
    }

    const captureVars = setupProviderVars(group, env, includeOptional).filter((name) => {
      if (name in collected) return false;
      if (env === 'local' && name === 'GITHUB_APP_WEBHOOK_SECRET') return false;
      const status = state.fieldStatuses.get(name) ?? 'missing';
      if (requiredVars.includes(name))
        return configurePrimary && (status !== 'ready' || replacePrimary);
      if (policyVars.includes(name)) return editPolicy && (status !== 'ready' || editPolicy);
      return includeOptional && (status !== 'ready' || replaceOptional);
    });
    if (captureVars.length > 0) {
      guidedResult = await runGuidedSteps(
        group,
        captureVars.map((varName) => ({ note: providerFieldNote(group, varName), var: varName })),
        env,
        state.variableValues,
        state.fieldStatuses,
        false,
        collected,
        generatedValues,
      );
      if (guidedResult === 'exit') return;
      if (guidedResult === 'skip') {
        warn(`${group.label}: skipped; no values were written`);
        continue;
      }
    }

    if (Object.keys(collected).length === 0) {
      ok(`${group.label}: no values changed`);
      continue;
    }
    if (!(await reviewCollectedValues(group, collected))) {
      warn(`${group.label}: changes discarded at review`);
      continue;
    }

    if (env === 'local') {
      upsertEnvVars(resolve(ROOT, '.env.local'), collected);
      for (const [name, value] of Object.entries(collected)) {
        state.variableValues.set(name, value);
        const status = classifyCredentialValue(value);
        state.fieldStatuses.set(name, status);
        if (status === 'ready') state.configuredVars.add(name);
      }
      ok(`wrote ${Object.keys(collected).join(', ')} to .env.local`);
    } else if (cloud) {
      for (const [name, value] of Object.entries(collected)) {
        const spec = findVar(name);
        if (group.cloudVariables?.includes(name) || spec?.scope === 'client') {
          pushVariable(env, cloud, name, value);
        } else {
          pushSecret(env, cloud, name, value);
          state.secretNames.add(secretName(env, name));
          state.usableSecretNames.add(secretName(env, name));
        }
        state.variableValues.set(name, value);
        const status = classifyCredentialValue(value);
        state.fieldStatuses.set(name, status);
        if (status === 'ready') state.configuredVars.add(name);
      }
    }
    const finalStatus = classifyProviderStatus(group, state.configuredVars, env);
    if (finalStatus === 'configured') ok(`${group.label}: configured and ready for deployment`);
    else warn(`${group.label}: ${finalStatus}; rerun setup to provide the remaining values`);
  }

  if (cloud) pushApiSecretBindings(env, cloud, state.usableSecretNames);
  note(providerStatusSummary(chosenGroups, env, state), `${env} integration readiness`);
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
  const cli = parseIntegrationArgs(process.argv.slice(2));
  if (cli.help) {
    note(integrationHelp(), 'Docket integrations');
  } else {
    runIntegrationSetup(cli).catch((err: unknown) => {
      log.error(`Integration setup failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
  }
}

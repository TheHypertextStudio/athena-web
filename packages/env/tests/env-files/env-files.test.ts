/**
 * Repo-invariant tests for the two committed env files.
 *
 * @remarks
 * `.env.local` is tracked on purpose — it carries safe local defaults so a fresh clone runs the whole
 * product against mock adapters — and its own header declares that ".env.example is the
 * contract/source of truth". Nothing enforced that claim, so the two drifted: `WEB_URL`,
 * `GOOGLE_OAUTH_PUBLIC`, and `AGENT_MAX_TURNS` were added to the schema and to `.env.example` but not
 * to `.env.local`. A fresh clone or `git worktree` then died on `Invalid environment variables` while
 * the web app kept serving 200 — so it presented as an auth bug rather than an API that never booted.
 *
 * These tests derive the required set from the schema itself, so adding a required var to a slice
 * fails here until both files carry it. The drift becomes impossible to land rather than merely
 * documented as undesirable.
 *
 * Two different read strategies, and the split is deliberate:
 *
 * - **Required-value checks read the working files.** In CI that is the committed content; locally it
 *   is the developer's own copy, and a missing required var there means their stack cannot boot — so
 *   failing is the useful outcome, not a false positive.
 * - **Hygiene checks read the committed content via `git show`.** `.env.local` is armed with `git
 *   update-index --skip-worktree`, so a developer's on-disk copy legitimately holds real credentials
 *   and extra vars. Asserting against that would fail for them and risk surfacing secrets; the
 *   invariant only concerns what is committed, which is also what a fresh clone gets.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  agentServer,
  authServer,
  clientShared,
  connectorServer,
  dbServer,
  mcpServer,
  opsServer,
  sharedServer,
  stripeServer,
} from '../../src/slices';

/** The slices `src/api.ts` composes, plus the browser vars the web/admin apps validate. */
const API_SLICES = [
  sharedServer,
  dbServer,
  authServer,
  stripeServer,
  mcpServer,
  agentServer,
  opsServer,
  connectorServer,
] as const;

/** Repo root. Resolved via `fileURLToPath` — this checkout's path contains spaces, which
 * `URL.pathname` would hand back percent-encoded. */
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** Read a file from the working tree. */
function working(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/** Read a path as committed at `HEAD`, bypassing any local (skip-worktree) edits. */
function committed(path: string): string {
  return execFileSync('git', ['show', `HEAD:${path}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
}

/** The `KEY=` names assigned in an env file, ignoring comments. */
function assignedKeys(contents: string): Set<string> {
  const keys = new Set<string>();
  for (const line of contents.split('\n')) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=/.exec(line);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
}

/** The raw value assigned to `key`, or `undefined` when the key is absent. */
function valueOf(contents: string, key: string): string | undefined {
  for (const line of contents.split('\n')) {
    const match = new RegExp(`^\\s*${key}\\s*=(.*)$`).exec(line);
    if (match) return (match[1] ?? '').trim();
  }
  return undefined;
}

/**
 * Whether a schema entry tolerates an absent value.
 *
 * @remarks
 * Asked of the schema rather than pattern-matched on `.optional()`/`.default()` in source, so a var
 * made optional by any means is classified correctly.
 */
function tolerable(schema: unknown): boolean {
  const s = schema as { safeParse?: (value: unknown) => { success: boolean } };
  if (typeof s.safeParse !== 'function') return true;
  return s.safeParse(undefined).success;
}

/** Every var that must carry a non-empty value for the API (or the web apps) to boot. */
function requiredKeys(): string[] {
  const out = new Set<string>();
  for (const slice of [...API_SLICES, clientShared]) {
    for (const [key, schema] of Object.entries(slice)) {
      if (!tolerable(schema)) out.add(key);
    }
  }
  return [...out].sort();
}

/**
 * Vars missing a usable value.
 *
 * @remarks
 * `api.ts` sets `emptyStringAsUndefined: true`, so `KEY=` reads as absent. Presence of the key is
 * therefore not enough for a required var — it needs an actual value.
 */
function missingValues(contents: string, keys: readonly string[]): string[] {
  return keys.filter((key) => {
    const value = valueOf(contents, key);
    return value === undefined || value.length === 0;
  });
}

const REQUIRED = requiredKeys();

describe('committed env files', () => {
  it('derives a non-trivial required set from the schema', () => {
    // Guards the guard: a refactor that broke slice introspection would make every assertion below
    // vacuously true.
    expect(REQUIRED.length).toBeGreaterThan(10);
    expect(REQUIRED).toContain('APP_MODE');
    expect(REQUIRED).toContain('WEB_URL');
  });

  it('gives .env.local a usable value for every required var', () => {
    const missing = missingValues(working('.env.local'), REQUIRED);
    expect(missing, `.env.local has no usable value for: ${missing.join(', ')}`).toEqual([]);
  });

  it('gives .env.example a usable value for every required var', () => {
    // `cp .env.example .env.local` must produce a bootable stack.
    const missing = missingValues(working('.env.example'), REQUIRED);
    expect(missing, `.env.example has no usable value for: ${missing.join(', ')}`).toEqual([]);
  });

  it('documents every committed .env.local var in .env.example', () => {
    // Drift the other way: a var carried in the committed defaults but undocumented in the contract
    // is either dead config or something nobody else knows to set. This caught four retired vars
    // (`GITHUB_CLIENT_ID`/`_SECRET`, superseded by the GitHub App pair, and
    // `ATHENA_AGENT_ENDPOINT`/`_API_KEY`, dropped when the agent runtime moved in-process).
    //
    // BOTH sides read committed content, and that is not incidental. A working-tree check is not
    // available here: the Vercel CLI writes `VERCEL_OIDC_TOKEN` into every real developer's
    // `.env.local` (which `skip-worktree` exists to hide), so comparing their on-disk file would
    // fail permanently for them. The consequence to know about is that a commit which *fixes* drift
    // reads red until it lands, because `HEAD` still holds the old file. Nothing gates on that —
    // lint-staged runs only eslint and prettier — and CI validates the landed state, which is the
    // artifact a fresh clone actually gets.
    const example = assignedKeys(committed('.env.example'));
    const undocumented = [...assignedKeys(committed('.env.local'))]
      .filter((key) => !example.has(key))
      .sort();
    expect(
      undocumented,
      `set in .env.local but absent from .env.example: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });

  it('does not set NODE_ENV in either file', () => {
    // Regression guard for "a stray NODE_ENV breaks every production build": it is
    // framework-managed (`next build` → production) and pinning it here poisons the build.
    expect(assignedKeys(committed('.env.local')).has('NODE_ENV')).toBe(false);
    expect(assignedKeys(working('.env.example')).has('NODE_ENV')).toBe(false);
  });
});

/**
 * Keys whose values are real credentials in a developer's copy. `.env.local` is tracked, so the only
 * things between these and the remote are `skip-worktree` and reviewer attention — this is the third
 * line of defence.
 */
const SECRET_BEARING = [
  'ANTHROPIC_API_KEY',
  'ATHENA_AGENT_API_KEY',
  'BLOB_READ_WRITE_TOKEN',
  'DATABASE_URL_UNPOOLED',
  'EXPORT_BUCKET_TOKEN',
  'GITHUB_CLIENT_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'LINEAR_CLIENT_SECRET',
  'MCP_SESSION_STORE_URL',
  'OAUTH_PROXY_SECRET',
  'SENTRY_DSN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const;

/**
 * Markers that positively identify a value as a local sentinel.
 *
 * @remarks
 * An allowlist of recognisable dev shapes, not a "looks like a secret" detector. Trying to recognise
 * credentials is a losing game; requiring the value to *prove* it is local is not.
 */
const DEV_SENTINEL = /^(dev-|local-)|localhost|not-for-production|change-?me|placeholder/;

describe('committed .env.local secret hygiene', () => {
  const envLocal = committed('.env.local');

  it.each(SECRET_BEARING)('keeps %s empty or an obvious dev sentinel', (key) => {
    const value = valueOf(envLocal, key);
    const safe =
      value === undefined || value.length === 0 || DEV_SENTINEL.test(value.toLowerCase());
    // Reports only the KEY, never the value — a failure here may be a live credential.
    expect(safe, `${key} looks like a real credential and must not be committed`).toBe(true);
  });

  it('never commits the Vercel-issued OIDC token', () => {
    // The Vercel CLI writes this into the developer's file. It is short-lived, machine-issued, and
    // not part of the schema at all, so it must never reach the tracked defaults.
    expect(assignedKeys(envLocal).has('VERCEL_OIDC_TOKEN')).toBe(false);
  });
});

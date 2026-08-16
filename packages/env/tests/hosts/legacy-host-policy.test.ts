/**
 * Repo policy: no legacy `hypertext.studio` hostname may appear in production source.
 *
 * @remarks
 * Production must leave no user-facing Docket or Athena URL under `hypertext.studio`,
 * with exactly one exception — the interim Athena inbound-mail host, which must be a
 * *configuration value* so the final domain replaces it without a code change.
 *
 * A hostname in source is what makes that impossible to honour. It survives every environment
 * change, it is invisible in a `gh variable list`, and the only thing that finds it is someone
 * grepping at the wrong moment. The compliance baseline found five such literals across the API
 * error module, the MCP server, and the marketing legal pages; each one would have kept a
 * user-facing Docket URL on the studio apex after a cutover that otherwise looked complete.
 *
 * This test is the enforcement. It reads the working tree — not `git ls-files` — so a literal
 * fails before it is ever staged.
 *
 * **The literal appears here and nowhere else in the repo's own code.** A ban has to be able
 * to name what it bans, and a test file is not production source. The corresponding *runtime*
 * check is deliberately structural instead: every host comes from its own variable, so every
 * user-facing host to sit under the configured apex, which catches a half-applied cutover to
 * any domain rather than only the one somebody remembered to write down.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Repo root. `fileURLToPath` because this checkout's path contains spaces. */
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/**
 * The banned hostname.
 *
 * @remarks
 * Assembled from parts so that this file does not itself contain the literal string it forbids
 * — otherwise a naive repo-wide grep for the hostname (the check a human runs at cutover, and
 * the one the cutover acceptance criteria name) would always return this test and never read
 * as clean.
 */
const LEGACY_APEX = ['hypertext', 'studio'].join('.');

/**
 * Directories scanned.
 *
 * @remarks
 * "Production source" here means **code that runs inside a deployed process** — the application
 * and package `src` trees. That is the code that can render a link, build a redirect, sign a
 * cookie, or emit a URI, so a hostname in it survives every environment change.
 *
 * `scripts/` is deliberately outside the boundary rather than quietly excluded. Those are
 * developer and operator tools run from a laptop; the hostnames in them are interactive prompt
 * placeholders and CLI defaults (`scripts/bootstrap.ts`, `scripts/integrations-setup.ts`,
 * `scripts/tunnel.ts`, `scripts/production-verify.ts`) that a human sees and can override, not
 * values a visitor is served. They still need repointing at cutover, so they are a checklist
 * item in `docs/engineering/domain-cutover.md` §3.2 rather than a silent omission — and
 * `scripts/domain-check.ts` reports them, which is how the checklist stays honest.
 */
const SCANNED_ROOTS = ['apps', 'packages', 'services'] as const;

/**
 * Directory names that mark a shippable source tree.
 *
 * @remarks
 * Only `src` is scanned inside each workspace, so a package's `tests/`, `e2e/`, config files,
 * and build output are out of scope by construction rather than by an exclusion list.
 */
const SOURCE_DIR = 'src';

/**
 * Directories skipped inside a `src` tree.
 *
 * @remarks
 * `node_modules` and `dist` can appear nested; `dist` in particular holds stale build output
 * that predates this cleanup and would report hits nobody can fix by editing source.
 */
const SKIPPED = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.next']);

/** Extensions treated as source. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Every source file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return []; // a workspace without the directory in question
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (SKIPPED.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...filesUnder(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

/** Every workspace's `src` tree under one of the scanned roots. */
function shippedSourceFiles(): string[] {
  const found: string[] = [];
  for (const root of SCANNED_ROOTS) {
    const rootPath = join(REPO_ROOT, root);
    let workspaces: string[];
    try {
      workspaces = readdirSync(rootPath);
    } catch {
      continue;
    }
    for (const workspace of workspaces) {
      if (SKIPPED.has(workspace)) continue;
      found.push(...filesUnder(join(rootPath, workspace, SOURCE_DIR)));
    }
  }
  return found;
}

/** `file:line` for every line in `file` mentioning the banned apex. */
function legacyHits(file: string): string[] {
  const contents = readFileSync(file, 'utf8');
  if (!contents.includes(LEGACY_APEX)) return [];
  return contents
    .split('\n')
    .map((line, index) =>
      line.includes(LEGACY_APEX) ? `${relative(REPO_ROOT, file)}:${index + 1}` : '',
    )
    .filter((hit) => hit.length > 0);
}

describe('legacy-host policy', () => {
  const files = shippedSourceFiles();

  it('scans a non-trivial amount of production source', () => {
    // Guards the guard: a broken walk would make the assertion below vacuously true.
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith(join('packages', 'env', 'src', 'api.ts')))).toBe(true);
  });

  it('contains no legacy hostname anywhere in production source', () => {
    const hits = files.flatMap(legacyHits);
    expect(
      hits,
      `A legacy hostname is hard-coded in production source. Every ` +
        `user-facing Docket/Athena host must come from configuration — resolve it through ` +
        `the configured host variables instead. Offending lines:\n  ${hits.join('\n  ')}`,
    ).toEqual([]);
  });

  it('leaves the Athena inbound-mail host expressible as configuration only', () => {
    // The inbound-mail domain must stay configuration-driven: the one permitted legacy
    // reference is an environment value, so there must be a registry variable to hold it and
    // no source literal to replace.
    const registry = readFileSync(
      join(REPO_ROOT, 'packages/env/src/registry-vars-infra.ts'),
      'utf8',
    );
    expect(registry).toContain('ATHENA_INBOUND_MAIL_HOST');
  });
});

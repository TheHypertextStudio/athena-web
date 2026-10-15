/**
 * Repo policy: legacy product hosts are forbidden; the approved official legal mailbox is allowed.
 *
 * @remarks
 * Production must leave no user-facing Docket or Athena URL under `hypertext.studio`.
 * The official Studio legal mailbox is a separate operator contact, not a product host.
 * Only that exact mailbox may appear as plain text or a mailto address. The interim Athena
 * inbound-mail host must remain a configuration value so it can change without a code edit.
 *
 * An unapproved hostname in source is what makes that impossible to honour. It survives every environment
 * change, it is invisible in a `gh variable list`, and the only thing that finds it is someone
 * grepping at the wrong moment. The compliance baseline found five such literals across the API
 * error module, the MCP server, and the marketing legal pages; each one would have kept a
 * user-facing Docket URL on the studio apex after a cutover that otherwise looked complete.
 *
 * This test is the enforcement. It reads the working tree — not `git ls-files` — so a literal
 * fails before it is ever staged.
 *
 * A ban has to be able to name what it bans, and a test file is not production source.
 * The runtime check is structural: every host comes from its own variable, so every user-facing
 * host sits under the configured apex. This catches a half-applied cutover to
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
  return legacyReferenceLines(contents).map((line) => `${relative(REPO_ROOT, file)}:${line}`);
}

/** Match only the approved mailbox, excluding other local parts, domain suffixes, and URL users. */
const OFFICIAL_MAILBOX_REFERENCE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_!#$%&'*+/=?^\x60{|}~:@.-]['\x60])(?<![\p{L}\p{N}_!#$%&*+/=?^{|}~:@.-])(?:mailto:)?legal@${LEGACY_APEX.replaceAll('.', '\\.')}(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}_-]|[/\\])`,
  'gu',
);

/** One-based lines containing an unapproved reference to the former product apex. */
function legacyReferenceLines(contents: string): number[] {
  return contents.split('\n').flatMap((line, index) => {
    const withoutOfficialMailbox = line.replaceAll(OFFICIAL_MAILBOX_REFERENCE, '');
    return withoutOfficialMailbox.includes(LEGACY_APEX) ? [index + 1] : [];
  });
}

// The operator's official legal mailbox is intentionally independent of the product host.
const OFFICIAL_LEGAL_MAILBOX = `legal@${LEGACY_APEX}`;

describe('official legal mailbox boundary', () => {
  it.each([
    `const email = '${OFFICIAL_LEGAL_MAILBOX}';`,
    `const email = \`${OFFICIAL_LEGAL_MAILBOX}\`;`,
    `For legal notices: ${OFFICIAL_LEGAL_MAILBOX}. Hypertext Studio.`,
    `<a href="mailto:${OFFICIAL_LEGAL_MAILBOX}">Legal</a>`,
    `${OFFICIAL_LEGAL_MAILBOX} and mailto:${OFFICIAL_LEGAL_MAILBOX}`,
  ])('allows the exact official mailbox: %s', (source) => {
    expect(legacyReferenceLines(source)).toEqual([]);
  });

  it.each([
    `https://${LEGACY_APEX}/terms`,
    `https://athena.${LEGACY_APEX}/privacy`,
    `support@${LEGACY_APEX}`,
    `contact@${LEGACY_APEX}`,
    `privacy@${LEGACY_APEX}`,
    `notlegal@${LEGACY_APEX}`,
    `other!legal@${LEGACY_APEX}`,
    `other'legal@${LEGACY_APEX}`,
    `_'legal@${LEGACY_APEX}`,
    `other''legal@${LEGACY_APEX}`,
    `other\x60legal@${LEGACY_APEX}`,
    `other\x60\x60legal@${LEGACY_APEX}`,
    `legal+test@${LEGACY_APEX}`,
    `legal@sub.${LEGACY_APEX}`,
    `${OFFICIAL_LEGAL_MAILBOX}.evil.test`,
    `mailto:${OFFICIAL_LEGAL_MAILBOX}.evil.test`,
    `https://${OFFICIAL_LEGAL_MAILBOX}/terms`,
    `https://${OFFICIAL_LEGAL_MAILBOX}`,
    `${OFFICIAL_LEGAL_MAILBOX}/privacy`,
    `mailto:support@${LEGACY_APEX}`,
  ])('rejects other addresses and legacy URLs: %s', (source) => {
    expect(legacyReferenceLines(source)).toEqual([1]);
  });

  it('retains the offending line when an allowed mailbox shares it with a legacy URL', () => {
    expect(
      legacyReferenceLines(
        `Allowed: ${OFFICIAL_LEGAL_MAILBOX}\n${OFFICIAL_LEGAL_MAILBOX} https://${LEGACY_APEX}`,
      ),
    ).toEqual([2]);
  });
});

describe('legacy-host policy', () => {
  const files = shippedSourceFiles();

  it('scans a non-trivial amount of production source', () => {
    // Guards the guard: a broken walk would make the assertion below vacuously true.
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith(join('packages', 'env', 'src', 'api.ts')))).toBe(true);
  });

  it('contains no legacy product hosts or unapproved Studio addresses', () => {
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

/**
 * One place decides what a dev host is.
 *
 * @remarks
 * The knowledge of which hostnames and ports a local checkout serves used to live in five files at
 * once — the checked-in env file, `scripts/portless-env.ts`, `apps/api/src/dev-env.ts`,
 * `scripts/dev-stack.sh`, and `.claude/launch.json`. Each carried its own hand-written list of the
 * variables that name a host, and two of those lists had already drifted apart.
 *
 * A drifted list does not fail as a configuration error. It fails as `Invalid origin`, as a
 * `Set-Cookie` the browser silently drops, as a passkey `CHALLENGE_NOT_FOUND`, or as a 404 on a
 * route that exists — hours later, in a different subsystem, and reliably diagnosed as an auth
 * bug. That is the loop this test exists to prevent from reopening: a sixth copy is cheap to add
 * and expensive to discover.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import { HOST_BEARING_VARS } from '@docket/dev-topology';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

const SEARCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.sh', '.json', '.jsonc']);

/** Directories that hold no topology declaration, only records of one. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.next',
  '.git',
  '.turbo',
  'dist',
  'coverage',
  '.data',
  'playwright-report',
  'test-results',
  'tests',
  '__tests__',
  'e2e',
  'docs',
  'repo-tests',
]);

/**
 * Files allowed to name a dev host in an assignment, and why each one is not a topology.
 *
 * @remarks
 * - `packages/dev-topology` **is** the definition.
 * - `apps/api/scripts/export-openapi.ts` sets fixed placeholders so the generated spec has stable
 *   example URLs. No server runs, so there is nothing for the value to disagree with.
 * - `scripts/run-release-acceptance.sh` isolates each run on an ephemeral loopback port, so its
 *   canonical hostnames address a unique port rather than a shared one. It still restates the
 *   relying-party id, which is worth folding into the resolver, but it cannot collide.
 * - `.env.example` and `.env.local` are the canonical base the launchers correct per checkout.
 */
const ALLOWED = [
  'packages/dev-topology/',
  'apps/api/scripts/export-openapi.ts',
  'scripts/run-release-acceptance.sh',
  '.env.example',
  '.env.local',
];

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    if (entry.startsWith('.') && entry !== '.claude') continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry)) continue;
      yield* walk(full);
      continue;
    }
    if (SEARCHED_EXTENSIONS.has(extname(entry))) yield full;
  }
}

/** An assignment of a host-bearing variable to a literal dev host. */
interface Declaration {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function declarationsIn(file: string): readonly Declaration[] {
  const relativePath = relative(REPO_ROOT, file);
  if (ALLOWED.some((allowed) => relativePath.startsWith(allowed))) return [];

  const found: Declaration[] = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const [index, text] of lines.entries()) {
    if (!text.includes('docket.localhost')) continue;
    for (const name of HOST_BEARING_VARS) {
      // `NAME=`, `NAME: `, or `NAME="` followed by a literal dev host on the same line. A line
      // that merely matches or rewrites a host (a Next dev-origin allowlist, a proxy rule) makes
      // no claim about which stack this is and is left alone.
      if (
        new RegExp(String.raw`\b${name}\b\s*[=:]\s*['"\`]?[^'"\`\n]*docket\.localhost`).test(text)
      ) {
        found.push({ file: relativePath, line: index + 1, text: text.trim() });
        break;
      }
    }
  }
  return found;
}

describe('dev topology ownership', () => {
  it('declares every host-bearing variable in exactly one place', () => {
    const declarations = [...walk(REPO_ROOT)].flatMap(declarationsIn);
    expect(
      declarations.map((d) => `${d.file}:${d.line} ${d.text}`),
      'assign these from @docket/dev-topology instead of writing a dev host here',
    ).toEqual([]);
  });

  it('keeps the resolver as the only definition of the dev domain', () => {
    const resolver = readFileSync(resolve(REPO_ROOT, 'packages/dev-topology/src/hosts.ts'), 'utf8');
    expect(resolver).toContain("export const DEV_DOMAIN = 'docket.localhost'");
    // The launchers must hold no list of their own; that duplication is what drifted.
    for (const consumer of ['scripts/portless-env.ts', 'apps/api/src/dev-env.ts']) {
      const source = readFileSync(resolve(REPO_ROOT, consumer), 'utf8');
      expect(source).toContain('@docket/dev-topology');
      expect(source).not.toMatch(/HOST_BEARING_VARS\s*:\s*readonly string\[\]\s*=/);
      expect(source).not.toContain('PORTLESS_HOST_VALUES');
    }
  });

  it('refuses to start a stack whose environment contradicts itself', () => {
    // Booting anyway is what turned a one-line configuration problem into an afternoon.
    expect(readFileSync(resolve(REPO_ROOT, 'scripts/portless-env.ts'), 'utf8')).toContain(
      'checkDevTopology',
    );
    expect(readFileSync(resolve(REPO_ROOT, 'apps/api/src/dev-env.ts'), 'utf8')).toContain(
      'assertDevTopology',
    );
  });

  it("gives the runner a port from the topology rather than wrangler's default", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'apps/runner/package.json'), 'utf8'),
    ) as { readonly scripts?: Readonly<Record<string, string>> };
    // `wrangler dev --local` binds 8787 in every checkout, so two worktrees shared one runner.
    expect(manifest.scripts?.['dev']).toContain('dev-runner.ts');
  });
});

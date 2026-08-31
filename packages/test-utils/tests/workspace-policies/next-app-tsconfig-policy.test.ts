/**
 * Every Next app must keep its Vitest config out of the production build's type check.
 *
 * @remarks
 * The Next Dockerfiles build from `turbo prune <app> --docker`, which copies workspace packages
 * only. `tooling/vitest` has no package.json, so it is not a workspace package and never reaches
 * the pruned context. An app whose tsconfig type-checks `vite.config.ts` therefore fails
 * `next build` inside Docker on `Cannot find module '../../tooling/vitest/preset'` while passing
 * every local check, because locally the file resolves.
 *
 * That is exactly how it went wrong: `apps/web` excluded the file and `apps/admin` did not, so the
 * admin image failed to build. `Deploy production` needs that image and is recorded as *skipped*
 * when it is missing, so the run stays green apart from one job and production silently stops
 * deploying.
 *
 * This cannot be fixed by putting `exclude` in the shared `@docket/tsconfig/nextjs.json`: relative
 * paths in an inherited config resolve against the base config's own directory, so the entry would
 * be interpreted under `tooling/tsconfig/` and match nothing. Verified by trying it —
 * `tsc --listFiles` still listed the app's `vite.config.ts`. Each app must therefore carry the
 * entry itself, which is what this test holds them to.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectWorkspacePackages, relativeToWorkspaceRoot, WORKSPACE_ROOT } from '../workspace';

/**
 * The workspace's Next apps, identified by a Next config sitting beside a tsconfig.
 *
 * @returns each app's tsconfig path, workspace-relative so a failure names the file to edit.
 */
function nextAppTsconfigs(): string[] {
  return collectWorkspacePackages()
    .map((pkg) => resolve(WORKSPACE_ROOT, pkg.directory))
    .filter(
      (dir) =>
        existsSync(resolve(dir, 'tsconfig.json')) &&
        (existsSync(resolve(dir, 'next.config.ts')) || existsSync(resolve(dir, 'next.config.js'))),
    )
    .map((dir) => relativeToWorkspaceRoot(resolve(dir, 'tsconfig.json')));
}

describe('Next app tsconfig policy', () => {
  const tsconfigs = nextAppTsconfigs();

  it('finds the Next apps it is meant to police', () => {
    // Guards the discovery itself: a policy that silently matches nothing passes forever.
    expect(tsconfigs.length).toBeGreaterThanOrEqual(2);
  });

  it.each(tsconfigs)('%s excludes vite.config.ts from its type check', (tsconfigPath) => {
    // Plain JSON, not JSONC: Prettier formats these files and neither carries a comment. A
    // comment added later fails here loudly rather than being silently mis-parsed.
    const raw = readFileSync(resolve(WORKSPACE_ROOT, tsconfigPath), 'utf8');
    const tsconfig = JSON.parse(raw) as { exclude?: string[] };
    expect(tsconfig.exclude ?? []).toContain('vite.config.ts');
  });
});

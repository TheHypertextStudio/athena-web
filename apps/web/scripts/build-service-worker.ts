/**
 * `pnpm --filter @docket/web exec tsx scripts/build-service-worker.ts` — bundle
 * {@link file://../service-worker/sw.ts} to `public/sw.js`.
 *
 * @remarks
 * The worker is authored in TypeScript and bundled rather than hand-written as plain JavaScript in
 * `public/`, because `public/` is **not** excluded from this repository's ESLint config: linting
 * there runs with `projectService`, and `apps/web/tsconfig.json` includes no `.js` glob at all, so a
 * hand-written `public/sw.js` would fail to parse under lint and be invisible to `tsc` at the same
 * time. Bundling keeps the one script that sits in front of every request under the same
 * type-checking and lint rules as the rest of the app.
 *
 * **ESM in, classic worker out.** The source is written as ES modules so the routing table and the
 * cache strategies are separate, individually testable units. The output is a single bundled IIFE,
 * *not* an ES module, and that is deliberate: native module workers
 * (`register(..., { type: 'module' })`) are unsupported in Firefox and in Safari before 16.4, so
 * shipping one would make offline support Chrome-only. Bundling resolves the imports at build time
 * and leaves a plain classic script every browser can run — modular source, universal output.
 *
 * The output is generated, so it is gitignored; `turbo.json` lists it as a build output.
 *
 * **Ordering matters.** The cache version comes from Next's own `.next/BUILD_ID`, which only exists
 * after `next build` — hence `"build": "next build && tsx scripts/build-service-worker.ts"` rather
 * than a `prebuild` hook. A stable id per build is what makes the update prompt fire exactly once
 * per deploy: the bundled bytes change, the browser sees a byte-different worker, and it installs
 * into the waiting state. In dev the id falls back to `dev`, so restarting the dev server does not
 * masquerade as a new version.
 */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Next's build id, or `'dev'` when no production build is present. */
function readBuildId(): string {
  try {
    const id = readFileSync(join(WEB_ROOT, '.next/BUILD_ID'), 'utf8').trim();
    return id.length > 0 ? id : 'dev';
  } catch {
    return 'dev';
  }
}

/**
 * Production mode is declared, never inferred.
 *
 * @remarks
 * It would be tempting to treat "a `.next/BUILD_ID` exists" as production, but a stale one is left
 * behind by any earlier build, so a dev run would silently produce a production worker — which
 * makes `/_next/static` cache-first against Turbopack's non-content-hashed dev chunks and breaks
 * hot reload in a way that looks like a caching bug rather than a build-mode bug. The `build`
 * script passes `--production`; `dev:app` does not.
 */
const production = process.argv.includes('--production');
// The version only has to be stable per build and different across builds. In dev it is pinned to
// `dev` so restarting the dev server never masquerades as a new version.
const buildId = production ? readBuildId() : 'dev';

await build({
  absWorkingDir: WEB_ROOT,
  entryPoints: ['service-worker/sw.ts'],
  outfile: 'public/sw.js',
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: production,
  // Inlined rather than read at runtime: a service worker has no access to the app's env, and
  // these must be baked into the bytes the browser compares when deciding an update exists.
  define: {
    __SW_BUILD_ID__: JSON.stringify(buildId),
    __SW_MODE__: JSON.stringify(production ? 'production' : 'development'),
    // The worker answers Athena's questions straight from a notification, which means it needs the
    // API origin; a service worker cannot read `process.env` at runtime, so it is baked in here.
    __SW_API_ORIGIN__: JSON.stringify(process.env['NEXT_PUBLIC_API_URL'] ?? ''),
  },
});

process.stdout.write(
  `public/sw.js — build ${buildId} (${production ? 'production' : 'development'})\n`,
);

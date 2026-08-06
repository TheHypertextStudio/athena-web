/**
 * Bundle {@link file://../src/worker/sw.ts} into a host app's `public/sw.js`.
 *
 * @remarks
 * Invoked as `tsx bin/build.ts --app-root=<path> [--production]`. `apps/web` drives it through
 * its own `build:sw` script, and `turbo.json` — not a shell `&&` — is what guarantees this runs
 * after `next build`, because the cache version and the precache list are both read out of
 * `.next`.
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertWithinBudget,
  collectPrecacheAssets,
  formatBytes,
  totalBytes,
  type PrecacheAsset,
} from '../src/precache-manifest';

/** This package's own root — where the worker source lives. */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The host application's root: where `.next` is read from and `public/sw.js` is written.
 *
 * @remarks
 * Required, never inferred. This bundler used to sit inside `apps/web` and could assume its own
 * location was the app; it is now a package that any app can call, and quietly defaulting to a
 * guess would write a worker into whichever directory happened to be current.
 */
function readAppRoot(argv: readonly string[]): string {
  const flag = argv.find((arg) => arg.startsWith('--app-root='));
  const value = flag?.slice('--app-root='.length);
  if (value === undefined || value.length === 0) {
    throw new Error('build-service-worker: --app-root=<path to the host app> is required');
  }
  return resolve(value);
}

const WEB_ROOT = readAppRoot(process.argv.slice(2));

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

/**
 * The assets to precache, and nothing in development.
 *
 * @remarks
 * Turbopack rebuilds dev chunks in place under the same paths, so a dev precache would pin stale
 * code — the same reason `routing.ts` only caches `/_next/static` in production builds.
 */
const precache: readonly PrecacheAsset[] = production
  ? collectPrecacheAssets(join(WEB_ROOT, '.next/static'))
  : [];
assertWithinBudget(precache);

await build({
  absWorkingDir: PACKAGE_ROOT,
  entryPoints: ['src/worker/sw.ts'],
  outfile: join(WEB_ROOT, 'public/sw.js'),
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
    // Inlined rather than fetched at runtime: a manifest request would be one more thing that can
    // fail, and the list has to be part of the bytes the browser diffs when deciding an update
    // exists — otherwise a release that only changed which assets exist would not install.
    __SW_PRECACHE__: JSON.stringify(precache.map((asset) => asset.url)),
  },
});

process.stdout.write(
  `public/sw.js — build ${buildId} (${production ? 'production' : 'development'})` +
    (production
      ? `, precaching ${String(precache.length)} assets (${formatBytes(totalBytes(precache))})`
      : '') +
    '\n',
);

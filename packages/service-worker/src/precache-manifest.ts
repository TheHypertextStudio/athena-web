/**
 * The list of build assets the service worker precaches, and the budget that keeps it honest.
 *
 * @remarks
 * **`routing.ts` used to argue this file should not exist**, and the argument was that Next's
 * content-hashed URLs make a cache-first strategy self-healing without a build-time manifest. That
 * is true about *correctness* and false about *coverage*: a chunk that has never been fetched is not
 * in the cache, which is exactly why a route nobody visited cannot render offline. Cache-first
 * cannot fix that, because there is nothing to be first about.
 *
 * The governing rule is **precache anything that will not take a surprising amount of space on the
 * device**, so this is a measured budget rather than a curated list of routes. Measured against the
 * real build, the whole of `.next/static` is about 8 MB on disk and 2 MB over the wire — the entire
 * application's code, styles and fonts. At that size there is nothing to choose between: everything
 * ships, and the budget exists to catch the release where that stops being true.
 *
 * When the budget is exceeded the build **fails**, printing the largest assets. It does not silently
 * drop them: a precache that quietly shrinks is a feature that quietly stops working, and the person
 * it stops working for is offline and cannot be told.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The ceiling on precached bytes, uncompressed.
 *
 * @remarks
 * Twelve megabytes against a current 8.3, so roughly 45% headroom. Uncompressed because that is the
 * honest upper bound on what the device stores, and because "space on the user's device" is the
 * thing being bounded — not what crosses the wire.
 *
 * Raising this is a decision, not a formality: it means every install and every release costs the
 * new figure, on whatever connection the person happens to be on.
 */
export const PRECACHE_BUDGET_BYTES = 12 * 1024 * 1024;

/** One asset the worker will precache. */
export interface PrecacheAsset {
  /** The URL the browser will request. */
  readonly url: string;
  /** Its size on disk, uncompressed. */
  readonly bytes: number;
}

/**
 * Every emitted static asset, as URLs the worker can fetch.
 *
 * @remarks
 * The whole of `.next/static` rather than a manifest walk from the route table's module. Both would
 * work, but the directory is the thing that is actually true: it is what the server will serve, it
 * needs no knowledge of which bundler emitted what, and it cannot fall out of step with a manifest
 * format that changes between Next releases. It also sweeps in the fonts and stylesheets, without
 * which a route that "renders" offline renders unstyled in a fallback face.
 *
 * @param staticDir - Absolute path of `.next/static`.
 * @returns The assets, sorted by URL so the generated worker is byte-stable across builds.
 */
export function collectPrecacheAssets(staticDir: string): readonly PrecacheAsset[] {
  const assets: PrecacheAsset[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      assets.push({
        url: `/_next/static/${relative(staticDir, path).split('\\').join('/')}`,
        bytes: statSync(path).size,
      });
    }
  };

  walk(staticDir);
  return assets.sort((a, b) => (a.url < b.url ? -1 : 1));
}

/** Total bytes across a set of assets. */
export function totalBytes(assets: readonly PrecacheAsset[]): number {
  return assets.reduce((sum, asset) => sum + asset.bytes, 0);
}

/**
 * Refuse to build a worker whose precache is larger than the budget.
 *
 * @param assets - The assets that would be precached.
 * @param budget - The ceiling, in bytes.
 * @throws {Error} When the total exceeds the budget, naming the ten largest assets.
 */
export function assertWithinBudget(
  assets: readonly PrecacheAsset[],
  budget: number = PRECACHE_BUDGET_BYTES,
): void {
  const total = totalBytes(assets);
  if (total <= budget) {
    return;
  }

  const worst = [...assets]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10)
    .map((asset) => `  ${formatBytes(asset.bytes).padStart(9)}  ${asset.url}`)
    .join('\n');

  throw new Error(
    `The service worker would precache ${formatBytes(total)}, over the ${formatBytes(budget)} budget.\n` +
      `Every install and every release pays this, on whatever connection the person is on.\n` +
      `Either cut what got large or raise PRECACHE_BUDGET_BYTES deliberately.\n\nLargest assets:\n${worst}\n`,
  );
}

/** Bytes, rendered the way a person reads them. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

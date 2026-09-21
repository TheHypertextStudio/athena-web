import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  openAsBlob,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const MIGRATIONS = join(REPO_ROOT, 'packages/db/drizzle');
const CACHE_DIR = join(REPO_ROOT, 'node_modules/.cache/api-test-template');

/** Concatenate the generated migration SQL in journal order, exactly as the schema is deployed. */
function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS, file), 'utf8'))
    .join('\n');
}

/** Read the installed PGlite version, which a snapshot's on-disk format depends on. */
function pgliteVersion(): string {
  let dir = dirname(createRequire(import.meta.url).resolve('@electric-sql/pglite'));
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (parsed.name === '@electric-sql/pglite') return parsed.version ?? 'unknown';
    }
    const parent = dirname(dir);
    if (parent === dir) return 'unknown';
    dir = parent;
  }
}

/**
 * Name the snapshot after everything that shapes its contents.
 *
 * @remarks
 * A new migration, an edit to this module, or a PGlite upgrade each produce a different name, so a
 * stale snapshot is never read. Nobody has to remember to clear a cache.
 */
function templatePath(sql: string): string {
  const key = createHash('sha256')
    .update(sql)
    .update(readFileSync(import.meta.filename))
    .update(pgliteVersion())
    .digest('hex')
    .slice(0, 16);
  return join(CACHE_DIR, `${key}.tar`);
}

/**
 * Remove snapshots for schemas that no longer exist, since each one is tens of megabytes.
 *
 * @remarks
 * Only finished `.tar` files go. A sibling worker's in-progress `.tmp` file lives in the same
 * directory, and deleting it would make that worker's rename fail.
 */
function pruneStaleTemplates(current: string): void {
  for (const file of readdirSync(CACHE_DIR)) {
    const path = join(CACHE_DIR, file);
    if (file.endsWith('.tar') && path !== current) rmSync(path, { force: true });
  }
}

/**
 * Migrate a throwaway database once and write its `dumpDataDir()` snapshot to disk.
 *
 * @returns the snapshot's path, which is already in place when the schema has not changed.
 *
 * @remarks
 * Replaying the full migration chain costs about three CPU-seconds, and every database-backed
 * test file runs in its own process, so each one used to pay it. Loading this snapshot instead
 * costs about a fifth of that. The file is written under a private name and renamed into place, so
 * a run that skips the global setup and builds it lazily cannot expose a half-written snapshot to
 * a sibling worker.
 */
export async function ensurePgliteTemplate(): Promise<string> {
  const sql = migrationSql();
  const path = templatePath(sql);
  if (existsSync(path)) return path;

  mkdirSync(CACHE_DIR, { recursive: true });
  const source = new PGlite('memory://');
  try {
    await source.exec(sql);
    const dump = await source.dumpDataDir('none');
    const scratch = `${path}.${process.pid}.tmp`;
    writeFileSync(scratch, Buffer.from(await dump.arrayBuffer()));
    renameSync(scratch, path);
  } finally {
    await source.close();
  }
  pruneStaleTemplates(path);
  return path;
}

/**
 * Load the migrated snapshot as a file-backed `Blob`, so a worker does not copy it into memory.
 *
 * @returns a snapshot for `@docket/db`'s `setPgliteTemplate`, or for `new PGlite({ loadDataDir })`.
 */
export async function loadPgliteTemplate(): Promise<Blob> {
  return openAsBlob(await ensurePgliteTemplate());
}

/**
 * Open a new in-memory PGlite that already holds the migrated schema.
 *
 * @remarks
 * The snapshot carries the schema only. The complimentary-Pro trigger from
 * `installTestProductEntitlementFixture` is a per-suite choice, so a suite that wants it installs
 * it on the returned client, as `getMigratedDb` does.
 *
 * @returns a ready client the caller owns and must close.
 */
export async function openMigratedPglite(): Promise<PGlite> {
  return new PGlite('memory://', { loadDataDir: await loadPgliteTemplate() });
}

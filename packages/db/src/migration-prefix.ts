import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

interface MigrationJournal {
  readonly version: string;
  readonly dialect: string;
  readonly entries: readonly {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }[];
}

/** Run the normal migrator through a checkpoint using unchanged SQL and its original journal. */
export async function withMigrationPrefix(
  migrationsFolder: string,
  lastTag: string,
  applySqlMigrations: (folder: string) => Promise<void>,
): Promise<void> {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as MigrationJournal;
  const last = journal.entries.findIndex((entry) => entry.tag === lastTag);
  if (last < 0) throw new Error(`Migration checkpoint is missing: ${lastTag}`);
  const entries = journal.entries.slice(0, last + 1);
  const scratch = mkdtempSync(join(tmpdir(), 'docket-migration-'));
  try {
    mkdirSync(join(scratch, 'meta'));
    writeFileSync(join(scratch, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) {
      if (basename(entry.tag) !== entry.tag || !/^\d{4}_[a-z0-9_-]+$/.test(entry.tag)) {
        throw new Error('Migration journal contains an invalid file name.');
      }
      copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(scratch, `${entry.tag}.sql`));
    }
    await applySqlMigrations(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

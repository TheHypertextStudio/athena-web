import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { getTableColumns, sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { expect, it } from 'vitest';

import { fullSchema } from '../../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { template, workTypeVersion } from '../../src/schema';

function futureMigrations(): string {
  const folder = mkdtempSync(join(tmpdir(), 'docket-future-migration-test-'));
  cpSync(resolve(import.meta.dirname, '../../drizzle'), folder, { recursive: true });
  const journalPath = join(folder, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; when: number; version: string; tag: string; breakpoints: boolean }[];
  };
  const latest = journal.entries.at(-1);
  if (!latest) throw new Error('Migration fixture requires a journal.');
  const tag = `${String(latest.idx + 1).padStart(4, '0')}_future_template_column`;
  journal.entries.push({
    idx: latest.idx + 1,
    when: latest.when + 1,
    version: '7',
    tag,
    breakpoints: true,
  });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(
    join(folder, `${tag}.sql`),
    "ALTER TABLE template ADD COLUMN future_template_label text DEFAULT 'future';\n" +
      '--> statement-breakpoint\n' +
      "ALTER TABLE work_type_version ADD COLUMN future_version_label text DEFAULT 'future';",
  );
  return folder;
}

it.each(['fresh', 'legacy', 'expanded', 'enforced'] as const)(
  'applies future template SQL from a %s database using a future application schema',
  async (stage) => {
    const folder = futureMigrations();
    const client = new PGlite('memory://');
    const database = drizzle(client, { schema: fullSchema });
    const applySqlMigrations = (migrationsFolder: string) =>
      migrate(database, { migrationsFolder });
    const columns = getTableColumns(template);
    const versionColumns = getTableColumns(workTypeVersion);
    try {
      if (stage !== 'fresh') {
        await withMigrationPrefix(folder, '0150_personal_inbound_receipts', applySqlMigrations);
        await database.execute(sql`insert into organization (id, name, slug)
          values ('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'Upgrade', 'upgrade')`);
      }
      if (stage === 'expanded')
        await withMigrationPrefix(folder, '0151_work_template_identity_expand', applySqlMigrations);
      if (stage === 'enforced') {
        const currentFolder = resolve(import.meta.dirname, '../../drizzle');
        await migrateWithWorkTemplateCheckpoint(database, {
          migrationsFolder: currentFolder,
          applySqlMigrations,
        });
        // A completed checkpoint is historical work, not ongoing workspace repair.
        await database.execute(sql`insert into organization (id, name, slug)
          values ('01ARZ3NDEKTSV4RRFFQ69G5FAW', 'Unprovisioned', 'unprovisioned')`);
      }
      // Model a future binary's live schema without changing historical SQL fixtures.
      Object.assign(
        columns,
        getTableColumns(
          pgTable('template', {
            futureTemplateLabel: text('future_template_label').default('future'),
          }),
        ),
      );
      Object.assign(
        versionColumns,
        getTableColumns(
          pgTable('work_type_version', {
            futureVersionLabel: text('future_version_label').default('future'),
          }),
        ),
      );
      await expect(
        migrateWithWorkTemplateCheckpoint(database, {
          migrationsFolder: folder,
          applySqlMigrations,
        }),
      ).resolves.toBeUndefined();
      const result = await database.execute(sql`select future_template_label from template`);
      expect(result.rows).toHaveLength(stage === 'fresh' ? 0 : 4);
      expect(result.rows.every((row) => row['future_template_label'] === 'future')).toBe(true);
      await expect(applySqlMigrations(folder)).resolves.toBeUndefined();
    } finally {
      Reflect.deleteProperty(columns, 'futureTemplateLabel');
      Reflect.deleteProperty(versionColumns, 'futureVersionLabel');
      await client.close();
      rmSync(folder, { recursive: true, force: true });
    }
  },
);

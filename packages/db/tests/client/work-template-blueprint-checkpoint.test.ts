/** Prepared for packages/db/tests/client; do not execute before the DB hold is released. */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { expect, it } from 'vitest';

import { fullSchema } from '../../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';

interface Journal {
  entries: { tag: string; when: number }[];
}

it('applies both expansion/data/enforcement boundaries before the remaining SQL journal', async () => {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
  const observedPrefixes: string[] = [];
  try {
    await migrateWithWorkTemplateCheckpoint(database, {
      migrationsFolder,
      applySqlMigrations: async (folder) => {
        const journal = JSON.parse(
          readFileSync(join(folder, 'meta/_journal.json'), 'utf8'),
        ) as Journal;
        const tip = journal.entries.at(-1);
        if (!tip) throw new Error('Expected a real migration journal.');
        observedPrefixes.push(tip.tag);
        await migrate(database, { migrationsFolder: folder });
      },
    });
    // Current runner jumps directly from0151 to the full journal. That must fail this assertion
    // even if a fresh empty database happens to accept SQL enforcement without retained rows.
    expect(observedPrefixes.slice(0, 3)).toEqual([
      '0151_work_template_identity_expand',
      '0153_process_task_template_identity',
      '0154_work_template_blueprints_expand',
    ]);
    expect(observedPrefixes).toHaveLength(4);
    const final = JSON.parse(
      readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
    ) as Journal;
    expect(observedPrefixes[3]).toBe(final.entries.at(-1)?.tag);
  } finally {
    await client.close();
  }
});

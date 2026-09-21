import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A snapshot taken from one real PGlite must come back intact through `@docket/db`'s client.
 *
 * `client.test.ts` replaces PGlite with a double to check which driver is chosen. This file uses
 * the real one, because the property that matters here is that the dumped schema and rows survive
 * the round trip, and a double cannot show that.
 */

afterEach(async () => {
  const { closeDb } = await import('../../src/client');
  await closeDb();
  vi.resetModules();
});

/** Build a snapshot holding one table with one row. */
async function snapshot(): Promise<Blob> {
  const source = new PGlite('memory://');
  await source.exec(`
    create table template_probe (id integer primary key, label text not null);
    insert into template_probe values (1, 'from the template');
  `);
  const dump = await source.dumpDataDir('none');
  await source.close();
  return dump;
}

describe('setPgliteTemplate', () => {
  it('opens the database with the schema and rows the snapshot held', async () => {
    vi.stubEnv('DATABASE_URL', 'pglite://memory');
    const { db, setPgliteTemplate } = await import('../../src/client');
    setPgliteTemplate(await snapshot());

    const result: unknown = await db.execute(sql`select label from template_probe where id = 1`);

    expect(result).toMatchObject({ rows: [{ label: 'from the template' }] });
  });

  it('opens an empty database once the template is cleared', async () => {
    vi.stubEnv('DATABASE_URL', 'pglite://memory');
    const { db, setPgliteTemplate } = await import('../../src/client');
    setPgliteTemplate(await snapshot());
    setPgliteTemplate(undefined);

    await expect(db.execute(sql`select 1 from template_probe`)).rejects.toThrow();
  });
});

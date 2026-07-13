import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const client = new PGlite('memory://');
const db = drizzle(client);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });
});

afterAll(async () => {
  await client.close();
});

describe('Initiative experience schema', () => {
  it('stores the manual lifecycle, priority, and update cadence enums', async () => {
    const result = (await db.execute(sql`
      select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as values
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname in ('initiative_status', 'initiative_priority', 'initiative_update_cadence')
      group by t.typname
      order by t.typname
    `)) as unknown as { rows: { name: string; values: string[] }[] };

    expect(result.rows).toEqual([
      { name: 'initiative_priority', values: ['none', 'low', 'medium', 'high'] },
      { name: 'initiative_status', values: ['proposed', 'active', 'completed', 'canceled'] },
      {
        name: 'initiative_update_cadence',
        values: ['weekly', 'biweekly', 'monthly', 'quarterly', 'none'],
      },
    ]);
  });

  it('adds Initiative document metadata and the default workspace depth', async () => {
    const result = (await db.execute(sql`
      select table_name, column_name
      from information_schema.columns
      where (table_name = 'initiative' and column_name in ('summary', 'priority', 'update_cadence'))
         or (table_name = 'organization' and column_name = 'initiative_max_depth')
      order by table_name, column_name
    `)) as unknown as { rows: { table_name: string; column_name: string }[] };

    expect(result.rows).toEqual([
      { table_name: 'initiative', column_name: 'priority' },
      { table_name: 'initiative', column_name: 'summary' },
      { table_name: 'initiative', column_name: 'update_cadence' },
      { table_name: 'organization', column_name: 'initiative_max_depth' },
    ]);
  });

  it('creates context-owned hierarchy and Initiative label tables', async () => {
    for (const table of ['initiative_hierarchy_link', 'initiative_label']) {
      const result = (await db.execute(
        sql`select to_regclass(${`public.${table}`}) as reg`,
      )) as unknown as { rows: { reg: string | null }[] };
      expect(result.rows[0]?.reg, `table ${table} should exist`).not.toBeNull();
    }
  });

  it('allows URL resources to name an Initiative as their subject', async () => {
    const result = (await db.execute(sql`
      select e.enumlabel as value
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname = 'attachment_subject_type'
      order by e.enumsortorder
    `)) as unknown as { rows: { value: string }[] };

    expect(result.rows.map((row) => row.value)).toContain('initiative');
  });
});

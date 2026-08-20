import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const client = new PGlite('memory://');
const db = drizzle(client);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
});

afterAll(async () => {
  await client.close();
});

describe('planning timeframe schema', () => {
  it('stores Linear resolution values', async () => {
    const result = (await db.execute(sql`
      select e.enumlabel as value
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname = 'planning_date_resolution'
      order by e.enumsortorder
    `)) as unknown as { rows: { value: string }[] };

    expect(result.rows.map((row) => row.value)).toEqual(['month', 'quarter', 'halfYear', 'year']);
  });

  it('adds resolution and fiscal snapshot columns only to planning dates', async () => {
    const result = (await db.execute(sql`
      select table_name, column_name
      from information_schema.columns
      where (table_name = 'project' and column_name in (
        'start_date_resolution',
        'start_date_fiscal_year_start_month',
        'target_date_resolution',
        'target_date_fiscal_year_start_month'
      )) or (table_name = 'initiative' and column_name in (
        'target_date_resolution',
        'target_date_fiscal_year_start_month'
      )) or (table_name = 'organization' and column_name = 'fiscal_year_start_month')
      order by table_name, column_name
    `)) as unknown as { rows: { table_name: string; column_name: string }[] };

    expect(result.rows).toEqual([
      { table_name: 'initiative', column_name: 'target_date_fiscal_year_start_month' },
      { table_name: 'initiative', column_name: 'target_date_resolution' },
      { table_name: 'organization', column_name: 'fiscal_year_start_month' },
      { table_name: 'project', column_name: 'start_date_fiscal_year_start_month' },
      { table_name: 'project', column_name: 'start_date_resolution' },
      { table_name: 'project', column_name: 'target_date_fiscal_year_start_month' },
      { table_name: 'project', column_name: 'target_date_resolution' },
    ]);
  });

  it('defaults workspaces to January and bounds the setting', async () => {
    const column = (await db.execute(sql`
      select column_default as default_value, is_nullable
      from information_schema.columns
      where table_name = 'organization' and column_name = 'fiscal_year_start_month'
    `)) as unknown as { rows: { default_value: string | null; is_nullable: string }[] };
    expect(column.rows).toEqual([{ default_value: '0', is_nullable: 'NO' }]);

    const constraint = (await db.execute(sql`
      select pg_get_constraintdef(c.oid) as definition
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      where t.relname = 'organization'
        and c.conname = 'organization_fiscal_year_start_month_check'
    `)) as unknown as { rows: { definition: string }[] };
    expect(constraint.rows[0]?.definition).toContain('fiscal_year_start_month >= 0');
    expect(constraint.rows[0]?.definition).toContain('fiscal_year_start_month <= 11');
  });

  it('installs metadata-pair and boundary constraints on every broad field', async () => {
    const result = (await db.execute(sql`
      select t.relname as table_name, c.conname as constraint_name
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      where c.conname in (
        'project_start_timeframe_pair_check',
        'project_start_timeframe_boundary_check',
        'project_target_timeframe_pair_check',
        'project_target_timeframe_boundary_check',
        'initiative_target_timeframe_pair_check',
        'initiative_target_timeframe_boundary_check'
      )
      order by c.conname
    `)) as unknown as { rows: { table_name: string; constraint_name: string }[] };

    expect(result.rows).toHaveLength(6);
  });

  it('accepts exact dates and canonical fiscal boundaries', async () => {
    await db.execute(sql`
      insert into organization (id, name, slug, fiscal_year_start_month)
      values ('timeframe-org', 'Timeframe Org', 'timeframe-org', 6)
    `);
    await db.execute(sql`
      insert into work_status (
        id, organization_id, entity_type, key, name, category, position, is_default
      ) values
        ('timeframe-project-status', 'timeframe-org', 'project', 'planned', 'Planned', 'unstarted', 0, true),
        ('timeframe-initiative-status', 'timeframe-org', 'initiative', 'active', 'Active', 'started', 0, true)
    `);

    await expect(
      db.execute(sql`
        insert into project (
          id, organization_id, name, status, status_id,
          start_date, start_date_resolution, start_date_fiscal_year_start_month,
          target_date, target_date_resolution, target_date_fiscal_year_start_month
        ) values (
          'precise-project', 'timeframe-org', 'Precise', 'planned', 'timeframe-project-status',
          '2026-07-17', null, null,
          '2027-04-23', null, null
        ), (
          'broad-project', 'timeframe-org', 'Broad', 'planned', 'timeframe-project-status',
          '2026-07-01', 'quarter', 6,
          '2027-06-30', 'year', 6
        )
      `),
    ).resolves.toBeDefined();

    await expect(
      db.execute(sql`
        insert into initiative (
          id, organization_id, name, status, status_id,
          target_date, target_date_resolution, target_date_fiscal_year_start_month
        ) values (
          'broad-initiative', 'timeframe-org', 'Broad Initiative', 'active',
          'timeframe-initiative-status', '2026-12-31', 'halfYear', 6
        )
      `),
    ).resolves.toBeDefined();
  });

  it('rejects incomplete metadata and noncanonical boundaries', async () => {
    await expect(
      db.execute(sql`
        insert into project (
          id, organization_id, name, status, status_id,
          start_date, start_date_resolution, start_date_fiscal_year_start_month
        ) values (
          'bad-pair-project', 'timeframe-org', 'Bad pair', 'planned',
          'timeframe-project-status', '2026-07-01', 'quarter', null
        )
      `),
    ).rejects.toThrow();

    await expect(
      db.execute(sql`
        insert into project (
          id, organization_id, name, status, status_id,
          target_date, target_date_resolution, target_date_fiscal_year_start_month
        ) values (
          'bad-boundary-project', 'timeframe-org', 'Bad boundary', 'planned',
          'timeframe-project-status', '2026-09-29', 'quarter', 6
        )
      `),
    ).rejects.toThrow();

    await expect(
      db.execute(sql`
        insert into initiative (
          id, organization_id, name, status, status_id,
          target_date, target_date_resolution, target_date_fiscal_year_start_month
        ) values (
          'bad-boundary-initiative', 'timeframe-org', 'Bad boundary', 'active',
          'timeframe-initiative-status', '2026-12-30', 'halfYear', 6
        )
      `),
    ).rejects.toThrow();
  });
});

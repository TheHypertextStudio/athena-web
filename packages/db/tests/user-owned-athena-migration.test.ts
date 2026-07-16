import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const migrationsFolder = resolve(import.meta.dirname, '../drizzle');
const migrationName = '0041_user_owned_athena.sql';
const clients: PGlite[] = [];
const allowedDdlVerbs = new Set(['ALTER', 'COMMENT', 'CREATE', 'DROP']);

function migrationSql(through: string): string {
  return readdirSync(migrationsFolder)
    .filter((file) => file.endsWith('.sql') && file <= through)
    .sort()
    .map((file) => readFileSync(resolve(migrationsFolder, file), 'utf8'))
    .join('\n');
}

function normalizedStatements(sql: string): string[] {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function isDdlOnlyStatement(statement: string): boolean {
  const [verb] = statement.toUpperCase().split(' ');
  return Boolean(verb && allowedDdlVerbs.has(verb));
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('user-owned Athena migration', () => {
  it('ships the next ordered migration using DDL statements only', () => {
    const sql = readFileSync(resolve(migrationsFolder, migrationName), 'utf8');
    const statements = normalizedStatements(sql);

    expect(readdirSync(migrationsFolder)).toContain(migrationName);
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.filter((statement) => !isDdlOnlyStatement(statement))).toEqual([]);
  });

  it('classifies direct and CTE data modification as unsafe after removing comments', () => {
    const [commentedDdl] = normalizedStatements(
      '-- DELETE FROM ignored_comment\nCREATE TABLE safe(id text)',
    );
    expect(commentedDdl).toBeDefined();
    expect(isDdlOnlyStatement(commentedDdl ?? '')).toBe(true);

    const unsafeStatements = [
      'INSERT INTO target VALUES (1)',
      'UPDATE target SET value = 1',
      'DELETE FROM target',
      'MERGE INTO target USING source ON true WHEN MATCHED THEN DELETE',
      'COPY target FROM STDIN',
      'WITH changed AS (DELETE FROM target RETURNING *) SELECT * FROM changed',
    ];
    expect(unsafeStatements.every((statement) => !isDdlOnlyStatement(statement))).toBe(true);
  });

  it('replays the complete migration chain into the fresh executor schema', async () => {
    const client = new PGlite('memory://');
    clients.push(client);

    await client.exec(migrationSql(migrationName));

    const columns = await client.query<{
      column_name: string;
      is_nullable: 'YES' | 'NO';
    }>(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'agent_session'
        AND column_name IN (
          'agent_id',
          'context_organization_id',
          'executor_kind',
          'organization_id',
          'owner_user_id'
        )
      ORDER BY column_name
    `);
    expect(columns.rows).toEqual([
      { column_name: 'agent_id', is_nullable: 'YES' },
      { column_name: 'context_organization_id', is_nullable: 'YES' },
      { column_name: 'executor_kind', is_nullable: 'NO' },
      { column_name: 'organization_id', is_nullable: 'YES' },
      { column_name: 'owner_user_id', is_nullable: 'YES' },
    ]);

    const constraints = await client.query<{ constraint_name: string }>(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name IN (
        'agent_session',
        'agent_session_run',
        'agent_session_transcript'
      )
        AND constraint_name IN (
          'agent_session_executor_shape_check',
          'agent_session_run_attribution_check',
          'agent_session_run_parent_owner_fk',
          'agent_session_run_parent_org_fk',
          'agent_session_transcript_attribution_check',
          'agent_session_transcript_parent_owner_fk',
          'agent_session_transcript_parent_org_fk'
        )
      ORDER BY constraint_name
    `);
    expect(constraints.rows.map((row) => row.constraint_name)).toEqual([
      'agent_session_executor_shape_check',
      'agent_session_run_attribution_check',
      'agent_session_run_parent_org_fk',
      'agent_session_run_parent_owner_fk',
      'agent_session_transcript_attribution_check',
      'agent_session_transcript_parent_org_fk',
      'agent_session_transcript_parent_owner_fk',
    ]);
  });
});

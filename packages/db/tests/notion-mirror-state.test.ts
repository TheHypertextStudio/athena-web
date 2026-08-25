import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as notionMirrorSchema from '../src/schema/notion-mirror';

describe('notion mirror wake state', () => {
  it('stores one durable generation pair per integration', () => {
    const state = (notionMirrorSchema as Record<string, unknown>)['notionMirrorState'];
    expect(state).toBeDefined();

    const config = getTableConfig(state as PgTable);
    expect(config.name).toBe('notion_mirror_state');
    expect(config.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'integration_id',
        'organization_id',
        'desired_generation',
        'applied_generation',
        'next_attempt_at',
        'consecutive_failures',
        'last_attempt_at',
        'last_success_at',
        'last_error_kind',
        'last_error',
      ]),
    );
    expect(config.primaryKeys).toHaveLength(0);
    expect(config.columns.find((column) => column.name === 'integration_id')?.primary).toBe(true);
  });

  it('creates the wake state in a production migration', () => {
    const drizzleDir = resolve(import.meta.dirname, '../drizzle');
    const sql = readdirSync(drizzleDir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(resolve(drizzleDir, name), 'utf8'))
      .join('\n');
    expect(sql).toContain('CREATE TABLE "notion_mirror_state"');
    expect(sql).toContain('"desired_generation" bigint DEFAULT 0 NOT NULL');
    expect(sql).toContain('"applied_generation" bigint DEFAULT 0 NOT NULL');
    expect(sql).toContain(
      'ALTER TABLE "notion_mirror_database" ADD COLUMN "provisioning_started_at" timestamp',
    );
    expect(sql).not.toContain('docket_id_property_id');
    expect(sql).toContain(
      'ALTER TABLE "notion_mirror_row" ALTER COLUMN "external_page_id" DROP NOT NULL',
    );
  });
});
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

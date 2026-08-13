import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NotionMirrorEntity, SyncRunPurpose } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { syncRunPurpose } from '../src/enums';
import { notionMirrorEntity } from '../src/schema/notion-mirror';

const migration = readFileSync(
  resolve(import.meta.dirname, '../drizzle/0078_natural_miss_america.sql'),
  'utf8',
);

const activityMigration = readFileSync(
  resolve(import.meta.dirname, '../drizzle/0082_busy_trish_tilby.sql'),
  'utf8',
);

describe('notion_mirror_entity enum', () => {
  it('matches the domain enum in the same order', () => {
    // Two independent declarations of one closed set: the entity kinds the mirror projects, and
    // the values Postgres will accept in `notion_mirror_database.entity_type`. Order is asserted
    // rather than sorted because `ALTER TYPE ... ADD VALUE` positions new members relative to
    // existing ones, so a silent reorder here is a migration that no longer means what it says.
    expect(notionMirrorEntity.enumValues).toEqual(NotionMirrorEntity.options);
  });

  it('includes person, because a People table is one way to represent an assignee', () => {
    // `person` is not an afterthought in the list: `docket_people_table` is one of the four
    // person representations, and it needs a projected database of actors to point a relation at.
    expect(NotionMirrorEntity.parse('person')).toBe('person');
  });
});

describe('sync_run_purpose enum', () => {
  it('matches the domain enum in the same order', () => {
    // The DTO and the column are two declarations of one closed set, and adding `notion_mirror`
    // to only one of them is a compile error in `toSyncRunOut` — but only while some call site
    // happens to bridge them. Asserting it here makes the coupling explicit instead of incidental.
    expect(syncRunPurpose.enumValues).toEqual(SyncRunPurpose.options);
  });

  it('appends new purposes rather than reordering existing ones', () => {
    // `ALTER TYPE ... ADD VALUE` positions a new member relative to existing ones, so the
    // migrations and this list have to agree on where each one went. The prefix is asserted rather
    // than "which value is last", because the latter states the invariant in a way that breaks on
    // the next legitimate append while saying nothing extra about the ones already here.
    expect(syncRunPurpose.enumValues.slice(0, 4)).toEqual([
      'task_sync',
      'email_ingest',
      'notion_mirror',
      'activity_pull',
    ]);
  });

  it('keeps every preflighted migration idempotent', () => {
    // The migration runner commits these enum values before Drizzle opens its all-migrations
    // transaction. Production therefore reaches the generated statements with the labels already
    // present, and a plain ADD VALUE aborts the deployment with PostgreSQL 42710.
    expect(migration).toContain(
      `ALTER TYPE "public"."sync_run_purpose" ADD VALUE IF NOT EXISTS 'notion_mirror';`,
    );
    expect(activityMigration).toContain(
      `ALTER TYPE "public"."sync_run_purpose" ADD VALUE IF NOT EXISTS 'activity_pull';`,
    );
    expect(activityMigration).toContain(
      `ALTER TYPE "public"."event_kind" ADD VALUE IF NOT EXISTS 'meeting_attended';`,
    );
  });
});

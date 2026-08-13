import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NotionMirrorEntity, SyncRunPurpose } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { syncRunPurpose } from '../src/enums';
import { ENUM_PREFLIGHT } from '../src/migrate';
import { notionMirrorEntity } from '../src/schema/notion-mirror';

const drizzleDir = resolve(import.meta.dirname, '../drizzle');

/** Every generated migration, by name, newest last. */
const migrations = readdirSync(drizzleDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(resolve(drizzleDir, name), 'utf8') }));

/** The `(type, value)` pairs the runner pre-commits, parsed out of the statements themselves. */
const preflighted = ENUM_PREFLIGHT.map((statement) => {
  const match = /ALTER TYPE "public"\."(\w+)" ADD VALUE IF NOT EXISTS '([^']+)'/.exec(statement);
  if (match === null) throw new Error(`unparseable preflight statement: ${statement}`);
  return { type: match[1] ?? '', value: match[2] ?? '' };
});

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

  it('adds every preflighted enum value idempotently, in whichever migration adds it', () => {
    // The runner commits these values before Drizzle opens its all-migrations transaction, so
    // production reaches the generated statements with the labels already present and a bare
    // ADD VALUE aborts the deployment with PostgreSQL 42710.
    //
    // Derived from `ENUM_PREFLIGHT` and searched across every migration rather than pinned to
    // filenames: Drizzle names files by ordinal, a rebase past main renumbers them, and a test that
    // reads `0082_busy_trish_tilby.sql` by name fails on the rename while proving nothing about the
    // file that replaced it. The invariant belongs to the pair, not to a filename.
    const offenders: string[] = [];
    for (const { type, value } of preflighted) {
      for (const { name, sql } of migrations) {
        const bare = new RegExp(`ALTER TYPE "public"\\."${type}" ADD VALUE '${value}'`);
        if (bare.test(sql)) offenders.push(`${name}: ${type} += '${value}'`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has the activity pull\u2019s two values added by a migration, not only preflighted', () => {
    // The preflight is defence in depth for databases that already ran it; the migration is what
    // gives a *fresh* database the value. Asserting only the preflight would pass on a branch that
    // forgot to generate the migration at all.
    const all = migrations.map((entry) => entry.sql).join('\n');
    expect(all).toContain(
      `ALTER TYPE "public"."sync_run_purpose" ADD VALUE IF NOT EXISTS 'activity_pull';`,
    );
    expect(all).toContain(
      `ALTER TYPE "public"."event_kind" ADD VALUE IF NOT EXISTS 'meeting_attended';`,
    );
  });
});

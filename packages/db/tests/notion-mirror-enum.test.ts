import { NotionMirrorEntity, SyncRunPurpose } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { syncRunPurpose } from '../src/enums';
import { notionMirrorEntity } from '../src/schema/notion-mirror';

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

  it('appends notion_mirror rather than reordering', () => {
    // `ALTER TYPE ... ADD VALUE` positions a new member relative to existing ones, so the
    // migration and this list have to agree on where it went.
    expect(syncRunPurpose.enumValues.at(-1)).toBe('notion_mirror');
  });
});

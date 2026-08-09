import { NotionMirrorEntity } from '@docket/types';
import { describe, expect, it } from 'vitest';

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

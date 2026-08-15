import { describe, expect, it } from 'vitest';

import { defaultPropertyMap, writableFields } from '../src/notion/mirror-schema';
import { NOTION_RELATION_LIMIT, NOTION_TEXT_LIMIT, projectRow } from '../src/notion/mirror-values';

describe('Notion mirror design rules', () => {
  it('are owned by the Connections domain', () => {
    expect(writableFields('task')).toContain('title');
    expect(writableFields('initiative')).toEqual([]);
    expect(defaultPropertyMap('task', null)['title']?.title).toBe('Name');
    expect(NOTION_TEXT_LIMIT).toBe(2000);
    expect(NOTION_RELATION_LIMIT).toBe(100);
    expect(
      projectRow(
        [{ field: 'title', title: 'Name', kind: 'title', order: 0, propertyId: 'title' }],
        { title: { kind: 'text', value: 'Ship it' } },
      ).properties,
    ).toEqual({ title: { title: [{ text: { content: 'Ship it' } }] } });
  });
});

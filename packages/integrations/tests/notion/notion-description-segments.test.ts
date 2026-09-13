import { describe, expect, it } from 'vitest';

import { notionPushProperties, readNotionSchema } from '../../src/notion-mapping';
import { TASKS_TRACKER_DATA_SOURCE, TASKS_TRACKER_PROPERTIES } from './notion-fixtures';

/** The rich-text value `notionPushProperties` writes to a Description property. */
interface DescriptionValue {
  readonly rich_text: readonly { readonly text: { readonly content: string } }[];
}

const trackerSchema = readNotionSchema(
  TASKS_TRACKER_DATA_SOURCE,
  'Tasks Tracker',
  TASKS_TRACKER_PROPERTIES,
);

/** Push a description and return the text of each Description segment. */
function descriptionSegments(notes: string): string[] {
  const properties = notionPushProperties(
    { kind: 'update', listId: TASKS_TRACKER_DATA_SOURCE, externalId: 'p1', notes },
    trackerSchema,
  );
  const value = properties['Description'] as DescriptionValue;
  return value.rich_text.map((segment) => segment.text.content);
}

describe('notionPushProperties — long descriptions', () => {
  it('splits a long description into rich-text segments Notion accepts', () => {
    const notes = 'a'.repeat(4500);
    const segments = descriptionSegments(notes);

    expect(segments.map((segment) => segment.length)).toEqual([2000, 2000, 500]);
    expect(segments.join('')).toBe(notes);
  });

  it('never splits a character that spans two UTF-16 code units', () => {
    const notes = `${'a'.repeat(1999)}😀${'b'.repeat(10)}`;
    const segments = descriptionSegments(notes);

    expect(segments.every((segment) => segment.length <= 2000)).toBe(true);
    expect(segments.join('')).toBe(notes);
    expect(segments[1]?.startsWith('😀')).toBe(true);
  });

  it('caps the Description property at the 100 segments Notion allows', () => {
    expect(descriptionSegments('a'.repeat(2000 * 100 + 1))).toHaveLength(100);
  });
});

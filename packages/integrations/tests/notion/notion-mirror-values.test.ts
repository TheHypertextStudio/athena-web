import type { NotionColumnBinding } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { NOTION_RELATION_LIMIT, NOTION_TEXT_LIMIT } from '../../src/notion-mirror';
import {
  projectRow,
  propertyValue,
  type MirrorTruncation,
  type MirrorValue,
} from '../../src/notion-mirror-values';

const bind = (over: Partial<NotionColumnBinding> = {}): NotionColumnBinding => ({
  field: 'title',
  title: 'Name',
  kind: 'title',
  order: 0,
  propertyId: 'pid_title',
  ...over,
});

const render = (binding: NotionColumnBinding, value: MirrorValue): unknown => {
  const out = propertyValue(binding, value, []);
  return out?.[1];
};

describe('propertyValue', () => {
  it('addresses the property by id, never by title', () => {
    // A rename on either side must not move where a value lands.
    const entry = propertyValue(bind({ title: 'Renamed' }), { kind: 'text', value: 'x' }, []);
    expect(entry?.[0]).toBe('pid_title');
  });

  it('skips a column Notion has not provisioned yet', () => {
    // A partially provisioned database should write what it can, not fail whole.
    expect(
      propertyValue(bind({ propertyId: undefined }), { kind: 'text', value: 'x' }, []),
    ).toBeUndefined();
  });

  it('renders each Notion type from its Docket value', () => {
    expect(render(bind(), { kind: 'text', value: 'Fix the timetable' })).toEqual({
      title: [{ text: { content: 'Fix the timetable' } }],
    });
    expect(render(bind({ kind: 'rich_text' }), { kind: 'text', value: 'note' })).toEqual({
      rich_text: [{ text: { content: 'note' } }],
    });
    expect(render(bind({ kind: 'number' }), { kind: 'number', value: 42 })).toEqual({ number: 42 });
    expect(render(bind({ kind: 'checkbox' }), { kind: 'boolean', value: true })).toEqual({
      checkbox: true,
    });
    expect(render(bind({ kind: 'date' }), { kind: 'date', value: '2026-08-08' })).toEqual({
      date: { start: '2026-08-08' },
    });
    expect(render(bind({ kind: 'url' }), { kind: 'url', value: 'https://x' })).toEqual({
      url: 'https://x',
    });
    expect(render(bind({ kind: 'select' }), { kind: 'option', value: 'To do' })).toEqual({
      select: { name: 'To do' },
    });
  });

  it('clears rather than blanks an empty option', () => {
    // `{ name: '' }` is a 400; null is how Notion expresses "no value".
    expect(render(bind({ kind: 'select' }), { kind: 'option', value: null })).toEqual({
      select: null,
    });
    expect(render(bind({ kind: 'select' }), { kind: 'option', value: '' })).toEqual({
      select: null,
    });
  });

  it('renders an empty title as an empty array, not a blank text node', () => {
    expect(render(bind(), { kind: 'text', value: null })).toEqual({ title: [] });
  });

  it('resolves a person representation to the type it was provisioned as', () => {
    expect(
      render(bind({ kind: 'rich_text', representation: 'notion_person' }), {
        kind: 'people',
        externalIds: ['u1'],
      }),
    ).toEqual({ people: [{ object: 'user', id: 'u1' }] });
    expect(
      render(bind({ kind: 'rich_text', representation: 'docket_people_table' }), {
        kind: 'relation',
        externalPageIds: ['p1'],
      }),
    ).toEqual({ relation: [{ id: 'p1' }] });
    expect(
      render(bind({ kind: 'rich_text', representation: 'text' }), {
        kind: 'text',
        value: 'Dana Whitfield',
      }),
    ).toEqual({ rich_text: [{ text: { content: 'Dana Whitfield' } }] });
  });
});

describe('Notion limits', () => {
  it('truncates over-long text and reports how much it dropped', () => {
    // Silently losing the tail of a description is worse than admitting it.
    const truncations: MirrorTruncation[] = [];
    const long = 'x'.repeat(NOTION_TEXT_LIMIT + 25);
    const entry = propertyValue(
      bind({ kind: 'rich_text' }),
      { kind: 'text', value: long },
      truncations,
    );
    const content = (entry?.[1] as { rich_text: { text: { content: string } }[] }).rich_text[0]
      ?.text.content;
    expect(content).toHaveLength(NOTION_TEXT_LIMIT);
    expect(truncations).toEqual([{ field: 'title', limit: 'text', dropped: 25 }]);
  });

  it('caps relations at Notion’s per-request limit and reports the overflow', () => {
    const truncations: MirrorTruncation[] = [];
    const ids = Array.from({ length: NOTION_RELATION_LIMIT + 3 }, (_, i) => `p${String(i)}`);
    const entry = propertyValue(
      bind({ field: 'labels', kind: 'relation' }),
      { kind: 'relation', externalPageIds: ids },
      truncations,
    );
    expect((entry?.[1] as { relation: unknown[] }).relation).toHaveLength(NOTION_RELATION_LIMIT);
    expect(truncations).toEqual([{ field: 'labels', limit: 'relation', dropped: 3 }]);
  });

  it('reports nothing when everything fits', () => {
    const truncations: MirrorTruncation[] = [];
    propertyValue(bind(), { kind: 'text', value: 'short' }, truncations);
    expect(truncations).toEqual([]);
  });
});

describe('projectRow', () => {
  const bindings: NotionColumnBinding[] = [
    bind(),
    bind({ field: 'state', title: 'Status', kind: 'select', order: 1, propertyId: 'pid_state' }),
  ];

  it('builds a payload keyed by property id', () => {
    const row = projectRow(bindings, {
      title: { kind: 'text', value: 'A task' },
      state: { kind: 'option', value: 'To do' },
    });
    expect(Object.keys(row.properties).sort()).toEqual(['pid_state', 'pid_title']);
  });

  it('hashes identically for identical values', () => {
    // The basis of skipping redundant writes. Notion allows ~3 req/s, so a wasted write is budget
    // taken from a row that genuinely changed.
    const values: Record<string, MirrorValue> = {
      title: { kind: 'text', value: 'A task' },
      state: { kind: 'option', value: 'To do' },
    };
    expect(projectRow(bindings, values).contentHash).toBe(projectRow(bindings, values).contentHash);
  });

  it('hashes differently when a value changes', () => {
    const a = projectRow(bindings, {
      title: { kind: 'text', value: 'A task' },
      state: { kind: 'option', value: 'To do' },
    });
    const b = projectRow(bindings, {
      title: { kind: 'text', value: 'A task' },
      state: { kind: 'option', value: 'Done' },
    });
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('does not depend on binding order', () => {
    // `property_map` is jsonb and PostgreSQL reorders its keys, so a hash that varied with
    // iteration order would report a change on every read back and rewrite the whole database.
    const values: Record<string, MirrorValue> = {
      title: { kind: 'text', value: 'A task' },
      state: { kind: 'option', value: 'To do' },
    };
    expect(projectRow(bindings, values).contentHash).toBe(
      projectRow([...bindings].reverse(), values).contentHash,
    );
  });

  it('ignores a field the caller supplied no value for', () => {
    const row = projectRow(bindings, { title: { kind: 'text', value: 'A task' } });
    expect(Object.keys(row.properties)).toEqual(['pid_title']);
  });

  it('collects truncations across every column', () => {
    const row = projectRow(
      [
        bind({ kind: 'rich_text' }),
        bind({ field: 'labels', kind: 'relation', propertyId: 'pid_l' }),
      ],
      {
        title: { kind: 'text', value: 'y'.repeat(NOTION_TEXT_LIMIT + 1) },
        labels: {
          kind: 'relation',
          externalPageIds: Array.from({ length: NOTION_RELATION_LIMIT + 1 }, (_, i) => String(i)),
        },
      },
    );
    expect(row.truncations.map((t) => t.limit).sort()).toEqual(['relation', 'text']);
  });
});

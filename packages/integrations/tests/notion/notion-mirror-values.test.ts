import type { NotionColumnBinding } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { NOTION_RELATION_LIMIT, NOTION_TEXT_LIMIT } from '../../src/notion-mirror';
import {
  parseMirrorValue,
  projectRow,
  propertyValue,
  readMirrorProperties,
  resolveMirrorValues,
  type MirrorSourceValue,
  type MirrorTruncation,
  type MirrorValue,
  type PersonProjection,
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
    // `notion_person` stays rich text: the native people property is a SEPARATE companion column,
    // never a substitution. Substituting it would drop everyone without a Notion account from the
    // database, which is the opposite of what the choice is for.
    expect(
      render(bind({ kind: 'rich_text', representation: 'notion_person' }), {
        kind: 'text',
        value: 'Dana Whitfield',
      }),
    ).toEqual({ rich_text: [{ text: { content: 'Dana Whitfield' } }] });
    // The companion column itself carries `kind: 'people'` and no representation.
    expect(render(bind({ kind: 'people' }), { kind: 'people', externalIds: ['u1'] })).toEqual({
      people: [{ object: 'user', id: 'u1' }],
    });
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

describe('parseMirrorValue', () => {
  it('round-trips every kind whose write and read shapes agree', () => {
    // title/rich_text are deliberately NOT here: Notion's write shape is `{ text: { content } }`
    // but a real read response computes `plain_text` instead — genuinely different shapes, covered
    // separately below with a realistic read fixture rather than propertyValue's write output.
    const cases: readonly [NotionColumnBinding['kind'], MirrorValue][] = [
      ['number', { kind: 'number', value: 42 }],
      ['checkbox', { kind: 'boolean', value: true }],
      ['date', { kind: 'date', value: '2026-08-08' }],
      ['url', { kind: 'url', value: 'https://x' }],
      ['select', { kind: 'option', value: 'To do' }],
    ];
    for (const [kind, value] of cases) {
      const binding = bind({ kind });
      const [, raw] = propertyValue(binding, value, []) ?? [];
      expect(parseMirrorValue(kind, raw)).toEqual(value);
    }
  });

  it('reads a title/rich_text property from a realistic Notion read response', () => {
    // Unlike propertyValue's write shape (`text.content`), a real GET/query response computes
    // `plain_text` per rich-text run — this is what the reader actually has to parse.
    expect(
      parseMirrorValue('title', {
        title: [{ plain_text: 'Fix the ' }, { plain_text: 'timetable' }],
      }),
    ).toEqual({ kind: 'text', value: 'Fix the timetable' });
    expect(parseMirrorValue('rich_text', { rich_text: [{ plain_text: 'note' }] })).toEqual({
      kind: 'text',
      value: 'note',
    });
    expect(parseMirrorValue('title', { title: [] })).toEqual({ kind: 'text', value: null });
  });

  it('reads people and relation ids off their arrays', () => {
    expect(parseMirrorValue('people', { people: [{ id: 'u1' }, { id: 'u2' }] })).toEqual({
      kind: 'people',
      externalIds: ['u1', 'u2'],
    });
    expect(parseMirrorValue('relation', { relation: [{ id: 'p1' }] })).toEqual({
      kind: 'relation',
      externalPageIds: ['p1'],
    });
  });

  it('reads a status property the same way as select', () => {
    expect(parseMirrorValue('status', { status: { name: 'In progress' } })).toEqual({
      kind: 'option',
      value: 'In progress',
    });
  });

  it('reads the first multi_select option, since only one is ever written', () => {
    expect(
      parseMirrorValue('multi_select', { multi_select: [{ name: 'Urgent' }, { name: 'Bug' }] }),
    ).toEqual({ kind: 'option', value: 'Urgent' });
    expect(parseMirrorValue('multi_select', { multi_select: [] })).toEqual({
      kind: 'option',
      value: null,
    });
  });

  it('reads a cleared select/date/url as an explicit null, not absence', () => {
    expect(parseMirrorValue('select', { select: null })).toEqual({ kind: 'option', value: null });
    expect(parseMirrorValue('date', { date: null })).toEqual({ kind: 'date', value: null });
    expect(parseMirrorValue('url', { url: null })).toEqual({ kind: 'url', value: null });
  });

  it('treats a shape it does not recognize as absent rather than guessing', () => {
    expect(parseMirrorValue('number', null)).toBeUndefined();
    expect(parseMirrorValue('number', 'not an object')).toBeUndefined();
  });
});

describe('readMirrorProperties', () => {
  it('matches by property id, not by the name Notion currently returns it under', () => {
    // The whole reason a binding stores an id: the caller's stale `title` must not matter, and a
    // page that renamed the property between design time and this read must still resolve.
    const bindings = [bind({ propertyId: 'pid_title' })];
    const raw = {
      'A Completely Different Name': {
        id: 'pid_title',
        type: 'title',
        title: [{ plain_text: 'Read back' }],
      },
    };
    expect(readMirrorProperties(bindings, raw)).toEqual({
      title: { kind: 'text', value: 'Read back' },
    });
  });

  it('omits a field whose property id is not present on the page', () => {
    const bindings = [bind({ field: 'notYetProvisioned', propertyId: 'pid_missing' })];
    expect(readMirrorProperties(bindings, {})).toEqual({});
  });

  it('omits a binding with no property id at all (not yet provisioned)', () => {
    const bindings = [bind({ propertyId: undefined })];
    const raw = { Name: { id: 'pid_title', type: 'title', title: [{ plain_text: 'x' }] } };
    expect(readMirrorProperties(bindings, raw)).toEqual({});
  });

  it('reads several bindings from one page at once', () => {
    const bindings = [
      bind({ propertyId: 'pid_title' }),
      bind({ field: 'state', kind: 'select', propertyId: 'pid_state' }),
    ];
    const raw = {
      Name: { id: 'pid_title', type: 'title', title: [{ plain_text: 'A task' }] },
      Status: { id: 'pid_state', type: 'select', select: { name: 'Done' } },
    };
    expect(readMirrorProperties(bindings, raw)).toEqual({
      title: { kind: 'text', value: 'A task' },
      state: { kind: 'option', value: 'Done' },
    });
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

describe('resolveMirrorValues', () => {
  const NOBODY: PersonProjection = {
    notionUserByActor: new Map(),
    personPageByActor: new Map(),
  };
  const KNOWN: PersonProjection = {
    notionUserByActor: new Map([['act_1', 'notion-user-1']]),
    personPageByActor: new Map([['act_1', 'people-page-1']]),
  };
  const assignee = (over: Partial<NotionColumnBinding> = {}): NotionColumnBinding =>
    bind({ field: 'assignee', title: 'Assignee', kind: 'rich_text', propertyId: 'pid_a', ...over });
  const ref = (actorId: string | null, displayName: string | null): MirrorSourceValue => ({
    kind: 'actor',
    actorId,
    displayName,
  });

  it('renders a person as a name when the column is plain text', () => {
    const binding = assignee({ representation: 'text' });
    const out = resolveMirrorValues([binding], { assignee: ref('act_1', 'Sam S') }, KNOWN);
    expect(out.values['assignee']).toEqual({ kind: 'text', value: 'Sam S' });
    expect(out.unresolved).toEqual([]);
  });

  it('renders a matched person as the native Notion user', () => {
    const binding = assignee({ kind: 'people', representation: undefined });
    const out = resolveMirrorValues([binding], { assignee: ref('act_1', 'Sam S') }, KNOWN);
    expect(out.values['assignee']).toEqual({ kind: 'people', externalIds: ['notion-user-1'] });
  });

  it('writes an unmatched person as an honest empty, and says it will never resolve', () => {
    // The column's documented meaning is "the matched subset", and the name sits in the column
    // beside it — so empty is the truth here, and retrying would not change it.
    const binding = assignee({ kind: 'people', representation: undefined });
    const out = resolveMirrorValues([binding], { assignee: ref('act_2', 'No Notion') }, KNOWN);
    expect(out.values['assignee']).toEqual({ kind: 'people', externalIds: [] });
    expect(out.unresolved).toEqual([
      { field: 'assignee', actorId: 'act_2', reason: 'no_notion_account', retryable: false },
    ]);
  });

  it('renders a person as a relation to their row in the People database', () => {
    const binding = assignee({ kind: 'relation', representation: 'docket_people_table' });
    const out = resolveMirrorValues([binding], { assignee: ref('act_1', 'Sam S') }, KNOWN);
    expect(out.values['assignee']).toEqual({
      kind: 'relation',
      externalPageIds: ['people-page-1'],
    });
  });

  it('OMITS a relation whose People row is not written yet, rather than clearing it', () => {
    // The distinction the whole resolver turns on. An empty relation CLEARS the Notion property,
    // which for "I don't know yet" would confidently erase a cell somebody may have filled in.
    const binding = assignee({ kind: 'relation', representation: 'docket_people_table' });
    const out = resolveMirrorValues([binding], { assignee: ref('act_1', 'Sam S') }, NOBODY);
    expect(out.values['assignee']).toBeUndefined();
    expect(out.unresolved).toEqual([
      { field: 'assignee', actorId: 'act_1', reason: 'person_page_missing', retryable: true },
    ]);
  });

  it('clears the property when there genuinely is no assignee', () => {
    // The other side of that distinction: nobody assigned is a KNOWN empty, and must clear.
    for (const [kind, representation, expected] of [
      ['rich_text', 'text', { kind: 'text', value: null }],
      ['people', undefined, { kind: 'people', externalIds: [] }],
      ['relation', 'docket_people_table', { kind: 'relation', externalPageIds: [] }],
    ] as const) {
      const binding = assignee({ kind, representation });
      const out = resolveMirrorValues([binding], { assignee: ref(null, null) }, NOBODY);
      expect(out.values['assignee']).toEqual(expected);
      expect(out.unresolved).toEqual([]);
    }
  });

  it('passes non-person values through untouched', () => {
    const out = resolveMirrorValues(
      [bind()],
      { title: { kind: 'text', value: 'Ship it' } },
      NOBODY,
    );
    expect(out.values['title']).toEqual({ kind: 'text', value: 'Ship it' });
  });

  it('an omitted reference leaves the content hash free to change when it resolves', () => {
    // This is what proves omission CONVERGES rather than stalls: the unresolved pass writes a row
    // without the property and hashes it that way, so the pass that resolves it sees a different
    // hash and issues exactly one update.
    const binding = assignee({ kind: 'relation', representation: 'docket_people_table' });
    const source = { assignee: ref('act_1', 'Sam S') };

    const pending = projectRow([binding], resolveMirrorValues([binding], source, NOBODY).values);
    const filled = projectRow([binding], resolveMirrorValues([binding], source, KNOWN).values);

    expect(pending.properties).not.toHaveProperty('pid_a');
    expect(filled.properties).toHaveProperty('pid_a');
    expect(pending.contentHash).not.toBe(filled.contentHash);
  });
});

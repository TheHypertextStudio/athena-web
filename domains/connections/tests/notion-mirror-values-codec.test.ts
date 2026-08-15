/**
 * The mirror value codec's disagreement handling — a Docket value that does not match the Notion
 * column it is bound to, and a Notion payload that is not the shape its type promises.
 *
 * @remarks
 * A mirror is two systems editing the same rows, so both directions get input the other did not
 * intend: a column retyped in Notion leaves Docket writing a date into a number, and a property
 * arrives with a null, an empty array, or a shape the SDK types say cannot happen. Neither side
 * may throw — an exception here aborts a whole sync pass over one malformed cell — and neither may
 * silently invent a value, because a fabricated `false` or `0` overwrites real data on the next
 * push.
 *
 * The existing suite covers the matched pairs. These cover the mismatches and the malformed reads,
 * which is where a sync corrupts data rather than merely failing.
 */
import { describe, expect, it } from 'vitest';

import type { NotionColumnBinding } from '../src/notion/mirror-contract';
import { parseMirrorValue, propertyValue, type MirrorValue } from '../src/notion/mirror-values';

const bind = (over: Partial<NotionColumnBinding> = {}): NotionColumnBinding => ({
  field: 'field',
  title: 'Field',
  kind: 'rich_text',
  order: 0,
  propertyId: 'pid',
  ...over,
});

/** Render a value through a binding and return just the payload. */
function render(kind: NotionColumnBinding['kind'], value: MirrorValue): unknown {
  const entry = propertyValue(bind({ kind }), value, []);
  if (!entry) throw new Error('expected the binding to render a payload');
  return entry[1];
}

const TEXT = { kind: 'text', value: 'hello' } as const;

describe('an unprovisioned binding', () => {
  it('renders nothing, so a half-provisioned mirror still writes its other columns', async () => {
    const entry = propertyValue({ ...bind(), propertyId: undefined }, TEXT, []);
    expect(entry).toBeUndefined();
  });
});

describe('writing a value into a column of a different type', () => {
  // Each of these is what a retyped Notion column produces. The rule is the same throughout:
  // clear the cell rather than coerce, because a coerced value is indistinguishable from one a
  // person entered and would win the next comparison.
  it('clears a number column given something that is not a number', () => {
    expect(render('number', TEXT)).toEqual({ number: null });
  });

  it('clears a date column given something that is not a date', () => {
    expect(render('date', TEXT)).toEqual({ date: null });
  });

  it('clears a date column given a date with no value', () => {
    expect(render('date', { kind: 'date', value: null })).toEqual({ date: null });
  });

  it('clears a url column given something that is not a url', () => {
    expect(render('url', { kind: 'number', value: 3 })).toEqual({ url: null });
  });

  it('clears an email column given something that is not text', () => {
    expect(render('email', { kind: 'number', value: 3 })).toEqual({ email: null });
  });

  it('writes false into a checkbox given something that is not a boolean', () => {
    // A checkbox has no empty state, so the unchecked box is the only honest rendering.
    expect(render('checkbox', TEXT)).toEqual({ checkbox: false });
  });

  it.each(['select', 'status'] as const)('clears a %s given a non-option value', (kind) => {
    expect(render(kind, TEXT)).toEqual({ [kind]: null });
  });

  it.each(['select', 'status'] as const)('clears a %s given an empty option name', (kind) => {
    // Notion rejects an empty option name outright, so this must not be sent as a name.
    expect(render(kind, { kind: 'option', value: '' })).toEqual({ [kind]: null });
  });

  it('empties a multi-select given a non-option value', () => {
    expect(render('multi_select', TEXT)).toEqual({ multi_select: [] });
  });

  it('empties a people column given a non-people value', () => {
    expect(render('people', TEXT)).toEqual({ people: [] });
  });

  it('empties a relation given a non-relation value', () => {
    expect(render('relation', TEXT)).toEqual({ relation: [] });
  });
});

describe('stringifying a value into a text column', () => {
  // Text is the one column that accepts anything, so every value kind has a rendering rather than
  // being dropped — losing the cell would read as the person having cleared it.
  it.each([
    [{ kind: 'number', value: 42 } as const, '42'],
    // Rendered for a human reading a text cell, not as a JSON literal.
    [{ kind: 'boolean', value: true } as const, 'Yes'],
    [{ kind: 'boolean', value: false } as const, 'No'],
    [{ kind: 'date', value: '2026-08-12' } as const, '2026-08-12'],
    [{ kind: 'option', value: 'Urgent' } as const, 'Urgent'],
    [{ kind: 'url', value: 'https://example.com' } as const, 'https://example.com'],
    [{ kind: 'people', externalIds: ['u1', 'u2'] } as const, 'u1, u2'],
    [{ kind: 'relation', externalPageIds: ['p1', 'p2'] } as const, 'p1, p2'],
  ])('renders %o as text', (value, expected) => {
    expect(render('rich_text', value)).toEqual({ rich_text: [{ text: { content: expected } }] });
  });

  it('clears the cell for an absent text value rather than writing the string "null"', () => {
    // An empty rich-text array is how Notion represents an empty cell; a run containing "" would
    // read back as a value somebody typed.
    expect(render('title', { kind: 'text', value: null })).toEqual({ title: [] });
  });
});

describe('reading a Notion payload that is not the shape its type promises', () => {
  it('reads nothing from a property that is not an object at all', () => {
    expect(parseMirrorValue('title', null)).toBeUndefined();
    expect(parseMirrorValue('title', 'not an object')).toBeUndefined();
  });

  it.each(['title', 'rich_text'] as const)('reads %s that is not an array as empty', (kind) => {
    expect(parseMirrorValue(kind, { [kind]: 'not an array' })).toEqual({
      kind: 'text',
      value: null,
    });
  });

  it('skips rich-text runs carrying no plain text', () => {
    expect(parseMirrorValue('rich_text', { rich_text: [{}, { plain_text: 'kept' }] })).toEqual({
      kind: 'text',
      value: 'kept',
    });
  });

  it.each([
    ['email', { email: 42 }],
    ['url', { url: 42 }],
  ] as const)('clears %s when the value is not a string', (kind, raw) => {
    expect(parseMirrorValue(kind, raw)).toMatchObject({ value: null });
  });

  it('clears a number that arrived as a string', () => {
    expect(parseMirrorValue('number', { number: '42' })).toEqual({ kind: 'number', value: null });
  });

  it('reads any non-true checkbox as unchecked', () => {
    expect(parseMirrorValue('checkbox', { checkbox: 'yes' })).toEqual({
      kind: 'boolean',
      value: false,
    });
  });

  it('truncates a date-time to its calendar day, which is what Docket stores', () => {
    expect(parseMirrorValue('date', { date: { start: '2026-08-12T09:30:00.000Z' } })).toEqual({
      kind: 'date',
      value: '2026-08-12',
    });
  });

  it.each([
    ['a cleared date', { date: null }],
    ['a date range with no start', { date: {} }],
  ])('reads %s as no date', (_label, raw) => {
    expect(parseMirrorValue('date', raw)).toEqual({ kind: 'date', value: null });
  });

  it.each(['select', 'status'] as const)('reads a cleared %s as no option', (kind) => {
    expect(parseMirrorValue(kind, { [kind]: null })).toEqual({ kind: 'option', value: null });
  });

  it.each(['select', 'status'] as const)(
    'reads a %s whose name is not a string as none',
    (kind) => {
      expect(parseMirrorValue(kind, { [kind]: { name: 7 } })).toEqual({
        kind: 'option',
        value: null,
      });
    },
  );

  it('reads only the first multi-select option, because Docket stores one', () => {
    expect(
      parseMirrorValue('multi_select', { multi_select: [{ name: 'A' }, { name: 'B' }] }),
    ).toEqual({ kind: 'option', value: 'A' });
  });

  it.each([
    ['an empty multi-select', { multi_select: [] }],
    ['a multi-select that is not an array', { multi_select: 'A' }],
  ])('reads %s as no option', (_label, raw) => {
    expect(parseMirrorValue('multi_select', raw)).toEqual({ kind: 'option', value: null });
  });

  it('keeps only the people entries that carry an id', () => {
    expect(parseMirrorValue('people', { people: [{ id: 'u1' }, {}, { id: 7 }] })).toEqual({
      kind: 'people',
      externalIds: ['u1'],
    });
  });

  it('reads a people property that is not an array as nobody', () => {
    expect(parseMirrorValue('people', { people: null })).toEqual({
      kind: 'people',
      externalIds: [],
    });
  });

  it('keeps only the relation references that carry an id', () => {
    expect(parseMirrorValue('relation', { relation: [{ id: 'p1' }, {}, { id: 7 }] })).toEqual({
      kind: 'relation',
      externalPageIds: ['p1'],
    });
  });

  it('reads a relation that is not an array as unrelated', () => {
    expect(parseMirrorValue('relation', { relation: undefined })).toEqual({
      kind: 'relation',
      externalPageIds: [],
    });
  });
});

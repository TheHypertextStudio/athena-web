/**
 * `mirror-values/codec` — the branches `notion-mirror-values.test.ts` exercises with matched-kind
 * values, but never with the mismatches a real record can carry.
 *
 * @remarks
 * A field's Docket value kind and its provisioned Notion column kind can disagree: a column is
 * reprovisioned to a different type after values were written under the old one, or a caller passes
 * the wrong `MirrorValue` shape entirely. `propertyValue` never throws on that — it falls back to a
 * safe default for the property's actual kind, via `stringify` for text columns and a null/empty
 * payload everywhere else. Those fallbacks are the majority of what this file exists to prove: a
 * mismatch degrades gracefully rather than writing garbage or crashing the sync.
 */
import { describe, expect, it } from 'vitest';

import type { NotionColumnBinding } from '../src/notion/mirror-contract';
import {
  parseMirrorValue,
  projectRow,
  propertyValue,
  readMirrorProperties,
  type MirrorValue,
} from '../src/notion/mirror-values';

const bind = (over: Partial<NotionColumnBinding> = {}): NotionColumnBinding => ({
  field: 'field',
  title: 'Field',
  kind: 'rich_text',
  order: 0,
  propertyId: 'pid',
  ...over,
});

const relationValue = (...externalPageIds: string[]): MirrorValue => ({
  kind: 'relation',
  externalPageIds,
});
const peopleValue = (...externalIds: string[]): MirrorValue => ({ kind: 'people', externalIds });

describe('propertyValue: a value kind that does not match the column falls back safely', () => {
  it('renders every non-text value kind as its display text for a rich_text column', () => {
    // This is `stringify`, reached only when the column is text-shaped but the value is not.
    // An empty result renders as no run at all, matching `richText`'s own empty-string handling.
    const cases: [MirrorValue, string[]][] = [
      [{ kind: 'date', value: '2026-01-01' }, ['2026-01-01']],
      [{ kind: 'date', value: null }, []],
      [{ kind: 'option', value: 'Done' }, ['Done']],
      [{ kind: 'url', value: 'https://example.com' }, ['https://example.com']],
      [{ kind: 'number', value: 3 }, ['3']],
      [{ kind: 'number', value: null }, []],
      [{ kind: 'boolean', value: true }, ['Yes']],
      [{ kind: 'boolean', value: false }, ['No']],
      [peopleValue('u1', 'u2'), ['u1, u2']],
      [relationValue('p1'), ['p1']],
    ];
    for (const [value, texts] of cases) {
      const entry = propertyValue(bind({ kind: 'rich_text' }), value, []);
      expect(entry?.[1], JSON.stringify(value)).toEqual({
        rich_text: texts.map((content) => ({ text: { content } })),
      });
    }
  });

  it('writes null to a number column fed a non-number value', () => {
    expect(propertyValue(bind({ kind: 'number' }), { kind: 'text', value: 'x' }, [])?.[1]).toEqual({
      number: null,
    });
  });

  it('writes false to a checkbox column fed a non-boolean value', () => {
    expect(
      propertyValue(bind({ kind: 'checkbox' }), { kind: 'text', value: 'x' }, [])?.[1],
    ).toEqual({ checkbox: false });
  });

  it('writes a null date for a non-date value and for a date value explicitly cleared', () => {
    expect(propertyValue(bind({ kind: 'date' }), { kind: 'text', value: 'x' }, [])?.[1]).toEqual({
      date: null,
    });
    expect(propertyValue(bind({ kind: 'date' }), { kind: 'date', value: null }, [])?.[1]).toEqual({
      date: null,
    });
  });

  it('writes a null url for a non-url value', () => {
    expect(propertyValue(bind({ kind: 'url' }), { kind: 'text', value: 'x' }, [])?.[1]).toEqual({
      url: null,
    });
  });

  it('writes a null email for a non-text value', () => {
    expect(propertyValue(bind({ kind: 'email' }), { kind: 'number', value: 1 }, [])?.[1]).toEqual({
      email: null,
    });
  });

  it('writes a null select/status for a non-option value and for an empty option', () => {
    for (const kind of ['select', 'status'] as const) {
      expect(propertyValue(bind({ kind }), { kind: 'text', value: 'x' }, [])?.[1]).toEqual({
        [kind]: null,
      });
      expect(propertyValue(bind({ kind }), { kind: 'option', value: '' }, [])?.[1]).toEqual({
        [kind]: null,
      });
      expect(propertyValue(bind({ kind }), { kind: 'option', value: null }, [])?.[1]).toEqual({
        [kind]: null,
      });
    }
  });

  it('writes an empty multi_select for a non-option value and for an empty option', () => {
    expect(
      propertyValue(bind({ kind: 'multi_select' }), { kind: 'text', value: 'x' }, [])?.[1],
    ).toEqual({ multi_select: [] });
    expect(
      propertyValue(bind({ kind: 'multi_select' }), { kind: 'option', value: '' }, [])?.[1],
    ).toEqual({ multi_select: [] });
  });

  it('writes an empty people list for a non-people value', () => {
    expect(propertyValue(bind({ kind: 'people' }), { kind: 'text', value: 'x' }, [])?.[1]).toEqual({
      people: [],
    });
  });

  it('writes an empty relation for a non-relation value', () => {
    expect(
      propertyValue(bind({ kind: 'relation' }), { kind: 'text', value: 'x' }, [])?.[1],
    ).toEqual({ relation: [] });
  });
});

describe('parseMirrorValue: a Notion payload that is missing or malformed', () => {
  it('returns undefined for a non-object property', () => {
    expect(parseMirrorValue('title', null)).toBeUndefined();
    expect(parseMirrorValue('title', 'not an object')).toBeUndefined();
    expect(parseMirrorValue('title', 42)).toBeUndefined();
  });

  it('reads a date with no start as null rather than throwing on its shape', () => {
    expect(parseMirrorValue('date', { date: null })).toEqual({ kind: 'date', value: null });
    expect(parseMirrorValue('date', { date: {} })).toEqual({ kind: 'date', value: null });
    expect(parseMirrorValue('date', { date: 'not an object' })).toEqual({
      kind: 'date',
      value: null,
    });
  });

  it('reads select/status with no name as null rather than throwing on its shape', () => {
    expect(parseMirrorValue('select', { select: null })).toEqual({ kind: 'option', value: null });
    expect(parseMirrorValue('status', { status: 'not an object' })).toEqual({
      kind: 'option',
      value: null,
    });
  });

  it('reads multi_select with no entries, or a first entry with no name, as null', () => {
    expect(parseMirrorValue('multi_select', { multi_select: [] })).toEqual({
      kind: 'option',
      value: null,
    });
    expect(parseMirrorValue('multi_select', { multi_select: 'not an array' })).toEqual({
      kind: 'option',
      value: null,
    });
    expect(parseMirrorValue('multi_select', { multi_select: [{}] })).toEqual({
      kind: 'option',
      value: null,
    });
  });

  it('drops a person or relation reference Notion sent with no id', () => {
    expect(parseMirrorValue('people', { people: [{}, { id: 'u1' }] })).toEqual({
      kind: 'people',
      externalIds: ['u1'],
    });
    expect(parseMirrorValue('relation', { relation: 'not an array' })).toEqual({
      kind: 'relation',
      externalPageIds: [],
    });
  });

  it('falls back to an empty string field for a raw value of the wrong type', () => {
    expect(parseMirrorValue('email', { email: 1 })).toEqual({ kind: 'text', value: null });
    expect(parseMirrorValue('number', { number: '1' })).toEqual({ kind: 'number', value: null });
    expect(parseMirrorValue('url', { url: 1 })).toEqual({ kind: 'url', value: null });
  });
});

describe('readMirrorProperties: the raw payload does not match the bindings', () => {
  it('skips a binding whose column was never provisioned', () => {
    const values = readMirrorProperties([bind({ propertyId: undefined })], {
      title: { id: 'pid', type: 'title', title: [] },
    });
    expect(values).toEqual({});
  });

  it('skips a raw property with no id, since it cannot be matched to any binding', () => {
    const values = readMirrorProperties([bind()], {
      title: { type: 'title', title: [{ plain_text: 'x' }] },
    });
    expect(values).toEqual({});
  });

  it('skips a property Notion sent nothing for', () => {
    const values = readMirrorProperties([bind({ propertyId: 'missing' })], {
      title: { id: 'pid', type: 'title', title: [] },
    });
    expect(values).toEqual({});
  });
});

describe('projectRow: a binding with no provisioned property is dropped, not written empty', () => {
  it('omits a value whose column is unprovisioned from both the payload and the hash', () => {
    const provisioned = bind({ field: 'title', propertyId: 'pid_title', kind: 'title' });
    const unprovisioned = bind({ field: 'ghost', propertyId: undefined, kind: 'rich_text' });

    const withGhost = projectRow([provisioned, unprovisioned], {
      title: { kind: 'text', value: 'Roadmap' },
      ghost: { kind: 'text', value: 'ignored' },
    });
    const withoutGhost = projectRow([provisioned], {
      title: { kind: 'text', value: 'Roadmap' },
    });

    expect(Object.keys(withGhost.properties)).toEqual(['pid_title']);
    expect(withGhost.contentHash).toBe(withoutGhost.contentHash);
  });
});

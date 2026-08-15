/**
 * Behavior tests for the elicitation grammar: answer validation, the two schema converters, and
 * the MCP result mapping.
 *
 * @remarks
 * The claim this file defends is that one spec drives both what the form renders and what the
 * server accepts. So every control is checked from both ends — a value it must take and a value
 * it must refuse — and each refusal is checked to carry Docket's own sentence rather than Zod's,
 * which is the repo's error-copy rule and the reason `elicitationFieldMessage` exists at all.
 *
 * The converters get the same treatment in reverse: a Zod schema (or an MCP `requestedSchema`)
 * in, a spec out, and a named refusal for every construct that has no control. Rendering half a
 * form is the failure mode worth testing for, because a person cannot see the field that is
 * missing.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  type ElicitationControl,
  UnsupportedElicitationSchemaError,
  elicitationAnswerSchema,
  elicitationFieldMessage,
  elicitationFromMcpRequestedSchema,
  elicitationFromZod,
  parseElicitationAnswer,
  toMcpElicitResult,
} from '../src/elicitation';

/** The reasons a parse failed, as the sentences a form would print under its fields. */
function refusals(spec: ElicitationControl, raw: unknown): readonly string[] {
  const result = parseElicitationAnswer(spec, raw);
  if (result.ok) throw new Error('expected the answer to be refused');
  return result.errors.map((error) => error.text);
}

/** The value a parse accepted, or a thrown error naming what it refused instead. */
function accepted(spec: ElicitationControl, raw: unknown): unknown {
  const result = parseElicitationAnswer(spec, raw);
  if (!result.ok) throw new Error(`expected acceptance, got: ${JSON.stringify(result.errors)}`);
  return result.value;
}

const TEXT: ElicitationControl = {
  kind: 'text',
  multiline: false,
  minLength: 2,
  maxLength: 5,
  placeholder: null,
};

const FILE: ElicitationControl = {
  kind: 'file',
  accept: ['image/png'],
  maxBytes: 1000,
  multiple: false,
};

const A_FILE = {
  attachmentId: 'att_1',
  fileName: 'shot.png',
  contentType: 'image/png',
  byteSize: 500,
};

describe('elicitation answer validation', () => {
  it('holds a text answer to its declared length bounds', () => {
    expect(accepted(TEXT, 'abc')).toBe('abc');
    expect(refusals(TEXT, 'a')).toEqual(['This answer is too short.']);
    expect(refusals(TEXT, 'abcdef')).toEqual(['This answer is too long.']);
    expect(refusals(TEXT, 42)).toEqual(['This answer is the wrong kind of value.']);
  });

  it('leaves an unbounded text control unbounded', () => {
    const loose: ElicitationControl = {
      kind: 'text',
      multiline: true,
      minLength: null,
      maxLength: null,
      placeholder: null,
    };
    expect(accepted(loose, '')).toBe('');
  });

  it('separates an integer number control from a real-valued one', () => {
    const integer: ElicitationControl = { kind: 'number', integer: true, min: 1, max: 10 };
    expect(accepted(integer, 5)).toBe(5);
    expect(refusals(integer, 2.5)).toEqual(['This answer is the wrong kind of value.']);
    expect(refusals(integer, 0)).toEqual(['This answer is too short.']);
    expect(refusals(integer, 11)).toEqual(['This answer is too long.']);

    const real: ElicitationControl = { kind: 'number', integer: false, min: null, max: null };
    expect(accepted(real, 2.5)).toBe(2.5);
  });

  it('takes a confirm answer as a boolean and nothing else', () => {
    const confirm: ElicitationControl = {
      kind: 'confirm',
      confirmLabel: 'Send',
      declineLabel: 'Cancel',
    };
    expect(accepted(confirm, true)).toBe(true);
    expect(refusals(confirm, 'yes')).toEqual(['This answer is the wrong kind of value.']);
  });

  it('refuses a select answer that is not one of the offered options', () => {
    const single: ElicitationControl = {
      kind: 'select',
      options: [
        { value: 'acme', label: 'Acme', description: null },
        { value: 'ops', label: 'Ops', description: null },
      ],
      multiple: false,
    };
    expect(accepted(single, 'ops')).toBe('ops');
    // The offered-options sentence, not Zod's "Invalid input" — this is the case the custom
    // `not_an_option` tag exists for.
    expect(refusals(single, 'other')).toEqual(['Choose one of the options offered.']);

    const multiple: ElicitationControl = { ...single, multiple: true };
    expect(accepted(multiple, ['acme', 'ops'])).toEqual(['acme', 'ops']);
    expect(refusals(multiple, [])).toEqual(['This answer is too short.']);
    expect(refusals(multiple, ['nope'])).toEqual(['Choose one of the options offered.']);
  });

  it('matches a datetime answer against its declared precision and window', () => {
    const datetime: ElicitationControl = {
      kind: 'datetime',
      precision: 'datetime',
      timeZone: 'UTC',
      min: '2026-01-01T00:00',
      max: '2026-12-31T23:59',
    };
    expect(accepted(datetime, '2026-06-01T12:30')).toBe('2026-06-01T12:30');
    expect(accepted(datetime, '2026-06-01T12:30:00.500Z')).toBe('2026-06-01T12:30:00.500Z');
    expect(refusals(datetime, '2026-06-01')).toEqual(['Enter a complete date and time.']);
    expect(refusals(datetime, '2025-06-01T12:30')).toEqual(['Pick a later date and time.']);
    expect(refusals(datetime, '2027-06-01T12:30')).toEqual(['Pick an earlier date and time.']);
  });

  it('narrows a date-only and a time-only control to their own patterns', () => {
    const dateOnly: ElicitationControl = {
      kind: 'datetime',
      precision: 'date',
      timeZone: 'UTC',
      min: null,
      max: null,
    };
    expect(accepted(dateOnly, '2026-06-01')).toBe('2026-06-01');
    expect(refusals(dateOnly, '2026-06-01T12:30')).toEqual(['Enter a complete date and time.']);

    const timeOnly: ElicitationControl = { ...dateOnly, precision: 'time' };
    expect(accepted(timeOnly, '12:30')).toBe('12:30');
    expect(refusals(timeOnly, '2026-06-01')).toEqual(['Enter a complete date and time.']);
  });

  it('screens a file answer by type and size before accepting the reference', () => {
    expect(accepted(FILE, A_FILE)).toEqual(A_FILE);
    expect(refusals(FILE, { ...A_FILE, contentType: 'application/pdf' })).toEqual([
      'That file type is not accepted here.',
    ]);
    expect(refusals(FILE, { ...A_FILE, byteSize: 2000 })).toEqual([
      'That file is larger than this request allows.',
    ]);
  });

  it('accepts any type when a file control names no accept list', () => {
    const anything: ElicitationControl = { ...FILE, accept: [], multiple: true };
    expect(accepted(anything, [{ ...A_FILE, contentType: 'application/pdf' }])).toHaveLength(1);
    expect(refusals(anything, [])).toEqual(['This answer is too short.']);
  });

  it('requires only the fields a form declares required, and paths the failure', () => {
    const form: ElicitationControl = {
      kind: 'form',
      fields: [
        { key: 'name', label: 'Name', description: null, required: true, control: TEXT },
        { key: 'note', label: 'Note', description: null, required: false, control: TEXT },
      ],
    };
    expect(accepted(form, { name: 'abc' })).toEqual({ name: 'abc' });
    expect(accepted(form, { name: 'abc', note: null })).toEqual({ name: 'abc', note: null });

    const result = parseElicitationAnswer(form, { name: 'a' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // The path is what lets the renderer put the sentence under the right input.
    expect(result.errors).toEqual([{ path: 'name', text: 'This answer is too short.' }]);
  });

  it('holds a list answer to its item count and its item control', () => {
    const list: ElicitationControl = { kind: 'list', item: TEXT, minItems: 1, maxItems: 2 };
    expect(accepted(list, ['abc'])).toEqual(['abc']);
    expect(refusals(list, [])).toEqual(['This answer is too short.']);
    expect(refusals(list, ['abc', 'abc', 'abc'])).toEqual(['This answer is too long.']);
    expect(refusals(list, ['a'])).toEqual(['This answer is too short.']);

    const unbounded: ElicitationControl = { ...list, minItems: null, maxItems: null };
    expect(accepted(unbounded, [])).toEqual([]);
  });

  it('picks the variant arm named by the discriminator', () => {
    const variant: ElicitationControl = {
      kind: 'variant',
      discriminator: 'kind',
      variants: [
        {
          value: 'email',
          label: 'Email',
          fields: [
            { key: 'address', label: 'Address', description: null, required: true, control: TEXT },
          ],
        },
        {
          value: 'sms',
          label: 'SMS',
          fields: [
            { key: 'number', label: 'Number', description: null, required: true, control: TEXT },
          ],
        },
      ],
    };
    expect(accepted(variant, { kind: 'email', address: 'a@b' })).toEqual({
      kind: 'email',
      address: 'a@b',
    });
    expect(accepted(variant, { kind: 'sms', number: '12345' })).toEqual({
      kind: 'sms',
      number: '12345',
    });
    expect(refusals(variant, { kind: 'fax', line: '1' })).toEqual([
      'This answer does not match any of the accepted shapes.',
    ]);
  });

  it('collapses a single-arm variant to that arm rather than a union', () => {
    const single: ElicitationControl = {
      kind: 'variant',
      discriminator: 'kind',
      variants: [
        {
          value: 'email',
          label: 'Email',
          fields: [
            { key: 'address', label: 'Address', description: null, required: false, control: TEXT },
          ],
        },
      ],
    };
    expect(accepted(single, { kind: 'email' })).toEqual({ kind: 'email' });
    // A one-arm union would report `invalid_union`; the arm itself reports the real field.
    expect(refusals(single, { kind: 'other' })).toEqual(['Choose one of the options offered.']);
  });

  it('exposes the schema itself so a caller can compose it', () => {
    expect(elicitationAnswerSchema(TEXT).safeParse('abc').success).toBe(true);
  });
});

describe('elicitation field messages', () => {
  it('answers every Zod code with a Docket sentence, never library text', () => {
    const codes = [
      'invalid_type',
      'too_small',
      'too_big',
      'invalid_format',
      'invalid_value',
      'unrecognized_keys',
      'invalid_union',
      'custom',
    ] as const;
    for (const code of codes) {
      const text = elicitationFieldMessage({ code, message: '', path: [] } as never);
      expect(text.endsWith('.')).toBe(true);
      expect(text).not.toContain('Invalid');
    }
    expect(elicitationFieldMessage({ code: 'custom', message: '', path: [] } as never)).toBe(
      'This answer could not be accepted.',
    );
  });

  it('prefers this module’s own tag over the generic code', () => {
    const tagged = (message: string): string =>
      elicitationFieldMessage({ code: 'custom', message, path: [] } as never);
    expect(tagged('not_an_option')).toBe('Choose one of the options offered.');
    expect(tagged('bad_datetime')).toBe('Enter a complete date and time.');
    expect(tagged('datetime_too_early')).toBe('Pick a later date and time.');
    expect(tagged('datetime_too_late')).toBe('Pick an earlier date and time.');
    expect(tagged('file_type_rejected')).toBe('That file type is not accepted here.');
    expect(tagged('file_too_large')).toBe('That file is larger than this request allows.');
  });
});

describe('elicitationFromZod', () => {
  it('turns an object into a form and titleizes each key', () => {
    const spec = elicitationFromZod(
      z.object({ first_name: z.string(), lastName: z.string(), note: z.string().optional() }),
    );
    expect(spec.kind).toBe('form');
    if (spec.kind !== 'form') throw new Error('unreachable');
    expect(spec.fields.map((field) => field.label)).toEqual(['First name', 'Last Name', 'Note']);
    expect(spec.fields.map((field) => field.required)).toEqual([true, true, false]);
  });

  it('carries a string’s length checks onto the text control', () => {
    const spec = elicitationFromZod(z.string().min(2).max(5));
    expect(spec).toEqual({
      kind: 'text',
      multiline: false,
      minLength: 2,
      maxLength: 5,
      placeholder: null,
    });
  });

  it('distinguishes an integer from a float, and carries its bounds', () => {
    // Both spellings must land on an integer control. `z.number().int()` records that as a check,
    // while `z.int()` is its own format and records nothing in the checks — reading only the
    // checks let the idiomatic spelling render and validate as a float.
    expect(elicitationFromZod(z.int())).toEqual({
      kind: 'number',
      integer: true,
      min: null,
      max: null,
    });
    expect(elicitationFromZod(z.number().int())).toMatchObject({ integer: true });
    expect(elicitationFromZod(z.int32())).toMatchObject({ integer: true });
    expect(elicitationFromZod(z.number().gt(1).lt(9))).toMatchObject({
      integer: false,
      min: 1,
      max: 9,
    });
  });

  it('keeps the derived validator as strict as the schema it came from', () => {
    // The module's whole claim is that the form and the server cannot drift. A schema that
    // rejects 2.5 must produce a control that rejects 2.5.
    for (const schema of [z.int(), z.number().int()]) {
      expect(schema.safeParse(2.5).success).toBe(false);
      expect(parseElicitationAnswer(elicitationFromZod(schema), 2.5).ok).toBe(false);
    }
  });

  it('maps a boolean to a confirm and a date to a datetime', () => {
    expect(elicitationFromZod(z.boolean())).toEqual({
      kind: 'confirm',
      confirmLabel: 'Yes',
      declineLabel: 'No',
    });
    expect(elicitationFromZod(z.date())).toEqual({
      kind: 'datetime',
      precision: 'datetime',
      timeZone: 'UTC',
      min: null,
      max: null,
    });
  });

  it('maps an enum and a single string literal to selects', () => {
    expect(elicitationFromZod(z.enum(['acme', 'ops_team']))).toEqual({
      kind: 'select',
      options: [
        { value: 'acme', label: 'Acme', description: null },
        { value: 'ops_team', label: 'Ops team', description: null },
      ],
      multiple: false,
    });
    expect(elicitationFromZod(z.literal('only'))).toMatchObject({
      kind: 'select',
      options: [{ value: 'only', label: 'Only', description: null }],
    });
  });

  it('maps an array to a list and carries its item bounds', () => {
    expect(elicitationFromZod(z.array(z.string()).min(1).max(3))).toEqual({
      kind: 'list',
      item: { kind: 'text', multiline: false, minLength: null, maxLength: null, placeholder: null },
      minItems: 1,
      maxItems: 3,
    });
  });

  it('unwraps every wrapper, and only some of them clear required', () => {
    // optional/nullable/default/prefault/catch all mean "the person may leave it alone".
    for (const schema of [
      z.string().optional(),
      z.string().nullable(),
      z.string().default('x'),
      z.string().prefault('x'),
      z.string().catch('x'),
    ]) {
      const spec = elicitationFromZod(z.object({ field: schema }));
      if (spec.kind !== 'form') throw new Error('unreachable');
      expect(spec.fields[0]?.required).toBe(false);
    }
    // `nonoptional` and `readonly` pass the inner requirement through rather than forcing it, so
    // a readonly string stays required and a re-required optional keeps the optional it wraps.
    const readonlySpec = elicitationFromZod(z.object({ field: z.string().readonly() }));
    if (readonlySpec.kind !== 'form') throw new Error('unreachable');
    expect(readonlySpec.fields[0]?.required).toBe(true);

    const reRequired = elicitationFromZod(z.object({ field: z.string().optional().nonoptional() }));
    if (reRequired.kind !== 'form') throw new Error('unreachable');
    expect(reRequired.fields[0]?.required).toBe(false);
  });

  it('sees through a pipe and a refinement to the underlying type', () => {
    expect(elicitationFromZod(z.string().pipe(z.string()))).toMatchObject({ kind: 'text' });
    expect(elicitationFromZod(z.string().refine(() => true))).toMatchObject({ kind: 'text' });
    // A refined object still converts, which is the property that makes refinements transparent.
    expect(elicitationFromZod(z.object({ a: z.string() }).refine(() => true))).toMatchObject({
      kind: 'form',
    });
  });

  it('turns a discriminated union into a variant picker without the tag field', () => {
    const spec = elicitationFromZod(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('email'), address: z.string() }),
        z.object({ kind: z.literal('sms'), number: z.string() }),
      ]),
    );
    expect(spec).toMatchObject({ kind: 'variant', discriminator: 'kind' });
    if (spec.kind !== 'variant') throw new Error('unreachable');
    expect(spec.variants.map((variant) => variant.value)).toEqual(['email', 'sms']);
    expect(spec.variants.map((variant) => variant.label)).toEqual(['Email', 'Sms']);
    // The discriminator is carried by the variant, so it must not also appear as a field.
    expect(spec.variants[0]?.fields.map((field) => field.key)).toEqual(['address']);
  });

  it('refuses every construct with no control, naming the kind and its path', () => {
    const cases: readonly [z.ZodType, string][] = [
      [z.object({ nested: z.object({ fn: z.map(z.string(), z.string()) }) }), 'nested.fn'],
      [z.object({ items: z.array(z.set(z.string())) }), 'items[]'],
    ];
    for (const [schema, path] of cases) {
      try {
        elicitationFromZod(schema);
        throw new Error('expected a refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(UnsupportedElicitationSchemaError);
        expect((error as UnsupportedElicitationSchemaError).message).toContain(path);
      }
    }
  });

  it('refuses an empty object, an empty union, and a non-string discriminator', () => {
    expect(() => elicitationFromZod(z.object({}))).toThrow(UnsupportedElicitationSchemaError);
    expect(() => elicitationFromZod(z.union([z.string(), z.number()]))).toThrow(
      UnsupportedElicitationSchemaError,
    );
    expect(() =>
      elicitationFromZod(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal(1), a: z.string() }),
          z.object({ kind: z.literal(2), b: z.string() }),
        ]) as unknown as z.ZodType,
      ),
    ).toThrow(UnsupportedElicitationSchemaError);
  });

  it('refuses a non-string literal', () => {
    expect(() => elicitationFromZod(z.literal(7))).toThrow(UnsupportedElicitationSchemaError);
  });

  it('round-trips: a schema-derived spec validates what the schema validates', () => {
    const schema = z.object({ channel: z.enum(['acme', 'ops']), note: z.string().optional() });
    const spec = elicitationFromZod(schema);
    expect(accepted(spec, { channel: 'ops' })).toEqual({ channel: 'ops' });
    expect(parseElicitationAnswer(spec, { channel: 'nope' }).ok).toBe(false);
  });
});

describe('elicitationFromMcpRequestedSchema', () => {
  it('lands a flat property bag on a form, honoring title, description, and required', () => {
    const spec = elicitationFromMcpRequestedSchema({
      type: 'object',
      properties: {
        confirmed: { type: 'boolean', title: 'Proceed?', description: 'Say yes to continue.' },
        note_text: { type: 'string' },
      },
      required: ['confirmed'],
    });
    expect(spec.kind).toBe('form');
    if (spec.kind !== 'form') throw new Error('unreachable');
    expect(spec.fields).toEqual([
      {
        key: 'confirmed',
        // The third-party server's own words reach the person unchanged.
        label: 'Proceed?',
        description: 'Say yes to continue.',
        required: true,
        control: { kind: 'confirm', confirmLabel: 'Yes', declineLabel: 'No' },
      },
      {
        key: 'note_text',
        label: 'Note text',
        description: null,
        required: false,
        control: {
          kind: 'text',
          multiline: false,
          minLength: null,
          maxLength: null,
          placeholder: null,
        },
      },
    ]);
  });

  it('carries the numeric and string constraints MCP allows', () => {
    const spec = elicitationFromMcpRequestedSchema({
      properties: {
        count: { type: 'integer', minimum: 1, maximum: 9 },
        ratio: { type: 'number' },
        name: { type: 'string', minLength: 2, maxLength: 5 },
      },
    });
    if (spec.kind !== 'form') throw new Error('unreachable');
    expect(spec.fields.map((field) => field.control)).toEqual([
      { kind: 'number', integer: true, min: 1, max: 9 },
      { kind: 'number', integer: false, min: null, max: null },
      {
        kind: 'text',
        multiline: false,
        minLength: 2,
        maxLength: 5,
        placeholder: null,
      },
    ]);
  });

  it('maps an enum to a select, preferring enumNames for the labels', () => {
    const spec = elicitationFromMcpRequestedSchema({
      properties: {
        env: { type: 'string', enum: ['prod', 'staging_two'], enumNames: ['Production'] },
      },
    });
    if (spec.kind !== 'form') throw new Error('unreachable');
    expect(spec.fields[0]?.control).toEqual({
      kind: 'select',
      options: [
        { value: 'prod', label: 'Production', description: null },
        // No name supplied for the second, so it falls back to the titleized value.
        { value: 'staging_two', label: 'Staging two', description: null },
      ],
      multiple: false,
    });
  });

  it('maps the two date formats to their precisions', () => {
    const spec = elicitationFromMcpRequestedSchema({
      properties: {
        day: { type: 'string', format: 'date' },
        moment: { type: 'string', format: 'date-time' },
        plain: { type: 'string', format: 'email' },
      },
    });
    if (spec.kind !== 'form') throw new Error('unreachable');
    const kinds = spec.fields.map((field) => field.control);
    expect(kinds[0]).toMatchObject({ kind: 'datetime', precision: 'date' });
    expect(kinds[1]).toMatchObject({ kind: 'datetime', precision: 'datetime' });
    // An unrecognized format is still a string, so it stays a text control.
    expect(kinds[2]).toMatchObject({ kind: 'text' });
  });

  it('refuses a request with no properties, and a property type with no control', () => {
    expect(() => elicitationFromMcpRequestedSchema({ type: 'object', properties: {} })).toThrow(
      UnsupportedElicitationSchemaError,
    );
    expect(() => elicitationFromMcpRequestedSchema(null)).toThrow(
      UnsupportedElicitationSchemaError,
    );
    expect(() =>
      elicitationFromMcpRequestedSchema({ properties: { nested: { type: 'object' } } }),
    ).toThrow(UnsupportedElicitationSchemaError);
    expect(() => elicitationFromMcpRequestedSchema({ properties: { untyped: {} } })).toThrow(
      UnsupportedElicitationSchemaError,
    );
  });
});

describe('toMcpElicitResult', () => {
  it('carries an object answer through as the content', () => {
    expect(toMcpElicitResult('accept', { confirmed: true })).toEqual({
      action: 'accept',
      content: { confirmed: true },
    });
  });

  it('wraps a non-object answer, because MCP content is always an object', () => {
    expect(toMcpElicitResult('accept', 'yes')).toEqual({
      action: 'accept',
      content: { value: 'yes' },
    });
    expect(toMcpElicitResult('accept', ['a'])).toEqual({
      action: 'accept',
      content: { value: ['a'] },
    });
    expect(toMcpElicitResult('accept', null)).toEqual({
      action: 'accept',
      content: { value: null },
    });
  });

  it('sends no content for the two answers that carry none', () => {
    // `decline` and `cancel` stay distinct: a server has to tell "said no" from "closed it".
    expect(toMcpElicitResult('decline', { ignored: true })).toEqual({ action: 'decline' });
    expect(toMcpElicitResult('cancel', { ignored: true })).toEqual({ action: 'cancel' });
  });
});

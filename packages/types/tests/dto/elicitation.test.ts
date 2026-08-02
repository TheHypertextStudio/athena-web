/**
 * The elicitation control grammar: Zod in, controls out, typed answers back.
 *
 * @remarks
 * The Zod fixture below is the requirement's own list — object, nested object, enum, discriminated
 * union, array, optional/nullable, constrained number, boolean, date, refinement — and each entry
 * asserts three things at once: that the schema produces a *complete* control set (every key in the
 * source schema has a control), that a valid value round-trips to the right parsed type, and that
 * the answer validator agrees with the original schema about what is valid.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ELICITATION_CONTROL_KINDS,
  ELICITATION_RESPONSE_KINDS,
  ElicitationRequestSchema,
  ElicitationSpecSchema,
  UnsupportedElicitationSchemaError,
  elicitationAnswerSchema,
  elicitationFromMcpRequestedSchema,
  elicitationFromZod,
  parseElicitationAnswer,
  toMcpElicitResult,
  type ElicitationControl,
  type ElicitationSpec,
} from '../../src/elicitation';

/** Every key a spec exposes, flattened, so "complete control set" is checkable. */
function controlKeys(spec: ElicitationControl, prefix = ''): readonly string[] {
  if (spec.kind === 'form') {
    return spec.fields.flatMap((field) => [
      `${prefix}${field.key}`,
      ...controlKeys(field.control, `${prefix}${field.key}.`),
    ]);
  }
  if (spec.kind === 'list') return controlKeys(spec.item, `${prefix}[].`);
  if (spec.kind === 'variant') {
    return spec.variants.flatMap((variant) => [
      `${prefix}${spec.discriminator}=${variant.value}`,
      ...variant.fields.flatMap((field) => [
        `${prefix}${variant.value}.${field.key}`,
        ...controlKeys(field.control, `${prefix}${variant.value}.${field.key}.`),
      ]),
    ]);
  }
  return [];
}

interface ZodCase {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly value: unknown;
  readonly kind: ElicitationControl['kind'];
  /** Keys the produced controls must cover; empty for a scalar. */
  readonly keys: readonly string[];
  /** A value the ORIGINAL schema rejects, which the derived validator must reject too. */
  readonly invalid: unknown;
}

const ZOD_CASES: readonly ZodCase[] = [
  {
    name: 'object',
    schema: z.object({ title: z.string(), urgent: z.boolean() }),
    value: { title: 'Ship it', urgent: true },
    kind: 'form',
    keys: ['title', 'urgent'],
    invalid: { title: 'Ship it', urgent: 'yes' },
  },
  {
    name: 'nested object',
    schema: z.object({ who: z.object({ name: z.string(), email: z.string() }) }),
    value: { who: { name: 'Ada', email: 'ada@example.com' } },
    kind: 'form',
    keys: ['who', 'who.name', 'who.email'],
    invalid: { who: { name: 'Ada' } },
  },
  {
    name: 'enum',
    schema: z.object({ channel: z.enum(['acme', 'ops']) }),
    value: { channel: 'ops' },
    kind: 'form',
    keys: ['channel'],
    invalid: { channel: 'engineering' },
  },
  {
    name: 'discriminated union',
    schema: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('email'), address: z.string() }),
      z.object({ kind: z.literal('slack'), channel: z.string() }),
    ]),
    value: { kind: 'slack', channel: '#acme' },
    kind: 'variant',
    keys: ['kind=email', 'email.address', 'kind=slack', 'slack.channel'],
    invalid: { kind: 'carrier-pigeon' },
  },
  {
    name: 'array',
    schema: z.array(z.string()).min(1),
    value: ['one', 'two'],
    kind: 'list',
    keys: [],
    invalid: [],
  },
  {
    name: 'optional',
    schema: z.object({ note: z.string().optional() }),
    value: {},
    kind: 'form',
    keys: ['note'],
    invalid: { note: 12 },
  },
  {
    name: 'nullable',
    schema: z.object({ note: z.string().nullable() }),
    value: { note: null },
    kind: 'form',
    keys: ['note'],
    invalid: { note: 12 },
  },
  {
    name: 'number with constraints',
    schema: z.object({ count: z.number().int().min(1).max(10) }),
    value: { count: 5 },
    kind: 'form',
    keys: ['count'],
    invalid: { count: 11 },
  },
  {
    name: 'boolean',
    schema: z.boolean(),
    value: true,
    kind: 'confirm',
    keys: [],
    invalid: 'yes',
  },
  {
    name: 'date',
    schema: z.date(),
    value: '2026-08-02T12:00:00Z',
    kind: 'datetime',
    keys: [],
    invalid: 'sometime next week',
  },
  {
    name: 'refinement',
    schema: z
      .object({ start: z.string(), end: z.string() })
      .refine((value) => value.start <= value.end, 'ordered'),
    value: { start: 'a', end: 'b' },
    kind: 'form',
    keys: ['start', 'end'],
    invalid: { start: 1, end: 2 },
  },
  {
    name: 'array of objects',
    schema: z.array(z.object({ key: z.string(), value: z.string() })),
    value: [{ key: 'a', value: 'b' }],
    kind: 'list',
    keys: ['[].key', '[].value'],
    invalid: [{ key: 'a' }],
  },
];

describe('ATH-46 — any Zod schema is representable as an elicitation', () => {
  it('covers at least the ten schema kinds the requirement enumerates', () => {
    expect(ZOD_CASES.length).toBeGreaterThanOrEqual(10);
  });

  it.each(ZOD_CASES)('renders a complete control set for $name', (testCase) => {
    const spec = elicitationFromZod(testCase.schema);

    expect(spec.kind).toBe(testCase.kind);
    expect(controlKeys(spec)).toEqual(testCase.keys);
    // The declaration itself is valid against the declaration schema — a partial or malformed
    // spec would fail here rather than reach a renderer.
    expect(ElicitationSpecSchema.parse(spec)).toBeTruthy();
  });

  it.each(ZOD_CASES)('round-trips a valid value to the right parsed type for $name', (testCase) => {
    const spec = elicitationFromZod(testCase.schema);

    const parsed = parseElicitationAnswer(spec, testCase.value);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('expected acceptance');
    expect(parsed.value).toEqual(testCase.value);
  });

  it.each(ZOD_CASES)('refuses a value the source schema also refuses for $name', (testCase) => {
    const spec = elicitationFromZod(testCase.schema);

    expect(testCase.schema.safeParse(testCase.invalid).success).toBe(false);
    const parsed = parseElicitationAnswer(spec, testCase.invalid);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('expected rejection');
    expect(parsed.errors.length).toBeGreaterThan(0);
    for (const error of parsed.errors) expect(error.text).toMatch(/[a-z]/);
  });

  it('throws loudly on a schema kind no control can render', () => {
    expect(() => elicitationFromZod(z.map(z.string(), z.string()))).toThrow(
      UnsupportedElicitationSchemaError,
    );
    expect(() => elicitationFromZod(z.set(z.string()))).toThrow(UnsupportedElicitationSchemaError);
    expect(() => elicitationFromZod(z.union([z.string(), z.number()]))).toThrow(
      UnsupportedElicitationSchemaError,
    );
    expect(() => elicitationFromZod(z.object({}))).toThrow(UnsupportedElicitationSchemaError);
  });

  it('names the offending kind and its path so the failure is diagnosable', () => {
    let thrown: unknown;
    try {
      elicitationFromZod(z.object({ inner: z.object({ bad: z.map(z.string(), z.string()) }) }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnsupportedElicitationSchemaError);
    const error = thrown as UnsupportedElicitationSchemaError;
    expect(error.schemaType).toBe('map');
    expect(error.path).toBe('inner.bad');
  });

  it('labels derived fields readably rather than echoing the key', () => {
    const spec = elicitationFromZod(z.object({ due_date: z.string(), assigneeId: z.string() }));

    expect(spec.kind).toBe('form');
    if (spec.kind !== 'form') throw new Error('expected a form');
    expect(spec.fields.map((field) => field.label)).toEqual(['Due date', 'Assignee Id']);
  });

  it('marks optional, nullable and defaulted fields not-required', () => {
    const spec = elicitationFromZod(
      z.object({
        a: z.string(),
        b: z.string().optional(),
        c: z.string().nullable(),
        d: z.string().default('x'),
      }),
    );

    if (spec.kind !== 'form') throw new Error('expected a form');
    expect(spec.fields.map((field) => field.required)).toEqual([true, false, false, false]);
  });
});

describe('the six response types', () => {
  it('exposes exactly the response types the product promises', () => {
    expect([...ELICITATION_RESPONSE_KINDS]).toEqual([
      'text',
      'confirm',
      'select',
      'datetime',
      'file',
      'form',
    ]);
    for (const kind of ELICITATION_RESPONSE_KINDS) {
      expect(ELICITATION_CONTROL_KINDS).toContain(kind);
    }
  });

  it('validates a text answer against its declared bounds', () => {
    const spec: ElicitationSpec = {
      kind: 'text',
      multiline: false,
      minLength: 3,
      maxLength: 6,
      placeholder: null,
    };

    expect(parseElicitationAnswer(spec, 'hello').ok).toBe(true);
    expect(parseElicitationAnswer(spec, 'hi')).toEqual({
      ok: false,
      errors: [{ path: '', text: 'This answer is too short.' }],
    });
    expect(parseElicitationAnswer(spec, 'far too long')).toEqual({
      ok: false,
      errors: [{ path: '', text: 'This answer is too long.' }],
    });
  });

  it('validates a confirmation as a boolean, not a label', () => {
    const spec: ElicitationSpec = { kind: 'confirm', confirmLabel: 'Do it', declineLabel: 'Stop' };

    expect(parseElicitationAnswer(spec, false)).toEqual({ ok: true, value: false });
    expect(parseElicitationAnswer(spec, 'Do it').ok).toBe(false);
  });

  it('refuses a selection outside the declared option set', () => {
    const spec: ElicitationSpec = {
      kind: 'select',
      multiple: false,
      options: [{ value: 'a', label: 'A', description: null }],
    };

    expect(parseElicitationAnswer(spec, 'a').ok).toBe(true);
    expect(parseElicitationAnswer(spec, 'b')).toEqual({
      ok: false,
      errors: [{ path: '', text: 'Choose one of the options offered.' }],
    });
  });

  it('accepts a multi-selection as an array of declared values', () => {
    const spec: ElicitationSpec = {
      kind: 'select',
      multiple: true,
      options: [
        { value: 'a', label: 'A', description: null },
        { value: 'b', label: 'B', description: null },
      ],
    };

    expect(parseElicitationAnswer(spec, ['a', 'b'])).toEqual({ ok: true, value: ['a', 'b'] });
    expect(parseElicitationAnswer(spec, ['a', 'z']).ok).toBe(false);
    expect(parseElicitationAnswer(spec, []).ok).toBe(false);
  });

  it('refuses a partially entered date and honours declared bounds', () => {
    const spec: ElicitationSpec = {
      kind: 'datetime',
      precision: 'datetime',
      timeZone: 'America/Chicago',
      min: '2026-08-01T00:00',
      max: '2026-08-31T23:59',
    };

    expect(parseElicitationAnswer(spec, '2026-08-05T09:30').ok).toBe(true);
    expect(parseElicitationAnswer(spec, '2026-08-05')).toEqual({
      ok: false,
      errors: [{ path: '', text: 'Enter a complete date and time.' }],
    });
    expect(parseElicitationAnswer(spec, '2026-07-31T09:30')).toEqual({
      ok: false,
      errors: [{ path: '', text: 'Pick a later date and time.' }],
    });
    expect(parseElicitationAnswer(spec, '2026-09-01T09:30')).toEqual({
      ok: false,
      errors: [{ path: '', text: 'Pick an earlier date and time.' }],
    });
  });

  it('accepts a date-only answer when that is the declared precision', () => {
    const spec: ElicitationSpec = {
      kind: 'datetime',
      precision: 'date',
      timeZone: 'UTC',
      min: null,
      max: null,
    };

    expect(parseElicitationAnswer(spec, '2026-08-05').ok).toBe(true);
    expect(parseElicitationAnswer(spec, '2026-08-05T09:30').ok).toBe(false);
  });

  it('refuses a file of the wrong type or over the size limit', () => {
    const spec: ElicitationSpec = {
      kind: 'file',
      accept: ['application/pdf'],
      maxBytes: 1000,
      multiple: false,
    };
    const file = {
      attachmentId: 'att_1',
      fileName: 'brief.pdf',
      contentType: 'application/pdf',
      byteSize: 900,
    };

    expect(parseElicitationAnswer(spec, file).ok).toBe(true);
    expect(parseElicitationAnswer(spec, { ...file, contentType: 'image/png' })).toEqual({
      ok: false,
      errors: [{ path: '', text: 'That file type is not accepted here.' }],
    });
    expect(parseElicitationAnswer(spec, { ...file, byteSize: 2000 })).toEqual({
      ok: false,
      errors: [{ path: '', text: 'That file is larger than this request allows.' }],
    });
  });

  it('reports a form error against the field it belongs to', () => {
    const spec: ElicitationSpec = {
      kind: 'form',
      fields: [
        {
          key: 'title',
          label: 'Title',
          description: null,
          required: true,
          control: {
            kind: 'text',
            multiline: false,
            minLength: 3,
            maxLength: null,
            placeholder: null,
          },
        },
        {
          key: 'count',
          label: 'Count',
          description: null,
          required: false,
          control: { kind: 'number', integer: true, min: 1, max: null },
        },
      ],
    };

    const result = parseElicitationAnswer(spec, { title: 'ab', count: 0 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.errors.map((error) => error.path).sort()).toEqual(['count', 'title']);
  });
});

describe('ElicitationRequestSchema', () => {
  it('defaults an unspecified timeout policy to the safe one', () => {
    const request = ElicitationRequestSchema.parse({
      question: 'Which channel?',
      actionSummary: 'Post the update',
      spec: { kind: 'text' },
    });

    expect(request.timeoutPolicy).toBe('ambiguous');
    expect(request.timeSensitive).toBe(false);
    expect(request.autoResolveReason).toBeNull();
  });

  it('refuses a request with no stated action', () => {
    expect(
      ElicitationRequestSchema.safeParse({
        question: 'Which channel?',
        actionSummary: '',
        spec: { kind: 'text' },
      }).success,
    ).toBe(false);
  });
});

describe('ATH-47 — MCP spec interop', () => {
  it('renders a spec-shaped requestedSchema as a form with the server’s own labels', () => {
    const spec = elicitationFromMcpRequestedSchema({
      type: 'object',
      properties: {
        confirmed: { type: 'boolean', title: 'Proceed with the push?' },
        branch: { type: 'string', enum: ['main', 'next'], enumNames: ['Main', 'Next'] },
        retries: { type: 'integer', minimum: 0, maximum: 5 },
        when: { type: 'string', format: 'date-time' },
        note: { type: 'string', maxLength: 200, description: 'Anything to add?' },
      },
      required: ['confirmed', 'branch'],
    });

    expect(spec.kind).toBe('form');
    if (spec.kind !== 'form') throw new Error('expected a form');
    expect(spec.fields.map((field) => [field.key, field.control.kind, field.required])).toEqual([
      ['confirmed', 'confirm', true],
      ['branch', 'select', true],
      ['retries', 'number', false],
      ['when', 'datetime', false],
      ['note', 'text', false],
    ]);
    expect(spec.fields[0]?.label).toBe('Proceed with the push?');
    const branch = spec.fields[1]?.control;
    expect(branch?.kind === 'select' && branch.options.map((option) => option.label)).toEqual([
      'Main',
      'Next',
    ]);
    expect(spec.fields[4]?.description).toBe('Anything to add?');
  });

  it('refuses a requestedSchema the spec does not permit', () => {
    expect(() =>
      elicitationFromMcpRequestedSchema({
        type: 'object',
        properties: { nested: { type: 'object' } },
      }),
    ).toThrow(UnsupportedElicitationSchemaError);
    expect(() => elicitationFromMcpRequestedSchema({ type: 'object', properties: {} })).toThrow(
      UnsupportedElicitationSchemaError,
    );
  });

  it('builds each of the three spec-conformant responses', () => {
    expect(toMcpElicitResult('accept', { confirmed: true })).toEqual({
      action: 'accept',
      content: { confirmed: true },
    });
    // A scalar answer is wrapped, because the spec's `content` is always an object.
    expect(toMcpElicitResult('accept', 'main')).toEqual({
      action: 'accept',
      content: { value: 'main' },
    });
    expect(toMcpElicitResult('decline', { confirmed: false })).toEqual({ action: 'decline' });
    expect(toMcpElicitResult('cancel', undefined)).toEqual({ action: 'cancel' });
  });

  it('round-trips an MCP-derived form through its own validator', () => {
    const spec = elicitationFromMcpRequestedSchema({
      type: 'object',
      properties: { branch: { type: 'string', enum: ['main', 'next'] } },
      required: ['branch'],
    });

    expect(elicitationAnswerSchema(spec).safeParse({ branch: 'main' }).success).toBe(true);
    expect(elicitationAnswerSchema(spec).safeParse({ branch: 'dev' }).success).toBe(false);
  });
});

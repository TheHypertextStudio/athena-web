/** The local-model prompt shares schemas; MCP and provider tool schemas remain unchanged. */
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { buildTurnRequest } from '@docket/athena/turn/adapters/anthropic';
import { buildVertexTurnRequest } from '@docket/athena/turn/adapters/vertex';
import { renderToolInstructions } from '@docket/athena/turn/adapters/lattice';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

type Schema = Record<string, unknown>;
const item = z.strictObject({
  title: z.string().min(1),
  order: z.number().int().min(0).max(500),
  tags: z.array(z.enum(['event', 'preparation', 'delivery'])).max(20),
  dates: z.strictObject({ start: z.string().nullable(), due: z.string().nullable() }),
});
const original: Schema = z.toJSONSchema(z.strictObject({ first: item, second: item, third: item }));
const valid = {
  title: 'Dinner',
  order: 1,
  tags: ['event'],
  dates: { start: null, due: '2026-10-15' },
};
function registry(schemas: Readonly<Record<string, Schema>>): Schema {
  const rendered = renderToolInstructions(
    Object.entries(schemas).map(([name, inputSchema]) => ({
      name,
      description: name,
      inputSchema,
    })),
  );
  const json = rendered.split('```json\n').at(-1)?.split('\n```')[0] ?? '';
  return z.record(z.string(), z.unknown()).parse(JSON.parse(json));
}

describe('Lattice same-document schema registry', () => {
  it('retains validation equivalence for valid and invalid inputs', () => {
    const shared = registry({ schedule: original, another: original });
    const validator = new AjvJsonSchemaValidator();
    const before = validator.getValidator(original);
    const after = validator.getValidator(shared);
    const samples = [
      { first: valid, second: valid, third: valid },
      { first: { ...valid, title: '' }, second: valid, third: valid },
      { first: { ...valid, order: 501 }, second: valid, third: valid },
      { first: { ...valid, tags: ['hidden'] }, second: valid, third: valid },
      { first: { ...valid, privateClaim: {} }, second: valid, third: valid },
      { first: valid, second: valid },
    ];
    expect(samples.map((sample) => after({ schedule: sample }).valid)).toEqual(
      samples.map((sample) => before(sample).valid),
    );
    expect(samples.map((sample) => after({ schedule: sample }).valid)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(JSON.stringify(shared).length).toBeLessThan(JSON.stringify(original).length * 2);
  });
  it.each(['oneOf', 'anyOf'])(
    'factors %s without accepting missing, extra or contradictory branch fields',
    (keyword) => {
      const common = { type: 'string', minLength: 1, maxLength: 128 };
      const union: Schema = {
        [keyword]: ['task', 'project', 'program', 'initiative'].map((kind) => ({
          type: 'object',
          properties: { kind: { const: kind }, title: common, [kind]: { type: 'boolean' } },
          required: ['kind', 'title', kind],
          additionalProperties: false,
        })),
      };
      const shared = registry({ capture: union });
      const validator = new AjvJsonSchemaValidator();
      const before = validator.getValidator(union);
      const after = validator.getValidator(shared);
      const samples: unknown[] = [
        { kind: 'task', title: 'Report', task: true },
        { kind: 'project', title: 'Report', project: false },
        { kind: 'task', task: true },
        { kind: 'task', title: '', task: true },
        { kind: 'task', title: 'Report' },
        { kind: 'task', title: 'Report', task: true, project: true },
        { kind: 'task', title: 1, task: true },
        null,
        [],
        'text',
      ];
      const expected = samples.map((sample) => before(sample).valid);
      expect(expected).toEqual([
        true,
        true,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
      expect(samples.map((sample) => after({ capture: sample }).valid)).toEqual(expected);
      expect(JSON.stringify(shared).length).toBeLessThan(JSON.stringify(union).length);
    },
  );
  it('preserves incoming union-descendant pointers and overlapping oneOf match counts', () => {
    const common = { type: 'string', minLength: 1, maxLength: 128 };
    const union = {
      oneOf: [0, 10].map((minimum) => ({
        type: 'object',
        properties: { title: common, value: { type: 'number', minimum } },
        required: ['title', 'value'],
        additionalProperties: false,
      })),
    };
    const original: Schema = {
      type: 'object',
      properties: {
        shape: union,
        selected: { $ref: '#/properties/shape/oneOf/0/properties/title' },
      },
    };
    const snapshot = JSON.stringify(original);
    const shared = registry({ capture: original, overlap: union });
    const validator = new AjvJsonSchemaValidator();
    const before = validator.getValidator(original);
    const after = validator.getValidator(shared);
    for (const sample of [
      { shape: { title: 'Report', value: 5 }, selected: 'title' },
      { shape: { title: 'Report', value: 15 }, selected: 'title' },
      { shape: { title: 'Report', value: 5 }, selected: '' },
      { shape: { title: 'Report', value: 5 }, selected: 1 },
    ])
      expect(after({ capture: sample }).valid).toBe(before(sample).valid);
    expect(after({ overlap: { title: 'Report', value: 5 } }).valid).toBe(true);
    expect(after({ overlap: { title: 'Report', value: 15 } }).valid).toBe(false);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
  it('rebases colliding local definitions and recursive root pointers without changing literals', () => {
    const a = {
      type: 'object',
      properties: {
        value: { $ref: '#/$defs/item' },
        description: { type: 'string', enum: ['first', 'second'] },
      },
      required: ['value'],
      additionalProperties: false,
      $defs: { item: { type: 'integer', minimum: 1 } },
    };
    const b = { ...a, $defs: { item: { type: 'string', minLength: 2 } } };
    const recursive = {
      type: 'object',
      properties: { title: { type: 'string' }, child: { $ref: '#' } },
      required: ['title'],
      additionalProperties: false,
    };
    const snapshot = JSON.stringify({ a, b, recursive });
    const shared = registry({ a, b, recursive });
    const validate = new AjvJsonSchemaValidator().getValidator(shared);
    expect(
      validate({
        a: { value: 1, description: 'first' },
        b: { value: 'ok' },
        recursive: { title: 'root', child: { title: 'child' } },
      }).valid,
    ).toBe(true);
    expect(validate({ a: { value: 'wrong' } }).valid).toBe(false);
    expect(validate({ b: { value: 1 } }).valid).toBe(false);
    expect(validate({ recursive: { title: 'root', child: { title: 1 } } }).valid).toBe(false);
    expect(JSON.stringify({ a, b, recursive })).toBe(snapshot);
  });
  it('isolates anchored and external reference documents instead of rewriting their scope', () => {
    const schemas = [
      {
        $id: 'urn:private-tool',
        type: 'object',
        properties: { value: { $ref: '#node' } },
        $defs: { item: { $anchor: 'node', type: 'string' } },
      },
      { type: 'object', properties: { value: { $ref: 'https://example.test/schema' } } },
    ];
    const rendered = renderToolInstructions(
      schemas.map((inputSchema, i) => ({
        name: `isolated_${i}`,
        description: 'Isolated schema',
        inputSchema,
      })),
    );
    expect(rendered).toContain('separate schema document');
    expect(rendered).toContain('"$ref":"#node"');
    expect(rendered).toContain('"$ref":"https://example.test/schema"');
    expect(rendered).not.toContain('Input JSON Schema registry:');
  });
  it('leaves Anthropic and Vertex provider schemas exactly as registered', () => {
    const input = {
      system: 'Athena',
      messages: [],
      tools: [{ name: 'schedule', description: 'Schedule work', inputSchema: original }],
    };
    expect(buildTurnRequest(input, { apiKey: 'test-only' }).tools?.[0]).toMatchObject({
      input_schema: original,
    });
    expect(
      buildVertexTurnRequest(input).tools?.[0].functionDeclarations[0]?.parametersJsonSchema,
    ).toEqual(original);
  });
});

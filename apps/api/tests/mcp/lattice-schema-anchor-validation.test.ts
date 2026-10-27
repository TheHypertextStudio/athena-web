/** Generated local anchors retain the accepted tool inputs under the catalog's JSON Schema draft. */
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { shareLargeSchemaFragments } from '../../../../domains/athena/src/turn/internal/lattice-schema-registry';

type Schema = Record<string, unknown>;
function toolbox(): Schema {
  return {
    type: 'object',
    properties: Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [
        `tool${index}`,
        {
          type: 'object',
          properties: {
            id: { type: 'string', minLength: 1 },
            [`body${index}`]: { type: 'string', minLength: 1 },
            file: {
              type: 'object',
              properties: {
                digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                size: { type: 'integer', minimum: 0, maximum: 65536 },
              },
              required: ['digest', 'size'],
              additionalProperties: false,
            },
          },
          required: ['id', `body${index}`],
          additionalProperties: false,
        },
      ]),
    ),
    additionalProperties: false,
  };
}

describe('local-model JSON Schema anchor equivalence', () => {
  it('accepts and rejects the same bounded inputs through generated anchors', () => {
    const original = toolbox();
    const pooled = shareLargeSchemaFragments(original);
    expect(JSON.stringify(pooled)).toContain('"$anchor"');
    const ajv = new Ajv2020({ strict: false });
    const before = ajv.compile(original);
    const after = ajv.compile(pooled);
    for (const index of [0, 7, 29]) {
      const body = `body${index}`;
      for (const arguments_ of [
        { id: 'ok', [body]: 'text' },
        { id: '', [body]: 'text' },
        { id: 'ok' },
        { id: 'ok', [body]: 1 },
        { id: 'ok', [body]: 'text', extra: true },
        { id: 'ok', [body]: 'text', file: { digest: 'a'.repeat(64), size: 65536 } },
        { id: 'ok', [body]: 'text', file: { digest: 'a'.repeat(63), size: 1 } },
        { id: 'ok', [body]: 'text', file: { digest: 'a'.repeat(64), size: 65537 } },
        { id: 'ok', [body]: 'text', file: { digest: 'a'.repeat(64), size: -1 } },
      ]) {
        const input = { [`tool${index}`]: arguments_ };
        expect(after(input)).toBe(before(input));
      }
    }
    expect(after({ unknownTool: {} })).toBe(false);
  });
  it('preserves constraints beside existing pointers into repeated schemas', () => {
    const original = toolbox();
    (original['properties'] as Schema)['bounded'] = {
      $ref: '#/properties/tool0/properties/id',
      maxLength: 3,
    };
    const pooled = shareLargeSchemaFragments(original);
    const ajv = new Ajv2020({ strict: false });
    const before = ajv.compile(original);
    const after = ajv.compile(pooled);
    for (const bounded of ['', 'ok', 'long', 1]) {
      expect(after({ bounded })).toBe(before({ bounded }));
    }
    expect(after({ bounded: 'ok' })).toBe(true);
    expect(after({ bounded: 'long' })).toBe(false);
  });
});

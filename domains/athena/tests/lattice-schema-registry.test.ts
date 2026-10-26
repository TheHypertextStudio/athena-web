import { describe, expect, it } from 'vitest';
import {
  schemaNeedsIsolation,
  shareLargeSchemaFragments,
} from '../src/turn/internal/lattice-schema-registry';

type Schema = Record<string, unknown>;
const NAMED = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
  'dependencies',
]);
const CHILDREN = new Set([
  'items',
  'prefixItems',
  'additionalItems',
  'contains',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contentSchema',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'anyOf',
  'oneOf',
  'allOf',
]);
function record(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Expand document-local references only in schema positions; annotation literals remain literal. */
function expanded(root: Schema): unknown {
  const anchors = new Map<string, Schema>();
  function collect(value: unknown): void {
    if (!record(value)) return;
    if (typeof value['$anchor'] === 'string') {
      if (anchors.has(value['$anchor'])) throw new Error('Duplicate schema anchor');
      anchors.set(value['$anchor'], value);
    }
    for (const [key, child] of Object.entries(value)) {
      if (NAMED.has(key) && record(child)) Object.values(child).forEach(collect);
      else if (CHILDREN.has(key)) {
        if (Array.isArray(child)) child.forEach(collect);
        else collect(child);
      }
    }
  }
  collect(root);
  function pointer(ref: string): unknown {
    if (!ref.startsWith('#/')) {
      const target = anchors.get(ref.slice(1));
      if (!target) throw new Error('Expected document-local anchor');
      return target;
    }
    return ref
      .slice(2)
      .split('/')
      .reduce<unknown>((value, key) => {
        if (!record(value)) throw new Error('Invalid schema reference');
        return value[key.replaceAll('~1', '/').replaceAll('~0', '~')];
      }, root);
  }
  function visit(value: unknown): unknown {
    if (!record(value)) return value;
    const referenced = typeof value['$ref'] === 'string' ? pointer(value['$ref']) : null;
    if (referenced) return visit(referenced);
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '$defs' && key !== '$anchor')
        .map(([key, child]) => {
          if (NAMED.has(key) && record(child))
            return [
              key,
              Object.fromEntries(
                Object.entries(child).map(([name, schema]) => [name, visit(schema)]),
              ),
            ];
          if (CHILDREN.has(key))
            return [key, Array.isArray(child) ? child.map(visit) : visit(child)];
          return [key, child];
        }),
    );
  }
  return visit(root);
}
/** Unique parent shapes leave repeated small constraints that the old 40-character cutoff misses. */
function toolbox(identicalParents = false): Schema {
  return {
    type: 'object',
    properties: Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => {
        const body = identicalParents ? 'body' : `body${index}`;
        return [
          `tool${index}`,
          {
            type: 'object',
            properties: {
              id: { type: 'string', minLength: 1 },
              orgId: { type: 'string', minLength: 1 },
              [body]: { type: 'string', minLength: 1 },
            },
            required: ['id', 'orgId', body],
          },
        ];
      }),
    ),
  };
}

describe('lossless local-model schema pooling', () => {
  it('compresses repeated short constraints across different tool shapes without changing expansion', () => {
    const original = toolbox();
    const before = JSON.stringify(original);
    const pooled = shareLargeSchemaFragments(original);
    expect(JSON.stringify(pooled).length).toBeLessThan(before.length * 0.9);
    expect(expanded(pooled)).toEqual(expanded(original));
    expect(JSON.stringify(original)).toBe(before);
  });

  it('retains the shorter existing candidate when extra leaf definitions would make it larger', () => {
    const original = toolbox(true);
    const pooled = shareLargeSchemaFragments(original);
    // Existing parent pooling costs 1,118 bytes; eagerly pooling its small leaves costs 1,121.
    // This protects the real case where more definitions create a larger prompt.
    expect(JSON.stringify(pooled).length).toBeLessThanOrEqual(1118);
    expect(expanded(pooled)).toEqual(expanded(original));
  });

  it('preserves digest patterns, file bounds, required fields and literal default/example values', () => {
    const tools = toolbox();
    const original: Schema = {
      ...tools,
      properties: {
        ...(tools['properties'] as Schema),
        send_email: {
          type: 'object',
          additionalProperties: false,
          properties: {
            description: { type: 'string', minLength: 1 },
            attachments: {
              type: 'array',
              maxItems: 5,
              items: {
                type: 'object',
                properties: {
                  digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                  size: { type: 'integer', minimum: 0, maximum: 65536 },
                  contentType: { enum: ['text/plain', 'text/markdown', 'text/csv'] },
                },
                required: ['digest', 'size', 'contentType'],
                additionalProperties: false,
              },
            },
            literal: {
              type: 'object',
              default: { $ref: '#/not-a-schema-reference', properties: { keep: true } },
              examples: [{ $ref: '#/also-literal' }],
            },
          },
          required: ['description', 'attachments'],
        },
      },
    };
    expect(expanded(shareLargeSchemaFragments(original))).toEqual(expanded(original));
  });

  it('keeps an existing definition and its local reference distinct from generated definitions', () => {
    const tools = toolbox();
    const definition = { type: 'string', pattern: '^approved$' };
    const original: Schema = {
      ...tools,
      $defs: { '0': definition },
      properties: {
        ...(tools['properties'] as Schema),
        approved: { $ref: '#/$defs/0' },
      },
    };
    const pooled = shareLargeSchemaFragments(original);
    expect((pooled['$defs'] as Schema)['0']).toEqual(definition);
    expect(expanded(pooled)).toEqual(expanded(original));
  });
  it.each(['tool0', 'tool~/'])(
    'preserves nested reference targets under %s when a repeated parent could be pooled',
    (name) => {
      const tools = toolbox(true);
      const original: Schema = {
        ...tools,
        properties: {
          ...(tools['properties'] as Schema),
          [name]: (tools['properties'] as Schema)['tool0'],
          selected: {
            $ref: `#/properties/${name.replaceAll('~', '~0').replaceAll('/', '~1')}/properties/id`,
          },
        },
      };
      expect(expanded(shareLargeSchemaFragments(original))).toEqual(expanded(original));
    },
  );
  it('leaves an unresolved reference untouched rather than pooling its surrounding schemas', () => {
    const tools = toolbox(true);
    const original = {
      ...tools,
      properties: {
        ...(tools['properties'] as Schema),
        selected: { $ref: '#/missing/definition' },
      },
    };
    expect(shareLargeSchemaFragments(original)).toBe(original);
  });
  it.each(['unevaluatedItems', 'contentSchema', 'dependencies'])(
    'preserves nested pointers inside %s',
    (keyword) => {
      const tools = toolbox(true);
      const reference = { $ref: '#/properties/tool0/properties/id' };
      const selected =
        keyword === 'dependencies'
          ? { dependencies: { present: reference } }
          : { [keyword]: reference };
      const original: Schema = {
        ...tools,
        properties: { ...(tools['properties'] as Schema), selected },
      };
      const pooled = shareLargeSchemaFragments(original);
      const properties = pooled['properties'] as Schema;
      const parent = properties['tool0'] as Schema;
      expect((parent['properties'] as Schema)['id']).toBeDefined();
      expect(expanded(pooled)).toEqual(expanded(original));
    },
  );

  it.each(['$id', '$anchor', '$dynamicAnchor', '$dynamicRef', '$recursiveAnchor', '$recursiveRef'])(
    'preserves a document with %s rather than moving its reference-resolution scope',
    (keyword) => {
      const original = { ...toolbox(), [keyword]: 'scope' };
      expect(schemaNeedsIsolation(original)).toBe(true);
      expect(shareLargeSchemaFragments(original)).toBe(original);
    },
  );

  it('uses unique short local anchors while preserving literal annotations and input immutability', () => {
    const original = toolbox();
    const properties = original['properties'] as Schema;
    properties['literal'] = {
      type: 'object',
      default: { $anchor: 'A', $ref: '#A' },
      examples: [{ $anchor: 'B', $ref: '#B' }],
    };
    const before = JSON.stringify(original);
    const pooled = shareLargeSchemaFragments(original);
    expect(JSON.stringify(pooled)).toContain('"$anchor"');
    expect(expanded(pooled)).toEqual(expanded(original));
    expect(JSON.stringify(original)).toBe(before);
  });

  it('leaves inherited JSON Pointer targets unresolved', () => {
    const original = {
      ...toolbox(),
      additionalProperties: { $ref: '#/constructor/prototype' },
    };
    expect(shareLargeSchemaFragments(original)).toBe(original);
  });

  it('does not unfold a compact acyclic reference DAG into an exponential schema', () => {
    const definitions: Schema = { leaf: { type: 'string', minLength: 1 } };
    let previous = 'leaf';
    for (let index = 0; index < 32; index += 1) {
      const name = `level${index}`;
      definitions[name] = {
        type: 'object',
        properties: {
          left: { $ref: `#/$defs/${previous}` },
          right: { $ref: `#/$defs/${previous}` },
        },
        required: ['left', 'right'],
      };
      previous = name;
    }
    const original = {
      type: 'object',
      $defs: definitions,
      properties: { tree: { $ref: `#/$defs/${previous}` } },
    };
    expect(shareLargeSchemaFragments(original)).toEqual(original);
  });

  it('does not expand a tiny schema when references cannot save bytes', () => {
    const original = {
      type: 'object',
      properties: { enabled: { type: 'boolean' }, empty: { type: 'null' } },
    };
    expect(shareLargeSchemaFragments(original)).toEqual(original);
  });
});

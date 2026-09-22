import { describe, expect, it } from 'vitest';

import {
  addExamplesAndDescriptions,
  ensureDescriptions,
  exampleForSchema,
} from '../../src/openapi-public-schema';
import type { JsonObject } from '../../src/openapi-public-prose';

const noComponents: JsonObject = {};

/** Build a document whose one POST operation sends and returns the given media map. */
function documentWithMedia(content: JsonObject, components?: JsonObject): JsonObject {
  const document: JsonObject = {
    paths: {
      '/v1/widgets': {
        post: {
          summary: 'Create a widget',
          requestBody: { content },
          responses: { '200': { content: structuredClone(content) } },
        },
      },
    },
  };
  if (components) document['components'] = components;
  return document;
}

/** Return the request-body media map from {@link documentWithMedia}. */
function requestContent(document: JsonObject): JsonObject {
  const paths = document['paths'] as JsonObject;
  const operation = (paths['/v1/widgets'] as JsonObject)['post'] as JsonObject;
  return (operation['requestBody'] as JsonObject)['content'] as JsonObject;
}

describe('public OpenAPI description filling', () => {
  it('describes properties of every schema in an array and skips non-object entries', () => {
    const first: JsonObject = { properties: { name: { type: 'string' } } };
    const second: JsonObject = { properties: { flag: true, count: { type: 'integer' } } };

    ensureDescriptions([first, 'not-a-schema', second]);

    const firstProperties = first['properties'] as JsonObject;
    const secondProperties = second['properties'] as JsonObject;
    expect(firstProperties['name']).toHaveProperty('description');
    expect(secondProperties['count']).toHaveProperty('description');
    expect(secondProperties['flag']).toBe(true);
  });
});

describe('public OpenAPI example generation', () => {
  it('omits a required property whose schema yields no example', () => {
    const schema = {
      type: 'object',
      required: ['id', 'opaque'],
      properties: { id: { type: 'string' }, opaque: { format: 'custom' } },
    };

    expect(exampleForSchema(schema, noComponents)).toEqual({ id: 'example' });
  });

  it('refuses a pattern no deterministic candidate satisfies', () => {
    expect(() => exampleForSchema({ type: 'string', pattern: '^zzz-only$' }, noComponents)).toThrow(
      Error,
    );
  });

  it('merges an allOf reference to a missing schema using only its sibling keywords', () => {
    const schema = {
      allOf: [
        { $ref: '#/components/schemas/Missing', required: ['code'] },
        { type: 'object', properties: { code: { const: 'widget' } } },
      ],
    };

    expect(exampleForSchema(schema, noComponents)).toEqual({ code: 'widget' });
  });

  it('merges an allOf reference when the components define that schema', () => {
    const components: JsonObject = {
      schemas: {
        Base: { type: 'object', required: ['id'], properties: { id: { const: 'base' } } },
      },
    };
    const schema = {
      allOf: [
        { $ref: '#/components/schemas/Base' },
        { required: ['kind'], properties: { kind: { enum: ['widget', 'gadget'] } } },
      ],
    };

    expect(exampleForSchema(schema, components)).toEqual({ id: 'base', kind: 'widget' });
  });

  it('yields no example for a reference when the components have no schemas', () => {
    expect(exampleForSchema({ $ref: '#/components/schemas/Widget' }, noComponents)).toBeUndefined();
  });

  it('yields no example for a reference that names no schema', () => {
    const components: JsonObject = { schemas: { Widget: { const: 'widget' } } };

    expect(exampleForSchema({ $ref: '#/components/schemas/' }, components)).toBeUndefined();
  });

  it('keeps an integer example below an exclusive maximum', () => {
    expect(exampleForSchema({ type: 'integer', exclusiveMaximum: 0 }, noComponents)).toBe(-1);
  });

  it('keeps a number example below an exclusive maximum', () => {
    const value = exampleForSchema({ type: 'number', exclusiveMaximum: 0 }, noComponents);

    expect(typeof value).toBe('number');
    expect(value as number).toBeLessThan(0);
  });

  it('yields no example for an untyped schema with constraints', () => {
    expect(exampleForSchema({ format: 'custom' }, noComponents)).toBeUndefined();
  });
});

describe('public OpenAPI document decoration', () => {
  it('decorates operations in a document without components', () => {
    const document = documentWithMedia({
      'application/json': {
        schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      },
    });

    addExamplesAndDescriptions(document);

    expect(requestContent(document)['application/json']).toMatchObject({
      example: { name: 'example' },
    });
  });

  it('leaves non-object and exampleless component schemas without examples', () => {
    const schemas: JsonObject = { Anything: true, Opaque: { format: 'custom' } };

    addExamplesAndDescriptions({ components: { schemas } });

    expect(schemas['Anything']).toBe(true);
    expect(schemas['Opaque']).not.toHaveProperty('example');
  });

  it('adds no media example when the schema yields none and skips non-object media', () => {
    const document = documentWithMedia({
      'application/json': { schema: { format: 'custom' } },
      'text/plain': 'not-a-media-object',
    });

    addExamplesAndDescriptions(document);

    const content = requestContent(document);
    expect(content['application/json']).not.toHaveProperty('example');
    expect(content['text/plain']).toBe('not-a-media-object');
  });

  it('leaves a multipart schema without a file part unchanged', () => {
    const properties: JsonObject = { note: { type: 'string' } };
    const document = documentWithMedia({
      'multipart/form-data': { schema: { type: 'object', properties } },
    });

    addExamplesAndDescriptions(document);

    const media = requestContent(document)['multipart/form-data'] as JsonObject;
    const schema = media['schema'] as JsonObject;
    expect(Object.keys(schema['properties'] as JsonObject)).toEqual(['note']);
    expect((schema['properties'] as JsonObject)['note']).toMatchObject({ type: 'string' });
  });

  it('leaves a multipart schema without properties unchanged', () => {
    const document = documentWithMedia({
      'multipart/form-data': { schema: { type: 'string', format: 'binary' } },
    });

    addExamplesAndDescriptions(document);

    const media = requestContent(document)['multipart/form-data'] as JsonObject;
    expect(media['schema']).toEqual({ type: 'string', format: 'binary' });
  });
});

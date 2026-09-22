import { describe, expect, it } from 'vitest';

import {
  deduplicateComponentSchemas,
  deduplicateNestedSchemas,
  hoistReferencedExamples,
  hoistRepeatedParameters,
  hoistRepeatedResponses,
  moveSharedPathParameters,
  pruneUnreferencedSchemas,
  unresolvedSchemaReferences,
} from '../../src/openapi-public-deduplication';
import type { JsonObject } from '../../src/openapi-public-prose';

type DocumentTransform = (document: JsonObject) => void;

/** Read the components object from a transformed document. */
function componentsOf(document: JsonObject): JsonObject {
  return document['components'] as JsonObject;
}

/** Read one component section (schemas, parameters, responses) from a document. */
function componentSection(document: JsonObject, name: string): JsonObject {
  return componentsOf(document)[name] as JsonObject;
}

/** Read one operation from a document's paths. */
function operationAt(document: JsonObject, path: string, method: string): JsonObject {
  const paths = document['paths'] as JsonObject;
  return (paths[path] as JsonObject)[method] as JsonObject;
}

/** Build a document whose one GET operation returns the given JSON media object. */
function documentReturning(media: JsonObject, schemas: JsonObject): JsonObject {
  return {
    paths: {
      '/v1/widgets': {
        get: { responses: { '200': { content: { 'application/json': media } } } },
      },
    },
    components: { schemas },
  };
}

/** Return the JSON media object from the operation built by {@link documentReturning}. */
function returnedMedia(document: JsonObject): JsonObject {
  const responses = operationAt(document, '/v1/widgets', 'get')['responses'] as JsonObject;
  const content = (responses['200'] as JsonObject)['content'] as JsonObject;
  return content['application/json'] as JsonObject;
}

describe('public OpenAPI deduplication on a bare document', () => {
  const sectionByTransform: readonly (readonly [string, DocumentTransform, string])[] = [
    ['nested schemas', deduplicateNestedSchemas, 'schemas'],
    ['component schemas', deduplicateComponentSchemas, 'schemas'],
    ['unreferenced schemas', pruneUnreferencedSchemas, 'schemas'],
    ['repeated parameters', hoistRepeatedParameters, 'parameters'],
    ['repeated responses', hoistRepeatedResponses, 'responses'],
  ];

  it.each(sectionByTransform)(
    'creates an empty component section when deduplicating %s',
    (_label, transform, section) => {
      const document: JsonObject = {};

      transform(document);

      expect(componentSection(document, section)).toEqual({});
    },
  );

  it('leaves a document without components unchanged when hoisting examples', () => {
    const document: JsonObject = {};

    hoistReferencedExamples(document);

    expect(document).toEqual({});
  });

  it('leaves a document without paths unchanged when moving shared parameters', () => {
    const document: JsonObject = {};

    moveSharedPathParameters(document);

    expect(document).toEqual({});
  });

  it('reports every schema reference as unresolved when the document has no components', () => {
    const document: JsonObject = {
      paths: { '/v1/a': { get: { schema: { $ref: '#/components/schemas/Widget' } } } },
    };

    expect(unresolvedSchemaReferences(document)).toEqual(['Widget']);
  });
});

describe('public OpenAPI component schema deduplication', () => {
  it('keeps boolean schemas and collapses identical object schemas onto the shortest name', () => {
    const shape = { type: 'object', properties: { id: { type: 'string' } } };
    const document: JsonObject = {
      paths: { '/v1/a': { get: { schema: { $ref: '#/components/schemas/WidgetOutput' } } } },
      components: {
        schemas: { Anything: true, Widget: structuredClone(shape), WidgetOutput: shape },
      },
    };

    deduplicateComponentSchemas(document);

    expect(Object.keys(componentSection(document, 'schemas')).sort()).toEqual([
      'Anything',
      'Widget',
    ]);
    expect(operationAt(document, '/v1/a', 'get')['schema']).toEqual({
      $ref: '#/components/schemas/Widget',
    });
  });
});

describe('public OpenAPI referenced example hoisting', () => {
  it('keeps the media example when the referenced schema does not exist', () => {
    const document = documentReturning(
      { schema: { $ref: '#/components/schemas/Missing' }, example: { id: 'a' } },
      {},
    );

    hoistReferencedExamples(document);

    expect(returnedMedia(document)['example']).toEqual({ id: 'a' });
  });

  it('moves the media example onto a referenced schema that has none', () => {
    const schemas: JsonObject = { Widget: { type: 'object' } };
    const document = documentReturning(
      { schema: { $ref: '#/components/schemas/Widget' }, example: { id: 'a' } },
      schemas,
    );

    hoistReferencedExamples(document);

    expect(schemas['Widget']).toMatchObject({ example: { id: 'a' } });
    expect(returnedMedia(document)).not.toHaveProperty('example');
  });

  it('keeps a media example that differs from the schema example', () => {
    const schemas: JsonObject = { Widget: { type: 'object', example: { id: 'schema' } } };
    const document = documentReturning(
      { schema: { $ref: '#/components/schemas/Widget' }, example: { id: 'operation' } },
      schemas,
    );

    hoistReferencedExamples(document);

    expect(schemas['Widget']).toMatchObject({ example: { id: 'schema' } });
    expect(returnedMedia(document)['example']).toEqual({ id: 'operation' });
  });
});

describe('public OpenAPI unreferenced schema pruning', () => {
  it('removes every schema when the only reference names no schema', () => {
    const document: JsonObject = {
      paths: { '/v1/a': { get: { schema: { $ref: '#/components/schemas/' } } } },
      components: { schemas: { Orphan: { type: 'string' } } },
    };

    pruneUnreferencedSchemas(document);

    expect(componentSection(document, 'schemas')).toEqual({});
  });
});

describe('public OpenAPI repeated parameter hoisting', () => {
  it('hoists a parameter shared by operations and ignores operations without a parameter list', () => {
    const cursor = { name: 'cursor', in: 'query', schema: { type: 'string' } };
    const document: JsonObject = {
      paths: {
        '/v1/a': { get: { parameters: [structuredClone(cursor)] } },
        '/v1/b': { get: { parameters: [structuredClone(cursor)] } },
        '/v1/c': { get: { parameters: 'not-a-list' } },
      },
    };

    hoistRepeatedParameters(document);

    const parameters = componentSection(document, 'parameters');
    const [name] = Object.keys(parameters);
    expect(Object.keys(parameters)).toHaveLength(1);
    expect(parameters[name ?? '']).toEqual(cursor);
    expect(operationAt(document, '/v1/a', 'get')['parameters']).toEqual([
      { $ref: `#/components/parameters/${name ?? ''}` },
    ]);
    expect(operationAt(document, '/v1/c', 'get')['parameters']).toBe('not-a-list');
  });
});

describe('public OpenAPI shared path parameters', () => {
  const widgetId = { name: 'widgetId', in: 'path', required: true };

  it('skips path items that are not objects', () => {
    const document: JsonObject = { paths: { '/v1/broken': 'nope' } };

    moveSharedPathParameters(document);

    expect(document['paths']).toEqual({ '/v1/broken': 'nope' });
  });

  it('keeps parameters on the operations when the first operation declares none', () => {
    const document: JsonObject = {
      paths: {
        '/v1/widgets/{widgetId}': {
          get: {},
          delete: { parameters: [widgetId] },
        },
      },
    };

    moveSharedPathParameters(document);

    const item = (document['paths'] as JsonObject)['/v1/widgets/{widgetId}'] as JsonObject;
    expect(item).not.toHaveProperty('parameters');
    expect((item['delete'] as JsonObject)['parameters']).toEqual([widgetId]);
  });

  it('keeps parameters on the operations when a later operation declares none', () => {
    const document: JsonObject = {
      paths: {
        '/v1/widgets/{widgetId}': {
          get: { parameters: [widgetId] },
          delete: {},
        },
      },
    };

    moveSharedPathParameters(document);

    const item = (document['paths'] as JsonObject)['/v1/widgets/{widgetId}'] as JsonObject;
    expect(item).not.toHaveProperty('parameters');
    expect((item['get'] as JsonObject)['parameters']).toEqual([widgetId]);
  });
});

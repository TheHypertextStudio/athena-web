import { describe, expect, it } from 'vitest';

import { addExamplesAndDescriptions } from '../../src/openapi-public-schema';
import { normalizeNarratives, type JsonObject } from '../../src/openapi-public-prose';

describe('public OpenAPI operation narratives', () => {
  it('keeps authored behavior and side effects in a legacy operation narrative', () => {
    const document: JsonObject = {
      paths: {
        '/v1/orgs/{orgId}/widgets': {
          post: {
            operationId: 'postWidget',
            summary: 'Create a widget',
            description:
              'Creates the widget immediately and queues search indexing. Repeating the request without an idempotency key can create another widget.',
            parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }],
            security: [{ sessionCookie: [] }],
            responses: {
              '201': { description: 'Docket created the widget.' },
              '422': { description: 'The request was invalid.' },
            },
          },
        },
      },
    };

    normalizeNarratives(document);

    const paths = document['paths'] as JsonObject;
    const path = paths['/v1/orgs/{orgId}/widgets'] as JsonObject;
    const operation = path['post'] as JsonObject;
    expect(operation['description']).toContain(
      'Creates the widget immediately and queues search indexing.',
    );
    expect(operation['description']).toContain(
      'Repeating the request without an idempotency key can create another widget.',
    );
    expect(operation['description']).toContain('Supply the path parameters documented below.');
    expect(operation['description']).toContain('## Related operations\n\nNone.');
  });

  it('describes multiple parameter locations as natural prose', () => {
    const document: JsonObject = {
      paths: {
        '/v1/orgs/{orgId}/widgets': {
          get: {
            operationId: 'listWidgets',
            summary: 'List widgets',
            parameters: [
              { name: 'orgId', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'cursor', in: 'query', schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'Docket returned the widgets.' } },
          },
        },
      },
    };

    normalizeNarratives(document);

    const paths = document['paths'] as JsonObject;
    const path = paths['/v1/orgs/{orgId}/widgets'] as JsonObject;
    const operation = path['get'] as JsonObject;
    expect(operation['description']).toContain(
      'Supply the path and query parameters documented below.',
    );
  });

  it('uses reader-facing request body and common query parameter descriptions', () => {
    const document: JsonObject = {
      paths: {
        '/v1/widgets': {
          post: {
            operationId: 'createWidget',
            summary: 'Create a widget',
            parameters: [
              { name: 'query', in: 'query', schema: { type: 'string' } },
              { name: 'from', in: 'query', schema: { type: 'string' } },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['name'],
                    properties: { name: { type: 'string' } },
                  },
                },
              },
            },
            responses: { '201': { description: 'Docket created the widget.' } },
          },
        },
      },
      components: { schemas: {} },
    };

    addExamplesAndDescriptions(document);

    const paths = document['paths'] as JsonObject;
    const path = paths['/v1/widgets'] as JsonObject;
    const operation = path['post'] as JsonObject;
    const body = operation['requestBody'] as JsonObject;
    const parameters = operation['parameters'] as JsonObject[];
    expect(body['description']).toBe(
      'Fields used to create a widget. Required fields and constraints appear in the schema below.',
    );
    expect(parameters[0]?.['description']).toBe('Text used to search or filter the result.');
    expect(parameters[1]?.['description']).toBe(
      'Earliest date or instant to include, using the format documented below.',
    );
  });
});

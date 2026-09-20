import { describe, expect, it } from 'vitest';

import { addExamplesAndDescriptions, exampleForSchema } from '../../src/openapi-public-schema';
import type { JsonObject } from '../../src/openapi-public-prose';

const components: JsonObject = { schemas: {} };

describe('public OpenAPI examples', () => {
  it('generates valid, distinct examples for constrained identifiers', () => {
    const schema = {
      type: 'array',
      minItems: 2,
      uniqueItems: true,
      items: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$' },
    };

    const example = exampleForSchema(schema, components);

    expect(example).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FAV', '01ARZ3NDEKTSV4RRFFQ69G5FAW']);
  });

  it('uses readable bounded numbers instead of safe-integer sentinels', () => {
    expect(
      exampleForSchema(
        { type: 'integer', minimum: -9_007_199_254_740_991, maximum: 9_007_199_254_740_991 },
        components,
      ),
    ).toBe(0);
    expect(exampleForSchema({ type: 'integer', minimum: 5, maximum: 20 }, components)).toBe(5);
  });

  it('represents multipart file parts as binary strings', () => {
    const document: JsonObject = {
      paths: {
        '/v1/files': {
          post: {
            summary: 'Upload a file',
            requestBody: {
              required: true,
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    required: ['file'],
                    properties: { file: {} },
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
      components,
    };

    addExamplesAndDescriptions(document);

    const paths = document['paths'] as JsonObject;
    const route = paths['/v1/files'] as JsonObject;
    const operation = route['post'] as JsonObject;
    const requestBody = operation['requestBody'] as JsonObject;
    const content = requestBody['content'] as JsonObject;
    const media = content['multipart/form-data'] as JsonObject;
    const schema = media['schema'] as JsonObject;
    const properties = schema['properties'] as JsonObject;
    expect(properties['file']).toEqual({
      type: 'string',
      format: 'binary',
      description: 'File bytes sent as a multipart form part.',
    });
    expect(media['example']).toEqual({ file: 'example.txt' });
  });
});

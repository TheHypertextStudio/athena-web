import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { describe, expect, it } from 'vitest';

import type { AdminInstance, AppInstance } from '../../src/app';
import { API_REVISION, API_VERSION } from '../../src/api-version';
import { openapiDocument } from '../../src/openapi';
import { API_IDENTITY_COMPONENTS, normalizePublicApiIdentity } from '../../src/openapi-identity';

async function document(surface: 'v1' | 'admin' = 'v1') {
  const app = new Hono().get(
    '/v1/example',
    describeRoute({
      responses: {
        200: { description: 'JSON' },
        204: { description: 'No content' },
        304: { description: 'Cached' },
      },
    }),
    (c) => c.json({ ok: true }),
  );
  return (await openapiDocument(
    app as unknown as AppInstance,
    app as unknown as AdminInstance,
    surface,
  )) as {
    info: { version: string };
    'x-docket-version'?: string;
    'x-docket-revision': string;
    externalDocs: { url: string };
    components: {
      parameters: Record<string, unknown>;
      headers: Record<string, unknown>;
      schemas: Record<string, unknown>;
      responses: Record<string, unknown>;
    };
    paths: Record<
      string,
      Record<
        string,
        {
          parameters: unknown[];
          responses: Record<
            string,
            {
              $ref?: string;
              headers: Record<string, unknown>;
            }
          >;
        }
      >
    >;
  };
}

describe('reference contract identity', () => {
  it.each(['inline', 'reference'] as const)(
    'preserves an existing %s 400 while documenting version rejection',
    (kind) => {
      const existing = {
        description: 'The operation rejected its input.',
        headers: { 'Retry-After': { schema: { type: 'integer' as const } } },
        content: {
          'application/problem+json': {
            schema: { type: 'object' as const, properties: { code: { const: 'invalid_request' } } },
          },
          'application/json': { schema: { type: 'string' as const } },
        },
      };
      const spec = normalizePublicApiIdentity({
        openapi: '3.1.0',
        tags: [],
        info: { title: 'Fixture', description: 'Version rejection fixture.', version: API_VERSION },
        paths: {
          '/v1/example': {
            get: {
              responses: {
                '400':
                  kind === 'inline' ? existing : { $ref: '#/components/responses/InputProblem' },
              },
            },
          },
        },
        components: {
          ...API_IDENTITY_COMPONENTS,
          responses: { ...API_IDENTITY_COMPONENTS.responses, InputProblem: existing },
        },
      });
      expect(spec.paths['/v1/example']?.get?.responses['400']).toMatchObject({
        headers: {
          'Retry-After': existing.headers['Retry-After'],
          'Docket-Version': { $ref: '#/components/headers/DocketVersion' },
        },
        content: {
          'application/json': existing.content['application/json'],
          'application/problem+json': {
            schema: {
              anyOf: [
                existing.content['application/problem+json'].schema,
                { $ref: '#/components/schemas/UnsupportedApiVersionProblem' },
              ],
            },
          },
        },
      });
    },
  );

  it('publishes the compatibility assertion and identity on every documented outcome', async () => {
    const spec = await document();
    expect(spec.info.version).toBe(API_VERSION);
    expect(spec['x-docket-version']).toBe(API_VERSION);
    expect(spec['x-docket-revision']).toBe(API_REVISION);
    expect(spec.externalDocs.url).toBe('https://docket.localhost/docs/developers/api-versions');
    expect(spec.components.parameters['DocketVersion']).toMatchObject({
      name: 'Docket-Version',
      in: 'header',
      required: false,
      schema: { const: API_VERSION, default: API_VERSION },
    });
    expect(spec.components.schemas['UnsupportedApiVersionProblem']).toBeDefined();
    expect(spec.components.responses['UnsupportedApiVersionProblem']).toBeDefined();
    for (const path of Object.values(spec.paths))
      for (const operation of Object.values(path)) {
        expect(operation.parameters).toContainEqual({
          $ref: '#/components/parameters/DocketVersion',
        });
        for (const response of Object.values(operation.responses)) {
          if (response.$ref) {
            expect(spec.components.responses[response.$ref.split('/').at(-1) ?? '']).toMatchObject({
              headers: { 'Docket-Version': { $ref: '#/components/headers/DocketVersion' } },
            });
            continue;
          }
          expect(response.headers).toMatchObject({
            'Docket-Version': { $ref: '#/components/headers/DocketVersion' },
            'Docket-Revision': { $ref: '#/components/headers/DocketRevision' },
          });
        }
      }
  });

  it('does not claim public compatibility for staff operations', async () => {
    const spec = await document('admin');
    expect(spec.info.version).toBe(`internal-${API_REVISION.slice(0, 7)}`);
    expect(spec['x-docket-revision']).toBe(API_REVISION);
    expect(spec['x-docket-version']).toBeUndefined();
  });
});

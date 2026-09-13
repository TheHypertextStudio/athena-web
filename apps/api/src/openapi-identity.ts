import type { generateSpecs } from 'hono-openapi';
import { z } from 'zod';

import { API_REVISION, API_VERSION, API_VERSION_HEADER } from './api-version';
import { Problem } from './contracts/errors';

type Document = Awaited<ReturnType<typeof generateSpecs>>;
type Schema = NonNullable<NonNullable<Document['components']>['schemas']>[string];
type Responses = NonNullable<Document['components']['responses']>;
type OperationResponse = NonNullable<Document['paths'][string]['get']>['responses'][string];

/** The version assertion Problem, including the received value and accepted contracts. */
export const UnsupportedApiVersionProblem = Problem.extend({
  code: z.literal('unsupported_api_version'),
  status: z.literal(400),
  requestedVersion: z.string(),
  supportedVersions: z.array(z.literal(API_VERSION)),
});

const identityHeaders = {
  'Docket-Version': { $ref: '#/components/headers/DocketVersion' },
  'Docket-Revision': { $ref: '#/components/headers/DocketRevision' },
};

/** Reusable compatibility request, response identity, and version rejection definitions. */
export const API_IDENTITY_COMPONENTS = {
  parameters: {
    DocketVersion: {
      name: API_VERSION_HEADER,
      in: 'header' as const,
      required: false,
      description:
        'An exact assertion of the current contract. Omit to use the current contract. This does not select a historical implementation.',
      schema: { type: 'string' as const, const: API_VERSION, default: API_VERSION },
    },
  },
  headers: {
    DocketVersion: {
      description: 'The public compatibility contract.',
      schema: { type: 'string' as const, const: API_VERSION },
    },
    DocketRevision: {
      description: 'The full Git SHA of the deployed artifact; local source execution uses dev.',
      schema: { type: 'string' as const, examples: [API_REVISION] },
    },
  },
  schemas: {
    // Zod emits JSON Schema with a broader type declaration than OpenAPI 3.1 accepts.
    UnsupportedApiVersionProblem: z.toJSONSchema(UnsupportedApiVersionProblem) as Schema,
  },
  responses: {
    UnsupportedApiVersionProblem: {
      description: 'The requested API version is not supported.',
      headers: identityHeaders,
      content: {
        'application/problem+json': {
          schema: { $ref: '#/components/schemas/UnsupportedApiVersionProblem' },
        },
      },
    },
  },
};

const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

function addResponseIdentity(responses: Responses): void {
  for (const response of Object.values(responses)) {
    if ('$ref' in response) continue;
    response.headers = { ...response.headers, ...identityHeaders };
  }
}

function resolveResponse(response: Responses[string], components: Responses) {
  const seen = new Set<string>();
  while ('$ref' in response) {
    const ref = response.$ref;
    const name = ref
      .slice('#/components/responses/'.length)
      .replaceAll('~1', '/')
      .replaceAll('~0', '~');
    const resolved = components[name];
    if (!ref.startsWith('#/components/responses/') || seen.has(ref) || !resolved) {
      throw new Error(`Cannot add API version rejection to unresolved response ${ref}`);
    }
    seen.add(ref);
    response = resolved;
  }
  return response;
}

function addVersionRejection(
  response: Responses[string] | undefined,
  components: Responses,
): OperationResponse {
  const versionResponse = { $ref: '#/components/responses/UnsupportedApiVersionProblem' };
  if (!response || ('$ref' in response && response.$ref === versionResponse.$ref))
    return versionResponse;
  const existing = resolveResponse(response, components);
  const problemMedia = existing.content?.['application/problem+json'];
  const versionSchema = { $ref: '#/components/schemas/UnsupportedApiVersionProblem' };
  // Generic Problems can already accept the version code, so oneOf would reject overlapping
  // variants. anyOf documents both outcomes without narrowing an existing response contract.
  return {
    ...existing,
    description: `${existing.description} The requested API version may also be unsupported.`,
    content: {
      ...existing.content,
      'application/problem+json': {
        ...problemMedia,
        schema: problemMedia
          ? { anyOf: [problemMedia.schema ?? {}, versionSchema] }
          : versionSchema,
      },
    },
  } as OperationResponse;
}

/**
 * Attach the outer runtime boundary to all documented public operations and responses.
 * @throws When an existing 400 response references a missing, cyclic, or external component.
 */
export function normalizePublicApiIdentity(document: Document): Document {
  for (const path of Object.values(document.paths)) {
    for (const method of methods) {
      const operation = path[method];
      if (!operation) continue;
      operation.parameters = [
        ...(operation.parameters ?? []),
        { $ref: '#/components/parameters/DocketVersion' },
      ];
      operation.responses['400'] = addVersionRejection(
        operation.responses['400'],
        document.components.responses ?? {},
      );
      addResponseIdentity(operation.responses);
    }
  }
  addResponseIdentity(document.components.responses ?? {});
  return document;
}

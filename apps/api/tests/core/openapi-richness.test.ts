import { brotliCompressSync, constants } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { PUBLIC_TAG_GROUPS, PUBLIC_TAGS } from '../../src/lib/public-api-tags';

type JsonObject = Record<string, unknown>;

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch']);
const REQUIRED_SECTIONS = [
  'Purpose',
  'Inputs and constraints',
  'Result and side effects',
  'Access and permissions',
  'Failures and recovery',
  'Related operations',
] as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function publicDocument(): Promise<JsonObject> {
  const { openapiDocument } = await import('../../src/openapi');
  const { app, adminApp } = await import('../../src/app');
  return (await openapiDocument(app, adminApp)) as JsonObject;
}

function publicOperations(document: JsonObject): readonly JsonObject[] {
  const paths = isObject(document['paths']) ? document['paths'] : {};
  return Object.values(paths).flatMap((item) => {
    if (!isObject(item)) return [];
    return Object.entries(item).flatMap(([method, operation]) =>
      HTTP_METHODS.has(method) && isObject(operation) ? [operation] : [],
    );
  });
}

function componentSchemas(document: JsonObject): JsonObject {
  const components = isObject(document['components']) ? document['components'] : {};
  return isObject(components['schemas']) ? components['schemas'] : {};
}

function dereferenceSchema(schema: unknown, document: JsonObject): JsonObject | undefined {
  if (!isObject(schema)) return undefined;
  const reference = schema['$ref'];
  if (typeof reference !== 'string' || !reference.startsWith('#/components/schemas/'))
    return schema;
  const name = reference.slice('#/components/schemas/'.length);
  const resolved = componentSchemas(document)[name];
  return isObject(resolved) ? resolved : undefined;
}

function mediaHasExample(media: JsonObject, document: JsonObject): boolean {
  if ('example' in media || 'examples' in media) return true;
  const schema = dereferenceSchema(media['schema'], document);
  return Boolean(schema && ('example' in schema || 'examples' in schema));
}

function hasDescription(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function collectMissingPropertyDescriptions(
  schema: unknown,
  document: JsonObject,
  location: string,
  missing: string[],
  seen: Set<JsonObject>,
): void {
  const resolved = dereferenceSchema(schema, document);
  if (!resolved || seen.has(resolved)) return;
  seen.add(resolved);
  const properties = isObject(resolved['properties']) ? resolved['properties'] : {};
  for (const [name, property] of Object.entries(properties)) {
    const child = dereferenceSchema(property, document);
    if (!child) continue;
    const directDescription = isObject(property) ? property['description'] : undefined;
    const resolvedDescription = child['description'];
    if (!hasDescription(directDescription) && !hasDescription(resolvedDescription)) {
      missing.push(`${location}.${name}`);
    }
    collectMissingPropertyDescriptions(child, document, `${location}.${name}`, missing, seen);
  }
  collectMissingPropertyDescriptions(resolved['items'], document, `${location}[]`, missing, seen);
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    const variants = Array.isArray(resolved[keyword]) ? resolved[keyword] : [];
    variants.forEach((variant, index) => {
      collectMissingPropertyDescriptions(
        variant,
        document,
        `${location}.${keyword}[${String(index)}]`,
        missing,
        seen,
      );
    });
  }
}

interface CompletenessAudit {
  readonly descriptions: string[];
  readonly examples: string[];
}

function auditMedia(
  content: unknown,
  document: JsonObject,
  location: string,
  audit: CompletenessAudit,
  requireExamples: boolean,
): void {
  if (!isObject(content)) return;
  for (const [mediaType, media] of Object.entries(content)) {
    if (!isObject(media)) continue;
    collectMissingPropertyDescriptions(
      media['schema'],
      document,
      `${location}.${mediaType}`,
      audit.descriptions,
      new Set(),
    );
    if (requireExamples && mediaType.includes('json') && !mediaHasExample(media, document)) {
      audit.examples.push(`${location}.${mediaType}`);
    }
  }
}

function auditParameters(
  operation: JsonObject,
  document: JsonObject,
  operationId: string,
  audit: CompletenessAudit,
): void {
  const parameters = Array.isArray(operation['parameters']) ? operation['parameters'] : [];
  for (const parameter of parameters) {
    if (!isObject(parameter) || '$ref' in parameter) continue;
    const name = typeof parameter['name'] === 'string' ? parameter['name'] : 'value';
    const location = `${operationId}.parameter.${name}`;
    if (!hasDescription(parameter['description'])) audit.descriptions.push(location);
    collectMissingPropertyDescriptions(
      parameter['schema'],
      document,
      location,
      audit.descriptions,
      new Set(),
    );
  }
}

function auditRequestBody(
  operation: JsonObject,
  document: JsonObject,
  operationId: string,
  audit: CompletenessAudit,
): void {
  const body = isObject(operation['requestBody']) ? operation['requestBody'] : undefined;
  if (!body) return;
  if (!hasDescription(body['description'])) audit.descriptions.push(`${operationId}.requestBody`);
  auditMedia(body['content'], document, `${operationId}.requestBody`, audit, true);
}

function auditResponses(
  operation: JsonObject,
  document: JsonObject,
  operationId: string,
  audit: CompletenessAudit,
): void {
  const responses = isObject(operation['responses']) ? operation['responses'] : {};
  for (const [status, response] of Object.entries(responses)) {
    if (!isObject(response) || '$ref' in response) continue;
    const location = `${operationId}.response.${status}`;
    if (!hasDescription(response['description'])) audit.descriptions.push(location);
    auditMedia(response['content'], document, location, audit, /^2\d\d$/.test(status));
  }
}

describe('public OpenAPI contract', () => {
  it('publishes one complete, grouped, plain-language operation contract', async () => {
    const document = await publicDocument();
    const operations = publicOperations(document);
    const ids = operations.map((operation) => operation['operationId']);
    expect(operations.length).toBeGreaterThan(500);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    const declaredTags = new Set<string>(PUBLIC_TAGS.map((tag) => tag.id));
    for (const operation of operations) {
      const tags = operation['tags'];
      expect(Array.isArray(tags) ? tags : []).toHaveLength(1);
      expect(declaredTags.has((tags as string[])[0] ?? '')).toBe(true);
      const description =
        typeof operation['description'] === 'string' ? operation['description'] : '';
      for (const section of REQUIRED_SECTIONS) expect(description).toContain(`## ${section}`);
      expect(description).not.toContain('Success.');
      expect(isObject(operation['responses'])).toBe(true);
      expect(Object.keys(operation['responses'] as JsonObject).length).toBeGreaterThan(1);
    }

    expect(document['x-tagGroups']).toEqual(
      PUBLIC_TAG_GROUPS.map((group) => ({ name: group.displayName, tags: [...group.tags] })),
    );
  });

  it('documents every request field, body, response, and JSON example', async () => {
    const document = await publicDocument();
    const audit: CompletenessAudit = { descriptions: [], examples: [] };
    for (const operation of publicOperations(document)) {
      const operationId =
        typeof operation['operationId'] === 'string' ? operation['operationId'] : 'operation';
      auditParameters(operation, document, operationId, audit);
      auditRequestBody(operation, document, operationId, audit);
      auditResponses(operation, document, operationId, audit);
    }
    expect(audit.descriptions).toEqual([]);
    expect(audit.examples).toEqual([]);
  });

  it('contains no source notation, stale hosts, weak success labels, or sentinel examples', async () => {
    const document = await publicDocument();
    const serialized = JSON.stringify(document);
    for (const forbidden of [
      '{@link',
      'Success.',
      'workflow_states',
      'docket.hypertext.studio',
      'docket-api.hypertext.studio',
      'Docket accepts or returns',
      'the atomic unit of work',
      'two front doors onto one system',
      'cross-org cockpit',
      '"id":""',
      '"id":0',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('stays within the compressed transfer budget', async () => {
    const document = await publicDocument();
    const compact = JSON.stringify(document);
    const brotli = brotliCompressSync(compact, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
    });
    expect(brotli.byteLength).toBeLessThanOrEqual(350 * 1024);
  });
});

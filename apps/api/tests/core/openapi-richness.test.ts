import { brotliCompressSync, constants } from 'node:zlib';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
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

let documentPromise: Promise<JsonObject> | undefined;

async function publicDocument(): Promise<JsonObject> {
  if (documentPromise) return documentPromise;
  const { openapiDocument } = await import('../../src/openapi');
  const { app, adminApp } = await import('../../src/app');
  documentPromise = openapiDocument(app, adminApp) as Promise<JsonObject>;
  return documentPromise;
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

type ExampleSlot = readonly [location: string, content: unknown];

function exampleSlots(operation: JsonObject, operationId: string): readonly ExampleSlot[] {
  const slots: ExampleSlot[] = [];
  const requestBody = isObject(operation['requestBody']) ? operation['requestBody'] : undefined;
  if (requestBody) slots.push([`${operationId}.requestBody`, requestBody['content']]);
  const responses = isObject(operation['responses']) ? operation['responses'] : {};
  for (const [status, response] of Object.entries(responses)) {
    if (/^2\d\d$/.test(status) && isObject(response)) {
      slots.push([`${operationId}.response.${status}`, response['content']]);
    }
  }
  return slots;
}

function validateContentExamples(
  validator: Ajv2020,
  components: JsonObject,
  location: string,
  content: unknown,
): readonly string[] {
  if (!isObject(content)) return [];
  const failures: string[] = [];
  for (const [mediaType, media] of Object.entries(content)) {
    if (!isObject(media) || !('example' in media) || !isObject(media['schema'])) continue;
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      components,
      ...media['schema'],
    };
    const validate = validator.compile(schema);
    if (!validate(media['example'])) {
      failures.push(
        `${location}.${mediaType}: ${validator.errorsText(validate.errors, { separator: '; ' })}`,
      );
    }
    if (JSON.stringify(media['example']).includes(String(Number.MIN_SAFE_INTEGER))) {
      failures.push(`${location}.${mediaType}: contains a sentinel integer`);
    }
  }
  return failures;
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

  it('publishes examples that satisfy their exact generated schemas', async () => {
    const document = await publicDocument();
    const components = isObject(document['components']) ? document['components'] : {};
    const validator = new Ajv2020({ strict: false, allErrors: true, logger: false });
    addFormats(validator);
    const failures = publicOperations(document).flatMap((operation) => {
      const operationId =
        typeof operation['operationId'] === 'string' ? operation['operationId'] : 'operation';
      return exampleSlots(operation, operationId).flatMap(([location, content]) =>
        validateContentExamples(validator, components, location, content),
      );
    });

    expect(failures).toEqual([]);
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

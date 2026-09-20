/** Add field descriptions and schema-valid examples to the public OpenAPI document. */
import {
  isObject,
  operations,
  sentenceCase,
  statusEntries,
  stringValue,
  words,
  type JsonObject,
} from './openapi-public-prose';

/** Build a useful fallback description for one schema property. */
export function fallbackFieldDescription(name: string, schema: JsonObject): string {
  if (name === 'id') return 'The stable identifier for this resource.';
  if (name.endsWith('Id')) return `Identifies the referenced ${words(name.slice(0, -2))}.`;
  if (name === 'createdAt') return 'The record creation time as an ISO 8601 instant.';
  if (name === 'updatedAt') return 'The last change time as an ISO 8601 instant.';
  if (name.endsWith('At'))
    return `${sentenceCase(words(name.slice(0, -2)))} time as an ISO 8601 instant.`;
  if (name.endsWith('Date'))
    return `${sentenceCase(words(name.slice(0, -4)))} date in YYYY-MM-DD format.`;
  if (/^(is|has|can|should)[A-Z]/.test(name))
    return `Whether ${words(name).replace(/^(is|has|can|should)\s+/, '')}.`;
  if (name.endsWith('Count')) return `${sentenceCase(words(name.slice(0, -5)))} count.`;
  const common: Readonly<Record<string, string>> = {
    kind: 'Selects the value variant.',
    type: 'Selects the value type.',
    field: 'Field the rule evaluates.',
    operator: 'Comparison applied by the rule.',
    operand: 'Value used by the comparison.',
    status: 'Current lifecycle state.',
    state: 'Current lifecycle state.',
    name: 'Human-readable name.',
    title: 'Human-readable title.',
    summary: 'Short plain-language summary.',
    description: 'Longer plain-language description.',
    url: 'Absolute URL for this resource.',
    href: 'URL a client can open.',
    path: 'Canonical path for this resource.',
    cursor: 'Opaque pagination cursor.',
    nextCursor: 'Cursor for the next page. Omitted at the end.',
    position: 'Stable position in the current ordering.',
    enabled: 'Whether this behavior is enabled.',
    metadata: 'Structured metadata supplied with the record.',
    version: 'Schema or contract version for this value.',
    key: 'Stable machine-readable key.',
    value: 'Stored or returned value.',
  };
  if (common[name]) return common[name];
  if (schema['type'] === 'array') return `${sentenceCase(words(name))}, in order.`;
  if (Array.isArray(schema['enum'])) return `Allowed ${words(name)} value.`;
  return `${sentenceCase(words(name))} for this record.`;
}

/** Build a useful fallback description for one operation parameter. */
export function fallbackParameterDescription(name: string, location: string): string {
  if (name === 'orgId')
    return 'Organization identifier from the URL. It must name a workspace the caller can access.';
  if (name === 'cursor')
    return 'Opaque cursor from the previous page. Reuse it with the same filters and ordering.';
  if (name === 'limit')
    return 'Maximum number of items to return. The default is 50 and maximum is 100.';
  if (name.endsWith('Id'))
    return `Identifier of the ${words(name.slice(0, -2))} selected by this ${location} parameter.`;
  return `${sentenceCase(words(name))} supplied in the ${location}.`;
}

function describeProperties(value: JsonObject): void {
  const properties = isObject(value['properties']) ? value['properties'] : {};
  for (const [propertyName, schema] of Object.entries(properties)) {
    if (!isObject(schema)) continue;
    if (!stringValue(schema['description']).trim()) {
      schema['description'] = fallbackFieldDescription(propertyName, schema);
    }
    ensureDescriptions(schema, propertyName);
  }
}

function describeVariants(value: JsonObject, name: string): void {
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const variants = Array.isArray(value[keyword]) ? value[keyword] : [];
    variants.forEach((item) => {
      ensureDescriptions(item, name);
    });
  }
}

/** Fill missing property descriptions throughout a schema tree. */
export function ensureDescriptions(value: unknown, name = 'value'): void {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      ensureDescriptions(item, name);
    });
    return;
  }
  if (!isObject(value)) return;
  describeProperties(value);
  if (isObject(value['items'])) ensureDescriptions(value['items'], name);
  describeVariants(value, name);
}

function objectExample(schema: JsonObject, components: JsonObject, depth: number): JsonObject {
  const required = new Set(
    Array.isArray(schema['required'])
      ? schema['required'].filter((item): item is string => typeof item === 'string')
      : [],
  );
  const properties = isObject(schema['properties']) ? schema['properties'] : {};
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, child]) => {
      if (!required.has(key)) return [];
      const value = exampleForSchema(child, components, depth + 1);
      return value === undefined ? [] : [[key, value]];
    }),
  );
}

function stringExample(format: unknown): string {
  const examples: Readonly<Record<string, string>> = {
    'date-time': '2026-09-19T12:00:00.000Z',
    date: '2026-09-19',
    uri: 'https://api.clearthedocket.com/v1/example',
    email: 'developer@example.com',
  };
  return typeof format === 'string' && examples[format] ? examples[format] : 'example';
}

function compositeExample(schema: JsonObject, components: JsonObject, depth: number): unknown {
  for (const keyword of ['oneOf', 'anyOf'] as const) {
    const variants = Array.isArray(schema[keyword]) ? schema[keyword] : [];
    if (variants.length > 0) return exampleForSchema(variants[0], components, depth + 1);
  }
  if (!Array.isArray(schema['allOf'])) return undefined;
  return Object.assign(
    {},
    ...schema['allOf']
      .map((item) => exampleForSchema(item, components, depth + 1))
      .filter(isObject),
  );
}

interface ExampleMatch {
  readonly matched: boolean;
  readonly value?: unknown;
}

function directExample(schema: JsonObject): ExampleMatch {
  if ('const' in schema) return { matched: true, value: schema['const'] };
  if (Array.isArray(schema['enum'])) return { matched: true, value: schema['enum'][0] };
  if ('default' in schema) return { matched: true, value: schema['default'] };
  return { matched: false };
}

function referencedExample(
  schema: JsonObject,
  components: JsonObject,
  depth: number,
): ExampleMatch {
  const reference = stringValue(schema['$ref']);
  if (!reference) return { matched: false };
  const name = reference.split('/').at(-1);
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  return {
    matched: true,
    value: name ? exampleForSchema(schemas[name], components, depth + 1) : undefined,
  };
}

function typedExample(schema: JsonObject, components: JsonObject, depth: number): unknown {
  if (schema['type'] === 'object' || isObject(schema['properties'])) {
    return objectExample(schema, components, depth);
  }
  if (schema['type'] === 'array') {
    const item = exampleForSchema(schema['items'], components, depth + 1);
    return item === undefined ? [] : [item];
  }
  if (schema['type'] === 'integer' || schema['type'] === 'number') {
    return typeof schema['minimum'] === 'number' ? schema['minimum'] : 0;
  }
  if (schema['type'] === 'boolean') return false;
  return schema['type'] === 'string' ? stringExample(schema['format']) : undefined;
}

/** Generate a deterministic minimal example from a JSON Schema. */
export function exampleForSchema(schema: unknown, components: JsonObject, depth = 0): unknown {
  if (!isObject(schema) || depth > 8) return undefined;
  const referenced = referencedExample(schema, components, depth);
  if (referenced.matched) return referenced.value;
  const direct = directExample(schema);
  if (direct.matched) return direct.value;
  const composite = compositeExample(schema, components, depth);
  if (composite !== undefined) return composite;
  return typedExample(schema, components, depth);
}

function decorateMedia(content: unknown, components: JsonObject, addExample: boolean): void {
  if (!isObject(content)) return;
  for (const media of Object.values(content)) {
    if (!isObject(media)) continue;
    ensureDescriptions(media['schema']);
    if (!addExample || !isObject(media['schema']) || 'example' in media || 'examples' in media)
      continue;
    const value = exampleForSchema(media['schema'], components);
    if (value !== undefined) media['example'] = value;
  }
}

function decorateParameters(operation: JsonObject): void {
  const parameters = Array.isArray(operation['parameters']) ? operation['parameters'] : [];
  for (const parameter of parameters) {
    if (!isObject(parameter) || '$ref' in parameter) continue;
    const name = stringValue(parameter['name'], 'value');
    if (!stringValue(parameter['description']).trim()) {
      parameter['description'] = fallbackParameterDescription(
        name,
        stringValue(parameter['in'], 'request'),
      );
    }
    ensureDescriptions(parameter['schema'], name);
  }
}

function decorateOperation(operation: JsonObject, components: JsonObject): void {
  decorateParameters(operation);
  const body = isObject(operation['requestBody']) ? operation['requestBody'] : undefined;
  if (body) {
    if (!stringValue(body['description']).trim()) {
      body['description'] = `Input for ${stringValue(operation['summary'], 'this operation')}.`;
    }
    decorateMedia(body['content'], components, true);
  }
  for (const [status, response] of statusEntries(operation)) {
    decorateMedia(response['content'], components, /^2\d\d$/.test(status));
  }
}

/** Add missing descriptions and deterministic examples to public operations. */
export function addExamplesAndDescriptions(document: JsonObject): void {
  const components = isObject(document['components']) ? document['components'] : {};
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  Object.values(schemas).forEach((schema) => {
    ensureDescriptions(schema);
  });
  for (const { operation } of operations(document)) decorateOperation(operation, components);
}

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
  if (name === 'query') return 'Text used to search or filter the result.';
  if (name === 'from')
    return 'Earliest date or instant to include, using the format documented below.';
  if (name === 'to') return 'Latest date or instant to include, using the format documented below.';
  if (name === 'date') return 'Civil date in YYYY-MM-DD format.';
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

function objectExample(
  schema: JsonObject,
  components: JsonObject,
  depth: number,
  variant: number,
): JsonObject {
  const required = new Set(
    Array.isArray(schema['required'])
      ? schema['required'].filter((item): item is string => typeof item === 'string')
      : [],
  );
  const properties = isObject(schema['properties']) ? schema['properties'] : {};
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, child]) => {
      if (!required.has(key)) return [];
      const value = exampleForSchema(child, components, depth + 1, variant, key);
      return value === undefined ? [] : [[key, value]];
    }),
  );
}

const EXAMPLE_ULIDS = ['01ARZ3NDEKTSV4RRFFQ69G5FAV', '01ARZ3NDEKTSV4RRFFQ69G5FAW'] as const;

function constrainedStringExample(schema: JsonObject, variant: number): string | undefined {
  const pattern = typeof schema['pattern'] === 'string' ? schema['pattern'] : undefined;
  if (!pattern) return undefined;
  const ulid = EXAMPLE_ULIDS[variant % EXAMPLE_ULIDS.length] ?? EXAMPLE_ULIDS[0];
  const candidates = [
    ulid,
    '2026-09-19',
    '2026-09-19T12:00:00.000Z',
    'example-slug',
    'developer@example.com',
    `builtin:task:${ulid}`,
    `saved:${ulid}`,
    'example.value',
    '#336699',
    '09:30',
    'field_name',
    '12-3456789',
    '+12025550123',
    '123456',
    'data:image/png;base64,AAAA',
    'example_key',
    'A1-B2',
    'sha256:0123456789abcdef',
    'migration',
  ];
  const expression = new RegExp(pattern);
  const minimum = typeof schema['minLength'] === 'number' ? schema['minLength'] : 0;
  const maximum = typeof schema['maxLength'] === 'number' ? schema['maxLength'] : Infinity;
  return candidates.find(
    (candidate) =>
      candidate.length >= minimum && candidate.length <= maximum && expression.test(candidate),
  );
}

const STRING_EXAMPLES: Readonly<Record<string, string>> = {
  'date-time': '2026-09-19T12:00:00.000Z',
  date: '2026-09-19',
  uri: 'https://api.clearthedocket.com/v1/example',
  email: 'developer@example.com',
  binary: 'example.txt',
};

function semanticStringExample(schema: JsonObject, propertyName: string): string | undefined {
  const format = schema['format'];
  if (typeof format === 'string' && STRING_EXAMPLES[format]) return STRING_EXAMPLES[format];
  const description = stringValue(schema['description']).toLowerCase();
  if (description.includes('yyyy-mm-dd')) return STRING_EXAMPLES['date'];
  if (description.includes('iso 8601 instant') || description.includes('iso-8601 instant')) {
    return STRING_EXAMPLES['date-time'];
  }
  if (description.includes('email address')) return STRING_EXAMPLES['email'];
  if (description.includes('absolute url')) return STRING_EXAMPLES['uri'];
  if (propertyName.endsWith('At')) return STRING_EXAMPLES['date-time'];
  if (propertyName.endsWith('Date')) return STRING_EXAMPLES['date'];
  if (propertyName.toLowerCase().includes('email')) return STRING_EXAMPLES['email'];
  return undefined;
}

function boundedStringExample(schema: JsonObject): string {
  const minimum = typeof schema['minLength'] === 'number' ? schema['minLength'] : 1;
  const maximum = typeof schema['maxLength'] === 'number' ? schema['maxLength'] : Infinity;
  const preferred = 'example';
  if (preferred.length >= minimum && preferred.length <= maximum) return preferred;
  const length = Math.max(1, Math.min(Math.max(minimum, 1), maximum));
  return 'x'.repeat(length);
}

function stringExample(schema: JsonObject, variant: number, propertyName: string): string {
  const constrained = constrainedStringExample(schema, variant);
  if (constrained) return constrained;
  if (typeof schema['pattern'] === 'string') {
    throw new Error(`No deterministic public example satisfies pattern ${schema['pattern']}`);
  }
  return semanticStringExample(schema, propertyName) ?? boundedStringExample(schema);
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function mergeRequired(left: unknown, right: unknown): string[] | undefined {
  const values = [...stringArray(left), ...stringArray(right)];
  return values.length > 0 ? [...new Set(values)] : undefined;
}

function mergeSchemaObjects(left: JsonObject, right: JsonObject): JsonObject {
  const merged: JsonObject = { ...left, ...right };
  const required = mergeRequired(left['required'], right['required']);
  if (required) merged['required'] = required;
  const leftProperties = isObject(left['properties']) ? left['properties'] : {};
  const rightProperties = isObject(right['properties']) ? right['properties'] : {};
  if (Object.keys(leftProperties).length > 0 || Object.keys(rightProperties).length > 0) {
    merged['properties'] = { ...leftProperties, ...rightProperties };
  }
  return merged;
}

function resolveSchemaForMerge(schema: JsonObject, components: JsonObject): JsonObject {
  const reference = stringValue(schema['$ref']);
  if (!reference) return schema;
  const name = reference.split('/').at(-1);
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  const resolved = name && isObject(schemas[name]) ? schemas[name] : {};
  const siblings = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref'));
  return mergeSchemaObjects(resolved, siblings);
}

function mergedAllOf(schema: JsonObject, components: JsonObject): JsonObject {
  const base = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'allOf'));
  const variants = Array.isArray(schema['allOf']) ? schema['allOf'].filter(isObject) : [];
  return variants.reduce(
    (merged, item) => mergeSchemaObjects(merged, resolveSchemaForMerge(item, components)),
    base,
  );
}

function compositeExample(
  schema: JsonObject,
  components: JsonObject,
  depth: number,
  variant: number,
  propertyName: string,
): unknown {
  for (const keyword of ['oneOf', 'anyOf'] as const) {
    const variants = Array.isArray(schema[keyword]) ? schema[keyword] : [];
    if (variants.length > 0)
      return exampleForSchema(variants[0], components, depth + 1, variant, propertyName);
  }
  if (!Array.isArray(schema['allOf'])) return undefined;
  const merged = mergedAllOf(schema, components);
  return exampleForSchema(merged, components, depth + 1, variant, propertyName);
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
  variant: number,
  propertyName: string,
): ExampleMatch {
  const reference = stringValue(schema['$ref']);
  if (!reference) return { matched: false };
  const name = reference.split('/').at(-1);
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  return {
    matched: true,
    value: name
      ? exampleForSchema(schemas[name], components, depth + 1, variant, propertyName)
      : undefined,
  };
}

function numericExample(schema: JsonObject): number {
  const integer = schema['type'] === 'integer';
  const minimum = typeof schema['minimum'] === 'number' ? schema['minimum'] : -Infinity;
  const maximum = typeof schema['maximum'] === 'number' ? schema['maximum'] : Infinity;
  const exclusiveMinimum =
    typeof schema['exclusiveMinimum'] === 'number' ? schema['exclusiveMinimum'] : -Infinity;
  const exclusiveMaximum =
    typeof schema['exclusiveMaximum'] === 'number' ? schema['exclusiveMaximum'] : Infinity;
  let value = Math.max(0, minimum, integer ? exclusiveMinimum + 1 : exclusiveMinimum + 0.1);
  value = Math.min(value, maximum, integer ? exclusiveMaximum - 1 : exclusiveMaximum - 0.1);
  return integer ? Math.trunc(value) : value;
}

function typedExample(
  schema: JsonObject,
  components: JsonObject,
  depth: number,
  variant: number,
  propertyName: string,
): unknown {
  if (schema['type'] === 'object' || isObject(schema['properties'])) {
    return objectExample(schema, components, depth, variant);
  }
  if (schema['type'] === 'array') {
    const minimum = typeof schema['minItems'] === 'number' ? schema['minItems'] : 1;
    const maximum = typeof schema['maxItems'] === 'number' ? schema['maxItems'] : Infinity;
    const count = Math.min(Math.max(minimum, 1), maximum);
    return Array.from({ length: count }, (_unused, index) =>
      exampleForSchema(schema['items'], components, depth + 1, variant + index),
    ).filter((item) => item !== undefined);
  }
  if (schema['type'] === 'integer' || schema['type'] === 'number') {
    return numericExample(schema);
  }
  if (schema['type'] === 'boolean') return false;
  if (schema['type'] === 'null') return null;
  if (schema['type'] === 'string') return stringExample(schema, variant, propertyName);
  return Object.keys(schema).every((key) => key === 'description') ? null : undefined;
}

/** Generate a deterministic minimal example from a JSON Schema. */
export function exampleForSchema(
  schema: unknown,
  components: JsonObject,
  depth = 0,
  variant = 0,
  propertyName = '',
): unknown {
  if (!isObject(schema) || depth > 20) return undefined;
  const referenced = referencedExample(schema, components, depth, variant, propertyName);
  if (referenced.matched) return referenced.value;
  const direct = directExample(schema);
  if (direct.matched) return direct.value;
  const composite = compositeExample(schema, components, depth, variant, propertyName);
  if (composite !== undefined) return composite;
  return typedExample(schema, components, depth, variant, propertyName);
}

function normalizeMultipartFile(mediaType: string, media: JsonObject): void {
  if (mediaType !== 'multipart/form-data' || !isObject(media['schema'])) return;
  const properties = isObject(media['schema']['properties'])
    ? media['schema']['properties']
    : undefined;
  if (!properties || !isObject(properties['file'])) return;
  properties['file'] = {
    type: 'string',
    format: 'binary',
    description: 'File bytes sent as a multipart form part.',
  };
}

function addMediaExample(media: JsonObject, components: JsonObject, enabled: boolean): void {
  if (!enabled || !isObject(media['schema']) || 'examples' in media) return;
  const value = exampleForSchema(media['schema'], components);
  if (value !== undefined) media['example'] = value;
}

function decorateMedia(content: unknown, components: JsonObject, addExample: boolean): void {
  if (!isObject(content)) return;
  for (const [mediaType, media] of Object.entries(content)) {
    if (!isObject(media)) continue;
    normalizeMultipartFile(mediaType, media);
    ensureDescriptions(media['schema']);
    addMediaExample(media, components, addExample);
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
      const summary = stringValue(operation['summary'], 'complete this operation')
        .replace(/[.!?]+$/, '')
        .replace(/^./, (character) => character.toLowerCase());
      body['description'] =
        `Fields used to ${summary}. Required fields and constraints appear in the schema below.`;
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
    if (!isObject(schema)) return;
    const example = exampleForSchema(schema, components);
    if (example !== undefined) schema['example'] = example;
  });
  for (const { operation } of operations(document)) decorateOperation(operation, components);
}

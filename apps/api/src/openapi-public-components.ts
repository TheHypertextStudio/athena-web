/** Hoist generated inline schemas into stable reusable OpenAPI components. */
import {
  isObject,
  operations,
  statusEntries,
  stringValue,
  type JsonObject,
} from './openapi-public-prose';

/** Serialize JSON-like values with stable object-key ordering. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}

/** Build a safe component name from an operation and schema role. */
export function componentName(operation: JsonObject, role: string): string {
  const id = stringValue(operation['operationId'], 'Operation');
  return `${id[0]?.toUpperCase() ?? 'O'}${id.slice(1)}${role}`.replace(/[^A-Za-z0-9]/g, '');
}

interface SchemaOccurrence {
  readonly schema: JsonObject;
  readonly slots: { owner: JsonObject; key: string; name: string }[];
}

function collectContentSchemas(
  content: unknown,
  name: string,
  occurrences: Map<string, SchemaOccurrence>,
): void {
  if (!isObject(content)) return;
  for (const media of Object.values(content)) {
    if (!isObject(media) || !isObject(media['schema']) || '$ref' in media['schema']) continue;
    const key = canonical(media['schema']);
    const entry = occurrences.get(key) ?? { schema: media['schema'], slots: [] };
    entry.slots.push({ owner: media, key: 'schema', name });
    occurrences.set(key, entry);
  }
}

function installRepeatedSchema(
  entry: SchemaOccurrence,
  schemas: JsonObject,
  used: Set<string>,
): void {
  if (entry.slots.length < 2 || canonical(entry.schema).length < 256) return;
  const base = entry.slots[0]?.name ?? 'SharedSchema';
  let name = base;
  let suffix = 2;
  while (used.has(name)) name = `${base}${suffix++}`;
  used.add(name);
  schemas[name] = entry.schema;
  for (const slot of entry.slots) slot.owner[slot.key] = { $ref: `#/components/schemas/${name}` };
}

/** Replace repeated large operation schemas with reusable components. */
export function hoistRepeatedSchemas(document: JsonObject): void {
  const components = isObject(document['components']) ? document['components'] : {};
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  const occurrences = new Map<string, SchemaOccurrence>();
  for (const { operation } of operations(document)) {
    const body = isObject(operation['requestBody']) ? operation['requestBody'] : undefined;
    collectContentSchemas(body?.['content'], componentName(operation, 'Request'), occurrences);
    for (const [status, response] of statusEntries(operation))
      collectContentSchemas(
        response['content'],
        componentName(operation, `Response${status}`),
        occurrences,
      );
  }
  const used = new Set(Object.keys(schemas));
  for (const entry of occurrences.values()) installRepeatedSchema(entry, schemas, used);
  components['schemas'] = schemas;
  document['components'] = components;
}

/** One replaceable schema location in the generated document. */
export interface SchemaSlot {
  readonly schema: JsonObject;
  readonly name: string;
  readonly replace: (replacement: JsonObject) => void;
}

/** Return a deterministic short hexadecimal fingerprint. */
export function shortHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Rewrite references using the supplied exact-reference mapping. */
export function rewriteLocalDefinitionRefs(
  value: unknown,
  references: ReadonlyMap<string, string>,
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      rewriteLocalDefinitionRefs(item, references);
    });
    return;
  }
  if (!isObject(value)) return;
  if (typeof value['$ref'] === 'string') {
    const replacement = references.get(value['$ref']);
    if (replacement) value['$ref'] = replacement;
  }
  for (const child of Object.values(value)) rewriteLocalDefinitionRefs(child, references);
}

/** Sanitize a local definition name for use as an OpenAPI component key. */
export function definitionComponentName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '') || 'InlineSchema';
  return safe;
}

interface DefinitionContext {
  readonly schemas: JsonObject;
  readonly variants: Map<string, Map<string, string>>;
}

function resolveDefinitionName(
  name: string,
  definition: JsonObject,
  context: DefinitionContext,
): string {
  const base = definitionComponentName(name);
  const fingerprint = canonical(definition);
  const variants = context.variants.get(base) ?? new Map<string, string>();
  const existing = context.schemas[base];
  if (variants.size === 0 && isObject(existing)) variants.set(canonical(existing), base);
  const resolved =
    variants.get(fingerprint) ??
    (variants.size === 0 ? base : `${base}Variant${shortHash(fingerprint)}`);
  variants.set(fingerprint, resolved);
  context.variants.set(base, variants);
  return resolved;
}

function installDefinitions(
  owner: JsonObject,
  definitions: JsonObject,
  context: DefinitionContext,
): void {
  const entries = Object.entries(definitions).filter((entry): entry is [string, JsonObject] =>
    isObject(entry[1]),
  );
  const names = new Map(
    entries.map(([name, definition]) => [name, resolveDefinitionName(name, definition, context)]),
  );
  const references = new Map(
    [...names].map(([name, resolved]) => [`#/$defs/${name}`, `#/components/schemas/${resolved}`]),
  );
  rewriteLocalDefinitionRefs(owner, references);
  Reflect.deleteProperty(owner, '$defs');
  for (const [name, definition] of entries) {
    rewriteLocalDefinitionRefs(definition, references);
    const resolved = names.get(name);
    if (!resolved) continue;
    const existing = context.schemas[resolved];
    if (isObject(existing) && canonical(existing) !== canonical(definition))
      throw new Error(`Inline schema hash collision for ${resolved}`);
    context.schemas[resolved] = definition;
  }
}

function visitInlineDefinitions(value: unknown, context: DefinitionContext): void {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      visitInlineDefinitions(item, context);
    });
    return;
  }
  if (!isObject(value)) return;
  const definitions = isObject(value['$defs']) ? value['$defs'] : undefined;
  if (definitions) {
    for (const definition of Object.values(definitions))
      visitInlineDefinitions(definition, context);
    installDefinitions(value, definitions, context);
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== '$defs') visitInlineDefinitions(child, context);
  }
}

/** Move Zod's schema-local `$defs` into reusable OpenAPI components. */
export function hoistInlineDefinitions(document: JsonObject): void {
  const components = isObject(document['components']) ? document['components'] : {};
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  const context = { schemas, variants: new Map<string, Map<string, string>>() };
  visitInlineDefinitions(document['paths'], context);
  for (const schema of Object.values(schemas)) visitInlineDefinitions(schema, context);
  components['schemas'] = schemas;
  document['components'] = components;
}

/** Collect replaceable nested schemas beneath one schema root. */
export function childSchemaSlots(
  schema: JsonObject,
  name: string,
  replace: (replacement: JsonObject) => void,
): readonly SchemaSlot[] {
  const slots: SchemaSlot[] = [{ schema, name, replace }];
  const visit = (child: unknown, childName: string, assign: (replacement: JsonObject) => void) => {
    if (!isObject(child) || '$ref' in child) return;
    slots.push(...childSchemaSlots(child, childName, assign));
  };
  const properties = isObject(schema['properties']) ? schema['properties'] : undefined;
  if (properties) {
    for (const [propertyName, child] of Object.entries(properties)) {
      visit(child, `${name}${componentName({ operationId: propertyName }, '')}`, (replacement) => {
        properties[propertyName] = replacement;
      });
    }
  }
  visit(schema['items'], `${name}Item`, (replacement) => {
    schema['items'] = replacement;
  });
  visit(schema['additionalProperties'], `${name}Value`, (replacement) => {
    schema['additionalProperties'] = replacement;
  });
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const variants = Array.isArray(schema[keyword]) ? schema[keyword] : [];
    variants.forEach((child, index) => {
      visit(child, `${name}${keyword}${index + 1}`, (replacement) => {
        variants[index] = replacement;
      });
    });
  }
  return slots;
}

/** Collect nested schemas from every public operation and component. */
export function nestedSchemaSlots(document: JsonObject): readonly SchemaSlot[] {
  const slots: SchemaSlot[] = [];
  const addContent = (content: unknown, name: string) => {
    if (!isObject(content)) return;
    for (const [mediaType, media] of Object.entries(content)) {
      if (!isObject(media) || !isObject(media['schema']) || '$ref' in media['schema']) continue;
      slots.push(
        ...childSchemaSlots(media['schema'], name, (replacement) => {
          media['schema'] = replacement;
        }),
      );
      if (mediaType === 'text/event-stream') continue;
    }
  };
  for (const { operation } of operations(document)) {
    const name = componentName(operation, '');
    const body = isObject(operation['requestBody']) ? operation['requestBody'] : undefined;
    addContent(body?.['content'], `${name}Request`);
    const parameters = Array.isArray(operation['parameters']) ? operation['parameters'] : [];
    parameters.forEach((parameter, index) => {
      if (!isObject(parameter) || !isObject(parameter['schema']) || '$ref' in parameter['schema'])
        return;
      slots.push(
        ...childSchemaSlots(parameter['schema'], `${name}Parameter${index + 1}`, (replacement) => {
          parameter['schema'] = replacement;
        }),
      );
    });
    for (const [status, response] of statusEntries(operation)) {
      addContent(response['content'], `${name}Response${status}`);
    }
  }
  const components = isObject(document['components']) ? document['components'] : {};
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  for (const [name, schema] of Object.entries(schemas)) {
    if (!isObject(schema) || '$ref' in schema) continue;
    const children = childSchemaSlots(schema, name, (replacement) => {
      schemas[name] = replacement;
    });
    // Keep the named component root and deduplicate only its repeated internal structures.
    slots.push(...children.slice(1));
  }
  return slots;
}

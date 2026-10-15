/** Lossless, same-document reuse for large identical MCP JSON Schema fragments. */
type Schema = Record<string, unknown>;
const namedSchemas = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
]);
const childSchemas = new Set([
  'items',
  'prefixItems',
  'additionalItems',
  'contains',
  'additionalProperties',
  'unevaluatedProperties',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'anyOf',
  'oneOf',
  'allOf',
]);
function record(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function mapChild(value: unknown, visit: (schema: Schema) => Schema): unknown {
  if (Array.isArray(value)) return value.map((child) => mapChild(child, visit));
  return record(value) ? visit(value) : value;
}
function mapChildren(schema: Schema, visit: (schema: Schema) => Schema): Schema {
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => {
      if (namedSchemas.has(key) && record(value))
        return [
          key,
          Object.fromEntries(
            Object.entries(value).map(([name, child]) => [name, mapChild(child, visit)]),
          ),
        ];
      return [key, childSchemas.has(key) ? mapChild(value, visit) : value];
    }),
  );
}

/** An isolated schema keeps its own resolution scope when it cannot safely join the registry. */
export function schemaNeedsIsolation(schema: Schema): boolean {
  let isolated = false;
  const visit = (value: Schema): Schema => {
    if (
      ['$id', '$anchor', '$dynamicAnchor', '$dynamicRef'].some((key) => Object.hasOwn(value, key))
    )
      isolated = true;
    const ref = value['$ref'];
    if (typeof ref === 'string' && ref !== '#' && !ref.startsWith('#/')) isolated = true;
    mapChildren(value, visit);
    return value;
  };
  visit(schema);
  return isolated;
}

/** Rebase existing document-local pointers into the named tool's place in the shared document. */
export function toolSchemaInRegistry(name: string, schema: Schema): Schema {
  const pointerName = name.replaceAll('~', '~0').replaceAll('/', '~1');
  const prefix = `#/properties/${pointerName}`;
  const visit = (value: Schema): Schema => {
    const mapped = mapChildren(value, visit);
    const ref = value['$ref'];
    return typeof ref === 'string' && (ref === '#' || ref.startsWith('#/'))
      ? { ...mapped, $ref: `${prefix}${ref.slice(1)}` }
      : mapped;
  };
  return visit(schema);
}
interface RepeatedSchema {
  readonly schema: Schema;
  count: number;
}
function fingerprintOf(schema: Schema): string {
  return JSON.stringify(schema, (_key, value: unknown) =>
    record(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
}
function repeatedSchemas(root: Schema): Map<string, RepeatedSchema> {
  const repeated = new Map<string, RepeatedSchema>();
  const visit = (schema: Schema): Schema => {
    const fingerprint = fingerprintOf(schema);
    if (fingerprint.length >= 40 && schema['$ref'] === undefined) {
      const found = repeated.get(fingerprint);
      if (found) found.count += 1;
      else repeated.set(fingerprint, { schema, count: 1 });
    }
    mapChildren(schema, visit);
    return schema;
  };
  mapChildren(root, visit);
  return repeated;
}
function referencedDefinitions(
  root: Schema,
  definitions: ReadonlyMap<string, Schema>,
): Set<string> {
  const used = new Set<string>();
  const visit = (schema: Schema): Schema => {
    const ref = schema['$ref'];
    if (typeof ref === 'string' && ref.startsWith('#/$defs/')) {
      const name = ref.slice('#/$defs/'.length);
      const definition = definitions.get(name);
      if (definition && !used.has(name)) {
        used.add(name);
        visit(definition);
      }
    }
    mapChildren(schema, visit);
    return schema;
  };
  visit(root);
  return used;
}
function referenceCounts(
  root: Schema,
  definitions: ReadonlyMap<string, Schema>,
): Map<string, number> {
  const counts = new Map<string, number>();
  const visited = new Set<string>();
  const visit = (schema: Schema): Schema => {
    const ref = schema['$ref'];
    const name = typeof ref === 'string' ? ref.slice('#/$defs/'.length) : '';
    const definition =
      typeof ref === 'string' && ref.startsWith('#/$defs/') ? definitions.get(name) : undefined;
    if (definition) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      if (!visited.has(name)) {
        visited.add(name);
        visit(definition);
      }
    }
    mapChildren(schema, visit);
    return schema;
  };
  visit(root);
  return counts;
}
function inlineSingleUse(root: Schema, definitions: Map<string, Schema>): Schema {
  let result = root;
  while (definitions.size) {
    const singles = new Set(
      [...referenceCounts(result, definitions)]
        .filter(([, count]) => count === 1)
        .map(([name]) => name),
    );
    if (!singles.size) break;
    const replace = (schema: Schema): Schema => {
      const ref = schema['$ref'];
      const name = typeof ref === 'string' ? ref.slice('#/$defs/'.length) : '';
      const definition = singles.has(name) ? definitions.get(name) : undefined;
      return mapChildren(definition ?? schema, replace);
    };
    result = replace(result);
    for (const [name, schema] of definitions) {
      if (singles.has(name)) definitions.delete(name);
      else definitions.set(name, replace(schema));
    }
  }
  return result;
}
/**
 * Replace only identical large schemas when their local reference saves bytes.
 * Literal defaults/examples and existing references retain their exact values. The root remains
 * an object and generated references stay in this document; no resolution or network work occurs.
 */
export function shareLargeSchemaFragments(root: Schema): Schema {
  // Moving an anchored scope could change relative resolution. Preserve such documents verbatim.
  if (/"\$(?:id|anchor|dynamicAnchor|dynamicRef)":/.test(JSON.stringify(root))) return root;
  const existing = record(root['$defs']) ? root['$defs'] : {};
  const names = new Map<string, string>();
  const originals = new Map<string, Schema>();
  for (const [fingerprint, entry] of repeatedSchemas(root)) {
    let index = names.size;
    let name = index.toString(36);
    while (Object.hasOwn(existing, name) || originals.has(name)) name = (++index).toString(36);
    const refLength = JSON.stringify({ $ref: `#/$defs/${name}` }).length;
    const savings =
      (fingerprint.length - refLength) * entry.count - fingerprint.length - name.length - 4;
    if (savings <= 0) continue;
    names.set(fingerprint, name);
    originals.set(name, entry.schema);
  }
  if (!names.size) return root;
  const rewrite = (schema: Schema): Schema => {
    const name = names.get(fingerprintOf(schema));
    return name ? { $ref: `#/$defs/${name}` } : mapChildren(schema, rewrite);
  };
  let transformed = mapChildren(root, rewrite);
  const definitions = new Map(
    [...originals].map(([name, schema]) => [name, mapChildren(schema, rewrite)]),
  );
  transformed = inlineSingleUse(transformed, definitions);
  const used = referencedDefinitions(transformed, definitions);
  const result = {
    ...transformed,
    $defs: {
      ...(record(transformed['$defs']) ? transformed['$defs'] : {}),
      ...Object.fromEntries([...definitions].filter(([name]) => used.has(name))),
    },
  };
  return JSON.stringify(result).length < JSON.stringify(root).length ? result : root;
}

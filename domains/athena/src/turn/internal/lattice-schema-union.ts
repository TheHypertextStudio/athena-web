/** Lossless factoring of constraints shared by every direct JSON Schema union branch. */
type Schema = Record<string, unknown>;
function record(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function required(schema: Schema): string[] {
  const value = schema['required'];
  return Array.isArray(value) && value.every((key) => typeof key === 'string') ? value : [];
}
function factorProperties(branches: Schema[]): Schema {
  const properties: Schema = {};
  const first = branches[0]?.['properties'];
  if (!record(first)) return properties;
  for (const [key, value] of Object.entries(first)) {
    const length = JSON.stringify(value).length;
    if ((length - 2) * (branches.length - 1) <= JSON.stringify(key).length + 1 + length) continue;
    if (
      !branches.every(
        (branch) =>
          record(branch['properties']) &&
          Object.hasOwn(branch['properties'], key) &&
          equal(branch['properties'][key], value),
      )
    )
      continue;
    properties[key] = value;
    // Preserve recognized/evaluated property names under additional/unevaluatedProperties.
    for (const branch of branches)
      branch['properties'] = { ...(branch['properties'] as Schema), [key]: {} };
  }
  return properties;
}
/**
 * Hoist constraints true in every branch, preserving oneOf match counts and closed object keys.
 * Call only for nodes without incoming pointers to descendants; anchored scopes stay isolated.
 */
function factorSchemaUnion(schema: Schema): Schema {
  if (['type', 'properties', 'required', '$ref'].some((key) => Object.hasOwn(schema, key)))
    return schema;
  const keyword = Array.isArray(schema['oneOf']) ? 'oneOf' : 'anyOf';
  const original = schema[keyword];
  if (
    !Array.isArray(original) ||
    original.length < 2 ||
    !original.every((branch) => record(branch) && !Object.hasOwn(branch, '$ref'))
  )
    return schema;
  const branches: Schema[] = original.map((branch: Schema) => ({ ...branch }));
  const first = branches[0];
  if (!first) return schema;
  const result: Schema = { ...schema, [keyword]: branches };
  if (
    Object.hasOwn(first, 'type') &&
    branches.every((branch) => equal(branch['type'], first['type']))
  ) {
    result['type'] = first['type'];
    for (const branch of branches) delete branch['type'];
  }
  hoistRequired(result, branches, first);
  const properties = factorProperties(branches);
  if (Object.keys(properties).length) result['properties'] = properties;
  return JSON.stringify(result).length < JSON.stringify(schema).length ? result : schema;
}

function hoistRequired(result: Schema, branches: Schema[], first: Schema): void {
  const commonRequired = required(first).filter((key) =>
    branches.every((branch) => required(branch).includes(key)),
  );
  if (commonRequired.length) {
    result['required'] = commonRequired;
    for (const branch of branches) {
      const remaining = required(branch).filter((key) => !commonRequired.includes(key));
      if (remaining.length) branch['required'] = remaining;
      else delete branch['required'];
    }
  }
}

/** Factor schema unions without moving incoming pointer targets or traversing literal values. */
export function factorSchemaUnions(
  root: Schema,
  protectedNodes: WeakSet<object>,
  mapChildren: (schema: Schema, visit: (schema: Schema) => Schema) => Schema,
): Schema {
  const visit = (schema: Schema): Schema => {
    const mapped = mapChildren(schema, visit);
    return protectedNodes.has(schema) ? mapped : factorSchemaUnion(mapped);
  };
  const result = visit(root);
  return JSON.stringify(result).length < JSON.stringify(root).length ? result : root;
}

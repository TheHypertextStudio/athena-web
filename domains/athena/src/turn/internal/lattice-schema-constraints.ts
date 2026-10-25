/** Equivalent, smaller JSON Schema forms for a local model; server schemas remain untouched. */
type Schema = Record<string, unknown>;
function record(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasJsonType(value: unknown, type: unknown): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'object':
      return record(value);
    case 'array':
      return Array.isArray(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}
function literalChoicesImplyType(schema: Schema, type: unknown): boolean {
  const choices: readonly unknown[] = Object.hasOwn(schema, 'const')
    ? [schema['const']]
    : Array.isArray(schema['enum'])
      ? schema['enum']
      : [];
  const types: readonly unknown[] = Array.isArray(type) ? type : [type];
  return (
    choices.length > 0 &&
    choices.every((choice) => types.some((entry) => hasJsonType(choice, entry)))
  );
}
/** Keep genuine limits and contradictory literal/type pairs; omit only implied constraints. */
export function isRedundantSchemaKeyword(schema: Schema, key: string, value: unknown): boolean {
  if (key === 'type') return literalChoicesImplyType(schema, value);
  if (key === 'pattern') return typeof schema['format'] === 'string';
  if (key === 'maximum') return value === Number.MAX_SAFE_INTEGER;
  if (key === 'minimum') return value === Number.MIN_SAFE_INTEGER;
  return false;
}

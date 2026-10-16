/**
 * Compare JSON facts independently of object insertion order, omitting undefined object values.
 * Arrays preserve authored order. Callers supply validated JSON, not executable or cyclic objects.
 */
export function canonicalJsonFacts(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonFacts).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJsonFacts(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/**
 * `@docket/integrations` — tiny JSON-narrowing helpers shared by the observer adapters.
 *
 * @remarks
 * Provider payloads arrive as `unknown`; real adapters walk them defensively. These helpers
 * keep that narrowing logic in one place.
 */

/** Read an unknown value as a plain record, or `undefined` when it is not an object. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Read a string field from a (possibly absent) record, or `undefined`. */
export function str(rec: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = rec?.[key];
  return typeof v === 'string' ? v : undefined;
}

/** Parse a response body as JSON, returning `undefined` for empty or malformed bodies. */
export async function optionalJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Read the first non-empty string field from a provider payload. */
export function firstString(value: unknown, keys: readonly string[]): string | undefined {
  const rec = asRecord(value);
  for (const key of keys) {
    const found = str(rec, key);
    if (found && found.length > 0) return found;
  }
  return undefined;
}

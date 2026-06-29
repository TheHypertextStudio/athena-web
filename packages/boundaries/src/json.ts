/**
 * `@docket/boundaries` — tiny JSON-narrowing helpers shared by the observer adapters.
 *
 * @remarks
 * Provider webhook payloads arrive as `unknown`; both the real and mock observers walk them
 * defensively. These two helpers are the shared primitive for that (`real/observer-linear.ts`,
 * `mock/observer.ts`) so the narrowing logic lives in exactly one place.
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

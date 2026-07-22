/**
 * Normalize a clearable free-text column for a Drizzle `.set()` spread on a PATCH.
 *
 * @remarks
 * These columns (`summary`, and the retrofitted `description` on Initiative/Project)
 * are optional-but-not-nullable on the wire — their update schema is
 * `z.string().optional()`, never `.nullable().optional()`. A client therefore CLEARS
 * the column by sending an empty string and LEAVES IT UNCHANGED by omitting the key.
 * `null` is not a valid wire value for these fields.
 *
 * The returned object is meant to be spread into a Drizzle `.set({ ... })`:
 * - key omitted (`undefined`) → `{}` (column untouched)
 * - empty / whitespace-only string → `{ [key]: null }` (clear the column)
 * - otherwise → `{ [key]: value.trim() }` (store the trimmed value)
 *
 * @param key - The column name to patch (e.g. `'summary'`).
 * @param value - The incoming value from the validated PATCH body.
 * @returns A partial to spread into `.set()`.
 *
 * @example
 * ```typescript
 * const patch = {
 *   ...clearableTextPatch('summary', body.summary),
 *   ...clearableTextPatch('description', body.description),
 * };
 * ```
 */
export function clearableTextPatch<K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, string | null>> {
  if (value === undefined) return {};
  const trimmed = value.trim();
  return { [key]: trimmed === '' ? null : trimmed } as Partial<Record<K, string | null>>;
}

/**
 * `@docket/test-utils` — non-null assertion helper for tests.
 *
 * @remarks
 * Tests routinely dereference values pulled from seeded fixtures
 * (`arr[0].id`, `map.get(key).field`) that TypeScript can't statically prove
 * are present — `noUncheckedIndexedAccess` types `arr[0]` as `T | undefined`,
 * and `Map.get` is `T | undefined` by definition. `assertDefined` replaces the
 * `!` non-null assertion operator at those call sites with a runtime check
 * that throws a descriptive error instead of silently producing `undefined`
 * behavior if a fixture assumption turns out to be wrong.
 */

/**
 * Returns `value` narrowed to a non-null, non-undefined type, throwing if it
 * is `null` or `undefined`.
 *
 * @param value - The value to check.
 * @param message - Optional error message; defaults to a generic description
 * of what was expected.
 * @returns `value`, narrowed to exclude `null` and `undefined`.
 * @throws {Error} If `value` is `null` or `undefined`.
 *
 * @example
 * ```typescript
 * const first = assertDefined(items[0], 'expected at least one seeded item');
 * expect(first.id).toBe('...');
 * ```
 */
export function assertDefined<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Expected value to be defined, got null/undefined');
  }
  return value;
}

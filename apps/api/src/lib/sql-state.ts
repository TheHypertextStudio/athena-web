/**
 * `@docket/api` — Postgres SQLSTATE extraction from a thrown driver error.
 *
 * @remarks
 * Drizzle wraps the underlying driver error in a `DrizzleQueryError`, whose own
 * `code` property is `undefined` — the real SQLSTATE lives on `err.cause.code`
 * instead. {@link hasSqlState} checks both so SQLSTATE matching is robust
 * regardless of driver (postgres-js vs. PGlite) or wrapping.
 */

/** The SQLSTATE code carried directly on an error, if any. */
function sqlStateOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const { code } = err;
  return typeof code === 'string' ? code : undefined;
}

/** Whether a thrown error carries the given Postgres SQLSTATE, directly or via `.cause`. */
export function hasSqlState(err: unknown, code: string): boolean {
  if (sqlStateOf(err) === code) return true;
  const cause =
    typeof err === 'object' && err !== null ? (err as { cause?: unknown }).cause : undefined;
  return sqlStateOf(cause) === code;
}

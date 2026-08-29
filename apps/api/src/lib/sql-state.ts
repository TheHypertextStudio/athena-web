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

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}

/**
 * Describe the deepest database error without copying a wrapper's SQL text or bound parameters.
 *
 * @param err - A driver error or a Drizzle wrapper around one.
 * @param fallback - Application-owned copy for an unknown thrown value.
 * @returns A private operator diagnostic with stable PostgreSQL metadata when available.
 */
export function sqlErrorSummary(err: unknown, fallback: string): string {
  let current = err;
  let diagnostic: unknown;
  let reachedEnd = false;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== 'object' || current === null || seen.has(current)) return fallback;
    seen.add(current);
    if (sqlStateOf(current)) diagnostic = current;
    const cause = (current as { cause?: unknown }).cause;
    if (cause === undefined || cause === null) {
      reachedEnd = true;
      break;
    }
    if (typeof cause !== 'object' || seen.has(cause)) return fallback;
    current = cause;
  }
  if (!reachedEnd || diagnostic === undefined) return fallback;

  const message = stringField(diagnostic, 'message') ?? fallback;
  const sqlState = sqlStateOf(diagnostic);
  const constraint = stringField(diagnostic, 'constraint');
  const table = stringField(diagnostic, 'table');
  const column = stringField(diagnostic, 'column');
  const metadata = [
    sqlState ? `SQLSTATE ${sqlState}` : undefined,
    constraint ? `constraint ${constraint}` : undefined,
    table ? `table ${table}` : undefined,
    column ? `column ${column}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return metadata.length > 0 ? `${message} (${metadata.join('; ')})` : message;
}

/** Whether a thrown error carries the given Postgres SQLSTATE, directly or via `.cause`. */
export function hasSqlState(err: unknown, code: string): boolean {
  if (sqlStateOf(err) === code) return true;
  const cause =
    typeof err === 'object' && err !== null ? (err as { cause?: unknown }).cause : undefined;
  return sqlStateOf(cause) === code;
}

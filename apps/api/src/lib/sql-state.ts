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
  const diagnostic = deepestDiagnostic(err);
  if (diagnostic === undefined) return fallback;
  const message = stringField(diagnostic, 'message') ?? fallback;
  const metadata = diagnosticMetadata(diagnostic);
  return metadata.length > 0 ? `${message} (${metadata.join('; ')})` : message;
}

/**
 * Walk the `.cause` chain to the deepest link that carries a SQLSTATE.
 *
 * @remarks
 * Bounded and cycle-guarded: a wrapper chain that loops, runs deeper than eight links, or ends on
 * something that is not an object is not a diagnostic this can describe safely.
 *
 * @param err - A driver error or a Drizzle wrapper around one.
 * @returns The deepest link carrying a SQLSTATE, or `undefined` when there is none.
 */
function deepestDiagnostic(err: unknown): unknown {
  let current = err;
  let diagnostic: unknown;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== 'object' || current === null || seen.has(current)) return undefined;
    seen.add(current);
    if (sqlStateOf(current)) diagnostic = current;
    const cause = (current as { cause?: unknown }).cause;
    if (cause === undefined || cause === null) return diagnostic;
    if (typeof cause !== 'object' || seen.has(cause)) return undefined;
    current = cause;
  }
  return undefined;
}

/**
 * The stable PostgreSQL metadata worth quoting beside a diagnostic's message.
 *
 * @param diagnostic - The driver error.
 * @returns The metadata fragments that are present, in reporting order.
 */
function diagnosticMetadata(diagnostic: unknown): readonly string[] {
  const sqlState = sqlStateOf(diagnostic);
  const parts: (string | undefined)[] = [
    sqlState ? `SQLSTATE ${sqlState}` : undefined,
    labelled('constraint', stringField(diagnostic, 'constraint')),
    labelled('table', stringField(diagnostic, 'table')),
    labelled('column', stringField(diagnostic, 'column')),
  ];
  return parts.filter((part): part is string => part !== undefined);
}

/** Pair a diagnostic field with its label, or drop it when the driver did not report it. */
function labelled(label: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : `${label} ${value}`;
}

/** Whether a thrown error carries the given Postgres SQLSTATE, directly or via `.cause`. */
export function hasSqlState(err: unknown, code: string): boolean {
  if (sqlStateOf(err) === code) return true;
  const cause =
    typeof err === 'object' && err !== null ? (err as { cause?: unknown }).cause : undefined;
  return sqlStateOf(cause) === code;
}

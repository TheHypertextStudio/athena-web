/**
 * Resolves the connection string `drizzle-kit` uses for `db:generate`/`db:migrate`.
 *
 * @remarks
 * Prefers `DATABASE_URL_UNPOOLED`, falling back to `DATABASE_URL`. Treats an empty
 * string as unset, not just missing — `.env.local`/`.env.example` document
 * `DATABASE_URL_UNPOOLED` as optional by leaving it blank (`DATABASE_URL_UNPOOLED=`),
 * and a naive `??` fallback only short-circuits on `null`/`undefined`, not `''`, so a
 * present-but-blank value would otherwise silently resolve to an empty connection
 * string instead of falling through to `DATABASE_URL`.
 */
export function resolveDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const unpooled = env['DATABASE_URL_UNPOOLED'];
  if (unpooled) return unpooled;
  const pooled = env['DATABASE_URL'];
  // `pooled ?? undefined` would only catch null/undefined, not '' — the exact bug this exists to avoid.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return pooled ? pooled : undefined;
}

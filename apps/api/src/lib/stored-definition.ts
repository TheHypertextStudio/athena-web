/**
 * Reading JSON columns whose schemas are derived from a work-view contract.
 *
 * @remarks
 * Three tables store work-view definitions as JSON — `hub.preferences.viewState`,
 * `saved_view.definition`, and `organization_work_view_default.definition` — and all three are
 * validated by `.strict()` schemas whose field enums are built from the contract literal at module
 * load (see `createViewDefinitionSchema` in `@docket/work/work-view-contract`). Renaming or removing
 * one field therefore makes every stored row that referenced it unparseable, in all three tables at
 * once, the moment the new code deploys. `drizzle/0097_remove_initiative_project_count.sql` is the
 * hand-written backfill for the one time this happened; there is no general mechanism, so the next
 * field change without a matching backfill reproduces it exactly.
 *
 * A stale row is a deployment artifact, not the caller's fault, and it must not take a surface down
 * with it. One person's stale personal override should not fail their preferences read — especially
 * since the write path parses the same row, so they cannot overwrite it to heal themselves. One
 * stale saved view should not empty the workspace's saved-view list for everyone who can see it.
 *
 * These helpers drop what no longer conforms, keep what does, and log each loss with the row id so
 * a backfill can find it. They are deliberately narrow: they repair *stored* values against a
 * contract that moved underneath them, and are never a way to accept malformed input.
 */
import type { z } from 'zod';

/** Where a stale stored definition was found, for the log line. */
export interface StoredDefinitionSite {
  /** The table and column the value came from, e.g. `hub.preferences.viewState`. */
  readonly column: string;
  /** The owning row id, so a backfill can locate it. Never the stored value itself. */
  readonly rowId?: string | undefined;
}

/**
 * Record that a stored definition no longer satisfies its contract.
 *
 * @remarks
 * Paths and issue codes only. The stored value is a person's own saved configuration, and the
 * surrounding log stream is not the place for it.
 */
function logStaleDefinition(site: StoredDefinitionSite, error: z.ZodError): void {
  console.error(
    JSON.stringify({
      level: 'error',
      source: 'api',
      event: 'stale_stored_definition',
      column: site.column,
      ...(site.rowId ? { rowId: site.rowId } : {}),
      issues: error.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.') })),
    }),
  );
}

/**
 * Parse one stored definition, yielding `null` rather than throwing when it no longer conforms.
 *
 * @param schema - The current contract-derived schema.
 * @param value - The stored JSON value.
 * @param site - Column and row id, for the log line when the value is stale.
 * @returns the parsed definition, or `null` when it no longer satisfies the contract.
 */
export function parseStoredDefinition<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  site: StoredDefinitionSite,
): z.output<TSchema> | null {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  logStaleDefinition(site, result.error);
  return null;
}

/**
 * Parse a list of stored definitions, dropping only the entries that no longer conform.
 *
 * @param schema - The current contract-derived schema for one entry.
 * @param values - The stored entries.
 * @param site - Column and row id, for the log line on each stale entry.
 * @returns every entry that still satisfies the contract, in their original order.
 */
export function parseStoredDefinitions<TSchema extends z.ZodType>(
  schema: TSchema,
  values: readonly unknown[],
  site: StoredDefinitionSite,
): z.output<TSchema>[] {
  const kept: z.output<TSchema>[] = [];
  for (const value of values) {
    const parsed = parseStoredDefinition(schema, value, site);
    if (parsed !== null) kept.push(parsed);
  }
  return kept;
}

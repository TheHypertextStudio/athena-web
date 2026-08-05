/**
 * Convert prose still holding the old shortcode mention form.
 *
 * @remarks
 * A sweep rather than a SQL migration, because the rewrite is not expressible as one statement:
 * which path a reference points at differs per kind, and that mapping already lives in one
 * exhaustive switch a migration cannot call. A sweep also self-heals — a row missed because it was
 * locked, or written by a stale client after the deploy, is picked up on the next tick instead of
 * needing a second migration.
 *
 * Rewriting the column is enough to fix the derived edges too: the reconciler is a projection of
 * whatever the column currently holds, so re-reading the row after the rewrite derives the right
 * mentions with no extra bookkeeping here.
 */
import { and, eq, isNotNull, like } from 'drizzle-orm';

import { db as defaultDb } from '@docket/db';

import { rewriteLegacyMentions } from './legacy-mention-shortcodes';

/** What one sweep did. */
export interface LegacyMentionSweepResult {
  /** Rows whose prose was rewritten. */
  readonly rewritten: number;
  /** Rows that matched the cheap filter but held nothing convertible. */
  readonly unchanged: number;
}

/** How many rows of one table a tick converts, so a large workspace drains over several ticks. */
const BATCH = 200;

/**
 * The cheap pre-filter.
 *
 * @remarks
 * A `LIKE` on the literal opening of the shortcode, so the scan reads only rows that could
 * possibly convert. It over-matches — prose that merely says `[mention ` in passing is fetched and
 * then left alone by the pure rewriter — which is the right way round for a sweep that must not
 * miss anything.
 */
const NEEDLE = '%[mention %';

/**
 * Rewrite one batch of shortcode-bearing prose across every table that can hold it.
 *
 * @param database - The database handle, injected so a test can drive its own transaction.
 * @returns How many rows changed and how many were fetched but left alone.
 *
 * @example
 * ```typescript
 * const { rewritten } = await sweepLegacyMentions();
 * ```
 */
export async function sweepLegacyMentions(
  database: typeof defaultDb = defaultDb,
): Promise<LegacyMentionSweepResult> {
  const schema = await import('@docket/db');
  let rewritten = 0;
  let unchanged = 0;

  /** One row of any prose table, reduced to what the rewrite needs. */
  interface ProseRow {
    readonly id: string;
    readonly organizationId: string;
    readonly prose: string | null;
  }

  /** Convert one table's prose column. Written once and called per table to keep drizzle typed. */
  async function convert(
    rows: readonly ProseRow[],
    write: (id: string, next: string) => Promise<unknown>,
  ): Promise<void> {
    for (const row of rows) {
      const current = row.prose ?? '';
      const next = rewriteLegacyMentions(current, row.organizationId);
      if (next === current) {
        unchanged += 1;
        continue;
      }
      await write(row.id, next);
      rewritten += 1;
    }
  }

  const { task, project, program, initiative, comment, update } = schema;

  for (const table of [task, project, program, initiative] as const) {
    const rows = await database
      .select({ id: table.id, organizationId: table.organizationId, prose: table.description })
      .from(table)
      .where(and(isNotNull(table.description), like(table.description, NEEDLE)))
      .limit(BATCH);
    await convert(rows, (id, next) =>
      database.update(table).set({ description: next }).where(eq(table.id, id)),
    );
  }

  for (const table of [comment, update] as const) {
    const rows = await database
      .select({ id: table.id, organizationId: table.organizationId, prose: table.body })
      .from(table)
      .where(and(isNotNull(table.body), like(table.body, NEEDLE)))
      .limit(BATCH);
    await convert(rows, (id, next) =>
      database.update(table).set({ body: next }).where(eq(table.id, id)),
    );
  }

  return { rewritten, unchanged };
}

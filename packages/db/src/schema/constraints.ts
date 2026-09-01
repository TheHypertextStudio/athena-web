/**
 * `@docket/db` — CHECK constraint helpers shared across schema islands.
 *
 * @remarks
 * Constraints are the floor, not the ceiling: every DTO in `domain packages` validates a write
 * before it reaches the database, but a DTO only protects the writers that go through it. The
 * schema is also written by connector reconcile, MCP tools, the email-to-task path, seed data
 * and migrations, so the invariants a reader depends on are declared here too.
 *
 * This module holds only the helpers more than one island needs, and deliberately imports no
 * table — `work.ts` already imports `crosscutting.ts`, so a helper living in either one would
 * make the other's import a cycle at module-init time.
 */
import { sql, type SQLWrapper } from 'drizzle-orm';
import { check } from 'drizzle-orm/pg-core';

/**
 * A CHECK asserting a required name column holds at least one non-whitespace character.
 *
 * @remarks
 * `NOT NULL` permits `''` and `'   '`, which render as a blank row a reader cannot click,
 * search or tell apart from its neighbours — an unusable record that no surface can repair
 * because it looks like nothing is there.
 *
 * The test is `~ '[^[:space:]]'` rather than `length(btrim(x)) > 0` because Postgres' one-argument
 * `btrim` strips spaces and nothing else: a title of a single tab survives that check and is just
 * as blank on screen. The POSIX class covers tabs, newlines and the rest.
 *
 * @param name - The constraint name, `<table>_<column>_not_blank` by convention.
 * @param column - The text column to require content in.
 * @returns the drizzle CHECK constraint to spread into a table's extras list.
 */
export function notBlank(name: string, column: SQLWrapper) {
  return check(name, sql`${column} ~ ${sql.raw("'[^[:space:]]'")}`);
}

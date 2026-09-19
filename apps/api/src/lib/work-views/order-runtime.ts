/**
 * `@docket/api` — the shared plumbing a work-view reorder runs on.
 *
 * @remarks
 * `./order` owns the contextual rank and `./order-group` owns the group a drop lands in. Both run
 * inside the same transaction, both read through the same raw-SQL helpers, and both return the
 * same shape of after-commit callback, so those live here rather than in either of them.
 */
import type { Database, db } from '@docket/db';
import type { WorkViewOrderRequest } from '@docket/work/work-view-contract';
import type { sql } from 'drizzle-orm';
import { z } from 'zod';

import { rawResultRows } from '../raw-result';

/** The transaction a reorder and its group mutation share. */
export type WorkViewTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Work published only once the reorder's transaction has committed. */
export type AfterCommit = () => Promise<void>;

/** The callback for a reorder that changed nothing worth publishing. */
export const noAfterCommit: AfterCommit = async () => undefined;

/** The acting person's account, as the caller lookup selects it. */
export const callerRow = z.object({ user_id: z.string().nullable() }).loose();

/** A single `count(*)` result. */
export const countRow = z.object({ count: z.number().int().nonnegative() }).loose();

/** Inputs for one authorized work-view reorder. */
export interface ReorderWorkViewInput {
  readonly database: Database;
  readonly organizationId: string;
  readonly actorId: string;
  /** Organization capabilities resolved for the current actor. */
  readonly capabilities: readonly string[];
  readonly request: WorkViewOrderRequest;
}

/**
 * Read a group value that must name something.
 *
 * @param value - The raw group value.
 * @param field - The group field, named in the type error.
 * @returns The value as a string.
 * @throws {TypeError} When the value is not a string.
 */
export function stringValue(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  throw new TypeError(`Mutable group ${field} requires a string value.`);
}

/**
 * Read a group value that may clear the column instead.
 *
 * @param value - The raw group value.
 * @param field - The group field, named in the type error.
 * @returns The value as a string, or `null` for the unset column.
 * @throws {TypeError} When the value is neither a string nor `null`.
 */
export function nullableStringValue(value: unknown, field: string): string | null {
  return value === null ? null : stringValue(value, field);
}

/**
 * Run a raw statement and parse exactly one row from it.
 *
 * @param database - The database or transaction handle.
 * @param statement - The statement to run.
 * @param schema - The row shape to parse.
 * @returns The single row.
 * @throws {TypeError} When the statement returned none.
 */
export async function executeOne<TSchema extends z.ZodType>(
  database: Database | WorkViewTransaction,
  statement: ReturnType<typeof sql>,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  const rows = await executeRows(database, statement, schema);
  const row = rows[0];
  if (!row) throw new TypeError('A work-view order query returned no row.');
  return row;
}

/**
 * Run a raw statement and parse every row from it.
 *
 * @param database - The database or transaction handle.
 * @param statement - The statement to run.
 * @param schema - The row shape to parse.
 * @returns The parsed rows.
 */
export async function executeRows<TSchema extends z.ZodType>(
  database: Database | WorkViewTransaction,
  statement: ReturnType<typeof sql>,
  schema: TSchema,
): Promise<z.output<TSchema>[]> {
  const result: unknown = await database.execute(statement);
  return z.array(schema).parse(rawResultRows<unknown>(result));
}

/**
 * `@docket/api` test support — read back the change sets a route recorded.
 */
import type * as DbModule from '@docket/db';
import { asc, eq } from 'drizzle-orm';

/** One recorded entry, flattened with the change set it belongs to. */
export interface RecordedEntry {
  readonly changeSetId: string;
  readonly actorId: string;
  readonly tool: string | undefined;
  readonly channel: string | undefined;
  readonly entityKind: string;
  readonly entityId: string;
  readonly op: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

/**
 * Every change-set entry recorded in an organization, oldest change set first.
 *
 * @param schema - The loaded `@docket/db` module.
 * @param orgId - The organization to read.
 * @returns the flattened entries.
 */
export async function recordedEntries(
  schema: typeof DbModule,
  orgId: string,
): Promise<RecordedEntry[]> {
  const rows = await schema.db
    .select({ set: schema.changeSet, entry: schema.changeSetEntry })
    .from(schema.changeSetEntry)
    .innerJoin(schema.changeSet, eq(schema.changeSetEntry.changeSetId, schema.changeSet.id))
    .where(eq(schema.changeSet.organizationId, orgId))
    .orderBy(asc(schema.changeSet.createdAt));
  return rows.map(({ set, entry }) => ({
    changeSetId: set.id,
    actorId: set.actorId,
    tool: set.origin.tool,
    channel: set.origin.channel,
    entityKind: entry.entityKind,
    entityId: entry.entityId,
    op: entry.op,
    before: entry.before,
    after: entry.after,
  }));
}

/**
 * The entries of the one change set a route recorded under `tool`.
 *
 * @param schema - The loaded `@docket/db` module.
 * @param orgId - The organization to read.
 * @param tool - The operation name the route records.
 * @returns the entries.
 * @throws {Error} When the organization has no change set, or more than one, for `tool`.
 */
export async function entriesFor(
  schema: typeof DbModule,
  orgId: string,
  tool: string,
): Promise<RecordedEntry[]> {
  const entries = (await recordedEntries(schema, orgId)).filter((entry) => entry.tool === tool);
  const sets = new Set(entries.map((entry) => entry.changeSetId));
  if (sets.size !== 1) throw new Error(`expected one ${tool} change set, found ${sets.size}`);
  return entries;
}

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
 *
 * A shortcode written with no `label` attribute names something real, so before rewriting a batch
 * this looks up every such reference's current name — one batched query per entity kind — and
 * writes that in. Only a reference whose target has since been deleted falls through to a
 * generic kind-based label.
 */
import { and, eq, inArray, isNotNull, like } from 'drizzle-orm';

import { db as defaultDb } from '@docket/db';
import type * as dbSchema from '@docket/db';

import {
  findUnlabeledMentionRefs,
  rewriteLegacyMentions,
  type LegacyMentionEntityKind,
} from './legacy-mention-shortcodes';

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

/** The database module, loaded lazily so importing this file does not open a connection. */
type MentionSweepSchema = typeof dbSchema;

/** One row of any prose table, reduced to what the rewrite needs. */
interface ProseRow {
  readonly organizationId: string;
  readonly prose: string;
  readonly write: (next: string) => Promise<unknown>;
}

/** A looked-up entity, reduced to the name a mention label would carry. */
interface NamedEntityRow {
  readonly id: string;
  readonly name: string | null;
  readonly organizationId: string;
}

/** One entity kind's batched name lookup. */
interface MentionNameSource {
  readonly kind: LegacyMentionEntityKind;
  readonly load: (ids: readonly string[]) => Promise<readonly NamedEntityRow[]>;
}

/**
 * Key a resolved name by the *looked-up* row's own organization, not the referencing row's.
 *
 * @remarks
 * A shortcode can name any id at all — nothing upstream constrains it to the referencing
 * document's own org — so an unscoped lookup would resolve and permanently leak another org's real
 * entity name into this one's document. A mismatched org falls through exactly like a deleted
 * entity would.
 *
 * @param entityKind - The kind the shortcode names.
 * @param entityId - The id the shortcode names.
 * @param organizationId - The organization the looked-up row belongs to.
 * @returns The map key for that reference.
 */
function refKey(
  entityKind: LegacyMentionEntityKind,
  entityId: string,
  organizationId: string,
): string {
  return `${entityKind}:${entityId}:${organizationId}`;
}

/**
 * Fetch one batch of shortcode-bearing prose from every table that can hold it.
 *
 * @param database - The database handle.
 * @param schema - The loaded database module.
 * @returns Each matched row's prose alongside the write that puts the rewrite back.
 */
async function loadProseRows(
  database: typeof defaultDb,
  schema: MentionSweepSchema,
): Promise<readonly ProseRow[]> {
  const { task, project, program, initiative, comment, update } = schema;
  const describedTables = [task, project, program, initiative];
  const bodiedTables = [comment, update];

  // Six unrelated tables, none gating another — fired together rather than one at a time.
  const [descriptionBatches, bodyBatches] = await Promise.all([
    Promise.all(
      describedTables.map((table) =>
        database
          .select({ id: table.id, organizationId: table.organizationId, prose: table.description })
          .from(table)
          .where(and(isNotNull(table.description), like(table.description, NEEDLE)))
          .limit(BATCH),
      ),
    ),
    Promise.all(
      bodiedTables.map((table) =>
        database
          .select({ id: table.id, organizationId: table.organizationId, prose: table.body })
          .from(table)
          .where(and(isNotNull(table.body), like(table.body, NEEDLE)))
          .limit(BATCH),
      ),
    ),
  ]);

  const rows: ProseRow[] = [];
  describedTables.forEach((table, index) => {
    for (const row of descriptionBatches[index] ?? []) {
      if (row.prose === null) continue;
      rows.push({
        organizationId: row.organizationId,
        prose: row.prose,
        write: (next) =>
          database.update(table).set({ description: next }).where(eq(table.id, row.id)),
      });
    }
  });
  bodiedTables.forEach((table, index) => {
    for (const row of bodyBatches[index] ?? []) {
      rows.push({
        organizationId: row.organizationId,
        prose: row.prose,
        write: (next) => database.update(table).set({ body: next }).where(eq(table.id, row.id)),
      });
    }
  });
  return rows;
}

/**
 * The per-kind batched name lookups, in the order they are fired.
 *
 * @param database - The database handle.
 * @param schema - The loaded database module.
 * @returns One lookup per entity kind a shortcode can name without a label.
 */
function nameSources(
  database: typeof defaultDb,
  schema: MentionSweepSchema,
): readonly MentionNameSource[] {
  const { task, project, program, initiative, cycle, actor } = schema;
  return [
    {
      kind: 'task',
      load: (ids) =>
        database
          .select({ id: task.id, name: task.title, organizationId: task.organizationId })
          .from(task)
          .where(inArray(task.id, [...ids])),
    },
    {
      kind: 'project',
      load: (ids) =>
        database
          .select({ id: project.id, name: project.name, organizationId: project.organizationId })
          .from(project)
          .where(inArray(project.id, [...ids])),
    },
    {
      kind: 'program',
      load: (ids) =>
        database
          .select({ id: program.id, name: program.name, organizationId: program.organizationId })
          .from(program)
          .where(inArray(program.id, [...ids])),
    },
    {
      kind: 'initiative',
      load: (ids) =>
        database
          .select({
            id: initiative.id,
            name: initiative.name,
            organizationId: initiative.organizationId,
          })
          .from(initiative)
          .where(inArray(initiative.id, [...ids])),
    },
    {
      kind: 'cycle',
      load: (ids) =>
        database
          .select({ id: cycle.id, name: cycle.name, organizationId: cycle.organizationId })
          .from(cycle)
          .where(inArray(cycle.id, [...ids])),
    },
    {
      kind: 'actor',
      load: (ids) =>
        database
          .select({ id: actor.id, name: actor.displayName, organizationId: actor.organizationId })
          .from(actor)
          .where(inArray(actor.id, [...ids])),
    },
  ];
}

/**
 * Look up the current name of every reference a shortcode left unlabeled.
 *
 * @remarks
 * A shortcode with no captured `label` still names something real, as long as it hasn't been
 * deleted since, and that real name is one lookup away — so resolve it here, in one batched query
 * per entity kind, rather than persisting a placeholder a viewer would otherwise see on every
 * render until it resolves client-side. An absent or empty name is left out, so the rewrite falls
 * through to the generic kind-based label: a cycle's name is nullable because an un-named cycle is
 * normal, and an empty name elsewhere is no more a label than none at all.
 *
 * @param database - The database handle.
 * @param schema - The loaded database module.
 * @param rows - The prose rows about to be rewritten.
 * @returns A map from {@link refKey} to the entity's current name.
 */
async function resolveMentionNames(
  database: typeof defaultDb,
  schema: MentionSweepSchema,
  rows: readonly ProseRow[],
): Promise<ReadonlyMap<string, string>> {
  const idsByKind = new Map<LegacyMentionEntityKind, Set<string>>();
  for (const row of rows) {
    for (const ref of findUnlabeledMentionRefs(row.prose)) {
      const ids = idsByKind.get(ref.entityKind) ?? new Set<string>();
      ids.add(ref.entityId);
      idsByKind.set(ref.entityKind, ids);
    }
  }

  const nameByRef = new Map<string, string>();
  // Six unrelated tables, none gating another — fired together rather than one at a time.
  await Promise.all(
    nameSources(database, schema).map(async ({ kind, load }) => {
      const ids = idsByKind.get(kind);
      if (ids === undefined || ids.size === 0) return;
      for (const { id, name, organizationId } of await load([...ids])) {
        if (name) nameByRef.set(refKey(kind, id, organizationId), name);
      }
    }),
  );
  return nameByRef;
}

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
  const rows = await loadProseRows(database, schema);
  const nameByRef = await resolveMentionNames(database, schema, rows);

  let rewritten = 0;
  let unchanged = 0;
  for (const row of rows) {
    const next = rewriteLegacyMentions(row.prose, row.organizationId, (ref) =>
      nameByRef.get(refKey(ref.entityKind, ref.entityId, row.organizationId)),
    );
    if (next === row.prose) {
      unchanged += 1;
      continue;
    }
    await row.write(next);
    rewritten += 1;
  }

  return { rewritten, unchanged };
}

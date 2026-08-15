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
    readonly organizationId: string;
    readonly prose: string;
    readonly write: (next: string) => Promise<unknown>;
  }

  const { task, project, program, initiative, cycle, comment, update, actor } = schema;
  const rows: ProseRow[] = [];

  // Six unrelated tables, none gating another — fired together rather than one at a time.
  const [descriptionBatches, bodyBatches] = await Promise.all([
    Promise.all(
      [task, project, program, initiative].map((table) =>
        database
          .select({ id: table.id, organizationId: table.organizationId, prose: table.description })
          .from(table)
          .where(and(isNotNull(table.description), like(table.description, NEEDLE)))
          .limit(BATCH),
      ),
    ),
    Promise.all(
      [comment, update].map((table) =>
        database
          .select({ id: table.id, organizationId: table.organizationId, prose: table.body })
          .from(table)
          .where(and(isNotNull(table.body), like(table.body, NEEDLE)))
          .limit(BATCH),
      ),
    ),
  ]);

  [task, project, program, initiative].forEach((table, index) => {
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

  [comment, update].forEach((table, index) => {
    for (const row of bodyBatches[index] ?? []) {
      rows.push({
        organizationId: row.organizationId,
        prose: row.prose,
        write: (next) => database.update(table).set({ body: next }).where(eq(table.id, row.id)),
      });
    }
  });

  // A shortcode with no captured `label` still names something real (as long as it hasn't been
  // deleted since), and that real name is one lookup away — so resolve it here, in one batched
  // query per entity kind, rather than persisting a placeholder a viewer would otherwise see on
  // every render until it resolves client-side.
  const idsByKind = new Map<LegacyMentionEntityKind, Set<string>>();
  for (const row of rows) {
    for (const ref of findUnlabeledMentionRefs(row.prose)) {
      const ids = idsByKind.get(ref.entityKind) ?? new Set<string>();
      ids.add(ref.entityId);
      idsByKind.set(ref.entityKind, ids);
    }
  }

  // Keyed by the *looked-up* row's own organizationId, not the referencing row's — so a name is
  // only ever handed back to a rewrite whose row shares that same org. A shortcode can otherwise
  // name any id at all (nothing upstream constrains it to the referencing document's own org), and
  // an unscoped lookup would resolve and permanently leak another org's real entity name into this
  // one's document. A mismatched org falls through exactly like a deleted entity would.
  const nameByRef = new Map<string, string>();
  const refKey = (
    entityKind: LegacyMentionEntityKind,
    entityId: string,
    organizationId: string,
  ): string => `${entityKind}:${entityId}:${organizationId}`;

  const taskIds = idsByKind.get('task');
  const projectIds = idsByKind.get('project');
  const programIds = idsByKind.get('program');
  const initiativeIds = idsByKind.get('initiative');
  const cycleIds = idsByKind.get('cycle');
  const actorIds = idsByKind.get('actor');

  // Six unrelated tables, none gating another — fired together rather than one at a time.
  await Promise.all([
    (async () => {
      if (!taskIds || taskIds.size === 0) return;
      const found = await database
        .select({ id: task.id, name: task.title, organizationId: task.organizationId })
        .from(task)
        .where(inArray(task.id, [...taskIds]));
      for (const { id, name, organizationId } of found) {
        nameByRef.set(refKey('task', id, organizationId), name);
      }
    })(),
    (async () => {
      if (!projectIds || projectIds.size === 0) return;
      const found = await database
        .select({ id: project.id, name: project.name, organizationId: project.organizationId })
        .from(project)
        .where(inArray(project.id, [...projectIds]));
      for (const { id, name, organizationId } of found) {
        nameByRef.set(refKey('project', id, organizationId), name);
      }
    })(),
    (async () => {
      if (!programIds || programIds.size === 0) return;
      const found = await database
        .select({ id: program.id, name: program.name, organizationId: program.organizationId })
        .from(program)
        .where(inArray(program.id, [...programIds]));
      for (const { id, name, organizationId } of found) {
        nameByRef.set(refKey('program', id, organizationId), name);
      }
    })(),
    (async () => {
      if (!initiativeIds || initiativeIds.size === 0) return;
      const found = await database
        .select({
          id: initiative.id,
          name: initiative.name,
          organizationId: initiative.organizationId,
        })
        .from(initiative)
        .where(inArray(initiative.id, [...initiativeIds]));
      for (const { id, name, organizationId } of found) {
        nameByRef.set(refKey('initiative', id, organizationId), name);
      }
    })(),
    (async () => {
      if (!cycleIds || cycleIds.size === 0) return;
      const found = await database
        .select({ id: cycle.id, name: cycle.name, organizationId: cycle.organizationId })
        .from(cycle)
        .where(inArray(cycle.id, [...cycleIds]));
      // Unlike the other kinds, a cycle's `name` column is nullable (an un-named cycle is normal),
      // so an empty name here is a real fact about the cycle, not a lookup failure to fall through.
      for (const { id, name, organizationId } of found) {
        if (name) nameByRef.set(refKey('cycle', id, organizationId), name);
      }
    })(),
    (async () => {
      if (!actorIds || actorIds.size === 0) return;
      const found = await database
        .select({ id: actor.id, name: actor.displayName, organizationId: actor.organizationId })
        .from(actor)
        .where(inArray(actor.id, [...actorIds]));
      for (const { id, name, organizationId } of found) {
        nameByRef.set(refKey('actor', id, organizationId), name);
      }
    })(),
  ]);

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

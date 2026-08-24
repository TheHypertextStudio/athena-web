/**
 * `@docket/api` — the one label write path, shared by every labelable entity.
 *
 * @remarks
 * Five entities carry labels (task, project, initiative, program, library resource) and four
 * different callers write them: the REST routes, the automation engine's `task.applyLabel`, the
 * MCP tools, and the Linear reconciler. Group exclusivity would be decorative if it were
 * enforced in the picker, so it is enforced here instead — every one of those callers goes
 * through {@link resolveLabelSet} and {@link replaceLabels}.
 */
import {
  db,
  initiativeLabel,
  label,
  labelGroup,
  programLabel,
  projectLabel,
  resourceLabel,
  taskLabel,
} from '@docket/db';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { NotFoundError } from '../error';

/**
 * A label as the API serializes it inline: the unbranded row form of `LabelRef`.
 *
 * @remarks
 * Serializers here return `z.input` shapes, where ids are plain strings — the brand is minted by
 * the response schema on the way out. Declaring that shape once keeps every caller from having to
 * assert a database string into a branded id.
 */
export interface LabelRefRow {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/** A transaction handle, as Drizzle hands it to a `db.transaction` callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A database handle that may be either the pool or an open transaction. */
type Db = typeof db | Tx;

/** The entities that can carry labels. */
export type LabelableKind = 'task' | 'project' | 'initiative' | 'program' | 'resource';

/**
 * A resolved label: the chip fields plus just enough of its group to enforce exclusivity.
 *
 * @remarks
 * Deliberately a superset of {@link LabelRefRow}, so a route that has just written a label set
 * can serialize it directly instead of reading back what it only now wrote.
 */
export interface ResolvedLabel extends LabelRefRow {
  readonly groupId: string | null;
  /** Null when ungrouped or when the group is a non-exclusive (purely visual) cluster. */
  readonly exclusiveGroupId: string | null;
}

/** A resolved Label plus the Team scope used to validate bulk attachment targets. */
export interface ScopedResolvedLabel extends ResolvedLabel {
  readonly teamId: string | null;
}

/**
 * Delete + insert for one join table.
 *
 * @remarks
 * A lookup table of `{ table, column }` would not type-check across five differently-shaped
 * tables without casting, and a cast here would be a cast on the exact line that keeps tenant
 * data separated. Two small closures per entity stay fully typed instead.
 */
interface LabelJoin {
  readonly clear: (tx: Tx, subjectId: string, orgId: string) => Promise<unknown>;
  readonly attach: (
    tx: Tx,
    subjectId: string,
    orgId: string,
    labelIds: readonly string[],
  ) => Promise<unknown>;
  /** Count attachments per label id, for the settings page's usage counts. */
  readonly countsFor: (dbh: Db, orgId: string) => Promise<{ labelId: string; count: number }[]>;
  /** Read every attachment for a batch of subjects, joined to the label itself. */
  readonly hydrate: (
    dbh: Db,
    orgId: string,
    subjectIds: readonly string[],
  ) => Promise<{ subjectId: string; id: string; name: string; color: string }[]>;
}

/** The label columns a chip needs; shared by every join's `hydrate`. */
const LABEL_REF_COLUMNS = { id: label.id, name: label.name, color: label.color };

const JOINS: Record<LabelableKind, LabelJoin> = {
  task: {
    clear: (tx, id, orgId) =>
      tx
        .delete(taskLabel)
        .where(and(eq(taskLabel.taskId, id), eq(taskLabel.organizationId, orgId))),
    attach: (tx, id, orgId, labelIds) =>
      tx
        .insert(taskLabel)
        .values(labelIds.map((labelId) => ({ taskId: id, labelId, organizationId: orgId }))),
    countsFor: (dbh, orgId) =>
      dbh
        .select({ labelId: taskLabel.labelId, count: sql<number>`count(*)::int` })
        .from(taskLabel)
        .where(eq(taskLabel.organizationId, orgId))
        .groupBy(taskLabel.labelId),
    hydrate: (dbh, orgId, subjectIds) =>
      dbh
        .select({ subjectId: taskLabel.taskId, ...LABEL_REF_COLUMNS })
        .from(taskLabel)
        .innerJoin(label, eq(label.id, taskLabel.labelId))
        .where(and(eq(taskLabel.organizationId, orgId), inArray(taskLabel.taskId, [...subjectIds])))
        .orderBy(label.name),
  },
  project: {
    clear: (tx, id, orgId) =>
      tx
        .delete(projectLabel)
        .where(and(eq(projectLabel.projectId, id), eq(projectLabel.organizationId, orgId))),
    attach: (tx, id, orgId, labelIds) =>
      tx
        .insert(projectLabel)
        .values(labelIds.map((labelId) => ({ projectId: id, labelId, organizationId: orgId }))),
    countsFor: (dbh, orgId) =>
      dbh
        .select({ labelId: projectLabel.labelId, count: sql<number>`count(*)::int` })
        .from(projectLabel)
        .where(eq(projectLabel.organizationId, orgId))
        .groupBy(projectLabel.labelId),
    hydrate: (dbh, orgId, subjectIds) =>
      dbh
        .select({ subjectId: projectLabel.projectId, ...LABEL_REF_COLUMNS })
        .from(projectLabel)
        .innerJoin(label, eq(label.id, projectLabel.labelId))
        .where(
          and(
            eq(projectLabel.organizationId, orgId),
            inArray(projectLabel.projectId, [...subjectIds]),
          ),
        )
        .orderBy(label.name),
  },
  initiative: {
    clear: (tx, id, orgId) =>
      tx
        .delete(initiativeLabel)
        .where(
          and(eq(initiativeLabel.initiativeId, id), eq(initiativeLabel.organizationId, orgId)),
        ),
    attach: (tx, id, orgId, labelIds) =>
      tx
        .insert(initiativeLabel)
        .values(labelIds.map((labelId) => ({ initiativeId: id, labelId, organizationId: orgId }))),
    countsFor: (dbh, orgId) =>
      dbh
        .select({ labelId: initiativeLabel.labelId, count: sql<number>`count(*)::int` })
        .from(initiativeLabel)
        .where(eq(initiativeLabel.organizationId, orgId))
        .groupBy(initiativeLabel.labelId),
    hydrate: (dbh, orgId, subjectIds) =>
      dbh
        .select({ subjectId: initiativeLabel.initiativeId, ...LABEL_REF_COLUMNS })
        .from(initiativeLabel)
        .innerJoin(label, eq(label.id, initiativeLabel.labelId))
        .where(
          and(
            eq(initiativeLabel.organizationId, orgId),
            inArray(initiativeLabel.initiativeId, [...subjectIds]),
          ),
        )
        .orderBy(label.name),
  },
  program: {
    clear: (tx, id, orgId) =>
      tx
        .delete(programLabel)
        .where(and(eq(programLabel.programId, id), eq(programLabel.organizationId, orgId))),
    attach: (tx, id, orgId, labelIds) =>
      tx
        .insert(programLabel)
        .values(labelIds.map((labelId) => ({ programId: id, labelId, organizationId: orgId }))),
    countsFor: (dbh, orgId) =>
      dbh
        .select({ labelId: programLabel.labelId, count: sql<number>`count(*)::int` })
        .from(programLabel)
        .where(eq(programLabel.organizationId, orgId))
        .groupBy(programLabel.labelId),
    hydrate: (dbh, orgId, subjectIds) =>
      dbh
        .select({ subjectId: programLabel.programId, ...LABEL_REF_COLUMNS })
        .from(programLabel)
        .innerJoin(label, eq(label.id, programLabel.labelId))
        .where(
          and(
            eq(programLabel.organizationId, orgId),
            inArray(programLabel.programId, [...subjectIds]),
          ),
        )
        .orderBy(label.name),
  },
  resource: {
    clear: (tx, id, orgId) =>
      tx
        .delete(resourceLabel)
        .where(and(eq(resourceLabel.resourceId, id), eq(resourceLabel.organizationId, orgId))),
    attach: (tx, id, orgId, labelIds) =>
      tx
        .insert(resourceLabel)
        .values(labelIds.map((labelId) => ({ resourceId: id, labelId, organizationId: orgId }))),
    countsFor: (dbh, orgId) =>
      dbh
        .select({ labelId: resourceLabel.labelId, count: sql<number>`count(*)::int` })
        .from(resourceLabel)
        .where(eq(resourceLabel.organizationId, orgId))
        .groupBy(resourceLabel.labelId),
    hydrate: (dbh, orgId, subjectIds) =>
      dbh
        .select({ subjectId: resourceLabel.resourceId, ...LABEL_REF_COLUMNS })
        .from(resourceLabel)
        .innerJoin(label, eq(label.id, resourceLabel.labelId))
        .where(
          and(
            eq(resourceLabel.organizationId, orgId),
            inArray(resourceLabel.resourceId, [...subjectIds]),
          ),
        )
        .orderBy(label.name),
  },
};

/** Every labelable kind, for callers that need to sweep all five joins. */
export const LABELABLE_KINDS = Object.keys(JOINS) as readonly LabelableKind[];

/**
 * Collapse an ordered label set so at most one member of each exclusive group survives.
 *
 * @remarks
 * **Last occurrence wins.** That is the rule that makes one function serve both call shapes:
 * a picker replacing the whole set sends `[…, justClicked]`, and an automation attaching a
 * single label sends `[…existing, incoming]` — in both, the label the caller most recently
 * asked for is the one at the end, and it is the one that should survive.
 *
 * Ungrouped labels and members of non-exclusive groups always survive; they carry a null
 * `exclusiveGroupId` and so never collide.
 *
 * @param labels - The desired set, in caller order.
 * @returns The set with exclusive-group collisions resolved, preserving first-seen order.
 */
export function applyExclusivity(labels: readonly ResolvedLabel[]): ResolvedLabel[] {
  // Walk backwards so the *last* member of each exclusive group is the one kept, then restore
  // the caller's order for a stable, predictable write.
  const claimed = new Set<string>();
  const keptIds = new Set<string>();
  for (let i = labels.length - 1; i >= 0; i--) {
    const candidate = labels[i];
    if (!candidate) continue;
    const groupKey = candidate.exclusiveGroupId;
    if (groupKey !== null) {
      if (claimed.has(groupKey)) continue;
      claimed.add(groupKey);
    }
    keptIds.add(candidate.id);
  }
  return labels.filter((l) => keptIds.has(l.id));
}

/**
 * Hydrate a Label catalog once for bulk in-memory scope and exclusivity validation.
 *
 * @param orgId - The verified tenant id.
 * @param labelIds - Label ids to hydrate.
 * @param dbh - Optional transaction-owned database handle.
 * @returns resolved Labels including their owning Team scope.
 */
export async function resolveLabelCatalog(
  orgId: string,
  labelIds: readonly string[],
  dbh: Db = db,
): Promise<ScopedResolvedLabel[]> {
  const unique = [...new Set(labelIds)];
  if (unique.length === 0) return [];
  const rows = await dbh
    .select({
      ...LABEL_REF_COLUMNS,
      teamId: label.teamId,
      groupId: label.groupId,
      groupExclusive: labelGroup.exclusive,
    })
    .from(label)
    .leftJoin(labelGroup, eq(labelGroup.id, label.groupId))
    .where(and(eq(label.organizationId, orgId), inArray(label.id, unique)));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    teamId: row.teamId,
    groupId: row.groupId,
    exclusiveGroupId: row.groupExclusive === true ? row.groupId : null,
  }));
}

/**
 * Validate label ids against the org (and, when given, a team) and resolve exclusivity.
 *
 * @remarks
 * A label is offerable to a subject when it is workspace-wide (`teamId` null) or scoped to one of
 * the subject's owning Teams. Passing `teamId` or `teamIds` narrows to those Teams; omitting both
 * accepts only workspace-wide labels, which is the correct default for entities that have no Team
 * of their own.
 *
 * @param orgId - The verified tenant id.
 * @param labelIds - Requested label ids, in caller order; duplicates are collapsed.
 * @param options - Optional `teamId` or `teamIds` to admit labels from valid owning Teams, and a
 *   `dbh` to read inside an open transaction.
 * @returns The resolved, exclusivity-collapsed set in caller order.
 * @throws {NotFoundError} When any id is unknown, cross-org, or scoped to a different team.
 */
export async function resolveLabelSet(
  orgId: string,
  labelIds: readonly string[] | undefined,
  options: {
    teamId?: string | null | undefined;
    teamIds?: readonly string[] | undefined;
    dbh?: Db | undefined;
  } = {},
): Promise<ResolvedLabel[]> {
  const unique = [...new Set(labelIds ?? [])];
  if (unique.length === 0) return [];

  const { teamId = null, teamIds = [], dbh = db } = options;
  const validTeamIds = [...new Set([...teamIds, ...(teamId ? [teamId] : [])])];
  const scope =
    validTeamIds.length > 0
      ? or(isNull(label.teamId), inArray(label.teamId, validTeamIds))
      : isNull(label.teamId);

  const rows = await dbh
    .select({
      ...LABEL_REF_COLUMNS,
      groupId: label.groupId,
      groupExclusive: labelGroup.exclusive,
    })
    .from(label)
    .leftJoin(labelGroup, eq(labelGroup.id, label.groupId))
    .where(and(eq(label.organizationId, orgId), scope, inArray(label.id, unique)));

  if (rows.length !== unique.length) throw new NotFoundError('Label not found');

  const byId = new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        color: r.color,
        groupId: r.groupId,
        // A non-exclusive group is a visual cluster, so it must not constrain the write.
        exclusiveGroupId: r.groupExclusive === true ? r.groupId : null,
      } satisfies ResolvedLabel,
    ]),
  );

  // Preserve caller order — `applyExclusivity` depends on it to decide which member wins.
  const ordered = unique.map((id) => byId.get(id)).filter((l): l is ResolvedLabel => l != null);
  return applyExclusivity(ordered);
}

/**
 * Resolve labels a subject *already carries*, leniently.
 *
 * @remarks
 * Deliberately not {@link resolveLabelSet}. That one answers "may these be applied?" and throws on
 * anything unoffered, which is right for a write the caller is proposing. This one answers "what
 * is on this thing?", where rejection makes no sense — the rows are already attached.
 *
 * The distinction is load-bearing because narrowing a label to a team is non-destructive by
 * design: subjects outside that team keep it. Resolving an existing set strictly would therefore
 * throw on exactly the state the scoping feature creates, and in the automation engine — whose
 * contract is that a rule may misfire but must never throw — that would turn a settings tweak
 * into failing rules on unrelated tasks.
 *
 * Unknown ids are dropped rather than raised: a label deleted between the join read and this one
 * is not an error, it is just gone.
 *
 * @param orgId - The verified tenant id.
 * @param labelIds - Ids read off a join table.
 * @param dbh - Optional handle, to read inside an open transaction.
 * @returns The resolved labels, without exclusivity collapse (the stored set is what it is).
 */
export async function resolveAttachedLabels(
  orgId: string,
  labelIds: readonly string[],
  dbh: Db = db,
): Promise<ResolvedLabel[]> {
  const unique = [...new Set(labelIds)];
  if (unique.length === 0) return [];
  const rows = await dbh
    .select({
      ...LABEL_REF_COLUMNS,
      groupId: label.groupId,
      groupExclusive: labelGroup.exclusive,
    })
    .from(label)
    .leftJoin(labelGroup, eq(labelGroup.id, label.groupId))
    .where(and(eq(label.organizationId, orgId), inArray(label.id, unique)));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    groupId: r.groupId,
    exclusiveGroupId: r.groupExclusive === true ? r.groupId : null,
  }));
}

/**
 * Replace a subject's entire label set, inside a caller-supplied transaction.
 *
 * @param tx - The open transaction; the caller owns the boundary.
 * @param kind - Which entity is being labeled.
 * @param subjectId - The entity's id.
 * @param orgId - The verified tenant id, frozen onto every join row.
 * @param labels - The resolved set from {@link resolveLabelSet}.
 */
export async function replaceLabels(
  tx: Tx,
  kind: LabelableKind,
  subjectId: string,
  orgId: string,
  labels: readonly ResolvedLabel[],
): Promise<void> {
  const join = JOINS[kind];
  await join.clear(tx, subjectId, orgId);
  if (labels.length > 0) {
    await join.attach(
      tx,
      subjectId,
      orgId,
      labels.map((l) => l.id),
    );
  }
}

/**
 * Attach labels to a subject without disturbing the ones already on it.
 *
 * @remarks
 * The incremental path, used by `task.applyLabel` and by MCP writes. It still runs the union
 * through {@link applyExclusivity}, so attaching `Type: Bug` to something already carrying
 * `Type: Feature` swaps rather than stacks — the same outcome a human gets in the picker.
 *
 * @param tx - The open transaction.
 * @param kind - Which entity is being labeled.
 * @param subjectId - The entity's id.
 * @param orgId - The verified tenant id.
 * @param existing - The subject's current labels.
 * @param incoming - The labels to add, which win any exclusive-group collision.
 */
export async function attachLabels(
  tx: Tx,
  kind: LabelableKind,
  subjectId: string,
  orgId: string,
  existing: readonly ResolvedLabel[],
  incoming: readonly ResolvedLabel[],
): Promise<ResolvedLabel[]> {
  const incomingIds = new Set(incoming.map((l) => l.id));
  const union = [...existing.filter((l) => !incomingIds.has(l.id)), ...incoming];
  const next = applyExclusivity(union);
  await replaceLabels(tx, kind, subjectId, orgId, next);
  return next;
}

/**
 * Read the labels attached to a batch of subjects, in one query.
 *
 * @remarks
 * The batch shape is the point. A list endpoint hydrates its whole page with a single call, so
 * rendering label chips on 200 rows costs one extra query rather than 200 — and the rows arrive
 * already labeled instead of flashing unlabeled while each one fetches its own.
 *
 * Labels come back sorted by name so a row's chips are in a stable order between reads.
 *
 * @param kind - Which entity the subjects are.
 * @param orgId - The verified tenant id.
 * @param subjectIds - The subjects to hydrate; an empty list short-circuits.
 * @param dbh - Optional handle, to read inside an open transaction.
 * @returns A map of subject id → its labels. Unlabeled subjects are absent.
 */
export async function labelsForSubjects(
  kind: LabelableKind,
  orgId: string,
  subjectIds: readonly string[],
  dbh: Db = db,
): Promise<Map<string, LabelRefRow[]>> {
  const byId = new Map<string, LabelRefRow[]>();
  if (subjectIds.length === 0) return byId;
  const rows = await JOINS[kind].hydrate(dbh, orgId, subjectIds);
  for (const row of rows) {
    const list = byId.get(row.subjectId) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    byId.set(row.subjectId, list);
  }
  return byId;
}

/**
 * Read the labels attached to one subject.
 *
 * @param kind - Which entity the subject is.
 * @param orgId - The verified tenant id.
 * @param subjectId - The subject's id.
 * @param dbh - Optional handle, to read inside an open transaction.
 * @returns Its labels, sorted by name; empty when unlabeled.
 */
export async function labelsForSubject(
  kind: LabelableKind,
  orgId: string,
  subjectId: string,
  dbh: Db = db,
): Promise<LabelRefRow[]> {
  return (await labelsForSubjects(kind, orgId, [subjectId], dbh)).get(subjectId) ?? [];
}

/**
 * Total attachments per label across all five joins.
 *
 * @remarks
 * Five grouped counts rather than one big union, because each join is a different table and the
 * per-org label set is small and unpaginated by design. Labels with no attachments are absent
 * from the map, which is what the settings page's "Unused" section reads.
 *
 * @param orgId - The verified tenant id.
 * @param dbh - Optional handle, to read inside an open transaction.
 * @returns A map of label id → total attachment count.
 */
export async function labelUsageCounts(orgId: string, dbh: Db = db): Promise<Map<string, number>> {
  const perKind = await Promise.all(
    LABELABLE_KINDS.map((kind) => JOINS[kind].countsFor(dbh, orgId)),
  );
  const totals = new Map<string, number>();
  for (const rows of perKind) {
    for (const row of rows) {
      totals.set(row.labelId, (totals.get(row.labelId) ?? 0) + row.count);
    }
  }
  return totals;
}

/**
 * Move every attachment from one label onto another, then delete the source.
 *
 * @remarks
 * The operation the settings page calls "merge", and the reason renaming a label into a name
 * that already exists is offered as a merge rather than rejected as a conflict — post-import
 * cleanup is otherwise a manual re-tagging job across hundreds of rows.
 *
 * Each join is re-pointed with an `insert … select … on conflict do nothing`, so a subject
 * already carrying both labels collapses to one row instead of violating the composite primary
 * key. The source's rows then cascade away with the source itself.
 *
 * @param tx - The open transaction; merge is all-or-nothing.
 * @param orgId - The verified tenant id.
 * @param sourceId - The label being dissolved.
 * @param targetId - The surviving label.
 */
export async function mergeLabelAttachments(
  tx: Tx,
  orgId: string,
  sourceId: string,
  targetId: string,
): Promise<void> {
  const moves = [
    sql`insert into task_label (task_id, label_id, organization_id)
        select task_id, ${targetId}, organization_id from task_label
        where label_id = ${sourceId} and organization_id = ${orgId}
        on conflict do nothing`,
    sql`insert into project_label (project_id, label_id, organization_id)
        select project_id, ${targetId}, organization_id from project_label
        where label_id = ${sourceId} and organization_id = ${orgId}
        on conflict do nothing`,
    sql`insert into initiative_label (initiative_id, label_id, organization_id)
        select initiative_id, ${targetId}, organization_id from initiative_label
        where label_id = ${sourceId} and organization_id = ${orgId}
        on conflict do nothing`,
    sql`insert into program_label (program_id, label_id, organization_id)
        select program_id, ${targetId}, organization_id from program_label
        where label_id = ${sourceId} and organization_id = ${orgId}
        on conflict do nothing`,
    sql`insert into resource_label (resource_id, label_id, organization_id)
        select resource_id, ${targetId}, organization_id from resource_label
        where label_id = ${sourceId} and organization_id = ${orgId}
        on conflict do nothing`,
  ];
  for (const move of moves) await tx.execute(move);
  await tx.delete(label).where(and(eq(label.id, sourceId), eq(label.organizationId, orgId)));
}

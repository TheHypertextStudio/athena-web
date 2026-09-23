/**
 * `@docket/api` — change sets for REST writes to projects, programs, and initiatives.
 *
 * @remarks
 * Every REST mutation of a container records one change set, so provenance can say who made the
 * change and through which door. The REST middleware has already declared the provenance scope;
 * these helpers add the operation name, shape the entries, and write them. MCP tools record their
 * own change sets, so the shared write helpers they call never use this module.
 *
 * The create, update, and removal recorders return the row they were given, so a route can record
 * on the same line that returns the row from its transaction.
 */
import { db, initiative, program, type project } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';

import { originFor } from '../lib/provenance/context';
import {
  recordChangeSet,
  recordChangeSetInTransaction,
  trackedFields,
  type ChangeRecord,
  type LinkRecord,
  type RecordedChange,
  type RelationKind,
} from '../mcp/change-set';

/** The database transaction handle a route writes through. */
export type RouteTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The workspace, member, and optional open transaction a REST change is recorded under. */
export interface ChangeScope {
  readonly orgId: string;
  readonly actorId: string;
  /** Record inside this transaction; without one the change set gets its own. */
  readonly tx?: RouteTx | undefined;
}

/** The container kinds this module records. */
export type ContainerKind = 'project' | 'program' | 'initiative';

/** A project, program, or initiative row. */
export type ContainerRow =
  typeof project.$inferSelect | typeof program.$inferSelect | typeof initiative.$inferSelect;

/** A scope whose transaction is required, for reads that must see the uncommitted write. */
export interface TxChangeScope extends ChangeScope {
  readonly tx: RouteTx;
}

/** One label reference, by id. */
export interface LabelIdRef {
  readonly id: string;
}

/** A named project reference, enough to record its label links. */
export interface ProjectRef {
  readonly id: string;
  readonly name: string;
}

/**
 * Request fields a relation entry records instead of an entity update.
 *
 * @remarks
 * A project's labels and initiative links are relation kinds of their own, so a PATCH that only
 * replaces them records link entries alone. Programs and initiatives have no label relation kind,
 * so their `labelIds` counts as an update to the entity.
 */
const LINKED_FIELDS: Record<ContainerKind, readonly string[]> = {
  project: ['labelIds', 'initiativeIds'],
  program: [],
  initiative: [],
};

/** Write one change set for `tool`; nothing is written when `changes` is empty. */
async function write(
  scope: ChangeScope,
  tool: string,
  summary: string,
  changes: readonly RecordedChange[],
): Promise<string | null> {
  if (changes.length === 0) return null;
  const input = {
    orgId: scope.orgId,
    actorId: scope.actorId,
    origin: originFor(tool),
    summary,
    changes,
  };
  return scope.tx ? recordChangeSetInTransaction(scope.tx, input) : recordChangeSet(input);
}

/** The update entry for a row whose tracked fields went from `before` to `after`. */
function updateEntry(kind: ContainerKind, before: ContainerRow, after: ContainerRow): ChangeRecord {
  return {
    kind,
    id: after.id,
    op: 'update',
    before: trackedFields(kind, before),
    after: trackedFields(kind, after),
  };
}

/** Whether a request body asked to change any field that is not recorded as a relation. */
function requestedFieldChange(kind: ContainerKind, request: object): boolean {
  const linked = LINKED_FIELDS[kind];
  return Object.entries(request).some(
    ([key, value]) => value !== undefined && !linked.includes(key),
  );
}

/**
 * Link entries for the edges from `from` that a replacement added or removed.
 *
 * @param kind - The relation.
 * @param from - The endpoint every edge shares.
 * @param before - The other endpoints before the write.
 * @param after - The other endpoints after the write.
 * @returns one linked entry per new edge and one unlinked entry per removed edge.
 */
export function edgeChanges(
  kind: RelationKind,
  from: string,
  before: readonly string[],
  after: readonly string[],
): LinkRecord[] {
  const was = new Set(before);
  const now = new Set(after);
  return [
    ...[...now].filter((to) => !was.has(to)).map((to) => ({ kind, from, to, linked: true })),
    ...[...was].filter((to) => !now.has(to)).map((to) => ({ kind, from, to, linked: false })),
  ];
}

/**
 * Record the creation of a program or initiative.
 *
 * @param scope - Where to record it.
 * @param kind - The entity kind.
 * @param row - The created row.
 * @returns the same row.
 */
export async function recordCreate<T extends ContainerRow>(
  scope: ChangeScope,
  kind: ContainerKind,
  row: T,
): Promise<T> {
  const entry: ChangeRecord = { kind, id: row.id, op: 'create', after: trackedFields(kind, row) };
  await write(scope, `${kind}_create`, `Created "${row.name}"`, [entry]);
  return row;
}

/**
 * Record the creation of a project with the initiative links and labels it was created with.
 *
 * @param scope - Where to record it.
 * @param row - The created project.
 * @param initiativeIds - The initiatives it was linked to.
 * @param labels - The labels it was created with.
 * @returns the same row.
 */
export async function recordProjectCreate<T extends typeof project.$inferSelect>(
  scope: ChangeScope,
  row: T,
  initiativeIds: readonly string[],
  labels: readonly LabelIdRef[],
): Promise<T> {
  const labelIds = labels.map((label) => label.id);
  await write(scope, 'project_create', `Created "${row.name}"`, [
    { kind: 'project', id: row.id, op: 'create', after: trackedFields('project', row) },
    ...edgeChanges('project_contributes_to', row.id, [], initiativeIds),
    ...edgeChanges('project_has_label', row.id, [], labelIds),
  ]);
  return row;
}

/**
 * Record a PATCH to a project, including any label and initiative links it replaced.
 *
 * @param scope - Where to record it.
 * @param before - The row before the write.
 * @param after - The row after the write, or undefined when it was not found.
 * @param request - The validated request body.
 * @param links - The relation edges the write added or removed.
 * @returns `after`.
 */
export async function recordProjectUpdate<T extends typeof project.$inferSelect>(
  scope: ChangeScope,
  before: T,
  after: T | undefined,
  request: object,
  links: readonly LinkRecord[],
): Promise<T | undefined> {
  if (!after) return after;
  const entries: RecordedChange[] = requestedFieldChange('project', request)
    ? [updateEntry('project', before, after), ...links]
    : [...links];
  await write(scope, 'project_update', `Updated "${after.name}"`, entries);
  return after;
}

/**
 * Record a PATCH to a program or initiative.
 *
 * @param scope - Where to record it.
 * @param kind - The entity kind.
 * @param before - The row before the write.
 * @param after - The row after the write, or undefined when it was not found.
 * @param request - The validated request body; a body with no fields records nothing.
 * @returns `after`.
 */
export async function recordUpdate<T extends ContainerRow>(
  scope: ChangeScope,
  kind: ContainerKind,
  before: T,
  after: T | undefined,
  request: object,
): Promise<T | undefined> {
  if (!after || !requestedFieldChange(kind, request)) return after;
  await write(scope, `${kind}_update`, `Updated "${after.name}"`, [
    updateEntry(kind, before, after),
  ]);
  return after;
}

/**
 * Record a label added to a program or initiative, as an update to the entity.
 *
 * @param scope - Where to record it.
 * @param kind - The entity kind.
 * @param row - The labeled row; labels are not tracked columns, so before and after match.
 */
export async function recordLabelUpdate(
  scope: ChangeScope,
  kind: ContainerKind,
  row: ContainerRow,
): Promise<void> {
  await write(scope, `${kind}_label_add`, `Labeled "${row.name}"`, [updateEntry(kind, row, row)]);
}

/**
 * Record the label links a project gained or lost when one label was added.
 *
 * @param scope - Where to record it.
 * @param subject - The project.
 * @param before - Its labels before the write.
 * @param after - Its labels after the write, which may drop an exclusive sibling.
 */
export async function recordProjectLabels(
  scope: ChangeScope,
  subject: ProjectRef,
  before: readonly LabelIdRef[],
  after: readonly LabelIdRef[],
): Promise<void> {
  const links = edgeChanges(
    'project_has_label',
    subject.id,
    before.map((label) => label.id),
    after.map((label) => label.id),
  );
  await write(scope, 'project_label_add', `Labeled "${subject.name}"`, links);
}

/**
 * Record a deleted container as an archive entry holding its last tracked state.
 *
 * @param scope - Where to record it.
 * @param kind - The entity kind.
 * @param row - The deleted row, or undefined when nothing was deleted.
 * @returns the same row.
 */
export async function recordRemoval<T extends ContainerRow>(
  scope: ChangeScope,
  kind: ContainerKind,
  row: T | undefined,
): Promise<T | undefined> {
  if (!row) return row;
  const entry: ChangeRecord = { kind, id: row.id, op: 'archive', before: trackedFields(kind, row) };
  await write(scope, `${kind}_delete`, `Deleted "${row.name}"`, [entry]);
  return row;
}

/** The operation-name prefix for each relation; `_link` or `_unlink` completes it. */
const LINK_TOOLS: Record<RelationKind, string> = {
  blocks: 'task_dependency',
  project_blocks: 'project_dependency',
  task_has_label: 'task_label',
  project_has_label: 'project_label',
  related_task: 'related_task',
  project_contributes_to: 'initiative_project',
  program_contributes_to: 'initiative_program',
};

/**
 * Record one relation edge added or removed.
 *
 * @param scope - Where to record it.
 * @param kind - The relation.
 * @param from - The edge's source endpoint.
 * @param to - The edge's target endpoint.
 * @param linked - True for an added edge, false for a removed one.
 */
export async function recordLink(
  scope: ChangeScope,
  kind: RelationKind,
  from: string,
  to: string,
  linked: boolean,
): Promise<void> {
  const tool = `${LINK_TOOLS[kind]}_${linked ? 'link' : 'unlink'}`;
  const summary = `${linked ? 'Linked' : 'Unlinked'} ${kind.replace(/_/g, ' ')}`;
  await write(scope, tool, summary, [{ kind, from, to, linked }]);
}

/** The operation name and summary verb for each hierarchy change. */
const HIERARCHY_CHANGES = {
  link: { tool: 'initiative_hierarchy_link', verb: 'Nested' },
  move: { tool: 'initiative_hierarchy_move', verb: 'Moved' },
  unlink: { tool: 'initiative_hierarchy_unlink', verb: 'Unnested' },
} as const;

/** A hierarchy change a route records. */
export type HierarchyChange = keyof typeof HIERARCHY_CHANGES;

/**
 * Record a hierarchy change as an update to each child initiative whose parent changed.
 *
 * @remarks
 * Parentage lives in `initiative_hierarchy_link`, not in a tracked initiative column, so each
 * entry's before and after are the child's tracked fields and match. The entry still names the
 * child, which is what provenance reads.
 *
 * @param scope - Where to record it; `tx` must be the transaction that changed the links.
 * @param change - Which hierarchy change happened.
 * @param childIds - The initiatives whose parent changed.
 */
export async function recordHierarchyChange(
  scope: TxChangeScope,
  change: HierarchyChange,
  childIds: readonly string[],
): Promise<void> {
  if (childIds.length === 0) return;
  const rows = await scope.tx
    .select()
    .from(initiative)
    .where(inArray(initiative.id, [...new Set(childIds)]));
  const { tool, verb } = HIERARCHY_CHANGES[change];
  const summary =
    rows.length === 1 && rows[0] ? `${verb} "${rows[0].name}"` : `${verb} initiatives`;
  await write(
    scope,
    tool,
    summary,
    rows.map((row) => updateEntry('initiative', row, row)),
  );
}

/**
 * Update a program's columns and record the change in the same transaction.
 *
 * @param scope - The workspace and member; any `tx` is ignored because this opens its own.
 * @param id - The program id.
 * @param request - The validated request body.
 * @param values - The columns to write; empty values leave the row unchanged.
 * @returns the updated row, or undefined when the program is not in the workspace.
 */
export async function updateProgramRecorded(
  scope: ChangeScope,
  id: string,
  request: object,
  values: Partial<typeof program.$inferInsert>,
): Promise<typeof program.$inferSelect | undefined> {
  const where = and(eq(program.id, id), eq(program.organizationId, scope.orgId));
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(program).where(where).limit(1).for('update');
    if (!before) return undefined;
    if (Object.keys(values).length === 0) return before;
    const [after] = await tx.update(program).set(values).where(where).returning();
    return recordUpdate({ ...scope, tx }, 'program', before, after, request);
  });
}

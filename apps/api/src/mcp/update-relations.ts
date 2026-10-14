/**
 * `@docket/api` — the relation fields of the `update` tool: `cycle` and `initiatives`.
 *
 * @remarks
 * "Move everything open in the migration project into next sprint" and "these five projects are
 * part of Q3 now" are bulk statements, so they ride on `update`'s scope and report card rather
 * than needing one `link` call per item.
 *
 * A cycle belongs to one team, the same rule the task routes enforce, so a row on another team is
 * reported as `cycle_out_of_team` and left entirely alone. Initiative membership is many-to-many
 * and is edited like labels — add, remove, or replace — and every edge that moves is recorded as a
 * `contributes_to` link, so `undo` puts back exactly the set the item had.
 */
import { cycle, db, initiative, initiativeProgram, initiativeProject } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { ValidationError } from '../error';
import { edgeChanges } from '../routes/container-change-sets';
import type { FieldDiff } from './catalog-rows';
import type { LinkRecord } from './change-set';
import { DESCRIPTOR_HINT, resolveDescriptor, resolveOptional } from './descriptors';

/** The `set.cycle` wire field. */
export const cycleSetField = z
  .string()
  .nullable()
  .optional()
  .describe(
    `The cycle a task is planned into, or null to take it out of one. A cycle belongs to one team; a task on another team is skipped with reason cycle_out_of_team. ${DESCRIPTOR_HINT}`,
  );

/** The `set.initiatives` wire field. */
export const initiativesSetField = z
  .object({
    add: z.array(z.string()).optional().describe('Initiatives each item should contribute to.'),
    remove: z.array(z.string()).optional().describe('Initiatives to stop contributing to.'),
    replace: z
      .array(z.string())
      .optional()
      .describe(
        'The exact initiatives each item should end with; an empty list detaches it from all of them. Cannot be combined with add or remove.',
      ),
  })
  .optional()
  .describe(
    `Change which initiatives projects or programs contribute to. ${DESCRIPTOR_HINT} For a single item, link with relation contributes_to does the same.`,
  );

/** Where `set.cycle` points, resolved once for every row. */
export interface CycleTarget {
  /** The cycle id, or null to take tasks out of their cycle. */
  readonly cycleId: string | null;
  /** The team the cycle belongs to, or null when clearing. */
  readonly teamId: string | null;
}

/**
 * Resolve `set.cycle` before any row is touched.
 *
 * @returns the target, or undefined when the caller did not mention a cycle.
 */
export async function resolveCycleTarget(
  orgId: string,
  value: string | null | undefined,
): Promise<CycleTarget | undefined> {
  const cycleId = await resolveOptional(orgId, 'cycle', value, 'set.cycle');
  if (cycleId === undefined) return undefined;
  if (cycleId === null) return { cycleId: null, teamId: null };
  const [row] = await db
    .select({ teamId: cycle.teamId })
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.organizationId, orgId)))
    .limit(1);
  return { cycleId, teamId: row?.teamId ?? null };
}

/** Whether a row on `teamId` may be planned into the target cycle. */
export function cycleFitsRow(target: CycleTarget | undefined, teamId: string | null): boolean {
  return target?.teamId === undefined || target.teamId === null || target.teamId === teamId;
}

/** The caller's initiative change, resolved to ids once for every row. */
export interface InitiativeEdit {
  readonly add: readonly string[];
  readonly remove: ReadonlySet<string>;
  readonly replace: readonly string[] | undefined;
}

/** Resolve names or ids to initiative ids, keeping the caller's order and dropping repeats. */
async function resolveAll(
  orgId: string,
  values: readonly string[],
  field: string,
): Promise<string[]> {
  const ids = await Promise.all(
    values.map((value) => resolveDescriptor(orgId, 'initiative', value, field)),
  );
  return [...new Set(ids)];
}

/**
 * Resolve `set.initiatives` before any row is touched.
 *
 * @returns the resolved edit, or undefined when the caller did not mention initiatives.
 * @throws {ValidationError} When `replace` is combined with `add` or `remove`, or a name matches
 *   no initiative.
 */
export async function resolveInitiativeEdit(
  orgId: string,
  value: z.infer<typeof initiativesSetField>,
): Promise<InitiativeEdit | undefined> {
  if (value === undefined) return undefined;
  if (value.replace !== undefined && (value.add !== undefined || value.remove !== undefined)) {
    throw new ValidationError([
      { path: ['set', 'initiatives'], message: 'Use replace on its own, or add and remove.' },
    ]);
  }
  const [add, remove, replace] = await Promise.all([
    resolveAll(orgId, value.add ?? [], 'set.initiatives.add'),
    resolveAll(orgId, value.remove ?? [], 'set.initiatives.remove'),
    value.replace === undefined
      ? undefined
      : resolveAll(orgId, value.replace, 'set.initiatives.replace'),
  ]);
  return { add, remove: new Set(remove), replace };
}

/** Every initiative id an edit names, for authorizing them before any row is written. */
export function initiativesNamed(edit: InitiativeEdit): string[] {
  return [...new Set([...(edit.replace ?? []), ...edit.add, ...edit.remove])];
}

/** The membership table and columns for each kind of work that contributes to initiatives. */
const MEMBERSHIP = {
  project: {
    table: initiativeProject,
    subject: initiativeProject.projectId,
    org: initiativeProject.organizationId,
    initiative: initiativeProject.initiativeId,
    kind: 'project_contributes_to',
  },
  program: {
    table: initiativeProgram,
    subject: initiativeProgram.programId,
    org: initiativeProgram.organizationId,
    initiative: initiativeProgram.initiativeId,
    kind: 'program_contributes_to',
  },
} as const;

/** The kinds of work `set.initiatives` applies to. */
export type InitiativeMember = keyof typeof MEMBERSHIP;

/** The initiative set a row ends with. */
function nextInitiatives(edit: InitiativeEdit, current: readonly string[]): string[] {
  if (edit.replace !== undefined) return [...edit.replace];
  const kept = current.filter((id) => !edit.remove.has(id));
  return [...new Set([...kept, ...edit.add.filter((id) => !edit.remove.has(id))])];
}

/** Initiative names as one diff value, alphabetical so the two sides line up. */
async function names(orgId: string, ids: readonly string[]): Promise<string> {
  if (ids.length === 0) return 'none';
  const rows = await db
    .select({ name: initiative.name })
    .from(initiative)
    .where(and(eq(initiative.organizationId, orgId), inArray(initiative.id, [...ids])));
  return rows
    .map((row) => row.name)
    .sort()
    .join(', ');
}

/** What one row's membership write did: its diff line and its recorded edges. */
export interface RowInitiativeResult {
  readonly field: FieldDiff;
  readonly changes: LinkRecord[];
}

/**
 * Apply the edit to one row's initiative membership.
 *
 * @param member - Whether the row is a project or a program.
 * @param orgId - The organization.
 * @param subjectId - The row's id.
 * @param edit - The resolved edit.
 * @returns the diff line and recorded edges, or null when the set did not move.
 */
export async function applyInitiativeEdit(
  member: InitiativeMember,
  orgId: string,
  subjectId: string,
  edit: InitiativeEdit,
): Promise<RowInitiativeResult | null> {
  const m = MEMBERSHIP[member];
  const scope = and(eq(m.org, orgId), eq(m.subject, subjectId));
  const moved = await db.transaction(async (tx) => {
    const rows = await tx.select({ id: m.initiative }).from(m.table).where(scope).for('update');
    const current = rows.map((row) => row.id);
    const next = nextInitiatives(edit, current);
    const changes = edgeChanges(m.kind, subjectId, current, next);
    if (changes.length === 0) return null;
    const removed = changes.filter((change) => !change.linked).map((change) => change.to);
    const added = changes.filter((change) => change.linked).map((change) => change.to);
    if (removed.length > 0) {
      await tx.delete(m.table).where(and(scope, inArray(m.initiative, removed)));
    }
    if (added.length > 0 && member === 'project') {
      await tx.insert(initiativeProject).values(
        added.map((initiativeId) => ({
          organizationId: orgId,
          projectId: subjectId,
          initiativeId,
        })),
      );
    } else if (added.length > 0) {
      await tx.insert(initiativeProgram).values(
        added.map((initiativeId) => ({
          organizationId: orgId,
          programId: subjectId,
          initiativeId,
        })),
      );
    }
    return { current, next, changes };
  });
  if (!moved) return null;
  // Names are read after commit: a read on the pool while the transaction holds its connection
  // stalls on a single-connection database.
  const [from, to] = await Promise.all([names(orgId, moved.current), names(orgId, moved.next)]);
  return { field: { field: 'initiatives', from, to }, changes: moved.changes };
}

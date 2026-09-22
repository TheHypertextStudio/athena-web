/**
 * `@docket/api` — writes to the label vocabulary itself: labels and label groups.
 *
 * @remarks
 * `lib/labels.ts` puts labels on work; this module creates and edits the labels. The REST routes
 * and the MCP `define_labels` tool both call it, so a rule such as "a group and its labels share
 * one scope" holds no matter which surface made the change.
 *
 * Label names are unique across the whole org without regard to case, team scope included. The
 * database uniques are case-sensitive and per scope, so this module is what keeps `Bug` from
 * landing beside `bug`, and {@link withUniqueNames} turns the race two concurrent creates can
 * still lose into the same 409.
 */
import { db, label, labelGroup, team } from '@docket/db';
import {
  nextLabelColor,
  normalizeLabelName,
  type LabelColorKey,
  type LabelGroupOut,
  type LabelOut,
} from '@docket/work/label-contract';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../error';
import { enqueueSearchUpsert } from '../search/write-through';
import { hasSqlState } from './sql-state';

/** A label row. */
export type LabelRow = typeof label.$inferSelect;
/** A label group row. */
export type LabelGroupRow = typeof labelGroup.$inferSelect;

/** What a caller may set when creating a label. */
export interface LabelCreateInput {
  readonly name: string;
  readonly color?: LabelColorKey | undefined;
  readonly groupId?: string | null | undefined;
  /**
   * The team to limit the label to. `null` means workspace-wide and refuses a team-limited group;
   * omitted means the label takes its group's scope.
   */
  readonly teamId?: string | null | undefined;
}

/** What a caller may change on a label. Omitted fields stay as they are. */
export interface LabelUpdateInput {
  readonly name?: string | undefined;
  readonly color?: LabelColorKey | undefined;
  readonly groupId?: string | null | undefined;
  readonly teamId?: string | null | undefined;
}

/** What a caller may set when creating a label group. */
export interface LabelGroupCreateInput {
  readonly name: string;
  readonly exclusive?: boolean | undefined;
  readonly sortOrder?: number | undefined;
  readonly teamId?: string | null | undefined;
}

/** What a caller may change on a label group. Omitted fields stay as they are. */
export interface LabelGroupUpdateInput {
  readonly name?: string | undefined;
  readonly exclusive?: boolean | undefined;
  readonly sortOrder?: number | undefined;
  readonly teamId?: string | null | undefined;
}

/** Serialize a label row for `LabelOut`. */
export function toLabelOut(row: LabelRow, usageCount?: number): z.input<typeof LabelOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    color: row.color,
    groupId: row.groupId,
    teamId: row.teamId,
    ...(usageCount === undefined ? {} : { usageCount }),
    external: row.externalId != null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Serialize a label group row for `LabelGroupOut`. */
export function toLabelGroupOut(row: LabelGroupRow): z.input<typeof LabelGroupOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    exclusive: row.exclusive,
    sortOrder: row.sortOrder,
    teamId: row.teamId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Trim a name and collapse its internal whitespace, keeping the case the caller typed. */
export function tidyLabelName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Load a label group within the org.
 *
 * @throws {NotFoundError} When the group is unknown or belongs to another org.
 */
export async function requireLabelGroup(orgId: string, groupId: string): Promise<LabelGroupRow> {
  const [row] = await db
    .select()
    .from(labelGroup)
    .where(and(eq(labelGroup.id, groupId), eq(labelGroup.organizationId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Label group not found');
  return row;
}

/**
 * Load a label within the org.
 *
 * @throws {NotFoundError} When the label is unknown or belongs to another org.
 */
export async function requireLabel(orgId: string, labelId: string): Promise<LabelRow> {
  const [row] = await db
    .select()
    .from(label)
    .where(and(eq(label.id, labelId), eq(label.organizationId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Label not found');
  return row;
}

/**
 * Refuse a team id that is not in this org.
 *
 * @remarks
 * The `team_id` foreign key only proves the team exists somewhere, so without this check a label
 * could be scoped to another tenant's team.
 *
 * @throws {NotFoundError} When the team is unknown or belongs to another org.
 */
async function assertTeamInOrg(orgId: string, teamId: string | null | undefined): Promise<void> {
  if (teamId == null) return;
  const [row] = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Team not found');
}

/**
 * Refuse a label name another label in the org already has, ignoring case.
 *
 * @returns How many labels the org has, which picks the next rotation color.
 * @throws {ConflictError} When the name is taken by a label other than `selfId`.
 */
async function assertLabelNameFree(orgId: string, name: string, selfId?: string): Promise<number> {
  const existing = await db
    .select({ id: label.id, name: label.name })
    .from(label)
    .where(eq(label.organizationId, orgId));
  const normalized = normalizeLabelName(name);
  if (existing.some((row) => row.id !== selfId && normalizeLabelName(row.name) === normalized)) {
    throw new ConflictError('A label with that name already exists');
  }
  return existing.length;
}

/**
 * Run a write and report a unique-index violation as a name conflict.
 *
 * @remarks
 * The name checks read before they write, so two concurrent creates can both pass them. The
 * database index then refuses the second, and the caller sees the same 409 the check would have
 * produced instead of a 500.
 */
async function withUniqueNames<T>(message: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (hasSqlState(err, '23505')) throw new ConflictError(message);
    throw err;
  }
}

/**
 * Work out the team scope a new label lands in.
 *
 * @throws {ConflictError} When an explicit scope disagrees with the group's.
 */
async function newLabelTeam(orgId: string, input: LabelCreateInput): Promise<string | null> {
  const group = input.groupId ? await requireLabelGroup(orgId, input.groupId) : undefined;
  if (input.teamId === undefined) return group?.teamId ?? null;
  // A group and its labels share one scope, so a label cannot join a group in another one.
  if (group && group.teamId !== input.teamId) {
    throw new ConflictError(
      input.teamId === null
        ? 'A new label is workspace-wide and cannot join a team-limited group'
        : 'A label must share its group’s team',
    );
  }
  return input.teamId;
}

/**
 * Create a label.
 *
 * @param orgId - The verified tenant id.
 * @param input - The label to create.
 * @returns The inserted row.
 * @throws {ConflictError} When the name is taken or the scope disagrees with the group.
 * @throws {NotFoundError} When the group or team is not in this org.
 */
export async function createLabel(orgId: string, input: LabelCreateInput): Promise<LabelRow> {
  await assertTeamInOrg(orgId, input.teamId);
  const teamId = await newLabelTeam(orgId, input);
  const name = tidyLabelName(input.name);
  const existingCount = await assertLabelNameFree(orgId, name);
  const [row] = await withUniqueNames('A label with that name already exists', () =>
    db
      .insert(label)
      .values({
        organizationId: orgId,
        name,
        color: input.color ?? nextLabelColor(existingCount),
        groupId: input.groupId ?? null,
        teamId,
      })
      .returning(),
  );
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('label insert returned no row');
  await enqueueSearchUpsert(orgId, 'label', row.id);
  return row;
}

/** Build the column patch for a label update, adopting a joined group's scope. */
async function labelPatch(
  orgId: string,
  input: LabelUpdateInput,
): Promise<Partial<typeof label.$inferInsert>> {
  // Joining a group adopts its scope; an explicit teamId in the same call wins.
  const adopted =
    input.groupId != null ? (await requireLabelGroup(orgId, input.groupId)).teamId : undefined;
  const teamId = input.teamId !== undefined ? input.teamId : adopted;
  return {
    ...(input.name !== undefined ? { name: tidyLabelName(input.name) } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
    ...(teamId !== undefined ? { teamId } : {}),
  };
}

/**
 * Update a label. An empty update returns the row unchanged.
 *
 * @param orgId - The verified tenant id.
 * @param id - The label to change.
 * @param input - The fields to change.
 * @returns The row after the update.
 * @throws {ConflictError} When a rename collides with another label.
 * @throws {NotFoundError} When the label, group, or team is not in this org.
 */
export async function updateLabel(
  orgId: string,
  id: string,
  input: LabelUpdateInput,
): Promise<LabelRow> {
  await assertTeamInOrg(orgId, input.teamId);
  if (input.name !== undefined) await assertLabelNameFree(orgId, input.name, id);
  const patch = await labelPatch(orgId, input);
  if (Object.keys(patch).length === 0) return requireLabel(orgId, id);
  const [row] = await withUniqueNames('A label with that name already exists', () =>
    db
      .update(label)
      .set(patch)
      .where(and(eq(label.id, id), eq(label.organizationId, orgId)))
      .returning(),
  );
  if (!row) throw new NotFoundError('Label not found');
  await enqueueSearchUpsert(orgId, 'label', row.id);
  return row;
}

/**
 * Create a label group.
 *
 * @param orgId - The verified tenant id.
 * @param input - The group to create.
 * @returns The inserted row.
 * @throws {ConflictError} When the name is taken in that scope.
 * @throws {NotFoundError} When the team is not in this org.
 */
export async function createLabelGroup(
  orgId: string,
  input: LabelGroupCreateInput,
): Promise<LabelGroupRow> {
  await assertTeamInOrg(orgId, input.teamId);
  const [row] = await withUniqueNames('A label group with that name already exists', () =>
    db
      .insert(labelGroup)
      .values({
        organizationId: orgId,
        name: tidyLabelName(input.name),
        exclusive: input.exclusive ?? true,
        sortOrder: input.sortOrder ?? 0,
        teamId: input.teamId ?? null,
      })
      .returning(),
  );
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('label group insert returned no row');
  return row;
}

/**
 * Update a label group. An empty update returns the row unchanged.
 *
 * @remarks
 * A change of `teamId` moves every member label with it in the same transaction, so a group and
 * its labels never disagree about scope.
 *
 * @param orgId - The verified tenant id.
 * @param id - The group to change.
 * @param input - The fields to change.
 * @returns The row after the update.
 * @throws {ConflictError} When a rename collides in that scope.
 * @throws {NotFoundError} When the group or team is not in this org.
 */
export async function updateLabelGroup(
  orgId: string,
  id: string,
  input: LabelGroupUpdateInput,
): Promise<LabelGroupRow> {
  await assertTeamInOrg(orgId, input.teamId);
  const patch = {
    ...(input.name !== undefined ? { name: tidyLabelName(input.name) } : {}),
    ...(input.exclusive !== undefined ? { exclusive: input.exclusive } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
  };
  if (Object.keys(patch).length === 0) return requireLabelGroup(orgId, id);
  const row = await withUniqueNames('A label group with that name already exists', () =>
    db.transaction(async (tx) => {
      const [changed] = await tx
        .update(labelGroup)
        .set(patch)
        .where(and(eq(labelGroup.id, id), eq(labelGroup.organizationId, orgId)))
        .returning();
      if (changed && input.teamId !== undefined) {
        await tx
          .update(label)
          .set({ teamId: input.teamId })
          .where(and(eq(label.groupId, id), eq(label.organizationId, orgId)));
      }
      return changed;
    }),
  );
  if (!row) throw new NotFoundError('Label group not found');
  return row;
}

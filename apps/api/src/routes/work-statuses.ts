/**
 * `@docket/api` — workspace statuses router (mounted at `/v1/orgs/:orgId/statuses`).
 *
 * @remarks
 * ## Why the write side is gated on `manage`
 *
 * A status is vocabulary the whole workspace already reads. Renaming one changes how every task,
 * project, program, and initiative carrying it renders; deleting one moves real work onto a
 * different status. That is restructuring, so it takes `manage`, matching the same split labels
 * draw between adding vocabulary and reshaping it. Reading the sets needs only workspace context,
 * because every picker and every list row depends on them.
 *
 * ## Why a delete names its replacement
 *
 * The composite foreign key on each work table refuses to drop a status while rows still point at
 * it, so a delete has to say where that work goes. Making the replacement an explicit parameter
 * turns "you cannot delete this" into "these forty tasks become Done", which is a decision the
 * person deleting is in a position to make and nobody downstream is.
 *
 * ## Why the invariants are checked in the transaction
 *
 * Every set has to keep a way to finish, a way to abandon, and somewhere for live work to sit.
 * Two concurrent deletes could each leave one behind and, checked outside a transaction, both
 * would pass. The row lock is what makes the check mean what it says.
 */
import { db, task, team, project, program, initiative, workStatus } from '@docket/db';
import {
  isTerminalCategory,
  WorkStatusCreate,
  WorkStatusDeleteResult,
  WorkStatusEntityType,
  WorkStatusOut,
  WorkStatusReorder,
  WorkStatusSetOut,
  WorkStatusUpdate,
  type WorkStatusCategory,
} from '@docket/types';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { loadStatusSets, terminalStampsFor, type ResolvedStatus } from '../lib/work-status';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchUpsert } from '../search/write-through';

type WorkStatusRow = typeof workStatus.$inferSelect;

function toOut(row: WorkStatusRow): z.input<typeof WorkStatusOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    entityType: row.entityType,
    teamId: row.teamId,
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    position: row.position,
    isDefault: row.isDefault,
  };
}

function setToOut(
  orgId: string,
  entityType: WorkStatusEntityType,
  teamId: string | null,
  forked: boolean,
  statuses: readonly ResolvedStatus[],
): z.input<typeof WorkStatusSetOut> {
  return {
    entityType,
    teamId,
    forked,
    statuses: statuses.map((status) => ({
      id: status.id,
      organizationId: orgId,
      entityType,
      teamId: status.teamId,
      key: status.key,
      name: status.name,
      description: status.description,
      category: status.category,
      position: status.position,
      isDefault: status.isDefault,
    })),
  };
}

/**
 * Turn a display name into a key that is unique within its set.
 *
 * @remarks
 * The key is what every row, saved view, automation rule, and connector mapping stores, and it
 * never changes again, so it is derived once here and a rename only moves `name`. Slugifying the
 * name keeps it legible in a stored filter; the numeric suffix only appears when a workspace has
 * two statuses whose names slugify the same way.
 *
 * @param name - The display name as typed.
 * @param taken - The keys already in this set.
 * @returns a key nothing in the set is using.
 */
function keyFrom(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'status';
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Every status in one set, locked for update so an invariant check means what it says. */
async function lockSet(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orgId: string,
  entityType: WorkStatusEntityType,
  teamId: string | null,
): Promise<WorkStatusRow[]> {
  return tx
    .select()
    .from(workStatus)
    .where(
      and(
        eq(workStatus.organizationId, orgId),
        eq(workStatus.entityType, entityType),
        teamId === null ? isNull(workStatus.teamId) : eq(workStatus.teamId, teamId),
      ),
    )
    .for('update');
}

/**
 * Refuse a set that could no longer describe the work in it.
 *
 * @remarks
 * These three are what the rest of the product assumes without checking: completing a task needs
 * somewhere to complete to, a connector mirroring an abandoned item needs somewhere to abandon
 * to, and work that is neither needs somewhere to live. Enforcing them here is what lets those
 * callers stop carrying fallbacks.
 *
 * @param remaining - The set as it would be after the write.
 * @throws {ConflictError} When the set would lose one of the three.
 */
function assertSetRemainsUsable(remaining: readonly { category: WorkStatusCategory }[]): void {
  if (remaining.length === 0) throw new ConflictError('A status set needs at least one status');
  if (!remaining.some((status) => status.category === 'completed')) {
    throw new ConflictError('A status set needs a way to finish work');
  }
  if (!remaining.some((status) => status.category === 'canceled')) {
    throw new ConflictError('A status set needs a way to abandon work');
  }
  if (!remaining.some((status) => !isTerminalCategory(status.category))) {
    throw new ConflictError('A status set needs a status for work that has not ended');
  }
}

/** Reject a team scope on a kind of work that is not team-scoped. */
function assertTeamScope(entityType: WorkStatusEntityType, teamId: string | null): void {
  if (teamId !== null && entityType !== 'task') {
    throw new ValidationError([
      { message: 'Only task statuses can belong to a team', path: ['teamId'] },
    ]);
  }
}

const setQuery = z.object({
  entityType: WorkStatusEntityType.optional(),
  teamId: z.string().optional(),
});

const statusIdParam = z.object({ statusId: z.string() });
const deleteQuery = z.object({ remapTo: z.string() });

const workStatuses = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Statuses',
      summary: 'List the workspace’s status sets',
      description:
        'Returns this workspace’s statuses for each kind of work it tracks: tasks, projects, programs, and initiatives. Each set comes back in board order — by category, then by position within it. Pass `teamId` to resolve the task set for a team: a team that keeps its own task statuses resolves to those, and every other team resolves to the workspace’s. Pass `entityType` to return a single set.',
      response: z.object({ items: z.array(WorkStatusSetOut) }),
    }),
    zQuery(setQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { entityType, teamId } = c.req.valid('query');
      const wanted: readonly WorkStatusEntityType[] =
        entityType === undefined ? WorkStatusEntityType.options : [entityType];
      // Every team that keeps its own task statuses, so a caller reading the whole workspace can
      // resolve a task on any team without a second request per team.
      const forkedTeams =
        teamId === undefined
          ? (
              await db
                .selectDistinct({ teamId: workStatus.teamId })
                .from(workStatus)
                .where(
                  and(
                    eq(workStatus.organizationId, orgId),
                    eq(workStatus.entityType, 'task'),
                    isNotNull(workStatus.teamId),
                  ),
                )
            )
              .map((row) => row.teamId)
              .filter((id): id is string => id !== null)
          : [];

      const sets = await loadStatusSets(orgId, {
        entityTypes: wanted,
        teamIds: teamId === undefined ? forkedTeams : [teamId],
      });
      const scope = teamId ?? null;
      const workspaceSets = wanted.map((kind) =>
        setToOut(
          orgId,
          kind,
          kind === 'task' ? scope : null,
          kind === 'task' && scope !== null && sets.isForked(scope),
          sets.for(kind, kind === 'task' ? scope : null),
        ),
      );
      const teamSets = forkedTeams.map((forked) =>
        setToOut(orgId, 'task', forked, true, sets.for('task', forked)),
      );
      return ok(c, z.object({ items: z.array(WorkStatusSetOut) }), {
        items: [...workspaceSets, ...teamSets],
      });
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      status: 201,
      tag: 'Statuses',
      summary: 'Add a status',
      capability: 'manage',
      description:
        'Adds a status to one of this workspace’s sets. The key the work will store is derived from the name and stays fixed through later renames, so saved views and automation rules keep resolving. Omit `position` to place the status after the others sharing its category. A team scope is accepted for task statuses only.',
      response: WorkStatusOut,
    }),
    zJson(WorkStatusCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const teamId = body.teamId ?? null;
      assertTeamScope(body.entityType, teamId);

      const statusRow = await db.transaction(async (tx) => {
        const existing = await lockSet(tx, orgId, body.entityType, teamId);
        if (teamId !== null) {
          // A team-scoped status only means something inside a set the team already owns: written
          // against a team that still follows the workspace, this one row would become the whole
          // of that team's statuses and strand every task on it.
          if (existing.length === 0) {
            throw new ConflictError(
              'This team follows the workspace statuses. Customize them for the team first.',
            );
          }
          const owned = await tx
            .select({ id: team.id })
            .from(team)
            .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
            .limit(1);
          if (!owned[0]) throw new NotFoundError('Team not found');
        }
        const sameCategory = existing.filter((status) => status.category === body.category);
        const inserted = await tx
          .insert(workStatus)
          .values({
            organizationId: orgId,
            createdBy: actorId,
            entityType: body.entityType,
            teamId,
            key: keyFrom(body.name, new Set(existing.map((status) => status.key))),
            name: body.name.trim(),
            description: body.description ?? null,
            category: body.category,
            position: body.position ?? sameCategory.length,
            isDefault: false,
          })
          .returning();
        return inserted[0];
      });
      /* v8 ignore next -- @preserve defensive: insert always returns a row */
      if (!statusRow) throw new Error('status insert returned no row');
      return created(c, WorkStatusOut, toOut(statusRow));
    },
  )
  .patch(
    '/:statusId',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Statuses',
      summary: 'Change a status',
      capability: 'manage',
      description:
        'Renames a status, rewrites what it means, moves it to another category, or makes it the status new work starts in. Moving a status between categories records or clears completion on the work already sitting in it, so progress and capacity stay accurate. The stored key is unaffected by a rename.',
      response: WorkStatusOut,
    }),
    zParam(statusIdParam),
    zJson(WorkStatusUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { statusId } = c.req.valid('param');
      const body = c.req.valid('json');

      const { updated, restamped } = await db.transaction(async (tx) => {
        const current = (
          await tx
            .select()
            .from(workStatus)
            .where(and(eq(workStatus.id, statusId), eq(workStatus.organizationId, orgId)))
            .for('update')
        )[0];
        if (!current) throw new NotFoundError('Status not found');

        const siblings = await lockSet(tx, orgId, current.entityType, current.teamId);
        if (body.category !== undefined && body.category !== current.category) {
          assertSetRemainsUsable(
            siblings.map((status) =>
              status.id === current.id
                ? { category: body.category ?? status.category }
                : { category: status.category },
            ),
          );
        }

        if (body.isDefault === true) {
          await tx
            .update(workStatus)
            .set({ isDefault: false })
            .where(
              and(
                eq(workStatus.organizationId, orgId),
                eq(workStatus.entityType, current.entityType),
                current.teamId === null
                  ? isNull(workStatus.teamId)
                  : eq(workStatus.teamId, current.teamId),
              ),
            );
        }

        const row = (
          await tx
            .update(workStatus)
            .set({
              ...(body.name === undefined ? {} : { name: body.name.trim() }),
              ...(body.description === undefined ? {} : { description: body.description }),
              ...(body.category === undefined ? {} : { category: body.category }),
              ...(body.isDefault === undefined ? {} : { isDefault: true }),
            })
            .where(eq(workStatus.id, statusId))
            .returning()
        )[0];
        /* v8 ignore next -- @preserve defensive: the lock above proved the row exists */
        if (!row) throw new NotFoundError('Status not found');

        // Moving a status across the terminal boundary changes what the work in it *is*, and
        // `completedAt`/`canceledAt` are what progress, capacity and throughput read.
        let touched: string[] = [];
        if (body.category !== undefined && body.category !== current.category) {
          if (current.entityType === 'task') {
            const stamps = terminalStampsFor(body.category);
            const rows = await tx
              .update(task)
              .set({ completedAt: stamps.completedAt, canceledAt: stamps.canceledAt })
              .where(and(eq(task.organizationId, orgId), eq(task.statusId, statusId)))
              .returning({ id: task.id });
            touched = rows.map((entry) => entry.id);
          }
          // Containers carry no terminal timestamps of their own: their progress is computed from
          // the work inside them, so moving the status between categories is the whole change.
        }
        return { updated: row, restamped: touched };
      });

      for (const id of restamped) await enqueueSearchUpsert(orgId, 'task', id);
      return ok(c, WorkStatusOut, toOut(updated));
    },
  )
  .post(
    '/reorder',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Statuses',
      summary: 'Reorder a status set',
      capability: 'manage',
      description:
        'Sets the order a status set reads in. Send every status in the set, in the order wanted. Statuses sharing a category stay together and the categories keep their fixed order, so an order that interleaves two categories is rejected.',
      response: WorkStatusSetOut,
    }),
    zJson(WorkStatusReorder),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const teamId = body.teamId ?? null;
      assertTeamScope(body.entityType, teamId);

      await db.transaction(async (tx) => {
        const existing = await lockSet(tx, orgId, body.entityType, teamId);
        const byId = new Map(existing.map((status) => [status.id, status]));
        if (body.order.length !== existing.length || body.order.some((id) => !byId.has(id))) {
          throw new ValidationError([
            { message: 'Send every status in the set exactly once', path: ['order'] },
          ]);
        }

        // Categories keep their fixed order, so each one has to appear as a single run.
        const seen = new Set<WorkStatusCategory>();
        let previous: WorkStatusCategory | undefined;
        const perCategory = new Map<WorkStatusCategory, number>();
        for (const id of body.order) {
          const status = byId.get(id);
          /* v8 ignore next -- @preserve the membership check above proved every id resolves */
          if (!status) continue;
          if (status.category !== previous) {
            if (seen.has(status.category)) {
              throw new ValidationError([
                { message: 'Statuses sharing a category stay together', path: ['order'] },
              ]);
            }
            seen.add(status.category);
            previous = status.category;
          }
          const next = perCategory.get(status.category) ?? 0;
          perCategory.set(status.category, next + 1);
          await tx.update(workStatus).set({ position: next }).where(eq(workStatus.id, id));
        }
      });

      const sets = await loadStatusSets(orgId, {
        entityTypes: [body.entityType],
        teamIds: teamId === null ? [] : [teamId],
      });
      return ok(
        c,
        WorkStatusSetOut,
        setToOut(
          orgId,
          body.entityType,
          teamId,
          teamId !== null && sets.isForked(teamId),
          sets.for(body.entityType, teamId),
        ),
      );
    },
  )
  .delete(
    '/:statusId',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Statuses',
      summary: 'Delete a status',
      capability: 'manage',
      description:
        'Deletes a status and moves the work on it to the replacement named by `remapTo`. The replacement has to belong to the same set. A set always keeps a way to finish work, a way to abandon it, and somewhere for work that has not ended, so a delete that would remove the last of any of those is refused. Returns the deleted status and how much work moved.',
      response: WorkStatusDeleteResult,
    }),
    zParam(statusIdParam),
    zQuery(deleteQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { statusId } = c.req.valid('param');
      const { remapTo } = c.req.valid('query');
      if (remapTo === statusId) {
        throw new ValidationError([
          { message: 'Choose a different status to move the work to', path: ['remapTo'] },
        ]);
      }

      const { deleted, remappedCount, moved, movedKind } = await db.transaction(async (tx) => {
        const current = (
          await tx
            .select()
            .from(workStatus)
            .where(and(eq(workStatus.id, statusId), eq(workStatus.organizationId, orgId)))
            .for('update')
        )[0];
        if (!current) throw new NotFoundError('Status not found');

        const siblings = await lockSet(tx, orgId, current.entityType, current.teamId);
        const replacement = siblings.find((status) => status.id === remapTo);
        if (!replacement) {
          throw new ValidationError([
            { message: 'The replacement has to be a status in the same set', path: ['remapTo'] },
          ]);
        }
        if (current.isDefault) {
          throw new ConflictError(
            'This is where new work starts. Make another status the default first.',
          );
        }
        assertSetRemainsUsable(siblings.filter((status) => status.id !== statusId));

        // Each kind of work is remapped against its own table so the key column and `status_id`
        // move together, which is exactly what the composite foreign key requires.
        const moveTo = { statusId: replacement.id, key: replacement.key };
        let movedIds: string[];
        let remapped: number;
        if (current.entityType === 'task') {
          const stamps = terminalStampsFor(replacement.category);
          const rows = await tx
            .update(task)
            .set({
              statusId: moveTo.statusId,
              state: moveTo.key,
              completedAt: stamps.completedAt,
              canceledAt: stamps.canceledAt,
            })
            .where(and(eq(task.organizationId, orgId), eq(task.statusId, statusId)))
            .returning({ id: task.id });
          movedIds = rows.map((row) => row.id);
          remapped = rows.length;
        } else if (current.entityType === 'project') {
          const rows = await tx
            .update(project)
            .set({ statusId: moveTo.statusId, status: moveTo.key })
            .where(and(eq(project.organizationId, orgId), eq(project.statusId, statusId)))
            .returning({ id: project.id });
          movedIds = rows.map((row) => row.id);
          remapped = rows.length;
        } else if (current.entityType === 'program') {
          const rows = await tx
            .update(program)
            .set({ statusId: moveTo.statusId, status: moveTo.key })
            .where(and(eq(program.organizationId, orgId), eq(program.statusId, statusId)))
            .returning({ id: program.id });
          movedIds = rows.map((row) => row.id);
          remapped = rows.length;
        } else {
          const rows = await tx
            .update(initiative)
            .set({ statusId: moveTo.statusId, status: moveTo.key })
            .where(and(eq(initiative.organizationId, orgId), eq(initiative.statusId, statusId)))
            .returning({ id: initiative.id });
          movedIds = rows.map((row) => row.id);
          remapped = rows.length;
        }

        await tx.delete(workStatus).where(eq(workStatus.id, statusId));
        return {
          deleted: current,
          remappedCount: remapped,
          moved: movedIds,
          movedKind: current.entityType,
        };
      });

      // The status key travels into the search facet for every kind of work, so everything that
      // moved has to be reindexed rather than only the tasks.
      for (const id of moved) await enqueueSearchUpsert(orgId, movedKind, id);
      return ok(c, WorkStatusDeleteResult, {
        deleted: toOut(deleted),
        remappedCount,
      });
    },
  );

/**
 * The team-fork routes, mounted under `/v1/orgs/:orgId/teams`.
 *
 * @remarks
 * Forking is a Task-only affair because only Tasks are team-scoped: a Project belongs to the
 * workspace whether or not it names a team, so a per-team Project status set would have nothing
 * to apply to. A team that has not forked reads the workspace set and keeps receiving changes to
 * it; forking takes a copy and stops that, and resetting gives it back.
 */
const teamStatusFork = new Hono<AppEnv>()
  .post(
    '/:teamId/statuses/fork',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Statuses',
      summary: 'Give a team its own task statuses',
      capability: 'manage',
      description:
        'Copies the workspace’s task statuses into a set this team owns, and moves the team’s tasks onto the copies. The team stops following later changes to the workspace set. Returns the team’s new set.',
      response: WorkStatusSetOut,
    }),
    zParam(z.object({ teamId: z.string() })),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { teamId } = c.req.valid('param');

      await db.transaction(async (tx) => {
        const owned = await tx
          .select({ id: team.id })
          .from(team)
          .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
          .limit(1);
        if (!owned[0]) throw new NotFoundError('Team not found');

        const already = await lockSet(tx, orgId, 'task', teamId);
        if (already.length > 0) {
          throw new ConflictError('This team already keeps its own task statuses');
        }

        const source = await lockSet(tx, orgId, 'task', null);
        const copies = await tx
          .insert(workStatus)
          .values(
            source.map((status) => ({
              organizationId: orgId,
              createdBy: actorId,
              entityType: 'task' as const,
              teamId,
              key: status.key,
              name: status.name,
              description: status.description,
              category: status.category,
              position: status.position,
              isDefault: status.isDefault,
            })),
          )
          .returning();

        // The team's tasks move onto the copies key-for-key, so nothing visibly changes.
        const byKey = new Map(copies.map((status) => [status.key, status]));
        for (const [key, status] of byKey) {
          await tx
            .update(task)
            .set({ statusId: status.id, state: key })
            .where(
              and(eq(task.organizationId, orgId), eq(task.teamId, teamId), eq(task.state, key)),
            );
        }
      });

      const sets = await loadStatusSets(orgId, { entityTypes: ['task'], teamIds: [teamId] });
      return ok(
        c,
        WorkStatusSetOut,
        setToOut(orgId, 'task', teamId, true, sets.for('task', teamId)),
      );
    },
  )
  .delete(
    '/:teamId/statuses/fork',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Statuses',
      summary: 'Return a team to the workspace’s task statuses',
      capability: 'manage',
      description:
        'Discards the team’s own task statuses and moves its tasks back onto the workspace set. A task on a status the workspace set shares by key keeps that status; anything else moves to the workspace status closest in meaning. Returns the workspace set.',
      response: WorkStatusSetOut,
    }),
    zParam(z.object({ teamId: z.string() })),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { teamId } = c.req.valid('param');

      await db.transaction(async (tx) => {
        const owned = await lockSet(tx, orgId, 'task', teamId);
        if (owned.length === 0) {
          throw new NotFoundError('This team follows the workspace statuses already');
        }
        const workspace = await lockSet(tx, orgId, 'task', null);

        // Match by key first, so a team that only renamed a status keeps its work where it was;
        // otherwise take the workspace status closest in meaning.
        const byKey = new Map(workspace.map((status) => [status.key, status]));
        for (const owning of owned) {
          const replacement =
            byKey.get(owning.key) ??
            workspace.find((status) => status.category === owning.category) ??
            workspace.find((status) => status.isDefault) ??
            workspace[0];
          /* v8 ignore next -- @preserve the workspace set is never empty */
          if (!replacement) throw new ConflictError('This workspace has no task statuses');
          await tx
            .update(task)
            .set({ statusId: replacement.id, state: replacement.key })
            .where(and(eq(task.organizationId, orgId), eq(task.statusId, owning.id)));
        }
        await tx.delete(workStatus).where(
          inArray(
            workStatus.id,
            owned.map((status) => status.id),
          ),
        );
      });

      const sets = await loadStatusSets(orgId, { entityTypes: ['task'] });
      return ok(c, WorkStatusSetOut, setToOut(orgId, 'task', null, false, sets.for('task')));
    },
  );

export { teamStatusFork };
export default workStatuses;

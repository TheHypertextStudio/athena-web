/**
 * `@docket/api` — teams router (mounted at `/v1/orgs/:orgId/teams`).
 *
 * @remarks
 * A Team is a first-class unit within an org that owns its own `workflow_states`,
 * Cycles, and the Triage queue. `organizationId` is always taken from the actor
 * context (the route path), never the body. Reads require `view`; create/patch/delete
 * require `manage`. A team's `key` is unique within the org; create/patch reject a
 * duplicate key with a 409. Delete is a soft archive (sets `archived_at`).
 */
import { actor, db, defaultWorkflowStates, team, teamMember } from '@docket/db';
import { CursorQuery, pageOf } from '../contracts/pagination';
import {
  TeamActivityOut,
  TeamCreate,
  TeamDeleteResult,
  TeamDetail,
  TeamMemberOut,
  TeamMemberRemoveResult,
  TeamMemberUpsert,
  TeamOut,
  TeamRosterEntry,
  TeamUpdate,
} from '../contracts/team';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../error';
import { clearableTextPatch } from '../lib/clearable-text';
import { created, ok } from '../lib/ok';
import { pageResultById, pageResultByTuple, seekAfterId } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { teamOut } from '../lib/team-output';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';
import { changeTeamCycleCadence, readTeamCycleCadencePolicy } from '../services/team-cycle-cadence';
import { entityMentionRoutes } from './entity-mentions';
import { archiveTeamActor, createTeamActor, findTeamActorId, renameTeamActor } from './team-actor';
import {
  loadOrgTeamRosters,
  loadTeamActivity,
  loadTeamMembers,
  teamExists,
  THROUGHPUT_WINDOW_DAYS,
} from './team-reports';

type TeamRow = typeof team.$inferSelect;

async function toDetail(t: TeamRow, actorId?: string | null): Promise<z.input<typeof TeamDetail>> {
  const policy = await readTeamCycleCadencePolicy(t, new Date());
  return {
    ...teamOut(t, actorId),
    workflowStates: t.workflowStates,
    cycleCadenceDays: t.cycleCadenceDays,
    cycleCadenceAnchor: t.cycleCadenceAnchor,
    cycleCadenceRevision: t.cycleCadenceRevision,
    cycleCadenceEarliestAnchor: policy.earliestAnchor,
    cycleCadenceProviderOwned: policy.providerOwned,
  };
}

const idParam = z.object({ teamId: z.string() });
/** Path params addressing one membership: the team, and the person on it. */
const memberParam = z.object({ teamId: z.string(), actorId: z.string() });

/**
 * Assert that `key` is not already used by another active team in the org.
 *
 * @remarks
 * The DB enforces `(organization_id, key)` uniqueness across all rows; this check
 * surfaces the collision as a 409 Problem before the insert/update would throw a
 * raw constraint error. `exceptId` excludes the row being patched.
 *
 * @param orgId - The active organization id.
 * @param key - The candidate team key.
 * @param exceptId - A team id to exclude from the collision check (for patch).
 * @throws {ConflictError} When another team in the org already holds the key.
 */
async function assertKeyAvailable(orgId: string, key: string, exceptId?: string): Promise<void> {
  const rows = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.organizationId, orgId), eq(team.key, key)))
    .limit(2);
  const clash = rows.find((r) => r.id !== exceptId);
  if (clash) throw new ConflictError('A team with this key already exists');
}

async function cadenceChangeForPatch(
  orgId: string,
  teamId: string,
  body: z.infer<typeof TeamUpdate>,
): Promise<Awaited<ReturnType<typeof changeTeamCycleCadence>> | undefined> {
  const changesCadence =
    body.cycleCadenceDays !== undefined || body.cycleCadenceAnchor !== undefined;
  if (!changesCadence) return undefined;
  if (body.cycleCadenceRevision === undefined) {
    throw new ValidationError([
      {
        path: ['cycleCadenceRevision'],
        message: 'The current cadence revision is required when changing cadence',
      },
    ]);
  }
  return changeTeamCycleCadence({
    orgId,
    teamId,
    expectedRevision: body.cycleCadenceRevision,
    ...(body.cycleCadenceDays !== undefined ? { cadenceDays: body.cycleCadenceDays } : {}),
    ...(body.cycleCadenceAnchor !== undefined ? { requestedAnchor: body.cycleCadenceAnchor } : {}),
    now: new Date(),
  });
}

function mutableTeamPatch(body: z.infer<typeof TeamUpdate>): Partial<typeof team.$inferInsert> {
  return {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.key !== undefined ? { key: body.key } : {}),
    ...clearableTextPatch('summary', body.summary),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.workflowStates !== undefined ? { workflowStates: body.workflowStates } : {}),
    ...(body.triageEnabled !== undefined ? { triageEnabled: body.triageEnabled } : {}),
    ...(body.agentGuidance !== undefined ? { agentGuidance: body.agentGuidance } : {}),
    ...(body.approvalRouting !== undefined ? { approvalRouting: body.approvalRouting } : {}),
  };
}

/** Teams router: org-scoped CRUD over teams; `view` to read, `manage` to mutate. */
const teams = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Teams',
      summary: 'List teams',
      response: pageOf(TeamOut),
      description: `List the organization's **active** teams. A Team is a first-class unit within an org that owns its own \`workflow_states\`, Cycles, and the Triage queue. The query filters on \`archived_at IS NULL\`, so soft-deleted (archived) teams are excluded. Each \`TeamOut\` carries the team's name, unique \`key\`, description, workflow states, \`triageEnabled\` flag, and optional agent guidance / approval routing.

Results use stable team-id order, default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Requires only org membership to read (the \`view\` capability is satisfied by any member). Every new org seeds a default "General" team (key \`GEN\`). See \`POST /\` to create a team and \`GET /:teamId\` for full detail.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      const rows = await db
        .select({ row: team, actorId: actor.id })
        .from(team)
        .leftJoin(
          actor,
          and(eq(actor.teamId, team.id), eq(actor.kind, 'team'), isNull(actor.archivedAt)),
        )
        .where(
          and(
            eq(team.organizationId, orgId),
            isNull(team.archivedAt),
            seekAfterId(team.id, cursor, 'asc'),
          ),
        )
        .orderBy(asc(team.id))
        .limit(limit + 1);
      return ok(
        c,
        pageOf(TeamOut),
        pageResultById(
          rows.map(({ row, actorId }) => teamOut(row, actorId)),
          limit,
        ),
      );
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      status: 201,
      tag: 'Teams',
      summary: 'Create a team',
      capability: 'manage',
      response: TeamDetail,
      description: `Create a team within the organization. Requires the \`manage\` capability. The team's \`key\` must be unique within the organization; a duplicate returns **409**.

When omitted, \`workflowStates\` uses Backlog, Todo, In Progress, Done, and Canceled. Backlog becomes the default for new tasks. \`triageEnabled\` defaults to \`true\`, while \`description\`, \`agentGuidance\`, and \`approvalRouting\` default to null. Returns the full \`TeamDetail\`. See \`PATCH /:teamId\` to edit and \`DELETE /:teamId\` to archive.`,
    }),
    zJson(TeamCreate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const body = c.req.valid('json');
      await assertKeyAvailable(orgId, body.key);
      // The team and its shadow actor land together or not at all: a team with no actor cannot be
      // named as an owner, which fails silently at assignment time rather than here.
      const createdTeam = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(team)
          .values({
            organizationId: orgId,
            name: body.name,
            key: body.key,
            summary: body.summary ?? null,
            description: body.description ?? null,
            workflowStates: body.workflowStates ?? [...defaultWorkflowStates],
            triageEnabled: body.triageEnabled ?? true,
            cycleCadenceDays: body.cycleCadenceDays ?? 7,
            cycleCadenceAnchor: body.cycleCadenceAnchor ?? '2024-01-01',
            agentGuidance: body.agentGuidance ?? null,
            approvalRouting: body.approvalRouting ?? null,
          })
          .returning();
        const created = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!created) throw new Error('team insert returned no row');
        const actorId = await createTeamActor(tx, {
          organizationId: orgId,
          teamId: created.id,
          name: created.name,
        });
        return { row: created, actorId };
      });
      await enqueueSearchUpsert(orgId, 'team', createdTeam.row.id);
      return created(c, TeamDetail, await toDetail(createdTeam.row, createdTeam.actorId));
    },
  )
  .get(
    '/rosters',
    apiDoc({
      tag: 'Teams',
      summary: 'List every team membership in the workspace',
      response: pageOf(TeamRosterEntry),
      description: `Every \`(team, member)\` pair in the org, identity only — no per-person load figures. This exists so the Teams hub can draw a face stack on every card with **one** request instead of one per team.

Results use stable \`teamId, actorId\` order, default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Declared before \`GET /:teamId\` so the literal segment wins the route match. Requires only org membership.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      const items = await loadOrgTeamRosters(orgId, { cursor, limit });
      return ok(
        c,
        pageOf(TeamRosterEntry),
        pageResultByTuple(items, limit, (item) => [item.teamId, item.actorId]),
      );
    },
  )
  .get(
    '/:teamId',
    apiDoc({
      tag: 'Teams',
      summary: 'Get a team',
      response: TeamDetail,
      description: `Fetch one active team by id, returning the full \`TeamDetail\` — name, unique \`key\`, description, the complete \`workflowStates\` list, \`triageEnabled\`, native cycle cadence, its safe replacement anchor, provider ownership, and any \`agentGuidance\`/\`approvalRouting\`. The lookup is scoped to \`(teamId, orgId)\` AND \`archived_at IS NULL\`, so an archived team or a team id from another org returns **404** (existence-hiding). Requires only org membership (the \`view\` capability) to read. See \`GET /\` to list teams.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { teamId } = c.req.valid('param');
      const rows = await db
        .select({ row: team, actorId: actor.id })
        .from(team)
        .leftJoin(
          actor,
          and(eq(actor.teamId, team.id), eq(actor.kind, 'team'), isNull(actor.archivedAt)),
        )
        .where(and(eq(team.id, teamId), eq(team.organizationId, orgId), isNull(team.archivedAt)))
        .limit(1);
      const result = rows[0];
      if (!result) throw new NotFoundError('Team not found');
      return ok(c, TeamDetail, await toDetail(result.row, result.actorId));
    },
  )
  .patch(
    '/:teamId',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Teams',
      summary: 'Update a team',
      capability: 'manage',
      response: TeamDetail,
      description: `Update an active team's settings. Every field is optional, and omitted fields remain unchanged. The team must be active and visible in the organization; otherwise the request returns 404. A \`key\` already used by another team returns 409.

 Setting \`workflowStates\` replaces the entire array. A cadence change accepts 1–365 calendar days and requires the current \`cycleCadenceRevision\`. Docket preserves assigned cycle windows and returns 409 \`cadence_changed\` when that revision is stale. Set \`description\`, \`agentGuidance\`, or \`approvalRouting\` to null to clear it. An empty body leaves the team unchanged. Requires the \`manage\` capability and returns the updated \`TeamDetail\`. Use \`DELETE /:teamId\` to archive the team.`,
    }),
    zParam(idParam),
    zJson(TeamUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { teamId } = c.req.valid('param');
      const body = c.req.valid('json');
      if (body.key !== undefined) await assertKeyAvailable(orgId, body.key, teamId);
      const cadenceChange = await cadenceChangeForPatch(orgId, teamId, body);
      const patch = mutableTeamPatch(body);
      const where = and(
        eq(team.id, teamId),
        eq(team.organizationId, orgId),
        isNull(team.archivedAt),
      );

      // An empty patch body is a valid no-op: Drizzle rejects an empty `.set({})`, so
      // re-read the row (still enforcing the org-scoped existence check) and return it.
      if (Object.keys(patch).length === 0) {
        if (cadenceChange) {
          return ok(c, TeamDetail, {
            ...(await toDetail(
              cadenceChange.team,
              await findTeamActorId(db, orgId, cadenceChange.team.id),
            )),
            cadenceChange: {
              effectiveAnchor: cadenceChange.effectiveAnchor,
              removedEmptyCycles: cadenceChange.removedEmptyCycles,
            },
          });
        }
        const rows = await db.select().from(team).where(where).limit(1);
        const existing = rows[0];
        if (!existing) throw new NotFoundError('Team not found');
        return ok(
          c,
          TeamDetail,
          await toDetail(existing, await findTeamActorId(db, orgId, existing.id)),
        );
      }

      const updatedTeam = await db.transaction(async (tx) => {
        const updated = await tx.update(team).set(patch).where(where).returning();
        const patched = updated[0];
        if (!patched) throw new NotFoundError('Team not found');
        // The actor keeps its own copy of the name so an owner chip renders without joining
        // `team`; a rename that skipped this would leave the pickers offering the old one.
        if (body.name !== undefined) await renameTeamActor(tx, patched.id, patched.name);
        return { row: patched, actorId: await findTeamActorId(tx, orgId, patched.id) };
      });
      await enqueueSearchUpsert(orgId, 'team', updatedTeam.row.id);
      return ok(c, TeamDetail, {
        ...(await toDetail(updatedTeam.row, updatedTeam.actorId)),
        ...(cadenceChange
          ? {
              cadenceChange: {
                effectiveAnchor: cadenceChange.effectiveAnchor,
                removedEmptyCycles: cadenceChange.removedEmptyCycles,
              },
            }
          : {}),
      });
    },
  )
  .delete(
    '/:teamId',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Teams',
      summary: 'Delete a team',
      capability: 'manage',
      response: TeamDeleteResult,
      description: `Archive a team without deleting its cycles, tasks, or history. An already archived, absent, or inaccessible team returns 404, so repeating a successful request returns 404 rather than the first result.

The team disappears from active team reads. Tasks remain assigned to it. Docket allows archiving the organization's last or default team and does not choose a replacement. Requires the \`manage\` capability. Returns \`TeamDeleteResult\` with the team ID and archive time.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { teamId } = c.req.valid('param');
      const archivedAt = new Date();
      const row = await db.transaction(async (tx) => {
        const updated = await tx
          .update(team)
          .set({ archivedAt })
          .where(and(eq(team.id, teamId), eq(team.organizationId, orgId), isNull(team.archivedAt)))
          .returning({ id: team.id, archivedAt: team.archivedAt });
        const archived = updated[0];
        if (!archived) throw new NotFoundError('Team not found');
        // Soft-delete the actor too, so the team stops being offered for new assignments while
        // the work it already owns keeps a resolvable owner.
        await archiveTeamActor(tx, archived.id, archivedAt);
        return archived;
      });
      /* v8 ignore next -- @preserve defensive: the just-set archivedAt is always present on the returned row */
      const archivedIso = (row.archivedAt ?? archivedAt).toISOString();
      await enqueueSearchDelete(orgId, 'team', row.id);
      return ok(c, TeamDeleteResult, { id: row.id, archivedAt: archivedIso });
    },
  )
  .get(
    '/:teamId/members',
    apiDoc({
      tag: 'Teams',
      summary: "List a team's members",
      response: pageOf(TeamMemberOut),
      description: `List the people on a team. Each item includes the person's display name, organization-level job \`title\`, team \`role\` (\`manager\`, \`member\`, or \`guest\`), and \`openTaskCount\`. Members with and without Docket accounts use the same response shape. The API does not expose account status or a declared allocation percentage.

Results are ordered by display name, case-insensitively, with Actor ID as the stable tie-breaker. The default page size is 50 and the maximum is 100. The final page omits \`nextCursor\`. An unavailable or archived team returns 404.`,
    }),
    zParam(idParam),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { teamId } = c.req.valid('param');
      const { cursor, limit } = c.req.valid('query');
      if (!(await teamExists(orgId, teamId))) throw new NotFoundError('Team not found');
      const items = await loadTeamMembers(orgId, teamId, actorId, { cursor, limit });
      return ok(
        c,
        pageOf(TeamMemberOut),
        pageResultByTuple(items, limit, (item) => [
          item.displayName.toLocaleLowerCase(),
          item.actorId,
        ]),
      );
    },
  )
  .get(
    '/:teamId/activity',
    apiDoc({
      tag: 'Teams',
      summary: "Report a team's capacity and throughput",
      response: TeamActivityOut,
      description: `Return a team's current capacity and ${String(THROUGHPUT_WINDOW_DAYS)}-day throughput history in one response.

\`capacity\` groups open tasks by workflow-state category: \`backlog\`, \`unstarted\`, or \`started\`. Each group includes \`taskCount\` and the sum of task estimates. Unestimated tasks add zero to the estimate. Tasks whose state no longer exists in the team's workflow are omitted from capacity.

\`throughput\` is ordered from oldest to newest. Each day reports how many tasks were open at the end of that day and how many had been completed. An unavailable or archived team returns 404.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { teamId } = c.req.valid('param');
      if (!(await teamExists(orgId, teamId))) throw new NotFoundError('Team not found');
      const report = await loadTeamActivity(orgId, teamId, actorId, new Date());
      return ok(c, TeamActivityOut, report);
    },
  )
  .put(
    '/:teamId/members/:actorId',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Teams',
      summary: 'Add someone to a team, or change their standing on it',
      capability: 'manage',
      response: TeamMemberOut,
      description: `Place a human actor on this team, or re-role somebody already on it — one idempotent write at the membership's own address, since "make sure this person is a manager here" is the operation callers actually have. Sending the same body twice leaves the same membership, which is why this is a \`PUT\` to \`/members/{actorId}\` rather than a post to the collection: the URI names the one membership being written, and \`DELETE\` on that same URI removes it.

\`role\` defaults to \`member\`. The role labels who runs the team; it grants nothing, because permissions resolve through grants and a role that quietly widened capability is the kind of thing nobody audits.

Any person in the workspace is eligible, whether or not they have a Docket account. Agents, teams, and people from another workspace return **404**.`,
    }),
    zParam(memberParam),
    zJson(TeamMemberUpsert),
    async (c) => {
      const { orgId, actorId: viewerActorId } = c.get('actorCtx');
      const { teamId, actorId } = c.req.valid('param');
      const body = c.req.valid('json');
      if (!(await teamExists(orgId, teamId))) throw new NotFoundError('Team not found');

      const people = await db
        .select({ id: actor.id })
        .from(actor)
        .where(
          and(
            eq(actor.id, actorId),
            eq(actor.organizationId, orgId),
            eq(actor.kind, 'human'),
            isNull(actor.archivedAt),
          ),
        )
        .limit(1);
      if (!people[0]) throw new NotFoundError('Person not found');

      const role = body.role ?? 'member';
      await db
        .insert(teamMember)
        .values({ teamId, actorId, organizationId: orgId, role })
        .onConflictDoUpdate({
          target: [teamMember.teamId, teamMember.actorId],
          set: { role },
        });

      const members = await loadTeamMembers(orgId, teamId, viewerActorId);
      const added = members.find((m) => m.actorId === actorId);
      /* v8 ignore next -- @preserve defensive: the row was just written */
      if (!added) throw new NotFoundError('Person not found');
      return ok(c, TeamMemberOut, added);
    },
  )
  .delete(
    '/:teamId/members/:actorId',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Teams',
      summary: 'Remove someone from a team',
      capability: 'manage',
      response: TeamMemberRemoveResult,
      description: `Drop one membership. The person and everything they own stay exactly as they were — this severs the team relationship and nothing else, so work they are assigned keeps its assignee rather than being silently orphaned.

Removing a membership that is not there returns **404**, which makes a repeated delete safe to observe rather than silently successful.`,
    }),
    zParam(z.object({ teamId: z.string(), actorId: z.string() })),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { teamId, actorId } = c.req.valid('param');
      const removed = await db
        .delete(teamMember)
        .where(
          and(
            eq(teamMember.teamId, teamId),
            eq(teamMember.actorId, actorId),
            eq(teamMember.organizationId, orgId),
          ),
        )
        .returning({ teamId: teamMember.teamId, actorId: teamMember.actorId });
      const row = removed[0];
      if (!row) throw new NotFoundError('Membership not found');
      return ok(c, TeamMemberRemoveResult, {
        teamId: row.teamId,
        actorId: row.actorId,
      });
    },
  )
  .route('/', entityMentionRoutes('team', 'Teams'));

export default teams;

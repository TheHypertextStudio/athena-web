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
import {
  pageOf,
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
} from '@docket/types';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { clearableTextPatch } from '../lib/clearable-text';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';
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

/** Map a `team` row to its `TeamOut`/`TeamDetail` wire shape. */
function toOut(t: TeamRow, actorId?: string | null): z.input<typeof TeamDetail> {
  return {
    id: t.id,
    ...(actorId ? { actorId } : {}),
    organizationId: t.organizationId,
    name: t.name,
    key: t.key,
    summary: t.summary ?? null,
    description: t.description ?? null,
    workflowStates: t.workflowStates,
    triageEnabled: t.triageEnabled,
    agentGuidance: t.agentGuidance ?? null,
    approvalRouting: t.approvalRouting ?? null,
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

/** Teams router: org-scoped CRUD over teams; `view` to read, `manage` to mutate. */
const teams = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Teams',
      summary: 'List teams',
      response: pageOf(TeamOut),
      description: `List the organization's **active** teams. A Team is a first-class unit within an org that owns its own \`workflow_states\`, Cycles, and the Triage queue. The query filters on \`archived_at IS NULL\`, so soft-deleted (archived) teams are excluded. Each \`TeamOut\` carries the team's name, unique \`key\`, description, workflow states, \`triageEnabled\` flag, and optional agent guidance / approval routing.

Requires only org membership to read (the \`view\` capability is satisfied by any member). Returns the standard \`{ items }\` page envelope. Every new org seeds a default "General" team (key \`GEN\`). See \`POST /\` to create a team and \`GET /:teamId\` for full detail.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db
        .select({ row: team, actorId: actor.id })
        .from(team)
        .leftJoin(
          actor,
          and(eq(actor.teamId, team.id), eq(actor.kind, 'team'), isNull(actor.archivedAt)),
        )
        .where(and(eq(team.organizationId, orgId), isNull(team.archivedAt)));
      return ok(c, pageOf(TeamOut), {
        items: rows.map(({ row, actorId }) => toOut(row, actorId)),
      });
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
      description: `Create a team within the org. Requires the \`manage\` capability (creating an org structural unit). \`organizationId\` is always taken from the path, never the body. The team's \`key\` must be unique among the org's teams: the handler checks availability first and returns **409** on a collision (surfacing the \`(organization_id, key)\` uniqueness constraint as a clean Problem rather than a raw DB error).

Defaults applied when omitted: \`workflowStates\` seeds the canonical five-state workflow (Backlog › Todo › In Progress › Done › Canceled — the first state, \`backlog\`, is the new-task default); \`triageEnabled\` defaults to \`true\`; \`description\`, \`agentGuidance\`, and \`approvalRouting\` default to null. Returns the full \`TeamDetail\` (workflow states always materialized). Unlike the org-create transaction, this does NOT seed a team Actor membership set — it creates the team row only. See \`PATCH /:teamId\` to edit and \`DELETE /:teamId\` to archive.`,
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
      return created(c, TeamDetail, toOut(createdTeam.row, createdTeam.actorId));
    },
  )
  .get(
    '/rosters',
    apiDoc({
      tag: 'Teams',
      summary: 'List every team membership in the workspace',
      response: pageOf(TeamRosterEntry),
      description: `Every \`(team, member)\` pair in the org, identity only — no per-person load figures. This exists so the Teams hub can draw a face stack on every card with **one** request instead of one per team.

Declared before \`GET /:teamId\` so the literal segment wins the route match. Ordered after it, this returns 404 with \`rosters\` read as a team id — which is silent, because the hub degrades to "No members yet" rather than showing an error. Requires only org membership.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const items = await loadOrgTeamRosters(orgId);
      return ok(c, pageOf(TeamRosterEntry), { items });
    },
  )
  .get(
    '/:teamId',
    apiDoc({
      tag: 'Teams',
      summary: 'Get a team',
      response: TeamDetail,
      description: `Fetch one active team by id, returning the full \`TeamDetail\` — name, unique \`key\`, description, the complete \`workflowStates\` list, \`triageEnabled\`, and any \`agentGuidance\`/\`approvalRouting\`. The lookup is scoped to \`(teamId, orgId)\` AND \`archived_at IS NULL\`, so an archived team or a team id from another org returns **404** (existence-hiding). Requires only org membership (the \`view\` capability) to read. See \`GET /\` to list teams.`,
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
      return ok(c, TeamDetail, toOut(result.row, result.actorId));
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
      description: `Patch an active team's settings. Requires the \`manage\` capability. Every field is optional; only supplied fields change. The team must be active and in this org — otherwise **404** (the where-clause enforces \`(teamId, orgId)\` AND \`archived_at IS NULL\`). Changing \`key\` re-checks org-wide uniqueness and returns **409** on a collision with another team (the row being patched is excluded from the check).

Setting \`workflowStates\` **replaces the entire array** (it is not a merge). \`description\`, \`agentGuidance\`, and \`approvalRouting\` accept \`null\` to clear. An **empty patch body is a valid no-op**: since the DB rejects an empty \`SET\`, the handler re-reads the row (still enforcing the org-scoped existence check) and returns it unchanged. Returns the updated \`TeamDetail\`. To archive a team use \`DELETE /:teamId\`.`,
    }),
    zParam(idParam),
    zJson(TeamUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { teamId } = c.req.valid('param');
      const body = c.req.valid('json');
      if (body.key !== undefined) await assertKeyAvailable(orgId, body.key, teamId);
      const patch = {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.key !== undefined ? { key: body.key } : {}),
        ...clearableTextPatch('summary', body.summary),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.workflowStates !== undefined ? { workflowStates: body.workflowStates } : {}),
        ...(body.triageEnabled !== undefined ? { triageEnabled: body.triageEnabled } : {}),
        ...(body.agentGuidance !== undefined ? { agentGuidance: body.agentGuidance } : {}),
        ...(body.approvalRouting !== undefined ? { approvalRouting: body.approvalRouting } : {}),
      };
      const where = and(
        eq(team.id, teamId),
        eq(team.organizationId, orgId),
        isNull(team.archivedAt),
      );

      // An empty patch body is a valid no-op: Drizzle rejects an empty `.set({})`, so
      // re-read the row (still enforcing the org-scoped existence check) and return it.
      if (Object.keys(patch).length === 0) {
        const rows = await db.select().from(team).where(where).limit(1);
        const existing = rows[0];
        if (!existing) throw new NotFoundError('Team not found');
        return ok(c, TeamDetail, toOut(existing, await findTeamActorId(db, orgId, existing.id)));
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
      return ok(c, TeamDetail, toOut(updatedTeam.row, updatedTeam.actorId));
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
      description: `Archive a team — a **soft delete** that stamps \`archived_at\` rather than removing the row, preserving the team's Cycles, tasks, and history for audit and possible restoration. Requires the \`manage\` capability. The update is scoped to \`(teamId, orgId)\` AND \`archived_at IS NULL\`, so deleting an already-archived team or one from another org returns **404**; this also makes the operation effectively idempotent (a second delete 404s rather than re-archiving).

After archival the team disappears from \`GET /\` and \`GET /:teamId\` (both filter \`archived_at IS NULL\`). Returns \`TeamDeleteResult\` — the archived team id plus the \`archivedAt\` timestamp. Note this endpoint does not block archiving the org's last/default team, nor does it reassign that team's tasks.`,
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
      description: `The people on this team — display name, org-level job \`title\`, their \`role\` on this team (manager / member / guest), and \`openTaskCount\`, being how many of the team's not-yet-closed tasks are assigned to them.

There is deliberately **no field indicating whether a member holds a Docket account**. A volunteer who never signs in and a full-time staffer come back as the same shape, so no client can render one as second-class (see \`docs/engineering/specs/people.md\`). \`openTaskCount\` is the observed load signal — Docket stores no declared allocation percentage, because a maintained percentage goes stale silently while still looking authoritative.

Ordered by name, case-insensitively. Requires only org membership. Unknown or archived team → **404**.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { teamId } = c.req.valid('param');
      if (!(await teamExists(orgId, teamId))) throw new NotFoundError('Team not found');
      const items = await loadTeamMembers(orgId, teamId, actorId);
      return ok(c, pageOf(TeamMemberOut), { items });
    },
  )
  .get(
    '/:teamId/activity',
    apiDoc({
      tag: 'Teams',
      summary: "Report a team's capacity and throughput",
      response: TeamActivityOut,
      description: `Two views of the same team in one payload, because the team page shows them behind a single toggle and two fetches could disagree with each other.

\`capacity\` is a snapshot: every still-open task bucketed by canonical workflow-state **type** (backlog / unstarted / started) rather than by the team's own state names, so two teams that each have three differently-named in-progress columns stay comparable. Each bucket carries both a \`taskCount\` and an \`estimate\` sum; unestimated tasks contribute 0, so an \`estimate\` of 0 across every bucket means the workspace does not estimate rather than meaning the team has no work.

\`throughput\` is a ${String(THROUGHPUT_WINDOW_DAYS)}-day rolling series, oldest first. For each day it reports the tasks open at that day's end and the tasks completed by it; the two lines converging is the team keeping up. A task whose state key is no longer present in the team's workflow (someone replaced the whole array) is genuinely uncategorizable and is left out of \`capacity\` rather than being put in an invented bucket.

Requires only org membership. Unknown or archived team → **404**.`,
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

**Any human actor in the org is eligible, account or not.** A volunteer who never signs in joins on exactly the same terms as staff — the handler checks \`kind = 'human'\` and tenancy, and nothing else (see \`docs/engineering/specs/people.md\`). An agent or team actor is rejected with **404**, as is an actor from another org.`,
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

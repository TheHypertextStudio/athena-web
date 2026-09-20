/**
 * `@docket/api` — members router (mounted at `/v1/orgs/:orgId/members`).
 *
 * @remarks
 * Members are the workspace's **people**: every human {@link actor} carrying a role. There are
 * two ways one comes into being and the resulting rows are indistinguishable:
 *
 * - **With an account** — invite by email (`POST /invitations`, or the legacy `POST /invite`),
 *   list the pending ones (`GET /invitations`), accept by token
 *   (`POST /invitations/:token/accept` or the legacy `POST /accept-invite`) which materializes
 *   the human Actor for the accepting User, or revoke a pending one (`DELETE /invitations/:id`).
 * - **Without an account** — `POST /` records the person directly (`user_id` stays null). This
 *   is the volunteer/contractor case: someone the workspace tracks and assigns work to who will
 *   never sign in. They are returned by `GET /`, are assignable through the same
 *   `task.assignee_id` / `project.lead_id` / `initiative.owner_id` references, and carry the
 *   same profile (`GET /:actorId`) as anyone else.
 *
 * Role/status patches and member removal (`DELETE /:actorId`) run the {@link lastOwnerGuard} so
 * an org always retains an active Owner; adding people to a personal org is blocked either way
 * (an org-of-one has no roster). `manage` is required to mutate.
 *
 * @see {@link file://../../../../docs/engineering/specs/people.md} for the full enumeration of
 * where account-holders and account-less people are deliberately treated differently.
 */
import { actor, db, invitation, organization, role } from '@docket/db';
import { lastOwnerGuard, LastOwnerError } from '@docket/authz';
import {
  InvitationAccept,
  InvitationOut,
  InvitationRevokeOut,
  MemberInvite,
  MemberOut,
  MemberRemoveOut,
  MemberUpdate,
} from '@docket/identity-access/member-contract';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { AuthError, ConflictError, NotFoundError, ValidationError } from '../error';
import { created, ok } from '../lib/ok';
import { decodeIdCursor, pageResultById, pageResultByKey, seekAfterId } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

import { loadPersonProfile, PersonCreate, PersonProfileOut, PersonUpdate } from './actors';
import {
  acceptInvitation,
  actorIdParam,
  createInvitation,
  invitationIdParam,
  toInvitationOut,
  toMemberOut,
  tokenParam,
} from './member-helpers';

/** Members router: list members, invite + accept-invite, and role/status patches. */
const members = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Members',
      summary: 'List members',
      response: pageOf(MemberOut),
      description: `List active and suspended people in the workspace. Agents, teams, and pending invitations are excluded. Each person includes display name, avatar, membership status, role ID, and an optional Docket \`userId\`. A null \`userId\` identifies a person who does not have a Docket account; both kinds of person use the same response shape.

Results are ordered by \`displayName\`, case-insensitively, with person ID as the stable tie-breaker. The default page size is 50 and the maximum is 100. The final page omits \`nextCursor\`. Use \`GET /invitations\` to list people who have not joined.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      const boundary = decodeIdCursor(cursor);
      const separator = boundary?.lastIndexOf(':') ?? -1;
      if (boundary && separator < 1) {
        throw new ValidationError([
          { path: ['cursor'], message: 'The cursor is invalid or expired.' },
        ]);
      }
      const boundaryName = boundary?.slice(0, separator);
      const boundaryId = boundary?.slice(separator + 1);
      const normalizedName = sql<string>`lower(${actor.displayName})`;
      // Sorted by name, case-insensitively, so an account-less person lands exactly where their
      // name puts them. Insertion order would have grouped every account-less person after every
      // account-holder purely because the create path is newer — a second-class ordering nobody
      // chose. `lower(...)` keeps "ada" beside "Ada" instead of after "Zoë".
      const rows = await db
        .select()
        .from(actor)
        .where(
          and(
            eq(actor.organizationId, orgId),
            eq(actor.kind, 'human'),
            boundaryName && boundaryId
              ? or(
                  gt(normalizedName, boundaryName),
                  and(eq(normalizedName, boundaryName), gt(actor.id, boundaryId)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(normalizedName), asc(actor.id))
        .limit(limit + 1);
      return ok(
        c,
        pageOf(MemberOut),
        pageResultByKey(
          rows.map(toMemberOut),
          limit,
          (item) => `${item.displayName.toLocaleLowerCase()}:${item.actorId}`,
        ),
      );
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      status: 201,
      tag: 'Members',
      summary: 'Add a person without an account',
      capability: 'manage',
      response: MemberOut,
      description: `Add a person who does not need a Docket account, such as a volunteer or contractor. The person can be assigned to tasks and named as a project lead or initiative owner like any other member.

A supplied \`roleId\` must belong to this workspace; otherwise Docket returns **404**. When \`roleId\` is omitted, Docket assigns the workspace's Member role. The workspace comes from the path and cannot be supplied in the request body.

Adding a person to a personal workspace returns **409** because a personal workspace has no roster. The response contains the created member. To give the person account access later, invite their email. Use \`PATCH /:actorId/profile\` to edit their profile and \`DELETE /:actorId\` to remove them.`,
    }),
    zJson(PersonCreate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const body = c.req.valid('json');

      const orgRows = await db
        .select({ isPersonal: organization.isPersonal })
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1);
      const org = orgRows[0];
      /* v8 ignore next -- @preserve org context middleware proved the workspace exists */
      if (!org) throw new NotFoundError('Organization not found');
      if (org.isPersonal) {
        throw new ConflictError('Cannot add people to a personal workspace');
      }

      // Same cross-org role guard `createInvitation` applies: `actor.role_id → role.id` is a bare
      // global FK, and org context resolves capabilities through it.
      let roleId: string | null = body.roleId ?? null;
      if (roleId !== null) {
        const roleRows = await db
          .select({ id: role.id })
          .from(role)
          .where(and(eq(role.id, roleId), eq(role.organizationId, orgId)))
          .limit(1);
        if (!roleRows[0]) throw new NotFoundError('Role not found');
      } else {
        // Default to the org's `member` role so an account-less person holds the same baseline
        // as everyone else. A role on someone who never signs in confers nothing at
        // authentication time; what it does is make them read and sort identically — and it is
        // already correct the moment an account is linked to them.
        const memberRole = await db
          .select({ id: role.id })
          .from(role)
          .where(and(eq(role.organizationId, orgId), eq(role.key, 'member')))
          .limit(1);
        roleId = memberRole[0]?.id ?? null;
      }

      const inserted = await db
        .insert(actor)
        .values({
          organizationId: orgId,
          kind: 'human',
          displayName: body.displayName,
          avatar: body.avatar ?? null,
          userId: null,
          roleId,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert always returns a row */
      if (!row) throw new Error('person actor insert returned no row');
      await enqueueSearchUpsert(orgId, 'actor', row.id);
      return created(c, MemberOut, toMemberOut(row), null);
    },
  )
  .post(
    '/invite',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Members',
      summary: 'Invite a member',
      capability: 'manage',
      response: InvitationOut,
      description: `**Legacy alias** for \`POST /invitations\`. New integrations should use \`POST /invitations\`. Both operations accept the same input and produce the same result.

Create a pending invitation that binds an email address to a role in this organization. Docket takes the organization and inviter from the authenticated request; the body cannot override them. \`roleId\` must identify a role in this organization. Otherwise, Docket returns 404.

Inviting into a **personal organization** is rejected with **409** because a personal space can have only one member. The invitation receives an opaque \`token\`, \`status = 'pending'\`, and an \`expiresAt\` seven days in the future. The pending invitation appears in \`GET /invitations\`; redeem it through \`POST /invitations/:token/accept\` (or the legacy \`POST /accept-invite\`), or cancel it through \`DELETE /invitations/:id\`. This operation creates the invitation but does not send its acceptance link by email.`,
    }),
    zJson(MemberInvite),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const row = await createInvitation(orgId, actorId, c.req.valid('json'));
      return ok(c, InvitationOut, toInvitationOut(row));
    },
  )
  .post(
    '/accept-invite',
    apiDoc({
      tag: 'Members',
      summary: 'Accept an invitation',
      response: MemberOut,
      description: `Legacy alias for \`POST /invitations/:token/accept\`. New clients should use the path form. This alias reads the invitation token from the JSON body as \`{ "token": "…" }\`.

Accept a pending invitation and return the new \`MemberOut\`. The signed-in user receives the role named by the invitation, and the invitation changes to \`accepted\` with an \`acceptedAt\` time. Docket returns 404 when the token does not identify an invitation in this organization. It returns 409 when the invitation is expired or no longer pending, or when the user is already a member.`,
    }),
    zJson(InvitationAccept),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const invitedActor = await acceptInvitation(orgId, c.req.valid('json').token, session);
      await enqueueSearchUpsert(orgId, 'actor', invitedActor.id);
      return ok(c, MemberOut, toMemberOut(invitedActor));
    },
  )
  .get(
    '/invitations',
    apiDoc({
      tag: 'Members',
      summary: 'List pending invitations',
      response: pageOf(InvitationOut),
      description: `List invitations whose stored status is \`pending\`. Accepted and revoked invitations are excluded. Each \`InvitationOut\` includes the email, role, \`asGuest\` value, inviter, and expiration time.

Results use stable invitation-ID order. Pages default to 50 items and accept at most 100. Organization membership is sufficient to read; creating or revoking requires \`manage\`. An invitation can remain listed after \`expiresAt\`, but accepting it then returns 409. Use \`POST /invitations\` to create and \`DELETE /invitations/:id\` to revoke.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      const rows = await db
        .select()
        .from(invitation)
        .where(
          and(
            eq(invitation.organizationId, orgId),
            eq(invitation.status, 'pending'),
            seekAfterId(invitation.id, cursor, 'asc'),
          ),
        )
        .orderBy(asc(invitation.id))
        .limit(limit + 1);
      return ok(c, pageOf(InvitationOut), pageResultById(rows.map(toInvitationOut), limit));
    },
  )
  .post(
    '/invitations',
    capabilityGuard('manage'),
    apiDoc({
      status: 201,
      tag: 'Members',
      summary: 'Create an invitation',
      capability: 'manage',
      response: InvitationOut,
      description: `Invite a person by email and assign a role. The response contains a new opaque token, \`status: "pending"\`, and an expiration time seven days after creation. The invitee joins through \`POST /invitations/:token/accept\`.

Requires \`manage\`. \`roleId\` must identify a role in the organization; otherwise the request returns 404. Set \`asGuest: true\` for a guest seat. Guests cannot see work until a grant gives them access to a resource.

Personal organizations reject invitations with 409. This operation creates the invitation but does not promise email delivery. Use \`GET /invitations\` to list pending invitations and \`DELETE /invitations/:id\` to revoke one.`,
    }),
    zJson(MemberInvite),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const row = await createInvitation(orgId, actorId, c.req.valid('json'));
      return created(c, InvitationOut, toInvitationOut(row), null);
    },
  )
  .post(
    '/invitations/:token/accept',
    apiDoc({
      tag: 'Members',
      summary: 'Accept an invitation by token',
      response: MemberOut,
      description: `Accept a pending invitation by its opaque path token and join the organization with the invitation's role.

Requires an authenticated session and the valid token. The membership and invitation status change succeed together or fail together.

An unknown token returns 404. An expired, accepted, or revoked invitation returns 409, as does an existing membership. A repeated accept therefore returns 409. Returns the new \`MemberOut\`.`,
    }),
    zParam(tokenParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const invitedActor = await acceptInvitation(orgId, c.req.valid('param').token, session);
      await enqueueSearchUpsert(orgId, 'actor', invitedActor.id);
      return ok(c, MemberOut, toMemberOut(invitedActor));
    },
  )
  .delete(
    '/invitations/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Members',
      summary: 'Revoke an invitation',
      capability: 'manage',
      response: InvitationRevokeOut,
      description: `Revoke a pending invitation so its token can no longer be accepted. Requires the \`manage\` capability.

The path uses the invitation ID, not its token. An absent, accepted, or already revoked invitation returns 404. On success, Docket retains the invitation in history and returns \`{ id, revoked: true }\`. Revocation does not remove a member who already accepted; use \`DELETE /:actorId\` for that.`,
    }),
    zParam(invitationIdParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const updated = await db
        .update(invitation)
        .set({ status: 'revoked' })
        .where(
          and(
            eq(invitation.id, id),
            eq(invitation.organizationId, orgId),
            eq(invitation.status, 'pending'),
          ),
        )
        .returning({ id: invitation.id });
      const row = updated[0];
      if (!row) throw new NotFoundError('Pending invitation not found');
      return ok(c, InvitationRevokeOut, { id: row.id, revoked: true });
    },
  )
  .get(
    '/:actorId/profile',
    apiDoc({
      tag: 'Members',
      summary: "Get a person's workspace profile",
      response: PersonProfileOut,
      description: `Return one person's workspace profile, including name, avatar, participation status, organization role, active assigned tasks, led projects, and owned initiatives. Work collections are scoped to this organization and sorted for display.

The target must be a human member of this organization; an unavailable person, agent Actor, or team Actor returns 404. The response does not reveal whether the person has a Docket account. Members with and without accounts use the same profile shape. Use \`GET /v1/orgs/:orgId/members\` when a client also needs \`userId\`.`,
    }),
    zParam(actorIdParam),
    async (c) => {
      const { orgId, actorId: viewerActorId } = c.get('actorCtx');
      const { actorId } = c.req.valid('param');
      return ok(c, PersonProfileOut, await loadPersonProfile(orgId, actorId, viewerActorId));
    },
  )
  .patch(
    '/:actorId/profile',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Members',
      summary: "Update a person's name, avatar, or job title",
      capability: 'manage',
      response: PersonProfileOut,
      description: `Update a person's workspace display name or avatar and return the current {@link PersonProfileOut}. Omitted fields remain unchanged, and \`avatar: null\` removes the avatar. The target must be a human member of this organization; otherwise Docket returns 404.

These values belong to the workspace. Updating them does not change the person's account profile in another workspace. This operation cannot change role or membership status; use \`PATCH /:actorId\` for those fields.`,
    }),
    zParam(actorIdParam),
    zJson(PersonUpdate),
    async (c) => {
      const { orgId, actorId: viewerActorId } = c.get('actorCtx');
      const { actorId } = c.req.valid('param');
      const body = c.req.valid('json');

      const targetRows = await db
        .select({ id: actor.id })
        .from(actor)
        .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId), eq(actor.kind, 'human')))
        .limit(1);
      if (!targetRows[0]) throw new NotFoundError('Person not found');

      const values = {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.avatar !== undefined ? { avatar: body.avatar } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
      };
      // An empty patch is a valid no-op: skip the UPDATE and re-read, exactly as the org and
      // project patches do, rather than issuing a SET with nothing in it.
      if (Object.keys(values).length > 0) {
        await db
          .update(actor)
          .set(values)
          .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId)));
        await enqueueSearchUpsert(orgId, 'actor', actorId);
      }
      return ok(c, PersonProfileOut, await loadPersonProfile(orgId, actorId, viewerActorId));
    },
  )
  .patch(
    '/:actorId',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Members',
      summary: 'Update a member',
      capability: 'manage',
      response: MemberOut,
      description: `Update a member's \`roleId\` or \`status\` and return the current \`MemberOut\`. Omitted fields remain unchanged. The target must be a human member of this organization, and a supplied role must also belong to this organization. Otherwise, Docket returns 404.

An organization must keep at least one active Owner. Docket returns 409 when this request would suspend or change the role of the last active Owner. This operation does not change the person's display name or avatar. Use \`DELETE /:actorId\` to remove a member.`,
    }),
    zParam(actorIdParam),
    zJson(MemberUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { actorId } = c.req.valid('param');
      const body = c.req.valid('json');

      const targetRows = await db
        .select()
        .from(actor)
        .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId), eq(actor.kind, 'human')))
        .limit(1);
      const target = targetRows[0];
      if (!target) throw new NotFoundError('Member not found');

      // Tenant isolation + capability-source integrity: a re-pointed roleId must belong to
      // this org. `actor.roleId → role.id` is a bare global FK (identity.ts: role carries no
      // org constraint in the FK), and org-context resolves capabilities by joining
      // `actor.roleId → role` — so a cross-org roleId would silently confer ANOTHER org's
      // role capabilities (a tenant break + privilege-escalation / capability-source
      // confusion vector, permissions §4.5). Validate it in-org before the set; 404
      // (existence-hiding) when absent. Mirrors createInvitation's in-org role check.
      if (body.roleId !== undefined) {
        const roleRows = await db
          .select({ id: role.id })
          .from(role)
          .where(and(eq(role.id, body.roleId), eq(role.organizationId, orgId)))
          .limit(1);
        if (!roleRows[0]) throw new NotFoundError('Role not found');
      }

      // If the target is currently an Owner and this patch downgrades or suspends
      // them, ensure another active Owner remains.
      const ownerRoleRows = await db
        .select({ id: role.id })
        .from(role)
        .where(and(eq(role.organizationId, orgId), eq(role.key, 'owner')))
        .limit(1);
      const ownerRoleId = ownerRoleRows[0]?.id ?? null;
      const targetIsOwner = ownerRoleId !== null && target.roleId === ownerRoleId;
      const downgradesRole = body.roleId !== undefined && body.roleId !== ownerRoleId;
      const suspends = body.status === 'suspended';
      if (targetIsOwner && (downgradesRole || suspends)) {
        try {
          await lastOwnerGuard(db, orgId, actorId);
          /* v8 ignore start -- @preserve lastOwnerGuard only ever throws LastOwnerError, so the non-LastOwnerError rethrow is unreachable */
        } catch (err) {
          if (err instanceof LastOwnerError) throw new ConflictError(err.message);
          throw err;
        }
        /* v8 ignore stop */
      }

      const updated = await db
        .update(actor)
        .set({
          ...(body.roleId !== undefined ? { roleId: body.roleId } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        })
        .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId)))
        .returning();
      const row = updated[0];
      /* v8 ignore next -- @preserve defensive: the target member was verified to exist above */
      if (!row) throw new NotFoundError('Member not found');
      await enqueueSearchUpsert(orgId, 'actor', row.id);
      return ok(c, MemberOut, toMemberOut(row));
    },
  )
  .delete(
    '/:actorId',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Members',
      summary: 'Remove a member',
      capability: 'manage',
      response: MemberRemoveOut,
      description: `Remove a member from the organization by **actor ID**. Requires the \`manage\` capability. The target must be a member of this organization; otherwise the request returns **404**.

The request returns **409** when the target is the organization's last active Owner because every organization must retain an Owner.

The member loses team memberships, but organization-owned work they authored remains. Returns \`{ id, removed: true }\`. To revoke access without removing the member, update their status to \`suspended\`. To cancel an invitation that was never accepted, use \`DELETE /invitations/:id\`.`,
    }),
    zParam(actorIdParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { actorId } = c.req.valid('param');

      const targetRows = await db
        .select()
        .from(actor)
        .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId), eq(actor.kind, 'human')))
        .limit(1);
      const target = targetRows[0];
      if (!target) throw new NotFoundError('Member not found');

      // Removing the org's last active Owner would orphan it; the guard ensures
      // another active Owner remains before the row is deleted.
      const ownerRoleRows = await db
        .select({ id: role.id })
        .from(role)
        .where(and(eq(role.organizationId, orgId), eq(role.key, 'owner')))
        .limit(1);
      const ownerRoleId = ownerRoleRows[0]?.id ?? null;
      if (ownerRoleId !== null && target.roleId === ownerRoleId) {
        try {
          await lastOwnerGuard(db, orgId, actorId);
          /* v8 ignore start -- @preserve lastOwnerGuard only ever throws LastOwnerError, so the non-LastOwnerError rethrow is unreachable */
        } catch (err) {
          if (err instanceof LastOwnerError) throw new ConflictError(err.message);
          throw err;
        }
        /* v8 ignore stop */
      }

      const deleted = await db
        .delete(actor)
        .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId)))
        .returning({ id: actor.id });
      const row = deleted[0];
      /* v8 ignore next -- @preserve defensive: the target member was verified to exist above */
      if (!row) throw new NotFoundError('Member not found');
      await enqueueSearchDelete(orgId, 'actor', row.id);
      return ok(c, MemberRemoveOut, { id: row.id, removed: true });
    },
  );

export default members;

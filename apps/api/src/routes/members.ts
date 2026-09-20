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
      description: `List the workspace's people with each person's display name, avatar, status, role ID, and optional Docket account ID. Agents and teams are not included. Both active and suspended people are returned so an administrator can review and reactivate suspended members.

**Account-holders and account-less people are one list.** A person added by \`POST /\` carries \`userId: null\`; a person who redeemed an invitation carries their Better Auth user id. Nothing filters on that column, and the ordering is a plain case-insensitive sort by \`displayName\` — never by account presence, join date, or insertion order — so the two kinds interleave by name and no client can accidentally render them as two groups.

The cursor preserves that name order with person ID as its stable tiebreaker. Pages default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Any workspace member may read the roster. Use \`GET /invitations\` to list people who have been invited but have not joined.`,
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
      description: `**Legacy alias** for \`POST /invitations\` — kept for older clients; new integrations should prefer \`POST /invitations\`. Both call the same \`createInvitation\` helper and behave identically.

Create a pending invitation that binds an email address to a role within this org. Requires the \`manage\` capability because issuing an invitation grants future org access. The \`organizationId\` and \`invitedBy\` are taken from the verified actor context, never the request body, so a caller cannot invite into another org or forge the inviter. The target \`roleId\` is validated to belong to THIS org — a foreign or missing role returns **404** (existence-hiding), preventing a cross-org role from being smuggled onto a new member.

Inviting into a **personal organization** is rejected with **409** (a personal space is an org-of-one). The invitation is created with a freshly generated opaque \`token\`, \`status = 'pending'\`, and an \`expiresAt\` 7 days out. The pending row appears in \`GET /invitations\`; redeem it via \`POST /invitations/:token/accept\` (or the legacy \`POST /accept-invite\`), or cancel it via \`DELETE /invitations/:id\`. Note: this endpoint creates the durable invitation record; email delivery of the accept link is handled by the notification/email boundary, not this handler.`,
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
      description: `**Legacy alias** for \`POST /invitations/:token/accept\` — same redemption logic, but the opaque token is supplied in the JSON body (\`{ token }\`) rather than the path. New clients should prefer the path form.

Redeem a pending invitation and materialize the accepting user's **human Actor** in the org. Requires only an authenticated session (no capability): the bearer of a valid token is, by definition, the invited party, so the token IS the authorization. The whole redemption runs in one transaction: it loads the invitation by \`(token, orgId)\`, then verifies it is still \`pending\` and unexpired, that the user is not already a member, inserts the human Actor carrying the invitation's role, and flips the invitation to \`accepted\` (stamping \`acceptedAt\`).

Errors: **404** when no invitation matches the token in this org (existence-hiding); **409** when the invitation is non-pending (already accepted/revoked/expired status), past its \`expiresAt\`, or the user already belongs to the org. On success returns the newly created \`MemberOut\`. The new member's capabilities flow from the invitation's role (e.g. an invitation bound to the Member role confers org-wide \`contribute\`). See \`POST /invitations\` to issue invitations and \`GET /invitations\` to list pending ones.`,
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
      description: `Fetch one person's profile: their name, avatar, participation status, the org role they hold (id **and** resolved name), and the work they are on the hook for — active tasks assigned to them, projects they lead, and initiatives they own, each org-scoped and each sorted for reading rather than by insertion.

The target must be a human Actor in this org; anything else 404s (existence-hiding), which covers a cross-tenant id, an agent actor, and a team actor alike. Requires only org membership (no \`manage\`): who someone is and what they are carrying is roster information, the same as \`GET /\`.

**This endpoint answers the same question for every person.** It has no field reporting whether the person holds a Docket account, so a client cannot branch its rendering on that — an account-less volunteer's profile resolves, renders and lists assigned work exactly like an account-holder's. Their \`userId\` is available on \`GET /\` for the few surfaces that genuinely need it (see \`docs/engineering/specs/people.md\`).`,
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
      description: `Rename a person or re-point their avatar. Both fields are optional; an absent key leaves the column untouched and \`avatar: null\` clears it. Requires \`manage\`, and the target must be a human Actor in this org (404 otherwise, existence-hiding).

This writes \`actor.display_name\` / \`actor.avatar\` — the **workspace-owned** identity, which every human Actor has. For an account-less person it is the only place their name lives. For an account-holder it is the copy taken from their account at join time and never re-synced, so editing it renames them in this workspace without touching their account; their own Settings → Profile still governs their account name. The operation is offered on the same terms to both, so there is no person in the roster whose name the workspace cannot correct.

Role and status live on \`PATCH /:actorId\` (they carry the last-owner guard); this endpoint deliberately cannot change either. Returns the person's refreshed {@link PersonProfileOut}.`,
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
      description: `Patch a member's **role** and/or **status** (\`active\` | \`suspended\`). Both fields are optional; only the supplied ones change. Requires the \`manage\` capability because re-pointing a role or suspending a member alters org access. The member is addressed by their **actor id** (\`actorId\`), and the target must be a human Actor in this org — otherwise **404** (existence-hiding).

**Cross-org role guard:** when \`roleId\` is supplied it is validated to belong to THIS org before the write. \`actor.roleId → role.id\` is a bare global FK with no org constraint, and org-context resolves capabilities by joining that FK — so an unvalidated cross-org role would silently confer ANOTHER org's capabilities (a tenant break + privilege-escalation vector, permissions §4.5). A foreign/unknown role therefore returns **404**.

**Last-owner guard:** if the target currently holds the Owner role and this patch would downgrade them (a \`roleId\` other than Owner) or suspend them (\`status: 'suspended'\`), the org must retain at least one other active Owner — otherwise the operation is rejected with **409**. This upholds the invariant that an org always has ≥1 active Owner. Re-pointing a non-Owner, or changing fields that don't drop the last Owner, is unaffected.

Returns the updated \`MemberOut\`. Note this endpoint does NOT change \`displayName\`/\`avatar\` (those live on the user/account profile) — it is strictly role + status. To remove a member entirely use \`DELETE /:actorId\`.`,
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

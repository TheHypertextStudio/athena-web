/**
 * `@docket/api` — members router (mounted at `/v1/orgs/:orgId/members`).
 *
 * @remarks
 * Members are human {@link actor}s carrying a role. New membership flows through
 * invitations: create a pending row (`POST /invitations` or the legacy `POST /invite`),
 * list the pending ones (`GET /invitations`), accept by token (`POST /invitations/:token/accept`
 * or the legacy `POST /accept-invite`) which materializes the human Actor for the
 * accepting User, or revoke a pending one (`DELETE /invitations/:id`). Role/status
 * patches and member removal (`DELETE /:actorId`) run the {@link lastOwnerGuard} so an
 * org always retains an active Owner; inviting into a personal org is blocked.
 * `manage` is required to mutate.
 */
import { actor, db, invitation, role } from '@docket/db';
import { lastOwnerGuard, LastOwnerError } from '@docket/authz';
import {
  InvitationAccept,
  InvitationOut,
  InvitationRevokeOut,
  MemberInvite,
  MemberOut,
  MemberRemoveOut,
  MemberUpdate,
  pageOf,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { AuthError, ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

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
      description: `List the organization's members — every **human Actor** (\`kind = 'human'\`) in the org, each carrying its display name, avatar, status (\`active\` | \`suspended\`), role id, and backing \`userId\`. Agents (\`kind = 'agent'\`) and team actors (\`kind = 'team'\`) are excluded; this endpoint is the people roster, not the full actor set. Both \`active\` and \`suspended\` members are returned so an admin can see and re-activate suspended seats.

Requires only org membership (no \`manage\`): any member, resolved by \`orgContextMiddleware\`, may see who else is in the org. Returns the standard \`{ items }\` page envelope of \`MemberOut\`. To enumerate non-human actors see the agents router; to see outstanding invitations (people not yet members) see \`GET /invitations\`.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db
        .select()
        .from(actor)
        .where(and(eq(actor.organizationId, orgId), eq(actor.kind, 'human')));
      return ok(c, pageOf(MemberOut), { items: rows.map(toMemberOut) });
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
      description: `List the org's **pending** invitations — outstanding offers not yet accepted, revoked, or expired. The query filters strictly on \`status = 'pending'\`, so accepted/revoked/expired rows never appear here even though they remain in the table for audit. Each \`InvitationOut\` carries the invited email, target role, \`asGuest\` flag, who invited them (\`invitedBy\`), and the \`expiresAt\` deadline.

Requires only org membership (no \`manage\`) to read — any member can see who's been invited; \`manage\` is only required to create or revoke. Returns the standard \`{ items }\` page envelope. Note: an invitation whose \`expiresAt\` has passed but whose stored \`status\` is still \`pending\` will still appear here (expiry is enforced at accept time, not by a sweep); treat \`expiresAt < now\` as effectively expired on the client. See \`POST /invitations\` to create and \`DELETE /invitations/:id\` to revoke.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db
        .select()
        .from(invitation)
        .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, 'pending')));
      return ok(c, pageOf(InvitationOut), { items: rows.map(toInvitationOut) });
    },
  )
  .post(
    '/invitations',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Members',
      summary: 'Create an invitation',
      capability: 'manage',
      response: InvitationOut,
      description: `Invite a person to the organization by email, bound to a role. Creates a pending \`invitation\` row with a freshly generated opaque \`token\`, \`status = 'pending'\`, and \`expiresAt\` 7 days out; redemption then materializes the invitee's human Actor (see \`POST /invitations/:token/accept\`).

Requires the \`manage\` capability because issuing an invitation grants future org access. \`organizationId\` and \`invitedBy\` are sourced from the verified actor context, never the body — a caller cannot invite into another org or spoof the inviter. The target \`roleId\` MUST belong to this org; a foreign or unknown role returns **404** (existence-hiding), which also blocks a cross-org role from being attached to a new member. Set \`asGuest: true\` to mark the invitation as a guest seat (the Guest role is grant-only — the invitee sees nothing until explicit grants name resources for them).

Inviting into a **personal organization** is rejected with **409** (org-of-one). This is the canonical create endpoint; \`POST /invite\` is a legacy alias with identical behavior. Email delivery of the accept link is handled downstream by the email boundary, not this handler — this call only persists the durable invitation. Related: \`GET /invitations\` (list pending), \`DELETE /invitations/:id\` (revoke).`,
    }),
    zJson(MemberInvite),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const row = await createInvitation(orgId, actorId, c.req.valid('json'));
      return ok(c, InvitationOut, toInvitationOut(row));
    },
  )
  .post(
    '/invitations/:token/accept',
    apiDoc({
      tag: 'Members',
      summary: 'Accept an invitation by token',
      response: MemberOut,
      description: `Redeem a pending invitation by its opaque \`token\` (supplied in the path) and join the org as a **human Actor**. This is the canonical accept endpoint; \`POST /accept-invite\` is the legacy body-token alias with identical logic.

Requires only an authenticated session — possession of the valid token is the authorization (the token IS the secret). Runs one transaction: load the invitation by \`(token, orgId)\`, assert it is \`pending\` and unexpired, assert the caller is not already a member, insert the human Actor bound to the invitation's role, and flip the invitation to \`accepted\` with \`acceptedAt\` set.

Errors: **404** when no invitation matches the token in this org (existence-hiding); **409** when the invitation is no longer pending, has passed \`expiresAt\`, or the user is already a member. Returns the new \`MemberOut\`. The accepting user's session must already be authenticated for the org context to resolve; the new actor's capabilities derive from the invitation's role. Idempotency note: a second accept of the same token returns 409 (already accepted), so clients should treat 409-already-member as success.`,
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
      description: `Cancel a still-pending invitation by its id, flipping its \`status\` from \`pending\` to \`revoked\` so the token can no longer be redeemed. Requires the \`manage\` capability (the same gate as issuing one). The update is scoped to \`(id, orgId, status = 'pending')\`: only a pending invitation belonging to THIS org is affected, which both enforces tenant isolation and makes the operation a safe no-op-then-404 against already-accepted/revoked rows.

Returns **404** when no pending invitation with that id exists in the org (it was never created here, already accepted, or already revoked) — note this is keyed on the invitation **id**, not the token. On success returns \`{ id, revoked: true }\`. Revocation does not delete the row (it stays for audit) and does not affect a member who has already accepted — to remove an accepted member use \`DELETE /:actorId\`. See \`POST /invitations\` to create and \`GET /invitations\` to list pending ones.`,
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
      description: `Remove a member from the organization by **actor id**, hard-deleting their human Actor row. Requires the \`manage\` capability. The target must be a human Actor in this org — otherwise **404** (existence-hiding). The delete is scoped to \`(actorId, orgId)\` so a caller can never reach into another tenant.

**Last-owner guard:** if the target is the org's last active Owner, removal is rejected with **409** — an org must always retain at least one active Owner (permissions §4.5), so the row is only deleted after the guard confirms another active Owner remains.

Side effects: deleting the Actor cascades per the database's referential rules to the rows that key off it (e.g. team memberships); however, work the member authored that is owned by org-scoped resources is not deleted by this call. Returns \`{ id, removed: true }\`. To revoke access without deleting the seat, prefer \`PATCH /:actorId\` with \`status: 'suspended'\`; to cancel an invitation that was never accepted use \`DELETE /invitations/:id\` instead.`,
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

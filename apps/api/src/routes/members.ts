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
    apiDoc({ tag: 'Members', summary: 'List members', response: pageOf(MemberOut) }),
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
    apiDoc({ tag: 'Members', summary: 'Accept an invitation', response: MemberOut }),
    zJson(InvitationAccept),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const invitedActor = await acceptInvitation(orgId, c.req.valid('json').token, session);
      return ok(c, MemberOut, toMemberOut(invitedActor));
    },
  )
  .get(
    '/invitations',
    apiDoc({
      tag: 'Members',
      summary: 'List pending invitations',
      response: pageOf(InvitationOut),
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
    apiDoc({ tag: 'Members', summary: 'Accept an invitation by token', response: MemberOut }),
    zParam(tokenParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const invitedActor = await acceptInvitation(orgId, c.req.valid('param').token, session);
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
      return ok(c, MemberRemoveOut, { id: row.id, removed: true });
    },
  );

export default members;

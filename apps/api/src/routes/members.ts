import { archiveWorkspacePerson } from './person-removal';
import { resolvePersonAlias } from '../lib/identity/person-alias';
import { createWorkspacePerson } from '../lib/identity/create-person';
/**
 * `@docket/api` — members router (mounted at `/v1/orgs/:orgId/members`).
 *
 * @remarks
 * Members are the workspace's **people**: every human {@link actor}, with or without a role. There are
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
 * an org always retains an active account-backed Owner. Personal orgs permit accountless
 * people but reject invitations. Creating people requires contribute; access changes require manage.
 *
 * @see {@link file://../../../../docs/engineering/specs/people.md} for the full enumeration of
 * where account-holders and account-less people are deliberately treated differently.
 */
import { actor, db, invitation, role } from '@docket/db';
import { PEOPLE_CAPABILITIES } from '@docket/identity-access/capabilities';
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
import {
  consolidatePeople,
  previewPersonConsolidation,
  PersonConsolidation,
  PersonConsolidationConfirm,
  PersonConsolidationPreview,
} from './person-consolidation';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, asc, eq, gt, or, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import {
  AuthError,
  CapabilityError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../error';
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
  isAccountBackedOwner,
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
            isNull(actor.archivedAt),
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
    capabilityGuard(PEOPLE_CAPABILITIES.create),
    apiDoc({
      status: 201,
      tag: 'Members',
      summary: 'Add a person without an account',
      capability: PEOPLE_CAPABILITIES.create,
      response: MemberOut,
      description: `Create a workspace person without an account or invitation. Requires contribute. Personal workspaces support accountless people. The default role is null; an explicitly supplied role requires manage and must belong to this workspace. Use Idempotency-Key to retry without duplicate creation.`,
    }),
    zJson(PersonCreate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const body = c.req.valid('json');

      const roleId = body.roleId ?? null;
      if (body.roleId !== undefined && !c.get('actorCtx').capabilities.includes('manage')) {
        throw new CapabilityError();
      }
      if (roleId !== null) {
        const roleRows = await db
          .select({ id: role.id })
          .from(role)
          .where(and(eq(role.id, roleId), eq(role.organizationId, orgId)))
          .limit(1);
        if (!roleRows[0]) throw new NotFoundError('Role not found');
      }

      const row = await createWorkspacePerson(db, {
        orgId,
        displayName: body.displayName,
        avatar: body.avatar ?? null,
        roleId,
      });
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
      description: `List the org's **pending** invitations — outstanding offers not yet accepted, revoked, or expired. The query filters strictly on \`status = 'pending'\`, so accepted/revoked/expired rows never appear here even though they remain in the table for audit. Each \`InvitationOut\` carries the invited email, target role, \`asGuest\` flag, who invited them (\`invitedBy\`), and the \`expiresAt\` deadline.

Results use stable invitation-id order, default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Requires only org membership (no \`manage\`) to read — any member can see who's been invited; \`manage\` is only required to create or revoke. Note: an invitation whose \`expiresAt\` has passed but whose stored \`status\` is still \`pending\` will still appear here (expiry is enforced at accept time, not by a sweep); treat \`expiresAt < now\` as effectively expired on the client. See \`POST /invitations\` to create and \`DELETE /invitations/:id\` to revoke.`,
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
      description: `Invite a person to the organization by email, bound to a role. Creates a pending \`invitation\` row with a freshly generated opaque \`token\`, \`status = 'pending'\`, and \`expiresAt\` 7 days out; redemption then materializes the invitee's human Actor (see \`POST /invitations/:token/accept\`).

Requires the \`manage\` capability because issuing an invitation grants future org access. \`organizationId\` and \`invitedBy\` are sourced from the verified actor context, never the body — a caller cannot invite into another org or spoof the inviter. The target \`roleId\` MUST belong to this org; a foreign or unknown role returns **404** (existence-hiding), which also blocks a cross-org role from being attached to a new member. Set \`asGuest: true\` to mark the invitation as a guest seat (the Guest role is grant-only — the invitee sees nothing until explicit grants name resources for them).

Inviting into a **personal organization** is rejected with **409** (org-of-one). This is the canonical create endpoint; \`POST /invite\` is a legacy alias with identical behavior. Email delivery of the accept link is handled downstream by the email boundary, not this handler — this call only persists the durable invitation. Related: \`GET /invitations\` (list pending), \`DELETE /invitations/:id\` (revoke).`,
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
  .post(
    '/:actorId/consolidation-preview',
    capabilityGuard(PEOPLE_CAPABILITIES.manageIdentities),
    apiDoc({
      tag: 'Members',
      summary: 'Preview duplicate person consolidation',
      response: PersonConsolidationPreview,
    }),
    zParam(actorIdParam),
    zJson(PersonConsolidation),
    async (c) =>
      ok(
        c,
        PersonConsolidationPreview,
        await previewPersonConsolidation(
          c.get('actorCtx').orgId,
          c.req.valid('param').actorId,
          c.req.valid('json').survivorActorId,
        ),
      ),
  )
  .post(
    '/:actorId/consolidate',
    capabilityGuard(PEOPLE_CAPABILITIES.manageIdentities),
    apiDoc({ tag: 'Members', summary: 'Consolidate duplicate people', response: PersonProfileOut }),
    zParam(actorIdParam),
    zJson(PersonConsolidationConfirm),
    async (c) => {
      const { orgId, actorId: viewerActorId } = c.get('actorCtx');
      const sourceId = c.req.valid('param').actorId;
      const survivorId = c.req.valid('json').survivorActorId;
      await consolidatePeople(orgId, sourceId, survivorId, {
        mergedBy: viewerActorId,
        previewRevision: c.req.valid('json').previewRevision,
      });
      await enqueueSearchDelete(orgId, 'actor', sourceId);
      await enqueueSearchUpsert(orgId, 'actor', survivorId);
      return ok(
        c,
        PersonProfileOut,
        await loadPersonProfile(orgId, survivorId, viewerActorId, c.get('actorCtx').capabilities),
      );
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
      return ok(
        c,
        PersonProfileOut,
        await loadPersonProfile(orgId, actorId, viewerActorId, c.get('actorCtx').capabilities),
      );
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
      const actorId = await resolvePersonAlias(orgId, c.req.valid('param').actorId);
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
      return ok(
        c,
        PersonProfileOut,
        await loadPersonProfile(orgId, actorId, viewerActorId, c.get('actorCtx').capabilities),
      );
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

**Cross-org role guard:** when \`roleId\` is supplied it is validated to belong to THIS org before the write. \`actor.roleId → role.id\` is a bare global FK with no org constraint, and org-context resolves capabilities by joining that FK — so an unvalidated cross-org role would silently confer ANOTHER org's capabilities (a tenant break + privilege-escalation vector, permissions §4.5). A foreign/unknown role therefore returns **404**.

**Last-owner guard:** if the target currently holds the Owner role and this patch would downgrade them (a \`roleId\` other than Owner) or suspend them (\`status: 'suspended'\`), the org must retain at least one other active account-backed Owner — otherwise the operation is rejected with **409**. This upholds the invariant that an org always has ≥1 active account-backed Owner. Re-pointing a non-Owner, or changing fields that don't drop the last Owner, is unaffected.

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
      const targetIsOwner = isAccountBackedOwner(target, ownerRoleId);
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
      description: `Remove workspace access and archive the person's roster entry while retaining historical assignments, mentions, identity aliases, and invitation history. Requires manage. The target must be a human actor in this workspace. The last active account-backed owner cannot be removed. Removal clears account and role links, deletes actor access grants and team/project memberships, and revokes pending invitations targeting this person. Returns { id, removed: true }`,
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
      if (isAccountBackedOwner(target, ownerRoleId)) {
        try {
          await lastOwnerGuard(db, orgId, actorId);
          /* v8 ignore start -- @preserve lastOwnerGuard only ever throws LastOwnerError, so the non-LastOwnerError rethrow is unreachable */
        } catch (err) {
          if (err instanceof LastOwnerError) throw new ConflictError(err.message);
          throw err;
        }
        /* v8 ignore stop */
      }

      const row = await archiveWorkspacePerson(orgId, actorId);
      await enqueueSearchDelete(orgId, 'actor', row.id);
      return ok(c, MemberRemoveOut, { id: row.id, removed: true });
    },
  );

export default members;

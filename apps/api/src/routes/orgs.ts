/**
 * `@docket/api` — organizations router (mounted at `/v1/orgs`).
 *
 * @remarks
 * `POST /` is the single un-nested create (the org doesn't exist yet, so it is not
 * org-context-guarded); it runs ONE transaction seeding the org, its 4 system roles,
 * the creator's Owner actor, a default team (+ its team actor + membership), and the
 * org-root role grants. All nested routes go through `orgContextMiddleware`.
 */
import {
  actor,
  db,
  grant,
  initiativeHierarchyLink,
  organization,
  role,
  team,
  teamMember,
} from '@docket/db';
import type { DefaultTeamOut } from '@docket/types';
import {
  OrgCreate,
  OrgCreateResult,
  OrgOut,
  OrgSummary,
  WorkspaceSettingsOut,
  WorkspaceSettingsUpdate,
  pageOf,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, ConflictError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { orgContextMiddleware } from '../permissions/org-context-middleware';
import { enqueueSearchUpsert } from '../search/write-through';
import { initiativeHierarchyDepth } from './initiative-hierarchy';
import { SYSTEM_ROLES, resolveUniqueSlug, slugify, toOrgOut } from './org-helpers';
import activity from './activity';
import stream from './stream';
import agentSessions from './agent-sessions';
import agents from './agents';
import billing from './billing';
import automationRules from './automation-rules';
import capture from './capture';
import calendarSchedules from './calendar-schedules';
import comments from './comments';
import cycles from './cycles';
import emailSuggestions from './email-suggestions';
import entityDisplay from './entity-display';
import dependencyGraph from './dependency-graph';
import grants from './grants';
import initiatives from './initiatives';
import integrations from './integrations';
import integrationsMcp from './integrations-mcp';
import labels from './labels';
import members from './members';
import milestones from './milestones';
import programs from './programs';
import projects from './projects';
import projectRollup from './project-rollup';
import roles from './roles';
import savedViews from './saved-views';
import search from './search';
import tasks from './tasks';
import teams from './teams';
import updates from './updates';

/** Organizations router (memberships, create-org transaction, nested project/task routers). */
const orgs = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Orgs',
      summary: 'List organizations',
      response: pageOf(OrgSummary),
      description: `List every organization the authenticated user belongs to, as compact \`OrgSummary\` rows for the org switcher / rail. Membership is derived from the user's **human Actor** rows: the query joins \`actor\` (where \`kind = 'human'\` and \`user_id\` = the session user) to \`organization\`, so an org appears here only if the caller has a human Actor in it. Personal spaces (\`isPersonal: true\`) are included alongside team orgs. This is the only un-nested org read — it is NOT behind \`orgContextMiddleware\` because it spans orgs; every other org route lives under \`/:orgId\` and resolves a single membership. Requires only an authenticated session (no capability), since it returns only the orgs the caller already belongs to. Results are unpaginated in practice (a user's membership count is small) but still wrapped in the standard \`{ items }\` page envelope. See \`GET /:orgId\` for the full representation of one org.`,
    }),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const rows = await db
        .select({ org: organization })
        .from(actor)
        .innerJoin(organization, eq(actor.organizationId, organization.id))
        .where(and(eq(actor.userId, session.user.id), eq(actor.kind, 'human')));
      const items = rows.map((r) => ({
        id: r.org.id,
        name: r.org.name,
        slug: r.org.slug,
        avatar: r.org.avatar,
        isPersonal: r.org.isPersonal,
      }));
      return ok(c, pageOf(OrgSummary), { items });
    },
  )
  .post(
    '/',
    apiDoc({
      tag: 'Orgs',
      summary: 'Create an organization',
      response: OrgCreateResult,
      description: `Create a new organization. This is the single un-nested write in the API: the org does not exist yet, so there is no \`orgId\` to guard and no capability is required beyond an authenticated session — the caller becomes the org's first **Owner**.

The handler runs ONE database transaction that seeds the entire tenant baseline so the org is immediately usable:
- the \`organization\` row (name, resolved slug, purpose, \`isPersonal\`, and the chosen vocabulary skin);
- the **four system roles** — Owner, Admin, Member, Guest (\`isSystem = true\`) — each with its seeded capability bundle and default visibility;
- the creator's **Owner human Actor** (\`kind = 'human'\`, \`user_id\` = the caller), bound to the Owner role;
- a default team named **"General"** (key \`GEN\`), its backing team Actor (\`kind = 'team'\`), and the Owner's membership in it;
- the org-root **role grants** that materialize each role's org-wide base capability (Owner/Admin → \`manage\`, Member → \`contribute\`; Guest gets none, which is what makes guests grant-only).

Two creation shapes (see \`OrgCreate\`): a **team org** (\`isPersonal: false\`, default) requires \`name\`; a **personal space** (\`isPersonal: true\`) is an org-of-one whose name defaults to \`'Personal'\`. Personal-space creation is **idempotent per user** — if the caller already owns an \`is_personal\` org, that existing org (with its default team + owner actor) is returned instead of seeding a duplicate.

Slug handling: an explicitly supplied \`slug\` that collides on the unique org-slug index returns **409**; an auto-derived slug (from the name, or a per-user \`personal-<userId>\` slug for personal spaces) is silently disambiguated with a random suffix so a repeated workspace name still succeeds. The slug is resolved BEFORE the transaction so a collision is a clean 409 rather than an opaque 500.

Returns \`OrgCreateResult\` — the new org plus its seeded \`defaultTeam\` and \`ownerActorId\`, which the client needs to immediately scope subsequent \`/:orgId/*\` calls. See \`GET /\` to list memberships and \`POST /:orgId/members/invitations\` to grow a team org.`,
    }),
    zJson(OrgCreate),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const body = c.req.valid('json');
      const displayName = session.user.name || session.user.email;
      const userId = session.user.id;

      // Personal space (org-of-one): the name/vocabulary are not prompted for, so default
      // the name to 'Personal'. Team orgs keep `name` required (enforced by OrgCreate's
      // superRefine), so `body.name` is always present when `isPersonal` is false.
      const isPersonal = body.isPersonal;
      const orgName = body.name ?? 'Personal';

      // One personal space per user: if the caller already owns an `is_personal` org, return
      // it instead of seeding a duplicate (idempotent on the user, per DECISIONS "personal
      // space"). The unique org-slug index would also reject a second `personal` slug, so this
      // guard both makes the call idempotent and avoids the collision.
      if (isPersonal) {
        const existing = await db
          .select({ org: organization })
          .from(actor)
          .innerJoin(organization, eq(actor.organizationId, organization.id))
          .where(
            and(
              eq(actor.userId, userId),
              eq(actor.kind, 'human'),
              eq(organization.isPersonal, true),
            ),
          )
          .limit(1);
        const existingOrg = existing[0]?.org;
        if (existingOrg) {
          const existingTeam = await db
            .select({ id: team.id, name: team.name, key: team.key })
            .from(team)
            .where(eq(team.organizationId, existingOrg.id))
            .limit(1);
          const existingOwner = await db
            .select({ id: actor.id })
            .from(actor)
            .where(
              and(
                eq(actor.organizationId, existingOrg.id),
                eq(actor.userId, userId),
                eq(actor.kind, 'human'),
              ),
            )
            .limit(1);
          const dt = existingTeam[0];
          const owner = existingOwner[0];
          /* v8 ignore next -- @preserve defensive: a personal org always seeds a default team + owner actor */
          if (dt && owner) {
            const payload: z.input<typeof OrgCreateResult> = {
              organization: toOrgOut(existingOrg),
              defaultTeam: { id: dt.id, name: dt.name, key: dt.key } satisfies z.input<
                typeof DefaultTeamOut
              >,
              ownerActorId: owner.id,
            };
            return ok(c, OrgCreateResult, payload);
          }
        }
      }

      // Resolve a slug that is free on the unique `organization_slug_uq` index BEFORE the seed
      // transaction: a collision inside the transaction (e.g. two team orgs named the same) would
      // otherwise abort it and surface as an opaque 500. An explicit slug collision is a clean
      // 409; an auto-derived one is silently disambiguated so a repeated workspace name succeeds.
      // Personal spaces use a per-user `personal-<userId>` slug that never collides across users.
      const baseSlug = body.slug ?? (isPersonal ? `personal-${slugify(userId)}` : slugify(orgName));
      const slug = await resolveUniqueSlug(baseSlug, body.slug !== undefined);

      const result = await db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organization)
          .values({
            name: orgName,
            slug,
            purpose: body.purpose,
            isPersonal,
            vocabulary: { preset: body.vocabulary },
          })
          .returning();
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!org) throw new Error('organization insert returned no row');

        const insertedRoles = await tx
          .insert(role)
          .values(SYSTEM_ROLES.map((r) => ({ organizationId: org.id, isSystem: true, ...r })))
          .returning();
        const roleByKey = new Map(insertedRoles.map((r) => [r.key, r]));
        const ownerRole = roleByKey.get('owner');
        /* v8 ignore next -- @preserve defensive: the owner system role is always seeded above */
        if (!ownerRole) throw new Error('owner role not seeded');

        const [ownerActor] = await tx
          .insert(actor)
          .values({
            organizationId: org.id,
            kind: 'human',
            displayName,
            userId: session.user.id,
            roleId: ownerRole.id,
          })
          .returning();
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!ownerActor) throw new Error('owner actor insert returned no row');

        const [defaultTeam] = await tx
          .insert(team)
          .values({ organizationId: org.id, name: 'General', key: 'GEN' })
          .returning();
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!defaultTeam) throw new Error('default team insert returned no row');

        await tx
          .insert(actor)
          .values({ organizationId: org.id, kind: 'team', displayName: defaultTeam.name });
        await tx
          .insert(teamMember)
          .values({ teamId: defaultTeam.id, actorId: ownerActor.id, organizationId: org.id });

        // Materialize the owner/admin/member role base as grants at the org root.
        const grantValues: (typeof grant.$inferInsert)[] = [];
        for (const key of ['owner', 'admin', 'member'] as const) {
          const r = roleByKey.get(key);
          /* v8 ignore next -- @preserve defensive: owner/admin/member are always in the seeded role map */
          if (!r) continue;
          grantValues.push({
            organizationId: org.id,
            subjectKind: 'role',
            subjectId: r.id,
            resourceKind: 'organization',
            resourceId: org.id,
            /* v8 ignore next -- @preserve owner/admin/member always carry a baseCapability; the [] side is unreachable here */
            capabilities: r.baseCapability ? [r.baseCapability] : [],
            effect: 'allow',
          });
        }
        /* v8 ignore next -- @preserve owner/admin/member always populate grantValues, so the empty-list skip is unreachable */
        if (grantValues.length > 0) await tx.insert(grant).values(grantValues);

        return { org, ownerActor, defaultTeam };
      });

      const payload: z.input<typeof OrgCreateResult> = {
        organization: toOrgOut(result.org),
        defaultTeam: {
          id: result.defaultTeam.id,
          name: result.defaultTeam.name,
          key: result.defaultTeam.key,
        } satisfies z.input<typeof DefaultTeamOut>,
        ownerActorId: result.ownerActor.id,
      };
      await Promise.all([
        enqueueSearchUpsert(result.org.id, 'organization', result.org.id),
        enqueueSearchUpsert(result.org.id, 'actor', result.ownerActor.id),
        enqueueSearchUpsert(result.org.id, 'team', result.defaultTeam.id),
      ]);
      return ok(c, OrgCreateResult, payload);
    },
  )
  .get(
    '/:orgId/settings/work-structure',
    orgContextMiddleware,
    apiDoc({
      tag: 'Orgs',
      summary: 'Get workspace work-structure settings',
      response: WorkspaceSettingsOut,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db
        .select({ initiativeMaxDepth: organization.initiativeMaxDepth })
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1);
      const settings = rows[0];
      /* v8 ignore next -- @preserve org context middleware proved the workspace exists */
      if (!settings) throw new AuthError();
      return ok(c, WorkspaceSettingsOut, settings);
    },
  )
  .patch(
    '/:orgId/settings/work-structure',
    orgContextMiddleware,
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Orgs',
      summary: 'Update workspace work-structure settings',
      capability: 'manage',
      response: WorkspaceSettingsOut,
    }),
    zJson(WorkspaceSettingsUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const body = c.req.valid('json');
      const settings = await db.transaction(async (tx) => {
        await tx
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.id, orgId))
          .for('update');
        if (body.initiativeMaxDepth !== undefined) {
          const edges = await tx
            .select({
              parentInitiativeId: initiativeHierarchyLink.parentInitiativeId,
              childInitiativeId: initiativeHierarchyLink.childInitiativeId,
            })
            .from(initiativeHierarchyLink)
            .where(eq(initiativeHierarchyLink.contextOrganizationId, orgId));
          if (initiativeHierarchyDepth(edges) > body.initiativeMaxDepth) {
            throw new ConflictError('Existing Initiative hierarchy exceeds the requested depth');
          }
        }
        const rows = await tx
          .update(organization)
          .set(body)
          .where(eq(organization.id, orgId))
          .returning({ initiativeMaxDepth: organization.initiativeMaxDepth });
        return rows[0];
      });
      /* v8 ignore next -- @preserve org context middleware proved the workspace exists */
      if (!settings) throw new AuthError();
      return ok(c, WorkspaceSettingsOut, settings);
    },
  )
  .get(
    '/:orgId',
    orgContextMiddleware,
    apiDoc({
      tag: 'Orgs',
      summary: 'Get an organization',
      response: OrgOut,
      description: `Fetch the full \`OrgOut\` representation of a single organization — name, slug, purpose, avatar, \`isPersonal\`, the resolved vocabulary skin, lifecycle state, and creation time. The org id comes from the verified actor context, not a re-read of the path, so the response always reflects the org the caller is actually a member of.

Membership is enforced by \`orgContextMiddleware\` (which runs before this handler for every \`/:orgId/*\` route): it loads the caller's human Actor for \`(session user, orgId)\` and **404s when no membership exists** — existence-hiding, so a non-member cannot even confirm the org exists. No explicit capability is required beyond membership; any role (including Guest) that has a resolved Actor in the org may read its top-level metadata. The post-middleware \`org\` lookup is purely defensive — middleware has already proven the org exists.

Related: \`GET /\` lists all orgs the caller belongs to; the nested routers under this path (\`/teams\`, \`/members\`, \`/roles\`, \`/grants\`, …) expose the org's contents.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db.select().from(organization).where(eq(organization.id, orgId)).limit(1);
      const org = rows[0];
      /* v8 ignore next -- @preserve defensive: orgContextMiddleware already proved membership, so the org exists */
      if (!org) throw new AuthError();
      return ok(c, OrgOut, toOrgOut(org));
    },
  )
  .use('/:orgId/*', orgContextMiddleware)
  .route('/:orgId/teams', teams)
  .route('/:orgId/projects', projects)
  .route('/:orgId/projects', projectRollup)
  .route('/:orgId/tasks', tasks)
  .route('/:orgId/graph', dependencyGraph)
  .route('/:orgId/initiatives', initiatives)
  .route('/:orgId/programs', programs)
  .route('/:orgId/cycles', cycles)
  .route('/:orgId/milestones', milestones)
  .route('/:orgId/labels', labels)
  .route('/:orgId/comments', comments)
  .route('/:orgId/updates', updates)
  .route('/:orgId/saved-views', savedViews)
  .route('/:orgId/search', search)
  .route('/:orgId/members', members)
  .route('/:orgId/roles', roles)
  .route('/:orgId/grants', grants)
  .route('/:orgId/agents', agents)
  .route('/:orgId/sessions', agentSessions)
  .route('/:orgId/capture', capture)
  .route('/:orgId/calendar', calendarSchedules)
  .route('/:orgId/email-suggestions', emailSuggestions)
  .route('/:orgId/display', entityDisplay)
  .route('/:orgId/automation-rules', automationRules)
  .route('/:orgId/integrations/mcp', integrationsMcp)
  .route('/:orgId/integrations', integrations)
  .route('/:orgId/billing', billing)
  .route('/:orgId/activity', activity)
  .route('/:orgId/stream', stream);

export default orgs;

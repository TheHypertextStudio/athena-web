/**
 * `@docket/api` — OpenAPI document + Scalar docs UI.
 *
 * @remarks
 * The spec is generated from the typed `/v1` app by `hono-openapi`'s `openAPIRouteHandler`,
 * which walks the chained routers and reads the `validator` (request) and `describeRoute`
 * (response + tags + capability) annotations attached to each route. Scalar renders it at
 * `/v1/docs`. The bearer requirement is declared once document-wide via `security` (public
 * routes opt out with `security: []` in their `apiDoc` — only `/v1/config` does).
 *
 * Two SEPARATE references are served: the **public** `/v1` spec/docs from the `AppType` app, and
 * the **internal** `/admin` spec/docs from the `AdminAppType` app (staff-gated). The machine
 * edges under `/internal/*` (webhooks, ingest, cron, the GitHub OAuth callback) carry no typed
 * contract and are documented by neither. `openAPIRouteHandler(app)` only sees the routes
 * registered on the app it is given, which is what keeps the two surfaces cleanly apart.
 */
import { Scalar } from '@scalar/hono-api-reference';
import { openAPIRouteHandler } from 'hono-openapi';
import type { Hono } from 'hono';

import type { AdminInstance, AppInstance } from './app';
import type { AppEnv } from './context';
import { env } from './env';

/**
 * The product overview rendered as the Scalar reference's introduction. This is the front door
 * to understanding Docket end-to-end: the domain model, the permission system, and the
 * cross-cutting conventions every endpoint shares.
 */
const PRODUCT_OVERVIEW = `
Docket is the calm command center for work — a multi-tenant platform where people **and AI
agents** plan, track, and ship work together. This reference is the complete, authoritative
description of the product: every resource, field, permission, and side effect lives here, so
you can understand the whole system from the API alone.

## The domain model

Everything is scoped to an **Organization** (the tenant). Within an org, work nests in a
containment hierarchy:

- **Organization** — the tenant. Carries a *vocabulary skin* (\`startup\` | \`nonprofit\` |
  \`agency\`) that relabels entities in the UI, and may be a *personal space* (an org-of-one) or
  a shared *team org*.
- **Teams** — own the people and the *workflow states* tasks move through.
- **Initiatives** and **Programs** — cross-cutting groupings that roll several projects up into
  a strategic objective (initiative) or an ongoing line of work (program).
- **Projects** — a bounded body of work with a lead, dates, and a health signal.
- **Cycles** (time-boxed iterations) and **Milestones** (scope checkpoints) partition a project.
- **Tasks** — the atomic unit of work: assignable, prioritized, state-tracked, with subtasks,
  acyclic **dependencies**, **attachments**, and **labels**.
- **Updates** — narrative status posts on a project/initiative/program that drive its health.
- **Comments** — threaded discussion on any work item.

People and agents act through **Actors** — a member's (or agent's) identity *within one org*.
**Agents** are first-class Actors (\`kind: 'agent'\`) that run **Agent Sessions**: they call the
same service layer as humans, under the same permission checks, plus an orthogonal **approval
gate** for the mutations they propose.

## The cross-org cockpit

A person who belongs to several orgs works from surfaces that span tenants by design: the
**Hub** (\`/hub/today\`, \`/portfolio\`, \`/search\`, \`/inbox\`, \`/activity\`),
**Notifications**, and the personal **Daily Plan**. These fan out **one permission-scoped query
per membership** and merge in application code — there is no cross-tenant SQL join. Every item
carries its own \`organizationId\` (its "org chip"), and is individually run through that org's
visibility predicate, so the view is the *union of per-org permission decisions*, never a bypass.

## Permissions

Authorization is two complementary layers:

1. **Membership** — every \`/v1/orgs/{orgId}/*\` route requires an active Actor in that org.
   Non-members receive **404** (existence-hiding — you can't learn an org or resource exists
   unless you may see it).
2. **Capability** — mutations require a capability on the ladder
   \`view < comment < contribute < assign < manage\`. Reassigning work needs \`assign\`;
   commenting needs \`comment\`; administrative changes need \`manage\`. List/read endpoints are
   scoped by a visibility/grant predicate in the query, so you only ever receive permitted rows.

Agents traverse the identical checks (an Agent is just an Actor with explicit grants) plus the
approval gate layered on top.

## Conventions

- **Authentication** — a bearer session: \`Authorization: Bearer <token>\`. **Every** endpoint
  requires it except \`GET /v1/config\` (public bootstrap config). Authentication is enforced by
  a global gate, not per-handler, so no route is accidentally public.
- **Identifiers** — every entity has a branded **ULID**: 26 Crockford-base32 chars matching
  \`^[0-9A-HJKMNP-TV-Z]{26}$\`. Each entity type has its own branded id, so ids are not
  interchangeable across resources.
- **Pagination** — list endpoints are **keyset/cursor** paginated: pass \`cursor\` and \`limit\`,
  then read \`nextCursor\` from the response (null when the last page is reached).
- **Errors** — failures return RFC-9457 \`application/problem+json\` with a stable machine
  \`code\` (e.g. \`unauthorized\`, \`forbidden\`, \`not_found\`, \`validation_error\`,
  \`dependency_cycle\`, \`card_required\`), an HTTP \`status\`, and (for validation) per-field
  \`fieldErrors\`.
- **Idempotency** — creates accept an \`Idempotency-Key\` header so a retried request never
  duplicates a resource.
- **Validation** — request *and* response bodies are validated against the same Zod schemas
  rendered here, so the documented shape is the runtime shape.

## Agents & MCP

The same operations are exposed to AI agents over the **Model Context Protocol (MCP)** server,
which calls the identical service layer beneath the same permission engine — the REST surface
and the agent surface are two front doors onto one system.
`;

/**
 * The resource-group tags, in sidebar order. Each entry's `description` is the resource's
 * narrative (concept, lifecycle, relationships, who can act on it) — Scalar renders it as the
 * section intro. Each route tags itself with one of these via `apiDoc({ tag })`.
 */
const TAGS = [
  {
    name: 'Config',
    description:
      'Public, unauthenticated client bootstrap configuration. Read by the sign-in page before a session exists; contains only non-secret values (enabled auth providers, app mode, the MCP URL) — never secret-derived data. The only public endpoint in the API.',
  },
  {
    name: 'Orgs',
    description:
      "Organizations are the tenant boundary; everything else is scoped to one. An org is either a shared **team org** or a single-user **personal space** (`isPersonal`). Each carries a vocabulary skin that relabels entities in the UI. Creating an org seeds its system roles, the creator's Owner actor, and a default team in one transaction. Listing returns only the orgs you're a member of.",
  },
  {
    name: 'Members',
    description:
      'Membership ties a user to an org through an Actor with a role. Covers listing members, inviting by email (a pending, role-bound invitation with a signed accept link), accepting invitations, and updating or removing members. Membership mutations require the `manage` capability; accepting an invitation does not (the joiner has no role yet).',
  },
  {
    name: 'Roles',
    description:
      "Roles bundle a base capability and default visibility, assigned to actors within an org. Four system roles are seeded on org creation; custom roles can be created and managed. A role's capabilities are resolved per-org, so a stray cross-org role never confers access.",
  },
  {
    name: 'Grants',
    description:
      'Grants are per-resource permission overrides layered on top of role capabilities — they widen (or pin) what a specific actor can do on a specific resource subtree. Resolved root-to-self with most-specific-wins. Managing grants requires the `manage` capability.',
  },
  {
    name: 'Teams',
    description:
      'Teams own people and the **workflow states** tasks flow through. They scope membership and the default state a new task lands in. Teams can carry their own approval routing. Mutations require `manage`.',
  },
  {
    name: 'Initiatives',
    description:
      'Initiatives are strategic, cross-team groupings that link many projects (and programs) toward an objective, with a timeline and a members rollup. Projects and programs are linked/unlinked via dedicated routes. Created/edited with `contribute`; deleted with `manage`.',
  },
  {
    name: 'Programs',
    description:
      'Programs group projects into an ongoing line of work with its own visibility and an ancestor path for inheritance. They roll up the work and updates of their projects. Managed with the `manage` capability.',
  },
  {
    name: 'Projects',
    description:
      'A project is a bounded body of work with a lead, start/target dates, visibility, and a derived health signal. It rolls up its tasks (progress) and recent agent activity. Tasks, updates, milestones, and cycles hang off a project. Created/edited with `contribute`; deleted with `manage`.',
  },
  {
    name: 'Milestones',
    description:
      "Milestones are dated scope checkpoints within a project. A milestone's target date drives its on-track/at-risk signal. Deleting a milestone nulls its tasks' `milestoneId` rather than deleting them. Managed with `contribute`.",
  },
  {
    name: 'Cycles',
    description:
      'Cycles are time-boxed iterations (sprints) within a team/project. They expose the current cycle window, the tasks in scope, a burn-up chart, and a close operation that freezes scope and rolls incomplete work forward. Managed with `contribute`.',
  },
  {
    name: 'Tasks',
    description:
      "Tasks are the atomic unit of work: assignable, prioritized (`none`→`urgent`), and tracked through the team's workflow states. They support subtasks, acyclic dependencies (blocking/blocked-by), attachments, and labels. State transitions derive completion/cancellation timestamps and emit activity-stream observations. Reassigning a task needs the `assign` capability; other edits need `contribute`.",
  },
  {
    name: 'Labels',
    description:
      'Labels are scope-aware tags applied to tasks for grouping and filtering. Unique within their scope. Managed with `contribute`.',
  },
  {
    name: 'Comments',
    description:
      'Comments are threaded discussion attached polymorphically to a work item (task, project, …). Posting/editing requires the `comment` capability — the lowest write tier — so collaborators who cannot change work can still discuss it.',
  },
  {
    name: 'Updates',
    description:
      "Updates are narrative status posts on a project, initiative, or program. The latest update drives the subject's health signal (on-track / at-risk / off-track), making them the heartbeat of portfolio reporting. Managed with `contribute`.",
  },
  {
    name: 'Views',
    description:
      'Saved views persist a filter/grouping/sort configuration over work items, scoped to an org (and optionally a team or person), so a team can return to a curated slice of work.',
  },
  {
    name: 'Agents',
    description:
      'Agents are first-class Actors (`kind: agent`) that perform work autonomously. This surface registers agents and drives **Agent Sessions** — a dispatched run against a subject, streaming its activity, gated by the same capabilities as a human plus an approval step for proposed mutations (approve/reject). The session activity stream is available over SSE.',
  },
  {
    name: 'Capture',
    description:
      'Quick capture turns a raw note into a triaged task in the org inbox with minimal ceremony — the fast path for getting something out of your head and into Docket. Requires `contribute`.',
  },
  {
    name: 'Integrations',
    description:
      'Integrations connect GitHub, Linear, Gmail, Google Calendar, and Google Tasks to an org: establishing the connection, reconciling and syncing external state, and linking external items to Docket work. Connection management requires `manage`. Webhook ingestion happens on separate signed endpoints outside this contract.',
  },
  {
    name: 'Billing',
    description:
      "Billing exposes the org's subscription and lifecycle (plan, status, trial/period dates), an embedded Stripe checkout, and the customer portal. Gated by `manage`; when billing is disabled by environment, these return a typed 402 rather than a stub. Stripe webhooks arrive on a separate signature-verified endpoint.",
  },
  {
    name: 'Activity',
    description:
      'The per-org activity feed: a chronological stream of observations (created, status changes, assignments, completions) emitted by work mutations across the org. The substrate the Hub and notifications are built on.',
  },
  {
    name: 'Stream',
    description:
      'Server-sent event (SSE) streams for live, push updates — clients subscribe to receive org activity and session events as they happen rather than polling.',
  },
  {
    name: 'Notifications',
    description:
      "The current person's notification inbox across all their orgs: list, unread count, mark-one/all read, and act on a notification. Session-scoped (no org capability needed).",
  },
  {
    name: 'DailyPlan',
    description:
      "The personal daily plan — the items a person has chosen to focus on today, drawn from across their orgs. A lightweight, person-owned planning surface distinct from any org's task list.",
  },
  {
    name: 'Hub',
    description:
      'The cross-org cockpit: Today, Inbox, Portfolio, Search, and Activity surfaces that aggregate across every org you belong to via a permission-scoped fan-out (one query per membership, merged in app code, each row carrying its org chip). Requires only an authenticated session — the per-resource gate has already run on each constituent row.',
  },
  {
    name: 'Me',
    description:
      'The signed-in person (not an org Actor): account profile, lifecycle (export / scheduled deletion with step-up reauth), linked identities/passkeys, recovery codes, and connected OAuth apps. Session-scoped; high-risk actions require a freshly re-authenticated session.',
  },
  // NOTE: the `Admin` tag is intentionally absent here — staff/admin operations live on the
  // separate `/admin` app (`AdminAppType`), documented by its own spec at `/admin/docs`, and
  // must never appear in this public reference.
];

/** Build the base OpenAPI 3.1 documentation (paths are filled by route annotations). */
function buildDocumentation() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Docket API',
      version: '0.0.0',
      description: PRODUCT_OVERVIEW,
    },
    // `app` has basePath `/v1`, so generated paths already carry `/v1` — the server URL must
    // NOT repeat it (else paths resolve to `/v1/v1/...`).
    servers: [{ url: env.API_URL }],
    externalDocs: {
      description: 'Docket problem types and recovery guidance',
      url: `${(env.WEB_URL || env.API_URL || 'http://localhost').replace(/\/$/, '')}/problems`,
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http' as const, scheme: 'bearer' },
        mcpOAuth: {
          type: 'oauth2' as const,
          flows: {
            authorizationCode: {
              authorizationUrl: `${env.API_URL}/api/auth/mcp/authorize`,
              tokenUrl: `${env.API_URL}/api/auth/mcp/token`,
              scopes: {},
            },
          },
        },
      },
    },
    // Global default: every operation requires the bearer session unless it overrides with
    // `security: []` (only the public `/v1/config` does). OpenAPI applies a document-level
    // `security` to all operations that don't declare their own — this mirrors the runtime
    // `requireAuth` gate so the docs truthfully show auth on every protected route.
    security: [{ bearerAuth: [] }],
    tags: TAGS,
  };
}

/**
 * The internal admin OpenAPI document — a SEPARATE spec for the `/admin` staff surface, never
 * merged into the public one.
 */
function buildAdminDocumentation() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Docket Admin API (internal)',
      version: '0.0.0',
      description:
        'Internal staff back-office API. **Not part of the public Docket API** — these operations live on the `/admin` mount, require a staff role, and are consumed only by the staff console (`apps/admin`). Staff tiers (`support`/`finance`/`superadmin`) gate the more sensitive actions.',
    },
    servers: [{ url: env.API_URL }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http' as const, scheme: 'bearer' } },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      {
        name: 'Admin',
        description:
          'Staff operations: user/org administration, lifecycle boards, impersonation, billing holds/trial actions, the audit log, and staff management. Gated by `staffMiddleware` (session + staff role).',
      },
    ],
  };
}

/**
 * Register the API reference UIs on the root server:
 * - the **public** spec/docs from the `/v1` {@link app} at `/v1/openapi.json` + `/v1/docs`;
 * - the **internal** spec/docs from the `/admin` {@link adminApp} at `/admin/openapi.json` +
 *   `/admin/docs`. These are registered after the admin app is mounted, so the admin router's
 *   `staffMiddleware` gates them (a non-staff request to `/admin/*` is rejected before it can
 *   reach these handlers) — keeping the internal reference out of public reach.
 */
export function registerOpenapi(
  server: Hono<AppEnv>,
  app: AppInstance,
  adminApp: AdminInstance,
): void {
  // Scalar's config is a union whose object-literal excess-property check is over-strict;
  // the `{ url }` form is the documented runtime usage, so cast past the type quirk.
  const scalar = (url: string) => Scalar({ url });

  // Public reference (`/v1`).
  server.get('/v1/openapi.json', openAPIRouteHandler(app, { documentation: buildDocumentation() }));
  server.get('/v1/docs', scalar('/v1/openapi.json'));

  // Internal staff reference (`/admin`) — staff-gated by fall-through past the admin router.
  server.get(
    '/admin/openapi.json',
    openAPIRouteHandler(adminApp, { documentation: buildAdminDocumentation() }),
  );
  server.get('/admin/docs', scalar('/admin/openapi.json'));
}

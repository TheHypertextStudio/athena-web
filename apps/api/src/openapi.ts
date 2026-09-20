/**
 * `@docket/api` — OpenAPI document + Scalar docs UI.
 *
 * @remarks
 * The spec is generated from the typed `/v1` app by `hono-openapi`'s `openAPIRouteHandler`,
 * which walks the chained routers and reads the `validator` (request) and `describeRoute`
 * (response + tags + capability) annotations attached to each route. Scalar renders it at
 * `/v1/docs`. The first-party session requirement is declared document-wide. The runtime access
 * registry then assigns each operation its exact cookie, OAuth, or public alternative.
 *
 * Two SEPARATE references are served: the **public** `/v1` spec/docs from the `AppType` app, and
 * the **internal** `/admin` spec/docs from the `AdminAppType` app (staff-gated). The machine
 * edges under `/internal/*` (webhooks, ingest, cron, the GitHub OAuth callback) carry no typed
 * contract and are documented by neither. `openAPIRouteHandler(app)` only sees the routes
 * registered on the app it is given, which is what keeps the two surfaces cleanly apart.
 */
import { openAPIRouteHandler } from 'hono-openapi';
// A value import, not `import type`: `openapiDocument` constructs a throwaway server.
import { Hono } from 'hono';

import type { AdminInstance, AppInstance } from './app';
import type { AppEnv } from './context';
import { env } from './env';
import { API_REVISION, API_VERSION } from './api-version';
import {
  accessForOperation,
  REST_OAUTH_SCOPE_DESCRIPTIONS,
  type ApiAccess,
} from './auth/rest-access-policy';
import { API_IDENTITY_COMPONENTS, normalizePublicApiIdentity } from './openapi-identity';
import { collectApiOperationContracts } from './lib/api-operation-contract';
import {
  assertPublicReference,
  compactPublicReference,
  normalizePublicReference,
} from './openapi-public-reference';
import { registerReferenceAssets } from './openapi-reference-routes';
import { cacheOpenapiDocument } from './openapi-document-cache';

/**
 * The product overview rendered as the Scalar reference's introduction. This is the front door
 * to understanding Docket end-to-end: the domain model, the permission system, and the
 * cross-cutting conventions every endpoint shares.
 */
const PRODUCT_OVERVIEW = `
Docket keeps planning, scheduling, and tracked time in one work system. People and software
clients act through explicit identities and permissions. One person can work across multiple
organizations while each organization's data remains separate. This reference documents the
resources, fields, permissions, and side effects exposed by the API.

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

People and registered third-party agents act through **Actors** — identities *within one org*.
Personal **Athena** work instead belongs directly to the signed-in user and resolves that user's
current Actor separately for every targeted workspace tool call. Both executors share the durable
session substrate and an orthogonal approval gate, but workspace context never grants Athena access.

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

- **Authentication** — first-party Docket clients use the secure session cookie. External clients
  use an OAuth 2.1 access token on operations that explicitly list \`restOAuth\`; the initial REST
  OAuth surface is \`GET /v1/orgs\` with \`work:read\`. \`GET /v1/config\` is public. Every other
  operation remains session-only until its runtime access policy adds an OAuth scope requirement.
- **Identifiers** — every entity has a branded **ULID**: 26 Crockford-base32 chars matching
  \`^[0-9A-HJKMNP-TV-Z]{26}$\`. Each entity type has its own branded id, so ids are not
  interchangeable across resources.
- **Pagination** — public collections default to 50 items and accept at most 100. Pass the opaque
  \`nextCursor\` back with the same normalized filters to continue. The final page omits
  \`nextCursor\`.
- **Errors** — failures return RFC-9457 \`application/problem+json\` with a stable machine
  \`code\` (e.g. \`unauthorized\`, \`forbidden\`, \`not_found\`, \`validation_error\`,
  \`dependency_cycle\`, \`card_required\`), an HTTP \`status\`, and (for validation) per-field
  \`fieldErrors\`.
- **Idempotency** — only operations that declare a JSON receipt accept \`Idempotency-Key\`.
  Receipt identity includes the user, session or OAuth client, API version, and key for 48 hours.
  A replay returns allowed response headers with \`Idempotency-Replayed: true\`; changing the
  method, path, query, content type, or exact body bytes is \`422 idempotency_key_reuse\`.
- **Status codes** — a create answers \`201\` with a \`Location\` naming the new resource; work
  that is queued rather than finished answers \`202\` with the \`Location\` of a status monitor.
- **Conditional requests** — finite \`GET\` and \`HEAD\` responses may carry a representation
  \`ETag\`, and weak \`If-None-Match\` comparison can return \`304\`. Only writes that document a
  transaction-bound aggregate validator accept \`If-Match\`; every other write rejects the header.
  A stale strong validator is \`412\`. Headerless writes remain last-writer-wins.
- **Negotiation** — a body must declare a \`Content-Type\` the operation reads. Anything else,
  including an undeclared non-empty body, is \`415\`. An \`Accept\` header that excludes every
  representation the operation can produce is \`406\`; JSON, binary, and event-stream operations
  negotiate their own media types.
- **Caching** — responses are \`private, no-cache\` and vary on the caller's credentials: store
  them, but revalidate against the \`ETag\` before reuse.
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
  // One entry, not two. OpenAPI keys tags by name, so the second `Athena` block that used to
  // sit below `Agents` was not a second section — it was a silent overwrite, and whichever
  // description lost was unreachable from the rendered reference.
  {
    name: 'Athena',
    description:
      'Athena is the signed-in person’s private, cross-workspace operating assistant. These owner-only routes expose the current persistent chat, grouped personal work, replayable activity, steering, lifecycle controls, proposals, and approvals, and they manage personal remote MCP connections and user-owned delegations without creating a workspace Actor. Optional workspace/source context is validated at invocation but never grants authority: no route here changes a human owner or assignee, and every tool call resolves the owner’s current permission again rather than carrying stale workspace authority across runs.',
  },
  {
    name: 'Agents',
    description:
      'Registered third-party agents are workspace-scoped Actors (`kind: agent`) that perform work through explicit grants. This compatibility surface registers them and drives Agent Sessions against a subject, streaming activity over SSE and gating proposed mutations through approve/reject review. Personal Athena work uses the separate owner-only `/v1/me/athena` surface.',
  },
  {
    name: 'Automations',
    description:
      'Automation rules are workspace-owned `on → when → then` records the engine consults whenever an observation fires: `on` matches the event, `when` narrows it, `then` names the actions to take. Enabling email-to-task on a connector seeds a default set once, and those seeded rows come back with `isSeed: true` so a client can present them as defaults rather than as something the workspace authored. Reading requires org membership; every mutation requires `manage`, because a rule acts on work its author may never look at again.',
  },
  {
    name: 'Suggestions',
    description:
      'Email suggestions are proposed tasks the email-to-task ingest derived from a connected mailbox, held for a person to confirm rather than written straight into the workspace. Each carries the source thread it came from, so the decision can be made against the original message. Accepting one creates the task and links it back to that thread; dismissing one closes it without a write. Both decisions require `contribute` — the suggestion is a proposal, and only a person acting under their own capability turns it into work.',
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
    name: 'Publishing',
    description:
      "Publishing turns an initiative, program, or project into a brief anyone can read on the web. A publication row records only THAT a record is public and WHERE it answers — never a copy of what it says, so a brief is always projected live from the same work tables the app reads and can never drift. Publishing and withdrawing need `contribute` (a brief is a view of work the caller already authors, and withdrawal is immediate). How a workspace is *addressed* is separate and administrator-only (`manage`): a verified custom domain, or a claimed public name on Docket's shared brief host. A domain is globally unique across all workspaces and serves nothing until a DNS `TXT` record proves ownership.",
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
      "The current person's notification inbox and delivery preferences across all their orgs: list, unread count, mark-one/all read, act on a notification, and manage quiet hours or category/channel overrides. Session-scoped (no org capability needed).",
  },
  {
    name: 'DailyPlan',
    description:
      "The personal daily plan — the items a person has chosen to focus on today, drawn from across their orgs. A lightweight, person-owned planning surface distinct from any org's task list.",
  },
  {
    name: 'Hub',
    description:
      'Personal Today, Inbox, Portfolio, Search, and Activity views across every Organization the signed-in person may access. Each item identifies its Organization, and normal resource visibility still applies.',
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

const SESSION_COOKIE_SCHEME = {
  type: 'apiKey' as const,
  in: 'cookie' as const,
  name: '__Secure-better-auth.session_token',
  description:
    'The secure first-party Docket browser session cookie. External integrations should use OAuth 2.1 instead of reading or setting this cookie.',
};

const SHARE_TOKEN_SCHEME = {
  type: 'apiKey' as const,
  in: 'header' as const,
  name: 'X-Docket-Share-Token',
  description:
    'A revocable share token for the public shared time status operation. It is not a browser session or an OAuth access token.',
};

const OPENAPI_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

type PublicDocument = Parameters<typeof normalizePublicApiIdentity>[0];
type SecurityRequirement = Record<string, string[]>;

function securityForAccess(access: ApiAccess): readonly SecurityRequirement[] {
  switch (access.kind) {
    case 'public':
      return [];
    case 'session-or-oauth':
      return [{ restOAuth: [...access.scopes] }, { sessionCookie: [] }];
    case 'session-only':
      return [{ sessionCookie: [] }];
    case 'share-token':
      return [{ shareToken: [] }];
  }
}

function applyRestOperationSecurity(document: PublicDocument, app: AppInstance): PublicDocument {
  const declaredAccess = new Map(
    collectApiOperationContracts(app).map(({ method, path, contract }) => [
      `${method.toUpperCase()} ${path}`,
      contract.access,
    ]),
  );
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of OPENAPI_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const access =
        declaredAccess.get(`${method.toUpperCase()} ${path}`) ?? accessForOperation(method, path);
      operation.security = [...securityForAccess(access)];
    }
  }
  return document;
}

/** Build the base OpenAPI 3.1 documentation (paths are filled by route annotations). */
function buildDocumentation() {
  return {
    openapi: '3.1.0',
    'x-docket-version': API_VERSION,
    'x-docket-revision': API_REVISION,
    info: {
      title: 'Docket API',
      version: API_VERSION,
      description: PRODUCT_OVERVIEW,
    },
    // `app` has basePath `/v1`, so generated paths already carry `/v1` — the server URL must
    // NOT repeat it (else paths resolve to `/v1/v1/...`).
    servers: [{ url: env.API_URL }],
    externalDocs: {
      description: 'Docket public API version policy',
      url: `${(env.WEB_URL || env.API_URL || 'http://localhost').replace(/\/$/, '')}/docs/developers/api-versions`,
    },
    components: {
      ...API_IDENTITY_COMPONENTS,
      securitySchemes: {
        sessionCookie: SESSION_COOKIE_SCHEME,
        restOAuth: {
          type: 'oauth2' as const,
          flows: {
            authorizationCode: {
              authorizationUrl: `${env.WEB_URL}/api/auth/oauth2/authorize`,
              tokenUrl: `${env.API_URL}/api/auth/oauth2/token`,
              scopes: REST_OAUTH_SCOPE_DESCRIPTIONS,
            },
          },
        },
        shareToken: SHARE_TOKEN_SCHEME,
      },
    },
    // The post-generation registry pass installs explicit per-operation requirements. This
    // default also keeps any consumer that reads only the document root on the safe session path.
    security: [{ sessionCookie: [] }],
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
    'x-docket-revision': API_REVISION,
    info: {
      title: 'Docket Admin API (internal)',
      version: `internal-${API_REVISION.slice(0, 7)}`,
      description:
        'Internal staff back-office API. **Not part of the public Docket API** — these operations live on the `/admin` mount, require a staff role, and are consumed only by the staff console (`apps/admin`). Staff tiers (`support`/`finance`/`superadmin`) gate the more sensitive actions.',
    },
    servers: [{ url: env.API_URL }],
    components: {
      securitySchemes: { sessionCookie: SESSION_COOKIE_SCHEME },
    },
    security: [{ sessionCookie: [] }],
    tags: [
      {
        name: 'Admin',
        description:
          'Staff operations: user/org administration, lifecycle boards, impersonation, billing holds/trial actions, the audit log, and staff management. Gated by `staffMiddleware` (session + staff role).',
      },
      {
        name: 'Admin Notifications',
        description:
          'Staff-only notification intent creation, review, delivery, recipient inspection, and provider-event monitoring. Every operation runs behind `staffMiddleware` and stays outside the public `/v1` contract.',
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
  // Public reference (`/v1`). Building the document on every request exhausted the old production
  // heap and restarted the API instance, so each instance builds it once and shared caches may
  // reuse the compact representation for five minutes.
  server.get(
    '/v1/openapi.json',
    cacheOpenapiDocument(
      openAPIRouteHandler(app, { documentation: buildDocumentation() }),
      'public, max-age=300, stale-while-revalidate=86400',
      async (generated) => {
        const secured = applyRestOperationSecurity((await generated.json()) as PublicDocument, app);
        const document = compactPublicReference(
          normalizePublicApiIdentity(normalizePublicReference(secured)) as unknown as Record<
            string,
            unknown
          >,
        );
        assertPublicReference(document);
        return new TextEncoder().encode(JSON.stringify(document));
      },
    ),
  );
  registerReferenceAssets(server);

  // Internal staff reference (`/admin`) — staff-gated by fall-through past the admin router.
  server.get(
    '/admin/openapi.json',
    cacheOpenapiDocument(
      openAPIRouteHandler(adminApp, { documentation: buildAdminDocumentation() }),
      'private, no-store',
    ),
  );
}

/**
 * Generate one of the two OpenAPI documents in-process, as its route serves it.
 *
 * @remarks
 * Not `generateSpecs(app)`: the bare generator omits `info`, `servers`, `security`, and `tags`,
 * which live in the `documentation` object {@link registerOpenapi} passes in. The apps are
 * parameters, not imports, so this module stays free of `./app`.
 *
 * @param app - The public `/v1` app.
 * @param adminApp - The staff `/admin` app.
 * @param surface - Which document to return.
 * @returns The parsed document.
 */
export async function openapiDocument(
  app: AppInstance,
  adminApp: AdminInstance,
  surface: 'v1' | 'admin' = 'v1',
): Promise<unknown> {
  const cached = generatedDocumentCache.get(app)?.get(adminApp)?.get(surface);
  if (cached) return structuredClone(await cached);

  const byAdmin = generatedDocumentCache.get(app) ?? new WeakMap<AdminInstance, DocumentPromises>();
  const bySurface = byAdmin.get(adminApp) ?? new Map<'v1' | 'admin', Promise<unknown>>();
  generatedDocumentCache.set(app, byAdmin);
  byAdmin.set(adminApp, bySurface);

  const generated = generateOpenapiDocument(app, adminApp, surface);
  bySurface.set(surface, generated);
  try {
    return structuredClone(await generated);
  } catch (error) {
    bySurface.delete(surface);
    throw error;
  }
}

type DocumentPromises = Map<'v1' | 'admin', Promise<unknown>>;

const generatedDocumentCache = new WeakMap<AppInstance, WeakMap<AdminInstance, DocumentPromises>>();

async function generateOpenapiDocument(
  app: AppInstance,
  adminApp: AdminInstance,
  surface: 'v1' | 'admin',
): Promise<unknown> {
  const server = new Hono<AppEnv>();
  registerOpenapi(server, app, adminApp);
  const response = await server.request(`/${surface}/openapi.json`);
  if (!response.ok) {
    throw new Error(`OpenAPI generation failed with HTTP ${String(response.status)}.`);
  }
  return response.json();
}

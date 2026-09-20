# Public API contract and reference remediation

This specification is for engineers who change Docket's public REST API, OAuth server, generated
OpenAPI document, Scalar reference, or developer guides. A reader must be able to implement and
review the `0.1.0` prerelease contract without inferring behavior from source code.

## Decision

Docket will publish one explicit prerelease REST contract at a time. The initial compatibility
version is `0.1.0`. A client can omit `Docket-Version` to use the current contract, or send the exact
current value to assert that the server still implements the contract it expects. The header does
not select a retained implementation. Docket has no customers yet, so obsolete public aliases and
unsupported promises will be removed instead of preserved.

The public reference will remain OpenAPI 3.1 rendered by Scalar. Docket will generate the document
from typed operation contracts, own the HTML shell and assets, validate examples against the exact
Zod input or output schemas, and publish developer guides that explain capabilities before
protocols. Runtime policy and published metadata must come from the same operation declaration.

The implementation keeps Hono, Zod, OpenAPI 3.1, and Scalar. It does not add an SDK, outbound
webhooks, or retained API versions.

## Compatibility and build identity

`apps/api/api-version.json` is the sole source of the public compatibility version. An API-owned
module exports `API_VERSION`, `SUPPORTED_API_VERSIONS`, `API_VERSION_HEADER`, and the exact-match
parser. TypeScript source must not repeat the value `0.1.0` as a second compatibility-version
literal.

Every `/v1` response includes these headers:

```http
Docket-Version: 0.1.0
Docket-Revision: <full deployed Git SHA>
```

Local development may use `dev` as the revision. Production validation rejects `dev`, a missing
value, and every value that is not a full 40-character hexadecimal Git SHA. The root package
version, OpenAPI format version, MCP protocol version, and MCP `serverInfo.version` remain separate.

The request header is optional. Omission and the exact current value succeed. Empty, malformed,
repeated, comma-separated, ranged, aliased, older, and newer values fail with status 400. The exact
body is:

```json
{
  "type": "https://clearthedocket.com/problems/unsupported_api_version",
  "title": "The requested API version is not supported.",
  "status": 400,
  "code": "unsupported_api_version",
  "requestedVersion": "<received header value>",
  "supportedVersions": ["0.1.0"]
}
```

The version check applies to every public business operation under `/v1`, including root-mounted
streams, account-export downloads, public briefs, and public time status. `/v1/docs`,
`/v1/openapi.json`, `/v1/docs/assets/*`, `/v1/health`, and CORS preflights receive response identity
but do not reject a mismatch. `/mcp`, `/api/auth`, OAuth discovery, webhook, `/internal`, and
`/admin` routes do not use the public REST compatibility header.

The version validator runs after outer CORS and before cookie lookup, OAuth verification, body
consumption, idempotency claims, database access, queue work, or external effects. The response
identity wrapper covers JSON, Problem responses, redirects, 204, 304, binary downloads, streams,
documentation, health, 404, and 405 responses.

Breaking prerelease contract changes increment the minor version and reset patch. Additive changes
and contract corrections increment patch. Every contract change needs an API release-note entry.
An unchanged contract cannot change `api-version.json`, and a build revision change alone is not a
contract change. The first customer triggers a new decision about `1.x`, retained versions, and
deprecation periods. It does not automatically trigger `1.0.0`.

## REST OAuth resource

Docket registers `${API_URL}/v1` as a distinct OAuth protected resource and publishes its metadata
at `/.well-known/oauth-protected-resource/v1`. The authorization server recognizes `${API_URL}/mcp`
and `${API_URL}/v1` as separate audiences. MCP tokens fail on REST and REST tokens fail on MCP.

The shared verifier enforces signature, issuer, expiry, exact audience, `sub`, `azp`, an active
user, an enabled client, standing consent, and live granted scopes. It intersects token scopes with
the current consent record so a consent reduction takes effect immediately.

The request context represents the caller without inventing session data:

```ts
type CallerPrincipal =
  | {
      kind: 'session';
      userId: string;
      user: AuthUser;
      session: AuthSessionRecord;
    }
  | {
      kind: 'oauth';
      userId: string;
      user: AuthUser;
      clientId: string;
      scopes: readonly OAuthCapabilityScope[];
    };
```

An `Authorization` header always selects bearer processing. An invalid bearer token fails without
cookie fallback. A valid bearer principal wins when a cookie is also present. Docket resolves a
first-party session only when `Authorization` is absent. Session-only operations require a session
principal.

The operation scope mapping is fixed:

- `work:read` covers visible workspace structure, work records, comments, updates, search, views,
  schedules, calendar reads, time reads, and personal notification reads.
- `work:write` covers ordinary work mutations, comments, status changes, planning, schedules, time
  writes, notification read-state mutations, and publication-content changes.
- `agents:run` covers Athena, agent-session lifecycle, proposals, decisions, and voice sessions.
- `connectors:link` covers connection, configuration, disconnection, and explicit execution of
  external integrations.
- `offline_access` controls token lifecycle and never authorizes a resource operation.

Account lifecycle, passkeys, recovery codes, sessions, connected-app revocation, billing,
workspace ownership, membership, invitations, roles, grants, public-domain configuration, staff
work, and step-up operations remain session-only. OAuth callers still pass membership, capability,
resource-visibility, and entitlement checks after scope validation.

First-party cookie CORS uses the trusted-origin allowlist and credentials. Bearer requests and
preflights that request `Authorization` accept arbitrary origins without credentials. No response
combines wildcard origin with credential support. CORS allows `Docket-Version` and `Last-Event-ID`.
It exposes `Docket-Version`, `Docket-Revision`, `X-Request-Id`, `Location`, `ETag`, `Retry-After`,
`WWW-Authenticate`, `Allow`, and `Idempotency-Replayed`.

A REST OAuth 401 challenge points to the REST protected-resource metadata. A 403
`insufficient_scope` response states the required scope without exposing provider or internal
error text.

## Operation contract

Every user-consumable `/v1` method belongs to a typed public manifest. Health, documentation,
specification assets, and internal control routes are the only exclusions. A route-parity test
compares runtime registrations with the manifest and the generated document.

```ts
type ApiAccess =
  | { kind: 'public' }
  | { kind: 'session-only'; stepUp?: boolean }
  | { kind: 'session-or-oauth'; scopes: readonly OAuthCapabilityScope[] }
  | { kind: 'share-token'; header: 'X-Docket-Share-Token' };

type ApiSuccess =
  | {
      kind: 'json';
      status: 200 | 201 | 202;
      schema: z.ZodType;
      description: string;
      location?: 'resource' | 'monitor';
    }
  | { kind: 'empty'; status: 204; description: string }
  | {
      kind: 'binary';
      status: 200;
      mediaTypes: readonly string[];
      disposition: 'inline' | 'attachment';
      description: string;
    }
  | {
      kind: 'sse';
      status: 200;
      events: readonly ApiStreamEvent[];
      resume: ApiStreamResume;
      description: string;
    };

interface ApiOperationContract {
  operationId: string;
  tag: PublicTagId;
  summary: string;
  narrative: {
    purpose: string;
    behavior: readonly string[];
    effects?: readonly string[];
    constraints?: readonly string[];
  };
  access: ApiAccess;
  requestBody?: {
    description: string;
    examples: Readonly<Record<string, unknown>>;
  };
  success: readonly ApiSuccess[];
  errors: readonly ProblemCode[];
  capability?: Capability;
  conditionalRead: boolean;
  conditionalWrite: false | ConditionalResourceKind;
  idempotency: false | 'json-receipt' | 'atomic-receipt';
  related: readonly OperationId[];
}
```

The existing `apiDoc` entry point accepts this contract without defaults that conceal omissions.
It drives OpenAPI and runtime access, media negotiation, idempotency, conditional request, output,
cache, and response-header middleware. A declaration cannot advertise behavior that its route does
not install.

The composed request order is:

1. Assign the request ID and security headers.
2. Surround `/v1` handling with the response-identity wrapper.
3. Apply CORS and canonical trailing-slash behavior.
4. Reject an explicit version mismatch.
5. Apply the byte limit without parsing the body.
6. Resolve the session or OAuth principal.
7. Enforce operation access policy.
8. Enforce membership, capability, visibility, and product gates.
9. Negotiate an allowed representation.
10. Claim or replay idempotency after current authorization succeeds.
11. Validate path, query, header, form, and body input with Zod.
12. Execute the handler.
13. Validate output and apply headers, cache policy, and finite-response ETags.

## Schemas, errors, and examples

Request generation uses Zod `io: "input"`. Response generation uses `io: "output"`. Output fields
with defaults remain required when runtime output validation requires them. Zod metadata IDs become
JSON Schema `$id` values and reusable OpenAPI components. Unequal schemas cannot share an ID.
Different input and output forms use explicit `Input` and `Output` component names. `pageOf` emits
stable names such as `TaskPage`, `ProjectPage`, and `LabelPage`. The API-local `WorkflowState`
duplicate is removed in favor of the domain-owned contract.

Generation fails on duplicate IDs, unresolved references, recursive expansion failures,
unrepresentable contracts, or unexplained free-form objects. Each named public schema appears once
in `components.schemas`.

Reusable Problem responses come from `PROBLEM_CATALOG`. Every protected operation declares 401.
OAuth or guarded operations declare 403. Hidden missing resources declare 404. Conditional writes
declare 412. Body operations declare applicable 413, 415, and 422. Negotiated operations declare 406. Routes declare 429 and 503 only when runtime can emit them. Domain conflicts and entitlement
failures remain specific. A default Problem covers unexpected failures but does not replace known
outcomes. The Problem `type` field describes Docket `/problems/{code}` URLs.

The response-free operations receive explicit contracts. Six work-location mutations return 204.
Attachment downloads document stored media type and attachment disposition. Document images use
allowlisted image types and private immutable caching. Billing export returns a versioned JSON
attachment. Organization agent-session streams document their events and resume behavior.
Integration connect returns a validated JSON object containing an absolute `url`.

One synthetic fixture contains one user, workspace, team, project, related tasks, comments, time
records, agent session, and integration. Branded ID schemas produce every fixture ID. Every request
body and success response has a minimal example that parses through the exact input or output Zod
schema. Named alternatives cover meaningful branches, including live and historical time, omission
and explicit null removal, linked and native work, and synchronous and accepted processing.

Fallback examples use required fields only, schema defaults, the first enum member, valid formats,
legal bounds, and a recursion guard. They never contain empty IDs, sentinel integers, real
credentials, real tenant data, or exhaustive optional fields.

Public generation converts raw TSDoc links and uses canonical production origins. Editorial review
removes local paths, storage details, source names, and other implementation prose from the rendered
document. The repository does not use keyword blacklists as prose tests because those tests reward
word substitution instead of clear explanations. Structural checks still require every operation
to render Purpose, Inputs and constraints, Result and side effects, Access, Failures and recovery,
and Related operations in that order.

The OpenAPI document must keep every field and operation explanation needed to use the API without
reading source code. Its Brotli quality-5 representation must not exceed 350 KiB; raw JSON size is
not a release gate because production serves the compressed representation.

## HTTP guarantees

Finite GET and HEAD responses may use representation ETags and weak `If-None-Match`. SSE has no
ETag, buffering, response compression, or body cloning. Mutable addressable resources that support
`If-Match` use a monotonic aggregate revision. The comparison and mutation run in one serializable
transaction. Related-row, object-command, agent, and provider writers that change the aggregate
increment the same revision. `If-Match` requires a strong validator. A stale value returns 412
`precondition_failed`. Headerless writes remain last-writer-wins. Unsupported routes fail when they
receive `If-Match` instead of ignoring it.

Idempotency receipt identity contains the user, caller namespace (`session` or `oauth:<clientId>`),
API version, and key. The fingerprint contains method, path, normalized query parameters, content
type, and exact body bytes. Receipts store status, body, receipt format, `Location`, and allowlisted
content headers. Replays create a new request ID and add `Idempotency-Replayed: true`. They never
store credentials, cookies, CORS headers, or request IDs. A replay runs current scope, membership,
capability, resource, and product checks before returning stored data.

Atomic retry claims commit the mutation and receipt in one transaction. Non-atomic JSON receipts
promise response replay only after successful recording. Unsupported binary, stream, or bodyless
operations reject an idempotency key. Existing rows are backfilled as session-owned `0.1.0`
receipts. Missing response headers may remain absent during the existing 48-hour lifetime.

Every unbounded public collection uses a default page size of 50 and maximum 100. Internal clients
request enough items or consume all pages. `nextCursor` is absent at exhaustion. Each operation
states primary order, stable tie-breaker, filter combination, visibility filtering, and cursor reuse
rules. Complex-search cursors bind a normalized filter fingerprint and reject changed filters.

A 202 response requires a monitor URL in `Location`, pending and terminal states, failure behavior,
cancellation behavior, a linked monitor schema, and polling guidance. A 201 response uses Location
only for an addressable resource.

Accept negotiation respects media specificity and q-values. An explicit JSON refusal is not
overridden by a wildcard. SSE uses `text/event-stream`, `no-transform`, disabled proxy buffering,
and no compression. Each event has a reusable payload schema and literal wire example. An expired
or unknown resume cursor returns a Problem before the stream opens. Personal and organization
replay-window differences are explicit. A composed-server test observes the first event before the
stream closes.

## Public route and tag surface

Staff notification intent creation, testing, sending, cancellation, delivery inspection, and
recipient inspection move under `/admin/notifications`. The admin console uses the admin client.
Personal notification operations live at `/v1/me/notifications`. Legacy `/v1/notifications`
aliases are removed before the baseline.

A typed public registry owns each tag ID, display name, description, audience, order, and group.
Every operation has exactly one tag, and every tag belongs to exactly one group. The ordered groups
are:

1. **Start:** Config and Authentication.
2. **Workspaces and access:** Orgs, Members, Roles, Grants, Teams, and Statuses.
3. **Work:** Initiatives, Programs, Projects, Milestones, Cycles, Tasks, Labels, Comments, Updates,
   Templates, Processes, Recurrence, and Capture.
4. **Find and present:** Search, Mentions, Views, Display, Activity, Stream, Publishing, and Objects.
5. **Personal planning:** Hub, Calendar, Scheduling, Agenda, Directive, DailyPlan, Time, and Work
   location.
6. **Athena and agents:** Athena, Agents, Automations, and Suggestions.
7. **Connections:** Integrations.
8. **Account:** Me, Notifications, and Billing.

`Organizations` becomes `Orgs`. Personal notification tags become `Notifications`. Personal phone
and contact-point tags become `Me`. `Athena Voice` becomes `Athena`. `OAuth` becomes
`Authentication`. Staff notification intents leave the public registry. Display labels expand Orgs
to “Organizations (workspaces),” DailyPlan to “Daily plan,” Work location to “Work locations,” and
Objects to “Object commands.” A hash redirect map preserves old organization, Athena voice,
notification preference, contact point, phone, and OAuth deep links.

## Docket-owned Scalar reference

The API replaces `@scalar/hono-api-reference` with exact
`@scalar/api-reference@1.68.0`, installed through pnpm. The API image owns these assets:

- `/v1/docs/assets/scalar-api-reference-1.68.0.js`
- `/v1/docs/assets/reference.<revision-prefix>.js`
- `/v1/docs/assets/reference.<revision-prefix>.css`

The shell title is “Docket API Reference.” It displays `API 0.1.0 · revision abc123def456`, while
headers and the document retain the full revision. It includes a Docket favicon and mark, title,
main landmark, live status, search, authorization, client examples, Try It, and an owned raw-spec
download link.

Scalar uses modern layout, Docket tokens, system light or dark mode, a visible sidebar, closed tags
by default, form request bodies, summaries as operation titles, visible operation IDs, curl as the
default client, hidden standalone models, visible referenced schemas, no built-in document download,
no token persistence, no telemetry, no agent, no developer tools, and no external fonts or assets.

`customFetch` adds the current `Docket-Version` only when Try It targets the declared Docket API
origin and a `/v1` path. It never attaches the header to arbitrary URLs. Authorization stays only
in memory and clears on reload. Tokens cannot enter storage, URLs, logs, analytics, or screenshots.

The shell content-security policy is:

```text
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'self';
font-src 'self' data:;
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
form-action 'self'
```

Initial HTML shows `Loading API reference…` in a polite live region. After one second, the loader
shows transfer progress when Content-Length exists. Each fetch has an eight-second timeout. It
retries once after 750 ms for network errors, 408, 429, and 5xx. It honors Retry-After up to five
seconds. It does not retry other 4xx responses or invalid JSON. It catches asset, missing-global,
constructor, parse, and loaded-callback failures while preserving the current hash.

After the second failure, a role-alert panel shows a stable failure category, response request ID
when present, Retry, direct JSON, and Problem guidance. It never displays exception text or provider
response bodies.

The server precomputes identity, Brotli quality 5, and gzip level 6 representations. Versioned
assets use `public, max-age=31536000, immutable`. The raw spec uses
`public, max-age=300, stale-while-revalidate=86400`. The shell uses
`public, max-age=60, must-revalidate, stale-while-revalidate=300`. Admin documentation uses
`private, no-store`. Encoding selection prefers Brotli, then gzip, then identity while respecting
q=0. Each representation has a strong ETag, exact content length and encoding, and
`Vary: Accept-Encoding`. HEAD and 304 match the selected representation.

The identity HTML is at most 15 KiB. Its p95 TTFB is at most 750 ms. Scalar JavaScript is at most
4 MiB identity and 1.1 MiB Brotli. Runtime makes zero third-party requests. The initial status is
visible within 250 ms. Warm navigation is ready within three seconds. Cold navigation at 10 Mbps
and 40 ms RTT is ready within eight seconds. A terminal failure appears within 17 seconds.

Every non-inline control is at least 44 by 44 pixels. Mobile body text is at least 16 pixels. The
document has no horizontal overflow at 320 or 390 pixels. Code samples scroll internally. Focus
rings, landmarks, modal mobile navigation, keyboard operation, reduced motion, and light/dark
contrast are required.

## Developer guides

The Developers navigation order is:

1. Developer overview.
2. Make your first request.
3. Authentication.
4. REST API.
5. API versions.
6. API release notes.
7. Connect an AI agent.
8. MCP tools and resources.
9. Track time.
10. Errors.
11. Platform status.

The overview starts with what developers can build: retrieval, work management, planning and
scheduling, discussion and status, time tracking, recurring processes, agent supervision, and
external record linking. It then explains access, REST, MCP, endpoints, prerelease limits, and
conventions.

The first-request guide uses discovery, dynamic client registration at
`/api/auth/oauth2/register`, S256 PKCE, state validation, the REST `resource` parameter, code
exchange, refresh, and revocation. It reads an organization, selects a team, creates a task, and
retrieves the returned ID. `/api/auth/oauth2/authorize` is the discovered authorization endpoint;
`/oauth/authorize` is only the human consent page.

The remaining guides each answer one question. Authentication covers credentials, discovery,
registration, PKCE, scopes, refresh, revocation, cookie sessions, and troubleshooting. REST covers
origins, personal and workspace paths, envelopes, IDs, dates, pagination, conditionals,
idempotency, async work, streams, resource groups, and limits. API versions explains exact matching,
upgrades, `0.x`, the single-version service, and all distinct version concepts. Release notes contain
one dated entry per contract with classification, affected methods and paths, before and after
examples, client action, links, and deployed revision.

The MCP connection guide covers the canonical URL, client setup, workspace read, task creation,
refresh, revocation, and reconnect behavior. The generated MCP catalog derives tools, resources,
templates, prompts, subscriptions, scopes, apps, and compatibility tools from runtime registration.
It labels generic `get` as compatibility and includes `review_work_destination` plus dynamically
registered semantic-read tools. No page hard-codes a tool count.

The time guide distinguishes running timers, paused work, historical records, intervals,
durations, allocations, ownership, corrections, and live versus historical input constraints. The
errors guide defines the Problem wire shape and recovery for authentication, versions, validation,
hidden resources, concurrency, idempotency, retry, rate limits, and REST versus MCP transport. The
status page states the prerelease posture, credentials, current contract, single-version policy,
missing SDK and outbound webhooks, and mismatch-reporting path.

Two diagrams accompany the prose. One sequence diagram contains client registration, PKCE,
exchange, REST, refresh, and revocation. One state diagram contains receipt states and the retry,
wait, replay, and failure transitions.

Generated checked-in snippets own the current version, resource and tag index, reusable examples,
and MCP catalog. `pnpm docs:check` fails when generated output differs. Handwritten guides explain
the facts rather than copying registries. The product changelog keeps its existing history and adds
an entry for the initial explicit public REST contract. The root changelog and package version do
not change.

Public prose uses observable wire names. It defines workspace as the product term and Organization
as the API resource. It distinguishes actor identity, OAuth scope, resource scope, capability,
workflow-state key and category, points, minutes, civil dates, instants, time records, and time
intervals.

The edit corrects known drift: `workflowStates` is the wire field; tasks support `parentTaskId`;
agent creation documents its real 201 or 202 outcome; personal routes are not workspace-scoped;
integration run prose does not invent `GET /:id/runs`; personal Athena uses `/v1/me/athena`; name
lookup is field-specific; production hosts are `clearthedocket.com` and
`api.clearthedocket.com`; developer guides remain under `/docs/developers/*`.

## Contract release and acceptance

The repository stores a normalized public OpenAPI release snapshot. Normalization removes
environment-specific server values and `Docket-Revision` while preserving observable contract
fields. The release checker compares against the delivery merge base.

Removing a path, method, status, media type, field, enum member, auth alternative, or accepted value
is breaking. A newly required input, narrower constraint, changed nullability, stronger scope, or
changed default is breaking. A new optional field, operation, response, or enum member is additive.
A corrected description, example, error declaration, or guarantee is a patch correction. Breaking
`0.x` changes increment minor and reset patch. Additive and corrective changes increment patch.
Every change needs matching API release notes.

Contract tests verify runtime/OpenAPI parity, unique operation IDs, exactly one valid tag,
structured narratives, access and success metadata, applicable errors, input metadata, resolved
related operations, path parameters, property and body descriptions, schema-valid examples,
required output defaults, optional input defaults, zero generic Success descriptions, zero missing
responses, zero raw TSDoc links, zero local paths, zero obsolete hosts, zero sentinel examples,
zero unresolved references, deterministic output, size budgets, and the checked-in snapshot.

Version tests cover omission, exact current, old, new, empty, malformed, repeated, comma-separated,
ranged, and `latest` values. They cover JSON, 204, 304, redirect, Problem, binary, SSE, docs, spec,
health, 404, and 405 responses. A rejected mutation proves zero auth, body, idempotency, database,
queue, or external work. Every version surface must agree.

OAuth tests issue real tokens and cover audience separation, expiry, signatures, issuer, client and
consent state, reduced scopes, removed users, malformed tokens, cookie and bearer precedence,
session-only rejection, exact scopes, workspace permissions, both CORS modes, challenges, refresh,
and immediate revocation.

HTTP tests cover real PostgreSQL two-connection conditional writes, related and background revision
increments, weak and strong validators, replayed 201 and 202 Locations, query-sensitive
fingerprints, namespace and version isolation, process-death boundaries, in-flight behavior,
retention, reauthorization, unsupported receipt types, downloads, cache and disposition,
pagination, Accept negotiation, stream resume, first-event delivery, and no SSE ETag or compression.

Documentation verification runs `pnpm docs:check`, the pinned Mintlify validator, link and anchor
checks, accessibility, executable quickstarts, generated-snippet freshness, hostname and stale-route
scans, and semantic editorial checks. Browser acceptance covers desktop and mobile light/dark views,
320-pixel overflow, loading and failure timing, navigation and deep links, authorization, download,
Try It, one injected version header, no stored token, keyboard and focus, landmarks, targets,
motion, contrast, zero third-party requests, zero console errors, and the specified failure modes.

Production verification keeps source, local runtime, CI, API deployment, docs deployment, and Git
ancestry as separate evidence. `launch:verify-api-reference` checks canonical URLs, identity
agreement, wrong-version rejection, sizes, references and examples, internal-text leaks, owned
assets, CSP, caches, ETags, third-party requests, render timing, accessibility, interactions,
screenshots, `llms.txt`, and a real read-only REST OAuth canary when its dedicated credentials exist.

Additive receipt migrations remain during application rollback. The API preserves a dual-read path
for legacy receipts for their maximum 48-hour lifetime.

## Execution tasks

### Task 1: Establish prerelease contract identity

Add the single-source version file and API module. Add exact request parsing, the public Problem,
outer response identity, build revision injection and validation, CORS header changes, and OpenAPI
identity components. Write failing parser and composed-server tests first. Update the public version
policy and add the initial release-note fact source. Commit as
`chore(api): Establish prerelease contract identity`.

### Task 2: Authorize OAuth clients on REST

Publish REST protected-resource metadata, recognize both exact audiences, generalize token
verification, add `CallerPrincipal`, enforce bearer precedence and live grants, map operation
scopes, split bearer and cookie CORS, improve challenges and consent copy, and cover the flow with
real issued-token tests. Commit as `feat(auth): Authorize OAuth clients on the REST API`.

### Task 3: Enforce truthful HTTP guarantees

Move access and HTTP policy into typed operation contracts. Implement operation-aware negotiation,
finite ETags, transactional aggregate conditionals, namespace/version-aware receipts with safe
headers and authorization-before-replay, bounded pagination with bound cursors, truthful 201/202
Locations, and unbuffered resumable SSE. Add the database migration, legacy receipt dual-read, web
and admin pagination updates, and real PostgreSQL concurrency tests. Commit as
`fix(api): Enforce documented HTTP guarantees`.

### Task 4: Publish the complete generated contract

Build the public tag registry and exact groups. Make every public route declare the required
operation contract. Separate input/output schema generation, promote named reusable components,
generate applicable Problem responses, add the coherent fixture and schema-validated examples,
correct the eleven missing response contracts, reject internal prose, enforce runtime parity and
size budgets, and store the normalized release snapshot. Commit as
`fix(api): Publish the complete generated contract`.

### Task 5: Remove staff operations from the public API

Move staff notification-intent routes under `/admin/notifications`, update the admin client, move
personal operations to `/v1/me/notifications`, remove prerelease public aliases, remove the staff
tag, and prove public/admin route separation. Commit as
`fix(admin): Remove staff operations from the public API`.

### Task 6: Ship the Docket API reference

Install exact Scalar 1.68.0 with pnpm, copy and serve owned assets, build the Docket shell and fixed
configuration, implement safe Try It version injection, bounded loader and failure UI, compressed
representations and cache validators, CSP, responsive accessibility, performance budgets, and the
desktop/mobile browser suite. Commit as `chore(api): Ship the Docket API reference`.

### Task 7: Gate public API contract releases

Implement semantic snapshot comparison and version/release-note rules, generated fact freshness,
production API-reference verification, OAuth canary support, CI wiring, and separate evidence for
source, local, CI, deployment, docs, and Git ancestry. Commit as
`chore(dx): Gate public API contract releases`.

### Task 8: Rebuild developer documentation

Apply the exact developer navigation order, write the four new guides, rewrite existing guides
around capabilities and deployed truth, generate the MCP and contract snippets, add the two focused
diagrams, correct every stale hostname, route, field, and claim, add the changelog entry, and pass
the pinned Mintlify, executable-example, link, accessibility, and editorial gates. Commit as
`chore(docs): Rebuild the developer documentation`.

## Completion rule

The work is complete only when every public operation passes the semantic contract gate, each audit
defect has a passing test or production observation, the first-request workflow works without source
inspection, engineering leadership can evaluate all auth and HTTP guarantees from public docs, and
source, local runtime, CI, deployed API, deployed docs, and Git state pass independently. The
`0.1.0` note describes the initial explicit contract; it does not claim that every underlying
capability first appeared in this release.

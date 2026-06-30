# Docket — System Architecture

> **Companion** to `docs/engineering/docket-engineering-plan.md` (the written overview) and `docs/engineering/specs/*` (build-ready specs; `RECONCILIATION.md` is the decision tie-breaker). These diagrams reflect the **Docket** design — a Turborepo of Next.js apps + a Hono API on **Vercel**, backed by **Neon** Postgres, **Better Auth**, **Stripe**, and a remote **MCP** server. _(Supersedes the archived "Project Athena" architecture under `docs/_archive/`.)_

## Overview

Docket is a multi-tenant, AI-native **work command center**. Several Next.js apps and one Hono API run on Vercel over Neon Postgres; humans and AI agents are interchangeable **Actors**; and one person can run **multiple organizations** — with separated contexts — from a single personal **Hub**. The views below go top-down: system → monorepo → domain model → API → auth → MCP → deployment → runtime flows.

## High-Level System Architecture

The shape of this system follows from a single early decision: keep one backend. Docket runs three Next.js 16 apps (`web`, `marketing`, `admin`) and one Hono 4.x service (`apps/api`) as four independent Vercel projects, but only `apps/api` holds business logic, secrets, and the database connection. The Next apps are pure clients — they consume the API exclusively through a type-only `hc<AppType>` import and carry nothing more sensitive than `NEXT_PUBLIC_*` values. We deliberately resisted the obvious alternative of letting each Next app own its own route handlers and a slice of the data layer. A single Hono service gives the MCP server and the OAuth provider a natural, framework-agnostic home, lets the API deploy on its own cadence, and keeps the 12-factor env contract clean: there is exactly one place that holds `DATABASE_URL`, `BETTER_AUTH_SECRET`, and the Stripe/OAuth/agent credentials, and exactly one surface to audit for tenant-isolation bugs.

That single backend sits behind a Vercel rewrite rather than being called cross-origin, and the reason is cookies. Better Auth issues a first-party session cookie, and `apps/web` is configured so that `/api/*` rewrites to `apps/api` (`app.docket.app` → `api.docket.app`) at the platform edge. Because the browser believes it is talking to its own origin, the cookie stays first-party — no `SameSite=None`, no third-party-cookie problems, no CORS preflight on every mutation, and the `/api/auth/*` OAuth flows and the `/mcp` endpoint all share that same origin. The same-origin posture is not a convenience; it is what makes passkey-first auth, the OIDC provider, and the MCP resource server able to coexist on one deploy without the session story fragmenting. Development mirrors this exactly — identical topology and `@docket/env` validation, only the values differ (a dev Neon branch, `sk_test_` keys) — so the rewrite-and-cookie behavior is never something that only works in production.

The most consequential structural choice is the cross-cutting service layer, and specifically that the RPC handlers and the MCP tools are two front doors onto _one_ set of service functions. A human in the product app calling `POST /v1/orgs/:orgId/tasks` and an agent calling the `create_task` MCP tool do not hit parallel implementations — they converge on the same service function over `@docket/db`, sharing the same `@docket/types` Zod schema as both input validation and (via Zod→JSON-Schema) output contract. This is what makes the "humans and agents are interchangeable Actors" premise real rather than aspirational: there is no second, weaker code path that an agent might exploit, no drift between what the UI enforces and what a tool permits, and no duplicated authorization logic to keep in sync. The MCP server in particular re-implements nothing; it is a transport and an authorization shell around the same muscle the REST surface uses.

For that convergence to be safe, the two front doors must arrive carrying identically-trusted context, which is the single rule the whole architecture is built to protect: `organization_id` comes only from the verified token or session context, never from the client. On the RPC side this is mechanical — the org tenant key is a path param under `/orgs/:orgId`, and the middleware chain (CORS → `sessionMiddleware` → `orgContextMiddleware` → `capabilityGuard`) resolves the human `Actor` for `(session.user.id, orgId)`, returning 404 if there is no membership, and stamps `c.var.actorCtx` before any handler runs. The body is never consulted for tenancy. On the MCP side the same rule holds with a different mechanism: context derives from the validated token's `sub`, and the org is a call argument expressed as a `docket://{slug}/…` resource URI that is then re-checked against the actor's grants — it is never something the client simply asserts. A token's scope (`work:read`, `work:write`, `agents:run`, `connectors:link`) is necessary but never sufficient; per-org `canActor` resolution always follows. This is also why the cross-org Hub endpoints (`/hub/today`, `/portfolio`, `/search`, `/inbox`) live at the top level outside `/orgs`: they aggregate across every org the caller belongs to via a server-merged per-membership fan-out, each item individually capability-filtered and org-chipped — deliberately never a cross-tenant SQL join, so one person running many organizations from one Hub still gets hard tenant separation underneath a unified view.

The layer boundaries fall where they do because each owns exactly one concern and depends only downward, producing the strict build spine `env → db → auth → api`. `@docket/db` is the sole owner of all SQL — including the tables Better Auth generates into it — so there is one schema source of truth and one migration story (`drizzle-kit` against the unpooled Neon endpoint, while runtime traffic uses the pooled PgBouncer endpoint). `@docket/auth` wraps the single `betterAuth()` instance and its Drizzle adapter. `apps/api` composes the Hono router and exports its type as the `AppType` contract — and critically, that export is _type-only_: the Next apps get full RPC type inference at compile time while actual requests still travel same-origin over the rewrite at runtime. `@docket/types` holds the Zod schemas that bind all three consumers (RPC handlers, MCP tools, Next server actions) to one shape. The compiled-versus-JIT split is a deliberate ergonomic tradeoff in service of this design: `@docket/db`, `@docket/auth`, and `apps/api` are compiled to `dist` so Hono's RPC type inference doesn't overwhelm `tsserver`, while `@docket/types`, `@docket/ui`, and `@docket/env` stay raw TS via `transpilePackages`. The failure modes this guards against are concrete — break the `.route()` method chain (or convert a router to `OpenAPIHono`) and the `AppType` contract silently degrades; let any consumer drift from the API's pinned Hono version and RPC inference falls apart — so these are not stylistic preferences but load-bearing constraints on the whole client-server type bridge.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ CLIENTS                                                                      │
│   apps/web    apps/marketing    apps/admin     (Next.js 16 · React 19)       │
│   3rd-party MCP clients:  Claude · Codex · any MCP agent                     │
│   browser (/api/*) and MCP (/mcp) both reach apps/api via Vercel             │
└──────────────────────────────────────────────────────────────────────────────┘
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ VERCEL   —   hosting + routing                                               │
│   4 Vercel projects · 12-factor env-var deploy                               │
│   apps/web rewrites /api/* → apps/api   (keeps auth cookies first-party)     │
└──────────────────────────────────────────────────────────────────────────────┘
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ apps/api   —   Hono 4.x   (single backend service)                           │
│   • REST + RPC      /v1/orgs/:orgId/…   +   cross-org /v1/hub/{today,…}      │
│   • MCP server      /mcp   (OAuth 2.1 Resource Server · Streamable HTTP)     │
│   • OAuth / OIDC    /api/auth/*   (Better Auth = Authorization Server)       │
│   • Stripe webhook  /api/auth/stripe/webhook   (+ lifecycle reconcile)       │
│   middleware:  CORS → session → orgContext → capabilityGuard                 │
│   org_id ALWAYS from the verified token / context — never the client body    │
└──────────────────────────────────────────────────────────────────────────────┘
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ CROSS-CUTTING SERVICES   (RPC handlers AND MCP tools share this layer)       │
│   Better Auth · Permissions/Grants · Work (Org→…→Task) · Agents/Sessions     │
│   Billing (Stripe, per-org) · Integrations (migration | connector)           │
│   packages:  @docket/{db · auth · types · env · ui}                          │
└──────────────────────────────────────────────────────────────────────────────┘
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ DATA   +   EXTERNAL SERVICES                                                 │
│   Neon Postgres  (pooled at runtime · unpooled for migrations)               │
│   Stripe · Google · GitHub · Linear · agent providers (Athena/Claude/Codex)  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Three Next.js 16 apps (web, marketing, admin) and any third-party MCP client sit
above Vercel, which rewrites the product app's `/api/*` to the same-origin Hono
`apps/api` so auth cookies stay first-party. `apps/api` is the single backend —
it serves the REST+RPC `/v1` surface (org-nested routes plus cross-org `/hub`),
the `/mcp` Streamable-HTTP server (OAuth 2.1 Resource Server), Stripe webhooks,
and is itself the OAuth2.1/OIDC provider (Better Auth = Authorization Server). Its
RPC handlers and MCP tools share one service layer over the cross-cutting concerns
(auth, grants, work, agent/sessions, billing, integrations) owned by the
`@docket/*` packages, persisting to Neon Postgres and reaching out to Stripe, the
social/data providers, and the agent providers that own session compute.

## Monorepo Structure

Docket lives in a single Turborepo on pnpm workspaces because the product is not one app but a federation of them — `apps/web` (the product), `apps/marketing`, `apps/admin`, and `apps/api` (Hono) — that must share one database schema, one auth instance, one set of Zod contracts, and one design system without those things drifting out of sync. pnpm gives us a content-addressed store and strict, non-hoisted `node_modules` so a package can only import what it actually declares (which is what lets us pin Hono to a single identical version everywhere — a hard requirement for RPC type inference to work, discussed below). Turbo 2.9.x sits on top as the task runner and cache: the root `turbo.json` uses the 2.x `tasks` key (the removed 1.x `pipeline` key is a non-starter per Hard Constraint 2) and declares `env`/`globalEnv` explicitly so the build cache invalidates when a relevant environment value changes rather than silently serving a stale artifact. The choice is deliberately modeled on `create-t3-turbo`, adapted from tRPC to Hono RPC; we are reusing a proven monorepo shape, not inventing one.

The non-negotiable rule of this repo is that `@docket/db` is the single owner of all SQL. Every table — the work-domain tables (`organization`, `actor`, `team`, `project`, `task`) and the Better Auth tables (`user`, `session`, `account`, `verification`, `passkey`) alike — is defined, migrated, and exported from this one package. Better Auth does not get its own schema island: `npx @better-auth/cli generate` emits its Drizzle schema _into_ `@docket/db`, and `drizzle-kit migrate` applies it from there. This single-owner discipline is what makes the ULID decision from RECONCILIATION enforceable. Every primary key is `text("id").primaryKey().$defaultFn(genId)` driven by one generator in `@docket/db/src/id.ts`, and Better Auth's `advanced.database.generateId` is wired to that same generator so that `user.id` is `text` and lines up with every foreign key — including the `actor.user_id` link that folds membership into the human Actor. If auth owned its own tables, `user.id` would default to whatever Better Auth picks and the FK graph would fracture; centralizing SQL is the precondition for one ID primitive across the whole graph and for `ON DELETE CASCADE` to flow cleanly from `organization` through every `organization_id` column.

The packages split into two compilation regimes, and the split is mandatory rather than stylistic. `@docket/db`, `@docket/auth`, and `apps/api` are **compiled** ahead of time (`tsc → dist`, with `main`/`types` pointed at the build output) so consumers import a finished `.d.ts`; everything else — `@docket/ui`, `@docket/types`, `@docket/env` — is consumed just-in-time as raw TypeScript through Next's `transpilePackages`. The reason the compiled side exists at all is the Hono RPC contract. RPC type inference only survives if the router is method-chained (`app.route(...).route(...)`) and exported as `type AppType = typeof routes`, and that inferred type is enormous: if `apps/web` imported the API's router source directly, `tsserver` would re-infer the entire chained-router type on every keystroke and grind to a halt. Splitting the router across `routes/organizations.ts`, `routes/projects.ts`, `routes/tasks.ts`, and friends, then compiling `apps/api` to a flattened `.d.ts`, means the editor reads a pre-computed type instead of recomputing it live. That is the whole point of the compiled/JIT line in the diagram — it is a `tsserver` performance decision, not a packaging preference.

What actually crosses from `apps/api` to the three Next apps is _only_ the `AppType` — a type-only import. The Next apps never import the Hono service's runtime; they construct an `hc<AppType>(NEXT_PUBLIC_API_URL, { init: { credentials: 'include' } })` client and get fully-typed `client.organizations.$post`, `client.projects.$post`, `client.tasks.$post` calls with the request and response shapes inferred end to end. Both the API tsconfig and every consumer tsconfig must have `"strict": true` or the inference silently collapses to `any`. The runtime requests, by contrast, do not go cross-origin: `apps/web` rewrites `/api/*` to the Hono service via Vercel rewrites so the call is same-origin, which keeps the Better Auth session cookie first-party (CORS-with-credentials is the fallback only if the deployables must be split). `@docket/types` is the shared seam underneath this — it exports the Zod schemas (`OrgCreate`, `ProjectCreate`, `TaskCreate`) that `apps/api` validates both request _and_ response against, and the single branded `Id` primitive that both the REST routes and the MCP tool schemas consume, so the RPC client, the API handlers, and the UI all reference one definition.

Environment configuration is centralized in `@docket/env`, which every package and app imports. It is built on `@t3-oss/env-core` as one shared base contract (server vars like `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `STRIPE_SECRET_KEY`, the OAuth client pairs, plus the `NEXT_PUBLIC_API_URL` client var) that each deployable _extends_ so it inherits exactly the variables it needs and no more. Validation runs at boot: importing `@docket/env` with a required variable missing throws immediately in dev rather than failing mysteriously deep in a request — the 12-factor contract is enforced, not advisory. Critically, `.env` files live per-app, not at the repo root, and `turbo.json` runs in strict env mode so a task can only see the variables it has declared; combined with the `env`/`globalEnv` declarations this keeps the build cache correct when values change.

The thread tying the structure together is Hard Constraint 3: dev mirrors prod. The same `@docket/env` schema and the same validation run in both environments; only the values differ. The same `apps/api` Hono service that runs as a Vercel deployment is the one `pnpm dev` brings up locally; the same Neon Postgres-targeted `@docket/db` migrations apply against a local or Neon database; the same same-origin rewrite path that keeps cookies first-party in production is exercised in development. There is no separate "dev mode" code path that could pass locally and break on deploy — the env-var-only deploy story and the local story are the same story, which is exactly why `scripts/bootstrap.ts` (`pnpm bootstrap`) provisions real Neon, real auth secrets, and real migrations on a fresh checkout rather than stubbing them. `tooling/` rounds this out with shared tsconfig, ESLint, and Tailwind presets that carry no runtime code and exist purely to keep strictness and style identical across every member of the workspace.

Docket is a single **Turborepo** (pnpm workspaces, turbo 2.9.x, `@docket/*`
namespace). Four deployables in `apps/`, six shared packages in `packages/`,
build presets in `tooling/`, all on Vercel. The tree and the package
dependency / type-flow:

```
docket/                          Turborepo · pnpm workspaces · turbo 2.9.x (tasks key)
│
├─ apps/                         ── 4 DEPLOYABLES (each its own Vercel project) ──
│   ├─ web/         Next.js 16 · React 19 — the product app (consumes @docket/ui)
│   ├─ marketing/   Next.js 16 — Linear-grade landing → sign-up (consumes @docket/ui)
│   ├─ admin/       Next.js 16 — service-operator back-office (separate app)
│   └─ api/         Hono 4.x — work API · /api/auth/* mount · /mcp · OIDC provider
│
├─ packages/                     ── 6 SHARED PACKAGES (@docket/*) ──
│   ├─ db/          Drizzle + Neon Postgres — SINGLE owner of ALL SQL
│   │                            (incl. Better Auth generated tables); ULID genId
│   ├─ auth/        Better Auth betterAuth() instance + framework handlers
│   ├─ ui/          shared shadcn/ui + Tailwind components
│   ├─ types/       Zod schemas + the Hono RPC AppType contract (one branded Id)
│   ├─ env/         @t3-oss/env validation (extends-composed per deployable)
│   └─ test-utils/  per-worker tenant · session-seed · db-read helpers
│
├─ tooling/                      ── BUILD PRESETS (no runtime) ──
│   ├─ tsconfig/         shared tsconfig bases
│   ├─ eslint-config/    shared lint rules
│   └─ tailwind-config/  shared Tailwind preset
│
├─ scripts/          bootstrap.ts (pnpm bootstrap: Neon · Stripe · Vercel · OAuth)
├─ docs/             core/ · engineering/ (specs, RECONCILIATION = tie-breaker)
├─ turbo.json        2.x `tasks` key · strict env mode · globalEnv (cache-correct)
└─ pnpm-workspace.yaml   apps/* · packages/*

╔══════════════════════ DEPENDENCY & TYPE-FLOW (build spine) ══════════════════════╗
║                                                                                  ║
║   @docket/env ─► @docket/db ─► @docket/auth ─► apps/api                          ║
║   (validated      (Drizzle      (betterAuth(),    (Hono router, method-chained)  ║
║    env, all        schema +      drizzle          │                              ║
║    packages        Better Auth   adapter)         │ exports                      ║
║    import it)      tables)                         ▼                              ║
║                                            export type AppType  ── TYPE-ONLY ──┐ ║
║                                            (Hono RPC contract)                 │ ║
║                                                                               ▼ ║
║   @docket/types (Zod ⇄ AppType) ──────────────────────────────►  apps/web      ║
║   @docket/ui    (shadcn components) ──────────────────────────►  apps/marketing ║
║                                                                  apps/admin     ║
║   Next apps consume apps/api ONLY via the type-only AppType (hc<AppType>);      ║
║   runtime calls go same-origin over Vercel rewrites (/api/* → apps/api).        ║
║                                                                                  ║
║   ┌─ COMPILED (tsc → dist; .d.ts consumed) ─┐   ┌─ JIT (raw TS · transpilePackages) ─┐ ║
║   │  @docket/db   @docket/auth   apps/api    │   │  @docket/ui  @docket/types  @docket/env │ ║
║   └─ keeps tsserver fast under RPC inference ┘   └─ no build step ──────────────────┘ ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

The strictly-sequential build spine is `env → db → auth → api → ui`: each link
consumes the previous link's output, and `apps/api` exports its Hono router as a
**type-only** `AppType` that the three Next apps import for fully-typed
`hc<AppType>` RPC calls (actual requests travel same-origin via Vercel rewrites,
keeping auth cookies first-party). `@docket/db`, `@docket/auth`, and `apps/api`
are **compiled** to `dist` so RPC type inference doesn't cripple `tsserver`,
while `@docket/ui`, `@docket/types`, and `@docket/env` stay **JIT** (raw TS via
`transpilePackages`). `@docket/db` is the single owner of all SQL — including the
Better Auth tables generated into it — and `tooling/` holds shared tsconfig,
ESLint, and Tailwind presets with no runtime code.

## Domain Model

The single hardest idea in Docket's schema is the distinction the product plan opens with: **containment** versus **association**. Containment is a hard parent-child relationship the child cannot outlive — an `Organization` owns its `Task` rows, a `Project` owns its `Milestone` rows, a `Team` owns its `Cycle` rows — and it is encoded as a `NOT NULL` foreign key with `ON DELETE CASCADE`. Association is a soft, optional link where either side stands alone — an `Initiative` _themes_ a `Project`, a `Cycle` _schedules_ a `Task`, a `Task` _blocks_ another `Task` — and it is encoded either as a nullable FK with `ON DELETE SET NULL` or as a dedicated m2m join table (`initiative_project`, `initiative_program`, `task_label`, `task_dependency`). This is not cosmetic. The cascade choice _is_ the data-lifecycle policy: deleting an Organization must obliterate its entire work layer in one statement (that is exactly how the lifecycle purge works — every `organization_id` FK cascades), whereas detaching a Task from a Project must leave the Task intact in Triage. Most planning tools flatten both kinds of edge into a single tree and then force structure where it doesn't belong; Docket's whole legibility depends on keeping the two physically distinct in the FK graph, because that is what lets a Task be reassigned, re-themed, or unscheduled without ever being destroyed, while a tenant deletion is still a clean single-rooted cascade.

`Program` earns its own entity for a concrete reason that falls out of three mutually exclusive status enums. `Project` is a _bounded_ effort tracked to completion (`project_status` = `planned | active | completed | canceled`), and `Initiative` is a pure _theme_ with no work inside it (`initiative_status` = `active | completed`, plus an m2m overlay to projects and programs and nothing else). Continuous operations — a support function, a nonprofit's after-school program — fit neither: they are not a deadline-bearing deliverable and they are not a contentless label. The schema makes the difference unforgeable by giving `program_status` the values `active | paused | archived` **and deliberately no `completed`**. A Program _cannot_ be marked done, which is the whole point of the concept; it is the ongoing counterpart to the bounded Project. The containment graph reflects this too: a `Project` may sit directly under the org or under a `Program` via the nullable `program_id`, and a `Task` may hang off a `Program` directly (`task.program_id`) for recurring work that never belongs to any bounded project — which is why both of those parent FKs are `SET NULL` associations rather than cascades.

The `Actor` is the answer to every "who" the system asks — assignee, lead, owner, comment author, audit principal — collapsed into one table with a `kind` of `human | agent | team`. Two design decisions make this work. First, only `human` and `agent` actors are _assignable_: the app layer enforces that `task.assignee_id` points at a human-or-agent actor and `task.delegate_id` at an agent (the "you own it, the agent does it" delegate), so a Team can never have work assigned to it even though it shares the table. Second — and this is the load-bearing modeling call — a human `Actor` _is_ the membership. There is no separate membership join between `User` and `Organization`; instead an `actor` row carries the org-scoped `organization_id` plus the human-only nullable `user_id` (FK to the Better Auth global `user`) and `role_id`, with a partial unique index `(organization_id, user_id) WHERE user_id IS NOT NULL` guaranteeing one membership per person per org. That folding is why the Better Auth organization plugin is turned **off** (per RECONCILIATION): Docket owns its own `organization`/`actor` shape, the global `User` persists at zero memberships, and "joining an org" is literally "an actor row exists." Agent-specific configuration (provider connection, `approval_policy`, accountable owner, guidance) lives in a thin `agent` table 1:1 with an `actor{kind:'agent'}`, keeping identity uniform and behavior separate.

Every primary key is a **text ULID** generated by one repo-wide `genId()` in `@docket/db/src/id.ts`, and this is a hard constraint rather than a preference. Better Auth's CLI emits `text("id").primaryKey()` for `user`, and FK columns referencing it must be type-compatible, so a Postgres-native `uuid()` is forbidden everywhere — mixing `uuid` and `text` would break the FKs that stitch Docket's `actor.user_id` to the auth tables. ULID buys two further properties the schema leans on: the ids are lexicographically sortable (k-sortable by creation time, useful for cursor pagination and roughly time-ordered scans) and they are the same 26-char primitive the API and the MCP tools both validate through the single branded `Id` Zod schema in `@docket/types` — REST addresses entities as `/orgs/{id}` and MCP as `docket://{slug}/...`, but the id primitive underneath is identical. The same generator is wired into Better Auth's `advanced.database.generateId` so even auth-minted rows obey it.

Dependencies are the schema's most interesting integrity problem because they are explicitly **org-wide and cross-project**: a Task can be blocked by any other Task in the same Organization, even one in a different Project or Program, and the resulting `blocking → blocked` graph must stay acyclic. No single Postgres constraint can enforce a DAG, so `task_dependency` layers three defenses. A `CHECK(blocking_task_id <> blocked_task_id)` kills the trivial self-loop, the composite primary key `(blocking_task_id, blocked_task_id)` forbids duplicate edges, and the real work is an application-level guard: before inserting an edge, a recursive-CTE reachability query runs inside a `SERIALIZABLE` transaction and rejects the insert if `blocked` can already reach `blocking` along existing edges. The query is itself tenant-scoped (`WHERE organization_id = $org`), which both keeps it index-prefixed and structurally guarantees dependencies never cross a tenant boundary even though they freely cross project boundaries. The serializable isolation matters: two concurrent edge inserts that each look acyclic in isolation could together form a cycle, and only the stricter isolation level (or a deferred constraint trigger as defense-in-depth) closes that race.

The cascade-versus-set-null choices throughout are deliberate and each carries a behavioral meaning worth reading directly off the FKs. `task.team_id` is `NOT NULL` with `ON DELETE RESTRICT` — every Task must always belong to a Team (a Team owns its workflow states, into which `task.state` is a free text key with no global FK), and a Team cannot be deleted out from under live Tasks. The subtask self-reference `parent_task_id` cascades, so deleting a parent removes its subtree. By contrast `project_id`, `program_id`, `milestone_id`, `cycle_id`, `assignee_id`, and `delegate_id` are all `SET NULL`: detaching or deleting any of those associations gracefully demotes the Task (a project-less, program-less task on a triage-enabled team simply _becomes_ Triage — that state is derived, not a column) rather than destroying it. Audit and authorship fields (`created_by`, `author_id`, `owner_id`, `lead_id`) are likewise `SET NULL` so history survives the departure of the actor who made it. Soft-delete is uniform — an `archived_at` nullable timestamp marks active rows as `archived_at IS NULL`, with `completed_at`/`canceled_at` on lifecycle entities — and hard deletion happens _only_ via the org-level cascade during the lifecycle purge, which is the one place the entire tenant subtree is meant to disappear at once.

Core work-layer entities, their key fields, and how they relate. Solid
arrows (`──►`) are **containment** (hard parent, `ON DELETE CASCADE`); dashed
arrows (`╌╌►`) are **association** (soft `SET NULL` or m2m join table).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Organization  (TENANT — hard boundary; organization_id on every work row)  │
│ id·ULID  name  slug  is_personal  vocabulary  lifecycle_state              │
└───┬───────────────┬───────────────┬───────────────┬───────────────────────┘
    │ contains      │ contains      │ contains      │ contains
    ▼               ▼               ▼               ▼
┌─────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────────────────┐
│ Actor       │ │ Initiative   │ │ Program      │ │ Team                   │
│ {human|     │ │ (theme)      │ │ (ongoing —   │ │ key  workflow_states[] │
│  agent|team}│ │ status       │ │  NO complete)│ │ triage_enabled         │
│ display_name│ │ {active|     │ │ status       │ └───┬────────────────┬───┘
│ status      │ │  completed}  │ │ {active|     │     │ contains       │
│ user_id?    │ │ health?      │ │  paused|     │     ▼                ▼
│ role_id?    │ └──┬────────┬──┘ │  archived}   │  ┌───────┐  ┌──────────────┐
└──┬───────┬──┘    ╎themes  ╎    │ health?      │  │ Cycle │  │ team_member  │
   │assign ╎       ╎ (m2m)  ╎    └──┬────────┬──┘  │ number│  │ (m2n Actor)  │
   │/lead  ╎       ╎        ╎       │contains╎     │ start │  └──────────────┘
   ╎(SET   ╎       ▼        ▼       │        ╎themes│ /end  │
   ╎ NULL) ╎  ┌──────────────────────────┐  ╎(m2m) └───┬───┘
   ╎       ╎  │ Project (bounded)        │◄╌╌╌╌╌╌╌╌╌╌╌╌╌┘ schedules
   ╎       ╎  │ status {planned|active|  │  ╎          (cycle_id SET NULL)
   ╎       ╎  │  completed|canceled}     │  ╎              ╎
   ╎       ╎  │ lead_id?  program_id?    │  ╎              ╎
   ╎       ╎  │ team_id?  health?        │  ╎              ╎
   ╎       ╎  └──┬─────────────────┬─────┘  ╎              ╎
   ╎       ╎     │ contains        │ contains              ╎
   ╎       ╎     ▼                 ▼                       ╎
   ╎       ╎  ┌──────────────┐  ┌────────────────────────────────────┐
   ╎       ╎  │ Milestone    │  │ Task  (atomic unit)                │
   ╎       ╎  │ (checkpoint) │◄╌│ title  state  priority             │
   ╎       ╎  │ target_date  │  │ team_id(NN)  project_id?  program_id?
   ╎       ╎  │ sort         │  │ assignee_id? delegate_id? cycle_id? │
   ╎       ╎  └──────────────┘  │ milestone_id?  parent_task_id?     │
   ╎       ╎                     └─┬──────────┬───────────┬──────────┘
   ╎       ╎ assignee/delegate     │ subtask  │ blocked-by│ (m2m DAG,
   └╌╌╌╌╌╌╌┴╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘ (self,   │ cross-proj, acyclic)
   (Actor human|agent / agent)      CASCADE)  └───────────┘ task_dependency
                                               blocking ──► blocked

   ┌─────────────────── Agents & Sessions (execution muscle) ──────────────┐
   │ Actor{kind:agent} ─1:1─► Agent          AgentSession ──► SessionActivity│
   │   approval_policy {suggest|             trigger {assignment|            │
   │    act_with_approval|autonomous}         delegation|mention}            │
   │   connection{provider:Athena|           status {pending|running|        │
   │    Claude|Codex}                          awaiting_approval|…}          │
   │ Agent ──► AgentSession (1:N) ╌╌► Task    type {thought|action|response| │
   │                       (task_id SET NULL)      elicitation|error}        │
   └────────────────────────────────────────────────────────────────────────┘
```

| From → To                                                           | Kind            | Mechanism / FK                         |
| ------------------------------------------------------------------- | --------------- | -------------------------------------- |
| Organization → Team / Initiative / Program / Project / Task / Actor | contains (1:N)  | `organization_id` NOT NULL, CASCADE    |
| Initiative ╎themes╎ Project                                         | assoc m2m       | `initiative_project` join              |
| Initiative ╎themes╎ Program                                         | assoc m2m       | `initiative_program` join              |
| Program → Project                                                   | contains (1:N)  | `project.program_id` SET NULL          |
| Program → Task                                                      | contains (1:N)  | `task.program_id` SET NULL             |
| Project → Task                                                      | contains (1:N)  | `task.project_id` SET NULL             |
| Project → Milestone                                                 | contains (1:N)  | `milestone.project_id` CASCADE         |
| Milestone ╎checkpoint╎ Task                                         | assoc (N:1)     | `task.milestone_id` SET NULL           |
| Cycle ╎schedules╎ Task                                              | assoc (N:1)     | `task.cycle_id` SET NULL               |
| Team → Cycle                                                        | contains (1:N)  | `cycle.team_id` CASCADE                |
| Team → Task                                                         | contains (1:N)  | `task.team_id` NOT NULL, RESTRICT      |
| Team ╎members╎ Actor                                                | assoc m2m       | `team_member` join                     |
| Task ╎blocked-by╎ Task                                              | assoc DAG (m2m) | `task_dependency` (acyclic, org-wide)  |
| Task → Task (subtask)                                               | contains (self) | `parent_task_id` CASCADE               |
| Task ╎assignee/delegate╎ Actor                                      | assoc (N:1)     | `assignee_id` / `delegate_id` SET NULL |
| Actor{agent} → Agent                                                | contains (1:1)  | `agent.actor_id` unique, CASCADE       |
| Agent → AgentSession                                                | contains (1:N)  | `agent_session.agent_id` CASCADE       |
| AgentSession → SessionActivity                                      | contains (1:N)  | `session_activity.session_id` CASCADE  |
| AgentSession ╎runs-on╎ Task                                         | assoc (N:1)     | `agent_session.task_id` SET NULL       |

Organization is the tenant root that hard-contains every work entity via a
cascading `organization_id`. Initiatives are pure themes that m2m-link (dashed)
to bounded Projects and ongoing Programs; Programs and Projects then contain
Tasks, while Projects also own dated Milestone checkpoints. Tasks are the atomic
unit — always under a Team, schedulable into Cycles, and wired to each other by
an org-wide acyclic `blocked-by` DAG that crosses project boundaries. Agents
(an Actor subtype) are the execution muscle: each owns AgentSessions whose
ordered SessionActivity stream (thought/action/response) is the real hosted
artifact, optionally bound to the Task that triggered the run.

## API Surface: The `/v1` Route Tree

The defining choice in this surface is that the tenant key lives in the URL path: every org-scoped resource is mounted under `/v1/orgs/:orgId`, and the `orgs` router chains its children rather than nesting them by import (`orgs.route("/:orgId/teams", teams).route("/:orgId/tasks", tasks)...`). This is not cosmetic. It means `orgContextMiddleware` runs in exactly one place — on `/orgs/:orgId/*` — where it loads the human `Actor` row for `(session.user.id, orgId)` with `kind='human'`, 404s on no membership, and stamps `c.var.actorCtx = { orgId, actorId, role, capabilities }` onto the context. Every downstream handler derives `organization_id` from that verified context and never from the request body, which closes the most common multi-tenant footgun (a caller with a valid session for org A asserting `organizationId: B` in a create payload). It is also the exact same derivation rule the MCP server uses — org and user come only from the verified token `sub` plus the resource URI, never client-asserted — so the two entry points cannot diverge on whose data is being touched. The flip side is that a single Docket entity can never be addressed without naming its org, which is deliberate: there is no global task lookup, because there is no global task namespace.

Cross-org work needs a different shape, and that is why the Hub surfaces (`/v1/hub/today`, `/hub/portfolio`, `/hub/search`, `/hub/inbox`, `/hub/activity`) plus `/notifications` and `/dailyplan` sit at the top level rather than under `/orgs`. These endpoints answer "what should one person, who runs several organizations, look at right now?" — a question that spans tenants by definition. The critical engineering constraint is how they span them: aggregation is a server-side fan-out, one query per membership where the caller has an active human Actor, merged in application code. There is deliberately no cross-tenant SQL join. Each returned item carries its own `organizationId` (the "org chip") and is individually run through the §7.2 query-scoping predicate for that org, so the aggregated view is the union of per-org permission decisions, not a privileged bypass of them. A guest in org B who appears in the caller's Hub still sees only what a `view` grant in org B exposes; the cockpit cannot leak hidden work just because it renders several orgs side by side. This is why Hub routes require only `authenticated` in the capability column — the per-resource gate has already been applied to each constituent row before merge.

The contract that the three Next apps consume is the Hono RPC `AppType` — the `typeof` the fully `.route()`-chained composition root, re-exported from `@docket/types/api` and consumed type-only via `hc<AppType>`. No business logic lives in `web`, `marketing`, or `admin`; they are typed clients. Two non-obvious rules keep this working. First, every resource router must be built as an unbroken method chain (`.get().post().get(...)`) — assigning a `Hono` instance to a `const` mid-route silently destroys RPC inference, and the router files are split one-per-resource-group specifically so `tsserver` doesn't collapse under the inferred type. Second, the Hono version must be byte-identical (pinned in the root catalog) across `apps/api` and every consumer, and `apps/api`, `@docket/db`, and `@docket/auth` are compiled to `dist` rather than transpiled JIT, both to protect inference and to keep editor performance tolerable.

Validation runs in both directions through `hono-openapi`, and the choice of library is load-bearing rather than incidental. The alternative — `@hono/zod-openapi`'s `OpenAPIHono` + `createRoute` — breaks the `.route()` chaining that `AppType` depends on, so it is banned. Instead each handler attaches `validator("json"|"query"|"param", Schema)` for input, reads it back via `c.req.valid(...)`, and returns through a shared `ok(c, OutSchema, data)` helper that `schema.parse()`es the payload (always in dev/test, sampled in prod) before serializing. The same output schema is wired into `describeRoute` via `resolver(schema)`, so the documented response and the runtime response are physically the same Zod object and cannot drift. Those schemas live once in `@docket/types` and are reused as MCP tool `inputSchema`/`outputSchema` and as the types for Next server actions. The `x-docket-capability` annotation on each route is the third thing the schema layer carries: it is both an OpenAPI extension that renders in the Scalar docs at `/v1/docs` and the literal capability (`view < comment < contribute < assign < manage`) that `capabilityGuard` asserts at runtime, so the published contract and the enforced contract are the same string.

Authorization is two complementary layers, and the route tree only works because both are present. `capabilityGuard(capability, resourceLocator)` is the point-check on mutating and single-resource routes: it resolves the target's containment chain (Org→Team/Program→Project→Task), walks grants root-to-self with most-specific-wins and cascade-down override, and 403s on failure — except where the actor lacks even `view`, in which case it returns 404 to avoid leaking the existence of a resource. List and search endpoints cannot use that pattern without leaking counts and breaking cursor pagination, so they instead compose a visibility/grant predicate directly into the SQL `WHERE`, returning only permitted rows from the database. For a plain Member the predicate collapses to `effectiveVisibility = 'public'` (a cheap indexed scan); for a Guest it collapses to `id IN (granted set)`, which is empty until something is granted — "guests see nothing ungranted" enforced at the storage layer, not patched on in the handler. Agents traverse the identical path: an Agent is just an `Actor{kind:'agent', role_id:null}` with explicit Actor-grants, so `canActor` is called with the agent's actor id for every read and write, with the approval gate layered orthogonally on top.

Finally, several mounts deliberately live outside `/v1` and outside the public `AppType`. `/api/auth/*` (the Better Auth handler, which calls `auth.handler(c.req.raw)`) and `/mcp` (the MCP Streamable HTTP transport behind `withMcpAuth`) sit alongside the public `/.well-known/oauth-protected-resource` PRM document. The machine/webhook edges live under a single `/internal/*` umbrella — `/internal/billing/webhook` (Stripe), `/internal/ingest/{linear,github,slack}` (provider webhooks), `/internal/cron/*` (`CRON_SECRET`), and the signed-state `/internal/integrations/github/callback` — each self-authenticated by a signature or secret, never the session, and so deliberately kept out of the public API namespace and the public spec. The internal staff back-office is its own typed surface at `/admin` (`AdminAppType`, consumed only by `apps/admin` and gated by `staffMiddleware`), with its own staff-gated reference at `/admin/docs`; it is **not** part of the public `AppType` or the `/v1` Scalar reference. Only two non-RPC edges stay on `/v1` because they are user-facing: the SSE live stream (`/v1/stream/sse`) and the binary account-export download (`/v1/me/account/exports/:id/file`). They share the same Hono deploy but are excluded from the typed contract for principled reasons. Better Auth owns its own request/response lifecycle and its OAuth 2.1 / OIDC framing — it is not a Docket RPC route and should never be callable through `hc<AppType>`. The MCP surface speaks JSON-RPC over Streamable HTTP, not the REST-shaped request/response that RPC inference models, and its authentication is an audience-bound bearer token rather than the session cookie that `sessionMiddleware` resolves. Crucially, keeping MCP out of `AppType` is not keeping it out of the system: its tools (`create_task`, `move_task`, `post_update`, `trigger_agent_session`, `approve`/`reject`, `run_view`) and its `docket://{org}/{type}/{id}` resources call the _same_ service functions the REST handlers call and share the same `@docket/types` Zod schemas, so the MCP layer re-implements no logic — it is a second front door onto one service layer, gated by the same `canActor` engine plus a coarse OAuth scope check (`work:read`, `work:write`, `agents:run`, `connectors:link`) layered above it.

Every route below is one `Hono` instance, chained with `.route()` on the
`apps/api` composition root and exported as the `AppType` contract. Each
handler carries a Zod schema **in** (`validator`) and **out** (`resolver` +
`ok()`), plus an `x-docket-capability` annotation (right column).

```
 apps/api (Hono 4.x)  ──  hc<AppType>  ──►  web · marketing · admin
                                                  (type-only RPC)
══════════════════════════════════════════════════════════════════════
 NON-VERSIONED MOUNTS  (outside /v1, NOT in AppType)
──────────────────────────────────────────────────────────────────────
  /api/auth/*  ── Better Auth = OAuth2.1/OIDC Authorization Server
                  passkey(primary) · Google · GitHub · Linear(link)
  /mcp         ── MCP Resource Server · Streamable HTTP (POST+GET-SSE)
                  withMcpAuth · audience-bound Bearer · same service layer
  /.well-known/oauth-protected-resource[/mcp]  ── PRM (RFC 9728)
  /internal/*  ── machine edges · self-authed (NOT session-gated):
                  /billing/webhook (Stripe sig) · /ingest/{linear,
                  github,slack} (provider sig) · /cron/* (CRON_SECRET)
                  · /integrations/github/{callback,setup} (signed state)
  /admin/*     ── staff back-office (AdminAppType · apps/admin only)
                  staffMiddleware-gated · own /admin/docs reference
══════════════════════════════════════════════════════════════════════
 /v1  (basePath)                            CAP = x-docket-capability
──────────────────────────────────────────────────────────────────────
  ├─ GET /openapi.json  /docs  /health ........................ public
  │
  ├─ /orgs ............ GET POST  (lists caller memberships) .. auth
  │   └─ /:orgId  ── orgContext + capabilityGuard derive org ─┐
  │       │            (organization_id ALWAYS from context)  │ CAP
  │       ├─ (org root) GET PATCH DELETE ............. org:view│manage
  │       ├─ /members  /roles  /grants  /billing  /export .... org:*
  │       ├─ /teams ......... CRUD + /:id/members ... view│contribute
  │       ├─ /initiatives ... CRUD + timeline + m2m link ...
  │       │      └ PUT/DEL /projects/:id · /programs/:id (link)
  │       ├─ /programs ...... CRUD + /work + /updates ........
  │       ├─ /projects ...... CRUD + /tasks /milestones
  │       │      /updates /agents ...........................
  │       ├─ /cycles ........ CRUD + /burnup /tasks /close ...
  │       ├─ /tasks ......... CRUD + /assign /move /state
  │       │      /dependencies(acyclic,org-wide) /subtasks
  │       │      /links ; GET /triage .......................
  │       ├─ /comments ...... CRUD (polymorphic subject) .... comment
  │       ├─ /updates ....... CRUD (drives health) .........
  │       ├─ /agents ........ CRUD + /grants /grant-requests  manage
  │       └─ /sessions ...... POST(start) + /activity /stream(SSE)
  │              /messages /approvals /pause /resume
  │              /cancel /takeover ............... contribute│assign
  │       └─ /integrations .. CRUD + /directory /import
  │              /sync /jobs ............................... manage
  │
  ├─ CROSS-ORG HUB  (fan-out per membership · per-item org:view)
  │   ├─ /hub/today ....... three-pane cockpit (plan+attention)  auth
  │   ├─ /portfolio ....... org swimlanes → programs → projects  auth
  │   ├─ /search .......... Cmd+K palette (entities+commands)     auth
  │   ├─ /inbox  /activity  actionable set + awareness feed       auth
  │   ├─ /notifications ... cross-org inbox + /count /read-all     auth
  │   └─ /dailyplan ....... Today pull (verifies org:view)         auth
  │
  ├─ /stream/sse ......... live push (SSE) · session-gated         auth
  └─ /me/account/exports/:id/file .. binary ZIP download           auth
       (admin, machine webhooks/cron, and OAuth callbacks are NOT
        under /v1 — see the non-versioned mounts above)
══════════════════════════════════════════════════════════════════════
 IDs = text ULIDs (branded *Id)   Errors = Problem/RFC9457
 POST creates accept Idempotency-Key   DELETE = soft (archived_at)
```

The org tenant key is a path param under `/orgs/:orgId`, where `orgContextMiddleware` loads the human `Actor` and `capabilityGuard` enforces the cascade-resolved capability (`view < comment < contribute < assign < manage`); `organization_id` is never read from the body. Hub endpoints sit at the top level because they aggregate across every org the caller belongs to (server-merged fan-out, each item individually capability-filtered and org-chipped — never a cross-tenant SQL join). `/api/auth/*` and `/mcp` live on the same Hono deploy but outside `/v1` and the RPC `AppType`; the MCP tools (`create_task`, `move_task`, `trigger_agent_session`, `approve`/`reject`, ...) call the same service layer as the REST handlers, sharing the `@docket/types` Zod schemas as both input and output.

## Auth & Identity Topology

The load-bearing decision here is that a _single_ `betterAuth()` instance — mounted at `/api/auth/*` on the Hono `apps/api` deploy — wears two hats that are normally split across separate systems. Hat one is the _relying party / service provider_: the thing humans authenticate _into_. Hat two is the _OAuth 2.1 / OIDC authorization server_: the thing that mints tokens _out_ to remote MCP clients. Both are the same process backed by the same Postgres, which is why `BETTER_AUTH_URL` must equal `API_URL` must equal `MCP_ISSUER_URL` (and `MCP_RESOURCE_URL = ${API_URL}/mcp`) — the env spec derives all of them from one origin precisely so the issuer the AS advertises and the audience the resource server validates can never drift apart. The cookies stay first-party because `apps/web` rewrites `/api/*` to `apps/api` rather than calling it cross-origin; CORS-with-credentials is the documented fallback if those ever have to live on split origins, but the rewrite is the primary path. The OIDC consent UI itself is a route inside `apps/web` (`OIDC_LOGIN_PAGE_URL` defaults to `${NEXT_PUBLIC_WEB_URL}/oauth/consent`), so even the authorization-server's human-facing surface is served by the product app while the token machinery stays in the API.

On the inbound side, passkeys are not just _a_ method — they are the _primary_ method, and the reason is the `requireSession: false` + `resolveUser` capability in `@better-auth/passkey` 1.6.14. Conventional auth assumes you already have a user (and usually a session) before you can attach a credential; passkey-first inverts that. A brand-new visitor can run the full WebAuthn `create()` ceremony with no session in flight, and `resolveUser` is the hook Better Auth calls during verification to decide _which_ user this fresh credential belongs to — for a true first-timer that means minting the `user` row (a `text` ULID, generated by the same `genId` wired into `advanced.database.generateId` so it lines up with every FK) inside that hook. This is the exact seam where global identity is born, and it is non-trivial: the sign-up sequence isn't just "insert a user," it's an atomic post-signup bootstrap that in one transaction inserts the `user`, its 1:1 `hub`, a Personal-space `organization` (`is_personal: true`) with a default `team`, seeds the caller as a human `Actor` with the Owner role, and seeds the four system roles (owner/admin/member/guest) at the org root. If any of that isn't transactional, you get half-provisioned accounts — a user with no Hub, or an org with no Owner — which is why the engineering plan treats this as one bootstrap unit rather than a chain of independent writes.

Google and GitHub arrive through core `socialProviders`, and Linear arrives through `genericOAuth()` (it isn't a built-in, so `@docket/auth` hard-codes its `authorize`/`token`/`userInfo` URLs and works around Linear's comma-joined-scope quirk and `viewer`-GraphQL identity resolution). But the critical framing is that _none of these create a second account_. They all _link_ into the one global `User` via `account.accountLinking.trustedProviders`, which the plan explicitly flags as a security boundary to keep minimal — a too-permissive trusted-provider list lets an attacker who controls a matching email at some provider silently merge into an existing account. Linear in particular is deliberately account-_linking_ rather than a login on its own footing, because its real job is to be the credential the data-migration connector reuses (login asks for `read`; the migration flow steps up to `read,write,issues:create`).

The single most important invariant in this whole topology is **identity ≠ membership**, modeled GitHub-style. The `User` is a global account; membership in an organization is a _separate_ `Actor(kind=human)` row carrying the folded `user_id` + `role_id`, scoped by `organization_id`. One User fans out to N human Actors across N orgs, and owns exactly one Hub (the personal cross-org cockpit). The consequence that justifies the indirection: a `User` _survives at zero memberships_. When an enterprise IdP deprovisions someone over SCIM, what gets removed is their `Actor` membership in that tenant — the global `User`, their passkey, their linked Google/GitHub accounts, and their personal Hub and Personal-space org all persist. If identity and membership were the same record, SCIM deprovisioning would nuke the person's entire Docket existence including orgs they personally own; by separating them, deprovisioning is a clean, tenant-local revocation. This is also why `organization_id` is _never_ read from a request body anywhere in the system — membership (the Actor) is resolved from the verified principal against the path/context, so losing membership simply means the resolution returns nothing.

Enterprise SSO and SCIM round out the inbound surface but with a deliberately bounded scope. SSO is `sso()` shipping both OIDC and SAML 2.0 with Docket acting strictly as the _Service Provider_ — Docket consumes assertions, it is not the enterprise's IdP. SCIM is `scim()` covering **Users only — no Groups**. That Groups gap is a real, called-out limitation, not an oversight: SCIM-provisioned users land as global Users and then as Actors, but there is no automatic IdP-group → Docket-`Team` synchronization. The sanctioned workaround is to map IdP groups via _SAML attributes at login time_ rather than via the SCIM Groups endpoint, so team placement is driven off assertion attributes on each authentication instead of a standing provisioning channel. Per the RECONCILIATION tie-breaker and the MVP scope cut, SSO/SCIM (and DENY grants, and the full capability grid) are explicit _fast-follows_ gated at the feature fan-out, not foundation work — they ride on the frozen identity seam rather than reshaping it, which is exactly what the identity≠membership separation buys.

On the outbound side, the same Better Auth instance becomes the authorization server through the `oidcProvider()` + `mcp()` plugin pair, persisting to `oauthApplication` / `oauthAccessToken` / `oauthConsent`. An MCP client (Claude, the Athena planner, Codex, any third party) discovers the AS via Protected Resource Metadata (RFC 9728) at `/.well-known/oauth-protected-resource[/mcp]`, registers — CIMD client-id-metadata-documents as the primary path with DCR `/register` as a MAY fallback — and runs PKCE/S256 authorization carrying `resource=<RS URI>` (RFC 8707). The token it gets back is **audience-bound** (`aud = https://api.docket.app/mcp`) and short-lived (15-minute access tokens) with flat global scopes (`work:read`, `work:write`, `agents:run`, `connectors:link`). The `/mcp` resource server then enforces _two_ layers on every call, both required: a coarse scope gate, and the same `sub → User → Actor(user, org) → Grant` cascade (`canActor()`) that the REST handlers use — so possessing a valid scoped token is necessary but never sufficient to touch a given org's data, and the org is taken from the call's own `docket://{slug}/…` addressing, never from anything the client asserts. It must validate Origin, confirm `iss` is the Docket AS, reject any `aud` mismatch with a 401, and crucially must _never_ pass the client's MCP token downstream to GitHub/Drive/Linear (connectors use their own separately-issued Integration credentials). One pinned caveat: this is all on Better Auth 1.6.14, and the MCP-phase work must verify the version actually emits `client_id_metadata_document_supported`, honors the RFC 8707 `resource→aud` stamping, and surfaces `getMcpSession().scopes` — if any is missing, a thin resource-server shim fills the gap rather than the design changing.

One `betterAuth()` instance on `apps/api` (Hono) plays **two roles at once**: it
is a _relying party_ that lets people sign in, and it is an _OAuth 2.1 / OIDC
authorization server_ that issues tokens to MCP clients. Everything resolves to
**one global `User`** (GitHub-style: identity ≠ org membership).

### (a) Docket as Relying Party / Service Provider — sign-in IN

```
           INBOUND IDENTITY  —  humans authenticate INTO Docket
┌─ Sign-in methods (all LINK to one account) ──────────────────────────────────┐
│ Passkey (PRIMARY)  @better-auth/passkey · registers before a session exists  │
│ Google · GitHub    core socialProviders + accountLinking.trustedProviders    │
│ Linear             genericOAuth() — account-LINKING, not a new account       │
│ Enterprise SSO     sso() OIDC + SAML 2.0 (Docket = SP)                       │
│ Enterprise SCIM    scim() Users-only (map IdP groups → Team via SAML attrs)  │
└──────────────────────────────────────────────────────────────────────────────┘
                                        ▼
┌─ Better Auth @ apps/api  ·  /api/auth/*  (same-origin → first-party cookies) ┐
│ account-linking collapses every credential into ONE GLOBAL USER              │
│ passkey · account(google|github|linear) · sso   →   user.id (text ULID)      │
└──────────────────────────────────────────────────────────────────────────────┘
                                        ▼
┌─ Identity model  (identity ≠ membership) ────────────────────────────────────┐
│ user ─1:1─ hub ─owns─► Personal space                                        │
│ user ─1:N─ actor(kind=human) ─N:1─ organization                              │
│ User PERSISTS at zero memberships / after SCIM deprovisioning                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### (b) Docket as OAuth 2.1 / OIDC Provider — tokens OUT (remote MCP)

```
  MCP Client (Claude · Athena planner · Codex · 3rd-party)
        │ 1. GET /.well-known/oauth-protected-resource[/mcp]  (PRM, RFC 9728)
        │ 2. discover AS, register: CIMD primary │ DCR fallback (MAY)
        │ 3. PKCE/S256 authorize + consent, resource=<RS URI>  (RFC 8707)
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  AUTHORIZATION SERVER = Better Auth  ·  /api/auth/*                       │
│  plugins: oidcProvider()  +  mcp()                                        │
│  tables: oauthApplication / oauthAccessToken / oauthConsent               │
│  mints AUDIENCE-BOUND token: aud = https://api.docket.app/mcp             │
│  scopes (flat/global): work:read · work:write · agents:run ·              │
│                        connectors:link        (15-min access token)       │
└─────────────────────────────────────┴─────────────────────────────────────┘
                       Bearer <token> │  Streamable HTTP (POST + GET-SSE)
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  RESOURCE SERVER = /mcp endpoint  ·  apps/api (Hono)                      │
│  withMcpAuth → getMcpSession() → { userId, scopes, clientId }             │
│   MUST: validate Origin · iss=Docket AS · aud == RS URI (reject           │
│         mismatch 401) · NO token passthrough to GitHub/Drive/Linear       │
│  ┌────────────────── two-layer authz (BOTH required) ──────────────────┐  │
│  │ 1) SCOPE gate  (coarse: capability class)                           │  │
│  │ 2) sub → User → Actor(user,org) → Grant cascade  canActor()         │  │
│  │    org = call argument (docket://{slug}/…), never client-set        │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

### Sequence — passkey-first sign-up → mint User + Hub + Personal space

```
 Browser        apps/web        Better Auth (/api/auth)       @docket/db
   │  visit /sign-up  │                  │                        │
   │─────────────────►│  begin passkey   │                        │
   │                  │─────────────────►│ options (no session    │
   │  WebAuthn create │                  │  yet: requireSession   │
   │◄─────────────────┼──────────────────  =false, resolveUser)   │
   │  attestation     │                  │                        │
   │─────────────────►│  verify          │                        │
   │                  │─────────────────►│ INSERT user (ULID) ───►│
   │                  │                  │ INSERT passkey ───────►│
   │                  │                  │                        │
   │                  │   post-signup hook (atomic bootstrap):    │
   │                  │   • INSERT hub (1:1 user) ───────────────►│
   │                  │   • INSERT organization{is_personal:true} │
   │                  │       + default team ─────────────────────►│
   │                  │   • seed Actor(kind=human) as Owner ──────►│
   │                  │   • seed 4 system roles (owner/admin/      │
   │                  │       member/guest) at org root ──────────►│
   │                  │   first-party session cookie set          │
   │◄─────────────────┼──────────────────│                        │
   │  → Hub / Today (now signed in)      │                        │
```

These three views are one identity plane: diagram (a) authenticates a person
into a single global `User` (passkey-primary, with Google/GitHub/Linear/SSO all
_account-linked_ to that one record and SCIM provisioning Users only); diagram
(b) turns the same Better Auth instance into the Authorization Server that issues
audience-bound, scoped tokens which the `/mcp` Resource Server validates and then
re-authorizes per-org via `canActor`; and the sequence shows the first sign-up
atomically minting the `User`, its 1:1 `Hub`, and a Personal-space org (with the
user seeded as Owner and the four system roles) in one transaction.

## MCP Server Architecture

The central decision here is that Docket exposes its work layer to agents as an OAuth 2.1 **Resource Server**, not as a bespoke API key surface or a server that mints its own credentials. The `/mcp` endpoint in `apps/api` validates bearer tokens; the _issuing_ of those tokens belongs entirely to Better Auth mounted at `/api/auth/*` in the same deploy, acting as the **Authorization Server** through its `oidcProvider()` + `mcp()` plugins. This split is what makes "humans and agents are interchangeable Actors" tractable: the AS already runs PKCE/S256, hosts the consent screen, and owns the `oauthApplication`/`oauthAccessToken`/`oauthConsent` tables for first-party apps, so reusing it for MCP means agents authenticate through the same identity machinery as a browser session rather than a parallel auth path. We deliberately keep both plugins rather than `mcp()` alone, because Docket is also a general OIDC provider for its own Next apps; `mcp()` layers the MCP discovery helpers (`oAuthProtectedResourceMetadata`, `oAuthDiscoveryMetadata`, `withMcpAuth`, `getMcpSession`) on top of that foundation. Discovery is served from the RS itself — PRM per RFC 9728 at both `/.well-known/oauth-protected-resource` and the `/mcp` sub-path form, AS metadata per RFC 8414 — and a client that doesn't see `code_challenge_methods_supported: ["S256"]` will refuse to proceed, so that field is load-bearing, not decorative.

The transport is a single Streamable-HTTP endpoint per the 2025-11-25 spec, handling `POST` for JSON-RPC (which may upgrade to SSE) and `GET` for the server→client SSE stream. We use the official `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport` rather than hand-rolling SSE, sessions, and resumability — the deprecated two-endpoint HTTP+SSE transport is forbidden outright. The session-store question is where the spec and the tie-breaker diverge, and the tie-breaker wins: `mcp-surface.md` proposes Redis with `Last-Event-ID` resumability, but RECONCILIATION pins v1 to Postgres (the `idempotency_key` table, 24h TTL) plus plain SSE for live session streaming — one mechanism, no Redis — with the Redis-backed resumable store and a long-lived Fluid Compute host deferred to the MCP phase. Two MUST-level guards run before any auth work: an `Origin` allowlist to defeat DNS-rebinding, and rejection of unknown `MCP-Protocol-Version` headers; CORS is registered _before_ the Better Auth handler so that `Authorization`, `WWW-Authenticate`, and `Mcp-Session-Id` are exposed correctly.

Audience binding (RFC 8707) and the no-token-passthrough rule are the two properties that keep a multi-tenant RS from becoming a confused deputy. Every token must carry `aud` equal to the canonical RS URI (`https://api.docket.app/mcp`, per-env), and a mismatch is a hard 401 — this prevents a token a client obtained for some _other_ resource from being replayed against Docket. Symmetrically, the RS must never accept tokens minted for GitHub, Drive, or Linear, and must never forward the inbound client token to those downstream systems. When `link_external` or `start_connector_link` needs to reach a provider, it resolves the org's own **Integration credentials** (`Integration.connection.credentials_ref`) rather than the caller's token. There is a real open risk recorded here: it is not yet confirmed that Better Auth 1.6.14 stamps `aud` from the RFC 8707 `resource` parameter, emits `client_id_metadata_document_supported`, and surfaces `getMcpSession().scopes`. If any of those is absent we fall back to issuer-plus-client binding with an explicit resource allowlist and a thin CIMD shim in the RS — so this section's correctness is contingent on a verification step, not a finished fact.

The tool/resource split maps cleanly onto the read/write distinction. **Tools are mutations** — `create_task`, `move_task`, `set_task_assignee`, `post_update`, `link_external`, `trigger_agent_session`, `approve_action`, and the rest — each authored with Zod input _and_ output schemas in `@docket/types`, converted to JSON Schema 2020-12, and carrying explicit `ToolAnnotations` (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`) rather than relying on the SDK's defaults, which default `destructiveHint` to true. Closed-world tools touching only Docket's own DB set `openWorldHint: false`; the two that reach external systems — `link_external` and `trigger_agent_session` — set it true. **Resources are addressable-by-URI reads** under the `docket://{org}/{type}/{id}` scheme, returning Zod-validated read DTOs as JSON. The one nuance worth internalizing is that two _read_ operations, `run_view` and `search`, are exposed as tools rather than resources precisely because they take rich query arguments that don't fit a URI; they keep `readOnlyHint: true` and need only `work:read`. A subtle ID-primitive detail from RECONCILIATION applies here: although the spec's draft schemas use `z.string().uuid()`, the canonical decision is ULID `text` IDs repo-wide, so MCP tool schemas must consume the shared branded `Id` from `@docket/types` and _not_ assert UUID shape — the addressing differs (`docket://{slug}` vs REST `/v1/orgs/:orgId`) but the id primitive is identical.

Authorization is deliberately two-layered, and conflating the layers is the most likely implementation mistake. The token's scope — one of the four flat, _global_ scopes `work:read`, `work:write`, `agents:run`, `connectors:link` — gates only the _capability class_; it is necessary but never sufficient. Every call additionally resolves the caller's `Actor` in the target organization and evaluates the granular `Grant` cascade (`view`/`comment`/`contribute`/`assign`/`manage`, cascading down containment and overridable lower). A token bearing `work:write` still earns a 403 if the principal lacks `contribute` on that specific task. Scopes are global rather than org-qualified (`work:write:org_<id>`) on purpose: the product model is one global `User` with org access via `Actor` membership, so per-org scopes would bloat the consent screen and force re-consent on every new membership — instead the org is a _call argument_ (the `org` slug), authorized at execution time. Crucially, org and user context are derived **only** from the verified token's `sub` (→ `User`, then the human `Actor` row for `(user_id, organization_id)`); nothing is ever read from a client-asserted org or user field, and the `docket://` URI's embedded slug is used for addressing but never trusted for access. This is also the mechanism behind read-to-write step-up: an agent that started read-only hits a write tool, gets a 403 with an `insufficient_scope` `WWW-Authenticate` challenge naming the needed scope, runs step-up authorization, and re-calls — and to avoid leaking entity existence to unauthorized callers, a missing grant on a `resources/read` returns not-found (`-32002`), never forbidden.

Docket is a **remote MCP server**: the `/mcp` endpoint on `apps/api` (Hono) is an
OAuth 2.1 **Resource Server**, while Better Auth at `/api/auth/*` (same deploy) is
the **Authorization Server**. Tokens are audience-bound and never passed through.

```
   MCP CLIENT  (Claude · Athena planner · 3rd-party agent)
       │  Authorization: Bearer <token>   MCP-Protocol-Version: 2025-11-25
       ▼
┌────────────────────────────────────────────────────────────────────────┐
│  apps/api (Hono)  —  /mcp                          REMOTE MCP SERVER   │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ 1. TRANSPORT — Streamable HTTP (one endpoint, MCP 2025-11-25)  │    │
│  │   POST  ► JSON-RPC requests/notifications (may upgrade to SSE) │    │
│  │   GET   ► server→client SSE stream                             │    │
│  │   Mcp-Session-Id (stateful)  ·  Origin allowlist (DNS-rebind)  │    │
│  │   v1 session/event store = Postgres (idempotency_key table),   │    │
│  │   SSE for live; Redis store deferred (RECONCILIATION)          │    │
│  └───────────────────────────────┬────────────────────────────────┘    │
│                                  ▼                                     │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ 2. OAUTH 2.1 RESOURCE SERVER  (withMcpAuth · per request)      │    │
│  │   bearer→getMcpSession ► aud == RS URI (RFC 8707, audience     │    │
│  │   bound) ► iss == Docket AS ► scope ► sub→User→Actor→Grant     │    │
│  │   NO TOKEN PASSTHROUGH (connectors use Integration creds)      │    │
│  │   401/403 ► WWW-Authenticate (PRM ptr + step-up scope)         │    │
│  │   scopes: work:read · work:write · agents:run · connectors:link│    │
│  │ ┌──────────────────────┐        ┌─────────────────────────────┐│    │
│  │ │ /.well-known/        │        │ Better Auth  /api/auth/*    ││    │
│  │ │  oauth-protected-    │        │  OAUTH 2.1 AUTHZ SERVER     ││    │
│  │ │  resource[/mcp] PRM  │◄──────►│  oidcProvider() + mcp()     ││    │
│  │ │  (RFC 9728)          │  meta  │  PKCE/S256 · consent · DCR  ││    │
│  │ │ /.well-known/oauth-  │        │  CIMD (client_id doc) prim. ││    │
│  │ │  authorization-server│        │  DCR /register  fallback    ││    │
│  │ │  (RFC 8414)          │        │  issues aud-bound tokens    ││    │
│  │ └──────────────────────┘        └─────────────────────────────┘│    │
│  └───────────────────────────────┬────────────────────────────────┘    │
│                                  ▼                                     │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ 3. CAPABILITIES  (initialize · protocolVersion 2025-11-25)     │    │
│  ├───────────────┬───────────────┬───────────────┬────────────────┤    │
│  │ TOOLS         │ RESOURCES     │ UTILITIES     │ ELICITATION    │    │
│  │ (mutations +  │ + TEMPLATES   │               │                │    │
│  │  rich reads)  │ (reads)       │ pagination    │ form-mode      │    │
│  │ listChanged:T │ docket://     │  cursor/      │  (in-session   │    │
│  │               │  {org}/{type} │  nextCursor   │   prompts)     │    │
│  │ create_task   │  /{id}        │ progress      │ URL-mode ►     │    │
│  │ set_task_     │               │  (progress-   │  connector     │    │
│  │  assignee /   │ task project  │   Token)      │  OAuth via     │    │
│  │  _delegate    │ program       │ cancellation  │  start_        │    │
│  │ add_task_     │ initiative    │  (cancelled)  │  connector_    │    │
│  │  dependency   │ cycle team    │ logging       │  link →        │    │
│  │  (acyclic)    │ update        │  (message     │  authorize_url │    │
│  │ post_update   │ comment       │   info/warn/  │                │    │
│  │ create_       │ session*      │   error)      │ NO token       │    │
│  │  project/     │ agent view    │ ping          │  to provider   │    │
│  │  program/     │               │ completions   │                │    │
│  │  initiative   │ Hub literals: │  (arg auto-   │                │    │
│  │ link_external │  docket://hub │   complete)   │                │    │
│  │ trigger_      │  /today,      │ tasks (exp.,  │                │    │
│  │  agent_session│  /inbox,      │  flagged) for │                │    │
│  │ approve_action│  /portfolio   │  long runs    │                │    │
│  │ reject_action │               │               │                │    │
│  │ run_view      │ *subscribe:   │               │                │    │
│  │ search        │  session,task,│               │                │    │
│  │               │  hub inbox/   │               │                │    │
│  │               │  today        │               │                │    │
│  └───────────────┴───────────────┴───────────────┴────────────────┘    │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   ▼
        @docket/db (Drizzle · Neon Postgres) — service layer,
        scoped by verified principal + Grant cascade (two-layer authz)
```

The transport is a single Streamable-HTTP endpoint (`POST` + `GET`-SSE); every call
passes through the Resource Server's `withMcpAuth` chain — audience binding, issuer,
scope, then per-org `Actor`/`Grant` resolution — so a token scope is necessary but
never sufficient. Capabilities split into **tools** (mutations plus the rich-query
reads `run_view`/`search`), URI-addressable **resources/templates** under
`docket://{org}/{type}/{id}`, **utilities** (pagination, progress, cancellation,
logging, completions, experimental tasks), and **elicitation** — form-mode for
in-session prompts and URL-mode to hand off connector OAuth without passing any
Docket token downstream.

## Deployment Architecture (Vercel)

Docket follows 12-factor strictly: every deployable reads its configuration only from environment variables, and the _exact same_ topology runs in development and production, where the single permitted difference is values. There are four Vercel projects — `docket-mkt` (marketing, `docket.app`), `docket-web` (the product app, `app.docket.app`), `docket-admin` (operator back-office, `admin.docket.app`), and `docket-api` (the Hono work API that also mounts auth, the OIDC provider, and `/mcp`, at `api.docket.app`). Each project validates _only the variables it actually consumes_ through its own `@docket/env` composition (`env.web.ts`, `env.api.ts`, etc.), so the marketing app never carries Stripe secrets and the API never carries a `NEXT_PUBLIC_` publishable key. Dev parity is mechanical, not aspirational: there are no `DEV_`/`PROD_`-prefixed variants and no `if (NODE_ENV === 'development')` branching of _which_ service is wired — `apps/api/.env` and the Vercel prod env hold the same variable names, and only the resolved value flips (a `dev` Neon branch vs the `production` branch, `sk_test_…` vs `sk_live_…`, `localhost` vs the apex). The same `createEnv` runs at boot in all three places (dev, CI, prod) and fails identically on a missing or malformed var, which is what makes the parity guarantee enforceable rather than a convention.

The most consequential deployment decision is that `docket-web` serves auth on its own origin via a Vercel rewrite: `apps/web` rewrites `/api/*` to `docket-api`. The reconciliation file pins this — web and api are same-origin via rewrites specifically so the Better Auth session cookie stays first-party, which sidesteps SameSite/third-party-cookie breakage and the CORS-plus-credentials dance that splitting origins would force (CORS+credentials remains only the documented fallback). It also means the auth base URL _is_ the API origin: `BETTER_AUTH_URL` must equal `API_URL`, the OIDC issuer (`MCP_ISSUER_URL`) equals `API_URL`, and the MCP resource (`MCP_RESOURCE_URL`) is `${API_URL}/mcp`. Diverging these is the classic failure mode — a `BETTER_AUTH_URL` that doesn't match the mount produces `redirect_uri_mismatch` on every OAuth callback and breaks the RFC 8414/9728 discovery documents — so bootstrap _derives_ all of them from a single API-origin answer rather than collecting them independently.

The Neon layer is split deliberately into two connection strings because the two access patterns have incompatible requirements. `DATABASE_URL` is the pooled PgBouncer endpoint and is what the runtime uses for all SQL, including the Better Auth tables (single SQL owner in `@docket/db`); pooling is mandatory because Vercel's serverless/Fluid functions fan out to many short-lived connections that would otherwise exhaust Postgres backends. `DATABASE_URL_UNPOOLED` is the direct connection, and it exists solely so `drizzle-kit migrate` can run DDL — migrations must not go through the pooler, since PgBouncer in transaction-pooling mode doesn't reliably support the session-level state and advisory locks that schema changes need. Because the entire schema (work tables _and_ Better Auth tables) lives in `@docket/db`, a single `db:migrate` against the unpooled string materializes the whole database; bootstrap deliberately stops there and never seeds tenant data, since per-org roles are created at runtime on org creation.

Provisioning is the job of `scripts/bootstrap.ts` (`pnpm bootstrap`), an idempotent, interactive flow that turns the env contract into real cloud resources. It is built to _list before it creates_ and reuse on match (by Neon project name, Stripe `lookup_key`, or webhook URL), so re-running is safe; secrets like `BETTER_AUTH_SECRET` are generated once per target and never silently regenerated, because rotating that secret invalidates every live session. The flow walks: preflight (CLIs installed and authed), target selection (dev writes `apps/*/.env`, prod writes Vercel env), domain confirmation (from which it derives all the `*_URL`/`BETTER_AUTH_*`/`MCP_*` values), secret generation, Neon branch + connection-string capture + migrate, OAuth app setup (the provider consoles have no creation API, so bootstrap prints the _exact_ dev and prod redirect URIs — `…/api/auth/callback/google`, `…/api/auth/callback/github`, the generic-OAuth `…/api/auth/oauth2/callback/linear` — and collects ids/secrets via masked prompts), Stripe setup, then the Vercel `env add` per app/target, and finally a verification pass that re-runs `@docket/env` plus connection smoke checks. Prod secret values are piped to `vercel env add … --sensitive` over stdin rather than argv, so they never land in shell history or logs.

Stripe is where the data-lifecycle cron lives, and it reflects the engineering plan's split of responsibilities. The `@better-auth/stripe` plugin owns the billing subject (per-Organization, `referenceId = organization.id`), the subscription mirror table, and the core webhooks at `${API_URL}/api/auth/stripe/webhook`; webhook secrets are per-endpoint and per-mode (dev uses the `whsec_…` from `stripe listen --forward-to …/api/auth/stripe/webhook`, prod uses the registered endpoint's secret). What Stripe does _not_ do is delete data, so Docket builds the lifecycle itself on three `organization` columns — `lifecycle_state`, `export_ready_at`, `delete_after_at`. On a trial-end or payment-terminal transition the org moves to `export_window` with `delete_after_at = now + 14d` and an export artifact is generated; a Vercel Cron then hits `/lifecycle/sweep` to perform the actual deletion. That cron endpoint is guarded by `CRON_SECRET` sent as `Authorization: Bearer` (the same secret bootstrap generates and writes to Vercel), the sweep is idempotent, and reactivation cancels a pending deletion. Critically, the handler always reconciles against Stripe because webhooks are neither guaranteed nor ordered — the sweep treats Stripe as the source of truth rather than trusting that the right events arrived.

Secrets ownership falls out cleanly from the project split and is the property the diagram traces. `docket-api` is the sole holder of every server-only secret — `DATABASE_URL`/`DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET`, the OAuth client secrets, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, the agent credentials, and `CRON_SECRET` — none of which is ever bundled to a browser. The three Next apps carry only public, browser-exposed `NEXT_PUBLIC_*` values (`NEXT_PUBLIC_API_URL`, the per-app origin URLs, and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` on web only). The `@docket/env` slices encode this at the type level: server slices declare `server:` fields that env-core/env-nextjs refuse to expose client-side, while client vars must carry the `NEXT_PUBLIC_` prefix and be referenced _literally_ in `runtimeEnv` (Next inlines them at build, so destructuring `process.env` silently breaks them in the browser bundle). The net effect is a deliberately narrow runtime — Vercel plus Neon plus external SaaS reached over env-configured URLs, with no GCP/Cloud Run, no Redis-as-primary, and no vector store — and a deployment whose only moving part between environments is the value behind each name.

Docket is a 12-factor, env-var-only deploy: four Vercel projects (three Next.js 16 apps + one Hono API) in front of Neon serverless Postgres, wired to external services entirely through `@docket/env`-validated variables. `apps/web` rewrites `/api/*` to `apps/api` so auth cookies, the OIDC provider, and the `/mcp` endpoint stay same-origin. Dev mirrors prod: identical topology and validation, only values differ (dev Neon branch vs prod branch, `sk_test_` vs `sk_live_`).

```
┌─ VERCEL  ·  4 projects · 12-factor env-var-only deploy ──────────────────────┐
│ docket-mkt   marketing      docket.app                                       │
│ docket-web   product app    app.docket.app                                   │
│ docket-admin operator BO    admin.docket.app                                 │
│ docket-api   work API+auth+MCP   api.docket.app   (Hono 4.x)                 │
│ docket-web rewrites /api/* → docket-api  (same-origin · first-party cookies) │
│ Vercel Cron → Bearer CRON_SECRET → api /lifecycle/sweep                      │
└──────────────────────────────────────────────────────────────────────────────┘
                                        ▼
    DATABASE_URL (pooled, runtime) · DATABASE_URL_UNPOOLED (migrate)
┌─ NEON  ·  serverless Postgres ───────────────────────────────────────────────┐
│ branch: production  (prod target)      branch: dev  (dev mirrors prod)       │
│ pooled PgBouncer endpoint = runtime  ·  direct = drizzle-kit migrate         │
└──────────────────────────────────────────────────────────────────────────────┘
                                        ▼
    apps/api outbound — server-only secrets, per-mode values
┌─ EXTERNAL SERVICES ──────────────────────────────────────────────────────────┐
│ Stripe   billing per Organization · webhook /api/auth/stripe/webhook         │
│ OAuth    Google · GitHub · Linear   (login + linking + connector tokens)     │
│ Agents   Athena · Claude · Codex    (open Session + activity stream)         │
│ Sentry   NEXT_PUBLIC_SENTRY_DSN across all 4 projects                        │
└──────────────────────────────────────────────────────────────────────────────┘

┌─ pnpm bootstrap   (scripts/bootstrap.ts · idempotent) ───────────────────────┐
│ neonctl → branches + DATABASE_URL[_UNPOOLED] → drizzle migrate               │
│ stripe  → products/prices (lookup_key) + webhook secret                      │
│ OAuth   → prints exact redirect URIs → collect client id/secret              │
│ vercel env add (per app/target)   ·   dev → apps/*/.env                      │
│ └─ @docket/env (t3-oss) validates every var at boot, in dev AND prod         │
└──────────────────────────────────────────────────────────────────────────────┘
```

The diagram traces every secret to its owner: `apps/api` is the sole holder of server-only secrets (`DATABASE_URL`, `BETTER_AUTH_SECRET`, Stripe/OAuth/agent credentials, `CRON_SECRET`), while the three Next apps carry only `NEXT_PUBLIC_*` values. There is no GCP/Cloud Run, no native mobile, no Redis-as-primary, and no vector store — the entire runtime is Vercel + Neon plus external SaaS reached over env-configured URLs. `pnpm bootstrap` provisions Neon branches, Stripe products, OAuth redirect URIs, and Vercel env vars, then `@docket/env` (t3-oss) fail-fast validates the identical contract in dev and prod so the only difference between environments is values, never topology.

## Runtime & Lifecycle Flows

Three runtime stories exercise nearly every load-bearing decision in the system: an authorized read/write request from the browser, the delegation of work to an agent under a two-axis gate, and the org billing lifecycle that quietly governs whether either of the first two is allowed to run at all. They share one principle worth stating up front — there is exactly one authorization engine, `@docket/authz`'s `canActor`, and it is called identically from the Hono REST handlers, from `apps/web` Server Actions, and from the MCP tool layer. The rule set cannot drift between surfaces because there is only one surface; everything else is wiring that resolves a principal and hands `canActor` a triple of `(actor, capability, target)`.

The request path is deliberately same-origin. `apps/web` rewrites `/api/*` to `apps/api` at the Vercel edge so the Better Auth session cookie stays first-party — this is the reconciliation decision that lets us avoid the CORS-plus-credentials dance entirely, and it is also why the OIDC provider and `/mcp` live in the same `docket-api` deploy. Inside Hono the middleware order is load-bearing: CORS, then `sessionMiddleware` (which `getSession()`-resolves the global `User` or 401s), then `orgContextMiddleware`, which resolves the human `Actor` for `(user.id, :orgId)` from the path — never from the request body — and 404s if no membership row exists. Only after the org context is pinned do the Zod input validator and `capabilityGuard` run. `capabilityGuard(required, locate)` is the single hook into `canActor`: it walks the containment chain root→self (`org → team/program → project → task`, ≤5 hops resolved via the denormalized `ancestor_path` or a recursive CTE rather than five round-trips), seeds the actor's role org-base, then replaces with the allow-max grant at each more-specific level and falls back to visibility for `view` only. Two failure modes are intentional and easy to get wrong: the system is deny-by-default (no applicable grant and not visibility-public means deny, so guests see nothing until explicitly granted), and an actor lacking even `view` gets a 404, not a 403, so existence is never leaked. On allow, the handler queries Neon through Drizzle (pooled PgBouncer endpoint at runtime, text ULIDs per the reconciliation, not Postgres `uuid`) and returns a Zod-validated payload that the client infers end-to-end through `hc<AppType>`.

Delegating a task to an agent reuses that exact authorization path and then layers a second, orthogonal gate on top. An Agent is simply an `Actor{kind:'agent', role_id:null}` — it carries no role base capability and no visibility-default access, so it can see and touch nothing until it holds explicit Actor-grants, which is what "agents start read-only" means concretely. Triggering a session (via `POST /v1/orgs/:orgId/sessions` or the `trigger_agent_session` MCP tool) opens a Docket-hosted `AgentSession` that transitions `pending → running`; Docket owns the session record and its `session_activity` stream but deliberately stores no compute, cost, or telemetry, because the provider (Athena, Claude, Codex) owns the run behind an `external_run_ref`. The activity stream — `thought → action → response → elicitation → error` — is delivered live over SSE at `GET …/sessions/:id/stream`, the single live-transport mechanism the reconciliation pins for v1.

The two-axis gate is the heart of this flow and the place implementers most often conflate two things that must stay separate. Every `action` (a write the agent attempts) runs through `gateAgentWrite`, which checks the **capability axis first**: `canActor` on the _agent's_ Actor id. If the agent lacks the required capability the outcome is `needs_grant` — not a rejection but a grant-on-request, where a `manage`-holder approves and a new Actor-grant is written, after which the agent's writes pass normally. Only once capability is satisfied does the **approval axis** apply, driven by the agent's `approval_policy`: `autonomous` applies the write directly, `suggest` records a proposal and never auto-applies, and `act_with_approval` creates a `proposed` action and routes it for sign-off. These axes are genuinely independent — an `autonomous` agent still gets blocked if it lacks `contribute`, and a `contribute`-holding agent can still be forced to merely `suggest`. Approver routing resolves in order: an explicit per-Org/Team `approval_routing` override, else the task's assigner or delegator (the Actor who set `assignee_id`/`delegate_id` at this agent), else the agent's `accountable_owner_id`, else org Owners — and a routed approver is filtered out unless they additionally hold `assign` on the target, so routing can never hand approval power to someone without authority over the resource. A pending approval surfaces in two places at once: as the `session_activity` row in the Session view, and mirrored to the approver's cross-org Hub Inbox as a `Notification{type:'approval'}` they can resolve with one tap. On approval the executor re-checks `canActor` for the agent at apply time (grants may have changed), applies the write, and records an `audit_event` with `actor_id = the agent` and `initiator_id = the human` — the literal encoding of "the agent did it, on behalf of you," and the distinction that keeps principal separate from initiator in the audit trail.

The third story runs on a much slower clock and gates the other two. The `organization.lifecycle_state` column (`trialing | active | past_due | export_window | pending_deletion | deleted`) is a state machine that Docket owns, layered on top of what the `@better-auth/stripe` plugin gives us — the plugin manages the customer, the per-org `subscription` table keyed by `reference_id = organization.id`, and the four core webhooks, but it has no concept of an export window or a grace-period delete, so we build that. The unhappy path is the interesting one: a `trialing` org whose 14-day trial ends without payment, or an `active` org whose `invoice.payment_failed` drives it through `past_due` to a terminal failure (`subscription.deleted`/unpaid), lands in `export_window`. Entering that state sets `exportReadyAt`, generates a downloadable export of the org's work layer, emails the link, and stamps `deleteAfterAt = now + 14d`. Reactivation — paying or restoring — at any pre-deletion stage returns the org to `active` and cancels the pending deletion, which is why the transitions can't be naive.

What actually performs the deletion is a Vercel Cron call to `/lifecycle/sweep`, guarded by a `Bearer CRON_SECRET`, and two of its properties are non-negotiable. It must be **idempotent**, because Stripe webhooks are neither guaranteed nor ordered — the sweep reconciles each org's `lifecycle_state` against the live Stripe subscription state rather than trusting whatever webhook last arrived, so a dropped or out-of-order `customer.subscription.updated` cannot strand an org in a wrong state or double-delete one. And it must **skip any org under an active `LifecycleHold`**, the operator-plane escape hatch (e.g. a legal hold) that pauses the trial→export→delete pipeline without touching the billing state. When the sweep does delete, it relies on `ON DELETE CASCADE` from `organization` through every `organization_id` FK, plus an application-level purge job for the artifacts that don't live in our Postgres — the Stripe customer and any external connector state. Note finally that this billing gate runs _before_ `canActor`: a frozen org is a 402/403 concern handled upstream of the permission engine, never mixed into it, so the authorization model stays purely about capability and visibility while lifecycle stays purely about whether the tenant is allowed to transact at all.

Three runtime paths through Docket: a same-origin authorized request, an
agent session with its two-axis (capability + approval) gate, and the
billing data-lifecycle state machine on the `organization` row.

### 1. Request + Permission Flow (same-origin → typed RPC)

```
 Browser (apps/web · Next.js 16, hc<AppType>)
   │  fetch("/api/...")            same-origin, first-party cookie
   ▼
 ┌───────────────────────────────────────────────────────────┐
 │  VERCEL  rewrite  /api/*  ──►  apps/api (Hono)             │
 └───────────────────────────────────────────────────────────┘
   │
   ▼  apps/api (Hono 4.x)  ·  middleware chain (in order)
 ┌───────────────────────────────────────────────────────────┐
 │ 1 CORS ─► 2 sessionMiddleware ─► 3 orgContextMiddleware    │
 │   getSession()      resolve Actor for (user.id, :orgId)    │
 │   401 if none       404 if no membership · derive orgId    │
 │                     ▼                  (NEVER from body)    │
 │ 4 validator(Zod in) ─► 5 capabilityGuard(required, locate) │
 └───────────────────────────────────────────────────────────┘
                                │
                                ▼  @docket/authz · canActor(actor,cap,target)
   ┌─────────────────────────────────────────────────────────┐
   │ ancestorChain root→self:  org ─► team/program ─► project │
   │                                              ─► project ─► task
   │ GRANT CASCADE (cascade down, override lower):            │
   │   role org-base ─► replace at each level w/ allow-max    │
   │   ─► subtract DENY ─► fall back to visibility for `view`  │
   │   guests = grant-only · deny-by-default · 404 hides exist │
   └─────────────────────────────────────────────────────────┘
        │ allow                              │ deny
        ▼                                    ▼
   handler ─► service fn ─► Drizzle      403 (can view)
        │                      │          404 (cannot view)
        │                      ▼
        │              ┌───────────────┐
        │              │ NEON Postgres │  (serverless, text ULIDs)
        │              └───────────────┘
        ▼  ok(c, OutSchema, data) — Zod OUT
   typed RPC response  ◄── hc<AppType> infers Page<TaskOut> on client
```

_The browser hits the API same-origin via a Vercel rewrite so the Better
Auth cookie stays first-party. Hono runs CORS → session → org-context →
input validation → `capabilityGuard`, which delegates to the shared
`@docket/authz` `canActor` engine: it walks the containment chain and
resolves the grant cascade (role base, then per-level allow/deny override,
then visibility fallback for `view`). On allow, the handler queries Neon
through Drizzle and returns a Zod-validated payload the client infers via
`hc<AppType>`._

**Client data layer.** On the browser side, every read and write goes through a
single typed wrapper around TanStack Query v5 (`apps/web/src/lib/query.ts`):
typed query definitions (`apiQueryOptions`) over org-scoped hierarchical keys,
definition-only `useApiQuery` / `useApiListQuery` / `useLiveApiQuery` read hooks,
and `useApiMutation` with optimistic patch + rollback + prefix invalidation. The
goal is an instant-feeling, cache-warm UI with no hand-rolled `useEffect` fetches.
See **`docs/engineering/specs/data-layer.md`** for the full standard.

### 2. Agent Session + Approval Gate (two-axis)

```
 Human (assigner/delegator)  POST /v1/orgs/:orgId/sessions  trigger_agent_session
   │  trigger ∈ assignment | delegation | mention      (org:contribute + agent grants)
   ▼
 ┌───────────────────────────────────────────────────────────┐
 │  AgentSession opens   status: pending ─► running           │
 │  (Docket hosts the session; provider owns compute/cost)    │
 └───────────────────────────────────────────────────────────┘
   │
   ▼  Provider runs  (Athena / Claude / Codex)  ── external_run_ref
 ┌───────────────────────────────────────────────────────────┐
 │  session_activity stream  (SSE: GET …/sessions/:id/stream) │
 │   thought ─► action ─► response ─► elicitation ─► error     │
 └───────────────────────────────────────────────────────────┘
   │  each `action` (a write) ─► gateAgentWrite()
   ▼
 ╔═══════════════ TWO-AXIS GATE ═══════════════╗
 ║ AXIS 1  capability:  canActor(agent, cap)   ║
 ║   ✗ ─► needs_grant  (grant-on-request)      ║
 ║   ✓ ▼                                        ║
 ║ AXIS 2  approval_policy:                     ║
 ║   autonomous ───────────────► apply directly║
 ║   suggest ──────────────────► propose only  ║
 ║   act_with_approval ─► awaiting_approval ────╫─┐
 ╚═════════════════════════════════════════════╝ │
                                                  ▼  resolveApprovers()
                  ┌──────────────────────────────────────────────┐
                  │ approver = task assigner/delegator            │
                  │   ▸ Org/Team approval_routing override        │
                  │   ▸ else accountable_owner ▸ else org Owners  │
                  │   (must also hold `assign` on target)         │
                  └──────────────────────────────────────────────┘
                       │  Notification{type:approval} ─► Hub Inbox
        ┌──────────────┴───────────────┐
        ▼ approve                       ▼ reject
  re-check canActor(agent)         status: rejected
  proposed ─► approved ─► applied   (no write)
        │   in-session OR one-tap from Inbox
        ▼
  write applied · audit_event{ actor_id=agent, initiator_id=human }
  "the agent did it, on behalf of you"
```

_Triggering a task delegates to an agent, opening a Docket-hosted
`AgentSession` (the provider owns compute). The provider's run emits a
live `session_activity` stream over SSE. Every write passes a two-axis
gate: capability (`canActor` on the agent Actor) then `approval_policy` —
`autonomous` applies, `suggest` only proposes, and `act_with_approval`
routes a `proposed` action to the assigner/delegator (configurable via
`approval_routing`) who approves in-session or from the Hub Inbox; on
approval the write applies and is audited to the agent with the human as
`initiator_id`._

### 3. Organization Data-Lifecycle State Machine

```
                       Stripe webhooks (onEvent) ── reconciled vs Stripe
                       (webhooks not guaranteed/ordered)
                                │
        POST /orgs              ▼
   (creator=Owner) ┌────────────┐  checkout.session.completed
   ───────────────►│  trialing  │──────────────────────────┐
   14-day trial    └─────┬──────┘                           ▼
                         │ trial_will_end / ends         ┌────────┐
                         │ no payment                    │ active │◄──┐
                         ▼                               └───┬────┘   │
                  ┌────────────┐  invoice.payment_failed     │        │
                  │  past_due  │◄────────────────────────────┘        │
                  └─────┬──────┘                                       │
                        │ trial/payment terminal                      │
                        │ (subscription.deleted / unpaid)             │
                        ▼                                             │
                ┌──────────────────┐  set deleteAfterAt = now + 14d   │
                │  export_window   │  exportReadyAt set;              │
                │  (export emailed)│  download work-layer export      │
                └─────────┬────────┘                                  │
                          │  REACTIVATION (pay / restore)             │
                          │  ──────────────────────────────────────► │ cancels
                          │                                  pending  │ deletion
                          ▼  deleteAfterAt reached                    │
                ┌────────────────────┐  REACTIVATION ────────────────┘
                │  pending_deletion  │
                └─────────┬──────────┘
                          │  idempotent CRON sweep (CRON_SECRET-guarded)
                          │  SKIPS orgs with active lifecycle_hold
                          ▼  ON DELETE CASCADE + Stripe/external purge
                ┌────────────┐
                │  deleted   │   (terminal)
                └────────────┘
```

_The `organization.lifecycle_state` column drives billing lifecycle:
trial → active on payment; a failed payment or trial expiry moves to
`past_due`, then on terminal failure to `export_window` (which sets
`deleteAfterAt = now + 14d` and emails a work-layer export). An idempotent
`CRON_SECRET`-guarded sweep advances `pending_deletion` to `deleted`
(`ON DELETE CASCADE` plus a Stripe/external purge), skipping any org under
a `lifecycle_hold`. Paying or restoring at any pre-deletion stage
reactivates back to `active` and cancels the pending deletion; all
transitions reconcile against Stripe since webhooks aren't ordered._

---

_See also: [`docket-engineering-plan.md`](./docket-engineering-plan.md) · [`specs/`](./specs/) · [`../core/mvp-plan.md`](../core/mvp-plan.md)._

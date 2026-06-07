# Docket — Build Sequence & First Vertical Slice (Implementation Spec)

> Scope of this spec: (1) the **dependency-ordered build plan** from empty Turborepo to first runnable product, stating what is strictly sequential vs. what fans out in parallel; and (2) the **exact first vertical slice** that proves the stack end-to-end — passkey sign-in → create Organization (+ default Team) → create Project → create Task → see it in a grouped List view — naming every package, file, API route, DB table, and UI component it touches, plus the Playwright flow that verifies it.
>
> Source of truth: `docs/core/mvp-plan.md` and `docs/engineering/docket-engineering-plan.md`. This spec does not contradict them; it sequences them. Names (`@docket/*`, table names, entity fields) match the engineering plan §1 and §5 exactly.
>
> **Greenfield note.** The existing tree (`@athena/*`, Better Auth 1.4, Next 15, old `pending/in_progress/completed/cancelled` task model, hand-rolled `fetch` `api-client.ts`) is reference-only per engineering plan §0.1. The build sequence below scaffolds a fresh `@docket/*` workspace. Do **not** reuse `apps/api/src/lib/auth.ts`, `apps/web/src/lib/api-client.ts`, or the old Drizzle schema verbatim — they encode a superseded model. They are useful as shape references only.

---

## Part 0 — Verified library facts that drive this plan

Confirmed against current docs (ctx7, 2026-06-05). These are load-bearing for the sequence and slice:

- **Better Auth 1.6.14 passkey-first** is real and current: `passkey({ registration: { requireSession: false, resolveUser: async ({ ctx, context }) => {...} } })` lets a passkey be registered **before** a session exists — this is what makes "sign up with a passkey, no password" work as the first step of the slice.
- **Hono mount** for Better Auth: `app.on(["POST","GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))`. CORS middleware must be registered **before** the auth route. (Matches engineering plan §2 "CORS registered first".)
- **Session in Hono context**: `await auth.api.getSession({ headers: c.req.raw.headers })` in an `app.use("*", …)` middleware, with typed `Variables: { user, session }` via `auth.$Infer.Session`.
- **Hono RPC**: type inference **only** survives if routes are **method-chained** and you export `type AppType = typeof routes`. In a monorepo, **both** the api and consumer `tsconfig.json` need `"strict": true`. Client is `hc<AppType>(baseURL)`. This is why engineering plan §1 mandates **compiling** `apps/api` to `dist` + splitting the router across files — RPC inference otherwise cripples `tsserver`.
- **Better Auth schema generation**: `npx @better-auth/cli generate` emits the Drizzle schema; it must be generated **into `@docket/db`** (single SQL owner per §2), then applied with `drizzle-kit migrate`.
- **Next.js 16** (latest stable line confirmed: 16.2.x) + React 19 + React Compiler. App Router, Server Components by default.
- **Org/Actor are custom domain tables, NOT the Better Auth `organization` plugin.** Engineering plan §5 defines a custom `Actor` that "folds in membership (`user_id` + `role`) — no separate Membership table." We honor that. (See Open Issues for the explicit trade-off.)

---

## Part 1 — Dependency-Ordered Build Sequence

### 1.1 The hard rule: three things must be frozen before features fan out

Everything downstream depends on a stable contract at three seams. **These three must be sequential and land in this order:**

1. **DB schema** (`@docket/db`) — every API route, permission check, and UI type traces back to a table.
2. **API contract** (`apps/api` exported `AppType` + `@docket/types` Zod schemas) — every UI data call and every Playwright assertion traces back to a route signature.
3. **Design system shell** (`@docket/ui` + app shell layout) — every screen composes from it.

Once **schema + API contract + design system are frozen**, feature work (Programs, Initiatives, Cycles, Triage, Agents/Sessions, Portfolio, Billing, MCP) can fan out in parallel because each touches new tables/routes/components without re-cutting the seams. **Before** they are frozen, parallelism creates churn (a renamed column re-types the whole RPC client; a re-chained router breaks every consumer).

### 1.2 The sequence (Phase 0 → Phase 6)

Each phase lists: **must-be-sequential** dependencies and the **exit gate** (a concrete, checkable condition). The first runnable product = end of Phase 5 (the vertical slice green in CI).

```
P0 Repo skeleton ─► P1 @docket/env ─► P2 @docket/db ─► P3 @docket/auth ─►
P4 apps/api (RPC + auth mount) ─► P4.5 permissions core ─► P5 @docket/ui shell + slice screens
                                                                   │
                                                                   ▼  (seams frozen)
                                                          P6 features fan out ∥∥∥
```

---

#### Phase 0 — Turborepo skeleton _(sequential; nothing else can start)_

- **Do:** Fresh pnpm + Turborepo 2.9.x workspace. `pnpm-workspace.yaml` → `apps/*`, `packages/*`. Root `turbo.json` using the **2.x `tasks` key** (never `pipeline`), with `globalEnv`/`env` declared so cache invalidates on env value changes, **strict env mode** on, and **`.env` per-app** (not repo root).
- **Create the empty workspace members** (folders + `package.json` with `@docket/*` names, no logic yet) so the dependency graph is declarable:
  `apps/web`, `apps/marketing`, `apps/admin`, `apps/api`, `packages/db`, `packages/auth`, `packages/ui`, `packages/types`, `packages/env`, `packages/test-utils`, `tooling/{tsconfig,eslint-config,tailwind-config}`.
- **Compilation policy wired now** (engineering plan §1, mandatory): `@docket/db`, `@docket/auth`, `apps/api` are **compiled** (`tsc → dist`, with `"main"`/`"types"` pointing at `dist`). `@docket/ui`, `@docket/types`, `@docket/env` are **JIT** (raw TS, consumed via `transpilePackages`). Hono pinned to one identical version everywhere.
- **Exit gate:** `pnpm install` clean; `pnpm turbo run build` succeeds across empty packages; `turbo.json` validates against schema 2.x.

#### Phase 1 — `@docket/env` _(sequential; everything imports it)_

- **Do:** `@t3-oss/env-core` validators. One **shared base contract** + per-deployable extension (engineering plan §1: "Validate every variable through `@docket/env` so each deployable inherits exactly the vars it needs"). Server vars: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, OAuth client id/secret pairs (`GOOGLE_*`, `GITHUB_*`, `LINEAR_*`). Client vars: `NEXT_PUBLIC_API_URL`. Dev mirrors prod: same schema both environments, only values differ (Hard Constraint 3).
- **Exit gate:** importing `@docket/env` with a missing required var throws at boot in dev (proving the 12-factor contract is enforced, not advisory).

#### Phase 2 — `@docket/db` _(sequential; the single SQL owner)_

- **Do:** Drizzle (latest) + Postgres driver (`postgres`) targeting **Neon serverless** (hosting assumption). Define the **slice subset** of the engineering plan §5 schema first (see Part 2 table list), then stub the rest. `drizzle.config.ts` lives here; migrations in `packages/db/drizzle`. Export `db` client + `schema` namespace + inferred row types.
- **Better Auth tables are generated into THIS package** (Phase 3 writes them here), keeping `@docket/db` the single source of truth per §2.
- **Exit gate:** `pnpm --filter @docket/db db:generate && db:migrate` against a local/Neon Postgres creates all slice tables; `db:studio` shows them.

#### Phase 3 — `@docket/auth` _(sequential; depends on db)_

- **Do:** One `betterAuth()` config (engineering plan §2). For the slice, the **minimum viable plugin set**: `passkey({ registration: { requireSession: false, resolveUser } })` + `nextCookies()` **last**. (Google/GitHub/Linear social, `sso`, `scim`, `oidcProvider`, `mcp`, `stripe` are added in their own Phase-6 lanes — they are not needed to prove the slice.) `drizzleAdapter(db, { provider: "pg" })`. Run `npx @better-auth/cli generate` → output Better Auth schema **into `@docket/db`** → `drizzle-kit migrate`.
- **`resolveUser`** for passkey-first: on first passkey registration with no session, create the `user` row **and** its 1:1 `hub` row (engineering plan §5 "User … 1:1 with a Hub"). This is the seam where global identity is born.
- **Exit gate:** `auth.handler` responds to `/api/auth/passkey/*`; a unit test registers + verifies a passkey using a virtual authenticator and gets a session cookie.

#### Phase 4 — `apps/api` _(sequential; the RPC contract + auth mount)_

- **Do:** Hono 4.x service. Order inside `apps/api/src/index.ts` matters:
  1. `cors({ origin: [env corsOrigins], credentials: true, allowHeaders: ['Content-Type','Authorization'], exposeHeaders: ['Authorization','WWW-Authenticate'] })` — **first**.
  2. Session middleware: `app.use('*', sessionMiddleware)` setting typed `c.var.user`/`c.var.session` via `auth.api.getSession`.
  3. Auth mount: `app.on(['POST','GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))`.
  4. Feature routers mounted via **method chaining** to preserve RPC types.
- **RPC discipline (engineering plan §1):** routes defined with chained `.get().post()` and split across files (`routes/organizations.ts`, `routes/projects.ts`, `routes/tasks.ts`, …); `index.ts` chains them: `const routes = app.route('/organizations', orgs).route('/projects', projects).route('/tasks', tasks); export type AppType = typeof routes;`. Build to `dist` so consumers import a compiled `.d.ts` (not raw TS) — this is what keeps `tsserver` fast.
- **Zod in and out**: request bodies validated with `@hono/zod-validator` against schemas from `@docket/types`; responses also typed via `@docket/types` so the RPC client and UI share one definition.
- **Exit gate:** `hc<AppType>` in a scratch consumer autocompletes `client.tasks.$post({...})` with correct body/response types; `/health` returns ok; an authed request to a protected route succeeds with a cookie and 401s without.

#### Phase 4.5 — Permissions core _(sequential; thin but real — every read/write goes through it)_

- **Do:** Minimal slice of engineering plan §5 Permission/Grant system: a `requireOrgMember(orgId)` guard that resolves the caller's **human `Actor`** in that org (via `actor.user_id` + `actor.role`) and asserts at least `view`/`contribute` capability. Seed the four default roles (Owner/Admin/Member/Guest) per org at creation. For the slice, the creating user becomes **Owner** of their new org. Tenant key `organization_id` is enforced on every work query (engineering plan §5: "Tenant key on all work data = `organization_id`"). The full cascade/visibility grid is a Phase-6 lane; the **boundary** (you can only touch orgs you're a member of) ships now because the slice's multi-tenant isolation is non-negotiable.
- **Exit gate:** a request for a task in an org the caller doesn't belong to returns 404/403 (not the row).

#### Phase 5 — `@docket/ui` shell + slice screens _(sequential to reach first runnable product)_

- **Do:** shadcn/Tailwind component package (`@docket/ui`) consumed JIT via `transpilePackages`. Build the **app shell** the slice needs (global rail, org-scoped sidebar, content area per IA §7) and the slice screens (sign-in, org-create, project-create, task-create, grouped List view). `apps/web` consumes `@docket/ui` + the RPC client + the Better Auth `createAuthClient`/`passkeyClient`.
- **Exit gate (= FIRST RUNNABLE PRODUCT):** the full slice works by hand in `apps/web` against the real `apps/api` + real Postgres, and the Playwright slice spec (Part 2.7) is **green in CI**.

#### Phase 6 — Feature fan-out _(parallel once P2/P4/P5 seams are frozen)_

Independent lanes, each = new tables + new chained routes + new components, no seam re-cut:

| Lane                               | Adds tables                                                         | Adds routes                       | Depends on (beyond frozen seams)      |
| ---------------------------------- | ------------------------------------------------------------------- | --------------------------------- | ------------------------------------- |
| **Programs / Initiatives**         | `program`, `initiative`, `initiative_project`, `initiative_program` | `/programs`, `/initiatives`       | —                                     |
| **Cycles**                         | `cycle`                                                             | `/cycles`                         | Team (in slice)                       |
| **Milestones + Dependencies**      | `milestone`, `task_dependency`                                      | extends `/tasks`                  | Task, Project (in slice)              |
| **Triage**                         | (uses `task` + team `triage_enabled`)                               | `/triage`                         | Team, Task                            |
| **Agents / Sessions**              | `agent`, `agent_session`, `session_activity`                        | `/sessions`                       | Actor (in slice), permissions         |
| **MCP server**                     | (reuses work tables)                                                | `/mcp` + OAuth provider           | auth (`oidcProvider`+`mcp` plugins)   |
| **Billing + lifecycle**            | org billing cols, subscription mirror                               | `/api/auth/stripe/*` + cron sweep | `stripe()` plugin, org (in slice)     |
| **Hub: Today / Inbox / Portfolio** | `daily_plan_item`, `notification`                                   | `/hub/*`                          | cross-org reads (orgs from slice)     |
| **Marketing + Admin apps**         | — / service-admin tables                                            | — / admin routes                  | design system frozen                  |
| **Updates / Comments / Activity**  | `update`, `comment`, `audit_event`                                  | `/updates`, `/comments`           | subjects (project/program/initiative) |

**Sequential within a lane, parallel across lanes.** The only cross-lane ordering constraints: **MCP** needs `oidcProvider()`+`mcp()` added to `@docket/auth` (re-touches a frozen-ish seam — schedule its auth-plugin addition as a small synchronized step); **Billing lifecycle cron** needs the chosen cron infra decided (open issue).

### 1.3 Sequential vs. parallel — the explicit cut

- **Strictly sequential (the spine):** `Repo → env → db → auth → api(RPC+mount) → permissions-core → ui-shell`. Each link consumes the previous link's compiled output; reordering breaks type inference or migrations.
- **Parallelizable immediately (no seam dependency):** `tooling/*` presets (tsconfig/eslint/tailwind) can be built alongside Phase 0–1; `@docket/test-utils` + Playwright harness scaffolding can be built alongside Phase 2–4; `apps/marketing` static landing can be built alongside Phase 5 (it only needs `@docket/ui`).
- **Parallelizable after seams freeze (end of Phase 5):** all of Phase 6.

---

## Part 2 — The First Vertical Slice (exact, executable)

**Goal:** prove the entire stack end-to-end with **real auth + real Postgres + the typed RPC contract + the design system** — no stubs (Hard Constraint: wire real services).

**Flow:** Sign in with a **passkey** → create an **Organization** (auto-creates one default **Team**) → create a **Project** → create a **Task** → see the task in a **List view grouped by Project → sub-grouped by Status** (the product default per mvp-plan §8.3 / §7).

### 2.1 Packages this slice touches

| Package                     | Role in the slice                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@docket/env`               | Validated `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_API_URL`.                                                   |
| `@docket/db`                | Tables (below) + `db` client + Better Auth generated tables.                                                                                |
| `@docket/auth`              | `betterAuth()` with `passkey({ registration:{ requireSession:false, resolveUser } })` + `nextCookies()`.                                    |
| `@docket/types`             | Zod schemas: `createOrganizationInput`, `createProjectInput`, `createTaskInput`, and the response DTOs.                                     |
| `apps/api`                  | Hono service: CORS → session middleware → `/api/auth/*` mount → chained `/organizations`, `/projects`, `/tasks` routers; exports `AppType`. |
| `@docket/ui`                | shadcn shell + form/list components.                                                                                                        |
| `apps/web`                  | Next 16 screens consuming RPC client + auth client.                                                                                         |
| `apps/web-e2e` (Playwright) | The verifying flow `create-org-project-task` + a CI-safe non-passkey login fallback.                                                        |
| `@docket/test-utils`        | per-worker tenant helper + session-seed helper for CI.                                                                                      |

### 2.2 DB tables this slice touches _(subset of engineering plan §5; exact names)_

Generated/owned in `@docket/db`:

- **Better Auth generated:** `user`, `session`, `account`, `verification`, `passkey`. (User = global account, §5.)
- **`hub`** — 1:1 with `user` (`id`, `user_id`, `name?`, `preferences`). Created in `resolveUser` on first passkey registration.
- **`organization`** — `id`, `name`, `slug`, `avatar?`, `is_personal`, `vocabulary` (skin, default Startup), `agent_guidance?`, plus common cols (`created_by`, `created_at`, `updated_at`). For the slice `is_personal=false` for the user-created org.
- **`actor`** — `id`, `organization_id`, `kind {human,agent,team}`, `display_name`, `avatar?`, `status`, and for `kind=human` the folded membership cols `user_id` + `role` (FK → `role`). Creating the org inserts: the caller's **human** Actor (role=Owner) and one **team** Actor for the default Team.
- **`team`** — `id`, `organization_id`, `name`, `key`, `description?`, `workflow_states[]` (default `{backlog,todo,in_progress,done,canceled}`), `triage_enabled`, `agent_guidance?`. The default Team is auto-created with the org.
- **`role`** — org-scoped named capability bundle; seed Owner/Admin/Member/Guest per org at creation.
- **`project`** — `id`, `organization_id`, `name`, `description`, `lead_id?`, `program_id?` (null in slice), `status {planned,active,completed,canceled}` (default `planned`), `health?`, `start_date?`, `target_date?`, `team_id?`, common cols.
- **`task`** — `id`, `organization_id`, `title`, `description?`, `team_id` (the default Team), `state` (one of the team's `workflow_states`, default `backlog`), `priority {none,urgent,high,medium,low}` (default `none`), `assignee_id?`, `delegate_id?`, `project_id?` (set to the created Project), `program_id?`, `milestone_id?`, `cycle_id?`, `parent_task_id?`, `due_date?`, `completed_at?`, `canceled_at?`, common cols. Provenance defaults `source=native, sync_mode=mirror`.

**Not in the slice** (stubbed only): `program`, `initiative`, `cycle`, `milestone`, `task_dependency`, `task_label`, `label`, `update`, `comment`, `audit_event`, `notification`, `daily_plan_item`, `integration`, `agent`, `agent_session`, `session_activity`, service-admin tables.

> Note the **state-model change** from the legacy tree: tasks use the **team workflow state** (`backlog/todo/in_progress/done/canceled`), not the old `pending/in_progress/completed/cancelled`. Grouping in the List view is **by Project → by team workflow state**, matching mvp-plan §8.3.

### 2.3 API routes this slice touches _(Hono, chained, typed)_

All under `apps/api`, all behind the session middleware + `requireOrgMember` (except org-create, which only requires a session):

| Method + path                           | Input (Zod, `@docket/types`)                                                       | Effect                                                                                                     | Response                        |
| --------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `POST /api/auth/passkey/*`              | (Better Auth)                                                                      | passkey register/verify; `resolveUser` mints `user`+`hub`                                                  | session cookie                  |
| `GET /api/auth/get-session`             | (Better Auth)                                                                      | session check                                                                                              | `{ user, session }`             |
| `POST /organizations`                   | `createOrganizationInput { name, slug?, vocabulary? }`                             | tx: insert `organization` + seed 4 `role`s + caller `actor`(human,Owner) + default `team` (+ team `actor`) | `{ organization, defaultTeam }` |
| `GET /organizations`                    | —                                                                                  | orgs the caller is an Actor in (Hub gather)                                                                | `{ data: Organization[] }`      |
| `POST /projects`                        | `createProjectInput { organizationId, name, description?, teamId? }`               | insert `project` (status=planned) after `requireOrgMember`                                                 | `{ data: Project }`             |
| `GET /projects?organizationId=`         | query                                                                              | projects in org                                                                                            | `{ data: Project[] }`           |
| `POST /tasks`                           | `createTaskInput { organizationId, title, projectId?, teamId, state?, priority? }` | insert `task` (state default first workflow state) after `requireOrgMember`                                | `{ data: Task }`                |
| `GET /tasks?organizationId=&projectId=` | query                                                                              | tasks in org/project for grouping                                                                          | `{ data: Task[] }`              |

Routers are method-chained and composed in `index.ts` as `app.route('/organizations', organizations).route('/projects', projects).route('/tasks', tasks)`; `export type AppType = typeof routes`.

### 2.4 UI components / screens this slice touches _(Next 16, App Router)_

In `apps/web/src/app` (Server Components by default; client only for forms/passkey):

- `(auth)/sign-in/page.tsx` — passkey sign-in/up screen. Client component calls `authClient.signIn.passkey()` and, for new users, `authClient.passkey.addPasskey({ name, context })` (passkey-first). Uses `@docket/ui` `Button`, `Card`, `Input`.
- `(app)/layout.tsx` — the **app shell**: global rail (Hub + one avatar per org from `GET /organizations`) + org-scoped sidebar (My Work · Triage · Projects · … per IA §7). Server Component; reads session via the RPC `get-session`.
- `(app)/orgs/new/page.tsx` — **CreateOrgForm** (client). Calls `client.organizations.$post`. On success, rebinds into the new org (mvp-plan §7 "Selecting an Org rebinds…").
- `(app)/orgs/[orgSlug]/projects/new/page.tsx` — **CreateProjectForm** (client) → `client.projects.$post`.
- `(app)/orgs/[orgSlug]/projects/[projectId]/page.tsx` — Project detail with a **CreateTaskForm** (client) → `client.tasks.$post`.
- `(app)/orgs/[orgSlug]/my-work/page.tsx` (or a `views/list`) — the **grouped List view**: Server Component fetches `GET /tasks?organizationId=`, renders `<TaskListView groupBy="project" subGroupBy="state">` using `@docket/ui` `ListGroup`, `ListSubGroup`, `TaskRow`, `Badge` (status), `Avatar` (assignee). Default grouping = Project → Status per mvp-plan §8.3.

New `@docket/ui` components introduced by the slice: `TaskListView`, `ListGroup`, `ListSubGroup`, `TaskRow`, `OrgRail`, `OrgSidebar`, `EntityForm` wrapper (+ reuse shadcn `Button/Card/Input/Badge/Avatar/Skeleton/DropdownMenu`).

Client wiring in `apps/web/src/lib`: `auth-client.ts` (`createAuthClient({ baseURL: NEXT_PUBLIC_API_URL, plugins: [passkeyClient()] })`); `rpc.ts` (`hc<AppType>(NEXT_PUBLIC_API_URL, { init: { credentials: 'include' } })` — credentials so the auth cookie rides along, replacing the legacy hand-rolled `api-client.ts`).

### 2.5 The end-to-end data path (what "proves the stack" means)

```
Browser (apps/web, Next 16)
  └─ authClient.passkey  ──► POST /api/auth/passkey/*  (Better Auth on Hono)
                                  └─ resolveUser ► INSERT user + hub  (Postgres)
                                  ◄─ Set-Cookie session
  └─ hc<AppType> client.organizations.$post  ──► POST /organizations
        (cookie ► sessionMiddleware ► getSession ► c.var.user)
            └─ tx: INSERT organization, role×4, actor(human,Owner), team, actor(team)
  └─ client.projects.$post  ──► POST /projects  (requireOrgMember)  ─► INSERT project
  └─ client.tasks.$post     ──► POST /tasks     (requireOrgMember)  ─► INSERT task
  └─ Server Component GET /tasks?organizationId=  ─► SELECT … WHERE organization_id=
            └─ render TaskListView grouped by project → state
```

Every layer is real: real WebAuthn (virtual authenticator in tests), real Better Auth session, real Hono RPC types, real Postgres rows, real org-scoped query. No mock substitutes a layer.

### 2.6 Bootstrap / credential setup (no-stubs constraint)

A `scripts/bootstrap.ts` (run via `pnpm bootstrap`) guides real-service setup so the slice runs against real infra on a fresh checkout:

1. Provision/confirm **Neon** Postgres → write `DATABASE_URL` into `apps/api/.env` (and `@docket/db`).
2. Generate `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), set `BETTER_AUTH_URL`, `NEXT_PUBLIC_API_URL`.
3. Run `db:generate` (Better Auth schema → `@docket/db`) + `db:migrate`.
4. Validate all required vars through `@docket/env`; fail loudly on any missing (proves the 12-factor contract).
5. Print next steps (`pnpm dev` to bring up `apps/api` + `apps/web`). Stripe/OAuth/MCP creds are prompted only when their Phase-6 lanes are enabled — the slice needs none of them.

### 2.7 The Playwright flow that verifies the slice

In `apps/web-e2e` (Playwright ≥ 1.60, Chromium-only recommended), spec `flows/create-org-project-task.spec.ts`, registered in the typed **flow registry** (engineering plan §6) under flow id `create-org` (extended to cover project+task) so the **coverage gate** enforces its existence.

**CI-safe login (critical, engineering plan §6):** WebAuthn isn't scriptable headless, so the slice uses the **CDP Virtual Authenticator** to register/assert a passkey deterministically:

```ts
// fixture: virtual authenticator
const client = await context.newCDPSession(page);
await client.send('WebAuthn.enable');
await client.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
});
```

(Engineering plan §6 lists this CDP virtual authenticator as the recommended option, alongside a session-seed endpoint fallback. The slice uses the virtual authenticator because it exercises the **real** passkey path end-to-end.)

**Flow steps** (each wrapped in the `step(name, fn)` flow-recorder fixture so it self-documents with a screenshot + attaches video to the HTML report):

1. `step('sign up with passkey')` → navigate `/sign-in`, enter name/email, click "Continue with passkey"; virtual authenticator satisfies WebAuthn; assert redirect into the app shell + session cookie present.
2. `step('create organization')` → `/orgs/new`, fill name `"Acme"`, submit; assert org avatar appears in the global rail and `GET /organizations` returns it; assert a **default Team** exists (call `GET /tasks` precondition or assert sidebar shows the team).
3. `step('create project')` → `/orgs/acme/projects/new`, name `"Paid Launch"`, submit; assert project visible.
4. `step('create task')` → project page, create task `"Draft launch post"`; assert task row rendered.
5. `step('see grouped list')` → navigate to the List view; assert the task appears **under group "Paid Launch" (project) → sub-group "Backlog" (status)**; assert a second task created with no project lands under a "No project / Triage"-style group, proving grouping logic.

**Assertions that prove real-stack (not UI-only):**

- A direct DB read (via `@docket/test-utils`) confirms `task.organization_id` == the created org and `task.team_id` == the default team (proves tenant scoping + auto-team).
- A request to `GET /tasks?organizationId=<other-tenant>` with this session returns no rows / 403 (proves Phase-4.5 isolation).
- `storageState` persisted after step 1 so mutating steps reuse the authed session; **per-worker tenant** (fresh org per worker) so parallel shards don't collide (engineering plan §6).

**Capture modes:** default lean PR run (`trace: on-first-retry`, `screenshot: only-on-failure`, `video: retain-on-failure`); the same spec re-runs under `CAPTURE_ALL=1` in the scheduled `e2e-flow-films` workflow to produce the marketing-grade 1280×800 retina reduced-motion film of the slice.

### 2.8 Definition of done for the slice (the first-runnable-product gate)

- `pnpm bootstrap` on a clean checkout brings up real Postgres + real auth.
- `pnpm dev` serves `apps/api` (Hono) + `apps/web` (Next 16); the flow works **by hand**.
- `hc<AppType>` types resolve in `apps/web` with no `any` (RPC seam proven).
- `apps/web-e2e` `create-org-project-task.spec.ts` is **green in CI** under the lean capture mode; the flow-coverage gate passes.
- `pnpm typecheck && pnpm lint` clean; no `// TODO`, no stub handlers, no `it.skip` (AGENTS.md "NO Stubs or TODOs").

---

## Part 3 — Concrete file map introduced by Phases 0–5 + the slice

```
docket/
├─ turbo.json                                  # 2.x tasks key, globalEnv, strict env
├─ pnpm-workspace.yaml
├─ scripts/bootstrap.ts                         # P2.6 credential/setup guide
├─ tooling/{tsconfig,eslint-config,tailwind-config}/
├─ packages/
│  ├─ env/src/index.ts                          # P1: @t3-oss/env base + per-app extend
│  ├─ db/
│  │  ├─ drizzle.config.ts
│  │  ├─ src/schema/{auth,hub,organization,actor,team,role,project,task}.ts  # slice subset
│  │  ├─ src/index.ts                           # exports db + schema + row types
│  │  └─ drizzle/                               # generated migrations (incl. Better Auth)
│  ├─ auth/src/index.ts                         # P3: betterAuth() passkey-first + resolveUser(user+hub)
│  ├─ types/src/{organization,project,task}.ts  # Zod create*Input + DTOs
│  ├─ ui/src/{TaskListView,ListGroup,ListSubGroup,TaskRow,OrgRail,OrgSidebar,EntityForm}.tsx
│  └─ test-utils/src/{tenant,session-seed,db-read}.ts
├─ apps/
│  ├─ api/
│  │  ├─ src/index.ts                           # CORS → session mw → /api/auth/* → chained routers → AppType
│  │  ├─ src/auth/session-middleware.ts
│  │  ├─ src/permissions/require-org-member.ts  # P4.5
│  │  └─ src/routes/{organizations,projects,tasks}.ts   # chained for RPC
│  ├─ web/
│  │  ├─ src/lib/{auth-client.ts,rpc.ts}        # createAuthClient+passkeyClient ; hc<AppType>
│  │  └─ src/app/(auth)/sign-in/page.tsx
│  │     src/app/(app)/layout.tsx
│  │     src/app/(app)/orgs/new/page.tsx
│  │     src/app/(app)/orgs/[orgSlug]/projects/new/page.tsx
│  │     src/app/(app)/orgs/[orgSlug]/projects/[projectId]/page.tsx
│  │     src/app/(app)/orgs/[orgSlug]/my-work/page.tsx   # grouped List view
│  ├─ marketing/  (parallel, P5-adjacent)
│  ├─ admin/      (P6 lane)
│  └─ web-e2e/
│     ├─ playwright.config.ts                   # ≥1.60, Chromium, two capture modes
│     ├─ fixtures/{virtual-authenticator,flow-recorder}.ts
│     ├─ flow-registry.ts + coverage.spec.ts
│     └─ flows/create-org-project-task.spec.ts  # the verifying flow
```

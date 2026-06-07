export const meta = {
  name: 'build-docket',
  description: 'Fully implement Docket against local Postgres + mock boundary adapters so it runs/tests with ZERO external accounts — the only gap is env-specific values. Clean-slate -> foundation -> seam -> boundaries -> all lanes in parallel -> final gate.',
  whenToUse: 'Run to build the entire app autonomously. No human bootstrap gate: every external edge is behind a port with a real (env-driven) + mock (fixture) adapter, and the build/tests run against local/embedded Postgres + the mocks. Going to prod = supplying env values only.',
  phases: [
    { title: 'Clean slate' },
    { title: 'Foundation' },
    { title: 'Seam' },
    { title: 'Boundaries' },
    { title: 'Fan-out' },
    { title: 'Final gate' },
  ],
}

// Plan inputs every agent must read before building:
//   docs/engineering/build-manifest.md   — 172 atomic tickets (files + acceptance)
//   docs/engineering/DECISIONS.md         — every open question frozen (Node 24, pnpm 11, TS 6, Vitest 4, ULID, grant/role, …)
//   docs/engineering/boundaries.md        — ports-and-adapters: real + mock per external edge
//   docs/engineering/build-readiness.md   — single-owner rules + workflow shape
//   docs/engineering/specs/*              — detailed specs (RECONCILIATION = tie-breaker)
//   docs/engineering/architecture.md      — system structure

const PLAN = `Obey docs/engineering/build-manifest.md (your tickets), DECISIONS.md (frozen choices), boundaries.md (ports + adapters), build-readiness.md (single-owner rules), and specs/* (RECONCILIATION = tie-breaker). Write REAL, production-grade code — no stubs of business logic, no TODOs, no skipped tests. Pins: Node 24 LTS · pnpm 11 · TypeScript 6 · Vitest 4 · Turborepo 2.9 · Next 16 · React 19 · Hono · Drizzle · Better Auth 1.6.14 · Zod 4 · shadcn · hono-openapi+Scalar · text ULIDs · @docket/* names.

CARDINAL RULE (this build's whole point): the app must run and TEST end-to-end with ZERO external accounts. Every external EDGE goes through a port in @docket/boundaries with a REAL env-driven adapter AND a MOCK/fixture adapter, chosen from env (real if the env value is present+real, else mock; APP_MODE in {local,test} forces mock). The ONLY missing functionality may be environment-specific VALUES (DATABASE_URL, OAuth/Stripe/provider keys). Database is real Postgres always — local/test use containerized postgres:17 OR embedded PGlite (@electric-sql/pglite) so migrations+tests run with no service; prod swaps DATABASE_URL to Neon. Mock only the I/O edges, never the logic behind them.`

const GATE = {
  type: 'object', additionalProperties: false,
  properties: {
    unit: { type: 'string' },
    gate_passed: { type: 'boolean' },
    commands_run: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } },
    files_touched: { type: 'array', items: { type: 'string' } },
  },
  required: ['unit', 'gate_passed', 'summary'],
}

const build = (label, phaseName, instruction, opts = {}) =>
  agent(`${PLAN}\n\n${instruction}\n\nWhen done, RUN your verify gate with Bash and report honestly: gate_passed=false if anything fails. Never claim success you did not run.`,
    { label, phase: phaseName, schema: GATE, ...opts })

// === Phase -1: clean slate (sequential, shared tree, hard barrier) =========
const clean = await build('P-1 clean-slate', 'Clean slate',
  `Remove the existing @athena/* scaffold (git rm apps/api, apps/web, packages/{mcp-server,shared,test-utils,types}); reset root package.json (name "docket"), turbo.json, pnpm-workspace.yaml, tsconfig, eslint, vitest to the @docket pins in build-manifest.md FND-P0 + DECISIONS.md (Node>=24<25, pnpm@11.5.x, turbo 2.9, typescript@^6, vitest@^4). ALSO scaffold the zero-external-accounts dev infra now: a root docker-compose.yml (postgres:17 + mailpit), a .env.example AND .env.local with a LOCAL DATABASE_URL, APP_MODE=local, and placeholder external keys (per boundaries.md), and add packages/boundaries to the workspace. PRESERVE docs/, .github/, .husky, .claude/.
GATE: \`grep -ri "@athena" --include=*.json --include=*.ts . | grep -v node_modules\` is empty; pnpm install is clean; \`pnpm dlx tsx -e "0"\` runs on Node 24.`)
if (!clean.gate_passed) { log('STOP at Phase -1'); return { stoppedAt: 'P-1', clean } }

// === Foundation spine P0..P5 (sequential, local DB — NO Neon needed) =======
const spine = [
  ['P0', 'Turborepo skeleton + tooling presets (FND-P0-*): apps/{web,marketing,admin,api}, packages/{db,auth,ui,types,env,boundaries,test-utils}, tooling/{tsconfig,eslint-config,tailwind-config}. GATE: pnpm install && pnpm -w typecheck.'],
  ['P1', '@docket/env (FND-P1-*): t3-oss/env extends-composed schema for every var in env-and-bootstrap.md; treat placeholder external keys as "use mock"; expose APP_MODE. GATE: build && typecheck; importing with a missing REQUIRED var throws.'],
  ['P2', '@docket/db (FND-P2-*): SINGLE SQL owner — enums, id.ts (ULID genId), foundation-slice tables + auditColumns, driver chosen from DATABASE_URL scheme (neon|postgres|pglite). Bring up local DB (docker compose up -d db, OR PGlite if Docker unavailable) and run drizzle-kit generate + migrate against it. GATE: migration applies to the LOCAL db; to_regclass smoke; a vitest using PGlite passes.'],
  ['P3', '@docket/auth (FND-P3-*): one betterAuth() (drizzle adapter, singular tables, generateId=ULID), passkey-primary; social/SSO/SCIM mounted ONLY when env creds present; @better-auth/cli generate INTO @docket/db; migrate local. GATE: typecheck; auth tables exist; passkey path wired.'],
  ['P4', 'apps/api (FND-P4-*): @docket/types primitives (sole owner: Id, Capability, problem), Hono RPC composition root (chained .route(), AppType export), slice routers (orgs/teams/projects/tasks) with hono-openapi validator+describeRoute, /v1/openapi.json + /v1/docs (Scalar), auth mounted, container wired from env. GATE: scratch hc<AppType> consumer typechecks; apps/api builds; GET /v1/openapi.json returns 3.1.'],
  ['P4.5', 'Permissions core (FND-P4.5-*): grant-cascade resolver (allow-only v1) + middleware (CORS->session->orgContext->capabilityGuard); org_id only from verified context. GATE: cross-tenant 404; capability 403; unit tests pass.'],
  ['P5', '@docket/ui shell + slice (FND-P5-*): tokens (semantic health colors), shadcn/Tailwind, the global rail + context-rebind shell, the List primitive (grouping), and the slice screens (passkey sign-in -> create org -> project -> task -> grouped list). GATE: apps/web builds; the slice Playwright flow passes lean against the local+mock stack (CDP virtual authenticator for passkey).'],
]
let prev = clean
for (const [id, desc] of spine) {
  prev = await build(id, 'Foundation', `Foundation ${id}: ${desc}\nShared tree. Run \`pnpm typecheck && pnpm lint && pnpm build\` for touched packages + the phase acceptance. Iterate up to 3x to green.`)
  if (!prev.gate_passed) { log(`STOP at foundation ${id}`); return { stoppedAt: id, [id]: prev } }
}

// === Seam: all entity schema + types + router registration (single-owner) ==
phase('Seam')
const seam = await build('seam', 'Seam',
  `P6 SHARED SEAM (sequential, shared tree, single-owner per build-readiness.md): extend @docket/db for EVERY remaining entity (grant/role/enums owned here; all DA-*/PAB-DB-* tables) and produce ONE coherent migration applied to the local db; extend @docket/types with every entity Zod schema (import primitives, never redefine Id/Capability); register an (empty-handler-ok) router file per resource and wire them in apps/api/src/app.ts (ONLY ticket that edits app.ts). GATE: one migration applies to local db; pnpm -w typecheck; hc<AppType> exposes every route group.`)
if (!seam.gate_passed) { log('STOP at seam'); return { stoppedAt: 'seam', seam } }

// === Boundaries: ports + mock adapters + selectAdapter + fixtures ==========
phase('Boundaries')
const boundaries = await build('boundaries', 'Boundaries',
  `@docket/boundaries per boundaries.md: define the ports (BillingGateway, AgentRuntime, Connector, Mailer, BlobStore), the MOCK adapters (InMemoryBillingGateway, MockAgentRuntime with scripted session fixtures, MockConnector with fixture datasets, CaptureMailer, LocalDiskBlob), deterministic fixtures, selectAdapter(port, env), and buildContainer(env) wired into apps/api. Real adapters are stubbed at the EDGE only (typed, env-driven, may throw "configure <ENV>" until env provided) — their CALLERS' logic is real. GATE: typecheck; a vitest proves each mock satisfies its port and selectAdapter returns mock under APP_MODE=local.`)
if (!boundaries.gate_passed) { log('STOP at boundaries'); return { stoppedAt: 'boundaries', boundaries } }

// === Fan-out: all lanes in parallel (against local db + mock adapters) ======
phase('Fan-out')
const lanes = [
  ['lane:data-api', 'DATA-API: every per-entity CRUD handler body + per-route Zod in/out + OpenAPI annotations + cross-org Hub aggregation (DA-*). Gate: per-pkg typecheck && lint && test; route integration tests against PGlite.'],
  ['lane:permissions', 'PERMISSIONS: full grant/role engine + role seeding + grant-on-request (PAB perms). Gate: resolver tests incl. guest grant-only + cascade.'],
  ['lane:billing', 'BILLING: the BillingGateway REAL adapter (Stripe SDK, env keys) + the data-lifecycle state machine + idempotent cron sweep (PAB-BILL-*/PAB-CRON-*), ALL tested against InMemoryBillingGateway (no Stripe account). Gate: mock-driven webhook events advance lifecycle trialing->active->past_due->export_window->deleted; cron sweep idempotent.'],
  ['lane:mcp', 'MCP: /mcp Streamable HTTP + OAuth2.1 RS (PRM/AS metadata/audience binding, tokens from LOCAL Better Auth) + every tool and resource (MCP-*). Gate: a local MCP client lists tools; a write tool round-trips via the shared service layer; aud-mismatch token -> 401.'],
  ['lane:agents', 'AGENTS/SESSIONS: session hosting + activity stream + approval gate + accountability, with the AgentRuntime REAL adapter (provider, env keys) and full exercise via MockAgentRuntime fixtures. Gate: a mock session streams thought/action(proposed)/elicitation/response; act_with_approval gate approve+reject works; principal/initiator recorded.'],
  ['lane:connectors', 'CONNECTORS: Connector REAL adapters (GitHub/Drive/Linear, env tokens) + MockConnector fixtures; migration-vs-connector + import/read-only-mirror + provenance. Gate: mock import creates linked tasks with provenance; connect-integration e2e green against MockConnector.'],
  ['lane:ui-screens', 'UI: remaining screens + shared components (UI-*) per design-system.md — Portfolio, Org work views, Project/Program/Initiative detail, Cycle/Task detail, Agents/Sessions, Settings, Landing+Onboarding, Service Admin. Gate: each renders against the local+mock stack; component tests; WCAG contrast.'],
  ['lane:testing', 'TESTING: Playwright infra (two-mode capture, flow registry + CI coverage gate, CDP virtual authenticator) + e2e specs for ALL 8 flows against the local+mock stack. Gate: registry coverage check; all flows green in lean mode.'],
]
const fan = (await parallel(lanes.map(([l, d]) => () =>
  build(l, 'Fan-out', `${d}\nWork in your worktree; the seam + @docket/boundaries are frozen — consume them, don't redefine. Everything runs against the local db + mock adapters (zero external accounts).`, { isolation: 'worktree' })
))).filter(Boolean)

// === Final gate: whole app runs + tests with zero external accounts =========
phase('Final gate')
const finalGate = await build('final', 'Final gate',
  `FINAL BARRIER: ensure all lanes are merged. Bring up the local stack (docker compose up -d, or PGlite) and run the whole-repo gate with ZERO external accounts: \`pnpm install && pnpm build && pnpm typecheck && pnpm test\` (>=80% coverage) and the Playwright flow-coverage gate (all 8 flows green, lean). Then \`pnpm dev\` must boot the full product (passkey sign-in, multi-org Hub, plan work, delegate to a mock agent + approval, mock billing lifecycle, mock connector import, /mcp) with only .env.local placeholders. Wire CI last. Confirm the ONLY missing functionality is real env values; list exactly which env vars remain to be provided for prod. Report gate_passed only if all of the above is green.`)

return { stage: 'complete', clean, foundation: prev, seam, boundaries, fan, finalGate }

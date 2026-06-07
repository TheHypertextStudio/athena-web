# Docket — Build Readiness (one-shot assessment)

> Companion to **`DECISIONS.md`** (every open question frozen), **`build-manifest.md`** (172 atomic, dependency-ordered tickets), and the specs. This doc is the honest verdict on whether a single **dynamic workflow** can one-shot the Docket build, the blockers that must be closed first, and the workflow _shape_ that makes it safe.

## Verdict: **yes — after a clean-slate step + a one-time human bootstrap**

Coverage is complete and the dependency spine is sound and acyclic. Every one of the 16 API route groups, all 26 MCP tools, the 12 resource templates + static resources, all 9 product screens, and all 8 end-to-end flows has a ticket with a **real, observable acceptance gate** (typecheck / migration-applies / `hc<AppType>` autocompletes / WCAG-contrast / MCP `isError` contract / flow-coverage). What stops a naive one-shot is **not** missing detail — it's three concrete blockers, all fixable, below.

## Blockers (must close before a one-shot run)

1. **The repo is not greenfield (VERIFIED).** A live `athena-service` Turborepo occupies `apps/{api,web}` and `packages/{mcp-server,shared,test-utils,types}` with contradictory pins (`@athena/*` names vs `@docket/*`; Better Auth ^1.4.10 vs 1.6.14; `@hono/zod-openapi` — which the manifest _forbids_ — vs `hono-openapi`; Zod 3 vs 4; `postgres` driver vs `@neondatabase/serverless`; Node 20 vs ≥24). No manifest ticket removes it, so `FND-P0-01` would collide (stale lockfile, dual `@athena`/`@docket` graph, overlapping `apps/api/src`). **Fix → add a sequential `Phase −1` clean-slate ticket** that `git rm`s the `@athena` tree and resets root `package.json` / `turbo.json` / `pnpm-workspace.yaml` to the manifest pins, run before anything else. (Sanctioned: the existing code is not load-bearing; the old docs are already archived under `docs/_archive/`.)

2. **A one-time human bootstrap is unavoidable for real-service lanes.** Per `env-and-bootstrap.md`, creating Google/GitHub/Linear OAuth apps (paste client id/secret), `stripe login` + `stripe listen` (capture `whsec_`), and authenticating `neonctl`/`vercel` are interactive. An agent **can** one-shot Phase −1 → P5 + the vertical slice + the DB/UI/authz lanes (the manifest correctly scopes these to need no external creds), but the **Billing**, **MCP-OAuth**, and **connect-integration** lanes gate on the human running `pnpm bootstrap` first. → A **bootstrap gate sits between P5 and P6**.

3. **Cross-domain file collisions need single owners.** The canonical `grant`/`role` tables + `grant_effect` enum are authored by _both_ the data-API and permissions domains; `@docket/types` primitives (`Id`, `Capability`) are triple-authored; `apps/api/src/app.ts` is listed by ~10 tickets. Run in parallel as-is, these conflict. **Fix → designate single owners** (next section).

## Single-owner rules (resolve the collisions)

- **All SQL** lives in `@docket/db` and the **canonical `grant`/`role`/enums are owned by the data-model db tickets**; permissions tickets _consume_ them (fold `PAB-DB-*` into the db lane or sequence them strictly before the data-API db tickets in **one** db worktree).
- **`@docket/types` shared primitives** (`Id`, `Capability`, error/problem types) are owned **solely by `FND-P4-01`**; `DA-shared-01`, `PAB-TYPES-01`, `MCP-05` import them, never redefine.
- **`apps/api/src/app.ts` (the chained-router composition root) is edited only by `DA-app-compose-01`.** Every other router self-registers in its own file — break the `.route()` chain and the `AppType` RPC contract silently collapses.
- **Migrations are a global serialization point.** Within the db worktree all schema tickets are sequential and end with **one** `drizzle generate` → a single coherent migration. No two lanes generate migrations concurrently. Better Auth's CLI schema regen (`db:auth:generate`) re-cuts the db seam, so the **full**-plugin generation (sso/scim/oidc/mcp/stripe tables) must precede any P6 lane that migrates.

## Missing tickets to add to the manifest

- **`P-1` clean-slate / scaffold removal** (the biggest gap — see Blocker 1).
- **Next-app skeletons** for `apps/web`, `apps/admin`, `apps/marketing` (root `app/layout.tsx`, `next.config.ts` with the `/api/*` rewrite + `transpilePackages`, `tsconfig`) — currently implicit/entangled with the clean-slate.
- **Remove the orphaned `packages/mcp-server`** (`/mcp` now lives inside `apps/api`).

## Recommended dynamic-workflow shape

```
Phase −1  Clean slate            sequential · 1 agent · no worktree · HARD barrier
            └ git-rm @athena tree; reset root config to @docket pins; pnpm install clean

Phase 0–5 Foundation spine       SEQUENTIAL · shared single working tree (links consume
            (verify barrier        each other's dist) · gate after EACH phase:
             after each)           `pnpm typecheck && lint && build` + phase acceptance
            P0 skeleton → P1 env → [minimal Neon bootstrap] → P2 db (migrate vs REAL Neon
            dev branch) → P3 auth → P4 api+types+slice routers → P4.5 authz core+middleware
            → P5 ui tokens/primitives/shell/list-view + the vertical slice
            ── DO NOT advance on a red gate ──

▶ HUMAN BOOTSTRAP GATE           pause for `pnpm bootstrap` (OAuth apps, stripe login+listen,
                                  neon/vercel auth) + record the MVP scope-cut in WORKLOG

Phase 6   Feature fan-out        PARALLEL · one git worktree per LANE (not per ticket):
            (per lane)             data-API entities · permissions engine · billing · mcp ·
                                   ui-screens · testing. Honor the single-owner rules above.
            per-ticket gate = `pnpm --filter <pkg> typecheck && lint && test`
            per-lane gate   = the lane's compose ticket + build

Final barrier                    merge all lanes → `pnpm build && typecheck && test`
                                  (≥80% coverage) → Playwright flow-coverage gate (all 8
                                  flows green, lean mode) → wire CI (e2e, film run, cron) last
```

**What can run fully autonomously:** Phase −1 → P5 + the vertical slice + the DB/UI/authz P6 lanes (no external creds). **What needs the human first:** the billing / MCP-OAuth / connect-integration lanes. So the realistic "one shot" is: _autonomous up to a runnable, tested foundation + most of the product, with a single human bootstrap pause to light up the real third-party services._

---

_Coverage detail, per-ticket files/acceptance, and the frozen decisions live in `build-manifest.md` and `DECISIONS.md`. The system structure is in `architecture.md`._

# Docket — Client Data-Fetching Layer Spec

> **Area:** `data-layer` · **App:** `apps/web` (Next.js 16 / React 19) · **Built on:** TanStack Query v5 + the Hono RPC client (`hc<AppType>`) · **Companion to** the API contract spec (`docs/engineering/specs/api-rpc-contract.md`).
>
> This spec is the single source of truth for **how the web app reads and writes server data**. The goal is an app that feels **insanely instant** (warm cache, optimistic writes, prefetched navigation, server-hydrated first paint) while staying **performant** (tiered staleness, no waterfalls, bounded lists). Every data surface follows the same small contract — there is exactly one right way to fetch, and it is the easy way.

---

## 0. Where it lives

| Concern                              | Location                                |
| ------------------------------------ | --------------------------------------- |
| The toolkit (hooks, client, helpers) | `apps/web/src/lib/query.ts`             |
| The query-key convention             | `apps/web/src/lib/query-keys.ts`        |
| The Hono RPC client                  | `apps/web/src/lib/api.ts`               |
| Problem→structured error boundary    | `apps/web/src/lib/problem.ts`           |
| The single `QueryClient` mount       | `apps/web/src/components/providers.tsx` |
| Behavior tests (the pinned contract) | `apps/web/tests/lib/query.test.tsx`     |

No business logic lives in the web app; it calls the API over `hc<AppType>` and the response types flow back through this layer end-to-end. There is **no `as any`** and **no ad-hoc key** anywhere in the data path.

---

## 1. The standard — the seven rules

Every data surface follows these. Rules 1–4 + the optimistic recipe are **enforced today** (Phase 0 shipped the toolkit; Phase 2 adds lint). Rules 5–7 are the target; their rollout phase is noted.

1. **Reads go through `useApiQuery` / `useApiListQuery` / `useLiveApiQuery`** with a key from `queryKeys` — never a raw `useEffect` + `fetch`, never a direct `api.v1.*` call inside a component or page. Data modules under `lib/**` and `*-mutations.ts` are where RPC calls are allowed to originate.
2. **List queries use `useApiListQuery`** (`placeholderData: keepPreviousData`) so a filter change / refetch / navigation never blanks the list to a skeleton.
3. **Writes go through `useApiMutation`, optimistic by default** — `onMutate` patches the cache (via `optimisticPatch`), `onError` rolls back, `invalidateKeys` reconciles with the server on settle.
4. **Each query declares a staleness tier** from `STALE` (`realtime` / `volatile` / `standard` / `static`) — not a flat default — based on how fast its data actually changes (§4).
5. **Navigation primes the cache** — list rows prefetch their detail on intent (`onMouseEnter` / `onFocus`) via `usePrefetchApi`, so opening a detail renders from cache instead of fetching after paint. _(Phase 3.)_
6. **Entry/list pages SSR-prefetch + hydrate** so first paint shows data, not a skeleton. _(Phase 4 — shipped across every entry page except the WIP today screen; see §7.)_
7. **Lists are bounded/paginated; detail pages use aggregate endpoints** — no N+1 waterfalls. _(Phase 5 — shipped: keyset cursor pagination on every list endpoint (`lib/list-cursor` + `CursorQuery`); `projects/:id/rollup` (task→milestone, initiative, recent activity) + inline cycle-list stats collapse the detail/list waterfalls; cycle windows auto-roll in-process (no `/current` fan-out). **Pagination policy:** the cursor is a server-side **safety bound**. The filtered rosters (projects / cycles / programs / initiatives / my-work) deliberately fetch the full set — they filter & group client-side over all rows via `applyView`, so paginating them would truncate the filter input or add round-trips for the same data. Client `useInfiniteQuery` (`apiInfiniteQueryOptions` / `useApiInfiniteQuery`) is reserved for genuinely-large **append feeds** that render incrementally — the activity / Stream firehose — not the filtered rosters.)_

---

## 2. The toolkit (`lib/query.ts`)

Declare a read as a **typed query definition**, then hand it to a hook. The definition is the single source of truth for a query's key, fetcher, error message, and staleness — so reads, prefetches, and cache writes all share one typed object.

### 2.1 `apiQueryOptions(key, call, fallbackMessage, options?)` — the definition

Wraps TanStack's `queryOptions`, so the returned `queryKey` carries its data type (a `DataTag`). That is what makes everything downstream type-checked against the response type `T`:

```ts
const taskDef = (orgId: string, id: string) =>
  apiQueryOptions(
    queryKeys.task(orgId, id),
    () => api.v1.orgs[':orgId'].tasks[':id'].$get({ param: { orgId, id } }),
    'Could not load the task.',
    { staleTime: STALE.volatile },
  );

const q = useApiQuery(taskDef(orgId, id)); // q.data: TaskOut | undefined
queryClient.setQueryData(taskDef(orgId, id).queryKey, row); // type error unless `row` is TaskOut
```

- `key` — always from `queryKeys` (§3). Never inline a tuple.
- `call` — a thunk performing **exactly one** Hono RPC call. `unwrap` validates only the
  machine-readable status/problem code and throws a structured `UserFacingError`; server and
  provider prose is never promoted into UI state.
- `fallbackMessage` — application-owned copy for this operation. It is the only request-specific
  message the UI may show, including when the response contains problem `title` or `detail` fields.
- `options` — anything `useQuery` accepts except `queryKey`/`queryFn`; this is where the `STALE` tier and `enabled` go.

### 2.2 Read hooks

| Hook                               | Use for                                                      | Adds                                            |
| ---------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| `useApiQuery(def)`                 | a single read (detail, count, singleton)                     | nothing — the base primitive                    |
| `useApiListQuery(def)`             | **every** list / table query                                 | `placeholderData: keepPreviousData` (rule 2)    |
| `useLiveApiQuery(def, intervalMs)` | out-of-band data (agent activity, in-flight sessions, inbox) | `refetchInterval`; polls **only while focused** |

All three are **definition-only** — pass a `apiQueryOptions(...)` result, never a bare `(key, call)`. The legacy positional form was removed; there is one shape.

### 2.3 `useApiMutation(options)` — the write hook

The single contract for create/update/delete. Provide a `mutationFn` (wrap one RPC call through `unwrap`) plus optionally `onMutate` (optimistic patch → rollback context), `onError` (rollback), and `invalidateKeys`. Invalidation runs in `onSettled` after any caller `onSettled`, so success reconciles the optimistic cache and failure repairs it. Generics infer from `mutationFn`.

### 2.4 `optimisticPatch(queryClient, key, recipe)` — instant writes

Snapshots the cache at `key`, applies `recipe(prev) => next`, and returns `{ rollback }`. The optimistic-by-default recipe (rule 3):

```ts
useApiMutation({
  mutationFn: (vars) =>
    unwrap(() => api.v1.orgs[':orgId'].tasks[':id'].$patch(/* … */), 'Could not update.'),
  onMutate: (vars) =>
    optimisticPatch<TaskOut>(queryClient, queryKeys.task(orgId, vars.id), (prev) => ({
      ...prev,
      state: vars.state,
    })),
  onError: (_e, _vars, ctx) => ctx?.rollback(),
  invalidateKeys: [queryKeys.task(orgId, id)],
});
```

**When invalidate-only is the right call.** Optimism applies where the optimistic value can be
faithfully represented from data already on the client. For **server-assigned-identity inserts**
(a new comment, task, or subtask whose id/timestamps the server mints) and **derived-rollup
changes** (linking a program to an initiative shifts `childMix`/`distribution`/`rolledUpHealth`;
closing a cycle carries tasks over), a synthesized optimistic entity or a client-recomputed rollup
would show wrong data — so those mutations stay invalidate-only and reconcile via `invalidateKeys`.
In-place edits with a known next value (state, priority, assignment, rename, role change, delete-
from-list) are always optimistic.

### 2.5 `usePrefetchApi()` — prefetch on intent (rule 5)

Returns a `(def) => void` prefetcher bound to the active client. Wire it to a row's `onMouseEnter`/`onFocus`, passing the **same definition the destination reads with**, so navigation renders from a warm cache. No-op when the data is already fresh.

### 2.6 `createQueryClient()` + `unwrap()`

`createQueryClient` builds the one stable client (mounted once via a `useState` lazy initializer in `providers.tsx`) with app-wide defaults: `staleTime: STALE.standard`, `gcTime` 5 min (back-nav stays instant), `refetchOnWindowFocus: true` (replaces every manual "Refresh" button), `retry: 1`. `unwrap` is the RPC→Query bridge and is the only place a `Response.ok` check lives.

### 2.7 Error contract — structured behavior, application-owned copy

Production UI treats every API, authentication, provider, and caught failure as untrusted input.
The central problem boundary converts that input into a `UserFacingError` with stable status/problem
codes and preserves the raw value only as a diagnostic cause. Components and hooks:

- branch on the error type, `status`, or `code`, never on message text;
- display `userErrorMessage(error, fallback)`, where `fallback` is application-owned copy for the
  operation;
- use `readProblemError(response, fallback)` when handling a response outside the query layer; and
- never read `.message`, `.lastError`, `error_description`, problem `title`/`detail`, or the legacy
  string helpers `readProblem`/`readError` directly.

This makes configuration names, exception text, and provider diagnostics incapable of reaching the
interface even when a backend accidentally includes them in a response.

---

## 3. Query-key convention (`lib/query-keys.ts`)

Every key is a **tuple, org-scoped, hierarchical**:

- Org-scoped: `['org', orgId, <collection>, <id?>]`.
- Cross-org (Hub) scope: `['me', <collection>, …]`.
- Detail keys extend their list key, so invalidating a coarse key (`queryKeys.projects(orgId)`) is a **prefix match** that also refreshes every detail beneath it (`queryKeys.project(orgId, id)`).

Rules:

- **Always** use a `queryKeys` factory — adding a new surface means adding a factory here first, never inlining a tuple at the call site.
- Keep counts/sub-resources **under** their parent (e.g. `notificationsCount()` is `['me','notifications','count']`) so one prefix invalidation refreshes the list and its badge together.

---

## 4. Staleness tiers (`STALE`)

Pick the tier from how fast the data changes, passed as `{ staleTime: STALE.x }` in the definition's `options`:

| Tier       | ms      | Use for                                                         |
| ---------- | ------- | --------------------------------------------------------------- |
| `realtime` | 0       | always-stale poll targets / hyper-volatile reads                |
| `volatile` | 5 000   | task state, in-flight agent sessions, pending counts            |
| `standard` | 30 000  | **default** — most lists and detail reads (the client default)  |
| `static`   | 300 000 | rarely changes in a session — members, teams, roles, vocabulary |

Omitting `staleTime` inherits `standard`. Reserve `realtime` for data you also poll with `useLiveApiQuery`.

---

## 5. Invalidation conventions

- Pass `invalidateKeys` for **every surface a write affects**, using the coarsest correct key (prefix match cascades to detail keys).
- Prefer `optimisticPatch` + a narrow `invalidateKeys` over a broad blast: patch the exact cache the user sees for instant feedback, then invalidate to reconcile. Over-broad invalidation (e.g. invalidating `tasks(orgId)` on a comment write) causes refetch storms — invalidate the comment stream key, not the task list.
- A successful write should leave the cache matching the server; if the optimistic shape can't fully match, rely on the settle-time invalidation to true it up.

---

## 6. Pitfalls

- **Waterfalls.** A detail page firing ~20–30 sequential RPCs (`fetch-project-detail.ts`) is a Phase-5 target: collapse to an aggregate endpoint. Don't add new multi-stage client fetchers — add an API endpoint.
- **Over-fetch / N+1.** Per-item fan-out (e.g. cycle stats fetched per row) belongs in the list payload. Bound lists; don't render an unbounded `$get` and slice client-side.
- **Over-invalidation.** See §5 — narrow keys + `setQueryData` reconcile beat invalidating a coarse list on every keystroke-level write.
- **Flicker.** A list that blanks on filter change is missing `useApiListQuery` (rule 2).
- **Ad-hoc keys / direct `api.v1.*` in components.** Both break the cache-sharing guarantee and are lint targets (§8).

---

## 7. SSR hydration (Phase 4)

The target for entry/list pages (today, my-work, inbox, the org list pages, heavy detail pages): a **server component prefetches** the page's queries into a request-scoped `QueryClient`, `dehydrate`s it, and wraps the existing client page in a `<HydrationBoundary>`. The client `useApiQuery` hooks then read the warm cache — **same keys, so client code is unchanged; the change is purely additive**. A failed server prefetch degrades gracefully (nothing cached → the client just fetches).

**Shipped — the server foundation (`lib/query-server.ts`, server-only):**

- `getServerQueryClient()` — a request-scoped `QueryClient` (React `cache()`-deduped per render).
- `getServerApi()` — a Hono RPC client for RSC prefetch that mirrors the browser's same-origin model (targets the request's own origin so the Next rewrite proxies to the API) and **forwards the caller's session cookie** via `next/headers`, so server reads are authenticated.
- `dehydrate` (re-exported) for the `<HydrationBoundary state={…}>`.

**Adopted — every entry page.** Each splits into a server wrapper (prefetch + hydrate) and the existing client component (a default-exported `*-client.tsx`): projects, programs, teams, portfolio, inbox, initiatives, cycles, and my-work. Two patterns proved out beyond the simple "prefetch the page's keys" case:

- **Dependent keys (cycles).** The roster key embeds the org's team ids, so the server resolves teams first, seeds the shared `queryKeys.teams` cache (which the app-shell `ActiveOrgContext` reads — so it hydrates warm too), then primes the roster under the exact `[...queryKeys.cycles, ...teamIds]` key the client derives, in the same id order.
- **Serialization-safe view-models.** Dehydrated data crosses the RSC boundary, so a composite read's view-model must serialize. `fetchCyclesWithStats` switched its `statsById` from a `Map` to a plain record — a record survives both JSON and React Flight unchanged; a `Map` does not. Prefer records for any dehydrated view-model.
- **Migrate-then-SSR (my-work).** A page riding a hand-rolled `useState`/`useEffect` loader (`use-my-work.ts`) is first migrated onto the query layer (here, five `useApiQuery` slices under canonical keys), which then makes the server prefetch a mechanical `allSettled` over the same keys.

Only the **today** screen is unconverted (active WIP). All adoption here is verified by typecheck + the unit suite; the RSC boundary + cookie-forwarding fetch are best confirmed with `next build` once the dev server frees `.next`.

---

## 8. Enforcement

The **fetch-in-effect anti-pattern** — `api.v1.*` or `fetch` inside a `useEffect` (the hand-rolled loading the query layer replaces) — is an **ESLint error** across the authed product app (`apps/web/src/app/(app)/**` + `components/**`), via `dataLayerConfig` in the shared `@docket/eslint-config` preset. Auth/OAuth/onboarding flows are intentionally out of scope (they legitimately `fetch` in effects for passkey/consent ceremonies, not product data). A blanket `api.v1` ban is deliberately _not_ imposed — the toolkit legitimately calls `api.v1` inside `apiQueryOptions` within page/component files — so the rule targets the effect-driven pattern; it can broaden once query definitions are relocated into `*.query.ts` data modules.

- `packages/test-utils/tests/web-error-source-policy.test.ts` scans all production TypeScript in
  `apps/web` and `apps/admin`. CI rejects direct `.message`, `.lastError`, `error_description`, and
  legacy string-reader use. The only explicit raw-message exemptions are the central classifier and
  query boundary files; feature code cannot add local exemptions.
- The behavior contract in `apps/web/tests/lib/query.test.tsx` pins structured query failures and safe
  caller-owned fallback copy; `useApiMutation` applies the optimistic write, rolls back on failure,
  and invalidates on settle.

---

## 9. Worked references (real files)

- **Multi-slice parallel read:** `lib/use-task-detail.ts` — a dozen `apiQueryOptions` reads keyed off `queryKeys`, all sharing the cache with the rest of the app.
- **Triage queue:** `lib/use-triage.ts` — seven slices + writes that invalidate `tasks(orgId)` so a sorted/dismissed task leaves the queue; no manual refresh.
- **Today screen:** `app/(app)/today/use-today-data.ts` — auto-refetch on focus + after the stale window replaces the old "Plan day" button.
- **Optimistic mutations:** `lib/use-task-mutations.ts`, `lib/use-project-mutations.ts` (Phase 3 converts the remaining invalidate-only writes to this shape).

---

## 10. Rollout status

| Phase | Scope                                                                                    | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Toolkit: `STALE`, `apiQueryOptions`, def-only hooks, `usePrefetchApi`, `optimisticPatch` | ✅ shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1     | This spec + `architecture.md` / `AGENTS.md` pointers                                     | ✅ shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2     | ESLint enforcement (fetch-in-effect)                                                     | ✅ shipped — at **error**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 3     | `keepPreviousData` on lists; `useLiveApiQuery` on hot surfaces; optimism; prefetch       | ✅ complete — lists, live polling, optimism (§2.4), and prefetch-on-intent across cycles/projects/tasks/initiatives (shared `*DetailDef` factories + an additive `EntityTable` `onRowPrefetch`); triage rows are sort/dismiss actions with no detail nav (N/A)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4     | SSR prefetch + hydration on entry/detail pages                                           | ✅ all entry pages SSR'd: projects, programs, teams, portfolio, inbox, initiatives, **cycles** (resolves teams→teamIds server-side, seeds the shared teams cache, then primes the team-id-keyed roster + stats — `statsById` switched Map→record so it survives RSC serialization), **my-work** (`use-my-work` first migrated off useState/useEffect onto five query-layer slices; server `allSettled`-prefetches all five). Only **today** is unconverted (active WIP). Verified by typecheck + the 149-test suite; `next build` still recommended once the dev server frees `.next` (§7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 5     | staleTime tiers; API pagination + aggregate detail endpoints                             | ✅ **Complete — all verified against the PGlite route-test harness.** staleTime tiers mapped (volatile: task state / sessions / counts; static: members/roles/invitations, teams, vocabulary, connected apps, identities; standard: lists). **Aggregates / N+1 collapses:** cycles list returns stats inline (one batched `committedTasksForCycles` query, selecting only the four stat columns); `projects/:id/rollup` returns task→milestone + initiative + recent agent activity in one read (kills the per-task N+1, per-initiative M+1, and per-session activity fan-out). **Cycle windows auto-roll in-process** (opt-in `roll=true`) — no per-team `/current` HTTP fan-out on SSR. **Keyset cursor pagination** on every list endpoint (cycles/programs/initiatives/tasks/projects) via `lib/list-cursor` + `CursorQuery`. **Pagination policy (the "latent bound" resolved):** the cursor is a server-side safety bound; the filtered rosters fetch the full set on purpose (they filter/group client-side via `applyView`), so the bound is _not_ meant to bite there — client `useInfiniteQuery` (`apiInfiniteQueryOptions` / `useApiInfiniteQuery`, now in the toolkit) is reserved for large append feeds (activity / Stream firehose), not the rosters. tasks/projects route edits were committed via index injection to leave the integration branch's WIP untouched |
| 6     | Migrate stragglers; lock lint                                                            | ✅ active-org, app-shell-frame, composer, and **use-my-work** (five useState/useEffect slices → query-layer reads) migrated; lint at **error**. Remaining hand-rolled surfaces (`agents/page.tsx`, `use-session-detail.ts`, `gtasks-accounts-section.tsx`, `step-connect.tsx`) sit in the auth/onboarding/integration zones the lint rule intentionally excludes and overlap the live integration branch — fold them in alongside the Phase 5 API coordination                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

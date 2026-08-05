# Offline

> **Status**: Implemented — the app shell survives, routes render from cache, writes queue.
> **Applies to**: `apps/web`
> **Last Updated**: 2026-08-05

What Docket does without a network. Installability and the update handshake are a separate
question, answered in [`pwa.md`](./pwa.md).

## The rule

**The app shell stays on screen whenever it can, and nothing that cannot open looks clickable.**

Everything below follows from that. `offline.html` still exists, but only for someone who has never
signed in on this device — for everybody else, losing the connection means the application keeps
running with the data it already had.

## The problem this solves

The shell is delivered _inside_ each route's server document. That made offline coverage equal to
"routes you happened to open online since the last deploy", which is a small fraction of the app:
most of Docket's 66 routes are parameterized, and `/orgs/[orgId]/tasks/[taskId]` cannot be
pre-visited. Every deploy reset even that to zero, because both the document and static caches carry
`BUILD_ID`.

Worse, an offline click was the most expensive thing on the page. Next fetched an RSC payload, the
request failed, and the router fell back to a full document navigation — tearing down a healthy
running application for a navigation that needed no network at all.

## How one navigation resolves

| Situation                             | What happens                                                         |
| ------------------------------------- | -------------------------------------------------------------------- |
| App running, server reachable         | Next's router, as always                                             |
| App running, server unreachable       | `history.pushState`; shell stays mounted, route table swaps the page |
| Cold start, network answers           | The real server document                                             |
| Cold start, route's document cached   | That document — it carries its own prefetched data                   |
| Cold start, no document for the route | The last document served, with the route rendered from cache         |
| Cold start, nothing cached at all     | `offline.html`                                                       |

## Pieces

| Concern                          | Where                                                                   |
| -------------------------------- | ----------------------------------------------------------------------- |
| Location source                  | `src/lib/app-location.tsx`                                              |
| Route matching                   | `src/lib/route-match.ts`                                                |
| Route table (generated)          | `src/lib/offline-routes.generated.ts`                                   |
| Table generator + rules          | `scripts/generate-offline-routes.ts`, `scripts/offline-route-policy.ts` |
| Deciding a document was replayed | `src/components/pwa/route-slot.tsx`                                     |
| Rendering a route from cache     | `src/components/pwa/offline-route-outlet.tsx`                           |
| Reachability                     | `src/components/reachability.tsx`                                       |
| Links                            | `src/components/docket-link.tsx`                                        |
| Document cache + warming         | `service-worker/documents.ts`                                           |
| Navigation fallback order        | `service-worker/strategies.ts`                                          |
| Persisted query cache            | `src/lib/query-persist.ts`                                              |
| Write queue                      | `src/components/pwa/outbox.ts`                                          |

## `window.location` is the authority

Next's router is only a change notification. The service worker answers a navigation it has no
document for with a _different_ route's document, so the router's route tree describes the shell
while the address bar describes the route the person asked for.

Reading the browser is correct in both cases at once, because it is correct by definition. In
`next@16.2.7` this is narrower than it sounds: `createInitialRouterState` takes the canonical URL
from `window.location` in the browser, so `usePathname` and `useSearchParams` are already right.
Only `useParams` reads the document's flight tree, and it is the hook that would silently resolve
the wrong workspace. All three are banned by ESLint across `(app)`, `components` and `lib` in favour
of `useAppParams` / `useAppPathname` / `useAppSearchParams`.

`useAppLocation` re-reads `window.location` on every snapshot rather than caching it. A cached value
is one commit stale on an online navigation, which is long enough for a freshly mounted detail page
to fetch the entity the person just navigated away from.

## The route table is generated, not written

A hand-maintained table would disagree with the app the first time somebody added a page, and the
failure surfaces as a blank route months later to whoever lost their connection. So it is derived
from `src/app/(app)` by two rules: the page is a client component, or it has exactly one sibling
`*-client.tsx`.

A page matching neither is a **build failure**, not a skip, and so is a page whose client entry takes
props — the table mounts a route with no props, because offline there is no server to resolve Next's
`params` promise. Four redirect-only pages are declared in `ROUTES_NOT_IN_TABLE` with reasons.
Twenty-one pages were reshaped rather than teaching the generator about them: sixteen that took the
`params` promise now read `useAppParams`, four that composed client components inline were split, and
the graph route gained a prop-free entry that resolves its scope from the URL.

`tests/lib/offline-routes.test.ts` asserts that regenerating produces exactly what is committed.

## Any document is a shell

**There is no route for this, deliberately.** The app's URL space belongs to the product, not to the
worker. An earlier version of this added `/offline-shell`, a real route warmed by a fetch per user
per release, and it was the wrong shape twice over: a page nobody can navigate to sitting in the
route tree, plus a request to keep it fresh.

Every authenticated document already carries the same chrome, because `(app)/layout.tsx` renders it
for all of them. So the worker copies each document it serves under one synthetic per-user key
(`/__docket-offline-shell`) and uses that when a route has no document of its own. The shell is
whatever page you last loaded, it costs one extra cache entry and no request, and it is as fresh as
your last visit.

`RouteSlot` is what makes a replayed document honest. The layout knows server-side which path it
rendered for (`x-docket-pathname`, already set by `proxy.ts`); the browser knows which path it is
on. Equal means the document is being used as intended and `children` — the real page, with its own
prefetched data — renders untouched. Different means it is standing in, and the outlet mounts the
requested route's own component instead.

The comparison reads `useAppLocation`, not `window.location` directly, and that matters twice. Its
server snapshot reports the document's own path, so the first client render reproduces the server
HTML exactly and the real URL arrives in a follow-up render rather than as a hydration error. And
offline navigation writes to that same store, so a click that swaps the route re-renders the slot —
without it the previous page would stay on screen under the new URL.

The shell sits _below_ the route's own document in the fallback order: a document rendered for this
route carries its own server-prefetched data and hydrates against its own tree.

## What is precached, and what is not

**Precache anything that will not take a surprising amount of space on the device.** That is a
measured byte budget checked at build time, not a curated route list.

Measured against a real production build, the whole of `.next/static` is **239 assets, 7.8 MB on
disk, 2.0 MB gzipped over the wire** — every route's code, every stylesheet, every font. At that
size there is nothing to choose between, so everything ships. `PRECACHE_BUDGET_BYTES` is 12 MB, and
exceeding it **fails the build** with the ten largest assets named. It never drops them quietly: a
precache that silently shrinks is a feature that silently stops working, for someone who is offline
and cannot be told.

Route **code** is precached because it is identical for every user and it is the difference between
a page rendering and not. Per-object **data** never is — a workspace's objects run to megabytes — so
which entities are available offline is whatever the person actually loaded, held in the persisted
query cache.

The warm runs **after** activation, not during install, so a release is never held up by a few
megabytes on a slow connection, and it is skipped outright when the browser reports Data Saver. It
goes six at a time so it never queues ahead of something the person actually asked for, and a failed
asset is simply fetched on demand later by the ordinary cache-first rule.

`routing.ts` used to argue that this worker needs no precache manifest, because content-hashed URLs
make cache-first self-healing. That is true about correctness and false about coverage: a chunk
never fetched is not in the cache, which is exactly why a route nobody visited cannot render.
Cache-first cannot fix that, because there is nothing to be first about.

## Multi-user safety

Unchanged from [`pwa.md`](./pwa.md), and the shell document is covered by the same four layers: it
is stored under the per-user document key, dropped when a different id arrives, and purged on
sign-out with everything else.

## Verification

```bash
pnpm --filter @docket/web test tests/lib tests/service-worker
pnpm --filter @docket/web exec playwright test pwa-offline.spec.ts
```

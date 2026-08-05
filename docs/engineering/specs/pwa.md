# Progressive Web App

> **Status**: Implemented — installable, with an explicit update handshake.
> **Applies to**: `apps/web`
> **Last Updated**: 2026-08-05

How Docket installs as a standalone app, and how it takes an update without breaking a live tab.

**What happens without a network is a separate question**, answered in
[`offline.md`](./offline.md) — the app shell, the route table, the document cache and the write
queue all live there. Deliberately not in scope anywhere: web push notifications and a custom
`beforeinstallprompt` UI.

`mutations.networkMode` is `'always'` in
[`query-core.ts`](../../../apps/web/src/lib/query-core.ts) so TanStack's own pause-and-replay never
runs. Docket queues offline writes itself, in the page, where the queue can be shown and reasoned
about; see `offline.md`. Queries stay on the default, since flipping them would make every mounted
surface fail loudly the instant signal drops.

## Pieces

| Concern                      | Where                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| Manifest                     | `apps/web/src/app/manifest.ts` (Next metadata route — typechecked, not a static file)   |
| Icons                        | `apps/web/scripts/generate-pwa-icons.ts` → `public/icons/*`, `src/app/apple-icon.png`   |
| Document metadata            | `metadata` + `viewport` exports in `apps/web/src/app/layout.tsx`                        |
| Standalone chrome            | `h-dvh` and `env(safe-area-inset-*)` in `packages/ui/src/components/shell/AppShell.tsx` |
| Service worker               | `apps/web/service-worker/{sw,routing,strategies}.ts` → bundled to `public/sw.js`        |
| Registration + update prompt | `apps/web/src/components/service-worker-provider.tsx`                                   |
| Offline document             | `apps/web/public/offline.html` (static, hand-authored)                                  |
| Session state machine        | `apps/web/src/lib/session-status.ts`                                                    |
| Offline identity             | `apps/web/src/lib/session-snapshot.ts`                                                  |
| Cache persistence            | `apps/web/src/lib/query-persist.ts`, `components/query-persistence.tsx`                 |
| Sign-out teardown            | `apps/web/src/lib/sign-out.ts`                                                          |

`start_url` is `/today`, not `/` — the root belongs to the marketing route group, and an installed
app must not launch into the marketing site.

## The service worker

Authored as ES modules in its own TypeScript program (`service-worker/tsconfig.json`, `lib:
["ES2022", "WebWorker"]`) and bundled by esbuild into a single **classic** worker.

- **Why its own program**: `WebWorker` and `DOM` collide on shared globals in one program. Keeping
  it out of `src/` also keeps it clear of the error-source policy's scan for `message` properties,
  which the `SKIP_WAITING` protocol would otherwise trip.
- **Why bundled, not a module worker**: `type: 'module'` workers are unsupported in Firefox and in
  Safari before 16.4. Modular source, universal output.
- **Why no Workbox or Serwist**: both are webpack plugins, and this app builds with Turbopack.
  Neither is needed — Next's asset filenames are content-hashed, so runtime cache-first is
  self-healing and no build-time precache manifest has to exist.

### Caching rules

Evaluated in order; first match wins. Non-matches get no `respondWith` at all.

| Match                                            | Strategy                                               |
| ------------------------------------------------ | ------------------------------------------------------ |
| non-GET, cross-origin                            | pass-through                                           |
| **`/api/auth/*`, `/v1/*`**                       | **pass-through — security floor**                      |
| HMR, `__nextjs*`, `?_rsc=`, `/_next/image`       | pass-through                                           |
| `/_next/static/*` (production builds only)       | cache-first                                            |
| `/icons/*`, `/manifest.webmanifest`, `/icon.svg` | stale-while-revalidate                                 |
| navigations                                      | network-first (3s) → `/offline.html`; **never cached** |

The two API rules are load-bearing rather than an optimisation. Because no authenticated response
ever enters Cache Storage, the worker needs no per-user cache partitioning and sign-out has nothing
to purge there. Navigation responses are never stored either: caching per-route authenticated HTML
would make one person's document replayable to whoever opens the browser next, and would not help
anyway, since app routes render a client-side shell.

`/_next/static` is cached only in production builds — Turbopack rebuilds dev chunks in place, so
caching them would serve stale code. That is what makes the worker safe to register in development,
and therefore exercisable by the e2e suite.

### Updates

`install` does **not** call `skipWaiting()`. A new worker installs and waits; the app offers a
reload; only on acceptance does the page post `{ type: 'SKIP_WAITING' }`, the worker activate, and
the page reload. Swapping a worker into a live tab would mix old chunks with new ones mid-session.

The cache version is Next's `BUILD_ID`, so the worker must be built **after** `next build` — hence
`"build": "next build && tsx scripts/build-service-worker.ts --production"` rather than a `prebuild`
hook. Production mode is passed explicitly, never inferred from a `.next/BUILD_ID` that any earlier
build may have left behind.

Registration happens at the **root**, not in the authenticated shell: someone arriving at `/sign-in`
is exactly who needs the offline page cached before they need it.

## Offline and the auth gate

`(app)` routes are gated client-side. The gate previously read "no session" and opened the
non-dismissible sign-in interlock — which a _failed_ session request satisfies just as well as a
real sign-out. Anyone whose network dropped was told to sign in again, on a connection where signing
in cannot succeed.

Better Auth distinguishes the two at the transport level, so the fix needs no heuristic:

| `isPending` | `data`   | `error`  | status                                              |
| ----------- | -------- | -------- | --------------------------------------------------- |
| `true`      | —        | —        | `pending`                                           |
| `false`     | non-null | —        | `authenticated`                                     |
| `false`     | `null`   | `null`   | `signed-out` — server answered 200 with a null body |
| `false`     | `null`   | non-null | `unreachable` — the request failed                  |

Only `signed-out` may open the interlock. `navigator.onLine` is **not** part of this decision — it
reports `true` behind a captive portal and on a LAN with no route, so it drives banner wording and
retry only. A captive portal is handled by giving the pending state an 8s deadline, since a request
that hangs rather than fails would otherwise leave the shell spinning forever.

`unreachable` with a cached identity renders the shell read-only behind a standing offline banner;
without one it renders a plain offline screen. Neither claims the session expired.

## Persisted cache and multi-user safety

The query cache is persisted to IndexedDB (not `localStorage`: the sync persister serializes on the
main thread, and the ~5MB origin quota is already shared with the shell's preference keys). `gcTime`
is 24h because `persistQueryClient` refuses to restore an entry whose `gcTime` has elapsed — at the
previous 5 minutes, nothing survived a cold start and the feature would have silently done nothing.

Writing work data to disk is the real risk here, and four layers keep accounts apart:

1. Per-user store key (`docket:query-cache:<userId>`).
2. A restore buster including the user id.
3. Sign-out and session expiry purge **every** user's bucket, not just the current one, then
   navigate by full document load so no part of the previous user's tree survives.
4. The shell drops the cache immediately if the resolved session names a different user than the
   offline snapshot did.

The service worker's API pass-through rules are what make IndexedDB the _single_ place user data
persists, so clearing it is sufficient.

This does not defend against someone with the device already unlocked — the same threat model as a
tab left open. Browser-side encryption would be theatre, since any key would live in the same
origin.

The offline identity snapshot (`docket:session-snapshot`) holds display identity and the user id
only — never a session token, which stays `HttpOnly`. It expires after 7 days, is consulted only
while `unreachable`, and is cleared the moment the server confirms a sign-out.

## Verification

```bash
pnpm --filter @docket/web test                        # unit: routing table, session status, persistence keys
pnpm --filter @docket/web exec playwright test pwa-offline.spec.ts
```

The e2e spec needs no account and asserts installability, worker control, the offline fallback (URL
preserved), zero `/v1` or `/api/auth` cache entries, and zero static cache entries in development.

Known gap: `beforeinstallprompt` is not intercepted, so installation uses the browser's own
affordance. iOS has no install event at all and always uses Share → Add to Home Screen.

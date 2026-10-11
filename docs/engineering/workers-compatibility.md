# Docket Workers compatibility record

## Original source checkpoint

Vercel remains active. No production domains, routes, provider resources, secrets or customer data
changed in this source checkpoint. Next.js 16.2.7 and React/ReactDOM 19.2.7 remain the original
product pair. The native candidate uses exact OpenNext 1.19.0 and Wrangler 4.148.0.

OpenNext 1.19.0 declares Next `>=15.5.15 || >=16.2.3`, but its actual builder rejects the Node
middleware emitted from Docket's existing `src/proxy.ts`. The real native run reported:

```text
Next.js version : 16.2.7
@opennextjs/cloudflare version: 1.19.0
@opennextjs/aws version: 3.10.1
ERROR Node.js middleware is not currently supported. Consider switching to Edge Middleware.
```

The original app passed webpack compilation, TypeScript and route generation before that adapter
rejection. `build:worker` deliberately fails at this gate. It does not suppress the check, replace
Proxy, omit application routes or emit an accepted deployment artifact. The deployment lifecycle
has no active publication channel or GitHub release caller.

The next dependency decision is between a supported minor Next update plus OpenNext 1.20.10,
whose Node middleware support is experimental, and a deliberate Edge middleware migration with
all existing behavior proved. OpenNext 1.20.10 declares Next `>=15.5.27 <16 || >=16.3.8` and therefore
cannot be installed over the unchanged Next 16.2.7 pin by relaxing peers. Neither choice is made
by this checkpoint.

## Isolated supported-minor evaluation

The compatibility branch starts from source checkpoint `25fd23da` and uses exact Next 16.3.8,
OpenNext 1.20.10 and Wrangler 4.148.0. React and ReactDOM remain 19.2.7. The application owns this
exact Next pin so evaluating its supported adapter pair does not upgrade other workspace apps or
change the shared catalog. The existing Node `src/proxy.ts`, backend/API contracts, database and
Vercel configuration remain intact.

Actual installed peers accept this pair. Native webpack compilation, TypeScript, route generation,
service-worker generation and OpenNext bundling have passed. The adapter automatically selects its
experimental Node middleware bundler when it detects Proxy; it prints that this path is not
officially maintained. This isolated evaluation consciously accepts that experimental path. There
is no opt-in configuration flag to invent, no relaxed peer range and no Edge rewrite.

Product assembly checks source-controlled `wrangler.site.jsonc` against `wrangler.jsonc` before
bundling. The prebuilt configuration is available to the shared binding snapshot before any build;
it changes only the entrypoint and retained flat-module/no-bundle packaging rules, preserving all
provider resources and environment settings. Assembly copies it byte for byte into the artifact.

Product assembly invokes the pinned Wrangler dry-run and retains the complete native modules,
assets, raw cache seed, build configuration and assets `BUILD_ID` under `.artifact`. The thin
Worker entry adds the shared no-store release metadata endpoint, validates the native Response
boundary and preserves the existing four-hour image TTL omitted by the native adapter. Shared release-engineering owns provider upload, immutable authorization,
checksums, resource validation/seeding and promotion. Source build/publication channels remain
inactive until all acceptance gates pass.

The initial dry-run measured 34,780.92 KiB uncompressed (33.97 MiB) and 5,081.82 KiB gzip (4.96 MiB). The observed
Studio plan is Free, with a 10 ms request CPU budget. Current [provider limits](https://developers.cloudflare.com/workers/platform/limits/#worker-size) specify a
64 MiB uncompressed Worker limit on both plans; the artifact fits that size limit, but upload,
startup and measured request CPU remain independent provider gates. Do not infer deployability
or authorize a plan change from the dry-run.

The existing disposable release runner now accepts `RELEASE_WEB_RUNTIME=workers`, retains its
PostgreSQL container/migrations/backend/virtual passkey account flow, seeds the retained artifact's
local native cache and starts local Wrangler. Default `node` behavior remains the original Vercel
compatibility reference. `RELEASE_ENV_FILE=/dev/null` prevents local provider configuration loading.
`RELEASE_LOG_DIRECTORY` retains startup logs while the runner still removes its processes and
database. The local-only Worker config permits the runner's loopback API and never becomes the
provider configuration, which keeps `global_fetch_strictly_public`.

```sh
RELEASE_WEB_RUNTIME=workers RELEASE_ENV_FILE=/dev/null \
  RELEASE_BROWSER_TARGETS='e2e/release/workers-routing.spec.ts e2e/auth/sign-in.spec.ts e2e/auth/recovery-codes.spec.ts' \
  pnpm test:release
```

The final focused retained Worker routing/privacy run passes all seven tests without retries.
It verifies the unmarked-release 503, health/security, Node entry redirects, AASA/service worker,
native Images, Mintlify documents/assets and two-viewer/logout private no-store behavior.

Full runtime and authenticated acceptance are still in progress. Full run 7 passes primary screens,
rosters, routing, Images, docs, sign-in/recovery and phone verification. Its added streaming probe
received the entire response in Chromium's first chunk, so that probe cannot establish delayed
streaming or backend cancellation. The unchanged empty-day resume journey failed initially and
passed on retry. Run 7 finished with 28 passes, one failed probe and one flaky planning journey;
it is not a clean full acceptance gate. The invalid probe is removed from committed coverage and
its RED evidence retained; the focused final run does not close the planning or streaming gates. A successful native build is separate
from Worker delivery, sign-in/recovery, viewer isolation, staging origins and canonical production
passkey acceptance. Vercel remains active until those gates and the observation window pass.

## Feature inventory and acceptance status

| Feature                  | Existing application contract                                                                                     | Current evidence and remaining gate                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| React server components  | App Router, async layouts, typed API/query layer                                                                  | Local retained Worker renders all 22 primary authenticated screens; deployed origin still pending               |
| Route handlers           | Health, auth entry routes, native associations                                                                    | Local Worker health and native association responses pass; provider acceptance pending                          |
| Server actions           | No `use server` actions in current application source                                                             | Preserve adapter support; no invented action route used as product evidence                                     |
| Streaming                | Existing loading boundaries and asynchronous protected layouts                                                    | Native Response boundary retained; controlled delayed streaming and backend abort propagation pending           |
| Cache Components         | Not enabled; no `use cache`, `cacheLife` or `cacheTag` declarations                                               | No cache feature removed to pass                                                                                |
| Revalidation and privacy | Public briefs explicitly force dynamic to avoid stale visibility; server sessions preserve unknown vs signed out  | Session source tests retained; final focused retained Worker two-viewer/logout private no-store coverage passes |
| Images                   | Native `next/image`, WebP default; Next 16.2.7 default minimum TTL 14400 seconds                                  | Local native WebP transform, Vary: Accept and four-hour TTL pass; provider Images binding pending               |
| Node Proxy               | Cookie-presence entry gate; authoritative layout session; host restoration for OAuth; brief/custom-domain routing | Original 1.19 rejection retained; experimental 1.20.10 Node entry gate and legacy redirect pass locally         |
| Workspace dependencies   | Existing Turbo graph, transpilation and compiled Hono RPC declarations                                            | Actual API build and original Next build passed; shared registry lock pending                                   |
| Redirects and headers    | Legacy Athena and RP routes, settings paths, CSP/security headers and service-worker freshness                    | Local signed-out/legacy redirects, health CSP/security and service-worker freshness pass                        |
| Mintlify                 | Existing `/docs`, `/_mintlify`, `/mintlify-assets` and `/api/request` rewrites                                    | Local docs and asset delegation preserve upstream CSP; POST/search and provider publishing pending              |
| API/auth proxy           | `/v1`, `/api/auth`, GitHub setup callback, Lattice association                                                    | Local virtual passkey sign-in/recovery and phone flow pass; complete forwarded-host/OAuth acceptance pending    |
| Native identity          | AASA, Android association and passkey RP origins                                                                  | Local AASA delivery and virtual passkey flow pass; Android/provider RP/canonical ceremony pending               |

## Native resource contract

`wrangler.jsonc` declares `IMAGES`, `ASSETS`, `WORKER_SELF_REFERENCE` and the fixed native
`NEXT_INC_CACHE_R2_BUCKET` binding separately for staging and production. Proposed buckets differ
per environment and `remote: false` keeps local Wrangler validation local. These names are source
declarations, not provisioned resources. Worker routes and `workers.dev` publication are disabled.

The native OpenNext config retains R2 incremental caching and streamed responses. A future accepted
artifact must retain all `.open-next` modules, assets, `.open-next/cache` and
`.open-next/.build/open-next.config.edge.mjs`, including the native assets `BUILD_ID`. The shared
release engine owns immutable bundling, checksum identity, Images/cache binding validation and
provider seeding. Native 1.19 and the shared 1.20 fixture have identical `getCacheAssets` and
`computeCacheKey` implementations. That source comparison does not prove this application runs in
Workers. No second product deployment adapter is introduced.

## Setup and package release gates

The root `./run` delegates to `apps/web/run`; existing root `./bootstrap` continues to own the full
backend setup and data lifecycle. The frontend uses the published v0.1.8 launcher/lock, with the
same checksum verified against the actual hosted release. The exact release revision is `878260def7229cd3df7f752b32e5581230c5db2d`, with pyz SHA256
`61f746429fc0ffc7826df2bde61ee4d41323fb5fa0c9f8661255040e7838afd4`. No Docket reusable
release caller or deployment declaration is activated; resource and route review must precede it.

The full original typed ESLint configuration and the composed company configuration both exhausted
Docket's existing 3072 MiB V8 heap cap. The app's lint/fix commands now use the same bounded 4096 MiB
budget as its production build, without removing files, tests, typed rules or complexity policies.

Company packages are exact published 0.0.1 declarations. The hosted candidate 38116243716-1
was promoted by run 38116605945 with matching registry/shipping integrity. This consumer has
validated the verified shipping tarballs through an ignored overlay outside the source contract. The committed registry lock remains the last
real registry lock; it must now be regenerated through approved registry authentication and validated with a clean
frozen install. Tarball evidence cannot satisfy that gate. Earlier 0.1.0 tarball evidence remains historical; it does not establish acceptance of the
published 0.0.1 release.

## Completion and recovery sequence

1. Finish the complete retained Worker release gate, including all original planning journeys. The
   supported minor pair and existing runner adaptation are implemented; retries and intermittent
   failures remain recorded rather than treated as a clean release gate.
2. Grant this repository approved package-read access, generate its actual registry lock and prove
   setup/doctor/check/build from a clean checkout. Shared 0.0.1 publication and generic registry
   acceptance have passed; this consumer's tarball overlay does not satisfy its registry gate.
3. Verify source-controlled prebuilt configuration, exact shared v0.1.8 pin and reviewed per-environment
   resources/routes before adding a shared deployment declaration or caller. Keep channels inactive.
4. Complete controlled streaming/backend-cancellation, private viewer isolation, associations,
   API/auth forwarding and Mintlify POST/search delegation against isolated accounts and backends.
5. Provision isolated staging resources only through the shared release engine after authorization;
   configure its own backend allowlists and passkey RP. Verify actual deployed artifact identity,
   migrations/readiness, canonical URLs and route parity. Keep Scalar on the existing API owner.
6. Reconcile Mintlify's dashboard `Host at` value with `https://clearthedocket.com/docs`, verify the
   actual successful source deployment and preserve the existing `.mintlify.dev` upstream until
   provider evidence supports any change.
7. Promote only after all acceptance gates pass, verify a controlled canonical-origin production
   auth/passkey ceremony, observe the agreed window and retain Vercel rollback until that window
   passes. If acceptance fails, keep or restore Vercel routing and the exact prior source/artifact;
   do not change backend data, credentials or passkey identity to force a green frontend check.

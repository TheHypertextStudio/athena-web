# Docket Workers compatibility checkpoint

## Current disposition

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

## Feature inventory and acceptance status

| Feature                  | Existing application contract                                                                                     | Current evidence and remaining gate                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| React server components  | App Router, async layouts, typed API/query layer                                                                  | Original Next production build passed; Workers render pending                                            |
| Route handlers           | Health, auth entry routes, native associations                                                                    | Original build and source regressions passed; real Worker responses pending                              |
| Server actions           | No `use server` actions in current application source                                                             | Preserve adapter support; no invented action route used as product evidence                              |
| Streaming                | Existing loading boundaries and asynchronous protected layouts                                                    | Worker response boundaries, cancellation and headers pending                                             |
| Cache Components         | Not enabled; no `use cache`, `cacheLife` or `cacheTag` declarations                                               | No cache feature removed to pass                                                                         |
| Revalidation and privacy | Public briefs explicitly force dynamic to avoid stale visibility; server sessions preserve unknown vs signed out  | Existing session tests retained; Worker viewer isolation and private cache pending                       |
| Images                   | Native `next/image`, WebP default; Next 16.2.7 default minimum TTL 14400 seconds                                  | Native Images binding declared; actual transform, negotiation and TTL pending                            |
| Node Proxy               | Cookie-presence entry gate; authoritative layout session; host restoration for OAuth; brief/custom-domain routing | Source regression coverage passes; OpenNext 1.19 rejects native Node middleware                          |
| Workspace dependencies   | Existing Turbo graph, transpilation and compiled Hono RPC declarations                                            | Actual API build and original Next build passed; shared registry lock pending                            |
| Redirects and headers    | Legacy Athena and RP routes, settings paths, CSP/security headers and service-worker freshness                    | Source tests retained; exact Worker redirect/headers pending                                             |
| Mintlify                 | Existing `/docs`, `/_mintlify`, `/mintlify-assets` and `/api/request` rewrites                                    | Observed upstream `https://docket.mintlify.dev` retained; recursive/credential/path origins now rejected |
| API/auth proxy           | `/v1`, `/api/auth`, GitHub setup callback, Lattice association                                                    | Source config retained; cookies, redirects, body/query and forwarded-host Worker acceptance pending      |
| Native identity          | AASA, Android association and passkey RP origins                                                                  | Source association checks retained; isolated staging and canonical production ceremonies pending         |

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
backend setup and data lifecycle. The frontend uses the published v0.1.7 launcher/lock, with the
same checksum verified against the actual hosted release. The current reusable workflows need a
released scoped-root input before a Docket caller can select `apps/web/studio.yaml`.

The full original typed ESLint configuration and the composed company configuration both exhausted
Docket's existing 3072 MiB V8 heap cap. The app's lint/fix commands now use the same bounded 4096 MiB
budget as its production build, without removing files, tests, typed rules or complexity policies.

Company packages are exact 0.1.0 declarations, currently unpublished. Validation uses an ignored
local tarball overlay outside the source contract. The committed registry lock remains the last
real registry lock; it must be regenerated after actual publication and validated with a clean
frozen install. Tarball evidence cannot satisfy that gate. Any later shared config candidate bytes
must replace the earlier validation tarball before final acceptance.

## Completion and recovery sequence

1. Decide the supported native Proxy path, rerun the full existing Turbo production graph and
   retain the complete immutable Workers artifact. Do not change React or backend APIs as a side
   effect of that decision.
2. Publish shared packages and the scoped shared workflow, generate the real registry lock and
   prove setup/doctor/check/build from a clean checkout. Record actual release revisions/digests.
3. Adapt the existing `scripts/run-release-acceptance.sh` runner to select the retained local
   Worker while preserving its disposable Postgres, migrations, backend and virtual passkey
   flow. Do not create a parallel real-app development stack or mutate the shared dev database.
4. Prove local Worker routes, CSP, streaming, private viewer isolation, associations, service-worker
   freshness, Images and native cache seeding. Exercise sign-in, session refresh, logout, recovery,
   API/auth forwarding and complete Mintlify delegation against isolated test accounts/backends.
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

# Docket web

Next.js owns marketing, application pages, request-time authentication and Publishing host routing.
Hono owns backend state and Scalar API documentation. Mintlify continues to publish `../docs`;
see [docs authoring](../../docs/engineering/docs-authoring.md).

## Setup

Run `./bootstrap` from the repository root for the existing backend development stack, dependency
installation, local topology and application data. Read
[UI verification](../../docs/engineering/ui-verification.md) before starting that stack.
The repository pins pnpm and Node through `packageManager` and `.node-version`; the accepted
workspace lock is unchanged. Shared company ESLint/TypeScript/Prettier configuration composes with
Docket's existing domain, security, complexity and Tailwind rules.

Normal Node/Vercel commands remain `pnpm dev`, `pnpm build`, `pnpm lint` and `pnpm typecheck` at the
repository root. Common Mintlify commands remain `pnpm docs:config`, `pnpm docs:config:check`,
`pnpm docs:dev` and `pnpm docs:check`. Shared private packages `0.0.1` and the pinned Mintlify CLI
remain installed through the genuine workspace lock. Actions uses its ephemeral GitHub token and
package-read access; local setup requires an approved package-read identity.

## Native Workers commands

The application pins Next 16.3.8, OpenNext 1.20.10 and Wrangler 4.148.0. React remains 19.2.7.
Build from the repository root so Turbo first builds the existing monorepo dependencies:

```sh
pnpm exec turbo run build:worker --filter=@docket/web
pnpm --dir apps/web preview:worker --env staging
```

`build:worker` runs Next's webpack build, the existing production service-worker build and native
`opennextjs-cloudflare build --skipNextBuild`. It freezes `DOCKET_RUNTIME_TARGET=workers` through
`DOCKET_WORKERS_BUILD=1`. OpenNext owns `.open-next` output and cache population; `preview:worker`
runs native OpenNext preview (local Wrangler). No extra artifact assembler, shipping launcher,
Python lifecycle, prebuilt Wrangler config, release-marker endpoint or custom release workflow is
required. Ordinary CI retains all mandatory validation and existing backend/native release rules.

Supply reviewed public build inputs in the calling environment:
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_PASSKEY_RP_ID`, and
`DOCS_MINTLIFY_ORIGIN=https://docket.mintlify.dev`. Use staging identities for staging builds and
review intended canonical metadata before a production build. Root `.env.local` is not loaded by
this command; Next can still load app-local `.env*`, so keep those absent for isolated acceptance.
Public values become static/client output; request-time bindings do not rewrite compiled metadata.
Never use production secrets for local acceptance.

After source/runtime review and explicit provider authority, the native staging operations are:

```sh
pnpm --dir apps/web upload:worker --env staging --rclone --no-x-provision --env-file /dev/null
pnpm --dir apps/web deploy:worker --env staging --rclone --no-x-provision --env-file /dev/null
```

Both populate the selected remote cache and write to Cloudflare. Upload creates a version without
serving it; deploy publishes it. They are separate operator choices, not a sequence required for
every release. Neither command is run automatically. Production uses `--env production` only
after explicit production approval, complete bindings and recovery review. Current production
bindings are incomplete and intentionally fail closed. Source configuration is not provisioning
or deployment acceptance; verify the actual Worker, Images, R2 and custom-domain ownership first.

## Manual staging workflow

`Deploy Workers staging` is an operator-only `workflow_dispatch` workflow with no inputs or
production option. It admits only this repository's `main`, checks out the dispatched SHA,
requires the latest ordinary push CI run for that exact SHA to have succeeded, runs the existing
frozen install and native Turbo/Next/service-worker/OpenNext build, then checks the live main ref
immediately before native `deploy:worker --env staging --rclone --no-x-provision --env-file /dev/null`. It serializes staging deployments and
never invokes the backend CI/release pipeline. Non-main dispatches skip the job.

Public compile values come from `env.staging.vars` in the single `wrangler.jsonc`, including the
existing Mintlify upstream. No missing input is replaced with production values. The deployment
step alone maps `CLOUDFLARE_STAGING_API_TOKEN` to native `CLOUDFLARE_API_TOKEN`, and
`CLOUDFLARE_STAGING_R2_ACCESS_KEY_ID` / `CLOUDFLARE_STAGING_R2_SECRET_ACCESS_KEY` to
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. All three must be present. Fixed
`CLOUDFLARE_ACCOUNT_ID` and `CF_ACCOUNT_ID` select the Studio account. The Worker token needs
Editor access only to `docket-web-staging`; the separate S3 credential needs Object Read & Write
only on `docket-web-staging-cache`. Supply `RCLONE_S3_NO_CHECK_BUCKET=true` for object-only access.
OpenNext's supported `--rclone` path avoids its default bucket metadata lookup and temporary cache
Worker; `--no-x-provision` disables Wrangler resource provisioning. Provision resources separately.

There is no `--keep-vars`: source owns nonsecret runtime vars, while provider-managed secrets
remain separate. `--env-file /dev/null` suppresses final Wrangler dotenv input only. OpenNext
separately reads `.dev.vars*` and Next-style `.env*`; use a clean checkout without those deployment
files. Never put cache credentials in Wrangler vars or build inputs. The pinned optional peer
`rclone.js@0.6.6` downloads the current official rclone executable during installation; the npm
lock does not pin or checksum that executable. Cache population precedes Worker upload, so a later
upload failure can leave new cache objects. Actual bucket-scoped upload and deployment still need
provider acceptance.

Before dispatch, an operator must establish all of these prerequisites:

- The current production backend baseline was read through authenticated Google Console on
  October 11. Reviewed source was integrated at `2a5ab95f`; the user approved the existing
  automatic backend rollout with that integration. Frontend production cutover remains separate.
- Verify that this repository actually has a protected `staging` GitHub environment, restricted to
  main and the intended environment-owned
  three staging secrets listed above. The generic repository `CLOUDFLARE_API_TOKEN` is never referenced. A YAML
  environment name alone does not create protection; do not dispatch against an absent/unprotected
  environment or silently rely on a broader repository credential. Verify native package-read
  access and ordinary CI success for the intended main SHA.
- Verify the existing `docket-web-staging` Worker, Studio account, custom domain, Images and isolated
  `docket-web-staging-cache` R2 resource/authority and record their current version/configuration for
  recovery. The selected native flags require existing resources and bucket-scoped cache access;
  they do not create a temporary cache Worker. Production
  Worker/DNS/Cloud Run resources must remain outside this operation.
- Reconcile the existing isolated API's actual allowed origins/hosts, RP, cookie scope, OAuth and
  Lattice metadata/callbacks with the configured frontend. The dated public API config still
  advertises the Vercel-stage RP; no source value proves that transition complete. Review isolated
  Publishing/data/secret inputs rather than inventing a brief host, copying production values or
  treating an unavailable metadata read as acceptance.
- Confirm intended staging compile identity and absence of app-local `.env*` input, retain the
  previous staging version and backend configuration, and confirm the operation stays within the
  reviewed staging authority.
  Deployment success still needs actual staging journeys/auth/cache/Images/runtime acceptance;
  the workflow adds no test probes or production cutover.

The trigger multiplier is zero for push/PR and one runner per deliberate manual dispatch, bounded
at 30 minutes. It reuses existing CI evidence instead of rerunning validation and builds only the
web prerequisite graph with local Turbo caching. No workflow run, credential setup or provider
acceptance is claimed by this source preparation.

## Application routing and auth

`wrangler.jsonc` is the single provider configuration. It bundles `worker.ts`, delegates to the
native OpenNext handler, declares `.open-next/assets`, Images and separate R2 bindings per
environment, and keeps `global_fetch_strictly_public`. The small application Worker preserves
same-origin API/auth forwarding, native response streaming, cookies, redirects and image TTL.
Custom-domain attachment remains an operator/bootstrap action; routine deployment declares no
staging routes that could replace it.

Workers omit baked backend rewrites. Each request validates explicit `API_URL`, `WEB_URL`,
`BETTER_AUTH_PASSKEY_RP_ID`, `STUDIO_DEPLOYMENT_ENV`, optional `PUBLIC_BRIEF_HOST` and optional
`BETTER_AUTH_PASSKEY_LEGACY_RP_ID`. Production requires a brief host. Missing or invalid routing
returns 503/no-store rather than falling back to production. Node/Vercel keeps its existing
rewrites, browser-origin auth and legacy RP behavior.

For recognized application-host `GET /v1/config`, the Worker extends a real backend config with
validated `apiOrigin`, `sandboxOrigin` and nullable `briefHost`. The existing query validates this
Workers-only schema; Node retains the raw RPC fetcher. Input and output are capped at 16 KiB.
Transformed responses are unconditional, full 200 JSON with no-store and no stale validators;
invalid success or 304 returns 502. Backend errors and supported redirects retain their bodies.
Ordinary methods and paths preserve streaming, conditional headers, repeated cookies and security.
MCP waits for valid distinct runtime origins; Publishing preserves custom-domain precedence and
backend-authoritative URLs while distinguishing loading, unavailable and absent default addresses.

## Isolated acceptance and remaining gates

The existing release runner keeps its disposable PostgreSQL container, migrations, synthetic
accounts, API process and product browser checks. Its default Node branch is unchanged. To select
native local OpenNext preview without loading local provider configuration:

```sh
RELEASE_WEB_RUNTIME=workers RELEASE_ENV_FILE=/dev/null pnpm test:release
```

Only that local invocation passes `DOCKET_LOCAL_ACCEPTANCE=1`, exact `docket.localhost` /
`api.docket.localhost` origins, `briefs.docket.localhost`, the local RP, and a local compatibility
flag override permitting the loopback API. Provider configuration retains public-only fetches.
OpenNext preview seeds local R2 automatically. Existing process/database cleanup remains; optional
`RELEASE_LOG_DIRECTORY` retains startup logs. This cleanup's new native command path still needs
runtime acceptance; previous assembler/dry-run receipts do not prove it.

The staging configuration names `docket-web-staging` and `docket-web-staging-cache` with:

| Binding                     | Staging value                                                 |
| --------------------------- | ------------------------------------------------------------- |
| `STUDIO_DEPLOYMENT_ENV`     | `staging`                                                     |
| `WEB_URL`                   | `https://docket-staging.hypertext.studio`                     |
| `API_URL`                   | `https://docket-api-staging-770668668034.us-central1.run.app` |
| `BETTER_AUTH_PASSKEY_RP_ID` | `docket-staging.hypertext.studio`                             |

These are intended frontend bindings, not proof that server auth has transitioned. Authenticated
Google Console inspection on October 11 confirmed revision `docket-api-staging-00008-4qv` at 100%
traffic and the API URL above. Its web URL, trusted origin and RP still name
`docket-staging-gilt.vercel.app`, and its allowed hosts contain that frontend and the native API.
Coordinate its
`WEB_URL`, trusted origins, allowed hosts, RP, cookie domain, enabled OAuth callbacks and Lattice
metadata/callback identity before browser acceptance; retain isolated data and secret references.
Keep the prior frontend/API configuration for recovery. Old-stage passkeys need not work under a
new RP, and competing stage publication must be reconciled after the Workers frontend is ready.

Vercel remains the active production host. Native Node Proxy middleware is experimental in this
OpenNext version. Actual upload/startup/CPU, Images/cache, abort/streaming, private-viewer/logout,
authenticated journeys and isolated staging auth/data remain required. Production cutover also
requires verified canonical/association/docs identity, complete production routing/bindings and a
reviewed restoration of the prior Vercel deployment and aliases. No provider changes, automatic
deployment, publication hold or main integration are part of this cleanup.

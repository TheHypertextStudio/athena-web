# Docket Workers operations

## Setup and native commands

Use `./bootstrap worktree prepare` and the pinned Node, pnpm, Next, OpenNext
and Wrangler packages. See the [web README](../../apps/web/README.md) for the
public build inputs and environment configuration.

```sh
pnpm exec turbo run build:worker --filter=@docket/web --concurrency=1
pnpm --dir apps/web preview:worker --env staging
```

Turbo owns the monorepo prerequisites. The application builds Next with
webpack, its existing service worker and official OpenNext output. Native
preview populates its local cache and starts Wrangler. Keep backend-dependent
local acceptance separate from provider staging.

`apps/web/wrangler.jsonc` is the source for each environment's assets, Images,
R2 cache, self-reference and public routing inputs. OpenNext owns `.open-next`
modules, assets and cache seeds. The application Worker preserves API/auth
forwarding, request-local host configuration, streaming/cookies and image TTL.
Use `cf` for Cloudflare account/resource administration.

## Protected staging

The frontend is `https://docket-staging.hypertext.studio`, using
`docket-web-staging` and `docket-web-staging-cache`. Its API remains the separate
`docket-api-staging` Cloud Run service. Match the API's web origin, trusted
origins/hosts and passkey RP to the frontend; keep the API/auth origin unchanged
and cookies host-only through the same-origin Worker gateway. See
[deployment](deployment.md#lattice-staging-boundary) for OAuth, Lattice,
data-isolation and credential-reenrollment requirements.

Keep the staging host protected by the Studio staff Access policy. Create a
separate self-hosted Access application for
`docket-staging.hypertext.studio/.well-known/lattice-client.json`, with a Bypass
policy including Everyone, so Lovelace can discover this public client document.
Use that file path without a wildcard. Access paths also cover descendants,
so protect `docket-staging.hypertext.studio/.well-known/lattice-client.json/*`
with a second application using the existing staff policy. Verify anonymous
metadata returns JSON with the staging client ID and staging API callback,
while the root, sign-in, adjacent paths and metadata descendants require
Access. Reversal removes these two metadata applications; retain the main
staff application and its policy.

The manual **Deploy Workers staging** workflow requires successful ordinary CI
for the exact main commit, a protected staging environment and a fresh main-ref
check immediately before deployment. Jobs are serialized. It builds fresh
staging output from public inputs declared in Wrangler; source publication
does not directly deploy this frontend.

Its Worker credential is limited to the staging Worker, and its S3 object
credentials are limited to the staging cache bucket. The native command is:

```sh
pnpm --dir apps/web deploy:worker --env staging --rclone --no-x-provision --env-file /dev/null
```

The protected environment supplies `CLOUDFLARE_API_TOKEN`, `CF_ACCOUNT_ID`,
`CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and
`RCLONE_S3_NO_CHECK_BUCKET=true`. OpenNext populates the selected cache before
invoking native Wrangler. `--no-x-provision` requires resources to exist.
The optional `rclone.js` peer downloads its native executable separately from
the npm lock. Keep deployment dotenv files absent; OpenNext reads them
independently of Wrangler's final `--env-file` setting.

## Local application acceptance

Use the existing disposable backend/database/browser runner:

```sh
DOCS_MINTLIFY_ORIGIN=https://docket.mintlify.dev \
RELEASE_WEB_RUNTIME=workers RELEASE_ENV_FILE=/dev/null pnpm test:release
```

The documentation origin matches the existing core-screen CI setting. Supply the same public
input for the Node reference run: `DOCS_MINTLIFY_ORIGIN=https://docket.mintlify.dev pnpm test:release`.

It owns PostgreSQL, migrations, synthetic accounts, processes and cleanup.
Its explicit local opt-in and compatibility override permit only the declared
loopback topology. Provider configs retain `global_fetch_strictly_public`.
The ordinary Node branch remains the reference. Do not introduce a second
stack, archive, lifecycle runner, identity endpoint or cache uploader.

## Production and recovery

Vercel remains the production frontend until the independently approved
Workers cutover. The source declares the production app/API, passkey and
Publishing identities. Confirm actual route ownership, TLS, bindings,
credentials and prior deployment/alias reversal before applying routes.
Use a fresh production build with matching public inputs, never staging output.

Native OpenNext `deploy:worker` and `upload:worker` both write remote cache and
provider state. `deploy` serves the new version; `upload` alone does not accept
the application. Use native version/deployment history for code rollback and
retain independent DNS/route reversal steps while prior hosting exists. Retire
superseded hosting and its DNS and deployment dependencies after Workers cutover
acceptance, with no fixed observation or recovery window. Retain source and build
configuration for redeployment; use native rollback once an accepted previous
Worker version exists.

Accept real startup/runtime behavior, Images/cache and invalidation,
streaming/abort, private-viewer/logout, auth, docs/MCP and Publishing journeys
against the selected provider. The Node Proxy middleware adapter remains
experimental, so builds and dry runs cannot establish runtime parity. Keep
native/backend publishing and ordinary CI gates; frontend cutover approval
does not replace their existing release conditions.

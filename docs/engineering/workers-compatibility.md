# Docket Workers compatibility

## Current commands and source

Use the pinned native Next/OpenNext/Wrangler packages through the scripts in
[the web README](../../apps/web/README.md):

```sh
pnpm exec turbo run build:worker --filter=@docket/web
pnpm --dir apps/web preview:worker --env staging
```

The Turbo task preserves monorepo prerequisite builds; the application script builds Next with
webpack, its existing service worker and OpenNext. Native preview populates local cache and starts
Wrangler. Native `deploy:worker` and `upload:worker` accept `--env staging` or `--env production`;
both write remote cache and provider state, and deploy serves the new version. Production requires
explicit approval and complete configuration/recovery acceptance. No automatic provider deployment
or custom candidate/promote workflow is enabled. The conventional manual staging workflow described
in the web README requires exact-main successful CI, a main-only staging environment restriction and a live main-ref
freshness check; its provider/auth prerequisites must be established before dispatch.

`wrangler.jsonc` directly bundles the application-owned Worker around `.open-next/worker.js` with
native assets, Images and environment-specific R2 cache. It preserves the API/auth gateway,
request-local host configuration, dynamic health, native streaming/cookies and the four-hour image
TTL. There is no flat-module artifact assembly, duplicate prebuilt configuration, shared Python
lifecycle, shipping-input wrapper or custom release-identity protocol.

Shared company config, genuine private package lock and Mintlify configuration generation remain.
Ordinary Node/Vercel behavior, backend/native publisher triggers, mandatory CI checks and existing
source policies remain. Completed one-off lock generation, metadata-only audit and branch-specific
manual CI plumbing have been removed. Temporary source publication holds and the proposed Vercel
main-build exclusion have also been removed. Source was integrated at `2a5ab95f` after the
authenticated production backend baseline and explicit approval of the existing automatic
backend rollout. Frontend production traffic approval remains separate.

Staging uses native OpenNext `--rclone` with S3 credentials restricted to its existing cache bucket,
`RCLONE_S3_NO_CHECK_BUCKET=true` and Wrangler `--no-x-provision`. The Worker token needs only its
staging Worker. See the web README for exact secret names, clean-checkout requirements and the
optional peer's executable-download limitation. This changes deployment authentication, not the
OpenNext cache adapters or application cache format; live upload/deployment remains pending.

## Compatibility evidence and limits

The original unchanged Next 16.2.7/OpenNext 1.19.0 experiment reached native Next compilation,
TypeScript and route generation, then failed with `Node.js middleware is not currently supported`.
The supported pair now uses Next 16.3.8/OpenNext 1.20.10, React 19.2.7 and Wrangler 4.148.0 with
Docket's existing Node Proxy. Installed peers and native packaging passed earlier. OpenNext's Node
middleware bundler is experimental and not officially maintained; no Edge rewrite or peer-range
relaxation was introduced.

Earlier local packaging/dry-run receipts and successful source CI (`38134002339`) predate this
command simplification. They do not prove the new native preview/deploy path, live Worker journeys
or provider readiness. The source cleanup permits static checks and normal mandatory commit hooks;
no new/manual tests, native build, installation or provider operations are included.

For the disposable backend/database/browser stack, use:

```sh
RELEASE_WEB_RUNTIME=workers RELEASE_ENV_FILE=/dev/null pnpm test:release
```

The existing runner uses exact local application/API/brief hosts and an explicit local opt-in;
only its CLI compatibility override permits loopback fetches. Provider configs keep
`global_fetch_strictly_public`. Native preview now seeds its own local R2 cache. Existing product
checks, migrations and cleanup are retained, while the removed custom release-marker case is
retired with its endpoint. The default Node acceptance branch remains the reference.

## Staging and production acceptance

The intended staging frontend is `https://docket-staging.hypertext.studio` against the existing
isolated API `https://docket-api-staging-770668668034.us-central1.run.app`. Authenticated Google
Console inspection on October 11 confirmed revision `docket-api-staging-00008-4qv` serving all
traffic at that API URL. Source binds the intended Workers frontend RP, but the backend's web URL,
trusted origin and RP still name `docket-staging-gilt.vercel.app`. Reconcile actual
server trusted origins/hosts/RP/cookies, OAuth and Lattice registrations before synthetic browser
auth acceptance; no new backend is required. See the web README for exact runtime bindings and
compile inputs. Do not infer provisioning or auth readiness from checked-in values.

Retain current Vercel production until actual upload/startup/CPU, native Images/cache, streaming and
abort, private-viewer/logout, authenticated and public/docs/MCP/Publishing journeys all pass on the
intended provider. Current production Worker API/RP/brief values are incomplete and fail closed.
Before production approval, verify actual bindings/domain authority, canonical/association/docs
identity and complete prior deployment/alias recovery. Record exact build/source/version identities
using native deployment metadata; no custom release endpoint is required. Provider plan limits and
runtime budgets must be checked at that time rather than inferred from old dry-run sizes.

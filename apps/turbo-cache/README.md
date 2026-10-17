# Studio Turbo cache

Private Turbo HTTP v8 remote cache on Cloudflare Workers and R2, with a separate identity and namespace for each registered Studio workspace.
Deploy configuration binds the private `studio-turbo-cache` bucket directly and exposes only
`https://turbo-cache.hypertext.studio`. R2 public access must remain disabled.

Authentication accepts Google-issued RS256 ID tokens for a registered numeric service-account subject
and the exact endpoint audience. `cache-clients.json` is the canonical identity/namespace registry:
Docket (`docket`), Curfew web (`curfew-web`), LogDate web (`logdate-web`) and private Product Admin
(`studio-product-admin`). Namespace and numeric subject uniqueness are validated during native builds;
invalid registries fail before deployment. Only the minimal subject-to-namespace map reaches the Worker.

Published repositories obtain their own identity through repository-restricted GitHub WIF. The
unpublished local administration workspace has no GitHub repository or WIF provider; its existing
Studio operator uses service-account impersonation. Each identity can read/write only its own
`namespace/artifact-hash` prefix, even when two repositories produce the same artifact hash. The
request's team selector never grants access to another client's prefix. No static cache authentication
secret, shared bearer token or R2 key is required.

Set `TURBO_API=https://turbo-cache.hypertext.studio`, `TURBO_TEAM` to the registered namespace, a fresh
ID token for that client as `TURBO_TOKEN`, and its own private `TURBO_REMOTE_CACHE_SIGNATURE_KEY`. Keep Turbo's
`remoteCache.signature` enabled. The server stores signed tags but does not know the signing key.

The native R2 lifecycle configuration expires cached objects after 14 days and unfinished multipart
uploads after seven days. Build artifacts are disposable; no Google cache migration is required.

## Deployment

Docket's native bootstrap provisions its own cache-client identity and signing key. Additional
clients require explicit registration and reviewed identity/key provisioning as described in the Studio
plugin runbook. Cloudflare deployment is separate: use an authenticated Studio `cf` profile with Worker,
Worker routing, zone-read and R2 read/write permissions. From this directory, create the bucket
once, apply its native lifecycle configuration, and deploy with the ordinary package commands:

```sh
pnpm exec cf --profile hypertext-studio-turbo-cache r2 buckets create \
  --name studio-turbo-cache --storage-class Standard --location-hint wnam
pnpm exec cf --profile hypertext-studio-turbo-cache r2 buckets lifecycle update \
  studio-turbo-cache --body @r2-lifecycle.json --force
pnpm build
pnpm exec cf --profile hypertext-studio-turbo-cache deploy --prebuilt
pnpm exec cf --profile hypertext-studio-turbo-cache r2 buckets lifecycle get studio-turbo-cache
pnpm exec cf --profile hypertext-studio-turbo-cache r2 buckets domains managed list \
  --bucket-name studio-turbo-cache
```

On later deployments, reuse the bucket rather than creating it again. Confirm public R2 access is
disabled. The authenticated Worker custom domain is the only artifact endpoint. Before changing
a client identity, read its immutable numeric subject and update only its reviewed `cache-clients.json`
entry accordingly:

```sh
gcloud iam service-accounts describe \
  docket-turbo-cache-client@athena-services.iam.gserviceaccount.com \
  --project=athena-services --account=willie@hypertext.studio --format='value(uniqueId)'
```

This shared Worker belongs to the Studio account and its existing Google identity foundation.
Adding a client requires an explicit registry entry, distinct namespace, distinct service-account
subject, reviewed repository trust (or local-only operator access), and separate signing-key
provisioning. Changing a request's team parameter or installing a shared package cannot grant access.
The Worker stores opaque client signature tags; it has no HMAC signing secret and does not use Google
storage for cache artifacts.

## Development

Deployment uses native `cf build`, `cf deploy` and `cf dev` through package scripts.
`cloudflare.config.ts` is the production configuration; public settings shared with tests live in
`src/config.ts`. Generate runtime and binding declarations with `pnpm --filter @docket/turbo-cache cf:types`.
The existing Workers test pool uses its supported July compatibility date; deployment uses October 16.

Use the root bootstrap to prepare this workspace, then the normal package tasks:

```sh
pnpm --filter @docket/turbo-cache test:coverage
pnpm --filter @docket/turbo-cache typecheck
pnpm --filter @docket/turbo-cache build
```

Tests run in workerd with real R2 bindings and RSA-signed JWTs, including every pair of distinct
client namespaces, forbidden reads/writes and identical-hash artifact isolation. The Google JWKS HTTP boundary is
intercepted with public test keys; identity verification itself is not mocked.

Cloudflare Free/Pro zones limit incoming request bodies to 100 MB. Keep each Turbo task's compressed
artifact below this limit; larger uploads return 413 and do not populate the remote cache. Downloads
stream without buffering the complete artifact. Runtime validation must include a real Turbo cache
hit with an empty local cache, large streamed artifacts and unauthorized/signature failure cases.

See `UPSTREAM.md` for the pinned implementation, license and reviewed adaptations.

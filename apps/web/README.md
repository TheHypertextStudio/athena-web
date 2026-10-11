# Docket web

The existing Next.js application owns marketing, application pages, request-time authentication
entry gates, Publishing host routing and browser-facing API/auth forwarding. Hono owns backend
state and Scalar API documentation. Mintlify continues to publish `../docs`; see
[docs authoring](../../docs/engineering/docs-authoring.md).

## Setup and daily commands

From the repository root, use the shared frontend lifecycle:

```sh
./run setup
./run doctor
./run check
./run dev
./run build
```

`./run` is a thin facade for `apps/web/run`, pinned to the verified shared release in
`studio.lock.json`. The frontend declaration lives here so shared setup does not reinterpret the
legacy root `bootstrap` interface. pnpm still installs from the repository workspace and frozen
lockfile. `./bootstrap` and `scripts/dev-stack.sh` continue to own the full backend development
stack, migrations, topology, passkey setup and local application data. Read
[UI verification](../../docs/engineering/ui-verification.md) before starting that stack.

Node 24.20.0 and pnpm 11.9.0 are the company frontend baseline. ESLint and TypeScript compose
`@thehypertextstudio/web-config` with Docket's existing strict domain, UI ownership, security and
complexity policies. Prettier retains the existing Tailwind class ordering. The four common docs
commands are available at the root: `pnpm docs:config`, `pnpm docs:config:check`, `pnpm docs:dev`
and `pnpm docs:check`.

## Workers migration checkpoint

The lifecycle selects `pnpm --dir apps/web build:worker:shipping`. Its wrapper validates inputs
before the existing Turbo graph and pins only the reviewed public compile identity:
`NEXT_PUBLIC_APP_URL=https://clearthedocket.com`,
`NEXT_PUBLIC_API_URL=https://api.clearthedocket.com`,
`NEXT_PUBLIC_PASSKEY_RP_ID=clearthedocket.com` and
`DOCS_MINTLIFY_ORIGIN=https://docket.mintlify.dev`. Conflicting values, other `NEXT_PUBLIC_*`
inputs, validation bypasses, runtime routing/legacy-RP inputs and local assembly opt-ins are
rejected by name without printing values. App-local `.env`, `.env.local`, `.env.production` and
`.env.production.local` paths are rejected, including symlinks, without reading their contents.
The web client schema requires no backend or fixture secret. Runtime staging destinations must
be supplied separately to the same shipping bytes; these compile identities do not authorize
provider resources, publication or staging backend access.

From the repository root, `pnpm --dir apps/web build:worker` runs the existing Turbo dependency
graph before native Next/OpenNext packaging. It no longer implicitly loads root `.env.local` or
reads `STUDIO_ENV_FILE`. Supply reviewed build inputs explicitly through the calling environment;
never load production secrets for local compatibility acceptance. Next can still load app-local
`.env*` files, so isolated acceptance must establish that those are absent. The native worker build
sets `DOCKET_WORKERS_BUILD=1`, freezing `DOCKET_RUNTIME_TARGET=workers`; the ordinary Node/Vercel
build retains its existing API rewrites and environment behavior.

The Workers target omits baked backend rewrites. Actual requests require explicit native runtime
bindings: `API_URL`, `WEB_URL`, `BETTER_AUTH_PASSKEY_RP_ID`, `STUDIO_DEPLOYMENT_ENV`, and optional
`PUBLIC_BRIEF_HOST` / `BETTER_AUTH_PASSKEY_LEGACY_RP_ID` metadata. Production requires the brief
host. These are validated per request and read through native OpenNext request context in Proxy
and brief SSR; missing or invalid Worker routing returns unavailable instead of falling back to
production. Do not guess provider hosts or resources. Public build identity still controls static
brand/SEO construction; runtime bindings do not rewrite compiled values or approve a shipping
candidate. Worker client request metadata uses the existing public-config boundary below.

For recognized application hosts, only exact `GET /v1/config` adds the validated runtime
`apiOrigin`, `sandboxOrigin` (the API origin hosting `/mcp/apps/sandbox`) and nullable `briefHost` to
a real backend config. The app-local schema retains backend fields, capabilities and RP metadata.
The frozen Workers query requires all three additions; Node/Vercel keeps the raw backend RPC
fetcher and existing consumer behavior, with no backend DTO or Node endpoint change. The existing
query key and `STALE.static` in-memory policy are unchanged; HTTP no-store controls the wire/cache
contract.

This exact GET requests an unconditional full response and permits only a body-bearing 200 JSON
config, capped at 16 KiB decoded input and serialized UTF-8 output. Invalid/unexpected success or
304 returns safe 502/no-store; backend errors and supported redirects retain their bodies.
Transformed responses remove body validators, encoded/range metadata and CDN cache overrides,
then set no-store. Ordinary API methods/paths retain streaming and conditional caching; native
cookies, manual redirects, query strings, cancellation and existing security remain preserved by
the gateway. Source validation and retained runtime/provider acceptance are separate gates.

The existing `scripts/prepare-worker-acceptance.ts` generates a separate local-only config from
explicit `docket.localhost` and `api.docket.localhost` origins and requires the exact local brief
host `briefs.docket.localhost`. The release runner explicitly overrides both runtime/public brief
vars only for Workers, preventing dotenv from importing the tracked example’s production brief
host; its Node branch is unchanged. The helper sets `DOCKET_LOCAL_ACCEPTANCE=1`
and removes public-network restrictions only from that disposable config. Provider source configs
retain `global_fetch_strictly_public`, and artifact assembly rejects the local opt-in. Static
hostname checks cannot establish DNS ownership or complete private-address isolation.

Vercel remains the active publisher. The isolated compatibility branch uses exact Next 16.3.8 and
OpenNext 1.20.10, retaining React 19.2.7 and the existing Node Proxy. Native Node middleware is
experimental and is not officially maintained by OpenNext. Explicit-local compatibility packaging
and the clean shipping entrypoint both passed native packaging and Wrangler dry run; the latter
required no caller public/runtime inputs, fixture secret, app mode or validation bypass. These are
source/build checks, not a signed lifecycle candidate or live runtime acceptance. Native request, streaming/cookie,
authentication, private-cache, isolated backend/resource and provider acceptance remain open.

`wrangler.jsonc` bundles the TypeScript entrypoint. Source-controlled `wrangler.site.jsonc` describes
the retained flat modules and is available before build for binding snapshots. Both are strict JSON,
enforced by the scoped formatter; assembly rejects provider/configuration drift and copies the
prebuilt source bytes unchanged. Shared v0.1.8 owns eventual provider deployment and cache seeding.
Publication channels, deployment declarations and callers remain inactive. The declared account ID
and Wrangler 4.148.0 pin record verified ownership/tooling, not resource existence or deployment
readiness. No frontend secret binding is introduced by this runtime metadata contract.

Shared packages 0.0.1 are published. The canonical lock was adopted from the independently
reviewed native registry/frozen/strict-peer run 38124448126; current source/build checks retain
separate evidence and limitations in `docs/WORKLOG.md`. Local installed-graph warnings and local
artifacts do not replace hosted source checks or runtime/provider acceptance. Vercel stays active
until all acceptance and observation gates pass.

See [Workers compatibility and recovery](../../docs/engineering/workers-compatibility.md) for the
observed native rejection, remaining dependency choices and provider acceptance gates.

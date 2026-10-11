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

`pnpm build:worker` loads the existing root `.env.local` with the native dotenv CLI, then runs the existing Turbo dependency graph before native Next/OpenNext packaging. Explicit environment values retain precedence; isolated acceptance sets `STUDIO_ENV_FILE=/dev/null`.
Vercel remains the active publisher. The isolated compatibility branch uses exact Next 16.3.8 and OpenNext 1.20.10, retaining React
19.2.7 and the existing Node Proxy. Native Node middleware is experimental and is not officially
maintained by OpenNext. The retained local Worker runs through the existing disposable release
runner; provider, complete authentication and the full release gate remain separate requirements.

`wrangler.jsonc` bundles the TypeScript entrypoint. Source-controlled `wrangler.site.jsonc` describes
the retained flat modules and is available before build for binding snapshots. Both are strict JSON,
enforced by the scoped formatter; assembly rejects provider/configuration drift and copies the
prebuilt source bytes unchanged. Shared v0.1.8 owns eventual provider deployment and cache seeding.
Publication channels, deployment declarations and callers remain inactive.

Shared packages 0.0.1 are published. This product still needs approved registry access, its actual
registry lock and fresh frozen consumer acceptance; local shipping-tarball validation does not
satisfy that gate. Vercel stays active until all acceptance and observation gates pass.

See [Workers compatibility and recovery](../../docs/engineering/workers-compatibility.md) for the
observed native rejection, remaining dependency choices and provider acceptance gates.

# Local development

## Initial setup on macOS or Linux

From a fresh clone, run:

```sh
./bootstrap
```

The checked-in launcher is the only setup API a person or automation needs to learn. It checks Git,
Node.js, and the repository-pinned pnpm toolchain; installs locked dependencies; reconciles the safe
local configuration; installs repository-owned Git hooks and Conventional Commit scopes; migrates
the database; and runs the returning-user passkey journey against an isolated temporary database.
Only after that journey passes does it start the normal development stack.

No global bootstrap installation, Docker daemon, local TLS certificate, `sudo`, cloud account, or
provider credential is required. If Node.js, Corepack, or Git is missing, `./bootstrap check` names
the missing prerequisite and the kind of installation required rather than failing later in an
unrelated package command.

The deterministic stack uses explicit adjacent HTTP ports and bypasses the machine-wide reverse
proxy:

| App              | Main-checkout origin                 |
| ---------------- | ------------------------------------ |
| `@docket/web`    | `http://docket.localhost:1355`       |
| `@docket/api`    | `http://api.docket.localhost:1356`   |
| `@docket/admin`  | `http://admin.docket.localhost:1357` |
| `@docket/runner` | `http://127.0.0.1:1358`              |

Linked worktrees add the branch name before each `.docket.localhost` host. Bootstrap prints the
exact origins; never guess or hardcode the prefix. The committed `.env.local` remains the canonical
safe local configuration. Runtime topology overrides are applied only to the child processes and do
not rewrite that file.

Useful lifecycle commands:

```sh
./scripts/dev-stack.sh status
eval "$(./scripts/dev-stack.sh env)"
./scripts/dev-stack.sh stop
./bootstrap verify local
```

The default `DATABASE_URL=pglite://.data/docket` is embedded and persistent. Bootstrap verification
uses a separate temporary PGlite directory and deletes only that directory, so it never seeds,
resets, or inspects the developer database. To opt into Docker Postgres, run `pnpm db:up` and set
`DATABASE_URL=postgres://docket:docket@localhost:5433/docket` in `.env.local`.

The environment defaults are checked against the typed registry by
`packages/env/tests/env-files/env-files.test.ts`. Bootstrap additionally verifies that the API,
browser, Better Auth, WebAuthn relying-party, cookie-domain, MCP, and OIDC values describe one
consistent origin set.

## Version-control guardrails

Bootstrap installs checkout-local hooks after the pinned repository dependencies are available.
It does not require or modify a global hook manager. Rerunning bootstrap compares the effective Git
configuration and generated hook bytes before writing, so an already-converged checkout is left
unchanged.

The repository reads Conventional Commit scopes from `COMMIT_SCOPES.txt`. Its `commit-msg` hook
enforces that policy; `pre-commit` scans for secrets, runs staged formatting and linting, and checks
the design-token policy; `pre-push` runs typecheck, lint, and the full test graph. Merge-commit hooks
enforce the repository's linear-history policy, while local Git configuration uses rebase and
fast-forward-only pulls. Personal author identity and global Git preferences remain untouched.

## Optional Portless HTTPS mode

Portless is not required for ordinary development or acceptance. Use it only when an advanced flow
requires stable port-free HTTPS names, such as a real OAuth provider or inbound webhook tunnel.
`pnpm proxy:install` runs `portless service install`. **Read this before running it** — it
changes machine-wide state and asks for `sudo`.

What it does:

- **Installs a native OS service** (macOS `launchd` / Linux `systemd` / Windows Task
  Scheduler) that runs the portless HTTPS reverse proxy and **starts it at boot**. The
  proxy keeps running in the background until you uninstall it.
- **Binds privileged port 443** so the `.localhost` URLs work over plain `https://`
  without a port suffix. Binding 443 is why it needs **`sudo` — once**, at install time.
  Afterwards each app's `portless` call just registers a route with the already-running
  proxy: no more `sudo`, and no port-binding race when the three `dev` servers start in
  parallel under turbo.
- **Generates a local Certificate Authority and adds it to your system/browser trust
  store**, so `https://*.docket.localhost` is trusted with no warnings (the same idea as
  `mkcert`).
- **May edit `/etc/hosts`** to resolve the `.localhost` names (needed for Safari).

Implications / things to know:

- **Security:** a local CA private key now lives on your machine. Anyone who obtains it
  could mint trusted certs for your browser (standard local-dev trade-off, same as
  `mkcert`). Remove it when you're done (below).
- **Port conflict:** the proxy owns 443. If something else needs 443 locally, stop the
  service first.
- **It persists:** the proxy runs at every boot until you uninstall it — it is not tied
  to a terminal session.

Manage it:

```bash
pnpm proxy:status      # is the service installed / running?
pnpm proxy:uninstall   # remove the startup service
portless clean         # fully revert: drop the CA trust, /etc/hosts entries, and state
```

No `sudo` available (CI, locked-down machines)? Use the standard `./bootstrap` and explicit-port
stack. Do not start another unprivileged Portless proxy on the ports owned by `dev-stack.sh`.

## `.env.local` — committed defaults, protected edits

`.env.local` is **committed** with safe, non-secret local defaults (`.env.example` remains
the full contract / production template), so `./bootstrap` works on a fresh clone with no copy
step. To stop real secrets you add locally from being committed by accident, dependency installation
(via the `prepare` script) arms it with:

```bash
git update-index --skip-worktree .env.local
```

That tells git "this file is tracked, but ignore my local changes to it." So:

**Editing your own copy (the normal case).** Just edit `.env.local` — add real keys, change
ports, whatever. Git won't show it in `git status` and you can't commit it by accident.
Nothing else to do.

**Intentionally changing the committed defaults (for everyone).** Un-arm, edit, commit through the
repository's normal atomic staging workflow, and re-arm:

```bash
git update-index --no-skip-worktree .env.local    # 1. stop ignoring local changes
# 2. edit .env.local
git update-index --skip-worktree .env.local       # 3. re-arm after the commit
```

**Footgun — upstream changes.** Because git is ignoring your local copy, if the committed
`.env.local` changes **upstream**, `git pull` can refuse to overwrite your version. Recover:

```bash
git stash --include-untracked                     # back up your local edits
git update-index --no-skip-worktree .env.local    # unprotect
git pull
git update-index --skip-worktree .env.local       # re-arm
git stash pop                                      # reapply your edits
```

## Running without bootstrap

```bash
./scripts/dev-stack.sh start
```

For automated verification—driving the app headlessly, signing in, or taking screenshots—follow
[`engineering/ui-verification.md`](engineering/ui-verification.md). `pnpm dev` remains the optional
Portless HTTPS path and is not an acceptance boundary.

`turbo` resolves the task graph natively — `//#db:up` (Docker Postgres) →
`@docket/db#db:migrate` → each app's `dev` — so the database is up and migrated before the
servers start. No shell chaining required.

## Tunnels & local OAuth (real Google/GitHub locally)

`APP_MODE=local` runs every connector against **mock** adapters, so most dev needs no tunnel. You
only need the below to exercise **real** OAuth (linking a real Google/GitHub account) or **inbound
webhooks** (the GitHub firehose) locally. It is driven by `pnpm bootstrap:project` (Phase 1)—there is
no separate tunnel command.

**Why a tunnel at all:** Google rejects `*.docket.localhost` redirect URIs (non-public TLD), and a
per-dev tunnel URL can't be self-registered on the shared Google OAuth client. So OAuth goes through
**one shared, registered anchor** + Better Auth's `oAuthProxy` (mounted when `OAUTH_PROXY_SECRET` +
`OAUTH_PROXY_PRODUCTION_URL` are set — `packages/auth/src/auth-builder.ts`).

### Per-dev: link real accounts locally (turnkey)

`pnpm bootstrap:project` → answer **yes** to "Link real Google/GitHub via the team OAuth proxy", and paste
the shared anchor URL + `OAUTH_PROXY_SECRET` (from the team secret store). That's it — no tunnel, no
Google registration on your part. Your local sign-in relays through the anchor's registered callback.

### Set up a persistent tunnel (real OAuth + webhooks) — `pnpm bootstrap:project` does it

`pnpm bootstrap:project` → answer **yes** to "Set up a persistent cloudflared tunnel". It **does the work**,
not just print it:

1. ensures `cloudflared` is installed (offers `brew install` if missing);
2. runs `cloudflared tunnel login` if you have no cert yet (opens your browser for your Cloudflare zone);
3. creates/reuses a named tunnel and **routes DNS** for the hostname you give (a subdomain on your zone);
4. writes `~/.cloudflared/config.yml` with a **split ingress** (so **`pnpm dev` must be running** — it
   reads the API's port from `~/.portless/routes.json`):
   - `/(api|v1)/*` → **straight to the local API port** (`http://127.0.0.1:<apiPort>`), preserving the
     public `Host`. This is load-bearing for OAuth: portless rewrites the upstream `Host` to its
     loopback address (the real host survives only in `X-Forwarded-Host`) and Next's rewrite then
     re-derives _its_ forwarded host from that loopback — so going through portless makes Better Auth
     resolve the token-exchange `redirect_uri` to a `.localhost` host instead of the tunnel host Google
     saw, → `invalid_grant` → `invalid_code`. Direct routing keeps `Host = <tunnel>` end-to-end;
   - everything else → the portless **web** host `https://docket.localhost` (`noTLSVerify` +
     `httpHostHeader`, since portless routes by name and serves a local-CA cert).
5. makes it **persistent via a user LaunchAgent** (`~/Library/LaunchAgents/studio.hypertext.docket-tunnel.plist`)
   — runs at login, no sudo. (Avoids `cloudflared service install`, whose root daemon can't read your
   `~/.cloudflared` config and ships a non-functional plist on recent versions.)
6. adds the host to `BETTER_AUTH_ALLOWED_HOSTS` + `BETTER_AUTH_TRUSTED_ORIGINS` in `.env.local`.
   `BETTER_AUTH_ALLOWED_HOSTS` is the single source of truth — it also flows to each app's
   `next.config.ts` `allowedDevOrigins`, so Next 16 doesn't block the origin's HMR.

**Session cookie sharing (`BETTER_AUTH_COOKIE_DOMAIN`).** The `oAuthProxy` social flow relays the
callback through `api.docket.localhost` and writes the session there, but the app runs on
`docket.localhost` — a host-only cookie would be invisible to it. `.env.local` sets
`BETTER_AUTH_COOKIE_DOMAIN=docket.localhost`, which scopes the session cookie to the shared parent so
all `*.docket.localhost` hosts see it. The sign-in buttons also pass an **absolute** `callbackURL` on
the current origin, so the post-login redirect lands on the app host (not the API host). A new
`BETTER_AUTH_COOKIE_DOMAIN` value needs a full `pnpm dev` restart (it's loaded by the root
`dotenv -e .env.local`, not hot-reloaded).

Only **two** things are left to you (bootstrap prints both):

- In your Google OAuth client: add redirect URI `https://<host>/api/auth/callback/google` + JS origin
  `https://<host>` (a public TLD like `*.hypertext.studio` — Google accepts it).
- Restart `pnpm dev` (so the API loads the new `BETTER_AUTH_ALLOWED_HOSTS`), then open `https://<host>`.

To anchor the shared OAuth proxy for OTHER devs, this same tunnel is the anchor: register it once in
Google, run an always-on instance behind it, and hand teammates `OAUTH_PROXY_*` (the section above).

**Sign in with Apple.** Apple's OAuth is web-only here and shows up automatically on the sign-in/up
screens once configured. Unlike the other providers it needs **four** vars, all-or-nothing —
`APPLE_CLIENT_ID` (the **Services ID**, e.g. `com.docket.web`), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and
`APPLE_PRIVATE_KEY` (the downloaded `.p8` PKCS#8 PEM; store it with escaped `\n` on one `.env` line —
`@docket/auth` normalizes it back before signing). There is no `APPLE_CLIENT_SECRET`: the secret is a
short-lived ES256 JWT minted from the `.p8` at server boot (`generateAppleClientSecret`), so it never
silently expires — a restart re-mints it. Apple **rejects `localhost` and non-HTTPS**, so you can only
exercise it over the HTTPS tunnel above (or a preview deploy), never on plain `.localhost`. In the
Apple Developer console the Services ID's return URL must be `https://<host>/api/auth/callback/apple`;
`https://appleid.apple.com` is added to `trustedOrigins` for you (Apple posts the callback from there).

### Webhooks

- **GitHub firehose** — handled by the **shared dev GitHub App** → the shared anchor's
  `/v1/ingest/github`; real events are exercised on the shared instance. (For an isolated personal
  firehose, the same `pnpm bootstrap:project` tunnel step exposes your own stack—point a personal GitHub
  App's webhook at it.)
- **Stripe** — no tunnel; use the Stripe CLI (`stripe listen`), and locally the billing gateway is
  mocked anyway. Note the handler path is `POST /internal/billing/webhook`
  (`apps/api/src/routes/webhooks.ts`), not the `@better-auth/stripe` `/api/auth/stripe/webhook`
  some older docs reference.

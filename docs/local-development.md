# Local development

Docket dev servers run behind [portless](https://github.com/vercel-labs/portless),
which gives each app a stable named URL instead of a port number:

| App             | URL                            |
| --------------- | ------------------------------ |
| `@docket/web`   | https://docket.localhost       |
| `@docket/admin` | https://admin.docket.localhost |
| `@docket/api`   | https://api.docket.localhost   |

## One-time setup

```bash
pnpm install          # install deps; also arms the .env.local protection (see below)
pnpm proxy:install    # install the portless HTTPS proxy as an OS service (sudo once)
pnpm dev              # start everything
```

`.env.local` is already committed with working local defaults, so there's no file to
copy — `pnpm dev` runs out of the box. Docker must be running (the DB starts automatically).

## `pnpm proxy:install` — what it does and its implications

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

No `sudo` available (CI, locked-down machines)? Skip the service and run the proxy on an
unprivileged port instead — `portless proxy start --port 1355 --https` — but then the URLs
carry the port (e.g. `https://docket.localhost:1355`).

## `.env.local` — committed defaults, protected edits

`.env.local` is **committed** with safe, non-secret local defaults (`.env.example` remains
the full contract / production template), so `pnpm dev` works on a fresh clone with no copy
step. To stop real secrets you add locally from being committed by accident, `pnpm install`
(via the `prepare` script) arms it with:

```bash
git update-index --skip-worktree .env.local
```

That tells git "this file is tracked, but ignore my local changes to it." So:

**Editing your own copy (the normal case).** Just edit `.env.local` — add real keys, change
ports, whatever. Git won't show it in `git status` and you can't commit it by accident.
Nothing else to do.

**Intentionally changing the committed defaults (for everyone).** Un-arm, edit, commit, re-arm:

```bash
git update-index --no-skip-worktree .env.local    # 1. stop ignoring local changes
# 2. edit .env.local
git add .env.local && git commit -m "chore: update local env defaults"
git update-index --skip-worktree .env.local       # 3. re-arm (also re-done by `pnpm install`)
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

## Running

```bash
pnpm dev
```

`turbo` resolves the task graph natively — `//#db:up` (Docker Postgres) →
`@docket/db#db:migrate` → each app's `dev` — so the database is up and migrated before the
servers start. No shell chaining required.

## Tunnels & local OAuth (real Google/GitHub locally)

`APP_MODE=local` runs every connector against **mock** adapters, so most dev needs no tunnel. You
only need the below to exercise **real** OAuth (linking a real Google/GitHub account) or **inbound
webhooks** (the GitHub firehose) locally. It is all driven by `pnpm bootstrap` (Phase 1) — there is
no separate tunnel command.

**Why a tunnel at all:** Google rejects `*.docket.localhost` redirect URIs (non-public TLD), and a
per-dev tunnel URL can't be self-registered on the shared Google OAuth client. So OAuth goes through
**one shared, registered anchor** + Better Auth's `oAuthProxy` (mounted when `OAUTH_PROXY_SECRET` +
`OAUTH_PROXY_PRODUCTION_URL` are set — `packages/auth/src/auth-builder.ts`).

### Per-dev: link real accounts locally (turnkey)

`pnpm bootstrap` → answer **yes** to "Link real Google/GitHub via the team OAuth proxy", and paste
the shared anchor URL + `OAUTH_PROXY_SECRET` (from the team secret store). That's it — no tunnel, no
Google registration on your part. Your local sign-in relays through the anchor's registered callback.

### Maintainer one-time: stand up the shared anchor

Run an always-on Docket instance behind a persistent **cloudflared named tunnel** on the team
Cloudflare zone, register it once, and distribute `OAUTH_PROXY_SECRET`. `pnpm bootstrap` → answer
**yes** to "Set up a persistent cloudflared tunnel"; it prints the exact commands + `config.yml` and
the URLs to register. The tunnel fronts the portless **web** host (`https://docket.localhost`), whose
Next rewrites proxy `/api/auth` + `/v1` to the API, so one ingress covers OAuth **and** the GitHub
firehose. Origin uses `noTLSVerify` + `httpHostHeader` because dev ports are ephemeral (target the
stable portless host) and portless serves a local-CA cert. Then register once:

- Google → Authorized redirect URI `https://<anchor>/api/auth/callback/google`, JS origin `https://<anchor>`
- Shared dev GitHub App → webhook `https://<anchor>/v1/ingest/github`

The anchor host is added to `BETTER_AUTH_ALLOWED_HOSTS` (the single source of truth — it also flows
to each app's `next.config.ts` `allowedDevOrigins`, so Next 16 doesn't block the origin's HMR).

### Webhooks

- **GitHub firehose** — handled by the **shared dev GitHub App** → the shared anchor's
  `/v1/ingest/github`; real events are exercised on the shared instance. (For an isolated personal
  firehose, the same `pnpm bootstrap` tunnel step exposes your own stack — point a personal GitHub
  App's webhook at it.)
- **Stripe** — no tunnel; use the Stripe CLI (`stripe listen`), and locally the billing gateway is
  mocked anyway. Note the handler path is `POST /v1/billing/webhook`
  (`apps/api/src/routes/webhooks.ts`), not the `@better-auth/stripe` `/api/auth/stripe/webhook`
  some older docs reference.

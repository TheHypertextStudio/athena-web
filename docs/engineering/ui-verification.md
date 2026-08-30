# Verifying UI in a worktree

**Everything you need already exists. Do not build your own dev stack, sign-in flow, or screenshot
harness.** This page is the whole procedure, in order, with the traps that make each step fail.

Read this before running a dev server from a worktree. An agent that skips it reliably spends an
hour rediscovering the same four environment problems and then hand-rolls tools that are already
committed here.

---

## The three commands

```bash
bash scripts/dev-stack.sh start
```

Brings the whole stack up in the CI topology — plain HTTP on `:1355`, branch-prefixed hostnames —
and blocks until web, API, and the OIDC discovery document all answer `200`. It prints `READY` plus
the exact env to export. It is idempotent: it stops anything already running first.

```bash
eval "$(bash scripts/dev-stack.sh env)"
```

Exports `APP_URL`, `API_URL`, and `PASSKEY_RP_ID` for this worktree's branch. Every command below
reads them. Do not hardcode a hostname — the prefix comes from the git branch, so it differs per
worktree.

```bash
cd apps/web
APP_URL="$APP_URL" PASSKEY_RP_ID="$PASSKEY_RP_ID" \
  pnpm exec tsx e2e/tools/dev-session.ts --label=<what-you-are-auditing> \
  --out=playwright/.auth/<name>.json
```

Signs up a throwaway account through the real passkey ceremony using a CDP virtual authenticator,
and writes a Playwright `storageState` plus a `<name>.json.meta.json` carrying `email`, `orgId`, and
`baseURL`. **This is how you get an authenticated session.** There is no password to type around,
and an agent must never enter credentials.

Requires `APP_MODE=local` (already set in the committed `.env.local`) so `/sign-up/request-code`
echoes the verification code in-band.

---

## Screenshots

```bash
cd apps/web
APP_URL="$APP_URL" pnpm exec tsx e2e/tools/capture-shots.ts \
  --session=playwright/.auth/<name>.json --out=.data/design-review/<date> /today /orgs/:orgId/agents
```

Captures the standard shot set — 1440×900 and 390×844, light and dark — for every route given, and
runs a 320px horizontal-overflow check. `:orgId` and `:sharedOrgId` in a route are substituted from
the session; the shared workspace is created through the session if it does not exist yet.

Do not write your own Playwright screenshot script. This one already handles cold-route compilation,
theme emulation, the settled-page check, and the overflow assertion.

For a full craft review rather than raw captures, use the `design-review` skill
(`.claude/skills/design-review/`), which consumes exactly this shot set.

## Driving the page in the Browser pane

The `docket-web` entry in `.claude/launch.json` starts portless with **TLS**, which headless
Chromium rejects (`ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`). Do not use it for automated verification.

Start the stack with `dev-stack.sh` instead, then point the Browser pane at the origin it prints:

```
preview_start { url: "<APP_URL>" }
```

`preview_start` takes a plain `url`, so no launch-config entry is needed and no second server gets
started.

---

## Seeding data

A fresh `dev-session.ts` account is **empty**. Screenshots of it only ever show empty states, which
is not coverage. Seed through the API with the session cookie:

```js
const state = JSON.parse(readFileSync(`${STATE}`, 'utf8'));
const orgId = JSON.parse(readFileSync(`${STATE}.meta.json`, 'utf8')).orgId;
const cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
// then POST /v1/orgs/:orgId/projects, /tasks, /v1/daily-plan … with { cookie, origin: APP_URL }
```

Three things that will bite:

- **`teamId` is required on a task.** Read it from `GET /v1/orgs/:orgId/teams` first.
- **The assignee is an `actorId`, not a user id**, and it comes from `GET /v1/orgs/:orgId/members`
  as the `actorId` field — the roster rows have no `id`. Several Hub queries (`needsAttention.blocked`
  among them) only match tasks assigned to the caller, so an unassigned seed produces an empty
  section and looks like a bug in the page.
- **Use the Hub's date, not UTC.** `new Date().toISOString().slice(0, 10)` is the UTC day. After
  ~16:00 US Pacific that is already tomorrow, so every `daily-plan` row lands on a date the page is
  not showing and the plan renders empty. Read the timezone from `GET /v1/hub/preferences` and
  format with `toLocaleDateString('en-CA', { timeZone })`.

---

## The database is shared with the API test suite

`.env.local` sets `DATABASE_URL=pglite://.data/docket` — a **file-backed** database that the dev
stack and `@docket/api`'s vitest suite both read.

**Seeding dev data breaks API tests.** They assert on list contents, and your seeded projects and
tasks are in the same tables. If `apps/api` tests fail on counts or list membership right after you
seeded, that is why.

```bash
pnpm db:reset   # then re-run the tests before concluding anything about them
```

Run this before trusting `pnpm test`, and re-run failing API tests after resetting to tell a real
failure from your own fixtures.

---

## When something will not start

| Symptom                                                                  | Cause                                                                                                                  | Fix                                                                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Another next dev server is already running`                             | A `next dev` survived the stop and holds `.next/dev`'s lock                                                            | The message names the PID — `kill <pid>`, then `rm -r apps/web/.next/dev`                             |
| Opaque TLS `EPROTO` / `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR` on auth calls | Talking to the portless `:443` HTTPS aliases                                                                           | Use `dev-stack.sh`, which runs `--no-tls` on `:1355`                                                  |
| 502s from a stack that just started                                      | Bare `docket.localhost` portless aliases are first-come and are not re-pointed when an older worktree's stack dies     | `dev-stack.sh` addresses this worktree by its own branch-prefixed hostnames; never use the bare alias |
| Passkey ceremony fails with `CHALLENGE_NOT_FOUND`                        | `BETTER_AUTH_COOKIE_DOMAIN` does not cover the origin being driven                                                     | `dev-stack.sh`'s topology is consistent by construction; do not hand-roll the origins                 |
| `dev-session.ts` times out waiting for `#name`                           | `next dev` compiles a route on first request, and the cold compile outruns the tool's own timeout                      | `curl` the route once to warm it, then re-run                                                         |
| Env overrides silently ignored                                           | `dotenv-cli`'s `-o/--override` makes the **file** win over the environment — the opposite of what the flag sounds like | Put exports inside the child: `dotenv -e .env.local -- bash -c 'export FOO=…; …'`                     |

## What not to do

- Do not run `pnpm dev` directly for automated verification; it depends on the privileged portless
  `:443` proxy and fails opaquely when that daemon is unhealthy.
- Do not add a launch-config entry, script, or `.env` file to work around any of the above. Every
  one of these problems is already solved by `dev-stack.sh`; a second path is a second thing to keep
  correct.
- Do not write a screenshot script. Use `capture-shots.ts`.
- Do not use `pkill` on an unqualified pattern to clean up. `dev-stack.sh stop` scopes it, and a
  stray `next dev` should be killed by the PID its own error message prints.

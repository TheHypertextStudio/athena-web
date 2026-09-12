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

Brings the whole stack up on four adjacent HTTP ports with branch-prefixed hostnames. It bypasses
Portless completely and blocks until all four processes, the auth routes, API health, and OIDC
discovery answer `200`. It prints `READY` plus the exact env to export.

**Each checkout gets its own port block, and this matters.** The primary checkout uses web `1355`,
API `1356`, admin `1357`, runner `1358`. A worktree hashes its git dir into a stride-4 block from
`1400` up, and probes forward if that block is taken. Read the ports off `dev-stack.sh env` rather
than assuming them; `DOCKET_DEV_PORT` still pins the range by hand.

The reason is that every host here is a `*.docket.localhost` name, and the whole `.localhost` TLD
resolves to `127.0.0.1`. The branch prefix decorates the _name_ and does nothing to the _address_.
When two worktrees shared port `1355`, whichever bound it first served both, so requests to
`b.docket.localhost:1355` reached worktree A's server — which rejected them against its own origin
allowlist, or answered from another migration's schema. The symptom looks exactly like an auth
regression or a broken config in your own branch, and one session lost an hour to that diagnosis
before the port was the answer.

`status` now refuses to report healthy unless the process listening on the web port has a working
directory inside this checkout, and prints the foreign listener's pid and cwd when it does not. If
you see that message, stop the other stack or set `DOCKET_DEV_PORT`; do not trust anything you
verified against those URLs beforehand.

---

## One resolver owns every host and port

**`@docket/dev-topology` decides which hostnames and ports a checkout serves. Do not write a dev
host, a port, or a list of host-bearing variables anywhere else.**

That knowledge used to live in five files at once — the checked-in `.env.local`,
`scripts/portless-env.ts`, `apps/api/src/dev-env.ts`, `scripts/dev-stack.sh`, and
`.claude/launch.json` — each with its own hand-written list of the variables that name a host. Two
of those lists had already drifted: the copy in `apps/api/src/dev-env.ts` was missing
`MCP_ISSUER_URL`, `MCP_RESOURCE_URL`, `MCP_ALLOWED_ORIGINS` and `OIDC_LOGIN_PAGE_URL`, so a
restarted API in a worktree issued MCP tokens for the canonical origin and sent OIDC logins to
another checkout's sign-in page. `ADMIN_URL` existed in one topology and not the others, so the
admin-origin check failed closed under `pnpm dev` and passed under `dev-stack.sh`.

A drifted list never fails as a configuration error. It fails as `Invalid origin`, as a
`Set-Cookie` the browser drops silently, as a passkey `CHALLENGE_NOT_FOUND`, or as a 404 on a route
that exists — later, in a different subsystem, and reliably misdiagnosed as an auth bug.

Two modes consume the one resolver:

| Mode               | Entry point            | How it gets addresses                                                         |
| ------------------ | ---------------------- | ----------------------------------------------------------------------------- |
| **Portless**       | `pnpm dev`             | Portless assigns a host and free port; the launcher corrects the env to match |
| **Explicit ports** | `scripts/dev-stack.sh` | The resolver derives a port block from the checkout; no proxy in the path     |

`repo-tests/tooling/dev-topology-ownership.test.ts` fails the build when a sixth copy appears.

### The launchers refuse to start on a contradiction

`scripts/portless-env.ts` and `apps/api/src/dev-env.ts` run a consistency check after correcting
the environment, and **exit rather than starting the app** when the values still describe more than
one stack. The message names the two variables that disagree and the symptom their disagreement
produces. Starting anyway is what turned a one-line configuration problem into an afternoon.

### `pnpm dev:doctor`

```bash
pnpm dev:doctor
```

Prints this checkout's hosts and ports for both modes, names any process from another checkout
holding a port in this block (with its pid and cwd), and reports whether the environment a launcher
would produce is coherent. Run this first when something host-related is not working — it is the
answer to "why is this env variable wrong" that used to take an afternoon of reading auth logs.

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

`.claude/launch.json` has one entry, `docket-stack`, and it runs `dev-stack.sh start`. The two
entries it replaced each declared their own hosts — one of them set a _prefixed_ passkey
relying-party id, which excludes the sibling API host and breaks the ceremony, and the other moved
the whole stack to `localhost:4000/4001` with the cookie domain blanked.

Start the stack, then point the Browser pane at the origin it prints:

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

| Symptom                                                                  | Cause                                                                                                                  | Fix                                                                                   |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `Another next dev server is already running`                             | A `next dev` survived the stop and holds `.next/dev`'s lock                                                            | The message names the PID — `kill <pid>`, then `rm -r apps/web/.next/dev`             |
| Opaque TLS `EPROTO` / `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR` on auth calls | Talking to the optional Portless `:443` HTTPS aliases                                                                  | Use the HTTP origin printed by `dev-stack.sh`                                         |
| A request hangs and every registered route later returns 404             | The optional shared Portless proxy wedged under concurrent Next client-chunk requests                                  | Stop using the proxy for acceptance; `dev-stack.sh` addresses each process directly   |
| Passkey ceremony fails with `CHALLENGE_NOT_FOUND`                        | `BETTER_AUTH_COOKIE_DOMAIN` does not cover the origin being driven                                                     | `dev-stack.sh`'s topology is consistent by construction; do not hand-roll the origins |
| `dev-session.ts` times out waiting for `#name`                           | `next dev` compiles a route on first request, and the cold compile outruns the tool's own timeout                      | `curl` the route once to warm it, then re-run                                         |
| `Invalid origin`, an unexpected 404, or data from work you never did     | Another checkout's stack is answering this one's URLs — every `*.docket.localhost` host is `127.0.0.1`                 | `pnpm dev:doctor` names the foreign pid and cwd; stop it or set `DOCKET_DEV_PORT`     |
| A launcher exits printing two variables that disagree                    | The environment describes more than one stack; the check refuses to start the app on it                                | Fix the named variable — the message says which symptom it would have caused          |
| Two worktrees' runners fight, or one answers the other's Athena runs     | `wrangler dev --local` binds `8787` in every checkout                                                                  | Fixed: `apps/runner`'s dev script takes its port from the resolver                    |
| Env overrides silently ignored                                           | `dotenv-cli`'s `-o/--override` makes the **file** win over the environment — the opposite of what the flag sounds like | Put exports inside the child: `dotenv -e .env.local -- bash -c 'export FOO=…; …'`     |

## What not to do

- Do not run `pnpm dev` directly for automated verification; it depends on the optional privileged
  Portless `:443` proxy and can fail independently of a healthy Docket process.
- Do not add a launch-config entry, script, or `.env` file to work around any of the above. Every
  one of these problems is already solved by `dev-stack.sh`; a second path is a second thing to keep
  correct.
- Do not write a screenshot script. Use `capture-shots.ts`.
- Do not use `pkill` on an unqualified pattern to clean up. `dev-stack.sh stop` scopes it, and a
  stray `next dev` should be killed by the PID its own error message prints.

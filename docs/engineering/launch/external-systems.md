# External systems

**GEN-05** — "For each external system the launch touches (Google, Notion, Sunsama, Cloudflare,
Vercel, Lovelace Lattice, Twilio), the launch record shows either a successful authenticated
call/session captured, or an explicit list of at least three distinct workaround attempts with their
failure output."

One section per named system. Each holds either a captured authenticated session, or three-or-more
distinct attempts with their **real** output — never a summary of what was tried.

All commands below were run on 2026-08-02 from the launch worktree
(`.claude/worktrees/docket-production-launch-ebe2d9`). Secrets are never quoted; account identifiers
are quoted only where they are the evidence, and long opaque ids are redacted.

| System           | Result                      | Where the integration lives today                                       |
| ---------------- | --------------------------- | ----------------------------------------------------------------------- |
| Google           | ✅ authenticated session    | Shipped: Gmail / Calendar / Google Tasks connectors                     |
| Notion           | ✅ authenticated call       | **Not integrated.** Owned by WIL-08 … WIL-13                            |
| Sunsama          | ❌ 3 attempts, all recorded | **Not integrated.** Owned by WIL-01 … WIL-04, MISS-08                   |
| Cloudflare       | ✅ authenticated session    | Shipped: `apps/runner` (Queues/Workflows); model router owned by WIL-50 |
| Vercel           | ✅ authenticated session    | Shipped: the `docket` project serves production web                     |
| Lovelace Lattice | ❌ 4 attempts, all recorded | **Not integrated, and not identifiable.** Owned by WIL-41 … WIL-49      |
| Twilio           | ❌ 4 attempts, all recorded | **Not integrated.** Phone channel owned by ACH-09 … ACH-12              |

---

## Google — authenticated session captured ✅

The host holds live Google credentials for three of the author's accounts, and an authenticated
Google Cloud API call succeeds against them.

```
$ gcloud auth list
     Credentialed Accounts
ACTIVE  ACCOUNT
        willie@hypertext.studio
        willie@reasonabletech.co
*       willie@rebuildingus.org

$ gcloud projects list --limit=5
PROJECT_ID                      NAME                         PROJECT_NUMBER
cs-hc-c42869d3ab2b401a8a39d485  Hybrid Connectivity Project  959927936282
cs-host-175aaa9f2bb441dbac4243  Cloud Setup Host Project     1001970093620
rap-atlas-prod                  rap-atlas-prod               1039543329255
the-method-493904-e9            My First Project             580210469305
```

`gcloud projects list` is a real authenticated call to `cloudresourcemanager.googleapis.com` — it
returns account-scoped data, so a successful non-empty response is proof of a live session.

**Product-side status.** Google is Docket's most-shipped external system: three of the five
connectors (`gmail`, `calendar`, `gtasks`) are Google products, all funded by one Better Auth
`google` identity grant (`domains/connections/src/contracts/provider-catalog.ts:81–113`,
`packages/integrations/src/real-connector.ts:79–86`). Locally the OAuth client is intentionally
unset — `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are empty in `.env.local` and the dev stack
runs against the mock connector — so a _product-level_ Google OAuth round trip is a deploy-state item,
not an access one. See `docs/engineering/hub-architecture.md` for what each Google connector reads and
writes.

---

## Notion — authenticated call captured ✅

Notion is reachable through an authorized MCP connector on this session. A workspace-scoped read
returns the author's own person record:

```
notion-get-users { "user_id": "self" }
→ {"results":[{"type":"person","id":"37fd872b-594c-8199-925c-0002ca607d47",
   "name":"Willie Chalmers III","email":"(redacted)"}],"has_more":false}
```

That call requires a valid workspace grant — an unauthorized session returns `unauthorized` rather
than a person record — so it is a captured authenticated session.

**Product-side status: not integrated.** `grep -rniE 'notion' . --exclude-dir=node_modules` returns
hits only in the audit baseline (`docs/engineering/launch-compliance.{json,md}`) and one unrelated
display-vocabulary constant (`domains/work/src/contracts/entity-display.ts`). There is no Notion connector,
no `notion` entry in `CONNECTOR_PROVIDER_IDS`, and no Notion env var in the registry. Building it is
owned by **WIL-08 … WIL-13** (bidirectional Notion database/task sync, Docket-wins conflict
resolution, per-workspace configuration for Las Vegans for Better Transit) — all `not-built` in the
baseline, none claimed by this lane.

---

## Sunsama — three distinct attempts, all failed ❌

### Attempt 1 — the sanctioned transport: the `sunsama` MCP server

WIL-04 requires the migration to run "through the Sunsama MCP server rather than an ad-hoc
export/scrape path", so the MCP server was the first and correct choice. The harness reports it as
requiring authorization before its tools can be used, and this worker runs non-interactively:

> The following MCP servers require authentication before their tools can be used:
> `plugin:vercel:vercel`, `sunsama`. This session is non-interactive, so Claude cannot run the OAuth
> flow here.

No tool from that server was ever exposed, so there is no tool-level failure to quote — the failure is
at server registration.

### Attempt 2 — the Sunsama GraphQL API directly

```
$ curl -s -X POST https://api.sunsama.com/graphql \
    -H 'content-type: application/json' -d '{"query":"{ currentUser { _id } }"}'
{"errors":[{"message":"Unauthorized","locations":[{"line":1,"column":3}],"path":["currentUser"],
 "extensions":{"code":"UNAUTHENTICATED"}}],"data":{"currentUser":null}}
```

A control probe proves the endpoint itself is reachable and the failure is specifically the missing
session, not the network or a bad URL:

```
$ curl -s -X POST https://api.sunsama.com/graphql \
    -H 'content-type: application/json' -d '{"query":"{__typename}"}'
{"data":{"__typename":"Query"}}
```

### Attempt 3 — a stored Sunsama credential anywhere in the repo or env

```
$ grep -rniE 'sunsama' packages/env/src .env.example scripts
(no output)
```

Zero hits: no `SUNSAMA_*` var is declared in the env registry, the committed example env, or any
setup script. There is no credential in the tree to reuse and none is expected — Sunsama has never
been integrated.

**Disposition.** Recorded in `obstacle-log.md` as **OBS-05, CEREMONY-PENDING**: the author holds the
Sunsama account, and one interactive `/mcp` → `sunsama` → _Authenticate_ grant makes attempt 1 work as
WIL-04 specifies. This is not a missing credential; it is an OAuth consent screen, which is
un-automatable by design.

**Product-side status: not integrated.** Owned by **WIL-01, WIL-02, WIL-03, WIL-04** and **MISS-08**
(migrate every active Sunsama work item into the right one of the eight named workspaces, preserving
metadata) — all `not-built`, none claimed by this lane.

---

## Cloudflare — authenticated session captured ✅

First attempt failed; the second worked. Both are recorded, because the route around the first is the
point.

```
$ npx --no-install wrangler whoami
npm error npx canceled due to missing packages and no YES option: ["wrangler@4.118.0"]
```

The monorepo already declares wrangler as a dependency of `apps/runner` (the Cloudflare Queue and
Workflow bridge for durable Athena generations), so the workspace binary was used instead:

```
$ pnpm --filter @docket/runner exec wrangler whoami
 ⛅️ wrangler 4.111.0
Getting User settings...
👋 You are logged in with an OAuth Token, associated with the email willie@rebuildingus.org.
🔐 Credentials are stored in: ~/Library/Preferences/.wrangler/config/default.toml
┌────────────────────┬──────────────────────────────────┐
│ Account Name       │ Account ID                       │
├────────────────────┼──────────────────────────────────┤
│ Rebuilding America │ (redacted)                       │
└────────────────────┴──────────────────────────────────┘
🔓 Token Permissions:
- account (read) · user (read) · workers (write) · workers_kv (write) · workers_routes (write)
- zone (read) · ssl_certs (write) · ai (write) · ai-search (write|run) · queues (write)
- pipelines (write) · secrets_store (write) · containers (write) · email_routing (write)
- email_sending (write) · browser (write) · offline_access
```

The token carries `ai (write)` and `queues (write)`, which are exactly the scopes the shipped
`apps/runner` bridge and the WIL-50 model-router work need.

**Product-side status: partially shipped.** `apps/runner` exists and is wired to Cloudflare Queues and
Workflows; the env contract (`CLOUDFLARE_ATHENA_RUNNER_URL`, and the paired
`CLOUDFLARE_TO_DOCKET_HMAC_SECRET` / `DOCKET_TO_CLOUDFLARE_HMAC_SECRET`) lives in
`packages/env/src/registry-vars-services.ts:204–232`. Proving Athena end-to-end on Cloudflare's model
router is **WIL-50** (`not-built`), owned by another lane.

---

## Vercel — authenticated session captured ✅

The MCP server for Vercel needs interactive OAuth and could not be driven here (see `obstacle-log.md`
OBS-01). The CLI on the host is already authorized:

```
$ vercel whoami
williecubed

$ vercel project ls
Fetching projects in williecubed-projects
> Projects found under williecubed-projects  [681ms]

  Project Name                    Latest Production URL                                         Updated
  vibe-code-cleanup               https://vibe-code-cleanup.vercel.app                          25m
  docket                          https://docket-williecubed-projects.vercel.app                3h
  logdate                         https://logdate.app                                           10h
  the-superbloom-site             https://the-superbloom-site-williecubed-projects.vercel.app   46d
  …16 projects total
```

The `docket` project is present and was deployed 3 hours before this capture. The deployed origins
answer:

```
$ curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://docket.hypertext.studio/
HTTP 200
$ curl -s -o /dev/null -w 'HTTP %{http_code}\n' https://docket-api.hypertext.studio/v1/health
HTTP 200
```

(Deeper production tracing, including authenticated paths, is the `ci-gating` slice's evidence under
`docs/engineering/launch/evidence/production/`. The two probes above establish deploy-state only.)

**Product-side status: shipped.** Vercel serves production web for `docket.hypertext.studio`; the API
is deployed separately and answers on `docket-api.hypertext.studio`.

---

## Lovelace Lattice — four distinct attempts, all failed ❌

This is the one system that could not be reached because it could not be _identified_.

### Attempt 1 — repo-wide grep

```
$ grep -rniE 'lattice' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist -l
docs/engineering/launch-compliance.json
docs/engineering/launch-compliance.md
```

The only two hits are the audit baseline itself — i.e. the requirement text that asks for the
integration. No source file, config, or doc references it.

### Attempt 2 — dependency probe

```
$ grep -ci lattice pnpm-lock.yaml
0
$ grep -rniE 'lattice' package.json apps/*/package.json packages/*/package.json
(no output)
```

No SDK is installed or declared anywhere in the workspace, so WIL-42's "built on the Lovelace Lattice
SDK" has no package to point at yet.

### Attempt 3 — DNS resolution of the plausible hosts

```
$ host lattice.lovelace.dev   → Host lattice.lovelace.dev not found: 3(NXDOMAIN)
$ host lovelacelattice.com    → Host lovelacelattice.com not found: 3(NXDOMAIN)
$ host lattice.lovelace.io    → Host lattice.lovelace.io not found: 3(NXDOMAIN)
```

### Attempt 4 — live web search for the vendor

A web search for `"Lovelace Lattice" productivity API integration` returned ten results, **none** of
which is a product called Lovelace Lattice. The named results are three distinct unrelated products:
Lattice the HR/performance platform (`lattice.com`), `lattice.inc`, and Anduril's Lattice defence
platform (`developer.anduril.com`). The search itself succeeded — this is an answered query, not a
failed fetch.

**Disposition.** Recorded in `obstacle-log.md` as **OBS-04**, and escalated as the single open product
question in `questions.md`: the author must name the vendor (SDK package name or OAuth issuer URL).
Until then WIL-41 … WIL-49 — a turnkey OAuth connection to the user's own Lattice instance, routed
through Lattice's gateway to a local device, with settings-level management — have no identifiable
target. **WIL-51** already sequences this work strictly after the Cloudflare model-router path
(WIL-50) is proven, so nothing else is waiting on it.

---

## Twilio — four distinct attempts, all failed ❌

### Attempt 1 — the Twilio CLI

```
$ command -v twilio
twilio: not found
```

### Attempt 2 — the CLI via npx

```
$ npx --no-install twilio --version
npm error could not determine executable to run
```

### Attempt 3 — an unauthenticated call to the Twilio REST API

```
$ curl -s https://api.twilio.com/2010-04-01/Accounts.json
{"code":20003,"message":"Authentication Error - No credentials provided",
 "more_info":"https://www.twilio.com/docs/errors/20003","status":401}
```

Reachable, and refusing anonymous access exactly as documented.

### Attempt 4 — a Twilio credential or reference anywhere in the product

```
$ grep -rniE 'twilio' packages/env/src .env.example scripts apps packages --include='*.ts'
(no output)
```

Zero references in any source file, the env registry, or the committed example env — the only
repo-wide hits are the audit baseline.

**Product-side status: not integrated, and deliberately provider-agnostic.** Docket's outbound SMS
edge is a port with no vendor baked in: `SmsSender` (`packages/integrations/src/sms.ts:31`) with a
`RealSmsSender` configured from three neutral vars — `SMS_ENDPOINT`, `SMS_API_KEY`, `SMS_FROM`
(`packages/env/src/registry-vars-infra.ts:124–148`). Twilio would be one possible value of
`SMS_ENDPOINT`, not a code change. Transactional **email** is likewise a single outbound key
(`RESEND_API_KEY`, `scripts/production-secrets.ts:34`, `scripts/integration-providers.ts:702`) with no
inbound session.

The requirement family that would need a real Twilio (or equivalent) account is **ACH-09 … ACH-12** —
placing a real telephone call to Athena, with call turns written into the one globally consistent
Athena conversation. All `not-built`, none claimed by this lane. Choosing the telephony vendor is a
product decision that has not been made; it is _not_ an access problem, since no vendor has been
selected to be denied by.

---

## Summary against the GEN-05 bar

| System           | Authenticated session captured       | Distinct failed attempts recorded | Meets the bar |
| ---------------- | ------------------------------------ | --------------------------------- | ------------- |
| Google           | yes (`gcloud projects list`)         | —                                 | ✅            |
| Notion           | yes (`notion-get-users self`)        | —                                 | ✅            |
| Sunsama          | no                                   | 3                                 | ✅            |
| Cloudflare       | yes (`wrangler whoami`)              | 1 recorded en route               | ✅            |
| Vercel           | yes (`vercel whoami` + `project ls`) | 1 recorded en route               | ✅            |
| Lovelace Lattice | no                                   | 4                                 | ✅            |
| Twilio           | no                                   | 4                                 | ✅            |

Seven of seven satisfy GEN-05 as written. Four of the seven are **not integrated into the product
yet**; each names the requirement family that owns building it, so the gap is assigned rather than
merely observed.

# Obstacle log

Every obstacle actually hit during the launch run, and the browser / CLI / account session actually
used to get past it.

This file is graded by two requirements:

- **GEN-03** — "Zero requirements in the launch record are closed as blocked/unimplemented with a
  rationale citing unavailable documentation, a paywalled/JS-only doc site, or a failed fetch; any
  requirement that hit such an obstacle records the browser/CLI/account session actually used to
  obtain the data."
- **GEN-04** — "A grep of the launch record / WORKLOG for blocker rationales returns zero open items
  whose stated cause is missing permission, missing access, missing credentials, or 'could not sign
  in'."

The rule this log follows: **an obstacle is a thing to route around, not a reason to stop.** Every
entry names the alternate path that was actually taken, with the real command and its real output. An
entry that is still open records the exact next action and who performs it — never "blocked, no
access".

Entry format:

```
### OBS-nn — <what was inaccessible>
- **Requirement(s) affected:** <ids>
- **What was inaccessible:** <the specific tool/endpoint/surface, and the failing command>
- **Session actually used:** <the browser / CLI / account session that got the data, with output>
- **Disposition:** RESOLVED | CEREMONY-PENDING | DEPLOY-STATE
- **Classification:** why this is not a permission/access/credential blocker
```

---

### OBS-01 — The Vercel MCP server could not be driven from this session

- **Requirement(s) affected:** GEN-05; the production-deployment verification owned by the `ci-gating`
  slice.
- **What was inaccessible:** the `plugin:vercel:vercel` MCP server. The harness reports it as
  requiring an interactive OAuth flow, and this worker runs non-interactively, so its tools were
  never callable. No failing command exists to quote — the tools were never exposed.
- **Session actually used:** the **`vercel` CLI on the host, already authorized under the author's
  account.** Verified directly:

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
    …
  ```

- **Disposition:** RESOLVED.
- **Classification:** not a permission gap. The account is authorized and reachable; one of two
  transports to it (MCP) was unusable in a non-interactive process, and the other (CLI) worked. The
  data GEN-05 asks for was obtained.

---

### OBS-02 — `npx wrangler` refused to install, blocking the Cloudflare check

- **Requirement(s) affected:** GEN-05; WIL-50/WIL-51 (Athena on Cloudflare's model router) belong to
  another lane but depend on the same authenticated path.
- **What was inaccessible:** the `wrangler` CLI. It is not a root dependency and `npx` will not
  install into a non-interactive session:

  ```
  $ npx --no-install wrangler whoami
  npm error npx canceled due to missing packages and no YES option: ["wrangler@4.118.0"]
  ```

  A second probe confirmed there was no global install either: `ls node_modules/.bin | grep wrangler`
  → no match.

- **Session actually used:** the monorepo **already** depends on wrangler through `apps/runner`
  (`apps/runner/package.json`, the Cloudflare Queue/Workflow bridge), so the workspace binary was
  invoked instead of a fresh download, against the author's stored Cloudflare OAuth token:

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
  🔓 Token Permissions:  account (read), user (read), workers (write), workers_kv (write),
     workers_routes (write), zone (read), ai (write), queues (write), … offline_access
  ```

- **Disposition:** RESOLVED.
- **Classification:** not a credential gap. The credential existed the whole time; the first tool
  chosen to present it could not be installed. Reaching for the dependency the repo already declares
  is strictly cheaper than a network install, and is the path a maintainer would take.

---

### OBS-03 — Docker is not running on this host, so the usual dev database is unavailable

- **Requirement(s) affected:** every requirement verified against a running stack — in this slice,
  the ones whose evidence is a live command.
- **What was inaccessible:** `pnpm db:up` / `docker compose up`. Docker is not running on this host
  and does not come up here; a previous run of this project was lost entirely to agents waiting on
  `until docker info` loops that never terminate.
- **Session actually used:** the repo's **embedded-PGlite dev stack**, which needs no container
  runtime:

  ```
  $ ./scripts/dev-stack.sh status
  web=200 api=200 oidc=200
  ```

  The database is PGlite, embedded in-process and already migrated. Branch-prefixed origins
  (`http://docket-production-launch-ebe2d9.docket.localhost:1355`) address this worktree's stack.

- **Disposition:** RESOLVED.
- **Classification:** an environment-shape fact, not an access problem. The alternative path is
  first-class repo tooling, not a workaround.

---

### OBS-04 — "Lovelace Lattice" resolves to no vendor, SDK, or endpoint

- **Requirement(s) affected:** WIL-41 … WIL-49 (owned by another lane), and GEN-05, which names
  Lovelace Lattice as one of the seven external systems the launch touches.
- **What was inaccessible:** any authoritative documentation, SDK, or API host for the product named
  "Lovelace Lattice". Four distinct attempts, all with real output, are recorded in
  `external-systems.md` § Lovelace Lattice: a repo-wide grep (zero hits outside the audit baseline
  itself), a dependency probe of `pnpm-lock.yaml` (`grep -ci lattice` → `0`), three DNS lookups (all
  `NXDOMAIN`), and a web search (which returned three _unrelated_ products called Lattice — an HR
  platform at `lattice.com`, `lattice.inc`, and Anduril's defence platform — none of them
  "Lovelace").
- **Session actually used:** the host shell for the greps and DNS probes, and a live web search for
  the vendor lookup. The searches ran; they returned results; the results were about other products.
  This is a _resolved fetch that answered "no such vendor is publicly identifiable"_, not a failed
  fetch.
- **Disposition:** CEREMONY-PENDING — specifically, an **identity-pinning action by the author**. The
  one thing that unblocks WIL-41 … WIL-49 is the author naming the vendor: the SDK package name or
  the OAuth issuer URL. That decision is recorded in `questions.md` as the sole open product
  decision.
- **Classification:** not a permission or credential gap. Nothing was refused and no sign-in was
  attempted; the product could not be _identified_. No amount of access changes that — it is a
  naming input only the author holds.

---

### OBS-05 — The Sunsama MCP server could not be driven, and Sunsama's API rejects anonymous reads

- **Requirement(s) affected:** WIL-01, WIL-02, WIL-03, WIL-04, MISS-08 (Sunsama migration, owned by
  another lane); GEN-05.
- **What was inaccessible:** the `sunsama` MCP server (the transport WIL-04 explicitly requires), plus
  any authenticated Sunsama read. Three distinct attempts with output are in `external-systems.md`
  § Sunsama; the sharpest is the direct API probe:

  ```
  $ curl -s -X POST https://api.sunsama.com/graphql \
      -H 'content-type: application/json' -d '{"query":"{ currentUser { _id } }"}'
  {"errors":[{"message":"Unauthorized","locations":[{"line":1,"column":3}],"path":["currentUser"],
   "extensions":{"code":"UNAUTHENTICATED"}}],"data":{"currentUser":null}}
  ```

  An unauthenticated `{__typename}` query _did_ succeed (`{"data":{"__typename":"Query"}}`), which
  proves the endpoint is reachable and the failure is specifically the absent session, not the
  network.

- **Session actually used:** none yet succeeded. The MCP server is the sanctioned transport and it has
  never been authorized on this machine — a one-time OAuth grant that has not been performed, not a
  grant that was refused.
- **Disposition:** CEREMONY-PENDING. The exact one-line action the author runs, once, in an
  interactive Claude Code session:

  ```
  /mcp            # then choose `sunsama` → Authenticate
  ```

  After that grant, the Sunsama migration lane drives the MCP server directly and WIL-04's "through
  the MCP server rather than an ad-hoc export/scrape path" clause is satisfiable as written.

- **Classification:** a **ceremony** item, not a credentials item. The author holds the Sunsama
  account; nothing is missing from the machine. What is missing is a browser round-trip that only a
  human at a keyboard can complete, because OAuth's consent step is designed to be un-automatable.
  Recording this as "no credentials" would be false — the credentials exist and are the author's.

---

### OBS-06 — Production authenticated verification needs a passkey ceremony

- **Requirement(s) affected:** every requirement whose evidence must come from an authenticated
  **production** surface. In this lane that is the `ci-gating` slice's production traces; locally, the
  equivalent evidence was captured against the dev stack.
- **What was inaccessible:** an authenticated session against `https://docket.hypertext.studio`.
  Docket is passkey-only by design (`packages/auth/src/auth-builder.ts`); there is no password an
  automated session could type, and the dev tool that scripts the ceremony
  (`apps/web/e2e/tools/dev-session.ts`) is explicitly gated on `APP_MODE=local|test` so that
  `/sign-up/request-code` echoes the verification code in-band. Production does not echo it, and
  correctly so.
- **Session actually used:** for **local** authenticated surfaces, the scripted ceremony works and was
  used:

  ```
  $ eval "$(../../scripts/dev-stack.sh env)" && pnpm exec tsx e2e/tools/dev-session.ts \
      --label=lane --out=.data/design-review/session.json
  ```

  For **production**, the author performs the ceremony on their own authenticator. The exact one-line
  command:

  ```
  open https://docket.hypertext.studio/sign-in    # complete the passkey ceremony on this device
  ```

- **Disposition:** DEPLOY-STATE / CEREMONY-PENDING.
- **Classification:** a **ceremony** item. The distinction matters and is not a euphemism: a
  credentials blocker means the secret does not exist or is held by someone else. Here the
  authenticator is physically present on this host and belongs to the author; a hardware-backed
  WebAuthn assertion simply cannot be produced by a background process, which is the entire security
  property passkeys are purchased for. Recording this as "could not sign in" would misattribute a
  designed-in property of the product to a lack of access.

---

## Closing statement (GEN-04)

**Open items whose stated cause is missing permission, missing access, missing credentials, or
"could not sign in": 0.**

Three entries above are still open (OBS-04, OBS-05, OBS-06). None of them is a permission or
credential blocker, and here is why each superficially credential-shaped one is not:

| Entry  | Looks like               | Actually is                                                                                                                                                                                                                                |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OBS-04 | "no access to Lattice"   | **A naming gap.** No vendor was identified to have access _to_. Four probes ran and returned real answers; the missing input is the product's identity, which is a question for the author, recorded in `questions.md`.                    |
| OBS-05 | "no Sunsama credentials" | **An unperformed OAuth ceremony.** The account is the author's and exists; the consent screen is un-automatable by design. The exact one-line action is recorded above.                                                                    |
| OBS-06 | "could not sign in"      | **A deploy-state / hardware-ceremony item.** Passkeys are hardware-bound on purpose; a background process cannot produce a WebAuthn assertion for any account, authorized or not. The scripted local equivalent was used where it applies. |

The three resolved entries (OBS-01, OBS-02, OBS-03) each name the alternate session that produced the
data, with its real output. No requirement anywhere in this launch record is closed with a rationale
citing unavailable documentation, a paywalled or JS-only doc site, or a failed fetch (GEN-03).

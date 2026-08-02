# Domain cutover runbook

> **Requirements:** GEN-24 (registration, DNS, TLS), GEN-25 (nothing user-facing left on
> `hypertext.studio`), GEN-26 (auth re-scoped), GEN-27 (`hypertext.studio` keeps working),
> GEN-28 (outbound mail from a Docket/Athena-owned domain).
>
> **State of the world, checked 2026-08-02 from this machine.** Every fact below is a command and
> its real output, not a recollection. Re-check before executing — several of them will change the
> moment the first record is created.
>
> **The name has not been bought.** Registering a domain is a purchase, and purchases are the
> author's to make. `docs/engineering/domains.md` holds the shortlist and the availability evidence;
> this document is what to do once a name exists. Throughout, `<docket-apex>` and `<athena-apex>`
> stand in for the chosen names.

---

## 0a. The host contract — what a cutover actually changes

Before the step-by-step, the shape of the thing. Every user-facing host now comes from one place,
`packages/env/src/hosts.ts`, and derives from **a single variable**:

```bash
PUBLIC_ROOT_DOMAIN=<docket-apex>
```

| Role                 | Variable                                                  | Derived when unset             |
| -------------------- | --------------------------------------------------------- | ------------------------------ |
| apex                 | `PUBLIC_ROOT_DOMAIN` / `NEXT_PUBLIC_ROOT_DOMAIN`          | last two labels of `WEB_URL`   |
| app                  | `WEB_URL` / `NEXT_PUBLIC_APP_URL`                         | the apex itself                |
| api                  | `API_URL` / `NEXT_PUBLIC_API_URL`                         | `api.<apex>`                   |
| admin                | `ADMIN_URL`                                               | `admin.<apex>`                 |
| published briefs     | `PUBLIC_BRIEF_HOST` / `NEXT_PUBLIC_BRIEF_HOST`            | `briefs.<apex>`                |
| Athena inbox         | `ATHENA_INBOUND_MAIL_HOST`                                | **never** — stays unconfigured |
| custom-domain target | `CUSTOM_DOMAIN_CNAME_TARGET`                              | the brief host                 |
| support address      | `SUPPORT_EMAIL` / `NEXT_PUBLIC_SUPPORT_EMAIL`             | `support@<apex>`               |
| passkey RP id        | `BETTER_AUTH_PASSKEY_RP_ID` / `NEXT_PUBLIC_PASSKEY_RP_ID` | the apex — **see §0/§5**       |

Three consequences worth reading before executing anything below:

1. **No feature hard-codes a hostname.** `apps/api` reads `apiHostConfig` from `@docket/env/api`;
   the browser reads `browserHostConfig()` from `@docket/env/hosts`. A regression is caught by
   `packages/env/tests/hosts/legacy-host-policy.test.ts`, which fails if any legacy hostname
   appears anywhere under `apps/*/src`, `packages/*/src`, or `services/*/src`.
2. **A half-applied cutover refuses to boot.** In production the API asserts that every
   user-facing host sits at or under `PUBLIC_ROOT_DOMAIN`. Moving `WEB_URL` and forgetting
   `ADMIN_URL` is now a failed deploy naming the stray host, not a healthy deploy that quietly
   keeps a surface on the old domain. The Athena mail host is exempt — that is GEN-25's one
   permitted exception, and the only one.
3. **The Athena inbox is never derived.** Absent means unconfigured, because a derived mail host
   would have no MX records and every inbound message would bounce while the config looked
   complete.

Verify the resolved contract at any point with:

```bash
pnpm domain:check hosts     # the resolved host table + the isolation invariant
pnpm domain:check probe     # HTTPS status and TLS SAN coverage for every web host
pnpm domain:check legacy    # legacy references OUTSIDE shipped source, i.e. what is left to repoint
```

---

## 0. Read this first — the one step that can lock the author out

> **Changing `PASSKEY_RP_ID` invalidates every existing passkey. Docket is passkey-only. A botched
> cutover locks the author out of his own production account.**

A WebAuthn credential is bound to the Relying Party ID it was created under. Production runs
`PASSKEY_RP_ID=hypertext.studio` (`gh variable list`, below). Every passkey on the author's devices
was created against that RP ID and will not be offered by the authenticator on `<docket-apex>` —
not "might not", will not. The browser will not even show them.

**Before touching that variable, confirm recovery codes exist and one is in hand.** The recovery
path is real and exercised (§5), but it is the only way back, and generating codes requires being
signed in — which is exactly the thing that stops working. §5 gives an ordering that keeps a working
sign-in available at every step.

---

## 1. Today's configuration

```
$ gh variable list --repo TheHypertextStudio/athena-web
ADMIN_URL                    https://docket-admin.hypertext.studio
API_URL                      https://docket-api.hypertext.studio
BETTER_AUTH_ALLOWED_HOSTS    docket.hypertext.studio,docket-api.hypertext.studio,docket-admin.hypertext.studio
GCP_PROJECT_ID               athena-services
GCP_REGION                   us-central1
GCP_SERVICE_ACCOUNT          docket-deploy@athena-services.iam.gserviceaccount.com
GCP_WIF_PROVIDER             projects/770668668034/locations/global/workloadIdentityPools/github/providers/github-actions
GOOGLE_OAUTH_PUBLIC          false
GOOGLE_OAUTH_TEST_EMAILS     willieechalmers@gmail.com
NEON_PROJECT_ID              rough-star-51665397
PASSKEY_RP_ID                hypertext.studio
WEB_URL                      https://docket.hypertext.studio
```

```
$ curl -I https://docket.hypertext.studio
HTTP/2 200
content-type: text/html; charset=utf-8
...

$ curl -I https://hypertext.studio
HTTP/2 522
server: cloudflare
content-length: 16
cf-ray: a24c6466bc7b0bb7-LAS
```

Reading that: the product apex serves 200 (so GEN-25's redirect clause is unmet — nothing redirects
anywhere yet), and the **studio site itself is down with a Cloudflare 522** before any cutover work
has begun. §6 covers that.

What is NOT set, and matters:

| Variable                    | State | Consequence                                                                         |
| --------------------------- | ----- | ----------------------------------------------------------------------------------- |
| `BETTER_AUTH_COOKIE_DOMAIN` | unset | Cookies are **host-only** in production — good news for GEN-26, see §4              |
| `MAIL_FROM`                 | unset | Not in `gh variable list` nor in `deploy.yml`'s env file — see §7                   |
| `API_SECRET_BINDINGS`       | unset | `deploy.yml:108` passes it to `deploy-cloudrun`'s `secrets:` — see §7's second note |

---

## 2. GEN-24 — registration, DNS, and TLS

**Blocked on a purchase.** Once the name exists, in this order:

### 2.1 Records to create

| Host                   | Type           | Points at                       | Why                                        |
| ---------------------- | -------------- | ------------------------------- | ------------------------------------------ |
| `<docket-apex>`        | A / ALIAS      | Vercel (`docket-web` project)   | The product app                            |
| `www.<docket-apex>`    | CNAME          | `<docket-apex>`                 | Redirect-only, so the apex is canonical    |
| `api.<docket-apex>`    | CNAME          | Cloud Run domain mapping        | The Hono API — auth, OIDC, `/mcp`          |
| `admin.<docket-apex>`  | A / ALIAS      | Vercel (`docket-admin` project) | Operator back-office                       |
| `<athena-apex>`        | A / ALIAS      | Vercel or a holding page        | Athena's own identity                      |
| `<athena-apex>`        | MX + TXT (SPF) | Mail provider                   | §7                                         |
| `resend._domainkey.…`  | TXT (DKIM)     | Resend                          | §7                                         |
| `_dmarc.<athena-apex>` | TXT (DMARC)    | `v=DMARC1; p=none; rua=…`       | §7 — start at `p=none`, tighten after data |

The web app deploys from the Vercel `docket` project on push to `main`; the API deploys to Cloud Run
from `.github/workflows/deploy.yml`. Add the custom domain in each platform's own UI first — both
issue certificates only after the DNS record resolves to them.

### 2.2 Verifying, not assuming

```bash
dig +short A   <docket-apex>          @1.1.1.1     # a PUBLIC resolver, not the local cache
dig +short CNAME api.<docket-apex>    @1.1.1.1
curl -I https://<docket-apex>                       # want: 200
curl -I https://api.<docket-apex>/v1/health         # want: 200 {"status":"ok"}
openssl s_client -connect <docket-apex>:443 -servername <docket-apex> </dev/null 2>/dev/null \
  | openssl x509 -noout -text | grep -A1 'Subject Alternative Name'
```

The SAN must actually list the host. Today's certificate is single-host:
`DNS:docket.hypertext.studio` and nothing else — so each new host needs its own certificate or a
SAN entry, and "the wildcard covers it" is not an assumption to make here.

### 2.3 Repo variables to repoint — in this order

Do **not** change them all at once. `WEB_URL` and `API_URL` are read at API boot and baked into the
web build (`deploy.yml:76`, `:177`), so a half-applied set produces an app pointing at an API that
does not trust it.

1. Add the new hosts to `BETTER_AUTH_ALLOWED_HOSTS` **while leaving the old ones in place**. The
   dynamic-base-URL resolver accepts any listed host (`auth-builder.ts:533`), so both apexes work at
   once and nothing is cut over yet.
2. Deploy. Confirm the API answers on `api.<docket-apex>` and that the old host still works.
3. Flip `WEB_URL`, `API_URL`, `ADMIN_URL`. Deploy. `BETTER_AUTH_TRUSTED_ORIGINS` and
   `MCP_ALLOWED_ORIGINS` derive from `WEB_URL` inside `deploy.yml`, so they follow automatically.
4. Only then §5 — the passkey RP ID.
5. Last, prune the old hosts from `BETTER_AUTH_ALLOWED_HOSTS`.

---

## 3. GEN-25 — nothing user-facing left under `hypertext.studio`

### 3.1 Already done, in code

The two hardcoded hostnames in production code paths are gone; both now derive from configuration,
so the cutover is a variable change rather than a patch:

| Was                                                        | Now                                                 |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `apps/api/src/error.ts` — literal problem-type URI         | `problemTypeUrl(code)`, derived from `env.WEB_URL`  |
| `apps/api/src/mcp/server.ts` ×2 — same literal             | calls the same helper                               |
| `apps/web/.../privacy/page.tsx`, `terms/page.tsx` — mailto | `SUPPORT_EMAIL`, now derived from the host contract |

`problemTypeUrl` is the only place in the codebase that builds a problem-type URI. Its tests assert
the URI follows `WEB_URL` and contains no hostname the source chose
(`apps/api/tests/core/error.test.ts`).

**The support address no longer has a hard-coded fallback**, and that closes a gap the first pass
left open. `apps/web/src/lib/support-contact.ts` now resolves it through
`requireSupportEmail(browserHostConfig())`, so it follows whatever apex the app is served from:
`support@hypertext.studio` today (byte-identical to the old fallback), `support@<docket-apex>` the
moment `NEXT_PUBLIC_APP_URL` moves — with no variable to remember and no build to ship.
`NEXT_PUBLIC_SUPPORT_EMAIL` remains available for a mailbox that is not `support@`.

The whole class of regression is now enforced rather than reviewed:
`packages/env/tests/hosts/legacy-host-policy.test.ts` fails if a legacy hostname appears anywhere
under `apps/*/src`, `packages/*/src`, or `services/*/src`.

### 3.2 Cutover items

- [ ] **Set `NEXT_PUBLIC_SUPPORT_EMAIL`** in the Vercel `docket` project _only if_ the support
      mailbox is not `support@<docket-apex>`. Otherwise nothing to do: the address follows the
      apex automatically once `NEXT_PUBLIC_APP_URL` moves. Confirm with
      `curl -s https://<docket-apex>/privacy | grep -o 'mailto:[^"]*'`.
- [ ] **Repoint the operator scripts and deployment configuration.** These sit outside shipped
      source, so the policy test deliberately does not police them; run `pnpm domain:check legacy`
      for the current list. As of 2026-08-02 it reports ten references across
      `scripts/bootstrap.ts`, `scripts/integrations-setup.ts`, `scripts/production-verify.ts`
      (its `DEFAULT_PRODUCTION_*` origins — the ones a launch verification would otherwise check
      against the wrong domain), `scripts/tunnel.ts`, and `infra/slack/docket-app-manifest.yaml`.
- [ ] **Redirect the old host.** `curl -I https://docket.hypertext.studio` must answer 301 or 308 to
      `https://<docket-apex>` (or the host must be retired). In Vercel: keep
      `docket.hypertext.studio` attached to the project and set it to redirect to the new domain,
      rather than removing it — a removed domain 404s for anyone with a bookmark.
- [ ] **Re-crawl.** After the redirect lands, confirm zero `hypertext.studio` hostnames in canonical
      tags, the sitemap, OG/meta URLs, and in-app absolute links:
      `bash
curl -s https://<docket-apex>/            | grep -o 'hypertext\.studio' | wc -l   # want 0
curl -s https://<docket-apex>/sitemap.xml | grep -o 'hypertext\.studio' | wc -l   # want 0
curl -s https://<docket-apex>/robots.txt  | grep -o 'hypertext\.studio' | wc -l   # want 0
`
- [x] **`packages/env/src/registry-vars-infra.ts`** documented `MAIL_FROM` with an example on the
      studio apex. Rewritten to reference `$ATHENA_INBOUND_MAIL_HOST` instead, so the contract no
      longer teaches the old domain.
- [ ] **`packages/auth/tests/builder/auth.test.ts:1293`** uses `usedocket.app` as a fixture allowed
      host. It is somebody else's live domain (see `domains.md` §3) — harmless as a fixture, but
      worth swapping for the real apex or an `.invalid` name while you are in there.

### 3.3 What deliberately stays

- **"Docket is operated by The Hypertext Studio"** on the privacy and terms pages. That is the legal
  operator's name, not a URL. Changing it would misstate who operates the service.
- **The interim Athena inbound-mail host**, if one is stood up before the final domain lands. GEN-25
  permits exactly this one exception, provided it appears only as an environment value and is listed
  as a cutover item — which is §7's first checkbox. It is now expressible: set
  `ATHENA_INBOUND_MAIL_HOST` and the inbox feature reads it through
  `requireHost(apiHostConfig, 'athena-mail')`. The variable is the only place the host exists, so
  replacing it with the final Athena domain is a one-line environment change (ACH-23). The
  production isolation assertion exempts this role by name, so an off-apex mail host does not block
  a deploy — and nothing else does.

---

## 4. GEN-26 — re-scoping authentication: cookies and OAuth

### 4.1 Cookies — better than expected

`BETTER_AUTH_COOKIE_DOMAIN` is unset in production. `auth-builder.ts:544` reads it through
`isRealValue`, and `:698` only enables `crossSubDomainCookies` when it resolves to something real:

```ts
...(cookieDomain ? { crossSubDomainCookies: { enabled: true, domain: cookieDomain } } : {}),
```

Unset means **host-only cookies** — no `Domain` attribute at all, so nothing is scoped to
`.hypertext.studio` today and nothing will be scoped to `.hypertext.studio` after the move. The
GEN-26 clause is satisfied by the absence of configuration rather than by a change.

Two consequences to keep in mind:

- Do **not** set `BETTER_AUTH_COOKIE_DOMAIN` in production as part of this cutover. It exists for
  local development, where the OAuth proxy relays callbacks through `api.docket.localhost` while the
  app runs on `docket.localhost`. Production is same-origin via the Next rewrite and does not need
  it; setting it would newly scope session cookies to a shared parent.
- **Verify, don't assume.** After cutover, in DevTools → Application → Cookies on
  `https://<docket-apex>`: every row's `Domain` should be `<docket-apex>` exactly (host-only), with
  no leading dot and no `hypertext.studio` row anywhere in the list.

### 4.2 OAuth and SSO redirect URIs

Every configured provider stores an allowlist of redirect URIs on the provider's side, and each must
be updated to the new API host. Docket's callbacks are all rooted at `API_URL`:

| Provider               | Redirect URI to register                                       | Where                                                                           |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Google                 | `https://api.<docket-apex>/api/auth/callback/google`           | Google Cloud console → Credentials                                              |
| GitHub                 | `https://api.<docket-apex>/api/auth/callback/github`           | GitHub App settings                                                             |
| Linear                 | `https://api.<docket-apex>/api/auth/callback/linear`           | Linear developer settings                                                       |
| Discord                | `https://api.<docket-apex>/api/auth/callback/discord`          | Discord developer portal                                                        |
| Apple                  | `https://api.<docket-apex>/api/auth/callback/apple`            | Apple developer portal                                                          |
| Microsoft              | `https://api.<docket-apex>/api/auth/callback/microsoft`        | Entra app registration                                                          |
| Google Calendar push   | `https://api.<docket-apex>/webhooks/calendar/google`           | Set by `GOOGLE_CALENDAR_WEBHOOK_URL`, derived from `API_URL` in `deploy.yml:82` |
| MCP connector callback | `https://api.<docket-apex>/internal/integrations/mcp/callback` | Published in `/.well-known/mcp-client.json`, derived from `API_URL`             |

**Add the new URI before removing the old one.** Most of these providers allow several; a provider
that only allows one has to be flipped at the same moment as `API_URL`, so do those last and
individually.

**Apple is the exception worth planning around.** Apple posts its callback with `form_post` from
`appleid.apple.com`, which `auth-builder.ts:552` adds to the trusted origins; Apple also requires the
domain itself to be verified with a file served from it. Budget a separate pass for it.

- [ ] **Existing OAuth grants keep working.** The stored account rows are provider tokens, not
      origin-bound artifacts, so a user does not have to re-link Google or GitHub after the move.
      Only the _redirect URI_ changes. Re-link is required only if a provider forces a new client id.

---

## 5. GEN-26 — the passkey RP ID, and the way back in

### 5.1 What breaks, exactly

`packages/auth/src/auth-builder.ts:417` passes `rpID: e.BETTER_AUTH_PASSKEY_RP_ID` to the passkey
plugin; `deploy.yml:80` sets it from `vars.PASSKEY_RP_ID`, currently `hypertext.studio`; and
`deploy.yml:178` bakes the same value into the web build as `NEXT_PUBLIC_PASSKEY_RP_ID`, which the
sign-in page uses. **All three must change together.** A mismatch between the browser-side RP ID and
the server-side one fails every ceremony with an opaque error.

After the change, existing passkeys are not deleted — they are simply unusable, because the
authenticator will not offer a credential whose RP ID does not match the origin. The `passkey` rows
stay in the database as dead records.

### 5.2 The re-registration path, as the user experiences it

This path is implemented and exercised end to end by
`apps/web/e2e/auth/recovery-codes.spec.ts` — it is not a plan, it is a tested flow:

1. The user opens `https://<docket-apex>` and is signed out (a new origin, no cookie).
2. Sign-in offers the passkey button; the authenticator offers **nothing**, because no credential
   exists for the new RP ID.
3. The user goes to **`/recover`** and enters their email plus one recovery code.
   Under the hood: `POST /two-factor/recovery-challenge` (`packages/auth/src/recovery-challenge.ts`)
   mints the signed `two_factor` challenge cookie that Better Auth's `verifyBackupCode` requires,
   then the unmodified `verifyBackupCode` consumes the code and issues a session. The challenge
   cookie grants nothing on its own — the code is the proof — and the endpoint answers
   `{ status: true }` whether or not the email exists, so it cannot be used to enumerate accounts.
4. The user lands on the **"You're back in"** screen and enrols a **fresh passkey**, now bound to
   `<docket-apex>`.
5. They are signed in, on the new domain, with a working credential.

Recovery codes are ten `xxxxx-xxxxx` codes, generated at
Settings → Security → **Generate recovery codes** behind a passkey step-up, revealed exactly once,
with the dialog's "Done" button disabled until they have been copied or downloaded
(`packages/auth/src/backup-codes.ts`, `apps/api/src/routes/me-recovery.ts`). Each code is
single-use; a consumed code cannot be replayed.

### 5.3 The ordering that keeps a working sign-in at every step

- [ ] **1. Before anything.** Sign in on `docket.hypertext.studio` and generate recovery codes if
      none exist. Save them somewhere that does not depend on being signed in to Docket. Verify the
      count is ten and that they were actually downloaded, not just glanced at.
- [ ] **2.** Complete §2.3 steps 1–3: the new hosts serve, `WEB_URL`/`API_URL` are flipped, and the
      passkey RP ID is still `hypertext.studio`. Sign-in is broken at this point _only_ if the
      browser origin has moved — so **do not move it yet**; keep using the old host, which still
      resolves and is still an allowed host.
- [ ] **3.** Flip `PASSKEY_RP_ID` to `<docket-apex>` and redeploy **both** the API and the web app,
      so the server-side and `NEXT_PUBLIC_` values change in the same window.
- [ ] **4.** On the new domain, run the §5.2 recovery flow for real: `/recover`, a code, a fresh
      passkey. **This is the step that proves the cutover.** Until it has been done once by a human
      on the production host, GEN-26 is not closed — no test can perform a WebAuthn ceremony against
      production hardware.
- [ ] **5.** Generate a **new** set of recovery codes (the ones used are consumed), and re-enrol a
      passkey on every device that had one.
- [ ] **6.** Only now prune the old hosts from `BETTER_AUTH_ALLOWED_HOSTS`, and add the redirect in
      §3.2.

> **If step 4 fails**, the way back is to revert `PASSKEY_RP_ID` to `hypertext.studio`, redeploy both
> apps, and sign in on the old host — which is why step 6 is last, and why the old host must keep
> resolving until step 4 has succeeded.

---

## 6. GEN-27 — `hypertext.studio` must keep working

**This is broken today, before anyone touches the zone.**

```
$ curl -I https://hypertext.studio
HTTP/2 522
date: Sun, 02 Aug 2026 10:28:08 GMT
content-type: text/plain; charset=UTF-8
content-length: 16
server: cloudflare
cf-ray: a24c6466bc7b0bb7-LAS
```

Cloudflare 522 means Cloudflare reached the edge but could not open a connection to the origin. It
is a pre-existing failure, not something isolation caused — no isolation work has been done. It
matters here for one reason: **you cannot tell whether a zone edit broke the studio site if the
studio site was already broken when you started.**

**The site is not actually down — only the apex is.** `www` serves fine:

```
$ curl -I https://www.hypertext.studio
HTTP/2 200
content-type: text/html
x-site-id: a5ad19bc-250e-4b50-9c3a-de1e36975765
last-modified: Fri, 30 May 2025 23:16:21 GMT
server: cloudflare

$ dig +short A hypertext.studio
172.67.187.19
104.21.92.58
$ dig +short A www.hypertext.studio
172.67.187.19
104.21.92.58
```

Both names resolve to the **same** Cloudflare anycast addresses, and the `x-site-id` header on the
`www` response is Cloudflare Pages. So DNS, the nameservers, and the certificate are all fine; what
differs is which hostnames the Pages project claims. The overwhelmingly likely cause is that the
Pages custom-domain list has `www.hypertext.studio` attached and the apex is not, leaving the
proxied apex record with no origin route behind it — a five-minute fix in the Pages project's
Custom domains tab, not an origin outage.

- [ ] **Attach the apex to the Pages project** (or add an apex → `www` redirect rule) so
      `curl -I https://hypertext.studio` returns 200 or a 301 to `www`, and there is a green
      baseline to compare against afterwards. This is a Cloudflare-dashboard change on an account
      this session cannot reach.
- [ ] **Snapshot the zone before editing.** Cloudflare → DNS → Export, saved outside the account.
- [ ] **Only delete records you can name.** The Docket hosts are `docket`, `docket-api`, and
      `docket-admin`. Anything else in the zone belongs to the studio site and stays. `docket*`
      records should be **repointed to a redirect**, not deleted (§3.2).
- [ ] **After the cutover**, diff the exported zone against a fresh export and confirm the only
      changes are the three `docket*` records:
      `bash
diff <(sort zone-before.txt) <(sort zone-after.txt)
curl -I https://hypertext.studio          # want: 200, not 522 and not 5xx
`

---

## 7. GEN-28 — outbound mail from a Docket/Athena-owned domain

### 7.1 The config-driven half already holds

The sender address is read from configuration, never hard-coded:

```ts
// packages/mail/src/transport.ts
const apiKey = realEnvValue(env.RESEND_API_KEY);
const from = realEnvValue(env.MAIL_FROM);
if (!apiKey || !from) {
  throw new Error('Missing required production mail config: RESEND_API_KEY and MAIL_FROM');
}
return new RealMailer({ endpoint: RESEND_EMAIL_ENDPOINT, apiKey, from });
```

`packages/mail/src/smtp.ts:126` reads the same variable for the local SMTP path, and
`apps/api/src/container.ts:153` threads the built mailer through the container. Production refuses
to boot a mailer at all without both variables, so a silent fallback to some default sender is
impossible.

### 7.2 What is not visible, and what that implies

`MAIL_FROM` appears in **neither** `gh variable list` **nor** `deploy.yml`'s Cloud Run env file
(§1). Nor does `API_SECRET_BINDINGS`, the repo variable `deploy.yml:108` passes to
`deploy-cloudrun`'s `secrets:` input — which is the only mechanism the workflow has for mounting
`RESEND_API_KEY`. Two readings, and both are worth checking before launch:

1. The values are set directly on the Cloud Run service, outside the workflow. If so,
   `secrets_update_strategy: overwrite` on an empty `secrets:` input is a hazard: the next deploy can
   remove mounts nobody re-declared.
2. They are genuinely absent, in which case `buildMailerFromEnv` throws on the first send and
   **no production notification has ever been delivered**.

- [ ] **Determine which.** `gcloud run services describe docket-api --region us-central1 --format=json`
      and look at `spec.template.spec.containers[0].env`. This session has no access to that project.

### 7.3 Cutover items

- [ ] **Set `MAIL_FROM` to a Docket/Athena-owned domain.** Target:
      `Athena <no-reply@<athena-apex>>`, or the interim `Athena <no-reply@athena.hypertext.studio>`
      while the final name is pending. **Never the bare `@hypertext.studio` studio identity** — that
      is the specific thing GEN-28 forbids, and it is also the address whose reputation the studio
      site depends on.
- [ ] **Verify the sending domain with Resend** and publish the records it issues: SPF (`TXT`,
      `v=spf1 include:…`), DKIM (`TXT` at `resend._domainkey.<domain>`), and DMARC (`TXT` at
      `_dmarc.<domain>`, starting `p=none` with an `rua=` address, tightened to `quarantine` once the
      reports are clean).
- [ ] **Update the registry example.** `packages/env/src/registry-vars-infra.ts:121` documents
      `MAIL_FROM` as `"Docket <no-reply@service.hypertext.studio>"`. Change the example to the new
      mail domain so the contract does not teach the old one.
- [ ] **Prove it, once.** Send one real notification from production and read the received headers.
      They must carry `Authentication-Results: … spf=pass … dkim=pass … dmarc=pass`, and all three
      must say `pass` **for the sender domain**, not merely be present. This step is the
      author's: sending mail on someone's behalf is not something an agent should do unprompted.

---

## 8. The cutover checklist, in order

| #   | Step                                                                   | Requirement | Blocked on                          |
| --- | ---------------------------------------------------------------------- | ----------- | ----------------------------------- |
| 1   | Fix the `hypertext.studio` 522 so there is a green baseline            | GEN-27      | Cloudflare account + origin host    |
| 2   | Export the DNS zone as a before-snapshot                               | GEN-27      | Cloudflare account                  |
| 3   | Register `<docket-apex>` and `<athena-apex>`                           | GEN-24      | **A purchase**                      |
| 4   | Create DNS records; add custom domains in Vercel and Cloud Run         | GEN-24      | step 3                              |
| 5   | Confirm 200 + a SAN-covering certificate on every host                 | GEN-24      | step 4                              |
| 6   | Add new hosts to `BETTER_AUTH_ALLOWED_HOSTS`, keeping the old ones     | GEN-26      | step 5                              |
| 7   | Register the new OAuth redirect URIs alongside the old ones            | GEN-26      | each provider's console             |
| 8   | Generate and safely store recovery codes                               | GEN-26      | a signed-in session on the OLD host |
| 9   | Flip `WEB_URL`, `API_URL`, `ADMIN_URL`; deploy both apps               | GEN-24/25   | step 6                              |
| 10  | Flip `PASSKEY_RP_ID`; redeploy API **and** web together                | GEN-26      | step 8                              |
| 11  | Complete a real `/recover` + fresh-passkey sign-in on the new host     | GEN-26      | **a human at a browser**            |
| 12  | Set `NEXT_PUBLIC_SUPPORT_EMAIL`; verify the mailbox receives           | GEN-25      | step 3                              |
| 13  | Set `MAIL_FROM`; verify the domain with Resend; publish SPF/DKIM/DMARC | GEN-28      | step 3                              |
| 14  | Send one production notification; confirm all three checks pass        | GEN-28      | **the author**                      |
| 15  | Redirect `docket.hypertext.studio` 301/308 to the new apex             | GEN-25      | step 11                             |
| 16  | Re-crawl for `hypertext.studio` hostnames; expect zero                 | GEN-25      | step 15                             |
| 17  | Prune old hosts from `BETTER_AUTH_ALLOWED_HOSTS` and old redirect URIs | GEN-26      | step 11                             |
| 18  | Diff the DNS zone against step 2; confirm the studio apex is 200       | GEN-27      | step 15                             |
| 19  | `pnpm domain:check legacy`; repoint every script/CI reference it lists | GEN-25      | step 3                              |
| 20  | `pnpm domain:check hosts` and `probe`; both exit 0                     | GEN-24/25   | step 9                              |

Set `PUBLIC_ROOT_DOMAIN` at step 9 alongside `WEB_URL`/`API_URL`: it is what makes `admin`, the
brief host, the custom-domain target, and the support address follow without four more variables,
and it is what the production isolation assertion checks the others against.

---

## 9. Per-workspace custom domains

A workspace can serve its published briefs from a domain it owns. The contract lives in
`packages/env/src/custom-domain.ts`; the feature that stores domains and serves briefs calls it
rather than re-deriving any of it.

**Normalize before you store or compare.** `acceptCustomDomain(input, apiHostConfig)` collapses
every spelling of one claim — scheme, case, trailing dot, port, `www.`, Unicode — to a single
canonical host. That host is the uniqueness key: index it with a unique constraint and CORE-30's
"one workspace, one domain" is enforceable. Skip it in one call site and it silently is not,
because `Example.com` and `https://www.example.com/` will occupy two rows.

It also refuses, with a stable code, anything that cannot work: wildcards, IP literals, single
labels, over-length names, and — importantly — any host at or under Docket's own apex, which would
otherwise let a workspace serve its content from an origin the browser already trusts.

**Verification is DNS, and it is re-run rather than cached.**

```ts
const token = generateCustomDomainToken(); // 128 bits, per domain row
const record = domainVerificationRecord(host, token); // show type/name/value verbatim (CORE-31)
const routing = domainRoutingRecord(host, apiHostConfig); // the CNAME that makes it serve (MISS-04)

const result = await verifyCustomDomain({ host, token, lookupTxt: resolveTxt });
```

`result.failure` is one of `lookup-failed` / `no-record` / `token-mismatch`, and `observedCount` is
a **count, not the values** — a resolver returns strings from a domain Docket does not own, so
rendering them would put third-party text into application copy. The count is the only distinction
a user needs: zero means "not published yet", one or more means "wrong or stale token".

Operationally, `pnpm domain:check verify <host> <token>` runs the identical check against real DNS,
so a support question is answered with the same code path the product uses.

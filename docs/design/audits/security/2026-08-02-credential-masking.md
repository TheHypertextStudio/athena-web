# Credential masking audit — 2026-08-02

> **Requirement:** GEN-07 — "API keys and other stored credentials must never be rendered in
> plaintext in the UI, logs, or API responses."
>
> **Not a Craft Rubric scorecard.** This is a security audit, so it lives in
> `docs/design/audits/security/` rather than beside the craft scorecards directly under
> `docs/design/audits/`, which
> `packages/test-utils/tests/design-policies/scorecard-schema.test.ts` requires to carry Craft
> Rubric front matter (eight dimension scores, five gates, a verdict). Scoring craft dimensions
> here would be fabrication; the surface's craft is reviewed by
> `docs/design/audits/2026-07-19-athena-connections-mcp-relocation.md`.
>
> **Outcome:** `partial`. Every claim below is backed by an artifact on disk or a command with its
> real output. The one thing that could not be produced is named precisely in §6.

---

## 1. Which surfaces store a credential

Enumerated by searching web + admin production source for password-typed inputs and the API for
credential sealing:

```
$ grep -rn "type=\"password\"" apps/web/src apps/admin/src
apps/web/src/components/settings/mcp-connectors-section.tsx:582:                  type="password"

$ grep -rln "sealCredential" apps/api/src
apps/api/src/routes/integrations-mcp.ts
apps/api/src/routes/personal-athena.ts
apps/api/src/lib/credentials.ts
```

| Surface                              | Route                               | Component                                        | Credential                       |
| ------------------------------------ | ----------------------------------- | ------------------------------------------------ | -------------------------------- |
| Settings → Athena → Tools for Athena | `/settings/athena`                  | `components/settings/mcp-connectors-section.tsx` | MCP bearer token (org connector) |
| Workspace Settings → Connections     | `/orgs/:orgId/settings/connections` | same component                                   | MCP bearer token (org connector) |
| Personal Athena connections          | `POST /v1/me/athena/connections`    | same form, personal scope                        | MCP bearer token (user-owned)    |

There is exactly one credential-entry control in the whole product, reused by all three. Every other
integration is OAuth: the browser never handles the secret at all.

## 2. Screenshots — a credential being entered

Captured with `apps/web/e2e/tools/credential-masking-probe.ts` against the running dev stack, at the
standard shot set (1440x900 and 390x844, light and dark). The bearer field is filled with the probe
value `dkt_probe_A7F3C1E9B2D64058` (24 characters) in every shot.

```
$ eval "$(../../scripts/dev-stack.sh env)" && pnpm exec tsx e2e/tools/credential-masking-probe.ts \
    --session=.data/design-review/session.json \
    --out=../../docs/design/audits/screenshots/2026-08-02-credential-masking \
    --token=dkt_probe_A7F3C1E9B2D64058
[credential-masking-probe] token=dkt_probe_A7F3C1E9B2D64058
[credential-masking-probe] bearer field type: password
[credential-masking-probe] bearer store outcome: rejected: Could not connect that server.
[credential-masking-probe] responses captured: 628
[credential-masking-probe] responses containing the token: 0
[credential-masking-probe] token in rendered text: false
[credential-masking-probe] token in web storage: false
```

| Artifact                                                                           | What it shows                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `../screenshots/2026-08-02-credential-masking/connector-bearer-1440x900-light.png` | Add-a-connector dialog, credential rendered as 24 dots |
| `../screenshots/2026-08-02-credential-masking/connector-bearer-1440x900-dark.png`  | same, dark                                             |
| `../screenshots/2026-08-02-credential-masking/connector-bearer-390x844-light.png`  | same, mobile light                                     |
| `../screenshots/2026-08-02-credential-masking/connector-bearer-390x844-dark.png`   | same, mobile dark                                      |

All four were read back and inspected. The field renders a run of bullet glyphs; no character of the
probe value is legible in any of them. The DOM attribute behind that is `type="password"`, read live
rather than assumed (`bearerFieldType: password` in the report).

## 3. Screenshots — a credential-bearing connector already stored

A connector really was stored on the server during the probe (`Sunsama`, `https://mcp.sunsama.com/mcp`,
status `Ready for Athena`, `2 tools available`). The probe reopens the page and expands
**Connection details**, which is everything the surface will show about a stored connection.

| Artifact                                                                           | What it shows                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `../screenshots/2026-08-02-credential-masking/stored-connector-1440x900-light.png` | Stored connector row, details expanded: Server, Tool prefix, Verify, Disconnect |
| `../screenshots/2026-08-02-credential-masking/stored-connector-1440x900-dark.png`  | same, dark                                                                      |
| `../screenshots/2026-08-02-credential-masking/stored-connector-390x844-light.png`  | same, mobile light                                                              |
| `../screenshots/2026-08-02-credential-masking/stored-connector-390x844-dark.png`   | same, mobile dark                                                               |

Nothing credential-shaped appears — not a masked field, not a last-4, nothing. That is the contract,
not an omission: `McpIntegrationOut` in `domains/connections/src/contracts/integration.ts` has no credential field
for the row to render.

## 4. Network capture

The probe records every HTTP response the page receives across the whole session — initial load,
connector create, reload, and all four screenshot passes — and searches each body for the probe
value.

```
total responses captured        628
of which Docket API (/v1/)       50   (48x 200, 2x 409)
total response body characters  142,410,529
responses containing the token           0
probe token in rendered page text    false
probe token in localStorage/sessionStorage  false
```

Endpoints exercised with the credential in play:

```
POST /v1/orgs/<orgId>/integrations/mcp/preview   200  (x6)
POST /v1/orgs/<orgId>/integrations/mcp           409  (x2)  ← see §6
GET  /v1/orgs/<orgId>/integrations/mcp           200  (x9)
```

Raw capture: `../screenshots/2026-08-02-credential-masking/probe-report.json`.

## 5. Server logs

```
$ grep -c "dkt_probe_A7F3C1E9B2D64058" /tmp/docket-dev.log
0
```

`/tmp/docket-dev.log` is the combined stdout/stderr of the whole dev stack (`scripts/dev-stack.sh`),
covering the web app and the API for the entire session in which the credential was typed and
submitted. Zero occurrences.

This is also asserted mechanically rather than only observed:
`apps/api/tests/security/credential-masking.test.ts` spies on every `console` channel while the API
stores a bearer credential and fails if any line contains it.

## 6. What could NOT be produced here, and why

**A bearer credential could not be stored through the running dev stack.** The two `409`s in §4 are
that failure. The cause is not the live health check the previous audit pass assumed — it is the
sealing key:

```ts
// apps/api/src/lib/credentials.ts
function sealingKey(): Buffer {
  const raw = env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new ConflictError(
      'CREDENTIALS_ENCRYPTION_KEY is not configured; refusing to store a credential',
    );
  }
```

```
$ grep -n "CREDENTIALS_ENCRYPTION_KEY" .env.local scripts/dev-stack.sh
(no matches)
```

Neither `.env.local` nor `scripts/dev-stack.sh` sets it, so `POST /v1/orgs/:orgId/integrations/mcp`
with `authMode: 'bearer'` always answers 409 on this stack, and no bearer credential can reach the
database to be photographed. The stack is shared with other agents mid-run, so it was not restarted
with the key set.

Consequence: §2 photographs a credential being **entered** and §3 photographs a **stored** connector
that has no credential, but no screenshot in this repository shows the UI's treatment of a stored
credential's _value_ — because the product never renders one anywhere, there is nothing to
photograph even once the key is configured.

**The gap is closed by an automated proof instead**, which can configure the sealing key:

```
$ pnpm --filter @docket/api exec vitest run tests/security/credential-masking.test.ts
 ✓ stored credential masking > never returns an org connector credential in any response body
 ✓ stored credential masking > never returns a personal Athena connection credential in any response body
 ✓ stored credential masking > writes no credential material to stdout or stderr while storing one
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

That suite stores a real bearer credential on both credential-storing surfaces, asserts the create
response, the list response, and every console channel are free of it as raw text, and asserts the
row at rest holds only a `v1:gcm:` AES-256-GCM envelope that unseals back to the original.

## 7. Residual work for the owning lane

1. Add `CREDENTIALS_ENCRYPTION_KEY` to `scripts/dev-stack.sh` (or `.env.example` → `.env.local`) so
   the bearer connector path is exercisable in dev at all. Today it is dead on every developer
   machine, and the failure surfaces to the user as the generic "Could not connect that server." —
   which points at the remote server rather than at local configuration.
2. Re-run this probe once that lands, to photograph the stored-bearer-connector row directly.

## 8. Verdict

| Acceptance clause                                              | Status  | Evidence                                                                                                                                              |
| -------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screenshots at 1440x900, light and dark, show the value masked | pass    | §2, four PNGs read back                                                                                                                               |
| A network capture shows no full key in any response body       | pass    | §4, 628 responses / 142M characters / 0 hits                                                                                                          |
| Server logs for the same session contain no key material       | pass    | §5, `grep -c` → 0, plus an automated console assertion                                                                                                |
| ...on **every** settings surface that stores a credential      | partial | One shared component covers all three surfaces, but only `/settings/athena` was photographed; and no _stored_ credential could be created in dev (§6) |

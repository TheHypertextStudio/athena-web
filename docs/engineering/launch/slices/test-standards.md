---
slice: test-standards
branch: claude/docket-production-launch-ebe2d9
requirementIds: [GEN-10, GEN-15, GEN-16, SCR-16, SCR-17, SCR-18, SCR-21, SCR-22]
outcomes:
  GEN-10: partial
  GEN-15: partial
  GEN-16: partial
  SCR-16: partial
  SCR-17: pass
  SCR-18: pass
  SCR-21: pass
  SCR-22: partial
filesChanged:
  - apps/web/e2e/athena/athena-personal.spec.ts
  - apps/web/e2e/athena/composer-reset.spec.ts
  - apps/web/e2e/athena/verify-composer.spec.ts
  - apps/web/e2e/auth/account-eol.spec.ts
  - apps/web/e2e/auth/passkey-signal.spec.ts
  - apps/web/e2e/auth/recovery-codes.spec.ts
  - apps/web/e2e/auth/sign-in.spec.ts
  - apps/web/e2e/calendar/calendar-viewport-floor.spec.ts
  - apps/web/e2e/calendar/google-calendar.spec.ts
  - apps/web/e2e/calendar/layered-calendar-drawer.spec.ts
  - apps/web/e2e/calendar/layered-calendar.spec.ts
  - apps/web/e2e/mcp/mcp-connect-cold-start.spec.ts
  - apps/web/e2e/mcp/mcp-connect.spec.ts
  - apps/web/e2e/mcp/mcp-session.spec.ts
  - apps/web/e2e/platform/notifications.spec.ts
  - apps/web/e2e/platform/pwa-offline.spec.ts
  - apps/web/e2e/scheduling/fluid-scheduling-all-day.spec.ts
  - apps/web/e2e/scheduling/fluid-scheduling-dense-overflow.spec.ts
  - apps/web/e2e/scheduling/fluid-scheduling-gestures.spec.ts
  - apps/web/e2e/scheduling/fluid-scheduling-grid-drop.spec.ts
  - apps/web/e2e/scheduling/fluid-scheduling-relations.spec.ts
  - apps/web/e2e/scheduling/fluid-scheduling.spec.ts
  - apps/web/e2e/work/verify-attachments.spec.ts
  - apps/web/e2e/work/verify-today.spec.ts
  - apps/web/e2e/tools/credential-masking-probe.ts
  - apps/api/tests/security/route-auth.test.ts
  - apps/api/tests/security/credential-masking.test.ts
  - packages/test-utils/tests/workspace-policies/test-layout-policy.test.ts
  - packages/test-utils/tests/workspace-policies/e2e-discipline-policy.test.ts
  - packages/test-utils/tests/workspace-policies/athena-boundary-policy.test.ts
  - docs/engineering/specs/core-e2e.md
  - docs/design/audits/security/2026-08-02-credential-masking.md
  - docs/design/audits/screenshots/2026-08-02-credential-masking/
verifier: credential-masking-probe
verifierArtifacts:
  - docs/design/audits/screenshots/2026-08-02-credential-masking/probe-report.json
  - docs/design/audits/screenshots/2026-08-02-credential-masking/connector-bearer-1440x900-light.png
  - docs/design/audits/screenshots/2026-08-02-credential-masking/connector-bearer-1440x900-dark.png
  - docs/design/audits/screenshots/2026-08-02-credential-masking/stored-connector-1440x900-light.png
verification: 'pnpm --filter @docket/test-utils test — 15 files / 104 passed; pnpm --filter @docket/api test — 183 files / 1608 tests, 1607 passed (1 pre-existing failure in tests/mcp/mcp-auth.test.ts, another lane); pnpm --filter @docket/web exec playwright test --list — Total: 41 tests in 24 files (identical to pre-move)'
---

## Lane collisions to know about before reading this

Three of the files this slice was assigned were concurrently rewritten by other workers while it
ran. Rather than fight over them, this slice adapted; each is called out where it matters.

| File                                                                      | What happened                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/test-utils/tests/workspace-policies/test-layout-policy.test.ts` | Another worker refactored its filesystem walkers into a shared `workspace-policies/testing-tree.ts`. Kept; this slice re-added the anti-tautology proof (below).                                                                                              |
| `docs/design/surface-inventory.md`                                        | Another worker made it a **generated** file (`scripts/surface-inventory.ts`) with a byte-currency policy test. Their version is better than the hand-written one this slice had produced; ceded and verified.                                                 |
| `apps/api/tests/security/route-auth-matrix.test.ts`                       | Another worker consolidated it into `apps/api/tests/security/route-auth.test.ts` alongside their machine-edge tests. The `route auth matrix` describe is unchanged and passes; the path in `filesChanged` reflects reality, not the contract's original name. |

---

## SCR-22 — Relocate every Playwright spec out of the `apps/web/e2e` root

**Acceptance:** "`ls apps/web/e2e/*.spec.ts` returns nothing — all 23 specs presently at that root
live in subdirectories. Afterwards `pnpm --filter @docket/web test:e2e` discovers and passes a spec
count greater than or equal to the pre-move count, with zero specs silently dropped from discovery."

**What was built:** All **24** specs (the manifest's 23 plus `calendar-viewport-floor.spec.ts`,
which was untracked and therefore missing from the audit) moved into seven topical subdirectories:
`auth/` (4), `calendar/` (4), `scheduling/` (6), `athena/` (3), `mcp/` (3), `platform/` (2),
`work/` (2). `git mv` was used for the 23 tracked specs so history follows; the untracked one moved
with `mv`. Every `'./helpers/…'` import was rewritten to `'../helpers/…'`. `helpers/`, `tools/`, and
`tsconfig.json` stayed at the root. `playwright.config.ts` needed no change (`testDir: './e2e'` +
`testMatch: '**/*.spec.ts'` already recurses) and was not touched.

**Evidence:**

```
# before
$ pnpm --filter @docket/web exec playwright test --list | tail -1
Total: 41 tests in 24 files

# after
$ pnpm --filter @docket/web exec playwright test --list | tail -1
Total: 41 tests in 24 files

$ ls apps/web/e2e/*.spec.ts
zsh: no matches found: apps/web/e2e/*.spec.ts

$ ls apps/web/e2e
athena  auth  calendar  helpers  mcp  platform  scheduling  tools  tsconfig.json  work
```

Import rewrite proved by running moved specs end to end, not only by discovery:

```
$ pnpm exec playwright test e2e/auth/sign-in.spec.ts
  ✓  1 [chromium] › e2e/auth/sign-in.spec.ts:10:3 › passkey sign-in › returns to onboarding …
  1 passed (1.5s)

$ pnpm exec playwright test e2e/platform/pwa-offline.spec.ts e2e/calendar/calendar-viewport-floor.spec.ts
  6 passed, 2 failed (3.3m)
```

Also verified that nothing but the import line changed: for every moved spec,
`diff <(git show HEAD:<old path>) <new path>` filtered to non-`helpers/` lines is empty except
where other agents edited spec bodies concurrently (`layered-calendar`, three `fluid-scheduling-*`).

**Residual gap — why this is `partial` and not `pass`:** the acceptance has two halves and only one
was measured. "Discovers **and passes** a spec count greater than or equal to the pre-move count"
was closed on discovery alone. Discovery is sound and re-verified independently at 25 files / 42
tests against a pre-move baseline of 23 tracked specs
(`docs/engineering/launch/evidence/verification/2026-08-02-launch-record-reconciliation.txt` §2),
but the full suite has never been run green: `apps/web/playwright.config.ts` is
`fullyParallel: false` / `workers: 1` with a 180s per-test timeout, and every spec mutates the one
embedded pglite dev database that other agents are using concurrently, so running it here would have
destroyed their state. The outstanding command, against an isolated stack, is
`pnpm --filter @docket/web test:e2e`, and its summary line belongs in this section.

The two failures below are **not** caused by the move —
`pwa-offline.spec.ts` is byte-identical to its `HEAD` version (it imports no helpers), and its
failure is an assertion (`expected 0 cached build entries, received 37`); `calendar-viewport-floor`
times out on `locator.click` against the calendar rebuild another lane has in flight (its source
tree currently has `calendar-scheduling-sidebar.tsx` and `calendar-week-grid.tsx` deleted). Both are
recorded under SCR-16 rather than here, because the acceptance clause this requirement owns —
discovery count preserved, root empty — is met.

## SCR-17 — No test file colocated in a package `src/`

**Acceptance:** "A repo policy test enumerates every workspace and fails if any file matching
`*.test.*` or `*.spec.*` exists under a package's `src/` directory; the test passes with zero
violations across `apps/{web,api,admin,runner}`, `packages/*`, and `services/*`."

**What was built:** `packages/test-utils/tests/workspace-policies/test-layout-policy.test.ts`. The
enumeration covers `services/*` explicitly, which the shared `collectWorkspacePackages()` helper
omits (it walks `apps`, `packages`, `tooling` only) — that gap was closed without editing the shared
helper, which other policy suites depend on. The suite asserts the enumeration actually reached
`apps/web`, `apps/api`, `apps/admin`, `apps/runner`, `packages/test-utils`, and
`services/discord-relay` before trusting a zero-violation result.

**Anti-tautology proof:** `it('actually reports a planted violation of each rule')` plants a
throwaway workspace package containing one colocated test and one root-level spec, runs the _real_
collectors over it, asserts each is reported and that a non-test `helper.ts` beside them is not,
then removes the package and asserts it is gone. The probe package name is dot-prefixed so
`readdirSync` sees it but glob-based discovery (pnpm workspaces, Vitest, Playwright) does not.

**Evidence:**

```
$ pnpm --filter @docket/test-utils exec vitest run tests/workspace-policies
 Test Files  8 passed (8)
      Tests  41 passed (41)
```

**Residual gap:** none.

## SCR-21 — No test file at the root of any testing directory

**Acceptance:** "A policy test enumerates every testing directory in the repo (each workspace's
`tests/` plus `apps/web/e2e`) and fails if any file matching `*.test.*` or `*.spec.*` sits directly
at that directory's root instead of inside a subdirectory. The test passes with zero violations
repo-wide."

**What was built:** the second half of the same file. It enumerates 20 testing directories (19
workspace `tests/` directories plus `apps/web/e2e`), asserts the count is at or above a floor and
that `apps/web/e2e` is in the set, then requires zero root-level test files. The floor exists so a
walker that silently stopped enumerating fails loudly instead of turning the rule vacuously green.
`packages/test-utils/tests/workspace.ts` is proved to be treated as a helper rather than a test file
by an explicit `isTestFileName('workspace.ts') === false` assertion.

**Evidence:** the run above; the rule is only satisfiable because SCR-22's move landed first —
before it, `apps/web/e2e` held 24 root-level specs.

**Residual gap:** none.

## SCR-18 — Documentation identifies the core end-to-end tests

**Acceptance:** "A committed document under `docs/engineering/` lists each core end-to-end test by
spec path with a one-line description of the journey it covers, and an automated check asserts
(a) every listed path exists on disk and (b) every spec tagged/marked core appears in the
document — the check fails if the two lists diverge."

**What was built:** `docs/engineering/specs/core-e2e.md` registers **all 24** specs — not only the
core ones — with a `Core` column (`Yes`/`No`) and a one-line journey description derived by reading
each spec's tests and module docs, never guessed from filenames. Registering every spec makes the
divergence check bidirectional: adding a spec without documenting it is a failure, and so is
documenting a spec that no longer exists. §1 of the document specifies the machine-readable format
(`| Spec path | Core | Journey |`, path in backticks, `Core` literally `Yes`/`No`) so it stays
parseable; §3 states the criterion used to decide core vs not.

16 specs are marked core; the rest are not (three past-bug regression guards, two edge cases inside
a journey a core spec already covers, and the screenshot-capture specs).

The check is `packages/test-utils/tests/workspace-policies/e2e-discipline-policy.test.ts`. Its
parser throws on a malformed register rather than silently yielding zero rows, and is proved against
both a well-formed fixture and three malformed ones.

**A second register existed, and the two disagreed.** `docs/engineering/core-e2e-tests.md` graded 13
specs core where this one grades 16; they enumerated the same specs but split on seven of them, and
`verify-composer.spec.ts` was a core journey in one document and "asserts only that the composer
opens" in the other. Each had its own passing guard, so neither could see the contradiction. The
duplicate and its guard (`e2e-suite-policy.test.ts`) are gone, its Layout and Running sections were
folded into the surviving register, and the guard now carries a rule that makes the situation
unrepeatable: any other Markdown file under `docs/` whose table rows are keyed on an e2e spec path
is reported as a competing register and fails the check. The floor that made
`e2e-suite-policy.test.ts` worth keeping — at least 24 specs discovered, so an empty walker cannot
make every rule vacuously green — moved across with it.

**Evidence:**

```
$ pnpm --filter @docket/test-utils exec vitest run tests/workspace-policies/e2e-discipline-policy.test.ts
 ✓ parses a well-formed register and rejects a malformed one
 ✓ detects every disabling modifier and ignores prose and timeouts
 ✓ lists a real, non-empty set of core journeys
 ✓ keeps the core-e2e register and the specs on disk in lockstep
 ✓ has no skipped, focused, or fixme specs anywhere under apps/web/e2e
 ✓ keeps every spec inside a topical subdirectory of apps/web/e2e
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

**Residual gap:** none.

## SCR-16 — All behavior covered by e2e tests, with no skipped or disabled specs

**Acceptance:** "Every core user journey listed in the core-e2e document has at least one Playwright
spec, and `pnpm --filter @docket/web test:e2e` passes with zero skipped, `.fixme`, or `.only` specs
(asserted by a lint/policy check over the e2e sources)."

**What was built:** the core-e2e document (SCR-18) closes the first clause — every core journey it
lists _is_ a spec path that the check proves exists on disk. The zero-disabled clause is now
enforced mechanically: `findDisabledMarkers` walks each spec's TypeScript AST and reports any
`skip`/`only`/`fixme`/`failing` modifier on `test`, `it`, or `describe`, including the
`test.describe.skip` chain. It is parsed rather than grepped because `.skip` and `.only` appear
inside doc comments in this repo and a grep reports those as violations. `test.slow()` is
deliberately not treated as a disabler. The detector is proved against a fixture containing all
seven disabling forms plus prose and a `test.slow()` that must not match.

**Evidence:** the run above — `has no skipped, focused, or fixme specs anywhere under apps/web/e2e`
passes over all 24 specs.

**Residual gap — this is why the outcome is `partial`, not `pass`:** the clause
"`pnpm --filter @docket/web test:e2e` passes" was **not** demonstrated. The full suite takes ~5
minutes against a dev stack shared with several other agents actively rewriting the calendar,
scheduling, and MCP surfaces, so a full run measures their in-flight work rather than this slice's.
Of the three specs sampled end to end, two failed for reasons this slice did not introduce:

- `e2e/platform/pwa-offline.spec.ts:218` — `does not cache build output in development`, `expected
0, received 37`. The file is byte-identical to `HEAD`.
- `e2e/calendar/calendar-viewport-floor.spec.ts:106` — `locator.click` timeout at 180s, against a
  calendar surface with deleted components in the working tree.

Whoever runs the final gate must run the whole suite against a quiet stack and drive both to green.
That belongs to the calendar and platform lanes, not to this slice.

## GEN-06 — reassigned to the `ci-gating` slice

> **Not claimed by this slice.** GEN-06 has two clauses — a secret scan and an auth-middleware
> matrix — and for a while three slices each claimed the whole requirement on the strength of one
> clause: this file and `security-and-domains.md` both read `pass` on clause 2, while
> `ci-gating.md` read `partial` on clause 1. All three were internally honest and the set was
> misleading, because a reader who opened either `pass` would have believed GEN-06 was satisfied
> when the scan half was not.
>
> A requirement belongs to exactly one slice, so GEN-06 now belongs to **`ci-gating`**, which holds
> the weaker and therefore the truthful grade (`partial`: the acceptance names "gitleaks or
> trufflehog" and the gate is the in-repo `scripts/secret-scan.ts`, which reads the tracked tree
> rather than history). Splitting one requirement across slices by clause is no longer expressible:
> `multiClaimViolations()` in `packages/test-utils/tests/launch-policies/launch-record-schema.ts`
> fails the build if any id appears in two slices' `outcomes`, and
> `DOUBLE_CLAIM_ALLOWLIST` — which had exempted GEN-06 from the reconciler's own duplicate check —
> is gone from `scripts/launch-record.ts`.
>
> The clause-2 work below is this slice's and is kept as the record of what it contributed. See
> `docs/engineering/launch/slices/ci-gating.md` for the graded claim.

### What this slice contributed

**Acceptance (clause 2 of 2):** "…and the auth-middleware test suite proves every production API
route that returns user data rejects an unauthenticated request with 401/403."

**What was built:** the `route auth matrix` suite, now living in
`apps/api/tests/security/route-auth.test.ts`. It boots the real `/v1` app against PGlite in the boot
order `src/server.ts` uses (`sessionMiddleware` → the non-RPC `/v1` mounts → the typed app, which
registers `requireAuth` on `*` → the Problem `onError`) — `server.ts` itself cannot be imported
because it calls `serve()` at module scope. It then **derives the route list from the app's own
generated OpenAPI document** (`GET /v1/openapi.json`, the production code path) rather than from a
hand-maintained list, so a route added tomorrow is probed the moment it appears in the document.

Path parameters are substituted with a ULID; every request is anonymous (`@docket/auth` is mocked to
resolve no session); non-GET methods send an empty JSON body, so the gate is measured _before_
schema validation. `GET /v1/config` is the single documented public-route allowlist entry, and its
payload is separately constrained to a fixed key set plus a scan for credential shapes. Two
user-data routes that `server.ts` mounts _outside_ the typed app — and which therefore never reach
`requireAuth` — are probed explicitly: `GET /v1/stream/sse` and
`GET /v1/me/account/exports/:exportId/file`. The staff `/admin` surface is probed too.

**Evidence:**

```
$ pnpm --filter @docket/api exec vitest run tests/security/route-auth.test.ts -t "route auth matrix"
 ✓ derives a substantial route list from the published API document
 ✓ rejects every anonymous request to a documented route except the public allowlist
 ✓ rejects anonymous requests to the user-data routes mounted outside the document
 ✓ serves only public deployment configuration from the one allowlisted route
 ✓ keeps the staff back-office unreachable without a session
 Tests  5 passed
```

Route coverage, counted independently from the live dev stack's own document:

```
$ curl -s "$API_URL/v1/openapi.json" | python3 -c "…"
total probes: 320
Counter({'GET': 128, 'POST': 115, 'DELETE': 40, 'PATCH': 33, 'PUT': 4})
```

320 method/path pairs, all answering 401/403 anonymously except `GET /v1/config`. That is 4.4x the
73 GET-only probes the compliance baseline recorded, and it now covers POST/PATCH/PUT/DELETE.

**Residual gap:** clause 1 — "a secret scan (gitleaks or trufflehog) over the repo at the launch
commit reports zero findings" — was never in this slice, and clause 2 alone does not satisfy
GEN-06. That is the whole reason the claim moved: `ci-gating` owns the requirement and grades it
`partial` until the scan clause is closed with one of the named binaries.

## GEN-07 — reassigned to the `security-and-domains` slice

> **Not claimed by this slice.** GEN-07 was worked here and, concurrently, by the
> `security-and-domains` lane, which finished it: that slice claims GEN-07 `pass` and carries the
> completed surface screenshots under
> `docs/design/audits/screenshots/2026-08-02-credential-masking/surfaces/`, where this slice could
> only claim `partial`. A requirement belongs to exactly one slice, so the claim was removed from
> this file's frontmatter during lane integration and the work below is kept as the record of what
> this slice contributed to it — the probe tool, the audit write-up, and the stored-credential API
> test. See `docs/engineering/launch/slices/security-and-domains.md` for the graded claim.

### What this slice contributed

**Acceptance:** "On every settings/integration surface that stores a credential, screenshots at
1440x900 in light and dark show the value masked (e.g. last-4 only); a network capture of the same
page shows no full key in any response body, and server logs for the same session contain no key
material."

**What was built:** `apps/web/e2e/tools/credential-masking-probe.ts`, a reusable evidence tool that
drives the signed-in dev session through Settings → Athena, stores a connector, types a probe
credential into the bearer field, screenshots the standard shot set (1440x900 and 390x844, light and
dark) of both the credential-entry dialog and the stored-connector row, and records every HTTP
response the page receives while searching each body for the probe value. Findings are written up in
`docs/design/audits/security/2026-08-02-credential-masking.md` with eight PNGs and a machine report
under `docs/design/audits/screenshots/2026-08-02-credential-masking/`.

**Evidence:**

```
$ eval "$(../../scripts/dev-stack.sh env)" && pnpm exec tsx e2e/tools/credential-masking-probe.ts \
    --session=.data/design-review/session.json \
    --out=../../docs/design/audits/screenshots/2026-08-02-credential-masking \
    --token=dkt_probe_A7F3C1E9B2D64058
[credential-masking-probe] bearer field type: password
[credential-masking-probe] responses captured: 628
[credential-masking-probe] responses containing the token: 0
[credential-masking-probe] token in rendered text: false
[credential-masking-probe] token in web storage: false

$ grep -c "dkt_probe_A7F3C1E9B2D64058" /tmp/docket-dev.log
0
```

628 responses / 142,410,529 characters of body text scanned, zero hits. All eight PNGs were read
back and inspected: the bearer field renders as a run of bullet glyphs at both widths in both
themes, and the stored-connector row with **Connection details** expanded shows Server and Tool
prefix only — nothing credential-shaped, because `McpIntegrationOut` has no credential field.

Because the browser evidence could only photograph a credential being _entered_ (see below), the
stored-credential half is proved by `apps/api/tests/security/credential-masking.test.ts`, which
configures the sealing key, stores a real bearer credential on **both** credential-storing surfaces,
and asserts the create response, the list response, and every `console` channel are free of it as
raw text, and that the row at rest holds only a `v1:gcm:` envelope that unseals to the original:

```
$ pnpm --filter @docket/api exec vitest run tests/security/credential-masking.test.ts
 ✓ never returns an org connector credential in any response body
 ✓ never returns a personal Athena connection credential in any response body
 ✓ writes no credential material to stdout or stderr while storing one
 Tests  3 passed (3)
```

**Residual gap:**

1. **A bearer credential cannot be stored through the dev stack at all**, so no screenshot in this
   repository shows a stored credential's value being masked. The cause is _not_ the live health
   check the previous audit pass assumed — it is that neither `.env.local` nor `scripts/dev-stack.sh`
   sets `CREDENTIALS_ENCRYPTION_KEY`, so `sealCredential` answers 409
   ("refusing to store a credential") on every bearer create. The stack is shared with other agents
   mid-run, so it was not restarted with the key set. **Owner: the platform/dev-environment lane** —
   add the key to `scripts/dev-stack.sh`, then re-run the probe. Today this failure reaches the user
   as the generic "Could not connect that server.", which points at the remote server rather than at
   local configuration.
2. Of the three surfaces that store a credential, only `/settings/athena` was photographed. The
   other two (`/orgs/:orgId/settings/connections` and the personal-Athena connection form) render
   the _same_ `McpConnectorsSection` component, so the masking is the same code path — but that is
   an inference, not a photograph. **Owner: this slice, on a re-run once (1) lands.**

## GEN-10 — No surface ships knowingly degraded

**Acceptance:** "A committed surface inventory enumerates every user-facing route and overlay… Every
entry in that inventory has a Craft Rubric scorecard… The number of inventory entries without a
scorecard is zero, and the number of scorecards recording a known-degraded or 'ship anyway' state is
zero."

**What was built:** the inventory now exists at `docs/design/surface-inventory.md`. **It is not this
slice's artifact.** A concurrent worker turned it into a generated file
(`scripts/surface-inventory.ts`) with a byte-currency policy test
(`packages/test-utils/tests/design-policies/surface-inventory.test.ts`) that fails if the committed
document drifts from the source tree. That is strictly better than the hand-written inventory this
slice had produced, so this slice ceded the file, regenerated it, and verified it.

What this slice contributes to GEN-10 is the verification and the numbers.

**Evidence:**

```
$ pnpm exec tsx scripts/surface-inventory.ts
Wrote docs/design/surface-inventory.md

$ pnpm --filter @docket/test-utils exec vitest run tests/design-policies
 Test Files  2 passed (2)
      Tests  10 passed (10)
```

The two counts the acceptance names, read out of the generated document and cross-checked against
the scorecards on disk:

| Count                                                       | Required | Actual                                                                                                                                                        |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory entries without a scorecard                       | 0        | **46** of 85 surfaces                                                                                                                                         |
| Scorecards recording a known-degraded / "ship anyway" state | 0        | **4** — `2026-06-10-design-pass`, `2026-07-06-athena-surfaces`, `2026-07-10-project-management` (all `needs-work`), `2026-08-02-calendar-round-1` (BELOW BAR) |

GEN-10's acceptance also names **published-brief templates**. No such surface exists:
`grep -rn 'publishedBrief|PublishedBrief|briefTemplate' apps packages` returns nothing; the only
`brief` in the product is an MCP tool name (`apps/api/src/mcp/plan-tools.ts:83`). There is nothing to
audit, and nothing to inventory, until it is built.

**Residual gap:** 46 surfaces need Craft Rubric scorecards and 4 degraded verdicts need remediation.
Both are design work on surfaces owned by the feature lanes — scoring 46 surfaces is not something a
test-standards slice can produce honestly. Nine of the 46 are org-scoped settings routes that render
the same components as their personal counterparts, which `2026-07-14-settings-production` already
audits; confirming that equivalence and extending that scorecard's `surfaces:` frontmatter is the
cheapest way to close them.

## GEN-15 — Athena not strictly coupled to Docket

**Acceptance:** "Athena's core packages reference Docket only through a named port/adapter
interface; typechecking and the Athena test suite both pass with the Docket adapter replaced by a
mock implementation, with no compile errors from missing Docket modules."

**What was built:** `packages/test-utils/tests/workspace-policies/athena-boundary-policy.test.ts`.
It defines the Athena core surface as `packages/agent-runtime/src/**` — verified by enumerating
every workspace package; it is the only one whose subject is Athena's reasoning surface — and states
in its `@remarks` why `apps/api/src/routes/*athena*` and `apps/api/src/agent/**` are Docket-side
adapters rather than Athena core. It asserts that no file on that surface imports anything Docket
owns except `@docket/types`, and that the package manifest declares no Docket internal package at
runtime (with build-tooling devDependencies allowed through a separate, narrower list so a runtime
dependency cannot be smuggled in under `devDependencies`).

Imports are read off the TypeScript AST — static imports, re-exports, `import x = require()`,
dynamic `import()`, and bare `require()` — not grepped, because `@docket/db` appears in doc comments
and prose strings throughout this repo and a grep-based version of this check produced false
positives while it was being written. The detector is proved against a fixture where the only
non-violating occurrences are a doc comment and a string literal.

**Evidence:**

```
$ pnpm --filter @docket/test-utils exec vitest run tests/workspace-policies/athena-boundary-policy.test.ts
 ✓ detects real boundary-crossing imports and ignores prose that mentions them
 ✓ keeps Docket schema, query helpers, and server internals out of Athena core
 ✓ declares no Docket internal package in the Athena core manifest
 ✓ never lets the Docket-hosted agent loop spread its internal coupling to new modules
 Tests  4 passed (4)
```

`packages/agent-runtime` passes with zero violations: its whole dependency set is
`@anthropic-ai/sdk`, `@docket/types`, and `zod`, so it already satisfies something stronger than the
acceptance — it needs no Docket adapter to mock, because it has none.

**Residual gap:** the acceptance is about Athena's _core capabilities_, and the reasoning loop is not
in that package. It lives in `apps/api/src/agent/**` and hard-binds Docket's schema and server
internals. Measured, with file:line, by the ledger this check enforces:

| Module                                             | Docket internals imported                                                                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/agent/assignments.ts:25,29,30,31`    | `@docket/authz`, `../error`, `../routes/event-emit`, `../routes/agent-session-runner`                                                                                                         |
| `apps/api/src/agent/async-runner.ts:2,6,7,8`       | `@docket/db`, `../error`, `../env`, `../routes/agent-session-helpers`                                                                                                                         |
| `apps/api/src/agent/execution-advance.ts:2,5,6`    | `@docket/db`, `../error`, `../routes/agent-session-helpers`                                                                                                                                   |
| `apps/api/src/agent/execution-nonce.ts:2`          | `@docket/db`                                                                                                                                                                                  |
| `apps/api/src/agent/loop.ts:31,37-44`              | `@docket/db`, `../billing/entitlement`, `../container`, `../error`, `../env`, `../mcp/internal-session`, `../mcp/auth`, `../routes/agent-session-approval`, `../routes/agent-session-helpers` |
| `apps/api/src/agent/proposals.ts:14,19,20,21`      | `@docket/db`, `../error`, `../lib/capture-title`, `../routes/agent-session-helpers`                                                                                                           |
| `apps/api/src/agent/run-generation.ts:10,13,14,15` | `@docket/db`, `../error`, `../env`, `../routes/agent-session-helpers`                                                                                                                         |
| `apps/api/src/agent/toolbox.ts:19,35-38`           | `@docket/integrations`, `../container`, `../lib/credentials`, `../mcp/internal-session`, `../mcp/server`                                                                                      |
| `apps/api/src/agent/transcript.ts:11,12`           | `@docket/db`                                                                                                                                                                                  |

3 of the 12 modules in that directory are clean (`approval-policy.ts`, `execution-hmac.ts`,
`system-prompt.ts`). Per this lane's binding decision, product source was **not** modified — the
Athena/API lane owns `apps/api/src`. The ledger is enforced as a shrink-only ratchet, so the debt is
measured and cannot spread to new modules while that lane works. GEN-15 reads `partial`: the boundary
is real and enforced where Athena core exists, and precisely quantified where it does not.

## GEN-16 — Athena built _in_ Docket, never _through_ Docket

**Acceptance:** "No Athena module imports Docket's internal DB schema, query helpers, or server
internals (enforced by a lint rule or dependency-graph check that fails CI on violation), and
Athena's model/agent invocation path contains zero hops that require a Docket API request to
succeed."

**What was built:** the same check. The **enforcement half of the acceptance is now satisfied** —
before this slice, `eslint.config.js` was 11 lines with no boundary rule and no dependency-graph
tool existed anywhere in the repo. The check runs inside `pnpm --filter @docket/test-utils test`,
which `turbo run test` invokes, so a violation fails CI.

**Evidence:** the run above; the ratchet test would fail on any new module under
`apps/api/src/agent/**` that binds Docket internals, which is the "fails CI on violation" clause.

**Residual gap:** the substantive half still fails, at exactly the nine file:line locations tabulated
under GEN-15. The compliance baseline separately established that the _second_ clause — zero Docket
HTTP hops in the model/agent invocation path — already holds
(`apps/api/src/agent/toolbox.ts` wires tools through an in-process MCP client over
`InMemoryTransport`, and the model call goes straight to the `AgentTurnRuntime` port). This slice did
not re-verify that clause and does not claim it. GEN-16 therefore reads `partial`: enforcement built
and running, boundary not yet clean. **Owner: the Athena/API lane.**

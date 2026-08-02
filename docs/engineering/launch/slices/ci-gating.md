---
slice: ci-gating
branch: claude/docket-production-launch-ebe2d9
requirementIds: [GEN-02, GEN-06, SCR-15, SCR-19, SCR-20, SCR-23, SCR-24, SCR-25]
outcomes:
  GEN-02: fail
  GEN-06: partial
  SCR-15: fail
  SCR-19: pass
  SCR-20: partial
  SCR-23: partial
  SCR-24: partial
  SCR-25: fail
filesChanged:
  - .github/workflows/ci.yml
  - .gitleaks.toml
  - scripts/ci-gate-policy.ts
  - scripts/production-verify.ts
  - tests/ci/ci-gate-policy.test.ts
  - tests/ci/turbo-graph.test.ts
  - package.json
  - docs/engineering/coverage-ledger.md
  - docs/engineering/launch/production-verification.md
  - docs/engineering/launch/evidence/production/2026-08-02-turbo-cache.txt
  - docs/engineering/launch/evidence/production/2026-08-02-turbo-remote-cache.txt
  - docs/engineering/launch/evidence/production/2026-08-02-scr20-forced-failure.txt
  - docs/engineering/launch/evidence/production/2026-08-02-secret-sweep.txt
verifier: production-verification-agent
verifierArtifacts:
  - docs/engineering/launch/evidence/production/2026-08-02T10-05-46-131Z-production-verify.txt
  - docs/engineering/launch/evidence/production/2026-08-02T10-05-46-131Z-production-verify.json
  - docs/engineering/launch/evidence/production/2026-08-02-scr20-forced-failure.txt
  - docs/engineering/launch/evidence/production/2026-08-02-secret-sweep.txt
verification: 'pnpm exec vitest run tests/ci — 24 passed (2 files); pnpm exec tsx scripts/ci-gate-policy.ts — PASS, exit 0; pnpm exec tsx scripts/production-verify.ts — FAIL, exit 1 (production 32 paths behind HEAD)'
---

## Summary

One sentence per requirement, then the detail.

| Id     | Outcome | One-line reason                                                                           |
| ------ | ------- | ----------------------------------------------------------------------------------------- |
| SCR-19 | pass    | Guard built, tested, and running in CI; `needs` is complete.                              |
| GEN-06 | partial | Clause 2 met; clause 1's scan finds 0 but is not one of the named binaries.               |
| SCR-20 | partial | Static + local-empirical proven. No GitHub Actions run observed.                          |
| SCR-23 | partial | Committed affected-set check exists and passes; one `^build` prerequisite is in the set.  |
| SCR-24 | partial | FULL TURBO measured, but only on the 2 build tasks that don't collide with the dev stack. |
| SCR-15 | fail    | Gate wired and gating; 13 of 16 packages are below threshold.                             |
| GEN-02 | fail    | Production is 32 endpoints behind HEAD — all of personal Athena is undeployed.            |
| SCR-25 | fail    | No `TURBO_TOKEN` / `TURBO_TEAM` / signature key exist. Remote cache is inert.             |

---

## SCR-19 — The production deploy must be gated on every test-running CI job succeeding

**Acceptance:** "In .github/workflows/ci.yml, `deploy-production.needs` includes every job that
executes tests or checks (currently quality, test, build, e2e), and a guard (policy test or lint
rule over the workflow file) fails when a new test-running job is added without being added to that
`needs` list."

**What was built:**

`scripts/ci-gate-policy.ts` — a typed module plus CLI that parses `.github/workflows/*.yml`, finds
the job that ships production, classifies every other job as check-running or not, and asserts each
check job appears in `deploy-production.needs`. It carries its own narrow YAML reader (`parseYaml`)
because the repo has no YAML parser in its dependency tree and this gate must not add one; the
reader throws on syntax it does not model rather than misparsing, which is the safe failure mode for
a gate.

Classification is deliberate rather than name-based: a job counts as a check job when a `run` step
invokes `turbo run` with `test`, `test:coverage`, `lint`, `typecheck`, or `build`, or names
`playwright` / `test:e2e` / `vitest` / `format:check` / `test:tooling` / `secret-scan` /
`ci:gate-policy`, or when it `uses` an action listed in `GATING_ACTION_PATTERNS` — which keeps a job
implemented purely as an action classified correctly even though nothing in `ci.yml` is one today.

The guard runs three ways: as `pnpm ci:gate-policy`, as a step in the `quality` CI job, and as
`tests/ci/ci-gate-policy.test.ts`.

`needs` was also extended, since this slice adds two check jobs:
`needs: [quality, secret-scan, test, coverage, build, e2e]`.

**Evidence:**

```
$ pnpm exec tsx scripts/ci-gate-policy.ts
CI gate policy (SCR-19 deploy gating, SCR-20 no soft-failed checks)

  .github/workflows/ci.yml: 7 job(s), check job(s): quality, secret-scan, test, coverage, build, e2e
    deploy-production.needs = [quality, secret-scan, test, coverage, build, e2e]
  .github/workflows/deploy.yml: 2 job(s), check job(s): (none)
  .github/workflows/neon-branch.yml: 3 job(s), check job(s): (none)

PASS — every check job gates the production deploy, and no gating step is soft-failed.
$ echo $?
0
```

The guard is proven to bite, not just to pass. `tests/ci/ci-gate-policy.test.ts` feeds it a
synthetic workflow whose `contract-tests` job runs `pnpm exec vitest run tests/contracts` and is
absent from `needs`, and asserts exactly one SCR-19 finding naming that job; a second fixture proves
the same for a job whose only step is `uses: gitleaks/gitleaks-action@v3`. A committed expectation
in the same file pins today's check-job list, so adding a check job to `ci.yml` fails the suite until
both that list and `needs` are updated.

> **Updated during lane integration ([LAUNCH-INTEGRATE-002]).** A second guard for this same
> requirement had been built concurrently — `ci-gating-policy.test.ts` over a line-based workflow
> reader in `testing-tree.ts`. Two guards over one requirement each validated their own model, so
> neither could see the other disagree. The duplicate is deleted and this is the only
> implementation; it now runs both as `pnpm ci:gate-policy` in the `quality` job and as
> `tests/ci/ci-gate-policy.test.ts` under `pnpm test:tooling`, which the `test` job now invokes.

```
$ pnpm exec vitest run tests/ci
 Test Files  2 passed (2)
      Tests  24 passed (24)
```

---

## GEN-06 — Minimize security holes (sole owner of both clauses)

**Acceptance:** "A secret scan (gitleaks or trufflehog) over the repo at the launch commit reports
zero findings, and the auth-middleware test suite proves every production API route that returns
user data rejects an unauthenticated request with 401/403."

This slice built clause 1 and grades the requirement. Clause 2 was built elsewhere and is met; see
"What is still missing" below for where its evidence lives and why the requirement is nonetheless
`partial`.

**What was built:**

A `secret-scan` job in `ci.yml`, listed in `deploy-production.needs` and checked out at
`fetch-depth: 0`. The config it reads, `.gitleaks.toml`, extends gitleaks' maintained upstream
ruleset (`[extend] useDefault = true`) rather than relying only on hand-written regexes.

> **Updated during lane integration ([LAUNCH-INTEGRATE-002]).** The job originally ran
> `gitleaks/gitleaks-action@v3`. That action requires a licence key for organization-owned
> repositories and `GITLEAKS_LICENSE` is unset, so as written the job would have failed on every run
> and blocked every deploy — see residual gap 2 below, which is now resolved rather than
> outstanding. In the same window another worker landed `scripts/secret-scan.ts`, a real
> network-free scanner over the _same_ `.gitleaks.toml` rules, with
> `packages/test-utils/tests/security/secret-scan.test.ts` feeding each rule a synthetic credential
> to prove it fires. The job now runs `pnpm secret-scan`. The licensed binary remains the documented
> second opinion for scanning history; `fetch-depth: 0` is kept for it.

**Evidence:**

```
$ pnpm exec tsx scripts/secret-scan.ts
Docket secret scan: 2001 tracked file(s), 12 rule(s)
PASS — 0 findings.

$ pnpm exec vitest run tests/ci   # includes: the job runs the scanner, no soft-fail, fetch-depth 0
      Tests  24 passed (24)

$ pnpm exec tsx scripts/ci-gate-policy.ts   # secret-scan classified as a check job, present in needs
PASS
```

Substitute scan, because the binary is not available here —
`docs/engineering/launch/evidence/production/2026-08-02-secret-sweep.txt`:

```
$ which gitleaks trufflehog
gitleaks not found
trufflehog not found

RULE                     FINDINGS
anthropic-api-key        0
stripe-live-key          0
aws-access-key-id        0
github-token             0
slack-token              0
google-api-key           0
private-key-block        0
jwt                      0
resend-api-key           0
twilio-account-sid       0
postgres-conn-string     0

## Total: 0 findings across 11 rules over 2052 tracked files.
```

The one credential-shaped committed value is quoted in full in that file:
`BETTER_AUTH_SECRET=dev-local-shared-secret-not-for-production-use-0000` in the tracked, skip-worktree'd
`.env.local` — a self-labelled dev-only value that signs sessions for an in-process PGlite database
on `*.localhost`. Every other assignment in that file is a `localhost` URL or a boolean.

**Residual gap:**

1. **History is still unscanned.** The scan now runs — 0 findings over 2001 tracked files — but it
   reads `git ls-files`, the tracked tree at HEAD. A credential that was committed and later deleted
   is invisible to it. That is the one thing the upstream binary does better, and it is why
   `fetch-depth: 0` is kept on the checkout. Author step:
   `brew install gitleaks && gitleaks git --config .gitleaks.toml --redact=100 .`
2. **The named binaries were never executed.** GEN-06's acceptance names "gitleaks or trufflehog"
   specifically; neither is installed on this host. The gate implements gitleaks' config format and
   rule semantics but is not gitleaks, so this clause is honestly `partial` rather than `pass` even
   though it reports zero findings.
3. **Clause 2 is met, and this slice now owns it too.** "The auth-middleware test suite proves
   every production API route that returns user data rejects an unauthenticated request with
   401/403" was built by the **`test-standards`** slice and separately by **`security-and-domains`**
   — `apps/api/tests/security/route-auth.test.ts`, which derives its route list from the published
   `/v1/openapi.json` rather than a hand-kept list and probes all 320 documented operations plus
   `/mcp`, `/admin`, and the two user-data routes mounted outside the typed app. Every one answers
   401/403 anonymously except the single allowlisted `GET /v1/config`.

   Both of those slices used to carry a GEN-06 claim of their own, graded `pass` on the strength of
   this clause alone, while this file graded the same requirement `partial` on the strength of
   clause 1. Three claims, two answers, and nothing that could see the disagreement — the
   reconciler's `DOUBLE_CLAIM_ALLOWLIST` named GEN-06 specifically so the duplicate check would
   skip it. GEN-06 is now claimed **here and nowhere else**; the allowlist is deleted and
   `multiClaimViolations()` fails the build on any id claimed twice. The requirement stays
   `partial` because clause 1 above is still open, not because ownership is unclear.

_(Resolved during lane integration: the licence-key blocker and the `.gitleaks.toml` /
`scripts/secret-scan.ts` collision that were recorded here are both gone — see the note under "What
was built" and [LAUNCH-INTEGRATE-002] in `docs/WORKLOG.md`.)_

---

## SCR-20 — No test step may be soft-failed

**Acceptance:** "No test-executing step in .github/workflows/\*.yml uses `continue-on-error: true`,
`|| true`, or `if: always()` on a gating check. Proven empirically on a scratch branch: force one
unit test to fail and, separately, one e2e spec to fail — in both cases the workflow run reports
failure (not merely a skipped deploy) and deploy-production does not run."

**What was built:**

The SCR-20 half of `scripts/ci-gate-policy.ts`. It flags three distinct soft-fails:

- `continue-on-error: true` on any step inside a check job, **and** at job level (the more dangerous
  form, because dependents still run);
- a `|| true` / `|| exit 0` / `|| :` appended to a gating command;
- `if: always()` on a step whose own `run` executes a gating command.

The carve-out is explicit and documented in a TSDoc `@remarks` on `REPORTING_ACTION_PATTERNS`:
`if: always()` is _allowed_ on reporting-only steps. `ci.yml` legitimately uses it twice — on the
coverage-file detection step (`id: coverage`, whose `run` is a `find`) and on the Codecov upload —
and those exist precisely to run after a failed check so the failure is diagnosable. Banning
`if: always()` outright would push people to delete the diagnostics instead of the soft-fail, which
is strictly worse.

**Evidence:**

Static half — automated, and proven to bite. Four fixtures in `tests/ci/ci-gate-policy.test.ts`
each produce exactly one finding (`continue-on-error` on a test step; job-level `continue-on-error`;
`|| true` on `turbo run test`; `if: always()` on a `turbo run test` step), and a fifth asserts that a
job with `if: always()` on the coverage-detection step, the Codecov upload, and an artifact upload
produces **zero** findings.

Local empirical half — `docs/engineering/launch/evidence/production/2026-08-02-scr20-forced-failure.txt`:

```
# Method: invert exactly one assertion in tests/ci/ci-gate-policy.test.ts, run it, restore.
 FAIL  tests/ci/ci-gate-policy.test.ts > gating-command detection > recognizes the check commands this repo actually runs
AssertionError: expected true to be false // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 20 passed (21)
$ echo $?
1
```

and the file was restored and re-verified byte-for-byte:

```
$ shasum tests/ci/ci-gate-policy.test.ts
6a2d214e90767eaf927527f63ab2777980c49334      (identical to the pre-experiment backup)
$ grep -c "FORCED FAILURE" tests/ci/ci-gate-policy.test.ts
0
$ pnpm exec vitest run tests/ci >/dev/null 2>&1; echo $?
0
```

That a failing task propagates non-zero through `turbo run` — the exact command the CI job issues —
was observed independently on the real (red) coverage gate: `Tasks: 3 successful, 16 total` →
`ERROR run failed: command exited (1)`.

**Residual gap:**

The scratch-branch half was not performed. I cannot push a branch, so I have not observed a real
GitHub Actions run go red. Author step, verbatim:

> Push a scratch branch containing (a) one deliberately failing unit test, then separately (b) one
> deliberately failing Playwright spec. For each, confirm in the Actions UI that the workflow run
> status is **failure** (not "success with a skipped deploy") and that `deploy-production` did not
> execute. Delete the branch afterwards.

The e2e direction specifically is argued structurally rather than observed: `e2e` runs
`pnpm --filter @docket/web test:e2e` with no `continue-on-error` and no `|| true` (asserted by the
policy test), and `e2e` is in `deploy-production.needs`. That is a sound argument, not a measurement.

---

## SCR-23 — Modularize so a change in one package does not rebuild unrelated packages

**Acceptance:** "`pnpm turbo run build --dry=json` after touching only apps/web/src lists no package
outside web and its dependents in the tasks-to-execute set; the same check after touching packages/ui
lists only ui and its dependents. The affected-set for each workspace is recorded in a committed
check that fails if an unrelated package enters the set."

**What was built:**

`tests/ci/turbo-graph.test.ts` runs `turbo run build --dry=json --filter=...<pkg>` (the `...` prefix
selects the package _and its dependents_ — the exact set a change inside it can affect) and asserts
both the affected package set and the set of tasks that would really execute. Placeholder nodes for
packages with no `build` script are filtered out via turbo's `<NONEXISTENT>` command marker, so
"packages in the graph" is not confused with "work that executes". The suite runs in ~700ms.

**Evidence:**

```
$ pnpm exec vitest run tests/ci
      Tests  24 passed (24)
```

Measured affected sets, now pinned in the test as the committed expectation:

| Filter           | Affected packages                            | Tasks that would execute                                        |
| ---------------- | -------------------------------------------- | --------------------------------------------------------------- |
| `...@docket/web` | `@docket/web`                                | `@docket/api#build`, `@docket/web#build`                        |
| `...@docket/ui`  | `@docket/admin`, `@docket/ui`, `@docket/web` | `@docket/admin#build`, `@docket/api#build`, `@docket/web#build` |

A third test asserts the two sets stay distinct — a web change never reaches `@docket/admin`.

**Residual gap:**

Two literal-reading gaps:

1. **`@docket/api#build` is in the web task set and is not "web or a dependent of web".** It enters
   because `build` declares `dependsOn: ["^build"]`, so a dependency's build node is scheduled ahead
   of its dependent's. It is replayed from cache when unchanged (see SCR-24) rather than
   re-executed, so it costs ~0 — but the acceptance says "no package outside web and its dependents
   in the tasks-to-execute set", and by that literal reading it is not met. Closing it would mean
   changing `build.dependsOn`, which was explicitly out of scope for this slice: that changes task-graph
   semantics for every package. Someone must decide whether the acceptance wording or the dependency
   edge is what changes.
2. **The affected set was derived from turbo's dependency closure, not from an actual file touch.**
   `--filter=...<pkg>` is the deterministic equivalent and does not require dirtying a shared
   worktree that three agents are editing concurrently, but it is not literally "after touching only
   apps/web/src". A one-line author check: `touch apps/web/src/app/layout.tsx && pnpm turbo run build --dry=json --filter='[HEAD]'`.

---

## SCR-24 — Build caching must produce full cache hits on unchanged code

**Acceptance:** "Running `pnpm turbo run build` twice with no source change reports FULL TURBO /
100% cached on the second run locally, and a CI run on an unchanged commit shows every build task
replayed from cache rather than re-executed."

**What was measured** —
`docs/engineering/launch/evidence/production/2026-08-02-turbo-cache.txt`:

```
$ turbo run build --filter=@docket/api --filter=@docket/runner --cache-dir=.turbo   # run 1
 Tasks:    2 successful, 2 total
Cached:    1 cached, 2 total
  Time:    1.326s

$ turbo run build --filter=@docket/api --filter=@docket/runner --cache-dir=.turbo   # run 2, no source change
 Tasks:    2 successful, 2 total
Cached:    2 cached, 2 total
  Time:    67ms >>> FULL TURBO

$ … --dry=json   # per-task cache status
   @docket/api#build    {"local":true,"remote":false,"status":"HIT","source":"LOCAL","timeSaved":1263}
   @docket/runner#build {"local":true,"remote":false,"status":"HIT","source":"LOCAL","timeSaved":1577}
```

FULL TURBO, 100% cached, 1.326s → 67ms. No change to `turbo.json` was needed; the cache already
works. `turbo.json` was therefore **not modified** by this slice.

**Residual gap:**

1. **Scope.** The measurement covers `@docket/api` and `@docket/runner` only, not the full four-task
   build. `@docket/web` and `@docket/admin` build with `next build` into `apps/web/.next` and
   `apps/admin/.next` — the exact directories the shared dev stack is serving from right now, with
   two `next dev` servers and other agents live on them. Running a production build would have
   broken their environment. Author step, on a quiet worktree:
   `SKIP_ENV_VALIDATION=1 API_URL=… WEB_URL=… NEXT_PUBLIC_API_URL=… NEXT_PUBLIC_APP_URL=… ADMIN_URL=… pnpm turbo run build` twice, expecting `4 cached, 4 total >>> FULL TURBO`.
2. **The CI half is unverified.** The acceptance also wants a workflow log showing every build task
   replayed from cache. The three most recent `ci.yml` runs on `main` are all `failure`, so no such
   log exists. This unblocks itself once CI is green.
3. Note `"remote":false` on both tasks — that is SCR-25, below.

---

## SCR-15 — Coverage thresholds must fail the build when unmet

**Acceptance:** "`pnpm turbo run test` passes with coverage thresholds enforced per the repo coverage
policy (90% default, 100% for trust-spine packages) and the command exits non-zero when any package
falls below its threshold — demonstrated by temporarily lowering coverage in one package and
observing a red run."

**What was built:**

A `coverage` job in `ci.yml` running `pnpm turbo run test:coverage --cache-dir=.turbo` with
`SKIP_ENV_VALIDATION: '1'`, no `continue-on-error`, no `|| true`, listed in
`deploy-production.needs`. Plus `docs/engineering/coverage-ledger.md` with the measured per-package
table and the debt assigned by owning package.

**Resolution of the acceptance's wording (deliberate, do not silently "fix" it):**

The acceptance names `pnpm turbo run test`. That command cannot enforce thresholds without either
adding `--coverage` to every package's `test` script or turning coverage on inside
`tooling/vitest/preset.ts` — both of which would make the inner-loop command
`pnpm --filter <pkg> test` slow and red for every developer and for every other agent working in
this repo concurrently. So the requirement is met by substance rather than wording: **the repo now
has exactly one gating test command, `pnpm turbo run test:coverage`, it enforces thresholds, and it
blocks the deploy.** `turbo run test` remains the fast, non-gating inner loop. This is written up in
the ledger so it survives review.

**Evidence:**

```
$ SKIP_ENV_VALIDATION=1 turbo run test:coverage --cache-dir=.turbo --continue; echo $?
 Tasks:    3 successful, 16 total
  Time:    59.556s
 ERROR  run failed: command  exited (1)
1
```

The red-run demonstration the acceptance asks for needed no artificial lowering —
`@docket/notifications` is at 29.55% against a 90% bar, and vitest emits it verbatim:

```
@docket/notifications:test:coverage: ERROR: Coverage for lines (32.09%) does not meet global threshold (90%)
@docket/notifications:test:coverage: ERROR: Coverage for functions (33.33%) does not meet global threshold (90%)
@docket/notifications:test:coverage: ERROR: Coverage for statements (29.55%) does not meet global threshold (90%)
@docket/notifications:test:coverage: ERROR: Coverage for branches (19.15%) does not meet global threshold (90%)
```

**Residual gap:**

The gate is wired and honest; the repo does not pass it. **13 of 16 measured packages are below
threshold** (only `@docket/authz`, `@docket/test-utils`, and `@docket/web` pass), and **`@docket/admin`
and `@docket/runner` have no `test:coverage` script at all**, so they are silently exempt. Every one
of the 13 failures is a threshold failure — zero tests failed. Full table and per-package assignment:
`docs/engineering/coverage-ledger.md`. Raising coverage belongs to the lanes owning those packages;
the largest and most alarming are `@docket/notifications` (29.55%), `@docket/blob-store` (52.00%),
`@docket/billing` (63.06%), and `@docket/auth` (91.56% against a 100 trust-spine bar).

**Landing this slice makes `main` undeployable until that debt is paid.** That is the intended
behavior of a launch-blocker, but it is a scheduling fact someone has to own.

---

## GEN-02 — All functionality must be demonstrated working in production

**Acceptance:** "Each primary flow (sign-in, workspace/org creation, project creation, task creation,
calendar, cycles, Athena session, each connector) is exercised against the deployed production
hostname — evidence is a screenshot or HTTP trace per flow whose URL bar/host is the production
domain … and whose outcome is success with zero console errors."

**What was built:**

`scripts/production-verify.ts` (`pnpm launch:verify-prod`) — a credential-free CLI that diffs the
deployed OpenAPI document against the local dev API (HEAD), probes ten unauthenticated production
endpoints recording status/timing/headers, writes a timestamped JSON + text pair into
`docs/engineering/launch/evidence/production/`, and **exits non-zero when production is missing any
path present at HEAD**. Plus `docs/engineering/launch/production-verification.md` with the per-flow
table.

**Evidence:**

```
$ eval "$(./scripts/dev-stack.sh env)" && pnpm exec tsx scripts/production-verify.ts; echo $?
  production   https://docket-api.hypertext.studio  →  204 OpenAPI paths
  local (HEAD) http://docket-production-launch-ebe2d9.api.docket.localhost:1355  →  236 OpenAPI paths
  verdict: STALE — 32 path(s) built locally are not deployed
…
## Verdict: FAIL
  Production is BEHIND HEAD: 32 path(s) exist at HEAD and are not deployed.
  All probes met their expectations.
1
```

All 32 undeployed paths are `/v1/me/athena/**` — chat, sessions, streaming, proposals, approvals,
assignments, triggers, connections, pulse. **The entire personal Athena surface is not in
production.** Full list in the evidence files.

What _is_ verified against production hostnames (all 200 unless noted): `/v1/health`, `/v1/config`,
`/v1/openapi.json`, `/api/auth/.well-known/oauth-authorization-server`,
`/.well-known/oauth-protected-resource`, `docket.hypertext.studio/`,
`docket.hypertext.studio/sign-in`, `docket-admin.hypertext.studio/`; and `/v1/me` + `/v1/orgs`
correctly return **401** without a session.

**Residual gap:**

GEN-02 is `fail`, and the endpoint delta alone is decisive: no arrangement of screenshots turns "the
feature is not deployed" into a pass. Beyond that, no authenticated per-flow evidence exists for any
flow. I did not sign in to production — Docket is passkey-only, so there is no credential that can be
typed or scripted and a WebAuthn assertion cannot come from a shell. Each such row in
`docs/engineering/launch/production-verification.md` is marked **author-action-required** with the
exact command or click-path, never "blocked".

The order matters and is written up there: **get CI green → deploy → re-run `pnpm launch:verify-prod`
and confirm `IN SYNC` → only then capture the flows.** Capturing them against today's stale
production would produce evidence for a build nobody intends to ship. Note that CI going green now
also requires the coverage debt (SCR-15) and the gitleaks licence (GEN-06) to be resolved.

---

## SCR-25 — A shared remote build cache must be actually configured (not inert)

**Acceptance:** "TURBO_TOKEN, TURBO_TEAM and TURBO_REMOTE_CACHE_SIGNATURE_KEY resolve to real values
in CI (not empty, so turbo is not silently falling back to the local .turbo cache), a CI run on a
commit already built elsewhere shows remote cache hits in the log, and the measured wall-clock time
for a no-op build run is recorded and lower than the pre-change baseline …"

**Evidence** —
`docs/engineering/launch/evidence/production/2026-08-02-turbo-remote-cache.txt`:

```
$ gh secret list --repo TheHypertextStudio/athena-web
NEON_API_KEY	2026-06-09T00:23:55Z

$ gh variable list --repo TheHypertextStudio/athena-web
ADMIN_URL, AGENT_MAX_TURNS, API_URL, BETTER_AUTH_ALLOWED_HOSTS, GCP_PROJECT_ID, GCP_REGION,
GCP_SERVICE_ACCOUNT, GCP_WIF_PROVIDER, GOOGLE_OAUTH_PUBLIC, GOOGLE_OAUTH_TEST_EMAILS,
NEON_PROJECT_ID, PASSKEY_RP_ID, WEB_URL
```

`ci.yml` reads `TURBO_TOKEN` and `TURBO_REMOTE_CACHE_SIGNATURE_KEY` from secrets and `TURBO_TEAM` /
`TURBO_API` from variables. **None of the four exists.** All four therefore expand to the empty
string and turbo silently uses the local cache only. Corroborated directly by the cache-status probe
in the SCR-24 evidence, where both build tasks report `"remote": false` on a local hit.

**Residual gap:**

SCR-25 is `fail`. No fabricated remote-cache measurement was taken and no wall-clock baseline was
recorded, because there is nothing to measure — the feature is off. `turbo.json` already sets
`remoteCache: { signature: true }` and `ci.yml` already passes all four variables through, so the
wiring is complete and only the values are missing. Author steps:

```bash
# Vercel Remote Cache (or set TURBO_API as well for a self-hosted cache)
gh variable set TURBO_TEAM  --repo TheHypertextStudio/athena-web --body '<vercel-team-slug>'
gh secret   set TURBO_TOKEN --repo TheHypertextStudio/athena-web        # paste the token
gh secret   set TURBO_REMOTE_CACHE_SIGNATURE_KEY --repo TheHypertextStudio/athena-web \
  --body "$(openssl rand -base64 32)"   # required, because turbo.json sets remoteCache.signature
```

Then: run CI twice on the same commit and confirm the second run's build job reports remote hits,
and record both wall-clock times. Also worth recording is that CI currently substitutes the GitHub
Actions `cache` action keyed on exact SHA (`ci.yml`, the `actions/cache@v5` steps) — a per-runner
cache, not a cache shared across machines, which is what SCR-25 asks for.

---

## Verification log

```
$ pnpm exec vitest run tests/ci
 Test Files  2 passed (2)
      Tests  24 passed (24)

$ pnpm exec tsx scripts/ci-gate-policy.ts
PASS — every check job gates the production deploy, and no gating step is soft-failed.   (exit 0)

$ eval "$(./scripts/dev-stack.sh env)" && pnpm exec tsx scripts/production-verify.ts
## Verdict: FAIL
  Production is BEHIND HEAD: 32 path(s) exist at HEAD and are not deployed.               (exit 1, by design)

$ pnpm exec eslint scripts/ci-gate-policy.ts scripts/production-verify.ts tests/ci/
(no output — clean)

$ pnpm exec tsc   # repo tsconfig options, over this slice's four TS files
(no output — clean)

$ pnpm exec prettier --check <this slice's files>
All matched files use Prettier code style!
```

Known-red and **not** caused by this slice: `tests/launch/launch-record.test.ts` (20 failures) is the
`launch-governance` worker's in-flight suite, surfaced here only because this slice widened
`test:tooling` from `vitest run tests/tooling` to `vitest run tests` as the shared contract required.
`tests/tooling` (70 tests) and `tests/ci` (24 tests) both pass.

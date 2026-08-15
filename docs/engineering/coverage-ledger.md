# Coverage ledger

> **Requirement**: SCR-15 (launch-blocker) — "All behavior must be covered by unit tests, enforced
> by coverage thresholds that fail the build when unmet."
> **Measured**: 2026-08-02, branch `claude/docket-production-launch-ebe2d9`, Darwin 25.5.0 arm64.
> **Status**: the gate is now wired and **red**. That is the honest state, not a defect in the gate.

---

## Current package map

The measurements below are an **August 2 snapshot**, not a current coverage assignment. Do not
carry the retired `@docket/agent-runtime` percentages forward to another package: its behavior now
lives across `@docket/athena` runtime entry points and `@docket/work` contracts, and each domain
must be measured again on its own. `@docket/billing` keeps its package name, but its source now
lives in `domains/billing`. New coverage work should use the current domain package and its
deliberate public entry points.

## The gate

```bash
pnpm turbo run test:coverage
```

This — not `pnpm turbo run test` — is the repo's gating test command, and it runs in CI as its own
`coverage` job, listed in `deploy-production.needs`.

### Why `test:coverage` and not `test`

SCR-15's acceptance names `pnpm turbo run test`. That command cannot be made to enforce thresholds
without one of two changes, and both were rejected:

| Option                                               | Why it was rejected                                                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add `--coverage` to every package's `test` script    | It would turn the inner-loop command `pnpm --filter <pkg> test` into a slow, threshold-failing command for every developer and every concurrent agent. The fast inner loop is worth keeping. |
| Enable coverage unconditionally in the shared preset | Same effect, applied to every package at once, plus it makes `tooling/vitest/preset.ts` a file nobody can touch without repo-wide consequences.                                              |

So the requirement is satisfied by its substance rather than its literal wording: **the repo has a
single gating test command that enforces thresholds and blocks the deploy when they are unmet.** The
split is deliberate and documented here so nobody "fixes" it later by quietly deleting the coverage
job.

### Where the thresholds live

`tooling/vitest/preset.ts`, via `DocketVitestOptions.coverageThreshold`. Default **90**; the
trust-spine packages (`@docket/authz`, `@docket/auth`, `@docket/env`, `@docket/types`) opt into
**100**. Each package selects its own in its `vite.config.ts`. Do not edit the preset to move a
number — raise the tests instead.

---

## Measured coverage

`SKIP_ENV_VALIDATION=1 turbo run test:coverage --cache-dir=.turbo --continue`
→ **`Tasks: 3 successful, 16 total`**, exit code **1**, wall clock 59.556s.

Percentages are the vitest/v8 `All files` row. **Every one of the 13 failures is a threshold
failure — zero tests failed.**

| Package                 | Threshold | Statements | Branches  | Functions | Lines     | Meets bar? |
| ----------------------- | --------- | ---------- | --------- | --------- | --------- | ---------- |
| `@docket/authz`         | 100       | 100        | 100       | 100       | 100       | **yes**    |
| `@docket/test-utils`    | 90        | 100        | 100       | 100       | 100       | **yes**    |
| `@docket/web`           | 90        | 94.54      | 91.19     | 94.25     | 97.21     | **yes**    |
| `@docket/discord-relay` | 90        | 100        | **88.88** | 100       | 100       | no         |
| `@docket/env`           | 100       | **94.44**  | **91.17** | 100       | **95.23** | no         |
| `@docket/auth`          | 100       | **91.56**  | **82.95** | **90.19** | **92.69** | no         |
| `@docket/types`         | 100       | **94.01**  | **61.53** | **71.18** | **94.22** | no         |
| `@docket/api`           | 90        | **86.60**  | **75.61** | 91.53     | **89.49** | no         |
| `@docket/mail`          | 90        | **87.27**  | 95.91     | **66.66** | **86.53** | no         |
| `@docket/ui`            | 90        | **84.19**  | **76.95** | **82.35** | **86.15** | no         |
| `@docket/agent-runtime` | 90        | **85.27**  | **72.68** | **83.33** | **85.39** | no         |
| `@docket/db`            | 90        | **82.76**  | 97.05     | **71.46** | **82.25** | no         |
| `@docket/integrations`  | 90        | **76.07**  | **67.53** | **72.70** | **78.58** | no         |
| `@docket/billing`       | 90        | **63.06**  | **71.26** | **68.96** | **60.60** | no         |
| `@docket/blob-store`    | 90        | **52.00**  | **58.33** | **40.00** | **48.88** | no         |
| `@docket/notifications` | 90        | **29.55**  | **19.15** | **33.33** | **32.09** | no         |

Bold = below that package's threshold.

### Packages outside the gate entirely

`@docket/admin` and `@docket/runner` have a `test` script but **no `test:coverage` script**, which
is why the run reports 16 coverage tasks against 18 test tasks. They are not measured and cannot
fail the gate. Adding the script is owned by whoever owns those apps; doing it here would have put
two more packages into an already-red gate without any test work behind it.

---

## The red-run demonstration

SCR-15's acceptance asks for proof that the command "exits non-zero when any package falls below its
threshold — demonstrated by temporarily lowering coverage in one package and observing a red run."
No package needed lowering: `@docket/notifications` is at 29.55% against a 90% bar, and vitest emits
the failure verbatim:

```
@docket/notifications:test:coverage: ERROR: Coverage for lines (32.09%) does not meet global threshold (90%)
@docket/notifications:test:coverage: ERROR: Coverage for functions (33.33%) does not meet global threshold (90%)
@docket/notifications:test:coverage: ERROR: Coverage for statements (29.55%) does not meet global threshold (90%)
@docket/notifications:test:coverage: ERROR: Coverage for branches (19.15%) does not meet global threshold (90%)
```

and the run ends:

```
 Tasks:    3 successful, 16 total
 ERROR  run failed: command  exited (1)
```

Exit code 1. Because the `coverage` job has no `continue-on-error` and no `|| true` (enforced by
`pnpm ci:gate-policy`), and because `coverage` is in `deploy-production.needs`, that non-zero exit
stops the deploy.

---

## The debt, assigned

Raising coverage is **out of scope for the CI-gating slice** — wiring the gate and measuring the
truth is. Each item below belongs to the lane that owns the package. Until they are closed, `main`
cannot deploy through this gate.

| Owner (by package)                | Gap to threshold                                 | Priority                                                                      |
| --------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `@docket/notifications`           | 60 pts of statements, 71 of branches             | **P0** — the largest hole, and it is the delivery path for user-facing alerts |
| `@docket/blob-store`              | 38 pts of statements, 50 of functions            | **P0** — attachment storage; failures here lose user data                     |
| `@docket/billing`                 | 27 pts of statements, 21 of lines                | **P0** — money                                                                |
| `@docket/integrations`            | 14 pts of statements, 22 of branches             | P1 — connector correctness is a stated core promise                           |
| `@docket/db`                      | 7 pts of statements, 19 of functions             | P1                                                                            |
| `@docket/agent-runtime`           | 5 pts of statements, 17 of branches              | P1                                                                            |
| `@docket/ui`                      | 6 pts of statements, 13 of branches              | P2                                                                            |
| `@docket/api`                     | 3.4 pts of statements, 14 of branches            | P2 — closest of the 90-bar packages                                           |
| `@docket/mail`                    | 2.7 pts of statements, 23 of functions           | P2                                                                            |
| `@docket/types`                   | 6 pts of statements, 38 of branches (100 bar)    | P1 — trust spine; a 100 bar means every branch                                |
| `@docket/auth`                    | 8.4 pts of statements, 17 of branches (100 bar)  | **P0** — trust spine, and it is the authentication package                    |
| `@docket/env`                     | 5.6 pts of statements, 8.8 of branches (100 bar) | P1 — trust spine, and the smallest remaining gap of the three                 |
| `@docket/discord-relay`           | 1.2 pts of branches                              | P3 — one uncovered branch                                                     |
| `@docket/admin`, `@docket/runner` | no `test:coverage` script at all                 | P1 — they are silently exempt from the gate today                             |

---

## Related

- CI wiring: `.github/workflows/ci.yml`, job `coverage`
- Soft-fail / deploy-gating guard: `scripts/ci-gate-policy.ts`, `tests/ci/ci-gate-policy.test.ts`
- Slice record: `docs/engineering/launch/slices/ci-gating.md`
- Turbo remote cache (SCR-25) is **not** configured; see
  `docs/engineering/launch/evidence/production/2026-08-02-turbo-remote-cache.txt` for the probe and
  the slice file for the `gh secret set` commands that fix it.

# CI gating contract

The rule this document exists to protect: **Docket does not deploy to production unless every test
and every check has passed.** Not "unless someone noticed a failure" — unless CI itself refuses.

`.github/workflows/ci.yml` is the whole of that gate. `deploy-production` is the only job that ships
anything, and it runs only after every other job in the file has succeeded.

## The jobs

| Job                 | What it runs                                                            | Gating?               |
| ------------------- | ----------------------------------------------------------------------- | --------------------- |
| `quality`           | `turbo run lint typecheck`, `pnpm format:check`, `pnpm ci:gate-policy`  | Yes                   |
| `secret-scan`       | `pnpm secret-scan` — the in-repo scanner over the tracked tree          | Yes                   |
| `test`              | `turbo run test`, then `pnpm test:tooling` for the root `tests/` suites | Yes                   |
| `coverage`          | `turbo run test:coverage` — the same suites with thresholds enforced    | Yes                   |
| `build`             | `turbo run build` — every deployable artifact                           | Yes                   |
| `e2e`               | `pnpm --filter @docket/web test:e2e` against a real dev stack           | Yes                   |
| `deploy-production` | Calls `deploy.yml`, on pushes to `main` only                            | The thing being gated |

`deploy-production.needs` must name **every** job above it. Not just the ones with "test" in the name:
a lint failure, a type error, a formatting drift, a leaked credential, and a coverage regression are all
reasons not to ship, and each of them lives in a job that runs no test command at all.

## Two ways this gate can rot

**A new job that nobody wires into `needs`.** Someone adds an `accessibility` or `contract-tests` job.
It runs. It goes red. And `deploy-production` ships anyway, because `needs` still lists the six jobs it
listed last month. GitHub gives no warning for this — a job absent from `needs` is simply not waited on.

**A step that is allowed to fail.** `continue-on-error: true`, a trailing `|| true`, or `if: always()`
on a step that gates. The job reports success, `needs` is satisfied, and the deploy proceeds over a red
test. This is worse than the first failure mode because the CI badge stays green.

## The guard

**One implementation, two invocations.** `scripts/ci-gate-policy.ts` is the whole guard. It runs

- as `pnpm ci:gate-policy`, a step inside the `quality` job, so a bad workflow edit fails the very
  run that introduced it; and
- as `tests/ci/ci-gate-policy.test.ts` under `pnpm test:tooling`, which the `test` job runs.

This was briefly two guards. A second, line-based workflow reader lived in
`packages/test-utils/tests/workspace-policies/testing-tree.ts` with its own copy of the same rules —
two parsers and two command vocabularies for one requirement, which is exactly the drift SCR-19 is
about. The duplicate was removed; `testing-tree.ts` now walks the test tree only and says so.

The module ships its own narrow YAML reader (`parseYaml`) rather than taking a dependency: the
repository resolves no YAML parser and a launch gate should not be the thing that churns the
lockfile. It is a real reader — mappings, block and flow sequences, block scalars, quoted and typed
scalars — and it **throws** on syntax it does not model rather than guessing, so an unparsed
workflow is a loud failure instead of a silently unguarded one.

Each job is projected to `{ id, name, needs, steps, continueOnError, uses }` and each step to
`{ label, uses, run, condition, continueOnError, env, with }`. A job is a **check job** when any of
its steps is a gating step, and a step is gating when its `run` body executes:

- `turbo run` naming any of `test`, `test:coverage`, `lint`, `typecheck`, `build`; or
- any of the whole-token commands `playwright`, `test:e2e`, `vitest`, `format:check`,
  `test:tooling`, `secret-scan`, `ci:gate-policy`;

or when its `uses` matches a gating action (`gitleaks/gitleaks-action`, kept listed so a future
re-adoption is classified correctly even though the scan runs as a `run:` step today).

The assertions:

1. Every check job in `ci.yml` appears in `deploy-production.needs`. SCR-19's acceptance names
   `quality` and `build` explicitly and neither runs a test command, so the rule is written over
   checks, not over tests — a tests-only rule would let a new lint-only job ship red. (SCR-19.)
2. No gating step is soft-failed by `continue-on-error: true` (step-level **or** job-level),
   a trailing `|| true`, or `if: always()` — in `ci.yml` or in any other workflow file. (SCR-20,
   static half.)
3. Committed expectations over the real file: the check-job set and `needs` are asserted as an exact
   list, so adding a job forces both to be updated together. The coverage job's command, the
   secret-scan job's command, and the presence of `pnpm ci:gate-policy` are each pinned.
4. Four synthetic fixtures prove each rule bites, and a fifth proves the deliberate carve-out does
   not: `if: always()` on a Codecov upload or an artifact upload is left alone, because those steps
   exist precisely to run after a failure and banning them would push people to delete the
   diagnostics instead of the soft-fail.

Command patterns are matched against extracted `run:`/`uses:` values, never against raw file text.
A comment reading "run the tests before deploying" must not make a job look like a test runner, and
a job's prose must not be able to trip the soft-fail detector.

### What is deliberately _not_ flagged

`if: failure()` — it runs a step only when the job has already failed (tailing the dev-stack log,
uploading Playwright artifacts) and can mask nothing.

`if: always()` on the coverage-file detection step and the Codecov upload in the `test` job — neither
executes a test, and the upload carries `fail_ci_if_error: false` because a Codecov outage is not a
reason to block a deploy. The guard does not flag them because neither step matches a test command.

`|| true` inside the e2e job's readiness-poll loop — those are `curl` probes inside a wait loop that
ends in `exit 1` when the stack never comes up. The loop is what makes a genuinely broken stack fail
the job.

## The secret scan

`secret-scan` runs `scripts/secret-scan.ts`, not `gitleaks/gitleaks-action`. The action is free for
personal accounts and requires a licence key for organization-owned repositories, which this one is;
wiring it in as the gate would produce a job that fails on every run until someone sets
`GITLEAKS_LICENSE`, and a gate nobody can turn green gets disabled rather than fixed.

The in-repo scanner reads the same `.gitleaks.toml` rules, makes no network call, and is itself
proven to fire — `packages/test-utils/tests/security/secret-scan.test.ts` feeds each rule a synthetic
credential and asserts it matches, so the clean scan means something.

**Residual gap, stated plainly:** the in-repo scanner covers `git ls-files`, the tracked tree. It
does not walk history, so a credential that was committed and later removed would not be caught. The
checkout keeps `fetch-depth: 0` so the licensed binary can be run over the same clone —
`gitleaks git --config .gitleaks.toml --redact=100 .` — once a key is installed with
`gh secret set GITLEAKS_LICENSE`. That is a follow-on, not a blocker for the tracked-tree gate.

## Outstanding empirical proof

SCR-20's acceptance asks for more than the static guard above. It asks for proof by experiment:

> Proven empirically on a scratch branch: force one unit test to fail and, separately, one e2e spec to
> fail — in both cases the workflow run reports failure (not merely a skipped deploy) and
> `deploy-production` does not run.

**This has not been performed.** It requires pushing branches and consuming CI minutes, and the working
tree this guard was written in does not push. Recording it as done would be a false claim, so it is
recorded here as outstanding.

What the proof consists of, precisely, for whoever runs it:

1. Branch from `main`. Introduce exactly one failing assertion in one unit test — for example, invert an
   expectation in `packages/test-utils/tests/workspace-policies/dependency-catalog.test.ts`. Push.
2. Observe the run. Required outcome: the `test` job concludes **failure**, the workflow's overall
   conclusion is **failure** (not "success with a skipped job"), and `deploy-production` shows as
   **skipped**, never **success**. Record the run URL.
3. Revert that change. On the same branch, introduce exactly one failing assertion in one Playwright
   spec — for example, in `apps/web/e2e/auth/sign-in.spec.ts`. Push.
4. Observe the run. Required outcome: the `e2e` job concludes **failure**, the workflow conclusion is
   **failure**, and `deploy-production` is **skipped**. Record the run URL.
5. Because `deploy-production` is guarded by `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`,
   a scratch branch skips it for that reason alone. To prove the `needs` gate rather than the `if` gate,
   either run steps 1–4 with that `if` temporarily relaxed on the scratch branch, or read the run's job
   graph and confirm the skip is attributed to the failed dependency. State in the record which of the
   two was done — the distinction is the entire point of the experiment.
6. Delete the scratch branch. Paste both run URLs and both observed conclusions into this section, and
   update SCR-20's evidence in `docs/engineering/launch-compliance.json`.

Until steps 1–6 are done and recorded, SCR-20 is met **statically only**: no test step in any workflow
is soft-failed, and the guard fails the build if one ever is.

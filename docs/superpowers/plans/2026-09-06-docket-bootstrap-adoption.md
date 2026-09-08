# Docket Repo Bootstrap Adoption Implementation Plan

> **Implementation status (2026-09-08):** Docket now has the required root API, configuration
> reconciliation, conventional hooks, Git policy, explicit-port service lifecycle, and isolated
> returning-passkey verification. The launcher is source-contained until the shared engine has an
> authorized published release; that distribution boundary does not block a fresh Docket clone.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a fresh Docket clone converge to a working local app through the standard `./bootstrap` API, and make the same entrypoint explicitly guide, plan, apply, and verify production readiness.

**Architecture:** Docket is the reference adopter of the shared bootstrap engine. The checked-in launcher delegates generic discovery, native prerequisites, Git configuration, state, locking, and output to the engine; small executable Docket hooks retain ownership of environment derivation, database lifecycle, service startup, authentication acceptance, and provider-specific production work. Existing TypeScript bootstrap and doctor logic is split into reusable modules so the hook, doctor, CI, and tests share expectations rather than drifting.

**Tech Stack:** POSIX `sh`, shared Hypertext Studio bootstrap engine v0.1, Node.js, pnpm, TypeScript, Vitest, Playwright, Docker Compose, PGlite/PostgreSQL, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-01-repo-bootstrap-design.md`

## Global Constraints

- `./bootstrap` is the required human and automation entrypoint; package-manager aliases may delegate to it but may not define a different workflow.
- A default run is interactive when attached to a terminal and non-interactive in CI. Every prompt explains the observed condition, proposed change, consequence, and exact manual alternative.
- The second successful local run against unchanged inputs performs no persistent writes, service restarts, hook rewrites, secret rotation, or dependency installation.
- Generated local secrets are stable after first creation. Existing valid developer values and unrelated environment keys are preserved.
- Verification uses isolated test data and never resets or mutates a developer's active `.data/docket` database.
- Production `plan` and `check` are read-only. Production mutation requires the explicit `production` command and final confirmation unless `--yes` is supplied.
- Provider commands name the exact account, project, application, and hostname before mutation.
- A successful install, build, deploy command, HTTP 200, or OAuth grant is not authentication or application acceptance proof.
- Secrets are redacted from output and never stored in bootstrap state or committed files.
- Compatibility exports remain until all current importers are migrated and tests prove their removal safe.

---

### Task 1: Install the standard root launcher without breaking current callers

**Files:**

- Create: `bootstrap`
- Modify: `package.json`
- Create: `repo-tests/tooling/repo-bootstrap-entrypoint.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing launcher contract test**

```ts
it('ships one executable, version-pinned root entrypoint', () => {
  const launcher = readFileSync('bootstrap', 'utf8');
  expect(statSync('bootstrap').mode & 0o111).not.toBe(0);
  expect(launcher).toContain('BOOTSTRAP_VERSION="v0.1.0"');
  expect(launcher).toContain('BOOTSTRAP_SHA256_DARWIN_ARM64=');
  expect(launcher).toContain('BOOTSTRAP_SHA256_LINUX_X64=');
  expect(pkg.scripts.bootstrap).toBe('./bootstrap');
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm exec vitest run repo-tests/tooling/repo-bootstrap-entrypoint.test.ts`

Expected: failure because the root launcher is absent and the package script still invokes `tsx scripts/bootstrap.ts`.

- [ ] **Step 3: Render the launcher from the released engine**

Generate `bootstrap` with the engine repository's renderer. Pin v0.1.0 and copy release-produced SHA-256 values; never hand-type or use example digests. Make it executable. Add only the engine cache directory (for example `.cache/hypertext-bootstrap/`) to `.gitignore`.

- [ ] **Step 4: Preserve a direct project-hook command while changing the public alias**

```json
{
  "scripts": {
    "bootstrap": "./bootstrap",
    "bootstrap:project": "tsx scripts/bootstrap.ts"
  }
}
```

- [ ] **Step 5: Re-run the focused test and launcher contract**

Run: `pnpm exec vitest run repo-tests/tooling/repo-bootstrap-entrypoint.test.ts && ./bootstrap --help`

Expected: both pass; help contains only the standard commands and flags.

- [ ] **Step 6: Commit atomically**

Stage and commit only the files in this task using the repository-required `git restore --staged . && git add <paths> && git commit -F <message-file>` chain.

---

### Task 2: Turn the existing TypeScript bootstrap into simple Docket hooks

**Files:**

- Create: `scripts/bootstrap/flags.ts`
- Create: `scripts/bootstrap/local.ts`
- Create: `scripts/bootstrap/production.ts`
- Create: `scripts/bootstrap/verify.ts`
- Create: `scripts/bootstrap-local`
- Create: `scripts/bootstrap-production`
- Create: `scripts/bootstrap-verify`
- Modify: `scripts/bootstrap.ts`
- Modify: `repo-tests/tooling/bootstrap-setup.test.ts`

- [ ] **Step 1: Characterize the existing public helpers before moving code**

Add tests that import every constant/function currently consumed from `scripts/bootstrap.ts`, and snapshot the exit status and redacted output for a successful dry run and one missing prerequisite.

- [ ] **Step 2: Run the characterization tests**

Run: `pnpm exec vitest run repo-tests/tooling/bootstrap-setup.test.ts`

Expected: current behavior passes before refactoring.

- [ ] **Step 3: Extract local, production, and verification entry functions**

```ts
export interface HookContext {
  repoRoot: string;
  interactive: boolean;
  approved: boolean;
  offline: boolean;
  emit(event: BootstrapEvent): void;
}

export async function reconcileLocal(context: HookContext): Promise<void>;
export async function reconcileProduction(context: HookContext): Promise<void>;
export async function verifyDocket(
  context: HookContext,
  target: 'local' | 'production',
): Promise<void>;
```

Keep `scripts/bootstrap.ts` as a compatibility facade that re-exports the characterized helpers and invokes the local entry only when run directly.

- [ ] **Step 4: Add ordinary executable hook shims**

Each `scripts/bootstrap-*` file is a short executable POSIX script that invokes the matching TypeScript module through the repo-local pnpm toolchain. It accepts no private RPC or manifest; stdin/stdout/stderr and exit status are the complete integration surface.

- [ ] **Step 5: Prove direct and engine-driven execution agree**

Add a fixture test that runs the TypeScript module directly and through a fake engine hook invocation, normalizes timestamps, and compares events and exit codes.

- [ ] **Step 6: Run the focused tests and commit atomically**

Run: `pnpm exec vitest run repo-tests/tooling/bootstrap-setup.test.ts`

Expected: all characterization and hook-equivalence cases pass.

---

### Task 3: Make local configuration a stable reconciliation problem

**Files:**

- Create: `scripts/bootstrap/local-config.ts`
- Create: `scripts/bootstrap/atomic-file.ts`
- Modify: `scripts/bootstrap/local.ts`
- Modify: `scripts/doctor.ts`
- Modify: `.env.example`
- Create: `repo-tests/tooling/bootstrap-local-config.test.ts`

- [ ] **Step 1: Write failing convergence tests**

Cover these cases:

```ts
it.each(['darwin', 'linux'])('writes safe defaults once on %s', async (platform) => {});
it('leaves bytes and mtime unchanged on the second run', async () => {});
it('preserves valid manual values and unrelated keys', async () => {});
it('creates a generated secret once and never rotates it implicitly', async () => {});
it('derives every local origin from one canonical port selection', async () => {});
it('reports malformed or mutually inconsistent values without overwriting them', async () => {});
```

- [ ] **Step 2: Run the focused tests and confirm the module is missing**

Run: `pnpm exec vitest run repo-tests/tooling/bootstrap-local-config.test.ts`

- [ ] **Step 3: Implement registry-driven expectations and compare-before-write**

Reuse the repository's environment-variable registry and parser. Model each key as required, derived, generated, or user-supplied. Serialize deterministically, write to a same-directory temporary file, preserve mode, and rename only when bytes differ. Never store values in engine state.

```ts
const result = await reconcileLocalConfig({ envPath, registry, randomBytes });
expect(result).toEqual({ changed: false, diagnostics: [] });
```

- [ ] **Step 4: Make doctor consume the same observation functions**

`scripts/doctor.ts` reports the shared expectation IDs and explanations. It does not retain a second list of required variables or reconstruct different URLs.

- [ ] **Step 5: Run tests twice and inspect the filesystem result**

Run: `pnpm exec vitest run repo-tests/tooling/bootstrap-local-config.test.ts repo-tests/tooling/doctor.test.ts`

Expected: both runs pass; the idempotence fixture asserts identical bytes and mtimes.

- [ ] **Step 6: Commit atomically**

Commit only local configuration, fixture, doctor, and example-file changes.

---

### Task 4: Converge the local services and prove the returning-user journey

**Files:**

- Modify: `scripts/dev-stack.sh`
- Modify: `scripts/bootstrap/local.ts`
- Create: `apps/web/e2e/tools/dev-session.ts`
- Create: `apps/web/e2e/tools/bootstrap-verify.ts`
- Create: `apps/web/e2e/bootstrap-local.spec.ts`
- Create: `repo-tests/tooling/bootstrap-local-services.test.ts`

- [ ] **Step 1: Write a failing service-plan test**

The test supplies fake process, port, Docker, and database observations and requires a minimal plan: start a missing dependency, migrate an old schema, retain a healthy service, and refuse to replace an occupied application port.

- [ ] **Step 2: Add an isolated verification profile to the existing dev stack**

Extend `scripts/dev-stack.sh` with explicit environment inputs for a temporary data directory, database name, and ports. The defaults remain unchanged. Reject any verification invocation that resolves to `.data/docket`.

- [ ] **Step 3: Implement local reconciliation in dependency order**

Order: validate configuration, install missing repo dependencies unless `--no-install`, start required infrastructure, apply idempotent migrations, start app services, then wait on readiness checks. Emit a stable expectation ID for every retain/change/block decision.

- [ ] **Step 4: Write end-to-end acceptance before the verifier**

The isolated Playwright scenario must:

1. register a passkey-capable test user;
2. create a task and persist it;
3. sign out;
4. sign back in with the passkey path;
5. confirm no recovery-phrase onboarding appears unless E2EE requires it;
6. update the task, reload, and observe the update;
7. restart the app process and observe the same task again.

- [ ] **Step 5: Implement the verifier as a reusable command**

`bootstrap-verify.ts` creates temporary database/browser state, launches through `dev-session.ts`, runs the acceptance spec, and cleans only its own named resources. On failure it retains a redacted artifact directory and prints its path.

- [ ] **Step 6: Prove local bootstrap is idempotent end to end**

Run: `./bootstrap --non-interactive --yes && ./bootstrap --non-interactive --yes && ./bootstrap verify local --non-interactive`

Expected: the second convergence reports zero changes; verification proves the complete returning-user journey.

- [ ] **Step 7: Run focused tests and commit atomically**

Run: `pnpm exec vitest run repo-tests/tooling/bootstrap-local-services.test.ts && pnpm exec playwright test apps/web/e2e/bootstrap-local.spec.ts`

---

### Task 5: Standardize version-control configuration, hooks, and commit scopes

**Files:**

- Create: `.githooks/pre-commit`
- Create: `.githooks/prepare-commit-msg`
- Create: `.githooks/commit-msg`
- Create: `.githooks/pre-merge-commit`
- Create: `.githooks/pre-push`
- Modify: `scripts/install-git-guardrails.sh`
- Modify: `package.json`
- Modify: `repo-tests/tooling/codex-commit-scope-hook.test.ts`
- Modify: `repo-tests/tooling/commit-message.test.ts`
- Create: `repo-tests/tooling/bootstrap-git-worktrees.test.ts`

- [ ] **Step 1: Specify hook ownership in tests**

Require tracked hooks to be executable, require every Conventional Commit scope to come from `COMMIT_SCOPES.txt`, and require engine reconciliation to configure the current worktree without destroying a user's global hook chain.

- [ ] **Step 2: Run the Git tests and confirm the tracked-hook contract fails**

Run: `pnpm exec vitest run repo-tests/tooling/codex-commit-scope-hook.test.ts repo-tests/tooling/commit-message.test.ts repo-tests/tooling/bootstrap-git-worktrees.test.ts`

- [ ] **Step 3: Move repository policy into `.githooks`**

- `pre-commit`: current lint-staged and generated/design policy checks.
- `prepare-commit-msg`: current scope guidance without modifying an already valid message.
- `commit-msg`: Conventional Commit syntax plus the tracked scope list.
- `pre-merge-commit`: reject merge commits.
- `pre-push`: bounded type/tooling checks; print the explicit full-CI command.

- [ ] **Step 4: Reduce the old installer to a compatibility delegate**

`scripts/install-git-guardrails.sh` prints its deprecation and runs `./bootstrap check` or the engine Git reconciler. Remove Git configuration ownership from `package.json`'s `prepare`; dependency install must not silently overwrite worktree configuration.

- [ ] **Step 5: Prove linked worktrees stay independent**

Create two temporary linked worktrees, bootstrap both, assert the configured hook path resolves to each worktree's checked-in hook directory, and assert a fake global hook still executes exactly once through the engine-managed composition path.

- [ ] **Step 6: Run tests and commit atomically**

Run the three focused test files above and a disposable-repository commit smoke test.

---

### Task 6: Separate production observation, planning, and mutation

**Files:**

- Create: `scripts/bootstrap/production-observe.ts`
- Create: `scripts/bootstrap/production-plan.ts`
- Create: `scripts/bootstrap/production-apply.ts`
- Modify: `scripts/bootstrap/production.ts`
- Modify: `scripts/production-secrets.ts`
- Modify: `scripts/doctor.ts`
- Create: `repo-tests/tooling/bootstrap-production.test.ts`

- [ ] **Step 1: Write provider-fake tests before extraction**

Fake `gh`, `gcloud`, DNS, and secret-store reads. Assert `plan production` performs no writes; account ambiguity blocks; missing values produce guided actions; and `production --yes` applies only the approved diff.

- [ ] **Step 2: Introduce one typed observation model**

```ts
interface ProductionObservation {
  account: Observed<string>;
  project: Observed<string>;
  services: Record<string, Observed<ServiceState>>;
  secrets: Record<string, 'present' | 'missing' | 'unknown'>;
  domains: Record<string, Observed<DnsState>>;
}
```

No field contains secret material. Doctor and all production commands consume this model.

- [ ] **Step 3: Implement a purely functional production planner**

`planProduction(observation, expectations)` returns ordered retain/change/manual/block actions. It includes exact provider identity and distinguishes credential absence, authorization failure, quota, billing, and network failure.

- [ ] **Step 4: Gate every mutation at the boundary**

Before each provider write, print the exact account/project/resource and the resulting change. Interactive mode confirms; `--yes` records prior approval. A changed observation invalidates approval and forces replanning.

- [ ] **Step 5: Run focused tests and prove plan is read-only**

Run: `pnpm exec vitest run repo-tests/tooling/bootstrap-production.test.ts repo-tests/tooling/doctor.test.ts`

Expected: fake provider mutation counters remain zero for check/plan and match the exact plan for production apply.

- [ ] **Step 6: Commit atomically**

---

### Task 7: Make production verification test the public product

**Files:**

- Modify: `scripts/production-verify.ts`
- Modify: `scripts/bootstrap/verify.ts`
- Modify: `scripts/doctor.ts`
- Create: `apps/web/e2e/bootstrap-production.spec.ts`
- Create: `repo-tests/tooling/bootstrap-production-verify.test.ts`

- [ ] **Step 1: Write a failing evidence-classification test**

Require separate results for deployment observation, DNS/TLS, public readiness, passkey registration, sign-out/sign-in, session restoration, and persisted task read/write. A skipped or externally blocked required result cannot produce success.

- [ ] **Step 2: Extract redacted production-test identity handling**

The verifier reads test credentials only from the approved secret source, never accepts them on the command line, and removes authentication artifacts from screenshots, traces, and logs.

- [ ] **Step 3: Implement the public-host acceptance journey**

Run the same behavioral assertions as local verification against the canonical public Docket origin. Record provider release identifiers and observed hostnames as non-secret evidence.

- [ ] **Step 4: Classify rather than blur external blockers**

Use stable outcomes: `passed`, `failed`, `blocked_credentials`, `blocked_authorization`, `blocked_provider`, and `not_observed`. Only all-required `passed` exits zero.

- [ ] **Step 5: Run fake-provider tests, then an authorized staging smoke test**

Run: `pnpm exec vitest run repo-tests/tooling/bootstrap-production-verify.test.ts`

The staging smoke test is optional during implementation unless credentials and authorization are already present; its absence must remain `not_observed`, never `passed`.

- [ ] **Step 6: Commit atomically**

---

### Task 8: Document and continuously test the fresh-clone promise

**Files:**

- Create: `README.md`
- Create: `docs/engineering/repo-bootstrap.md`
- Modify: `docs/engineering/deployment.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/verify-docs.yml`
- Create: `repo-tests/tooling/bootstrap-docs.test.ts`

- [ ] **Step 1: Write a docs/API consistency test**

Parse command examples in the README and engineering guide. Assert every invocation is accepted by `./bootstrap --help`, required environment keys exist in the shared registry, and no legacy first-run sequence is presented as canonical.

- [ ] **Step 2: Write the clone-to-running path first**

The README's first development instruction after cloning is:

```sh
./bootstrap
```

Document prerequisites the launcher cannot safely install, interactive/non-interactive behavior, offline behavior, generated-file ownership, troubleshooting, recovery, production commands, and how to prove success.

- [ ] **Step 3: Add macOS and Linux conformance jobs**

On both runners, clone into a clean path, run check, converge twice, assert the second JSON plan has zero changes, run local verification, and retain redacted diagnostics on failure. CI uses no developer-global configuration.

- [ ] **Step 4: Run all changed-area gates**

Run:

```sh
pnpm docs:check
pnpm test:tooling
pnpm typecheck
pnpm lint
./bootstrap check --non-interactive
./bootstrap --non-interactive --yes
./bootstrap --non-interactive --yes --json
./bootstrap verify local --non-interactive
```

Expected: all pass and the second JSON convergence contains no mutation events.

- [ ] **Step 5: Perform a literal fresh-clone acceptance on macOS and Linux**

Use disposable clones with no repository-local caches. Capture elapsed phases and every manual requirement. Fix the workflow or documentation for every unexplained step; do not substitute the existing developer checkout as proof.

- [ ] **Step 6: Commit the documentation and CI contract atomically**

---

### Task 9: Produce the Docket reference-adopter receipt

**Files:**

- Create: `docs/engineering/bootstrap-conformance.md`
- Modify: `WORKLOG.md`

- [ ] **Step 1: Record exact acceptance evidence**

Include engine version and digests, macOS/Linux job URLs, two-run no-op evidence, local authentication/application verification, production status by capability, and every remaining external blocker.

- [ ] **Step 2: Compare every rough-spec guarantee to evidence**

Use a table with `guarantee`, `test`, `platform`, `result`, and `evidence`. No required row may be silently omitted.

- [ ] **Step 3: Run final repository validation**

Run the changed-area gates from Task 8 plus `git diff --check` and the repository's full test command. If the full suite shows a load-only timeout, rerun the exact test in isolation and report both results; do not convert the isolated pass into a full-suite pass.

- [ ] **Step 4: Commit the conformance receipt atomically**

The receipt is complete only when it describes observed results, not intended results.

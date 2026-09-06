# Hypertext Studio Repo Bootstrap Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the same turnkey, aggressively standardized, idempotent bootstrap API across every active Hypertext Studio repository without forcing projects into a shared language, build system, or heavy manifest.

**Architecture:** The shared engine and launcher are the invariant layer. Each repository contributes only evidence the engine can discover and, where necessary, small executable hooks using ordinary process semantics. Rollout proceeds by ecosystem cohorts after Docket becomes the reference adopter, and every cohort adds conformance fixtures back to the engine so later repositories need less custom work.

**Tech Stack:** Hypertext Studio bootstrap engine, POSIX `sh`, Rust release binaries, Git/GitHub Actions, Node.js/pnpm, Cloudflare tooling, Swift Package Manager, Gradle/Kotlin, macOS and Linux CI.

**Spec:** `docs/superpowers/specs/2026-09-01-repo-bootstrap-design.md`

## Global Constraints

- Every active repository has an executable root `./bootstrap` with the identical command and flag vocabulary.
- There is no required project manifest, adapter package, or language-specific SDK.
- Discovery prefers lockfiles, standard project files, tracked examples, workflow configuration, and existing scripts. Optional hints only resolve ambiguity.
- Repository hooks remain small and project-owned; generic behavior discovered in two repositories moves into the shared engine.
- Every adoption preserves existing supported workflows until equivalence tests prove a compatibility entrypoint can be removed.
- A two-run no-op assertion is mandatory on macOS and Linux for every active repository.
- Production success requires public behavioral verification; provider setup alone is only setup evidence.
- Rollout work never creates provider resources, credentials, DNS records, deployments, or releases without explicit authorization for that repository.
- Repositories that are archival, empty, generated, or policy-only are classified explicitly instead of receiving invented application hooks.

---

### Task 1: Establish the Studio policy, inventory, and update mechanism

**Files (in `TheHypertextStudio/bootstrap`):**

- Create: `docs/adoption-policy.md`
- Create: `docs/repository-inventory.yml`
- Create: `scripts/render-launcher`
- Create: `scripts/update-repository-launcher`
- Create: `tests/repository_inventory.rs`
- Modify: `README.md`

- [ ] **Step 1: Write the failing inventory-schema tests**

The central inventory is rollout metadata, not project configuration. Its only allowed repository fields are canonical name, URL, lifecycle classification, ecosystem cohort, bootstrap version, and conformance status.

```yaml
repositories:
  - name: athena-web
    lifecycle: active
    cohort: node-cloud
    bootstrap: v0.1.0
    conformance: reference
```

- [ ] **Step 2: Reject application configuration in the inventory**

Tests fail if entries contain commands, environment values, package manager choices, hook paths, provider resource IDs, or secrets. Those belong to discoverable repository evidence or repository-owned hooks.

- [ ] **Step 3: Implement deterministic launcher rendering and updating**

The renderer accepts an engine release manifest, produces identical bytes for identical inputs, inserts all four platform digests, and never edits repository files other than the root launcher. The updater opens a patch for review; it never silently runs production bootstrap.

- [ ] **Step 4: Define lifecycle outcomes**

Use `active`, `archival`, `policy-only`, and `unclassified`. Active repositories must conform. Archival repositories get a recorded rationale. Policy-only repositories expose a launcher only if they have an actual development workflow. `unclassified` blocks completion of the rollout.

- [ ] **Step 5: Run tests and commit atomically**

Run: `cargo test --test repository_inventory && shellcheck scripts/render-launcher scripts/update-repository-launcher`

---

### Task 2: Adopt the Node and Cloudflare cohort, starting with the Studio website

**Repositories:**

- `TheHypertextStudio/website`
- `TheHypertextStudio/curfew-sync`
- `TheHypertextStudio/logdate-web`

**Per-repository files:**

- Create or replace: `bootstrap`
- Create when needed: `scripts/bootstrap-local`
- Create when needed: `scripts/bootstrap-production`
- Create when needed: `scripts/bootstrap-verify`
- Modify: `README.md`
- Modify: primary CI workflow
- Test: repository tooling/conformance tests

- [ ] **Step 1: Inventory existing first-run behavior before editing each repo**

Record package manager and version evidence, local configuration examples, service dependencies, current bootstrap/dev scripts, deployment provider, docs, Git hooks, and CI. Preserve a fixture for the existing successful path.

- [ ] **Step 2: Adopt `website` as the second reference implementation**

Replace its existing `scripts/bootstrap.sh` as the public entrypoint with the standard root launcher. Retain the script temporarily as a compatibility delegate or a small hook. Add tests for Node/pnpm and Cloudflare discovery, origin derivation, Git reconciliation, and second-run no-op behavior.

- [ ] **Step 3: Feed reusable Cloudflare observations into the engine**

After website adoption, move generic Wrangler/config detection, authentication-state observation, account ambiguity reporting, and read-only production planning into engine recognizers. Keep site-specific domain/resource expectations in ordinary repository evidence or hooks.

- [ ] **Step 4: Adopt `curfew-sync` and `logdate-web` with the improved engine**

Do not copy website hook code. Add only behavior that cannot be discovered. A duplicated hook block in a second repo triggers an engine issue before cohort completion.

- [ ] **Step 5: Prove the cohort on both platforms**

For each repository, CI performs clean checkout, `./bootstrap check`, two local convergences, JSON zero-diff assertion, the project's smoke/acceptance verification, and docs/API consistency tests on macOS and Linux.

- [ ] **Step 6: Commit separately in each repository and update the central inventory**

Each repository commit is independently reversible. The inventory update records observed CI evidence only after the repo commit exists.

---

### Task 3: Adopt mixed Swift and Cloudflare repositories

**Repositories:**

- `TheHypertextStudio/curfew`
- `TheHypertextStudio/curfew-protocols`

- [ ] **Step 1: Add failing engine fixtures for Swift evidence**

Fixtures cover `Package.swift`, `Package.resolved`, Xcode project/workspace evidence when present, platform availability, Swift toolchain constraints, and a mixed Node/Swift repository. The engine must produce an ordered plan without assuming every Swift repository is an Apple application.

- [ ] **Step 2: Implement the minimum generic Swift recognizer**

Observe installed Xcode command-line tools and Swift versions on macOS. On Linux, support Swift Package Manager where the repository declares Linux support and otherwise emit a clear platform limitation, not a false failure or attempted Xcode install.

- [ ] **Step 3: Adopt `curfew-protocols` first**

Use its narrower protocol/package surface to validate Swift package discovery, dependency resolution, tests, Git hooks, and idempotence. Any necessary hook invokes normal `swift` or package scripts and contains no engine protocol.

- [ ] **Step 4: Adopt mixed-stack `curfew`**

Compose the Swift and Node/Cloudflare recognizers. The plan must expose which phases are available on Linux and preserve full macOS verification. Production planning separates Cloudflare resources from Apple signing/distribution.

- [ ] **Step 5: Add platform-specific acceptance jobs**

macOS proves the supported Apple build/test path plus web/service verification. Linux proves all declared portable phases and returns an explicit unsupported capability for Apple-only phases. Required macOS success cannot be replaced by Linux-only evidence.

- [ ] **Step 6: Commit per repository and promote generic fixes to the engine**

Release a patch engine version when recognizers change, update earlier adopters with the renderer, and rerun their two-platform conformance before closing the cohort.

---

### Task 4: Adopt Android and Gradle repositories

**Repositories:**

- `TheHypertextStudio/docket-android`
- `TheHypertextStudio/logdate-mobile`

- [ ] **Step 1: Add failing Gradle/Android fixtures to the engine**

Cover the Gradle wrapper, version catalogs, Android SDK declarations, Java toolchains, local SDK location, optional emulator evidence, and Kotlin Multiplatform. The wrapper is authoritative; bootstrap never requires a global Gradle installation.

- [ ] **Step 2: Implement non-secret Android environment guidance**

Observe Java, SDK command-line tools, accepted licenses, required platform/build-tools packages, and device/emulator availability. Interactive guidance gives exact official install steps when automatic installation is unsafe. Repository-local configuration may reference an SDK path but never contain credentials or signing keys.

- [ ] **Step 3: Adopt `docket-android`**

The local target resolves wrapper dependencies and builds/tests without a connected device. Local verification with a real app journey is a distinct capability requiring an emulator or device. Docket web/service dependencies are discovered or delegated explicitly rather than presumed global.

- [ ] **Step 4: Adopt `logdate-mobile`**

Compose Gradle, Android, and multiplatform evidence. Verification distinguishes JVM/unit, Android emulator/device, and any Apple-hosted target. Returning-user passkey behavior and offline data persistence remain behavioral acceptance requirements where supported.

- [ ] **Step 5: Prove macOS and Linux convergence**

Both platforms perform two-run no-op bootstrap and host-supported unit/build checks. Device and Apple-target evidence is reported separately. CI caches accelerate work but a cache hit is not a prerequisite for correctness.

- [ ] **Step 6: Commit per repository and release any generic recognizer improvements**

Re-run Docket and website conformance after an engine release to prevent ecosystem-specific regressions.

---

### Task 5: Classify the canonical LogDate repository and any remaining Studio repos

**Files (in `TheHypertextStudio/bootstrap`):**

- Modify: `docs/repository-inventory.yml`
- Create: `docs/repository-classification.md`
- Modify: `tests/repository_inventory.rs`

- [ ] **Step 1: Enumerate repositories from the authoritative organization source**

Use an authorized, read-only GitHub organization listing and compare it with the central inventory. Do not rely on whatever happens to be cloned locally. Record forks, templates, archived repositories, and private repositories without exposing private metadata in public docs.

- [ ] **Step 2: Resolve `TheHypertextStudio/logdate` from evidence**

Determine whether it is an active umbrella, intentionally empty reserved repository, policy-only home, generated repository, or archival artifact. Do not invent a bootstrap workflow for an empty repository. An unresolved classification remains a rollout blocker.

- [ ] **Step 3: Apply the policy to every remaining repository**

Every active development repo receives an adoption task and conformance evidence. Every excluded repo receives a concise lifecycle rationale and review date.

- [ ] **Step 4: Make inventory coverage testable**

The CI check compares the authorized organization listing to the inventory and fails for unclassified active repositories while allowing explicitly ignored forks or archived repositories.

- [ ] **Step 5: Commit the classification evidence atomically**

No repository lifecycle setting is changed remotely as part of this documentation task.

---

### Task 6: Enforce the standard API and idempotence continuously

**Files (in `TheHypertextStudio/bootstrap`):**

- Create: `conformance/api.sh`
- Create: `conformance/idempotence.sh`
- Create: `conformance/git-worktree.sh`
- Create: `conformance/redaction.sh`
- Create: `.github/workflows/repository-conformance.yml`
- Create: `docs/conformance.md`

- [ ] **Step 1: Write portable black-box conformance tests**

Tests may inspect only the public launcher, filesystem/process effects, JSON events, exit codes, and disposable Git/provider fakes. They may not import project code or assume a project language.

- [ ] **Step 2: Test the exact command surface**

Require the six command forms and five flags from the spec, stable exit codes, machine-readable JSON, non-interactive no-prompt behavior, offline behavior, and failure on unknown input.

- [ ] **Step 3: Test two-run and interruption safety**

Hash relevant repository state before and after a successful second run. Interrupt at every durable write boundary, rerun, and require convergence without manual cleanup. Verify lock ownership and stale-lock recovery.

- [ ] **Step 4: Test Git worktrees and personal hooks**

Bootstrap two linked worktrees, preserve distinct worktree settings, execute tracked policy hooks, compose rather than overwrite global personal hooks, and avoid changes outside the disposable repository.

- [ ] **Step 5: Test redaction with seeded canary secrets**

Seed unique canaries into environment, fake CLIs, files, and hook output. Fail if any appears in text, JSON, state, retained artifacts, or CI annotations.

- [ ] **Step 6: Run every adopter on macOS and Linux**

The central workflow dispatches or consumes repository-owned conformance results. A dashboard entry includes engine version, repository revision, platform, local convergence, local verification, production planning, production verification, and timestamp.

- [ ] **Step 7: Commit and publish the conformance harness with the next engine release**

Release notes identify any adopter that has not yet consumed the harness; absence is visible, not silently green.

---

### Task 7: Make engine upgrades safe, boring, and reversible

**Files (in `TheHypertextStudio/bootstrap`):**

- Create: `docs/releasing.md`
- Create: `docs/upgrading.md`
- Create: `.github/workflows/release.yml`
- Create: `.github/workflows/update-adopters.yml`
- Create: `tests/launcher_upgrade.rs`

- [ ] **Step 1: Test upgrade and rollback before automation**

Given two signed release manifests, require deterministic launcher upgrades, exact digest replacement, no unrelated file edits, and deterministic rollback to the prior version.

- [ ] **Step 2: Gate releases on the full binary matrix**

Build all four binaries, run unit and black-box tests, publish checksums and provenance, install each artifact in a clean runner, and execute a fixture bootstrap twice. Missing artifacts or verification block the release.

- [ ] **Step 3: Open reviewable adopter updates**

The updater produces one repository change containing only the launcher and any explicitly generated compatibility metadata. Repository CI runs its full bootstrap conformance before review. It does not merge, deploy, or mutate production.

- [ ] **Step 4: Define compatibility and deprecation policy**

Keep the public API stable across v0.x adopters. Additive event fields are allowed; command/flag removal, changed exit meaning, or state incompatibility requires a major version and migration plan. Support rollback across at least the immediately prior release.

- [ ] **Step 5: Exercise a fleet rollback drill**

In disposable forks or fixtures, upgrade every ecosystem cohort, inject a recognizer regression, roll launchers back, and prove local development still converges. Record elapsed time and manual steps.

- [ ] **Step 6: Commit the release automation atomically**

---

### Task 8: Close the rollout with observed fleet evidence

**Files (in `TheHypertextStudio/bootstrap`):**

- Create: `docs/fleet-conformance.md`
- Modify: `docs/repository-inventory.yml`
- Modify: `README.md`

- [ ] **Step 1: Generate a fleet receipt from CI artifacts**

For every active repository and supported platform, record revision, engine version, API contract, first-run result, second-run mutation count, local verification result, production-plan result, production-verification result, and evidence link.

- [ ] **Step 2: Audit every exception**

Each unsupported capability has an owner, technical reason, user-facing guidance, and review date. No exception may weaken another repository's contract or rename the standard API.

- [ ] **Step 3: Perform fresh-clone human acceptance**

A developer unfamiliar with each repo follows only its README on clean macOS and Linux hosts. Record every unexplained choice, global dependency, account assumption, or recovery gap and repair it before acceptance.

- [ ] **Step 4: Verify production claims independently**

Where authorized environments exist, run behavioral public acceptance. Otherwise record the exact external blocker. Never roll setup-only evidence into a fleet-success percentage.

- [ ] **Step 5: Mark the rollout complete only when the inventory has no unclassified active repository**

Publish the receipt and retain the repository-level CI evidence. The standardized API is thereafter a required repository policy, not an optional convenience.

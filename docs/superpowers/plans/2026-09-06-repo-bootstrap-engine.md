# Repo Bootstrap Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the runtime-independent engine and root launcher that give every Hypertext Studio repository the same bootstrap command surface.

**Architecture:** A dedicated `TheHypertextStudio/bootstrap` repository publishes one Rust binary for each supported macOS and Linux architecture. Each application repository checks in a tiny POSIX `./bootstrap` launcher that pins an engine version and per-platform SHA-256 digest; the engine discovers ordinary repository evidence, compiles a reconciliation plan, applies only observed drift, and verifies postconditions. Project-specific behavior remains an optional executable hook convention, not a manifest or adapter SDK.

**Tech Stack:** Rust 1.98, Cargo, `clap`, `serde`, `serde_json`, `secrecy`, `sha2`, POSIX `sh`, GitHub Actions, shell fixtures, native Git 2.55 behavior.

**Spec:** `docs/superpowers/specs/2026-09-01-repo-bootstrap-design.md`

## Global Constraints

- Every Hypertext Studio repository exposes an executable `./bootstrap` at its root.
- The public commands are exactly `./bootstrap`, `check`, `plan [local|production]`, `production`, and `verify [local|production]`.
- The public flags are exactly `--yes`, `--non-interactive`, `--json`, `--offline`, and `--no-install`; unknown input fails.
- macOS and Linux are supported; the first binary matrix is Apple Silicon macOS, Intel macOS, arm64 Linux, and x86-64 Linux.
- A second successful reconciliation with unchanged inputs performs zero persistent mutations.
- No project manifest is required. Detection uses repository evidence; a small hints file can only resolve genuine ambiguity.
- Ordinary project escape hatches are executable files under `scripts/`, with normal stdout, stderr, and exit status.
- Production work is explicit, identifies the exact account and project, and never treats a provider click as verification.
- Secrets never enter ordinary logs, shell history, bootstrap state, or tracked files.
- Planning and checking are non-mutating. An externally blocked required capability prevents a production-success result.
- Native Windows is outside the first contract; Windows development uses WSL.

---

### Task 1: Create the engine repository and freeze the public contract

**Files:**

- Create in `TheHypertextStudio/bootstrap`: `Cargo.toml`
- Create: `rust-toolchain.toml`
- Create: `src/main.rs`
- Create: `src/cli.rs`
- Create: `src/contract.rs`
- Test: `tests/cli_contract.rs`

**Interfaces:**

- Produces: `cli::parse<I, S>(args: I) -> Result<Options, CliError>`
- Produces: `contract::{Command, Target, Options, ExitCode}` used by every later engine task.
- Consumes: no application-specific code or manifest.

- [ ] **Step 1: Write the failing command-contract tests**

```rust
#[test]
fn default_is_local_convergence() {
    assert_eq!(parse(["bootstrap"]).unwrap().command, Command::Converge);
    assert_eq!(parse(["bootstrap"]).unwrap().target, Target::Local);
}

#[test]
fn production_plan_is_read_only() {
    let options = parse(["bootstrap", "plan", "production", "--json"]).unwrap();
    assert_eq!(options.command, Command::Plan);
    assert_eq!(options.target, Target::Production);
    assert!(options.json);
}

#[test]
fn unknown_flags_fail() {
    assert!(parse(["bootstrap", "--prodution"]).is_err());
}
```

- [ ] **Step 2: Run the tests and confirm the contract is absent**

Run: `cargo test --test cli_contract`

Expected: compilation fails because `cli` and `contract` do not exist.

- [ ] **Step 3: Implement the exact public vocabulary and exit codes**

```rust
// Cargo.toml dependencies used by the first two tasks:
// clap = { version = "4", features = ["derive"] }
// serde = { version = "1", features = ["derive"] }
// serde_json = "1"
// secrecy = "0.10"
// sha2 = "0.10"

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Command { Converge, Check, Plan, Production, Verify }

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Target { Local, Production }

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Options {
    pub command: Command,
    pub target: Target,
    pub yes: bool,
    pub non_interactive: bool,
    pub json: bool,
    pub offline: bool,
    pub no_install: bool,
}

#[repr(i32)]
pub enum ExitCode {
    Verified = 0,
    ApprovalRequired = 2,
    AuthenticationRequired = 3,
    AmbiguousProject = 4,
    TransientFailure = 5,
    InvalidConfiguration = 6,
    ExternalBlocker = 7,
    VerificationFailed = 8,
    ConcurrentRun = 9,
}
```

Use `clap` only inside `src/cli.rs`; no application imports this crate as an SDK. Make `production` imply `Target::Production`, make bare `verify` default to local, and reject targets on commands that do not accept them.

- [ ] **Step 4: Prove parsing and help output**

Run: `cargo test --test cli_contract && cargo run -- --help`

Expected: all contract tests pass and help lists only the five commands and five shared flags.

- [ ] **Step 5: Commit the contract**

Write a message file containing a Conventional Commit body, then run the repository's required atomic staging chain for `Cargo.toml`, `rust-toolchain.toml`, `src/`, and `tests/cli_contract.rs`.

---

### Task 2: Emit stable human and machine-readable results without leaking secrets

**Files:**

- Create: `src/event.rs`
- Create: `src/output/mod.rs`
- Create: `src/output/text.rs`
- Create: `src/output/json.rs`
- Create: `src/output/redact.rs`
- Test: `tests/output_contract.rs`

**Interfaces:**

- Consumes: `contract::{ExitCode, Target}` from Task 1.
- Produces: `event::Event`, `event::Phase`, `event::Status`.
- Produces: `output::Sink::emit(&mut self, event: &Event) -> io::Result<()>`.
- Produces: `redact::Redactor::register(&mut self, secret: SecretString)` and `redact(&self, text: &str) -> String`.

- [ ] **Step 1: Write failing NDJSON and redaction tests**

```rust
#[test]
fn json_is_one_versioned_event_per_line() {
    let event = Event::pass(1, "git.identity", Phase::Observe, "Git identity is configured");
    let line = render_json(&event).unwrap();
    let value: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
    assert_eq!(value["schema"], "hypertext.bootstrap/v1");
    assert_eq!(value["step"], "git.identity");
}

#[test]
fn known_and_credential_shaped_values_are_redacted() {
    let mut redactor = Redactor::default();
    redactor.register(SecretString::new("exact-secret".into()));
    assert_eq!(redactor.redact("token exact-secret ghp_abcdefghijklmnopqrstuvwxyz123456"),
               "token [REDACTED] [REDACTED]");
}
```

- [ ] **Step 2: Run the tests and confirm the output layer is absent**

Run: `cargo test --test output_contract`

Expected: compilation fails on the missing output types.

- [ ] **Step 3: Implement the event schema**

```rust
#[derive(Serialize)]
pub struct Event {
    pub schema: &'static str,
    pub sequence: u64,
    pub step: String,
    pub phase: Phase,
    pub status: Status,
    pub target: Target,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase { Discover, Observe, Plan, Apply, Verify, Summary }

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status { Pass, Change, Blocked, Fail, Skipped }
```

Human output must work without color or cursor control. JSON mode writes NDJSON to stdout and human diagnostics to stderr only when needed. Every sink receives already-redacted text.

- [ ] **Step 4: Add credential-shape defenses**

Redact registered values and recognizable private keys, GitHub tokens, Google API keys, Stripe keys, bearer tokens, JWTs, and URLs containing userinfo. Add negative tests proving ordinary commit hashes, hostnames, and UUIDs remain readable.

- [ ] **Step 5: Run output tests and Clippy**

Run: `cargo test --test output_contract && cargo clippy --all-targets -- -D warnings`

Expected: all tests pass and Clippy reports no warnings.

- [ ] **Step 6: Commit the output boundary**

Commit only `src/event.rs`, `src/output/`, and `tests/output_contract.rs` with the atomic staging chain.

---

### Task 3: Build the reconciliation runner, durable receipts, and checkout lock

**Files:**

- Create: `src/reconcile/mod.rs`
- Create: `src/reconcile/runner.rs`
- Create: `src/reconcile/state.rs`
- Create: `src/reconcile/lock.rs`
- Test: `tests/reconciliation.rs`
- Test: `tests/interruption.rs`

**Interfaces:**

- Consumes: `contract::Options`, `event::Event`, and `output::Sink`.
- Produces: `Step { id, risk, observe, apply, verify }` as an internal engine type.
- Produces: `Runner::plan`, `Runner::converge`, and `Runner::verify`.
- Produces: checkout state under `$(git rev-parse --git-dir)/hypertext-bootstrap/` containing no secrets.

- [ ] **Step 1: Write a failing two-run idempotence test**

```rust
#[test]
fn second_convergence_has_no_apply_events_and_preserves_bytes() {
    let fixture = Fixture::new("node-minimal");
    let first = fixture.converge();
    assert_eq!(first.exit, ExitCode::Verified);
    let snapshot = fixture.snapshot_persistent_state();
    let second = fixture.converge();
    assert_eq!(second.apply_events(), 0);
    assert_eq!(fixture.snapshot_persistent_state(), snapshot);
}
```

- [ ] **Step 2: Write failing interruption and lock tests**

Inject the test-only environment variable `HYPERTEXT_BOOTSTRAP_FAIL_AFTER_STEP=git.hooks`, assert the first run exits transiently, clear it, and assert the next run converges without repeating completed writes. Hold the checkout lock in one process and assert a second process exits with `ExitCode::ConcurrentRun` without changing state.

- [ ] **Step 3: Implement observe-plan-apply-verify sequencing**

```rust
pub struct Step {
    pub id: &'static str,
    pub risk: Risk,
    pub observe: fn(&Context) -> Result<Observation>,
    pub apply: fn(&Context, &Observation) -> Result<ApplyResult>,
    pub verify: fn(&Context) -> Result<Verification>,
}

pub enum Risk { Repository, Machine, Privileged, Remote, Billable, Destructive }
```

`check` executes discovery and observation only. `plan` observes and renders proposed actions only. `converge` applies only observations marked drifted and then re-observes. `verify` executes postconditions only. Require a confirmation boundary before machine, privileged, remote, or billable actions even when ordinary repository writes are accepted.

- [ ] **Step 4: Persist only non-secret receipts atomically**

Write a versioned JSON state file through a same-directory temporary file and rename. Store engine version, canonical repository path hash, completed stable step IDs, artifact digests, and timestamps. Never store prompt answers, tokens, secret hashes, provider response bodies, or environment values.

- [ ] **Step 5: Run reconciliation tests twice**

Run: `cargo test --test reconciliation --test interruption && cargo test --test reconciliation --test interruption`

Expected: both invocations pass; the second invocation creates no fixture diff.

- [ ] **Step 6: Commit the reconciliation core**

Commit `src/reconcile/`, `tests/reconciliation.rs`, and `tests/interruption.rs` atomically.

---

### Task 4: Discover repositories by evidence and reject unresolved ambiguity

**Files:**

- Create: `src/discovery/mod.rs`
- Create: `src/discovery/evidence.rs`
- Create: `src/discovery/node.rs`
- Create: `src/discovery/python.rs`
- Create: `src/discovery/rust.rs`
- Create: `src/discovery/go.rs`
- Create: `src/discovery/jvm.rs`
- Create: `src/discovery/swift.rs`
- Create: `src/discovery/containers.rs`
- Create: `tests/discovery.rs`
- Create fixtures under: `tests/fixtures/discovery/`

**Interfaces:**

- Produces: `discover(root: &Path) -> Result<Project, DiscoveryError>`.
- Produces: `Project { root, stacks, lockfiles, commands, services, deployment_evidence, ambiguities }`.
- Consumes: filesystem evidence only; it does not execute project code during discovery.

- [ ] **Step 1: Add table-driven failing fixtures**

Create minimal fixtures for pnpm workspaces, npm, uv, Cargo, Go modules, Gradle, Maven, Swift Package Manager, Docker Compose, and a mixed repository. Add a fixture containing both `pnpm-lock.yaml` and `package-lock.json` without a package-manager declaration and assert `DiscoveryError::Ambiguous` names both candidates.

```rust
#[test]
fn package_manager_ambiguity_is_never_guessed() {
    let error = discover(fixture("node-two-lockfiles")).unwrap_err();
    assert!(matches!(error, DiscoveryError::Ambiguous { .. }));
    assert!(error.to_string().contains("pnpm-lock.yaml"));
    assert!(error.to_string().contains("package-lock.json"));
}
```

- [ ] **Step 2: Implement evidence scoring and precedence**

Treat explicit native declarations (`packageManager`, `engines`, `rust-toolchain.toml`, Gradle wrapper) as stronger than generic files. Lockfiles beat an installed global tool. A checked-in wrapper beats a machine binary. Mixed stacks accumulate; mutually exclusive choices become ambiguities.

- [ ] **Step 3: Support a constrained hints file**

Accept `.bootstrap-hints` as newline-delimited `key=value` pairs only for `package-manager`, `ignore-evidence`, and `primary-app`. Reject every other key. Tests must prove the file cannot declare commands, environment variables, resources, secrets, or provider graphs.

- [ ] **Step 4: Run discovery tests on macOS and Linux fixtures**

Run: `cargo test --test discovery`

Expected: every fixture resolves to the asserted stack and the unresolved two-lockfile fixture exits as ambiguous.

- [ ] **Step 5: Commit discovery**

Commit `src/discovery/` and `tests/fixtures/discovery/` with `tests/discovery.rs`.

---

### Task 5: Reconcile Git identity, remotes, branch policy, scopes, and composable hooks

**Files:**

- Create: `src/git/mod.rs`
- Create: `src/git/config.rs`
- Create: `src/git/remotes.rs`
- Create: `src/git/hooks.rs`
- Create: `assets/hook-dispatcher.sh`
- Test: `tests/git_readiness.rs`
- Test fixtures: `tests/fixtures/git/`

**Interfaces:**

- Produces: `git::observe(root: &Path) -> Result<GitObservation>`.
- Produces: `git::plan(observation: &GitObservation, project: &Project) -> Vec<Step>`.
- Consumes: `.githooks/`, `COMMIT_SCOPES.txt`, Git effective configuration, and remote metadata.
- Produces: a worktree-scoped `core.hooksPath` dispatcher that runs repository hooks and a pre-existing global hook path exactly once.

- [ ] **Step 1: Write failing normal-checkout, worktree, detached, and global-hook tests**

```rust
#[test]
fn worktree_hooks_do_not_overwrite_sibling_policy() {
    let repo = GitFixture::with_two_worktrees();
    repo.bootstrap("first");
    repo.bootstrap("second");
    assert_ne!(repo.hooks_path("first"), repo.hooks_path("second"));
    assert!(repo.run_hook("first", "commit-msg").success());
    assert!(repo.run_hook("second", "commit-msg").success());
}

#[test]
fn an_existing_global_hook_is_composed_not_discarded() {
    let repo = GitFixture::with_global_hook("pre-commit");
    repo.bootstrap("main");
    assert_eq!(repo.recorded_hook_calls(), ["repository", "global"]);
}
```

- [ ] **Step 2: Observe Git without mutation**

Read checkout kind, submodule superproject, current branch, upstream, remote URLs, remote HEAD, default branch, author name/email with `--show-origin --show-scope`, signing settings, `extensions.worktreeConfig`, effective `core.hooksPath`, ignore rules, and `COMMIT_SCOPES.txt`. `check` must leave `.git/config`, worktree config, index, refs, and working tree byte-identical.

- [ ] **Step 3: Implement worktree-local configuration**

Enable `extensions.worktreeConfig` once in the common repository config, then write the managed `core.hooksPath` with `git config --worktree`. Current Git documents that worktree config lives in `$GIT_DIR/config.worktree`, overrides other scopes, and remains separate for linked worktrees.

- [ ] **Step 4: Compose rather than erase personal hooks**

Generate the dispatcher under `$GIT_DIR/hypertext-bootstrap/hooks/`. For each supported hook, run `.githooks/<hook>` from the current worktree first, then the previously effective non-managed hook of the same name. Prevent recursion by recording the resolved prior path in dispatcher metadata and rejecting a path that resolves back to the managed directory.

- [ ] **Step 5: Enforce safe repository behavior**

Offer repository-local author identity only when missing or explicitly rejected. Never change system or global identity. Never stage, commit, push, rewrite, initialize a remote, change a default branch, or modify provider settings as an incidental action. Report a detached checkout and incorrect remote with recovery commands.

- [ ] **Step 6: Validate Conventional Commit scopes**

When a repository declares `COMMIT_SCOPES.txt`, require one scope per non-comment line, reject duplicates and invalid tokens, and verify its commit-message hook and CI validator both read that file. When it is absent, propose a reviewed scope set from product/domain directories and recent valid commit scopes; do not write the file under `--yes` alone.

- [ ] **Step 7: Run Git readiness tests twice**

Run: `cargo test --test git_readiness && cargo test --test git_readiness`

Expected: all cases pass and the second run leaves both worktree config files and hook trees unchanged.

- [ ] **Step 8: Commit Git readiness**

Commit `src/git/`, `assets/hook-dispatcher.sh`, `tests/git_readiness.rs`, and `tests/fixtures/git/`.

---

### Task 6: Plan native tools and run lightweight project hooks

**Files:**

- Create: `src/tools/mod.rs`
- Create: `src/tools/macos.rs`
- Create: `src/tools/linux.rs`
- Create: `src/hooks.rs`
- Test: `tests/tool_planning.rs`
- Test: `tests/project_hooks.rs`

**Interfaces:**

- Consumes: `discovery::Project`, `contract::Options`, and `reconcile::Step`.
- Produces: detected tool requirements with source, version requirement, install command, privilege boundary, and verification command.
- Produces: conventional hook execution for `scripts/bootstrap-local`, `scripts/bootstrap-production`, and `scripts/bootstrap-verify`.

- [ ] **Step 1: Write failing install-boundary tests**

Assert `--no-install` reports a missing tool and its exact recovery command without executing it. Assert `--offline` refuses network installers. Assert macOS never invokes Homebrew unless `brew` already exists or the operator separately approves installing Homebrew. Assert Linux chooses only a detected package manager among apt, dnf, pacman, and zypper.

- [ ] **Step 2: Implement repository-local tools before machine tools**

Prefer checked-in Gradle/Maven wrappers, Corepack package-manager pins, local virtual environments, Cargo lockfiles, and Swift Package Manager. Treat Homebrew, Docker, Xcode command-line tools, Android SDK, Java, Python, Go, and Rust as machine prerequisites with explicit ownership and verification.

- [ ] **Step 3: Implement the simple hook convention**

Run only executable files at the three exact paths. `scripts/bootstrap-verify` receives one positional target, `local` or `production`; the other two receive no arguments. Set `CI=1` only in `--non-interactive` mode. Hooks communicate through normal output and exit status—there is no registration API, capability object, RPC, or manifest.

- [ ] **Step 4: Prove hook failures remain actionable**

Use fixtures whose hooks pass, fail with a one-line recovery message, are not executable, and mutate on every run. Assert non-executable hooks are reported as invalid configuration and non-idempotent hooks fail conformance with the changed paths listed.

- [ ] **Step 5: Run the tool and hook tests**

Run: `cargo test --test tool_planning --test project_hooks`

Expected: all tests pass on the host platform; OS-specific command generation is covered with injected platform fixtures.

- [ ] **Step 6: Commit tool planning and hook execution**

Commit `src/tools/`, `src/hooks.rs`, `tests/tool_planning.rs`, and `tests/project_hooks.rs`.

---

### Task 7: Generate the pinned POSIX launcher and publish verified binaries

**Files:**

- Create: `assets/bootstrap.sh.tmpl`
- Create: `src/launcher.rs`
- Create: `src/bin/render-launcher.rs`
- Create: `scripts/package-release.sh`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Test: `tests/launcher.rs`

**Interfaces:**

- Produces: `render-launcher --version <tag> --checksums <file>` which writes a complete executable launcher to stdout.
- Produces release artifacts named `hypertext-bootstrap_<target>.tar.gz` plus `SHA256SUMS`.
- Consumes no repository language runtime when the generated launcher runs.

- [ ] **Step 1: Write failing launcher tests with a local HTTP fixture**

Cover Darwin/Linux and arm64/x86-64 selection, cache hit, cache miss, offline cache miss, missing `curl`, SHA mismatch, interrupted download, and concurrent launch. Assert failed downloads never replace a verified cached binary.

- [ ] **Step 2: Implement the launcher**

The generated POSIX script determines platform with `uname`, resolves cache beneath `${XDG_CACHE_HOME:-$HOME/.cache}/hypertext-bootstrap/<version>/`, downloads to a temporary file, verifies the digest with `shasum -a 256` or `sha256sum`, marks the binary executable, atomically renames it, and `exec`s it with the original arguments. The version and all four real digests are literal generated values; rendering fails if `SHA256SUMS` lacks any platform.

- [ ] **Step 3: Add the release matrix**

Build `aarch64-apple-darwin`, `x86_64-apple-darwin`, `aarch64-unknown-linux-musl`, and `x86_64-unknown-linux-musl`. Run tests, formatting, Clippy, and a smoke invocation of each native artifact before packaging. Generate `SHA256SUMS` from final archives, then attach archives and checksums to one immutable GitHub release.

- [ ] **Step 4: Prove the generated launcher has no unresolved sentinels**

Run: `cargo test --test launcher && cargo run --bin render-launcher -- --version v0.1.0 --checksums dist/SHA256SUMS > /tmp/bootstrap && sh -n /tmp/bootstrap && ! grep -q '__' /tmp/bootstrap`

Expected: tests pass, shell syntax is valid, and no generator sentinel remains.

- [ ] **Step 5: Commit launcher and release automation**

Commit the template, renderer, packaging script, workflows, and launcher tests. Publishing `v0.1.0` is a separate explicitly authorized remote action after the commit is reviewed.

---

### Task 8: Ship the black-box conformance command

**Files:**

- Create: `src/bin/bootstrap-conformance.rs`
- Create: `src/conformance/mod.rs`
- Create: `src/conformance/snapshot.rs`
- Create: `src/conformance/faults.rs`
- Create: `tests/conformance.rs`
- Create fixtures under: `tests/fixtures/conformance/`
- Create: `docs/CONFORMANCE.md`

**Interfaces:**

- Produces: `bootstrap-conformance <repo> --profile local|production-fixture`.
- Consumes only a repository's root `./bootstrap` and observable filesystem/process/fake-provider state.
- Produces a versioned JSON report and process exit status; it does not import application code.

- [ ] **Step 1: Write failing conformance scenarios**

Add passing, second-run-mutating, secret-leaking, prompt-in-noninteractive, interrupted, ambiguous, and stale-launcher fixtures. Assert each failure names the violated invariant and observable evidence.

- [ ] **Step 2: Implement the required sequence**

For `local`: copy a clean fixture, run `./bootstrap --non-interactive`, run `verify local`, snapshot persistent state, run bootstrap again, compare snapshots, inject one supported interruption, rerun, introduce representative managed drift, and assert only that drift is repaired. Scan combined output and state for registered and credential-shaped secrets.

- [ ] **Step 3: Add production fixtures without real provider mutation**

Use fake `gh`, `gcloud`, `wrangler`, `vercel`, and provider HTTP endpoints on `PATH`. Assert `plan production` is non-mutating, production identifies account/project targets, remote actions require approval, and verification failure or external blockage prevents success.

- [ ] **Step 4: Document the conformance evidence**

`docs/CONFORMANCE.md` must define snapshot exclusions narrowly: engine cache access times, explicitly temporary verification directories, and process IDs. Repository files, Git config, secret stores, databases, fake provider state, deployments, and hook content remain compared.

- [ ] **Step 5: Run the complete engine gate**

Run: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --all-targets`

Expected: zero failures and every conformance fixture classified correctly.

- [ ] **Step 6: Commit conformance and documentation**

Commit `src/bin/bootstrap-conformance.rs`, `src/conformance/`, `tests/conformance.rs`, conformance fixtures, and `docs/CONFORMANCE.md`.

---

### Task 9: Cut the reviewed engine release and capture receipts

**Files:**

- Modify: `Cargo.toml`
- Create: `CHANGELOG.md`
- Create: `docs/releases/v0.1.0.md`

**Interfaces:**

- Consumes: the complete gate from Task 8 and the four release artifacts from Task 7.
- Produces: immutable `v0.1.0`, its checksums, and the exact launcher-render command Docket consumes.

- [ ] **Step 1: Run the clean release gate from a fresh clone**

Run the engine's CI-equivalent command in a fresh temporary checkout, then run each native smoke test available on the host. Record commit SHA, Rust version, test totals, artifact names, sizes, and SHA-256 values in `docs/releases/v0.1.0.md`.

- [ ] **Step 2: Verify release reproducibility**

Build the host artifact twice from the same commit with `SOURCE_DATE_EPOCH` set to the commit timestamp and compare digests. If they differ, list the differing archive members and correct packaging metadata before publishing.

- [ ] **Step 3: Commit the release receipt**

Commit the version, changelog, and receipt with the atomic staging chain.

- [ ] **Step 4: Publish only with explicit remote authorization**

Create the signed `v0.1.0` tag and GitHub release, wait for the release workflow, download the published archives into a clean directory, verify them against published `SHA256SUMS`, and run the generated launcher against `--help`, `check`, and `plan local`.

- [ ] **Step 5: Hand the verified release to Docket adoption**

Run `render-launcher --version v0.1.0 --checksums <downloaded SHA256SUMS>` and pass the resulting file plus the release receipt to the Docket plan. Do not hand-copy or invent a digest.

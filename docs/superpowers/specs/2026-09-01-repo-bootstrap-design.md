# Hypertext Studio Repo Bootstrap Spec

> **Status:** Rough design for review
> **Scope:** The required bootstrap experience for every Hypertext Studio repository
> **Reference project:** Docket

## The promise

Every Hypertext Studio repository has an executable `./bootstrap` at its root.

After a fresh clone, a person should be able to run that command and arrive at a working local
application without first learning the repository's language, package manager, service topology,
or deployment providers. When the application supports accounts, sign-in, databases, background
work, or other essential behavior, bootstrap proves those things work. Installing dependencies or
receiving an HTTP 200 is not enough.

The same entrypoint can guide an authorized operator through production setup. It provisions what
can safely be automated, explains every manual action, verifies the result, and stops honestly at
external approval, billing, signing, or domain-ownership gates.

This is a mandatory company standard, not an optional convenience. Language-native commands can
remain underneath it, but they are never the only documented route from clone to working app.

## What this standard is

Repo Bootstrap is a small shared engine, a required repository launcher, a set of built-in
recognizers for common development stacks and providers, and a conformance suite.

The launcher is checked into each repository as `./bootstrap` and pins a known engine version. It
must be able to begin on a normal macOS or Linux machine without requiring the repository's own
language runtime first. The likely implementation is a small POSIX launcher plus a checksummed
portable engine release. The engine's implementation language and distribution mechanism remain an
implementation decision; they must not become part of an application's public setup contract.

Application repositories do not implement a formal adapter SDK. The engine recognizes a project
by what is present and what the project already knows how to do. It understands common files,
native commands, existing configuration, and provider state. Supporting a new kind of project is
normally an improvement to the shared recognizers, not a new manifest every repository must fill
out.

## The standard command surface

Every repository supports the same small interface:

```sh
./bootstrap
./bootstrap check
./bootstrap plan [local|production]
./bootstrap production
./bootstrap verify [local|production]
```

- `./bootstrap` converges the local environment, starts what the application needs, and verifies
  the primary local journey.
- `check` observes the machine and project without changing either one.
- `plan` shows the exact work a run would perform, including local, remote, privileged, and manual
  actions.
- `production` performs the explicitly approved production flow and verifies the live result.
- `verify` repeats postcondition and user-journey checks without provisioning resources.
- Repair is not a separate mode. Rerunning bootstrap is how a person repairs drift.

All repositories also accept the same operational flags:

- `--yes` accepts ordinary, previously displayed changes on a machine the operator controls.
- `--non-interactive` prohibits prompts and fails with actionable missing-input information.
- `--json` emits stable machine-readable events in addition to the process exit status.
- `--offline` prohibits network work and reports which guarantees cannot be checked.
- `--no-install` permits diagnosis and repository-local work but prohibits machine-wide installs.

Unknown commands and flags fail instead of being silently ignored. CI and agents consume the same
entrypoint and results as a person at a terminal.

## Convention before configuration

Bootstrap starts by inspecting the repository and machine. Examples of useful evidence include:

- `package.json`, lockfiles, workspaces, and standard package scripts
- `pyproject.toml`, `uv.lock`, requirements files, and virtual environments
- `Cargo.toml`, `go.mod`, Gradle, Maven, `Package.swift`, Xcode projects, and Android projects
- Dockerfiles, Compose files, development containers, and local service definitions
- migration directories and database configuration
- `wrangler.toml`, `vercel.json`, Terraform, deployment workflows, and cloud configuration
- `.env.example`, typed environment registries, and runtime validation schemas
- repository origin, directory layout, generated files, and existing remote resources

Recognizers make evidence-backed claims. More-specific evidence wins over generic evidence. When
two interpretations remain equally plausible, bootstrap asks the person rather than guessing.

There is no required project manifest. A tiny hints file may settle durable ambiguity, such as
preferring pnpm over another detected package manager or ignoring a legacy deployment file. It may
not grow into a parallel description of the repository's task graph, environment, or
infrastructure. If a project needs many hints, the shared recognizer should improve.

An unusual repository may expose ordinary executable hooks such as `scripts/bootstrap-local` or
`scripts/bootstrap-verify`. Hooks can use any language and ordinary exit statuses. They do not
register capabilities, implement lifecycle interfaces, or emit a custom object model. Their
correctness is enforced by the same black-box conformance tests as the rest of bootstrap.

## The interactive experience

Interactive guidance is the default. Bootstrap presents one unresolved step at a time and keeps
completed work compact.

Before asking for a value or approval, it explains:

1. What is missing and why the application needs it.
2. Whether the value or resource can be derived or created automatically.
3. Which person, company account, organization, repository, project, or domain must own it.
4. The minimum permissions required and why each permission exists.
5. The exact command or direct provider page used to complete the step.
6. Where a credential will be stored and which runtime will consume it.
7. What bootstrap is about to change and how it will verify success.

Bootstrap asks only for information it cannot safely discover. It may offer to open provider pages
or start authentication flows, but it does so with consent. After a manual action, it rechecks the
provider instead of accepting a click as proof. A person can leave and rerun the command; bootstrap
resumes from observed reality rather than a fragile wizard checkpoint.

In non-interactive mode, bootstrap never waits for input. It exits with structured missing-input or
approval information and includes the same recovery guidance a person would have seen.

Terminal presentation must remain usable without color, cursor control, or a particular terminal
emulator. Copyable commands and plain-language errors matter more than animation.

## Idempotence is a product requirement

Given the same repository, configuration, credentials, and external state, repeated bootstrap runs
converge on the same result. A successful second reconciliation run makes no persistent local,
secret, database, provider, or deployment mutations. Verification may create short-lived sessions
or isolated synthetic data only when it removes them or restores the exact prior observable state.

The practical rules are:

- Observe before acting and re-observe after acting.
- Treat cached state as a speed optimization, never as proof of reality.
- Give every managed remote resource a stable identity and ownership boundary.
- Generate a secret once; never rotate it simply because bootstrap ran again.
- Compare file contents before writing and replace managed files atomically.
- Record and respect durable database migration history.
- Deploy only when the desired artifact differs from the verified live artifact.
- Repair only the drift that was observed.
- Never delete data or remote resources during an ordinary bootstrap run.
- Make privileged, remote, billable, and destructive effects explicit before execution.
- Prevent concurrent bootstrap runs from racing over the same checkout or resource.
- Preserve enough non-secret recovery information to continue after interruption.

An operation is not complete because a command exited successfully. Bootstrap verifies the
postcondition through the most authoritative practical interface: a file read, process health
check, database query, provider API, public endpoint, or real user journey.

Custom hooks receive no exemption from this requirement. The conformance suite runs them twice,
interrupts them at controlled boundaries where possible, and compares observable state.

## Local setup contract

A successful local bootstrap leaves the application usable, not merely buildable. Depending on the
project, it may:

- install missing native prerequisites with explicit consent
- activate pinned language and package-manager versions
- install repository-local dependencies from lockfiles
- generate and preserve development-only secrets
- derive canonical local hostnames and callback URLs
- create local certificates and routing
- start databases, mail capture, queues, emulators, and application services
- apply pending migrations and seed only isolated development or verification data
- start the application through its canonical development path
- verify health, account creation, sign-in, persistence, and the primary product journey

Repository-local tools and JavaScript CLIs stay pinned in the repository. Native tools that cannot
reasonably be vendored remain machine prerequisites; bootstrap checks or installs them through the
host package manager with approval. It never silently changes a global default account, cloud
project, or unrelated tool configuration.

Bootstrap may create or update files explicitly owned by the setup system, but it does not patch
arbitrary application source to conceal a repository defect. If a tracked build configuration
filters a required environment variable or a required script is broken, the bootstrap conformance
check names that source defect and fails until the repository is repaired.

## Version control and repository policy

Bootstrap owns the repository's version-control readiness as part of local setup. A working app in
a Git checkout with broken hooks, the wrong remote, or an unusable commit policy is not fully
bootstrapped.

For an existing checkout, bootstrap:

- verifies Git is installed and understands whether it is in a normal checkout, submodule,
  worktree, or detached state
- verifies the canonical remote, remote HEAD, default branch, upstream tracking, and repository
  ownership without changing them silently
- checks the effective author name and email and explains whether they come from system, global,
  or repository-local configuration
- offers repository-local identity configuration when identity is missing or inappropriate, while
  preserving an existing intentional identity and never rewriting global Git preferences without
  explicit approval
- installs or activates the repository-owned hook path after its required tooling exists
- detects a conflicting personal or global hook manager and presents a composable migration instead
  of quietly disabling either set of hooks
- verifies hook files are executable, portable, and invoke pinned repository-local tools
- confirms ignore rules exclude secrets, local bootstrap state, generated credentials, and build
  artifacts
- checks the repository's declared linear-history, signing, and protected-branch expectations and
  reports provider-side settings it cannot verify locally

For a new project that has not been placed under version control, bootstrap can initialize Git,
propose the initial ignore rules, and guide creation of the company-owned remote. Creating a remote
repository, changing a default branch, or publishing the first commit remains an explicit remote
action. Bootstrap never stages, commits, pushes, rewrites history, or changes repository settings
as an incidental side effect of local setup.

Hypertext Studio repositories use Conventional Commits. The organization-wide baseline defines
the allowed commit types and message-shape rules; each repository owns a small canonical scope
declaration such as `COMMIT_SCOPES.txt`. Bootstrap discovers existing product and domain language
from repository structure and commit history, proposes missing scopes for review, and validates
that hooks and CI read the canonical declaration rather than duplicate it in several tools.

At minimum, repository-owned hooks cover:

- commit-message validation against the Conventional Commit and scope policy
- credential and accidental-secret checks before a commit is accepted
- the repository's proportionate formatting, linting, and generated-file checks
- pre-push validation appropriate to the project's cost and release risk

The hook dispatcher and policy remain language-neutral even when the checks underneath use pnpm,
Python, Cargo, Gradle, Swift, or another project tool. Running bootstrap again compares the
effective Git configuration and hook content before changing anything; an already-correct checkout
produces no version-control mutation.

## Production setup contract

Production setup is explicit. It begins with a plan and confirmation of the exact accounts and
projects bootstrap will touch.

The flow can:

- create or reconcile provider projects, service identities, least-privilege permissions, secret
  stores, databases, deployment targets, DNS, and CI configuration
- generate safe values and derive canonical URLs where possible
- guide OAuth applications, billing products, webhooks, sending domains, signing identities, app
  stores, and other provider-owned setup
- apply migrations and deploy a validated artifact
- verify public endpoints, DNS, TLS, callbacks, authentication, persistence, and essential product
  journeys

Secrets move directly from a masked prompt or provider response to their intended secret store.
They are not written to bootstrap state, ordinary logs, shell history, documentation, or a tracked
environment file. Output redaction applies to both known values and recognizable credential
shapes.

Bootstrap does not call a deployment ready while a required capability is skipped. Optional,
locally emulated, production-required, and externally blocked capabilities are reported
separately. Provider approval, billing activation, domain ownership, hardware-backed signing, and
similar gates remain human responsibilities, but bootstrap explains them precisely and resumes
after they are satisfied.

## Docket as the reference application

For Docket, `./bootstrap` should recognize the pnpm/Turbo monorepo, web and admin applications,
Hono API, local database, mail capture, Portless routing, background work, and passkey support.

Its local success state includes:

- canonical `docket.localhost`, API, and admin origins
- valid local configuration with safe values for every required control
- generated secrets that remain stable on rerun
- an applied database schema and healthy services
- a completed passkey registration, sign-out, sign-in, and session-restoration ceremony
- creation, update, refresh, and persistence of a verification task through the real application
  path

Its production flow recognizes and reconciles GitHub, Neon, GCP/Cloud Run, Vercel, Cloudflare DNS,
transactional email, OAuth providers, billing, observability, and enabled integrations. It verifies
the live custom domains, WebAuthn relying-party configuration, account creation, sign-in, session
restoration, task persistence, and required callbacks.

A second successful Docket run does not rotate secrets, recreate cloud resources, rerun applied
migrations, or redeploy an already-verified artifact.

Docket already ships the convergence half of this contract as `pnpm doctor` (`scripts/doctor.ts`),
which reports where a linked project has drifted from what `scripts/bootstrap.ts` provisions. The
`./bootstrap` entrypoint absorbs that report as its steady-state check rather than replacing it.

## Failure and recovery

Failures must identify the failed step, the observed evidence, what remains safe and usable, and
the smallest recovery action. Provider exception text and secret material are never shown directly
to an end user.

Bootstrap distinguishes at least these outcomes:

- converged and verified
- changes required but not authorized
- authentication or account selection required
- ambiguous project detection
- transient tool or provider failure
- permanent invalid configuration
- externally blocked capability
- verification failure after an apparent successful change

A failure in an optional integration does not erase a working local core, but production is not
reported complete when a required capability remains blocked. Rerunning after a failure begins by
observing current state, so work that succeeded before the interruption is retained.

## Conformance and enforcement

Every Hypertext Studio repository must pass a shared bootstrap conformance workflow. At minimum it
proves:

- the executable root launcher exists and uses a supported engine version
- a clean checkout bootstraps on supported macOS and Linux environments
- local verification proves the repository's primary usable outcome
- a second reconciliation run produces no persistent mutations
- interruption followed by rerun converges safely
- representative drift is repaired without unrelated change
- secrets and credential-shaped values never appear in logs or state
- non-interactive mode never waits for input
- ambiguous or missing prerequisites fail with actionable guidance
- production planning is non-mutating and identifies the exact target accounts
- version-control identity, remotes, hooks, commit scopes, and history policy are usable and
  consistent with the repository declaration

New repositories begin from a company template that already includes the launcher, README setup
language, and conformance workflow. Automated updates propose new pinned engine versions. A missing,
stale, or failing bootstrap blocks the repository's normal release path.

## Non-goals

Repo Bootstrap is not:

- a replacement for each language's package manager or build system
- a new general-purpose infrastructure-as-code language
- a large required project manifest
- a plugin SDK every application must implement
- permission to mutate provider accounts without explicit production authorization
- a promise to bypass provider approval, billing, signing, or ownership requirements
- a mechanism for silently repairing tracked application code
- native Windows support in the first contract; Windows development uses WSL until adopted

## Initial rollout

1. Make Docket the reference implementation and repair its current local, authentication,
   configuration, deployment, and documentation gaps against this contract.
2. Apply the same contract to the Hypertext Studio website and use the differences to separate
   shared recognition from application-specific behavior.
3. Stabilize the portable engine, launcher pinning, human and JSON output, and conformance suite.
4. Adopt the contract in LogDate, Curfew, native/mobile repositories, and every new Hypertext Studio
   repository.
5. Keep improving shared recognition whenever more than a few repository hints or custom steps are
   needed.

## Implementation choices still to settle

The rough spec intentionally leaves these implementation details open for the plan:

- the portable engine's implementation language and signed release channel
- the exact contents and update policy of the checked-in launcher
- the smallest stable JSON event and exit-status vocabulary
- the supported macOS and Linux distribution matrix for the first release
- where local non-secret recovery state and locks live
- how provider guidance is tested and refreshed as provider consoles change
- whether product-level orchestration across multiple repositories belongs in this tool or in a
  separate product workspace

Those choices may change without weakening the required `./bootstrap` entrypoint, convention-first
discovery, interactive guidance, or idempotence guarantees defined above.

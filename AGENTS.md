# AGENTS.md - Project Athena Agent Guidelines

> **Version**: 2.2.1
> **Last Updated**: 2026-09-01
> **Applies To**: All AI coding agents working on Project Athena

This document defines the operational framework for AI agents contributing to Project Athena. All agents MUST adhere to these guidelines to ensure consistent, high-quality, autonomous development.

---

## Table of Contents

1. [Workflow](#workflow)
2. [Documentation Requirements](#documentation-requirements)
3. [Version Control Protocol](#version-control-protocol)
4. [Billed Resource Policy](#billed-resource-policy)
5. [Work Tracking System](#work-tracking-system)
6. [Platform Best Practices](#platform-best-practices)
7. [Task Completion Standards](#task-completion-standards)
8. [Reusable Tooling](#reusable-tooling)
9. [Self-Modification Protocol](#self-modification-protocol)
10. [Research Requirements](#research-requirements)
11. [Planning Protocol](#planning-protocol)
12. [Retrospection Requirements](#retrospection-requirements)
13. [Self-Validation Protocol](#self-validation-protocol)

---

## Workflow

For any non-trivial task, move through these states in order — skip PLANNING/RESEARCHING only for
genuinely trivial changes (a typo fix, a one-line rename):

IDLE → PLANNING → RESEARCHING (or CLARIFYING, if blocked) → IMPLEMENTING → VALIDATING →
DOCUMENTING → COMMITTING → RETROSPECTING → IDLE

| State         | Exit criteria                                                      |
| ------------- | ------------------------------------------------------------------ |
| IDLE          | Task received                                                      |
| PLANNING      | Plan documented in `docs/WORKLOG.md`                               |
| RESEARCHING   | Sufficient context obtained                                        |
| CLARIFYING    | User response received; returns to whichever state triggered it    |
| IMPLEMENTING  | All code changes complete                                          |
| VALIDATING    | All checks pass — a failure returns to IMPLEMENTING, never past it |
| DOCUMENTING   | Docs reflect the change                                            |
| COMMITTING    | Changes committed                                                  |
| RETROSPECTING | `docs/WORKLOG.md` entry complete                                   |

---

## Documentation Requirements

### Mandatory Documentation

Every significant piece of work MUST include:

1. Code comments (TSDoc format) on all exported functions, classes, and types; on complex or
   non-obvious logic; and cross-references to related code
2. A `docs/WORKLOG.md` entry covering the task description, approach taken, files modified, and
   decisions made
3. README updates when the change adds a feature, changes an API or interface, or changes setup
   instructions

### Documentation Standards

Document every exported function, class, and type with TSDoc: a one-line summary, `@param`/`@returns`
for anything not obvious from the signature, and `@throws` when a call can throw. Skip `@example` and
`@remarks` blocks that just restate the code below them.

### Documentation Locations

| Type                 | Location                          |
| -------------------- | --------------------------------- |
| Product specs        | `docs/core/`                      |
| Engineering specs    | `docs/engineering/`               |
| API documentation    | Auto-generated via Scalar/OpenAPI |
| Work history         | `docs/WORKLOG.md`                 |
| Agent guidelines     | `AGENTS.md` (this file)           |
| Repo-specific config | `.claude/`                        |
| Scripts              | `scripts/`                        |
| Shared packages      | `packages/`                       |

---

## Version Control Protocol

### Commit Convention

All commits MUST follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

A plain-language explanation of the change, its motivation, and any important
implementation or operational context. Use Markdown sections when they make a
longer explanation easier to scan.

[optional footer(s)]
```

**Types:**

- `feat`: A new product capability or meaningful extension to an existing feature
- `fix`: A correction to broken or incorrect behavior
- `chore`: Repository maintenance that does not change product behavior

These are the only authored commit types. Documentation, tests, refactors, styles, build changes,
CI changes, and performance work belong in the `feat` or `fix` commit for the product slice they
support. Use `chore` when that work is standalone maintenance.

Every normal commit requires a substantive body with at least 100 non-comment characters. Bodies
must use plain language rather than a mandatory template. Explain what changed and why it belongs
in the feature-oriented slice; use larger Markdown sections only when they improve readability.

Every commit created from a recognized agent environment requires a `Co-authored-by` trailer. The
validator detects Codex, Claude Code, Cursor Agent, GitHub Copilot Agent, or the explicit
`DOCKET_COMMIT_AGENT` marker. Human terminal commits do not require an agent trailer.

**Scopes:**

The scope names the product or domain area a change lands in. There is no commitlint config; the
declaration is [`COMMIT_SCOPES.txt`](COMMIT_SCOPES.txt) at the repository root, which
`scripts/validate-commit-message.mjs` reads and the `commit-msg` hook enforces. Do not restate the
list here — a second copy is a copy that goes stale, and the hook will reject anything that
disagrees with the file.

A scope is a product or domain area, **not a workspace directory**. `design` covers brand and
visual work wherever it lives; `web` covers the product app. There is deliberately no scope per
`packages/*` entry.

Omit the scope only when a change touches the whole repository. If a change genuinely needs a
scope the file does not have, add the line to `COMMIT_SCOPES.txt` in the same commit rather than
coining one silently.

**Examples:**

```
feat(auth): Add Google account linking

Connect authenticated users to Google Calendar through the existing integrations surface. The
same feature slice includes its provider adapter, tests, setup documentation, and deployment
configuration so the capability can be shipped and reviewed as one unit.

fix(calendar): Resolve timezone offsets in event display

Preserve the source calendar timezone while normalizing event boundaries. This prevents imported
events from shifting when the viewer and connected Google account use different timezones.
```

### Commit Frequency

Commit atomically: one logical change per commit, frequent and small rather than one large drop.
Never commit code that fails validation.

### Branch Strategy

```
main
  └── feature/<ticket-id>-<description>
  └── fix/<ticket-id>-<description>
  └── chore/<description>
```

Development is feature-oriented. A branch and its commits should deliver one coherent product
slice, including the implementation, tests, documentation, migrations, and operational changes
needed to ship it. Do not split supporting work into process-oriented branches or commits.

### Pull Request Policy

**Agents MUST NOT open, create, draft, update, review, merge, or depend on GitHub pull requests in
this repository.** The repository setting `has_pull_requests` MUST remain disabled. An agent MUST
NOT change that setting or any other GitHub setting to make pull requests available.

Agents work in dedicated worktrees or feature branches, validate and commit there, then integrate
the finished commits directly into `main` with linear history. Use `git rebase`, `git cherry-pick`,
or `git merge --ff-only`. Push `main` only after the required checks pass. Do not create a temporary
pull request for review, CI, deployment, or evidence. Use local review and the direct-push checks
instead.

Only the user may suspend this policy. The user must explicitly direct the agent to use a pull
request in the current task and must explicitly authorize reenabling the repository setting. A
generic instruction to review, ship, merge, or deploy does not authorize a pull request.

### Stripe Provider Policy

**Stripe belongs exclusively to Hypertext Studio.** Agents MUST use only the Hypertext Studio
Stripe account for Docket configuration, testing, evidence, reconciliation, canaries, and live
payments. Evidence from any other Stripe account is invalid and MUST NOT satisfy a launch gate.

Agents MUST perform Stripe browser work only in the dedicated Hypertext Studio Chrome instance.
Agents MUST NOT use, inspect, or modify Stripe through the user's personal Chrome instance. If the
Hypertext Studio Chrome instance is unavailable or its Stripe account identity cannot be verified,
the agent must stop the provider operation and keep Checkout disabled.

Agents MUST NOT copy or auto-load Stripe credentials from a global or personal Stripe CLI profile.
Any automated provider operation must verify the configured Hypertext Studio Stripe account before
it reads or mutates provider state.

### Linear History Requirement

**Merge commits are forbidden. `main` MUST have linear history only.**

Required behavior:

1. Use `git merge --ff-only`, `git rebase`, or `git cherry-pick`
2. Never run plain `git merge` into `main`
3. Never use `git merge --no-ff`
4. If a merge commit is created locally, immediately remove it with `git reset --hard <first-parent-before-merge>` and replay the intended commits with `git cherry-pick`
5. Before declaring work landed, verify `git rev-list --merges --count origin/main..HEAD` prints `0`

### Commit Policy

**AUTO-COMMIT ENABLED** - Commits are made automatically after completing tasks.

Commit behavior:

1. Commit atomically after each completed task
2. Use only `feat`, `fix`, or `chore` Conventional Commit types
3. Include a substantive plain-language body for every normal commit
4. No user approval required (project override)

---

## Billed Resource Policy

Hosted runner time is a finite production resource. Agents MUST validate locally, commit as often as
the change requires, and make **one push per coherent delivery** after the local release checks pass.
Do not push intermediate diagnostic commits or push each atomic commit separately.

Never push merely to use hosted CI as a debugger. Reproduce failures with the repository's local
commands first, inspect active runs before starting another, and rerun only the failed job at the same
SHA when the failure is transient or provider-side. A new push is justified only by a source change.

New or expanded workflows MUST document their trigger multiplier, expected runner footprint, and why
the signal belongs on every push. Prefer cancellable validation, targeted changed-slice checks, and
manual dispatch for expensive advisory suites. Production deployment remains serialized and
non-cancellable, but it MUST be isolated from validation so that safety does not force stale checks to
consume billed minutes.

---

## Work Tracking System

### WORKLOG.md Structure

All work MUST be tracked in `docs/WORKLOG.md`. The base shape for every task:

```markdown
# Project Athena Work Log

## Active Tasks

### [TASK-ID] Task Title

- **Status**: IN_PROGRESS | BLOCKED | REVIEW
- **Started**: YYYY-MM-DD
- **Priority**: P0 | P1 | P2 | P3
- **Description**: What needs to be done
- **Subtasks**:
  - [ ] Subtask 1
  - [x] Subtask 2 (completed)
- **Blockers**: Any blocking issues
- **Notes**: Implementation notes

---

## Completed Tasks

### [TASK-ID] Task Title

- **Completed**: YYYY-MM-DD
- **Summary**: What was accomplished
- **Files Changed**: List of modified files
- **Learnings**: What was learned
```

For substantial tasks, add sections as needed rather than forcing everything into **Notes** — recent
entries in `docs/WORKLOG.md` use **Files changed**, **Validation**, **Learnings**, and **Blockers for
launch** as their own subsections. Read a recent entry there before writing a large one; it's the
canonical example, not this template.

Tasks move `backlog` → `active (in_progress)` → `active (review)` → `completed`, with `blocked` as a
detour back to `in_progress` once unblocked.

### Work Tracking Rules

1. **Create task entry BEFORE starting work**
2. **Update status immediately** when state changes
3. **Document blockers explicitly** with details
4. **Move to COMPLETED only after validation**
5. **Include learnings** for future reference

---

## Platform Best Practices

### TypeScript Standards

- **Strict mode enabled** - No `any` types without justification
- **Explicit return types** for public functions
- **Prefer `unknown` over `any`** for truly unknown types
- **Use branded types** for domain identifiers

### Hono Backend Patterns

- **Zod for all validation** - Input AND output
- **OpenAPI annotations** for all routes
- **Middleware composition** for cross-cutting concerns
- **Error handling via Hono's error handler**

### Next.js Frontend Patterns

- **Server Components by default** - Client only when needed
- **Server Actions for mutations** - Type-safe form handling
- **App Router conventions** - Layouts, loading, error boundaries
- **shadcn/ui components** - Accessible, customizable
- **Data fetching** - All reads/writes go through the typed TanStack Query layer in `apps/web/src/lib/query.ts` (`apiQueryOptions` + def-only `useApiQuery`/`useApiListQuery`/`useLiveApiQuery`/`useApiMutation`); never hand-roll `useEffect`+`fetch` or call `api.v1.*` in a component. See **`docs/engineering/specs/data-layer.md`**.
- **Error handling** - UI copy must be application-owned. Never render exception/provider text or Problem `title`/`detail`; use `UserFacingError` helpers and branch only on error type, HTTP status, or stable Problem code. The source-policy test enforces this across web and admin production code.
- **UI ownership** - Search `@docket/ui` before building UI infrastructure. Do not implement a dialog, menu, popover, sheet, tooltip, hover card, banner, card, or resting surface with manual Tailwind or custom CSS when a shared component or typed variant exists. Extend a domain-neutral primitive when the required presentation is missing, and add behavior coverage for that primitive. Product tests cover what a person can do. ESLint owns AST policy through `@docket/eslint-config`; do not add source-reading product tests to enforce component ownership.

### Database Patterns (Drizzle)

- **Migrations for all schema changes**
- **Typed queries only** - No raw SQL without types
- **Connection pooling** for production
- **Row-level security** for multi-tenancy

### Testing Requirements

- **Minimum 80% coverage** for all packages
- **Unit tests** for business logic
- **Integration tests** for API endpoints
- **E2E tests** for critical user journeys

---

## Task Completion Standards

### Definition of Done

A task is ONLY complete when:

- [ ] Code implements all requirements
- [ ] Tests cover the happy path and edge cases, and pass (unit, integration, E2E)
- [ ] `tsc --noEmit` succeeds and ESLint is clean
- [ ] Error handling is complete and no security vulnerabilities were introduced
- [ ] Performance and accessibility requirements are met
- [ ] Documentation is updated (TSDoc, README if needed)
- [ ] `docs/WORKLOG.md` is updated
- [ ] Code has been self-reviewed or peer reviewed

### NO Stubs or TODOs

**CRITICAL**: Agents MUST NOT leave incomplete work:

- **NO `// TODO:` comments** in committed code
- **NO stub implementations** (`throw new Error('Not implemented')`)
- **NO skipped tests** (`it.skip()`, `describe.skip()`)
- **NO placeholder content** without implementation plan
- **NO new entries in `complexity-debt.json`**. That ledger records complexity that predates the
  gate; it may only shrink. A complexity, cognitive-complexity, depth, or parameter-count failure in
  code you wrote is refactored, never granted an exemption. Note the ledger pins a _file_, not a
  function: a new over-complex function inside an already-ledgered file needs no new entry and so
  this rule cannot catch it. See `docs/engineering/complexity-ratchet.md`.

If a task cannot be completed:

1. Document the blocker in WORKLOG.md
2. Create explicit subtask for the remaining work
3. Notify user with specific details
4. Move to next actionable task

### Persistence Requirements

When encountering obstacles:

1. **Try at least 3 different approaches** before escalating
2. **Research solutions** via web search or documentation
3. **Examine similar code** in the codebase
4. **Document failed approaches** in WORKLOG.md
5. **Only escalate to user** with specific, actionable questions

---

## Reusable Tooling

### Creating Reusable Tools

Agents SHOULD create reusable utilities when:

- A pattern is used **3 or more times**
- A workflow is executed **repeatedly**
- A complex operation can be **abstracted**

### Tool Locations

| Type             | Location               | Purpose                    |
| ---------------- | ---------------------- | -------------------------- |
| CLI scripts      | `scripts/`             | Build, deploy, maintenance |
| Shared utilities | `packages/shared/`     | Cross-package code         |
| Domain contracts | `domains/`             | Portable business types    |
| Test utilities   | `packages/test-utils/` | Testing helpers            |

### Claude Code Skills

Create skills in `.claude/skills/` for repeated workflows:

```markdown
# Skill: run-tests

Run all tests with coverage report.

## Invocation

/run-tests [package-name]

## Actions

1. Run vitest with coverage
2. Check coverage threshold (80%)
3. Report failures with context
```

### Hook Automation

Create hooks in `.claude/hooks/` for automatic triggers:

- **pre-commit**: Lint, type-check, test affected
- **post-implement**: Update WORKLOG.md
- **pre-push**: Full test suite

---

## Self-Modification Protocol

### AGENTS.md Updates

This file SHOULD be updated when:

- New patterns or standards emerge
- Technology decisions change
- Workflows are refined
- Learnings warrant documentation

### Update Process

1. Propose change with rationale
2. Document in WORKLOG.md
3. Make atomic, focused changes
4. Increment version number
5. Update "Last Updated" date

### Protected Sections

These sections MUST NOT be weakened:

- Task Completion Standards
- NO Stubs or TODOs

---

## Research Requirements

### When to Research

Research is REQUIRED when:

- **Unfamiliar technology** is encountered
- **Multiple approaches** exist for a problem
- **Best practices** are unclear
- **Security implications** are possible
- **Performance considerations** apply

### Research Methods

1. **Codebase exploration** - Find existing patterns
2. **Documentation review** - Official docs first
3. **Web search** - Recent, authoritative sources
4. **API documentation** - For external services

### Research Documentation

Document research findings in:

- `docs/research/` for significant explorations
- WORKLOG.md task notes for task-specific research
- Code comments for implementation decisions

---

## Planning Protocol

### Mandatory Planning

Enter planning mode for:

- **New features** - Any non-trivial functionality
- **Architecture changes** - System structure modifications
- **Multi-file changes** - Cross-cutting implementations
- **Unknown scope** - Tasks requiring investigation

### Plan Structure

```markdown
## Plan: [Task Title]

### Objective

What we're trying to accomplish

### Approach

How we'll accomplish it

### Steps

1. Step 1 description
2. Step 2 description
3. ...

### Files to Modify

- `path/to/file.ts` - What changes

### Risks

- Potential issue 1
- Potential issue 2

### Validation

How we'll verify success
```

### Plan Approval

For significant changes:

1. Write plan to WORKLOG.md
2. Present plan to user
3. Await explicit approval
4. Begin implementation

---

## Retrospection Requirements

### Post-Task Retrospection

After completing each significant task:

1. **What went well?** - Successful approaches
2. **What could improve?** - Areas for enhancement
3. **What was learned?** - New knowledge gained
4. **What should change?** - Process improvements

### Documentation

Record retrospections in:

- WORKLOG.md task completion entry
- AGENTS.md if process changes warranted
- `docs/research/` if significant learnings

### Periodic Review

Agents SHOULD periodically review:

- Recent WORKLOG.md entries
- Common patterns across tasks
- Recurring blockers or issues

---

## Self-Validation Protocol

### Running the app to verify UI

**Read [`docs/engineering/ui-verification.md`](docs/engineering/ui-verification.md) BEFORE starting a
dev server from a worktree.** It is the whole procedure: `scripts/dev-stack.sh start` brings the
stack up in the CI topology, `apps/web/e2e/tools/dev-session.ts` performs the passkey ceremony
headlessly and persists an authenticated session, and `apps/web/e2e/tools/capture-shots.ts` takes the
standard shot set with an overflow check.

All three already exist. Do **not** build a parallel dev stack, launch-config entry, sign-in flow, or
screenshot script — every environment problem that motivates one (portless TLS failures, stale
`docket.localhost` aliases, `dotenv-cli` override precedence, the shared PGlite database, cold-route
timeouts) is documented there with its fix. A second path is a second thing to keep correct.

A fresh session is an empty account; seed through the API before claiming a surface was verified, and
run `pnpm db:reset` afterwards because the dev database is the same file the API test suite reads.

### Pre-Commit Validation

Before any commit, verify:

```bash
# Type checking
pnpm typecheck

# Linting
pnpm lint

# Tests
pnpm test

# Build
pnpm build
```

### Documentation Validation

Verify documentation by:

1. **Reading generated docs** - Ensure accuracy
2. **Testing code examples** - Verify they work
3. **Cross-referencing** - Check links are valid
4. **Completeness check** - All exports documented

### Specification Compliance

Validate against specifications:

1. **Read relevant spec** in `docs/core/`
2. **Check implementation** matches spec
3. **Verify edge cases** from user stories
4. **Test user journeys** end-to-end

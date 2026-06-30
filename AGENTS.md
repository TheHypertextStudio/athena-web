# AGENTS.md - Project Athena Agent Guidelines

> **Version**: 1.0.1
> **Last Updated**: 2026-06-30
> **Applies To**: All AI coding agents working on Project Athena

This document defines the operational framework for AI agents contributing to Project Athena. All agents MUST adhere to these guidelines to ensure consistent, high-quality, autonomous development.

---

## Table of Contents

1. [Agent State Machine](#agent-state-machine)
2. [Documentation Requirements](#documentation-requirements)
3. [Version Control Protocol](#version-control-protocol)
4. [Work Tracking System](#work-tracking-system)
5. [Platform Best Practices](#platform-best-practices)
6. [Task Completion Standards](#task-completion-standards)
7. [Reusable Tooling](#reusable-tooling)
8. [Self-Modification Protocol](#self-modification-protocol)
9. [Research Requirements](#research-requirements)
10. [Planning Protocol](#planning-protocol)
11. [Retrospection Requirements](#retrospection-requirements)
12. [Self-Validation Protocol](#self-validation-protocol)

---

## Agent State Machine

Agents operate in a defined state machine to ensure predictable, autonomous behavior. The agent MUST always be in exactly one of these states:

```
┌─────────────┐
│   IDLE      │◄────────────────────────────────────────┐
└──────┬──────┘                                         │
       │ receive task                                   │
       ▼                                                │
┌─────────────┐                                         │
│  PLANNING   │◄──────────────────────┐                 │
└──────┬──────┘                       │                 │
       │ plan approved                │ need more info  │
       ▼                              │                 │
┌─────────────┐    blocked     ┌──────┴──────┐          │
│ RESEARCHING │───────────────►│  CLARIFYING │          │
└──────┬──────┘                └─────────────┘          │
       │ research complete                              │
       ▼                                                │
┌─────────────┐                                         │
│ IMPLEMENTING│◄──────────────────────┐                 │
└──────┬──────┘                       │                 │
       │ implementation complete      │ tests fail     │
       ▼                              │                 │
┌─────────────┐                       │                 │
│  VALIDATING │───────────────────────┘                 │
└──────┬──────┘                                         │
       │ validation passed                              │
       ▼                                                │
┌─────────────┐                                         │
│ DOCUMENTING │                                         │
└──────┬──────┘                                         │
       │ docs complete                                  │
       ▼                                                │
┌─────────────┐                                         │
│ COMMITTING  │                                         │
└──────┬──────┘                                         │
       │ changes committed                              │
       ▼                                                │
┌─────────────┐                                         │
│RETROSPECTING│─────────────────────────────────────────┘
└─────────────┘
```

### State Definitions

| State             | Description                                         | Exit Criteria                 |
| ----------------- | --------------------------------------------------- | ----------------------------- |
| **IDLE**          | Awaiting new task or user input                     | Task received                 |
| **PLANNING**      | Analyzing requirements, breaking down work          | Plan documented in WORKLOG.md |
| **RESEARCHING**   | Gathering information, reading code, web searches   | Sufficient context obtained   |
| **CLARIFYING**    | Awaiting user input for ambiguous requirements      | User response received        |
| **IMPLEMENTING**  | Writing code, creating files, making changes        | All code changes complete     |
| **VALIDATING**    | Running tests, linting, type-checking               | All validations pass          |
| **DOCUMENTING**   | Writing/updating documentation                      | Docs reflect changes          |
| **COMMITTING**    | Staging and committing changes (with user approval) | Changes committed             |
| **RETROSPECTING** | Reviewing work, updating WORKLOG.md                 | Entry complete                |

### State Transition Rules

1. **NEVER skip states** - Each state serves a purpose
2. **Always enter PLANNING before IMPLEMENTING** for non-trivial tasks
3. **VALIDATING failures return to IMPLEMENTING** - Fix issues, don't ignore them
4. **CLARIFYING returns to the previous state** once resolved
5. **Document state transitions** in WORKLOG.md for complex tasks

---

## Documentation Requirements

### Mandatory Documentation

Every significant piece of work MUST include:

1. **Code Comments** (TSDoc format)
   - All exported functions, classes, and types
   - Complex algorithms or non-obvious logic
   - Cross-references to related code

2. **WORKLOG.md Updates**
   - Task description
   - Approach taken
   - Files modified
   - Decisions made

3. **README Updates** (when applicable)
   - New features or capabilities
   - Changed APIs or interfaces
   - Updated setup instructions

### Documentation Standards

````typescript
/**
 * Brief description of what this does.
 *
 * @remarks
 * Additional context, usage notes, or implementation details.
 *
 * @param paramName - Description of parameter
 * @returns Description of return value
 *
 * @example
 * ```typescript
 * const result = myFunction('input');
 * ``
 *
 * @see {@link RelatedFunction} for related functionality
 * @throws {ErrorType} When this error condition occurs
 */
````

### Documentation Locations

| Type                 | Location                          |
| -------------------- | --------------------------------- |
| Product specs        | `docs/core/`                      |
| Engineering specs    | `docs/engineering/`               |
| API documentation    | Auto-generated via Scalar/OpenAPI |
| Work history         | `docs/WORKLOG.md`                 |
| Agent guidelines     | `AGENTS.md` (this file)           |
| Repo-specific config | `.claude/`                        |

---

## Version Control Protocol

### Commit Convention

All commits MUST follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting, no code change
- `refactor`: Code restructuring
- `perf`: Performance improvement
- `test`: Adding/fixing tests
- `chore`: Maintenance tasks
- `ci`: CI/CD changes

**Examples:**

```
feat(api): add user authentication endpoints
fix(calendar): resolve timezone offset calculation
docs(readme): update installation instructions
refactor(tasks): extract validation into shared utility
```

### Commit Frequency

- **Commit atomically** - One logical change per commit
- **Commit frequently** - Small, focused commits
- **Never commit broken code** - All commits must pass validation

### Branch Strategy

```
main
  └── feature/<ticket-id>-<description>
  └── fix/<ticket-id>-<description>
  └── docs/<description>
  └── refactor/<description>
```

### Linear History Requirement

**Merge commits are forbidden. `main` MUST have linear history only.**

Required behavior:

1. Use `git merge --ff-only`, `git rebase`, or `git cherry-pick`
2. Never run plain `git merge` into `main`
3. Never use `git merge --no-ff`
4. If a merge commit is created locally, immediately remove it with `git reset --hard <first-parent-before-merge>` and replay the intended commits with `git cherry-pick`
5. Before declaring work landed, verify `git rev-list --merges --count origin/main..HEAD` prints `0`

Repository enforcement:

- GitHub branch protection for `main` requires linear history
- Local config should keep `pull.ff=only`, `pull.rebase=true`, `branch.main.rebase=true`, and `branch.main.mergeOptions=--ff-only`
- Local hooks may reject merge commits via `pre-merge-commit` and `prepare-commit-msg`

### Commit Policy

**AUTO-COMMIT ENABLED** - Commits are made automatically after completing tasks.

Commit behavior:

1. Commit atomically after each completed task
2. Use Conventional Commits format
3. Include meaningful descriptions
4. No user approval required (project override)

---

## Work Tracking System

### WORKLOG.md Structure

All work MUST be tracked in `docs/WORKLOG.md`:

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
- **Duration**: X hours/days
- **Summary**: What was accomplished
- **Files Changed**: List of modified files
- **Learnings**: What was learned

---

## Backlog

### [TASK-ID] Task Title

- **Priority**: P0 | P1 | P2 | P3
- **Description**: Brief description
- **Dependencies**: Required prior work
```

### Task Lifecycle

```
BACKLOG → ACTIVE (IN_PROGRESS) → ACTIVE (REVIEW) → COMPLETED
                ↓
            ACTIVE (BLOCKED) → ACTIVE (IN_PROGRESS)
```

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

1. **Code is implemented** - All functionality works
2. **Tests pass** - Unit, integration, and E2E
3. **Types check** - `tsc --noEmit` succeeds
4. **Linting passes** - No ESLint errors
5. **Documentation updated** - TSDoc, README if needed
6. **WORKLOG.md updated** - Task marked complete
7. **Code reviewed** - Self-review or peer review

### NO Stubs or TODOs

**CRITICAL**: Agents MUST NOT leave incomplete work:

- **NO `// TODO:` comments** in committed code
- **NO stub implementations** (`throw new Error('Not implemented')`)
- **NO skipped tests** (`it.skip()`, `describe.skip()`)
- **NO placeholder content** without implementation plan

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
| Type definitions | `packages/types/`      | Shared TypeScript types    |
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
- Commit Approval requirement

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

### Self-Review Checklist

Before considering work complete:

- [ ] Code implements all requirements
- [ ] Tests cover happy path AND edge cases
- [ ] Error handling is comprehensive
- [ ] Documentation is complete and accurate
- [ ] No security vulnerabilities introduced
- [ ] Performance is acceptable
- [ ] Accessibility requirements met
- [ ] WORKLOG.md is updated

---

## Quick Reference

### State Commands

| Current State | Action            | Next State    |
| ------------- | ----------------- | ------------- |
| IDLE          | Receive task      | PLANNING      |
| PLANNING      | Plan complete     | RESEARCHING   |
| RESEARCHING   | Research complete | IMPLEMENTING  |
| IMPLEMENTING  | Code complete     | VALIDATING    |
| VALIDATING    | Tests pass        | DOCUMENTING   |
| DOCUMENTING   | Docs complete     | COMMITTING    |
| COMMITTING    | Committed         | RETROSPECTING |
| RETROSPECTING | Complete          | IDLE          |

### File Locations

| Purpose           | Path                |
| ----------------- | ------------------- |
| Agent guidelines  | `AGENTS.md`         |
| Work tracking     | `docs/WORKLOG.md`   |
| Product specs     | `docs/core/`        |
| Engineering specs | `docs/engineering/` |
| Research notes    | `docs/research/`    |
| Claude config     | `.claude/`          |
| Scripts           | `scripts/`          |
| Shared packages   | `packages/`         |

---

_This document is self-governing. Agents are encouraged to propose improvements through the established modification protocol._

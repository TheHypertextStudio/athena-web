# Project Athena Agent Rules

> **Version**: 2.0.0
> **Last Updated**: 2026-01-11

Direct, actionable rules for AI agents working on this codebase.

---

## Quick Reference

### Commands

| Action           | Command          | Run from   |
| ---------------- | ---------------- | ---------- |
| Install deps     | `pnpm install`   | repo root  |
| Build API        | `pnpm build`     | `apps/api` |
| Build Web        | `pnpm build`     | `apps/web` |
| Type check       | `pnpm typecheck` | repo root  |
| Lint             | `pnpm lint`      | repo root  |
| Test             | `pnpm test`      | repo root  |
| Dev server (API) | `pnpm dev`       | `apps/api` |
| Dev server (Web) | `pnpm dev`       | `apps/web` |

### File Locations

| What                | Where                              |
| ------------------- | ---------------------------------- |
| API routes          | `apps/api/src/routes/*.ts`         |
| DB schema           | `apps/api/src/db/schema/*.ts`      |
| DB migrations       | `apps/api/drizzle/*.sql`           |
| Frontend pages      | `apps/web/src/app/**/*.tsx`        |
| Frontend components | `apps/web/src/components/**/*.tsx` |
| Shared types        | `packages/types/src/**/*.ts`       |
| Work tracking       | `docs/WORKLOG.md`                  |
| Product specs       | `docs/core/`                       |
| Engineering specs   | `docs/engineering/`                |

---

## 1. Task Workflow

```
┌──────────┐     ┌────────────┐     ┌──────────────┐     ┌────────────┐     ┌──────────┐
│  IDLE    │────►│  PLANNING  │────►│ IMPLEMENTING │────►│ VALIDATING │────►│ COMPLETE │
└──────────┘     └────────────┘     └──────────────┘     └────────────┘     └──────────┘
                       │                   ▲                    │
                       │                   └────────────────────┘
                       │                      (if tests fail)
                       ▼
                 ┌────────────┐
                 │ CLARIFYING │ (if blocked, ask user)
                 └────────────┘
```

### When you receive a task:

1. Read relevant code before modifying anything
2. Create entry in `docs/WORKLOG.md`:

   ```markdown
   ### [TASK-ID] Task Title

   - **Status**: IN_PROGRESS
   - **Started**: YYYY-MM-DD
   - **Description**: What needs to be done
   ```

3. If task is non-trivial (multi-file, new feature, architecture change):
   - Write a plan before coding
   - Get user approval on approach

### When you complete a task:

1. Run validation:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   ```
2. Fix any failures before proceeding
3. Update `docs/WORKLOG.md`:

   ```markdown
   ### [TASK-ID] Task Title

   - **Status**: COMPLETED
   - **Completed**: YYYY-MM-DD
   - **Summary**: What was accomplished
   - **Files Changed**: List of files
   ```

### When you are blocked:

1. Try at least 3 different approaches
2. Search the codebase for similar patterns
3. Check documentation in `docs/`
4. If still blocked: ask the user with specific questions

### When a task cannot be completed:

1. Document the blocker in WORKLOG.md
2. Create explicit subtask for remaining work
3. Notify user with specific details
4. Do NOT leave TODO comments or stub implementations

---

## 2. Database Changes

```
┌────────┐     ┌───────┐     ┌──────────┐     ┌────────┐     ┌───────┐     ┌──────┐
│ Modify │────►│ Build │────►│ Generate │────►│ Verify │────►│ Apply │────►│ Test │
│ Schema │     │  API  │     │Migration │     │  SQL   │     │ to DB │     │      │
└────────┘     └───────┘     └──────────┘     └────────┘     └───────┘     └──────┘
```

### When you modify `apps/api/src/db/schema/*.ts`:

1. **Build** (required - Drizzle reads from `dist/`, not `src/`):

   ```bash
   cd apps/api && pnpm build
   ```

2. **Generate migration**:

   ```bash
   pnpm drizzle-kit generate
   ```

3. **Verify the SQL** - read the new file in `apps/api/drizzle/`:
   - Confirm it only contains your intended changes
   - Watch for unintended DROP or ALTER statements

4. **Apply to database**:

   ```bash
   pnpm drizzle-kit push --strict=false --force
   ```

5. **Test** - start the API and confirm no schema errors:
   ```bash
   pnpm dev
   ```

### When you see "column X does not exist" errors:

1. You forgot to apply the migration
2. Run: `pnpm drizzle-kit push --strict=false --force`

### When migration is empty or wrong:

1. You forgot to build first
2. Run: `cd apps/api && pnpm build`
3. Then regenerate: `pnpm drizzle-kit generate`

---

## 3. API Development

### When you add a new endpoint:

1. Create route file in `apps/api/src/routes/`
2. Define Zod schemas for request/response validation
3. Add OpenAPI annotations using `@hono/zod-openapi`
4. Register route in `apps/api/src/index.ts`
5. Add tests in `apps/api/src/routes/*.test.ts`

### When you modify an existing endpoint:

1. Update Zod schemas if input/output changes
2. Update OpenAPI annotations
3. Run existing tests to ensure no regressions
4. Update tests if behavior changed

### API patterns to follow:

- Use `requireAuth` middleware for protected routes
- Return consistent error shapes via error handler
- Use typed responses (no `any`)

---

## 4. Frontend Development

### When you add a new page:

1. Create page in `apps/web/src/app/`
2. Use Server Components by default
3. Only add `"use client"` if you need:
   - Event handlers (onClick, onChange)
   - Browser APIs
   - useState/useEffect

### When you add a new component:

1. Create in `apps/web/src/components/`
2. Use shadcn/ui components as base
3. Add props interface with TypeScript
4. Export from component's index.ts

### When you modify existing components:

1. Check for usages before changing props
2. Update all call sites if interface changes
3. Test the component in the browser

---

## 5. Testing

### When you write tests:

1. Test files go next to source: `foo.ts` → `foo.test.ts`
2. Cover happy path AND edge cases
3. Use descriptive test names: "should X when Y"

### When tests fail:

1. Read the error message carefully
2. Fix the code, not the test (unless test is wrong)
3. Do NOT use `.skip()` to bypass failures
4. Re-run until all pass before proceeding

### Test commands:

```bash
pnpm test              # Run all tests
pnpm test -- --watch   # Watch mode
pnpm test -- foo.test  # Run specific test file
```

---

## 6. Version Control

### Commit message format:

```
<type>(<scope>): <description>
```

### Choosing the correct commit type:

**CRITICAL**: `feat` commits auto-generate changelogs. Only use `feat` for the **final enabler of new user-facing functionality**.

**Use `feat` ONLY when:**

- A user can do something new they couldn't do before
- The feature is complete and usable, not partially implemented
- You would announce this in release notes

**Use `chore` for almost everything else:**

- Internal refactoring
- Code cleanup
- Dependency updates
- Build/config changes
- Prep work for a feature (that isn't the feature itself)

### Examples - What is NOT a feature:

```
// BAD - These are NOT features
feat(ui): update button styles
feat(api): refactor endpoint for efficiency
feat(tasks): swap component composition
feat(auth): add helper function for token validation
feat(db): add index to improve query performance
feat(web): extract hook from component

// GOOD - Correct types for above
chore(ui): update button styles
refactor(api): improve endpoint efficiency
refactor(tasks): simplify component composition
chore(auth): add helper function for token validation
perf(db): add index to improve query performance
refactor(web): extract hook from component
```

### Examples - What IS a feature:

```
// These ARE features - user can do something new
feat(tasks): add ability to set task deadlines
feat(calendar): add drag-and-drop event rescheduling
feat(api): add endpoint for bulk task creation
feat(auth): add passkey authentication support
feat(export): add CSV export for tasks
```

### The test for `feat`:

Ask yourself: **"Can a user do something new after this change?"**

- "I refactored the task service" → `refactor` (user sees no difference)
- "I added a deadline field to tasks" → `feat` (user can now set deadlines)
- "I improved the API response time" → `perf` (user can't do anything new)
- "I fixed the date picker" → `fix` (restoring existing functionality)
- "I updated the button color" → `chore` (cosmetic, not new functionality)

### Full type reference:

| Type       | Use when                                | Changelog? |
| ---------- | --------------------------------------- | ---------- |
| `feat`     | User can do something NEW               | Yes        |
| `fix`      | Broken functionality now works          | Yes        |
| `perf`     | Measurably faster, no new functionality | Sometimes  |
| `refactor` | Code restructured, behavior unchanged   | No         |
| `chore`    | Maintenance, deps, config, cleanup      | No         |
| `docs`     | Documentation only                      | No         |
| `test`     | Adding/fixing tests only                | No         |
| `ci`       | CI/CD pipeline changes                  | No         |

**When in doubt, use `chore`.** It's better to under-claim than to pollute the changelog with non-features.

### When you need to commit:

Multiple agents may work on the same repo. Prevent race conditions:

1. **Always commit atomically in a single command chain:**

   ```bash
   git restore --staged . && git add <files> && git commit -m "message"
   ```

2. **Why each part matters:**
   - `git restore --staged .` - Clears any staged files from other agents
   - `git add <files>` - Stages only your intended files
   - `git commit` - Commits immediately before state can change

3. **Never do this (race condition risk):**

   ```bash
   git add .              # Another agent could add files here
   git commit -m "msg"    # You commit their changes too
   ```

4. **For multi-file commits, list files explicitly:**

   ```bash
   git restore --staged . && git add src/foo.ts src/bar.ts && git commit -m "feat: add foo and bar"
   ```

5. Never commit broken code - validate first

### Branch naming:

```
feature/<description>
fix/<description>
docs/<description>
refactor/<description>
```

---

## 7. Error Recovery

### When a build fails:

1. Read the error message
2. Fix the TypeScript/syntax error
3. Re-run build
4. If unclear, check recent changes for the cause

### When the database is out of sync:

1. Check if schema files were modified but not migrated
2. Run the migration workflow:
   ```bash
   cd apps/api && pnpm build
   pnpm drizzle-kit push --strict=false --force
   ```

### When you encounter "already exists" during migration:

1. Use `push` instead of `migrate` for development:
   ```bash
   pnpm drizzle-kit push --strict=false --force
   ```

### When you break something:

1. Don't panic
2. Use `git diff` to see what changed
3. Use `git stash` to temporarily undo changes
4. Fix the issue
5. Apply stash back: `git stash pop`

---

## 8. Agent Behavior

Agents should be autonomous and long-running. Focus on quality, not artificial constraints.

### Ensuring high-quality work:

1. **Validate incrementally** - Don't wait until the end to test
   - Run `pnpm typecheck` after significant changes
   - Test affected functionality before moving on
   - Catch issues early, fix them immediately

2. **Understand before acting** - Read code before modifying it
   - Trace the data flow
   - Identify all callers/callees
   - Understand why code exists before changing it

3. **Test thoroughly** - Cover what you change
   - Happy path: does the feature work?
   - Edge cases: empty inputs, nulls, boundaries
   - Error cases: what happens when things fail?
   - Integration: does it work with the rest of the system?

4. **Self-review before completing:**
   - [ ] Does every change serve the goal?
   - [ ] Would I be comfortable explaining each change?
   - [ ] Did I verify the changes work end-to-end?
   - [ ] Are there any regressions in existing functionality?

### When to ask vs proceed:

| Situation                       | Action                                  |
| ------------------------------- | --------------------------------------- |
| Requirements are ambiguous      | Ask for clarification                   |
| Multiple valid approaches exist | Ask for preference with options         |
| You're uncertain about intent   | Ask                                     |
| You know what to do             | Proceed autonomously                    |
| Task is large but clear         | Proceed - agents should be long-running |

### Gathering context interactively:

Use interactive tools to query the user rather than guessing:

1. **Always give a recommendation** - Minimize cognitive load on the user

   ```
   // BAD - forces user to think through tradeoffs
   "Which approach do you prefer?"
   - Option A: [description]
   - Option B: [description]

   // GOOD - user can just approve the default
   "Which approach do you prefer?"
   - Option A: [description] (Recommended)
   - Option B: [description]
   ```

2. **Ask early, not late** - Gather context before starting, not after you've gone down a wrong path

3. **Be specific** - "Should this support pagination?" not "Any other requirements?"

4. **Batch related questions** - Ask multiple related things at once instead of one at a time

5. **Don't ask what you can discover** - Read the code, check the docs, explore first

### Planning depth:

| Task complexity           | Planning approach                    |
| ------------------------- | ------------------------------------ |
| Simple/clear              | Execute directly                     |
| Multi-step but understood | Track with todo list                 |
| Complex or unfamiliar     | Research first, then plan            |
| Architectural impact      | Detailed plan with explicit approval |

### When you make a mistake:

1. **Acknowledge it** - Don't pretend it didn't happen
2. **Understand why** - What assumption was wrong?
3. **Fix it completely** - Don't leave partial fixes
4. **Learn from it** - Don't repeat the same mistake in this session

### Maintaining quality at scale:

For long-running tasks:

1. **Commit working increments** - Don't accumulate huge uncommitted changes
2. **Validate after each logical unit** - Don't let errors compound
3. **Keep the build green** - Never leave the codebase broken
4. **Document decisions** - Future you (or another agent) needs context

---

## 9. Monorepo Organization

This is a pnpm monorepo. Understand the boundaries:

```
apps/
├── api/          # Hono backend - runs on server
└── web/          # Next.js frontend - runs in browser + server

packages/
├── types/        # Shared type definitions (API contracts)
├── test-utils/   # Shared testing helpers
└── mcp-server/   # Model Context Protocol server
```

### When to put code in a package vs an app:

**Put in `apps/`** when the code is:

- Specific to one deployment target (API server, web client)
- Glue code connecting packages together
- Entry points, routing, request handling

**Put in `packages/`** when the code:

- Needs clear encapsulation (hide implementation, expose clean API)
- Is shared between multiple apps
- Is self-contained logic that apps shouldn't need to understand internals of
- Benefits from being tested in isolation

| What                                   | Where                  | Why                                       |
| -------------------------------------- | ---------------------- | ----------------------------------------- |
| API contracts (request/response types) | `packages/types/`      | Both apps need identical definitions      |
| Test mocks and fixtures                | `packages/test-utils/` | Shared test infrastructure                |
| Complex algorithms                     | `packages/<domain>/`   | Encapsulate complexity, test in isolation |
| Protocol implementations               | `packages/<protocol>/` | Self-contained, apps just call the API    |
| UI components                          | `apps/web/`            | Only web uses UI                          |
| Database queries                       | `apps/api/`            | Only API touches the database             |
| Route handlers                         | `apps/api/`            | Glue code specific to the server          |

**Never create a package for:**

- "Utils" grab-bags with unrelated functions
- Code that's just "similar" between apps (duplication is OK)
- Premature abstractions you "might need later"

### When you import between packages:

1. **Allowed imports:**

   ```
   apps/api     → packages/types ✓
   apps/web     → packages/types ✓
   apps/api     → packages/test-utils ✓ (in tests only)
   apps/web     → packages/test-utils ✓ (in tests only)
   ```

2. **Forbidden imports:**

   ```
   apps/web     → apps/api ✗ (never import between apps)
   apps/api     → apps/web ✗
   packages/types → apps/* ✗ (packages can't import apps)
   ```

3. **Import syntax:**

   ```typescript
   // From a package - use package name
   import { Task } from '@athena/types';

   // Within same app - use relative paths
   import { createTask } from '../services/tasks/service';
   ```

### When you add a dependency:

1. **Decide which package.json:**

   | Dependency used in | Add to                                                          |
   | ------------------ | --------------------------------------------------------------- |
   | Only `apps/api`    | `apps/api/package.json`                                         |
   | Only `apps/web`    | `apps/web/package.json`                                         |
   | Multiple packages  | Root `package.json` (if dev tool) or each package that needs it |

2. **Never add to root package.json:**
   - Runtime dependencies (express, react, etc.)
   - App-specific dev dependencies

3. **Add to root package.json:**
   - Shared dev tools (typescript, eslint, prettier, vitest)
   - Workspace scripts

### When you create a new package:

1. **You probably don't need to.** Consider:
   - Can this live in an existing package?
   - Is this used by 3+ consumers?
   - Does this have a clear, single responsibility?

2. **If you must create one:**

   ```bash
   mkdir -p packages/<name>/src
   ```

3. **Required files:**

   ```
   packages/<name>/
   ├── package.json      # name: "@athena/<name>"
   ├── tsconfig.json     # extends root config
   ├── src/
   │   └── index.ts      # public exports only
   └── README.md         # what this package does
   ```

4. **Package naming:** `@athena/<name>` (matches workspace config)

---

## 10. Code Structure

### When a file exceeds 300 lines:

1. Stop and evaluate - is this file doing too much?
2. Split by one of these strategies:
   - **By domain**: `tools.ts` → `task-tools.ts`, `calendar-tools.ts`
   - **By concern**: Extract hooks, utilities, types into separate files
   - **By layer**: Separate validation, business logic, data access

3. Exceptions (files that can be larger):
   - Schema files (`db/schema/*.ts`) - keep related tables together
   - Auto-generated files (`lib/api/types.ts`) - don't touch
   - Configuration with many options (`lib/env.ts`)

### When you define constants:

1. **Don't inline magic values** in logic:

   ```typescript
   // BAD
   if (priority === 'high') { ... }
   if (days > 30) { ... }

   // GOOD
   const PRIORITY = { HIGH: 'high', MEDIUM: 'medium' } as const;
   const MAX_RETENTION_DAYS = 30;
   ```

2. **Where to put constants:**

   | Scope                  | Location                 |
   | ---------------------- | ------------------------ |
   | Used in one file       | Top of that file         |
   | Shared in one service  | Service's `constants.ts` |
   | Shared across app      | `lib/constants.ts`       |
   | Shared across packages | `packages/types/`        |

### When you add a new service:

1. Create directory: `apps/api/src/services/<domain>/`
2. Follow this structure:
   ```
   services/<domain>/
   ├── service.ts        # Main logic
   ├── types.ts          # Types for this domain
   └── providers/        # If multiple implementations
       ├── provider-a.ts
       └── provider-b.ts
   ```
3. One service = one domain (don't mix billing logic into calendar service)

### When you add types:

1. **Co-locate types with implementation** - don't create types-only files:

   ```typescript
   // BAD - separate types file
   // types.ts
   export interface Task { ... }
   // service.ts
   import { Task } from './types';

   // GOOD - types in same file
   // service.ts
   interface Task { ... }
   export function createTask(task: Task) { ... }
   ```

2. **Exception**: `packages/types/` for API contract types shared between apps
3. **Never create types-only packages or modules**

### When you add a React component:

1. Create in `apps/web/src/components/<feature>/`
2. Structure for complex components:

   ```
   components/<feature>/
   ├── feature-name.tsx         # Main component (<200 lines ideal)
   ├── feature-name.test.tsx    # Co-located tests
   ├── use-feature-name.ts      # Extracted hooks
   └── index.ts                 # Re-exports
   ```

3. Extract a hook when:
   - Component exceeds 200 lines
   - Logic is reused elsewhere
   - You want to test logic separately from UI

### When you add error handling:

1. Use existing error classes from `lib/errors.ts`:
   - `NotFoundError` - resource doesn't exist
   - `ValidationError` - input validation failed
   - `UnauthorizedError` - not logged in
   - `ForbiddenError` - logged in but not allowed
   - `ConflictError` - resource state conflict
   - `ExternalServiceError` - third-party API failed

2. Don't create new error classes unless none fit

3. Include actionable error messages:

   ```typescript
   // BAD
   throw new NotFoundError('Not found');

   // GOOD
   throw new NotFoundError(`Task ${taskId} not found`);
   ```

---

## 11. Security & Performance

### Security basics (don't introduce vulnerabilities):

1. **Never log sensitive data:**

   ```typescript
   // BAD
   console.log('User login:', { email, password });

   // GOOD
   console.log('User login:', { email, passwordLength: password.length });
   ```

2. **Never commit secrets:**
   - API keys, tokens, passwords → environment variables
   - Check `.env.example` exists for required vars
   - If you accidentally commit a secret, notify the user immediately

3. **Always validate input:**
   - Use Zod schemas for all API inputs
   - Don't trust client-provided IDs - verify ownership
   - Sanitize user content before rendering

4. **SQL injection prevention:**
   - Drizzle ORM handles this - never use raw SQL strings
   - If you must use raw SQL, use parameterized queries

### Performance basics (don't introduce slowdowns):

1. **Database queries:**
   - Don't query in loops - batch instead
   - Use `select()` to fetch only needed columns
   - Add indexes for frequently filtered columns (ask before adding)

2. **N+1 query prevention:**

   ```typescript
   // BAD - N+1 queries
   const tasks = await db.select().from(tasks);
   for (const task of tasks) {
     const project = await db.select().from(projects).where(eq(id, task.projectId));
   }

   // GOOD - single query with join
   const tasksWithProjects = await db
     .select()
     .from(tasks)
     .leftJoin(projects, eq(tasks.projectId, projects.id));
   ```

3. **Frontend performance:**
   - Don't fetch data in loops
   - Use React Server Components for static content
   - Lazy load heavy components with `dynamic()`

---

## Reference

### WORKLOG.md Template

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

---

## Backlog

### [TASK-ID] Task Title

- **Priority**: P0 | P1 | P2 | P3
- **Description**: Brief description
```

### TSDoc Format

````typescript
/**
 * Brief description of what this does.
 *
 * @param paramName - Description of parameter
 * @returns Description of return value
 * @throws {ErrorType} When this error occurs
 *
 * @example
 * ```typescript
 * const result = myFunction('input');
 * ```
 */
````

### Hard Rules (Never Break These)

1. **Never commit TODO comments** - finish the work or document blocker
2. **Never skip tests** - fix failing tests before proceeding
3. **Never use `any` without justification** - prefer `unknown`
4. **Never leave stub implementations** - complete the code or don't commit
5. **Always validate before completing** - run typecheck, lint, test
6. **Always update WORKLOG.md** - track what you did

---

_This document is self-governing. Update it when workflows change._

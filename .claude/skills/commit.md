# /commit - Prepare and Execute a Commit

Use this skill when you're ready to commit changes. Follow every step.

---

## Phase 0: Gather Full Session Context

**CRITICAL**: Do not focus only on your most recent changes. Review ALL changes made during this session.

### Before anything else, run:

```bash
git status
git diff
git diff --cached
```

### Review the ENTIRE session:

```
What files were modified during this session (not just the last edit)?
├── Look at git status - these are ALL uncommitted changes
├── Look at git diff - see the full scope of modifications
└── Consider: Did you modify files earlier that you forgot about?
```

### Common mistake to avoid:

```
BAD:  "I just updated the button styles" → commit only mentions buttons
      (But you also fixed a bug in the API earlier in the session!)

GOOD: Review ALL changes, decide:
      - Should these be ONE commit? (if related)
      - Should these be MULTIPLE commits? (if unrelated)
      - Did you forget about earlier work?
```

### IF this is a long session with many changes:

```
1. Run: git diff --stat (see summary of all changed files)
2. For each file, ask: "When did I change this? Why?"
3. Group related changes together
4. Commit in logical units, not "everything I did today"
```

---

## Phase 1: Should You Commit Now?

### IF you have uncommitted changes:

```
Are these changes complete and working?
├── NO → Don't commit yet. Finish the work.
└── YES → Are these changes related to ONE logical unit?
    ├── NO → Split into multiple commits. Stash unrelated changes.
    └── YES → Proceed to Phase 1.
```

### IF you modified database schema files:

```
Did you complete the full schema workflow?
├── NO → STOP. Go do this first:
│   1. cd apps/api && pnpm build
│   2. pnpm drizzle-kit generate
│   3. Verify the SQL
│   4. pnpm drizzle-kit push --strict=false --force
│   5. Test that API starts
└── YES → Proceed to Phase 1.
```

### IF you're in the middle of a larger task:

```
Is this a logical checkpoint worth committing?
├── NO → Keep working until you reach a stable point.
└── YES → Does the build pass?
    ├── NO → Fix it first. Never commit broken code.
    └── YES → Proceed to Phase 1.
```

---

## Phase 2: Pre-Flight Checklist

Before committing, verify ALL of these:

### Code Quality

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes (or tests for affected code pass)
- [ ] No `console.log` debugging statements left behind
- [ ] No commented-out code
- [ ] No TODO comments being committed

### Schema Changes (if applicable)

- [ ] Ran `cd apps/api && pnpm build`
- [ ] Ran `pnpm drizzle-kit generate`
- [ ] Verified migration SQL looks correct
- [ ] Ran `pnpm drizzle-kit push --strict=false --force`
- [ ] API starts without schema errors

### Functionality

- [ ] Changes work as intended (tested manually or via tests)
- [ ] No regressions in existing functionality
- [ ] Edge cases considered

Run these commands now:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

### IF typecheck fails:

```
Is it a type error in code you modified?
├── YES → Fix the type error. Do not proceed until it passes.
└── NO → Is it a pre-existing type error?
    ├── YES → Fix it anyway (don't leave broken windows) OR
    │         note it and fix in a separate commit first.
    └── NO → Investigate. Something unexpected is wrong.
```

### IF lint fails:

```
Is it auto-fixable?
├── YES → Run `pnpm lint --fix`, verify changes, proceed.
└── NO → Fix manually. Common issues:
    - Unused imports → Remove them
    - Missing return types → Add them
    - any types → Replace with proper types
```

### IF tests fail:

```
Did you modify code related to the failing test?
├── YES → Your change broke something. Fix it.
└── NO → Is it a flaky or pre-existing failure?
    ├── YES → Note it. Consider fixing in separate commit.
    └── NO → Your change may have unexpected side effects.
              Investigate before proceeding.
```

---

## Phase 3: Review Changes

Review what you're about to commit:

```bash
git status
git diff
```

### IF you see files you didn't intend to change:

```
Are these auto-generated files (package-lock, dist, etc.)?
├── YES → Check .gitignore. These probably shouldn't be tracked.
│         Run: git restore <file> to discard.
└── NO → Did you accidentally modify them?
    ├── YES → Run: git restore <file> to discard.
    └── NO → Were they modified by a tool (lint --fix, build)?
        ├── YES → Include if intentional, discard if not.
        └── NO → Investigate. Something is wrong.
```

### IF you see sensitive data (secrets, keys, tokens):

```
STOP. Do not commit.
1. Remove the sensitive data from the file
2. Add the file pattern to .gitignore if needed
3. Use environment variables instead
4. If you already committed a secret:
   - Notify the user IMMEDIATELY
   - The secret must be rotated
```

### IF changes span multiple concerns:

```
Can these be logically separated?
├── YES → Stash unrelated changes:
│         git stash push -m "unrelated work" -- <files>
│         Commit the focused change first.
│         Then: git stash pop
└── NO → Is there a good reason they must be together?
    ├── YES → Proceed, but use a clear commit message.
    └── NO → Try harder to separate them. Atomic commits are better.
```

---

## Phase 4: Determine Commit Type

**CRITICAL**: Choose the correct type. This affects changelog generation.

### Decision Tree:

```
Can a user do something NEW they couldn't before?
├── YES → Is the feature complete and usable?
│   ├── YES → feat
│   └── NO → chore (prep work for feature)
└── NO → Does it fix broken functionality?
    ├── YES → fix
    └── NO → Is it restructuring code without behavior change?
        ├── YES → refactor
        └── NO → Is it improving performance?
            ├── YES → perf
            └── NO → chore (default)
```

### Quick Reference:

| Change                  | Type       | Example                                   |
| ----------------------- | ---------- | ----------------------------------------- |
| New user capability     | `feat`     | `feat(tasks): add bulk delete`            |
| Bug fix                 | `fix`      | `fix(calendar): correct timezone offset`  |
| Code restructure        | `refactor` | `refactor(api): extract validation logic` |
| Performance improvement | `perf`     | `perf(db): add index on created_at`       |
| Style/cosmetic          | `chore`    | `chore(ui): update button colors`         |
| Dependencies            | `chore`    | `chore(deps): update react to 19`         |
| Config changes          | `chore`    | `chore(config): update eslint rules`      |
| Documentation           | `docs`     | `docs(readme): add setup instructions`    |
| Tests only              | `test`     | `test(tasks): add edge case coverage`     |

### NOT Features (common mistakes):

```
BAD:  feat(ui): update styling
GOOD: chore(ui): update styling

BAD:  feat(api): refactor for efficiency
GOOD: refactor(api): improve query efficiency

BAD:  feat(auth): add validation helper
GOOD: chore(auth): add validation helper

BAD:  feat(tasks): extract into separate component
GOOD: refactor(tasks): extract into separate component
```

---

## Phase 5: Write Commit Message

Format:

```
<type>(<scope>): <description>

[optional body]
```

### Rules:

- `<type>`: From the decision tree above
- `<scope>`: Must be from the valid scopes list below
- `<description>`: Imperative mood, lowercase, no period
  - "add feature" not "added feature" or "adds feature"
  - "fix bug" not "fixed bug" or "fixes bug"

### Valid Scopes:

**App-level** (when change spans multiple areas of an app):
| Scope | Use for |
|-------|---------|
| `api` | Backend app - spans routes/services |
| `web` | Frontend app - spans components/pages |

**Packages**:
| Scope | Use for |
|-------|---------|
| `types` | `packages/types/` - shared type definitions |
| `test-utils` | `packages/test-utils/` - test helpers |
| `mcp-server` | `packages/mcp-server/` - MCP server |

**Domain features** (prefer these over app-level):
| Scope | Covers |
|-------|--------|
| `tasks` | Task CRUD, task list, task details |
| `calendar` | Calendar views, event rendering |
| `events` | Event CRUD, scheduling |
| `agenda` | Agenda view, daily planning |
| `auth` | Authentication, sessions, passkeys |
| `billing` | Subscriptions, payments, Stripe |
| `ai` | AI assistant, chat, tools |
| `notifications` | Push notifications, email, in-app |
| `integrations` | Third-party integrations (Linear, GitHub, etc.) |
| `sync` | Calendar sync, integration sync |
| `settings` | User settings, preferences |
| `search` | Search functionality |
| `analytics` | Usage analytics, metrics |
| `attachments` | File uploads, storage |
| `webhooks` | Webhook endpoints, deliveries |
| `projects` | Project management |
| `tags` | Tag management |
| `time-tracking` | Time entries, tracking |

**UI-specific** (frontend only):
| Scope | Covers |
|-------|--------|
| `ui` | Shared UI components (`components/ui/`) |
| `layout` | Header, sidebar, navigation |
| `dashboard` | Dashboard views, widgets |
| `command-palette` | Command palette, keyboard shortcuts |

**Infrastructure**:
| Scope | Use for |
|-------|---------|
| `db` | Database schema, migrations |
| `config` | Configuration, environment |
| `deps` | Dependency updates |
| `ci` | CI/CD pipeline |
| `docs` | Documentation |
| `release` | Version bumps, releases |

### Choosing the right scope:

```
Is the scope obvious and clear?
├── NO → Don't use a scope. Just: <type>: <description>
└── YES → Is this change in one domain area?
    ├── YES → Use the domain scope (tasks, calendar, auth, etc.)
    └── NO → Does it span multiple domains in one app?
        ├── YES → Use app scope (api, web)
        └── NO → Is it infrastructure?
            ├── YES → Use infra scope (db, config, deps, ci)
            └── NO → Is it a package?
                └── YES → Use package scope (types, test-utils)
```

**When in doubt, omit the scope** (except for features):

```
// Scope unclear? Just skip it:
fix: correct validation logic
refactor: simplify error handling

// BUT features MUST always have a scope:
feat(tasks): add bulk delete       ✓
feat: add bulk delete              ✗ INVALID - features require scope

// Dependency updates should be scoped to the package:
chore(api): update drizzle-orm     ✓
chore(web): update react           ✓
chore: update dependencies         ✗ Too vague - which package?
```

**Features require scopes** because they generate changelogs - readers need to know what area the feature affects.

### Writing Good Commit Messages:

**Features must read like changelog entries** - what can users do now?

```
// BAD - implementation details, not user-facing
feat(tasks): add TaskRecurrenceService and update task creation endpoint

// GOOD - what the user can now do
feat(tasks): add ability to set recurring deadlines

Users can now configure tasks to repeat daily, weekly, or monthly.
Recurring tasks automatically generate instances on their schedule.
```

**Chores should explain WHY, not WHAT** - the diff shows what changed:

```
// BAD - just describes the diff (pointless)
chore(api): update 5 files and add 3 new functions

// BAD - meaningless metrics
chore(api): refactor auth module (12 files changed, 847 insertions)

// GOOD - explains reasoning not visible in diff
chore(api): extract auth middleware for reuse across routes

Auth logic was duplicated in 4 routes. Centralizing it ensures
consistent token validation and makes adding new auth methods easier.
```

**Provide context that survives beyond the diff:**

```
// BAD - obvious from the code
refactor(calendar): rename getEvents to fetchEvents

// GOOD - explains the decision
refactor(calendar): rename getEvents to fetchEvents

Aligning with our codebase naming convention: "fetch" indicates async
operations that hit external data sources (database, APIs), while
"get" is reserved for synchronous operations on local/in-memory data.
This makes it immediately clear at call sites whether a function
might suspend or throw network errors.
```

### What to include in commit bodies:

| DO include                   | DON'T include               |
| ---------------------------- | --------------------------- |
| Why this approach was chosen | Number of files changed     |
| Trade-offs considered        | Lines added/removed         |
| Breaking changes             | List of every file modified |
| Migration steps if needed    | "Updated tests" (obvious)   |
| User-facing impact           | Implementation play-by-play |

### Examples with bodies:

**Feature - simple:**

```
feat(calendar): add drag-and-drop event rescheduling

Events can now be dragged to a new time slot directly in the calendar
view. This replaces the old workflow of opening the edit modal just
to change an event's time—now it's a single drag gesture.

Hold Shift while dragging to snap to 15-minute intervals. Without
Shift, events snap to the nearest 5-minute mark.
```

**Feature - substantial (REST API service):**

```
feat(time-tracking): add time entry management API

Users can now track time spent on tasks with start/stop timer
functionality and manual time entries. This enables billing workflows
and productivity insights.

## User Experience

From any task, users can start a timer that runs until they stop it
or start a different one (auto-stop). They can also add manual entries
for time tracked outside the app. The time entries appear in a new
"Time" tab on task details and in a dedicated time tracking dashboard.

## API

The new /time-entries resource follows REST conventions:

- POST /time-entries creates an entry (either manual with duration,
  or starts a running timer if duration is omitted)
- GET /time-entries lists entries with optional filters for task_id,
  date range, and running status
- PATCH /time-entries/:id updates an entry's duration or notes
- DELETE /time-entries/:id removes an entry
- POST /time-entries/:id/stop stops a running timer and sets duration

## Schema

Added a time_entries table with foreign keys to tasks and users.
Indexed on (user_id, started_at) to support the dashboard query
pattern efficiently.

## Design Notes

Entries store duration_minutes explicitly rather than computing from
start/end timestamps. This handles pauses and manual adjustments
cleanly—users can edit duration without needing to fake timestamps.
Running timers have null duration until stopped.
```

**Feature - full-stack with multiple components:**

```
feat(tasks): add custom task statuses with workflow configuration

Users can now define custom task statuses beyond the default "To Do",
"In Progress", and "Done". Teams can create statuses like "In Review",
"Blocked", or "Ready for QA" to match their actual workflow.

## User Experience

Workspace admins configure statuses in Settings > Workflow. Each status
has a name, color, and optional icon. Statuses are grouped into categories
(not started, in progress, done, cancelled) which powers filtering and
analytics—you can add five different "in progress" statuses and they'll
all count as in-progress for reporting purposes.

Task cards and detail views display the custom status with its configured
color. The status picker shows all available statuses grouped by category.

## API

Workspace status management:
- GET /workspaces/:id/statuses returns all statuses for a workspace
- POST /workspaces/:id/statuses creates a new status
- PATCH /workspaces/:id/statuses/:statusId updates a status
- DELETE /workspaces/:id/statuses/:statusId removes a status (fails if tasks use it)

Tasks now reference status by ID. The TaskService validates that the
status belongs to the task's workspace before allowing assignment.

## Schema

New custom_task_statuses table stores workspace-specific statuses with
their display configuration. New task_status_category enum groups statuses
for filtering. The migration creates default statuses for existing workspaces
and maps current tasks to preserve their status.

## Breaking Change

The Task.status string field is replaced with Task.statusId (foreign key).
Frontend clients should fetch workspace statuses on load and look up the
status name/color by ID when rendering.
```

**Fix:**

```
fix(auth): prevent session fixation after password reset

Previously, existing sessions remained valid after a password reset,
which meant a compromised session could persist even after the user
changed their password. Now all sessions are invalidated when the
password changes, forcing re-authentication everywhere.

The root cause was a subtle bug: SessionService.revokeAllSessions()
was being called with user.id, but the sessions table uses account_id
as its foreign key. The query returned zero rows and silently did
nothing. Added proper account lookup before revocation.
```

**Fix - with investigation context:**

```
fix(calendar): correct timezone offset for recurring events

Events created in non-UTC timezones were showing at the wrong time
after daylight saving transitions. A 2pm weekly meeting would suddenly
appear at 1pm or 3pm depending on the DST direction.

## Investigation

Reproduced by creating a weekly event at 2pm EST, then viewing it after
the DST transition date. The event showed at 3pm EDT instead of 2pm EDT.

The root cause was storing UTC offset (+05:00) at event creation time
and applying that fixed offset to all recurring instances. This ignores
that America/New_York is -05:00 in winter but -04:00 in summer.

## Fix

We now store the IANA timezone identifier (America/New_York) instead of
a UTC offset. When rendering each occurrence, we calculate the correct
offset for that specific date. The migration backfills timezone from user
profile settings for existing events that only had offsets stored.

## Impact

Recurring events created before this fix in non-UTC timezones may appear
shifted by 1 hour at DST boundaries. Affected users will need to edit
and re-save their events to trigger the timezone backfill for events
where we couldn't infer the timezone.
```

**Chore:**

```
chore(api): migrate from express-validator to zod

Zod provides much better TypeScript inference than express-validator
and integrates directly with our OpenAPI generation pipeline. With
express-validator, we had to manually assert types after validation,
which was error-prone and led to a few runtime type mismatches in
production.

Converted all 23 route files to use Zod schemas. The error response
shape is unchanged so frontend error handling continues to work.
Removed express-validator from dependencies.
```

**Chore - dependency update with reasoning:**

```
chore(web): upgrade React 18 to React 19

Upgrading to React 19 to enable the new Server Actions syntax and
try the React Compiler for automatic memoization. This is prep work
for the upcoming forms refactor.

## Changes Required

React 19 makes forwardRef automatic, so I removed explicit forwardRef()
wrappers from 12 components. Also fixed 3 components that were using
the deprecated string ref syntax (ref="inputField") and updated
@types/react to the 19.x definitions.

Enabled the React Compiler in next.config.js with the recommended
default settings.

## Breaking Dependency

react-beautiful-dnd doesn't support React 19 and appears abandoned.
Replaced it with @dnd-kit/core which is actively maintained and has
a cleaner API. The drag-and-drop handlers in the calendar needed a
full rewrite—see components/calendar/drag-handlers.ts for the new
patterns if you're working with DnD elsewhere.
```

**Refactor:**

```
refactor(notifications): split monolithic service into providers

The notification service had grown to 800+ lines handling email, push,
and Slack all in one file. Finding the right code path for debugging
was painful, and adding new channels (we want Discord support soon)
meant touching a file that handled everything else.

Split into a provider pattern that mirrors what we did for calendar-sync.
The main NotificationService now just orchestrates—it decides what to
send and delegates to the appropriate provider. Each provider handles
its own integration details in isolation.

The new structure is services/notifications/ with service.ts for
orchestration, types.ts for shared interfaces, and a providers/
directory containing email.ts (SendGrid), push.ts (Firebase FCM),
and slack.ts (Slack webhooks).

No behavior changes. All existing notification logic is preserved;
this is purely a structural refactor to make the code more navigable
and testable.
```

**Refactor - with migration notes:**

```
refactor(api): reorganize routes by domain instead of HTTP method

Our routes were organized by HTTP method (routes/get.ts, routes/post.ts)
which made it surprisingly hard to find all the endpoints for a feature.
Want to see all task endpoints? Check four different files.

Reorganized to domain-based files where each file contains all HTTP
methods for that resource: routes/tasks.ts has GET list, GET single,
POST create, PATCH update, and DELETE. Much easier to navigate.

## Migration

If you have local imports referencing the old route files, update them:

Old: routes/get.ts → getTasks
New: routes/tasks.ts → listTasks (also renamed for clarity)

Old: routes/post.ts → createTask
New: routes/tasks.ts → createTask
```

### When to write detailed commit bodies:

**Always include a body when:**

- Adding new API endpoints (list the routes)
- Adding new services (describe the structure and responsibilities)
- Making schema changes (describe tables/columns added)
- Introducing breaking changes (explain migration path)
- Fixing non-obvious bugs (explain root cause and investigation)
- Making architectural decisions (explain why this approach)
- Upgrading major dependencies (explain what changed)

**Body can be brief or omitted when:**

- Fixing typos or obvious mistakes
- Adding/updating tests with no behavior change
- Simple config tweaks
- Single-line fixes with obvious intent

**Rule of thumb**: If someone reading `git log --oneline` couldn't understand the scope of your change, you need a body.

### Anti-patterns to avoid:

```
// Padding with metrics (meaningless)
"Updated 12 test files to improve coverage to 87%"

// Play-by-play of implementation (use the diff for this)
"First added the new field, then updated the migration, then
modified the service to handle the new field, then updated tests"

// Vague non-information
"Various improvements and fixes"
"Code cleanup"
"Minor changes"

// Missing critical details for substantial changes
"feat(api): add time tracking"
// BAD: What endpoints? What service? What schema changes?

// Overly terse for complex fixes
"fix(calendar): fix timezone bug"
// BAD: What was wrong? What timezones? What's the impact?
```

### Commits that LOOK good but aren't:

These examples appear professional but miss the point:

**Implementation details without user impact:**

```
feat(tasks): add TaskRecurrenceService with daily/weekly/monthly modes

- Created RecurrencePattern enum with DAILY, WEEKLY, MONTHLY values
- Added generateInstances() method to compute future occurrences
- Updated TaskService to integrate recurrence logic
- Added 15 test cases covering edge cases

// WHY IT'S BAD: Lists what you built, not what users can DO.
// Reader still doesn't know: Can users set recurring tasks now?
// How do they use it? What's the UI?

// BETTER:
feat(tasks): add recurring task support

Users can now create tasks that repeat on a schedule. From the task
detail panel, select a recurrence pattern (daily, weekly, or monthly)
and the system generates future instances automatically.

The new POST /tasks/:id/recurrence endpoint accepts a pattern and
optional end date. TaskRecurrenceService handles computing the next
occurrences and creates task instances up to 3 months ahead.
```

**Activity log disguised as a commit:**

```
chore(api): comprehensive auth refactor

- Renamed AuthService to AuthenticationService
- Moved from services/auth.ts to services/authentication/service.ts
- Updated all 23 import statements across the codebase
- Added JSDoc comments to all public methods
- Reorganized methods alphabetically within the class
- Extracted constants to top of file

// WHY IT'S BAD: This is a work log, not a commit message.
// Lots of activity but no explanation of WHY any of this matters.
// "Reorganized alphabetically" is not valuable information.

// BETTER:
refactor(auth): restructure auth service for provider pattern

Preparing to add OAuth providers (Google, GitHub) in an upcoming PR.
The current auth service was monolithic—password validation, session
management, and token generation all lived in one 600-line file,
making it difficult to add new auth methods without risking regressions.

The new structure separates concerns: AuthenticationService orchestrates
the flow, while providers (currently just CredentialProvider) handle
the actual validation. This lets us add GoogleProvider and GitHubProvider
as drop-in additions.

Breaking: Import path changed from services/auth to services/authentication.
```

**Exhaustive file listing:**

```
feat(calendar): add event filtering

Modified files:
- src/routes/events.ts
- src/services/events/service.ts
- src/services/events/types.ts
- apps/web/src/components/calendar/calendar-view.tsx
- apps/web/src/components/calendar/filter-panel.tsx
- apps/web/src/hooks/use-event-filters.ts
- packages/types/src/events.ts

// WHY IT'S BAD: Git already tracks which files changed.
// This adds zero information. What can users filter BY?
// What does the UI look like?

// BETTER:
feat(calendar): add event filtering by calendar and category

Users can now filter the calendar view to show only specific calendars
or event categories. This is useful for users with multiple connected
calendars who want to focus on work events without seeing personal ones.

## User Experience

A new filter button in the calendar header opens a dropdown with
multi-select options for calendars and categories. Selected filters
persist in localStorage so users don't need to re-apply them each visit.

## API Changes

The GET /events endpoint now accepts optional query parameters:
- `calendar_ids`: comma-separated list of calendar IDs to include
- `categories`: comma-separated list of category slugs

Omitting these parameters returns all events (backward compatible).
```

**False precision with metrics:**

```
perf(db): optimize task queries (47% faster)

Added composite index on (user_id, created_at, status).
Query time reduced from 340ms to 180ms on 10k tasks dataset.
Memory usage decreased by 23%.

// WHY IT'S BAD: These metrics sound impressive but are meaningless.
// What workload? What hardware? Is 10k tasks realistic?
// "47% faster" creates false confidence in unreproducible numbers.

// BETTER:
perf(db): add index to speed up task list queries

Task list loading was noticeably slow for power users with thousands
of tasks. The issue was a full table scan on every request because
we filter by user_id and sort by created_at, but had no index
covering that pattern.

Added a composite index on (user_id, created_at, status) which
supports our most common query: "get my recent tasks, optionally
filtered by status." The query planner now uses an index seek
instead of scanning the entire tasks table.
```

**Numbered implementation steps:**

```
feat(notifications): add push notification support

Implementation:
1. Created PushNotificationService class
2. Added Firebase Cloud Messaging integration
3. Implemented device token registration endpoint
4. Added notification preferences to user settings
5. Created notification queue with retry logic
6. Added rate limiting (100/hour/user)
7. Implemented batching for bulk sends
8. Added analytics tracking for delivery rates

Testing:
- Unit tests for service methods
- Integration tests for FCM calls
- E2E tests for full notification flow

// WHY IT'S BAD: This is your implementation checklist, not a commit message.
// Numbered steps describe HOW you worked, not what the feature IS.
// "Added analytics tracking" - for whom? why?

// BETTER:
feat(notifications): add push notifications for task reminders

Users can now receive push notifications on mobile and desktop when
tasks are due or when they're mentioned in comments. This addresses
the #1 requested feature from our user feedback survey.

## User Experience

Notifications are opt-in. Users enable them in Settings > Notifications,
which prompts for browser/device permission. They can configure which
events trigger notifications (due dates, mentions, assignments) and
set quiet hours.

## API

Device registration endpoints handle token management:
- POST /devices registers a new device with its FCM token
- DELETE /devices/:id removes a device when user logs out

Preferences are managed through GET/PATCH /notifications/preferences.

## Implementation Notes

We use Firebase Cloud Messaging for delivery across platforms.
Notifications are rate-limited to 100/hour/user to prevent abuse,
and the queue retries failed deliveries up to 3 times with
exponential backoff.
```

**The "I did a lot of work" commit:**

```
feat(integrations): implement Linear integration

This was a complex feature requiring significant changes across
the codebase. Spent considerable time researching the Linear API
and handling edge cases.

Changes include OAuth flow, webhook handling, issue syncing,
bidirectional updates, and error recovery.

// WHY IT'S BAD: Talks about how hard it was, not what it does.
// "Significant changes" and "considerable time" are not information.
// "Changes include..." is vague hand-waving.

// BETTER:
feat(integrations): add Linear integration for two-way issue sync

Tasks can now sync bidirectionally with Linear issues. Users who
manage work in both tools no longer need to manually copy items
between them—create a task in Athena and it appears in Linear,
or vice versa.

## Setup

Users connect their Linear workspace via OAuth in Settings >
Integrations > Linear. After authorizing, they map Athena projects
to Linear teams/projects. Only mapped projects participate in sync.

## Sync Behavior

The integration maintains bidirectional sync with eventual consistency.
When a task is created or updated in Athena with a mapped project,
we push the change to Linear within a few seconds. Linear changes
come to us via webhooks and are processed immediately.

Status mapping is configurable per-workspace. By default, we map
"To Do" → "Backlog", "In Progress" → "In Progress", and
"Done" → "Done", but users can customize this in the integration
settings.

## API

The OAuth flow is handled by GET/POST /integrations/linear/connect.
Linear sends events to POST /webhooks/linear, which validates the
signature and queues sync jobs. Users can manually trigger a sync
for a specific task via POST /tasks/:id/sync/linear if they need
immediate consistency.
```

---

## Phase 6: Execute Atomic Commit

**CRITICAL**: Use atomic commit to prevent race conditions with other agents.

```bash
git restore --staged . && git add <files> && git commit -m "<type>(<scope>): <description>"
```

### Why each part:

- `git restore --staged .` - Clears any files staged by other agents
- `git add <files>` - Stages only YOUR intended files
- `git commit -m "..."` - Commits immediately before state changes

### Examples:

Single file:

```bash
git restore --staged . && git add src/routes/tasks.ts && git commit -m "fix(tasks): correct deadline validation"
```

Multiple files:

```bash
git restore --staged . && git add src/routes/tasks.ts src/services/tasks/service.ts && git commit -m "feat(tasks): add bulk delete endpoint"
```

All changes in a directory:

```bash
git restore --staged . && git add apps/api/src/routes/ && git commit -m "refactor(api): reorganize route handlers"
```

### IF git add fails:

```
Does the file exist?
├── NO → Check the path. Typo?
└── YES → Is it ignored by .gitignore?
    ├── YES → Should it be tracked?
    │   ├── YES → Remove from .gitignore or use git add -f
    │   └── NO → Don't commit it.
    └── NO → Check file permissions. Run: ls -la <file>
```

### IF git commit fails:

```
What's the error?
├── "nothing to commit" → Files weren't staged. Check git status.
├── "pre-commit hook failed" → Fix what the hook complains about.
│   Usually: lint errors, type errors, or test failures.
└── Other → Read the error message. Don't proceed until resolved.
```

### IF you see merge conflict markers:

```
STOP. You have unresolved conflicts.
1. Run: git status (see which files have conflicts)
2. Open each conflicted file
3. Resolve the conflicts (remove <<<, ===, >>> markers)
4. Run: git add <resolved-file>
5. Then commit
```

### IF another agent committed while you were working:

**Note**: Agents cannot do interactive rebases. Use merge-based workflows instead.

```
Did their changes conflict with yours?
├── YES → Merge and resolve:
│         git pull origin <branch>
│         (This will create a merge commit if there are conflicts)
│         Fix conflicts in each file
│         git add <resolved-files>
│         git commit -m "chore: merge and resolve conflicts"
└── NO → Simple pull before committing:
         git pull origin <branch>
         Then proceed with your commit.
```

### IF you need to undo uncommitted changes to retry:

```
Want to discard specific files?
├── YES → git restore <specific-file>
│         (Always name files explicitly)
└── NO → Want to save changes for later?
    └── git stash push -m "description"
        (Later: git stash pop)
```

**BANNED COMMAND**: `git restore .`

- NEVER run `git restore .` - it destroys ALL uncommitted work
- Always specify files explicitly: `git restore <file1> <file2>`
- If you need to discard many files, list them explicitly or use stash

---

## Phase 7: Post-Commit Verification

After committing:

```bash
git log -1                    # Verify commit message looks right
git status                    # Verify working directory is clean (or has expected uncommitted files)
```

### IF the commit message is wrong:

```
Have you pushed this commit yet?
├── NO → Safe to amend:
│        git commit --amend -m "correct(scope): message"
└── YES → Do NOT amend. Create a new commit or live with it.
          Amending pushed commits requires force-push.
```

### IF you committed the wrong files:

```
Have you pushed this commit yet?
├── NO → Reset and redo:
│        git reset --soft HEAD~1
│        (Your changes are now staged again. Fix and recommit.)
└── YES → Create a new commit to fix the issue.
          Do NOT force-push to fix mistakes.
```

### IF the build breaks after commit:

```
Did your commit cause the breakage?
├── YES → Fix immediately. Either:
│         - Amend the commit (if not pushed)
│         - Create a fix commit (if pushed)
│         Do NOT leave the build broken.
└── NO → Investigate. Another agent may have caused it.
         Coordinate before making changes.
```

### IF you realize you missed something:

```
Is it a small fix related to the last commit?
├── YES, and not pushed → Amend:
│   git add <file> && git commit --amend --no-edit
├── YES, but pushed → Create new commit:
│   fix(scope): correct oversight in previous commit
└── NO → Create a separate commit for the separate concern.
```

---

## Phase 8: Version Bump (if releasing)

Only bump version when preparing for release, not during regular commits.

If this commit completes a release:

1. Update version in relevant `package.json`
2. Update version in `CLAUDE.md` header
3. Commit version bump: `chore(release): bump version to X.Y.Z`

---

## Quick Command Summary

```bash
# 0. Gather FULL session context (don't skip this!)
git status
git diff
git diff --stat

# 1. Pre-flight
pnpm typecheck && pnpm lint && pnpm test

# 2. Review ALL changes (not just recent ones)
git diff

# 3. Commit (atomic)
git restore --staged . && git add <files> && git commit -m "<type>(<scope>): <description>"

# 4. Verify
git log -1
```

---

## Checklist Summary

Before running commit command:

- [ ] All validation passes (typecheck, lint, test)
- [ ] Changes reviewed and intentional
- [ ] Commit type correctly chosen (probably NOT feat)
- [ ] Message is imperative, lowercase, descriptive
- [ ] Using atomic commit pattern

After commit:

- [ ] Commit message verified via `git log -1`
- [ ] Working directory in expected state

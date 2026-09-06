# Work Schedule And Places Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Use superpowers:test-driven-development for every behavior change.

**Goal:** Replace independent location assertions with one versioned default work schedule, split personal settings into Work schedule and Places, and reconcile provider labels without creating duplicate places.

**Architecture:** The planning domain owns a pure cycle-expansion model. Postgres stores immutable plan versions, full-day replacement exceptions, account-scoped place aliases, and incoming changes. The API exposes plan and reconciliation resources while it keeps the old assertion routes for compatibility. The resolver prefers plan intervals over legacy assertions. Google projection expands the plan into weekly recurrence or a rolling dated window. The web app gives Work schedule, Places, and Connected accounts separate ownership.

**Tech Stack:** TypeScript, Zod, Drizzle/Postgres, Hono, TanStack Query, Next.js App Router, React, `@docket/ui`, Vitest, Testing Library, and Playwright.

---

### Task 1: Define and expand the canonical work schedule

**Files:**

- Modify: `domains/planning/src/ids.ts`
- Modify: `domains/planning/src/contracts/work-location.ts`
- Create: `domains/planning/src/work-schedule.ts`
- Modify: `domains/planning/package.json`
- Test: `domains/planning/tests/work-schedule.test.ts`

**Steps:**

1. Write contract tests that reject a zero-day and twenty-nine-day cycle, overlapping segments, invalid version dates, and duplicate exception dates.
2. Write expansion tests for a seven-day week, a nine-day rotation, split shifts, overnight segments, mobile work, undecided work, and a no-work dated replacement.
3. Run `pnpm --filter @docket/planning test -- work-schedule.test.ts` and confirm that missing exports cause the expected failure.
4. Add branded plan and exception identifiers. Add Zod inputs and outputs for plan versions, segments, replacement exceptions, location states, and range results.
5. Add pure cycle-day selection and interval expansion. Use the existing civil-date and zoned-time helpers.
6. Run the focused planning tests until they pass. Run the existing work-location resolver tests to catch compatibility regressions.

### Task 2: Persist plan versions, exceptions, aliases, and incoming changes

**Files:**

- Modify: `packages/db/src/schema/work-location.ts`
- Modify: `packages/db/src/schema/work-location-sync.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0125_work_schedule_and_place_aliases.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Test: `packages/db/tests/schema/work-location-schema.test.ts`

**Steps:**

1. Add failing schema tests for owner-scoped plan versions, non-overlapping version boundaries, unique exception dates, account-scoped normalized aliases, and incoming-change deduplication.
2. Run the focused database test and confirm each missing table or constraint causes the expected failure.
3. Add the four tables and their indexes, foreign keys, shape checks, and stable state vocabularies.
4. Generate the migration through the repository Drizzle command. Review the SQL and rename it to the declared migration name if the generator uses another adjective.
5. Run the focused schema test and the migration integrity tests until they pass.

### Task 3: Add repository and API operations

**Files:**

- Create: `apps/api/src/services/work-location/schedule-repository.ts`
- Modify: `apps/api/src/routes/work-location.ts`
- Test: `apps/api/tests/services/work-location/schedule-repository.test.ts`
- Test: `apps/api/tests/routes/work-location.test.ts`

**Steps:**

1. Add failing repository tests for listing plan versions, atomically replacing the current version from an effective date, replacing one date, linking an alias, ignoring a provider label, and resolving an incoming change.
2. Add failing route tests for `GET /schedule`, `PUT /schedule`, dated changes, place issues, and resolve operations. Prove that the caller cannot choose another Hub.
3. Run the focused API tests and confirm the missing operations fail for the expected reason.
4. Implement repository transactions and map database rows through the planning contracts.
5. Register the typed routes with stable, application-owned error behavior.
6. Run both focused suites until they pass.

### Task 4: Make the new plan authoritative in resolution

**Files:**

- Modify: `domains/planning/src/work-location-resolution.ts`
- Modify: `apps/api/src/services/work-location/repository.ts`
- Test: `domains/planning/tests/work-location-resolution.test.ts`
- Test: `domains/planning/tests/work-location-resolution-precedence.test.ts`
- Test: `apps/api/tests/services/work-location/repository.test.ts`

**Steps:**

1. Add failing tests that show a plan segment wins over a legacy assertion, a mobile segment blocks location inference, a dated day-off blocks a weekly legacy assertion, and a version boundary preserves the old answer.
2. Run the focused resolver tests and confirm they fail because resolution state has no plans.
3. Extend resolution state with expanded plan intervals and explicit work states. Keep legacy assertions as the fallback.
4. Load plan versions and exceptions with the rest of the resolution state.
5. Run the focused resolver and repository suites until they pass.

### Task 5: Stop provider labels from creating places

**Files:**

- Modify: `apps/api/src/services/work-location/sync-engine.ts`
- Modify: `apps/api/src/services/work-location/google.ts`
- Test: `apps/api/tests/services/work-location/sync-engine.test.ts`
- Test: `apps/api/tests/services/work-location/google.test.ts`

**Steps:**

1. Add a failing sync test in which `Starbucks N Decatur & 215` arrives after `Starbucks - N Decatur & 215`. Assert that no second place appears and that one unmatched-name item appears.
2. Add a failing test in which an approved alias maps the same remote event to the existing place and produces a dated schedule change.
3. Run the focused sync tests and confirm that the current auto-create behavior fails both expectations.
4. Replace `ensureImportedPlace` with account-scoped alias resolution. Store an unmatched-name item when no alias exists.
5. Apply recognized provider changes as dated schedule replacements. Keep the legacy adoption path only when the user has no canonical plan.
6. Run the sync and Google adapter suites until they pass.

### Task 6: Project plans to connected calendars

**Files:**

- Create: `apps/api/src/services/work-location/schedule-projection.ts`
- Modify: `apps/api/src/services/work-location/sweep.ts`
- Modify: `apps/api/src/services/work-location/sync-engine.ts`
- Test: `apps/api/tests/services/work-location/schedule-projection.test.ts`
- Test: `apps/api/tests/services/work-location/sweep.test.ts`

**Steps:**

1. Add failing tests for weekly recurrence projection, ninety-day rotation expansion, window extension, replacement exceptions, and omission of undecided work.
2. Run the focused tests and confirm the projector does not exist.
3. Implement a pure projection planner. Reuse the existing Google adapter only after the planner has produced provider-neutral assertions.
4. Queue idempotent writes for the active projection window. Give each generated occurrence a stable plan-version and civil-date key.
5. Extend the sweep before fewer than fourteen projected days remain.
6. Run the focused projection and sweep suites until they pass.

### Task 7: Split settings ownership and add nested navigation

**Files:**

- Modify: `apps/web/src/components/settings/settings-registry.ts`
- Modify: `apps/web/src/components/settings/settings-capabilities.ts`
- Create: `apps/web/src/app/(app)/settings/work-schedule/page.tsx`
- Create: `apps/web/src/app/(app)/settings/places/page.tsx`
- Modify: `apps/web/src/app/(app)/settings/work-locations/page.tsx`
- Modify: `apps/web/src/components/work-location/work-location-data.ts`
- Test: `apps/web/tests/components/settings/settings-registry.test.ts`
- Test: `apps/web/tests/work-location/work-locations-settings.test.tsx`

**Steps:**

1. Add failing registry tests for two top-level sections and their nested anchors. Assert that `Calendar sync` is absent.
2. Add failing component tests for one current-plan surface, date-ordered changes, unmatched names under Places, and the automatic-location setup action. Assert that the new pages do not show `Imported`, `Review`, or `Compare`.
3. Run the focused web tests and confirm they fail against the old single page.
4. Add typed query and mutation definitions for the new resources.
5. Build separate Work schedule and Places pages with shared MD3 settings primitives. Turn `/settings/work-locations` into a compatibility redirect to `/settings/work-schedule`.
6. Add the automatic-location recovery flow. Move provider account actions to Connected accounts.
7. Run the focused component and registry suites until they pass.

### Task 8: Build the nested plan editor and reconciliation flows

**Files:**

- Create: `apps/web/src/components/work-location/work-schedule-editor.tsx`
- Create: `apps/web/src/components/work-location/work-schedule-day-editor.tsx`
- Create: `apps/web/src/components/work-location/dated-change-editor.tsx`
- Create: `apps/web/src/components/work-location/place-issues.tsx`
- Modify: `apps/web/src/app/(app)/settings/work-schedule/page.tsx`
- Modify: `apps/web/src/app/(app)/settings/places/page.tsx`
- Test: `apps/web/tests/work-location/work-schedule-editor.test.tsx`
- Test: `apps/web/tests/work-location/place-issues.test.tsx`

**Steps:**

1. Add failing component tests for a default week, a nine-day cycle, split shifts, overnight end display, copying a day, a no-work replacement, alias linking, and ignoring a label.
2. Run the focused tests and confirm the missing editors fail.
3. Implement nested editor views with shared dialog, field, list, and button primitives. Keep actions visible without wrapping at narrow widths.
4. Use `Resolve` for every reconciliation entry. Put the concrete decision in the detail heading.
5. Run the focused editor and issue suites until they pass. Run the settings source-policy tests.

### Task 9: Migrate existing data and preserve clients

**Files:**

- Create: `apps/api/src/services/work-location/legacy-schedule-migration.ts`
- Modify: `apps/api/src/services/work-location/schedule-repository.ts`
- Test: `apps/api/tests/services/work-location/legacy-schedule-migration.test.ts`
- Modify: `docs/core/work-location.md` or the current canonical work-location product spec

**Steps:**

1. Add failing tests for a simple weekly migration, matching weekly rules across several places, one-off conversion, conflicting overlaps, and idempotent reruns.
2. Run the focused migration suite and confirm the converter is absent.
3. Convert compatible assertions on first schedule read inside one transaction. Mark converted assertions as compatibility records instead of deleting them.
4. Leave incompatible assertions active as fallback evidence and return one incoming-change item that explains the required decision with Docket-owned copy.
5. Update the canonical product documentation with the new model and compatibility boundary.
6. Run the migration, route, resolver, and sync suites until they pass.

### Task 10: Verify the complete product slice

**Files:**

- Modify: `apps/web/e2e/settings/work-locations.spec.ts`
- Modify: `apps/web/e2e/settings/work-locations-shots.spec.ts`
- Create: `docs/design/audits/2026-09-05-work-schedule-and-places.md`
- Modify: `docs/WORKLOG.md`

**Steps:**

1. Update the Playwright journey to create and edit a default plan, add a dated change, resolve an unmatched label, and set up automatic location.
2. Run all focused planning, database, API, and web tests with at most two workers.
3. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` with repository-supported concurrency capped at two.
4. Read `docs/engineering/ui-verification.md`, start the supported dev stack, create an authenticated session, and seed the schedule states through the API.
5. Capture 1440 by 900 and 390 by 844 screenshots in light and dark themes. Check 320-pixel overflow and keyboard focus. Record the eight-dimension craft score and any remaining defect.
6. Reset the shared development database through `pnpm db:reset`.
7. Move the worklog entry to completed. Record validation, decisions, and retrospection.
8. Inspect the diff for provider text leaks, unsupported manual surfaces, placeholders, skipped tests, and unrelated changes.
9. Commit the coherent slice with the `work-location` scope and a substantive body. Verify that the commit contains a `Co-authored-by` trailer and that `git rev-list --merges --count origin/main..HEAD` returns zero.

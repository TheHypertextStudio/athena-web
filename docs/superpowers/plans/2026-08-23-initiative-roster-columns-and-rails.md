# Initiative roster columns and rails implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Active Project count from Initiative work views, narrow Health, and stop hierarchy
rails at the correct subtree boundary.

**Architecture:** The typed view contract remains the source of truth for every exposed field. A
custom data migration repairs persisted JSON before the stricter contract reaches production. The
virtualized list continues to draw one SVG per row, but its pure rail derivation omits the immediate
parent from the ancestor-continuation set.

**Tech Stack:** TypeScript, Zod, React, PostgreSQL JSONB, Drizzle migrations, Vitest, Playwright.

---

### Task 1: Record the approved behavior

- [x] Add the approved design under `docs/superpowers/specs/`.
- [x] Add this implementation plan under `docs/superpowers/plans/`.
- [x] Add an active task to `docs/WORKLOG.md`.

### Task 2: Remove the public work-view field

- [x] Add failing contract and API regressions for rejected definitions and omitted response rows.
- [x] Remove the field from the Initiative contract, row schema, API compilers, projection, context
      query, web label map, default columns, fixtures, and fixed-width map.
- [x] Run the focused types and API work-view suites.

### Task 3: Repair persisted definitions

- [x] Add a failing migration regression with saved, default, and personal definitions.
- [x] Generate a custom Drizzle migration and implement recursive JSONB cleanup.
- [x] Run the migration regression and the database migration suite.

### Task 4: Correct roster geometry

- [x] Add failing rail and roster-width regressions.
- [x] Narrow Health to 96px and exclude the immediate parent from ancestor continuation facts.
- [x] Run focused web list, rail, and visual-contract tests.

### Task 5: Validate and close out

- [x] Inspect desktop and narrow Initiative rosters in light and dark themes.
- [x] Run bounded typecheck, lint, tests, and build checks for every affected workspace.
- [x] Request an independent code review and fix all Critical or Important findings.
- [x] Complete the WORKLOG validation and retrospective, then commit the owned change.

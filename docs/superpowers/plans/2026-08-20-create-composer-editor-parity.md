# Create Composer Editor Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every shared object composer the same rich editor, sizing, scrolling, and repeat-creation behavior while repairing collapsed mention results.

**Architecture:** `ComposerShell` owns shared chrome and exposes a typed continuation contract. A small continuation hook owns repeat-mode state, body reset generation, success announcements, and post-mutation focus. Each entity composer keeps its existing mutation and defines the fields cleared after a successful continued create.

**Tech Stack:** React 19, TypeScript, Tiptap, Radix Dialog and Popover, TanStack Query, Vitest, Testing Library, and Playwright.

---

### Task 1: Record the approved contract

**Files:**

- Create: `docs/superpowers/specs/2026-08-20-create-composer-editor-parity-design.md`
- Create: `docs/superpowers/plans/2026-08-20-create-composer-editor-parity.md`
- Modify: `docs/WORKLOG.md`

- [ ] Add the active worklog entry before product edits.
- [ ] Record the approved sizes, reset mapping, error behavior, and boundaries.

### Task 2: Repair mention result groups

**Files:**

- Modify: `apps/web/src/components/mentions/mention-menu.tsx`
- Test: `apps/web/tests/components/mentions/mention-menu.test.tsx`

- [ ] Write a test with three populated groups and prove later group containers receive `h-px`.
- [ ] Run the test directly with `pnpm --filter @docket/web exec vitest run --maxWorkers=2 tests/components/mentions/mention-menu.test.tsx` and confirm the structural assertion fails.
- [ ] Move separator geometry onto presentational children inside each group and cover pending and failed external sections.
- [ ] Rerun the test and confirm it passes.

### Task 3: Fix the shared shell

**Files:**

- Modify: `apps/web/src/components/composer/composer-shell.tsx`
- Create: `apps/web/src/components/composer/use-composer-continuation.ts`
- Test: `apps/web/tests/editor/editor-surface.test.tsx`

- [ ] Write failing tests for compact and expanded sizes, stable draft and focus, fixed shell overflow, editor-only scrolling, overscroll containment, destination mentions, and the typed continuation switch.
- [ ] Add `mentionOrgId` and `continuation` to `ComposerShellProps`; remove the Task-only leading-action API.
- [ ] Add per-open expansion state without remounting the editor.
- [ ] Wrap destination-aware body editors in mention hydration and make the editor the only scroll container.
- [ ] Add the continuation hook and rerun the focused shell tests.

### Task 4: Apply editor parity to body-bearing composers

**Files:**

- Modify: body-bearing object and template composers under `apps/web/src/components/`
- Test: `apps/web/tests/editor/slash-commands.test.tsx`
- Test: composer suites under `apps/web/tests/composers/`

- [ ] Pass each current destination `orgId` into `ComposerShell`.
- [ ] Prove slash commands still open and mentions follow a changed destination without replacing text.
- [ ] Verify template editors expand and mention resources but expose no Create more switch.

### Task 5: Generalize Create more

**Files:**

- Modify: Task, Project, Initiative, Program, Team, and Cycle create composers
- Modify: `apps/web/src/components/create-object/create-object-completion.ts`
- Test: the six composer suites and `apps/web/tests/create-object/create-object-provider.test.tsx`

- [ ] Write failing continuation tests for each object before changing its mutation.
- [ ] Keep the existing Task reset and committed-object recovery.
- [ ] Add exact Project, Initiative, Program, Team, and Cycle reset behavior from the design table.
- [ ] Run completion effects for every success with navigation disabled only while continuing.
- [ ] Prove failures keep drafts, repeated clicks cannot duplicate creates, and keyboard continuation does not toggle the switch.

### Task 6: Browser and repository validation

**Files:**

- Modify: `apps/web/e2e/work/mentions-shots.spec.ts`
- Modify: `apps/web/e2e/athena/verify-composer.spec.ts`
- Modify: `docs/WORKLOG.md`

- [ ] Check mention row rectangles at narrow width and 200% root text scale in both themes.
- [ ] Check compact-to-expanded geometry and non-chaining editor scroll.
- [ ] Run focused Vitest with `--maxWorkers=2` and Playwright with `--workers=1`.
- [ ] Run formatting, typechecking, lint, tooling tests, the full test graph, and production build with package concurrency capped at two.
- [ ] Complete the worklog retrospective and commit narrow green slices with the `web` scope.

# Interaction Migration and Zero-debt Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every audited production interaction to the shared responsiveness and mutation contracts, then close both ledgers with browser evidence for all critical paths.

**Architecture:** Domain hooks adopt the three mutation lifecycles; components consume scoped status rather than global pending booleans. Navigation, reads, local controls, and direct manipulation use their category adapters or documented synchronous owners. The generated source inventory and mutation inventory ratchet to zero, and deterministic production-build browser journeys prove acknowledgement, continuity, focus, accessibility, settlement, and recovery.

**Tech Stack:** Next.js, React, TypeScript, TanStack Query, Vitest, Testing Library, TypeScript compiler API, Playwright.

## Status note — 2026-08-12

A separate branch (`PERF-001` in `docs/WORKLOG.md`) fixed the reported symptoms without running
this program. It overlaps three of the findings below and leaves the rest open.

**Satisfied in part:**

- Task 2 / Task 7 — the inline task composer no longer disables its field or awaits before
  clearing; each submission captures its own title, and a refusal returns it.
- Task 7's navigation category — the responsive navigation seam has a consumer at last
  (`NavigationProgress`), and the create composers route through it. The remaining ~50 raw
  `useRouter` call sites are untouched.
- Task 5 in name only — the composers gained `aria-busy`, but their draft is still locked while
  its own create is in flight. That is deliberate: with one draft in flight, a field edited after
  submitting would show a change the created object does not have. Relaxing it needs the
  pending-insert lifecycle, not a relaxed `disabled`.

**Still open:** everything else, including Task 1's generated inventory and debt ledger, Tasks 3–4
and 6, Task 8's browser matrix, and the required responsiveness CI job. The mutation primitives
plan is likewise still at Task 1 of 7 — only the pure intent journal exists; `useInstantMutation`,
`usePendingInsert` and `useConfirmedMutation` have not been built.

Separately, one premise below did not survive contact: the shell's account and agenda placeholders
already resolve on a single shared identity signal rather than on independent clocks.

## Global Constraints

- Migrate by coherent product domain and keep every commit green.
- Preserve newer intent/drafts under out-of-order settlement and authoritative cache refresh.
- Never disable a list, section, composer, or sibling property for one pending operation.
- Keep overlays, drawers, and menus opening synchronously; load unknown content inside stable geometry.
- Every production boundary must appear in the interaction manifest and every mutation in the typed lifecycle inventory before the final ledger is empty.
- No allowlist entry may stand in for migratable debt; closed exceptions are limited to framework/auth/external handoff behavior with explicit evidence.

## Program Order

1. Start after Interaction Responsiveness Foundation Tasks 1–2, Replay-safe Writes Tasks 1–6, and Intent-preserving Mutation Primitives Tasks 1–4 are green.
2. Start critical 100ms browser assertions only after Interaction Responsiveness Foundation Task 7 is green.
3. A domain with replayable writes may migrate only after Replay-safe Writes Task 7 has adopted its exact route operations.
4. The checked-in generated inventory from Task 1 supplies the exact production/test path matrix for Tasks 2–7; no migration task may start with an unclassified or path-less entry.

---

### Task 1: Populate the mutation slice of the single interaction policy

**Files:**

- Modify: `packages/test-utils/src/interaction-inventory.ts`
- Modify: `packages/test-utils/tests/workspace-policies/web-interaction-responsiveness-policy.test.ts`
- Modify: `apps/web/src/lib/interactions/interaction-responsiveness-manifest.ts`
- Modify: `apps/web/src/lib/interactions/interaction-inventory.generated.ts`
- Modify: `apps/web/src/lib/interactions/interaction-debt.json`

- [ ] Extend the single policy with failing hostile-fixture tests for raw `useMutation`, production `useApiMutation`, async JSX transport, request-pending routine disablement, whole-record rollback, and await-then-clear draft ownership.
- [ ] Generate a checked-in exact path/domain/route/test-evidence matrix for every mutation entry; this artifact is the bounded source for Tasks 2–7.
- [ ] Require every mutation entry in the common manifest to name lifecycle, interaction receipt, and component/browser evidence.
- [ ] Run the single focused policy to green with a one-way initial ratchet and commit the enforcement slice.

### Task 2: Task property, rename, and detail composers

**Files:**

- Modify: `apps/web/src/lib/use-task-mutations.ts`
- Modify: `apps/web/src/lib/use-rename-task.ts`
- Modify: `apps/web/src/components/task-detail/Subtasks.tsx`
- Modify: `apps/web/src/components/task-detail/CommentActivityFeed.tsx`
- Modify: `apps/web/src/components/task-detail/TaskAttachments.tsx`
- Modify: `apps/web/src/lib/use-attachments.ts`
- Modify: `apps/web/tests/lib/use-task-mutations.test.tsx`
- Create: `apps/web/tests/lib/use-rename-task.test.tsx`
- Create: `apps/web/tests/components/task-detail-submissions.test.tsx`
- Create: `apps/web/tests/lib/use-attachments.test.tsx`

- [ ] Add deferred tests for independent fields, rapid same-field edits, status side effects, list/detail consistency, newer-draft preservation, rapid subtasks/comments/URL attachments, upload exclusion, and recovery.
- [ ] Replace whole-record snapshots with field journal projections and pending inserts.
- [ ] Remove global Task property pending locks and await-then-clear behavior.
- [ ] Run focused Task suites and critical browser journeys to green.
- [ ] Reduce the mutation debt ledger and commit the Task domain.

### Task 3: Project properties, renames, milestones, and updates

**Files:**

- Modify: `apps/web/src/lib/use-project-mutations.ts`
- Modify: `apps/web/src/lib/use-project-milestones.ts`
- Modify: `apps/web/src/components/project-detail/project-milestones.tsx`
- Modify: `apps/web/src/components/entity-detail/updates-panel.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/projects-client.tsx`
- Modify: `apps/web/tests/lib/use-project-mutations.test.tsx`
- Modify: `apps/web/tests/components/project-detail/project-milestones.test.tsx`
- Modify: `apps/web/tests/components/updates-panel.test.tsx`
- Create: `apps/web/tests/components/project-list-rename.test.tsx`

- [ ] Add failing tests for field-scoped edits, list rename, rapid milestone insert, per-row update/delete, non-blocking date pickers, update draft ownership, and refusal recovery.
- [ ] Migrate Project mutations to instant edit/pending insert/confirmed transition primitives.
- [ ] Split milestone status by submission/entity and keep unaffected controls usable.
- [ ] Run Project suites and browser evidence to green, ratchet debt, and commit the domain.

### Task 4: Program, Initiative, and Cycle domains

**Files:**

- Modify: `apps/web/src/lib/use-program-mutations.ts`
- Modify: `apps/web/src/lib/use-initiative-mutations.ts`
- Modify: `apps/web/src/lib/use-cycle-mutations.ts`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/programs/programs-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/cycles/cycles-client.tsx`
- Create: `apps/web/tests/lib/use-program-mutations.test.tsx`
- Create: `apps/web/tests/lib/use-initiative-mutations.test.tsx`
- Create: `apps/web/tests/lib/use-cycle-mutations.test.tsx`
- Create: `apps/web/tests/components/domain-list-renames.test.tsx`

- [ ] Add failing hook/list tests for same-turn properties, rename continuity, concurrent fields, stale settlement, create/update feeds, and recovery.
- [ ] Migrate each domain separately and remove invalidate-only known-value renames.
- [ ] Run each focused domain suite before reducing its debt entries and committing.

### Task 5: Full creation composers and immutable draft ownership

**Files:**

- Modify: `apps/web/src/components/composer/composer-shell.tsx`
- Modify: `apps/web/src/components/tasks/create-task.tsx`
- Modify: `apps/web/src/components/projects/create-project.tsx`
- Modify: `apps/web/src/components/programs/create-program.tsx`
- Modify: `apps/web/src/components/initiatives/create-initiative.tsx`
- Modify: `apps/web/src/components/teams/create-team.tsx`
- Modify: `apps/web/src/components/cycles/create-cycle.tsx`
- Modify: `apps/web/tests/composers/create-task.test.tsx`
- Modify: `apps/web/tests/composers/create-project.test.tsx`
- Modify: `apps/web/tests/composers/create-program.test.tsx`
- Modify: `apps/web/tests/composers/create-initiative.test.tsx`
- Modify: `apps/web/tests/composers/create-team.test.tsx`
- Create: `apps/web/tests/composers/create-cycle.test.tsx`
- Modify: `apps/web/tests/composers/composer-reset.test.tsx`

- [ ] Add held-submit tests proving only exact duplicate submission blocks while title/body/pickers remain editable.
- [ ] Add tests proving an older success cannot close or clear a changed draft and `Create more` retains the intended property snapshot.
- [ ] Capture immutable draft/version at activation and settle only that owner.
- [ ] Run every composer suite, ratchet debt, and commit the composer slice.

### Task 6: Settings and administrative controls

**Files:**

- Modify: `apps/web/src/app/(app)/orgs/[orgId]/settings/work-structure/page.tsx`
- Modify: `apps/web/src/app/(app)/settings/notifications/page.tsx`
- Modify: `apps/web/src/components/settings/notification-preferences-section.tsx`
- Modify: `apps/web/src/components/settings/google-calendar-settings.tsx`
- Modify: `apps/web/src/components/settings/use-mail-ingest-controller.ts`
- Modify: `apps/web/src/components/settings/mail-ingest-row.tsx`
- Modify: `apps/web/src/components/settings/integration-config-panel.tsx`
- Modify: `apps/web/src/components/settings/workspace-general-settings.tsx`
- Modify: `apps/web/src/app/(app)/settings/athena/page.tsx`
- Modify: `apps/web/src/app/(app)/settings/calendar/page.tsx`
- Modify: `apps/web/src/app/(app)/settings/profile/page.tsx`
- Modify: `apps/web/src/app/(app)/settings/athena/lattice-section.tsx`
- Modify: `apps/web/src/components/settings/connected-apps-tab.tsx`
- Modify: `apps/web/src/components/settings/danger-zone-tab.tsx`
- Modify: `apps/web/src/components/settings/delete-account-dialog.tsx`
- Modify: `apps/web/src/components/settings/export-data-tab.tsx`
- Modify: `apps/web/src/components/settings/linear-agent-install-card.tsx`
- Modify: `apps/web/src/components/settings/mcp-connectors-section.tsx`
- Modify: `apps/web/src/components/settings/notion/use-notion-mirror-controller.ts`
- Modify: `apps/web/src/components/settings/passkeys-section.tsx`
- Modify: `apps/web/src/components/settings/sessions-section.tsx`
- Modify: `apps/web/src/components/settings/use-integrations-data.ts`
- Modify: `apps/web/src/components/settings/use-members-mutations.ts`
- Modify: `apps/web/tests/components/settings/notification-preferences-section.test.tsx`
- Modify: `apps/web/tests/components/settings/google-calendar-settings.test.tsx`
- Modify: `apps/web/tests/components/settings/mail-ingest-section.test.tsx`
- Modify: `apps/web/tests/components/settings/integration-config-panel.test.tsx`
- Create: `apps/web/tests/app/settings/work-structure.test.tsx`
- Create: `apps/web/tests/components/settings/settings-autosave-ownership.test.tsx`
- Create: `apps/web/tests/components/settings/confirmed-settings-actions.test.tsx`

- [ ] Add failing tests for immediate selected values, per-control synchronization, neighboring availability, rollback/recovery, and out-of-order responses.
- [ ] Migrate routine settings to field-scoped intent; reserve confirmed lifecycle for destructive/permission-sensitive operations.
- [ ] Remove shared-section pending disables and invalidate-only presentation.
- [ ] Run settings suites, ratchet debt, and commit the settings slice.

### Task 7: Remaining navigation, reads, local controls, and gestures

**Files:**

- Modify: exact production and evidence paths emitted by `interaction-inventory.generated.ts`

- [ ] Migrate all raw product router calls to the responsive navigation seam, leaving only closed framework/auth exceptions.
- [ ] Migrate query-backed filters/searches to immediate local state plus retained useful content.
- [ ] Register synchronous menu/dialog/tab/select owners and prove focus move/restore without wrapping them in fake async lifecycles.
- [ ] Add manifest-backed two-second pointer and keyboard fixtures for drag/reorder/resize, asserting every synthesized step publishes its preview by the next frame, the final projection persists through deferred settlement, and no 50ms Long Task occurs.
- [ ] Add separate manifest-backed typing, scrolling, and expensive-local-transform fixtures with per-step next-frame visual assertions.
- [ ] Add long-running accepted/progress/sustained states for imports, exports, provider handshakes, and agent runs.
- [ ] Reconcile manifest/evidence after each category and commit coherent category slices.

### Task 8: Empty ledgers and critical browser matrix

**Files:**

- Modify: `apps/web/src/lib/interactions/interaction-debt.json`
- Modify: `apps/web/e2e/responsiveness/*.spec.ts`
- Modify: `apps/web/src/lib/interactions/interaction-responsiveness-manifest.ts`

- [ ] Make the common interaction debt ledger structurally empty across both async-interaction and mutation slices, and reject any future non-empty entry in CI.
- [ ] Prove every generated source boundary has exactly one owner and non-orphaned test evidence.
- [ ] Cover critical categories at desktop/mobile widths, pointer/keyboard, both themes where visual status differs, and reduced motion.
- [ ] Hold relevant transport for 2.5s, assert painted acknowledgement within 100ms across three measured samples, continue with a second action, then test success/refusal/retry/discard.
- [ ] Retain trace, screenshots, receipt timeline, Event Timing, and Long Task diagnostics for every budget failure.

### Task 9: Final documentation, retrospective, and release gates

**Files:**

- Modify: `docs/engineering/specs/data-layer.md`
- Modify: `docs/engineering/specs/design-system.md`
- Modify: `docs/engineering/launch-compliance.md`
- Modify: `docs/WORKLOG.md`

- [ ] Document the final manifest/inventory policy, lifecycle decision table, accessibility contract, exception process, and browser budget.
- [ ] Run focused production-build responsiveness tests, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- [ ] Run the source-policy generation/check command twice and prove no generated diff or debt remains.
- [ ] Self-review every audited P0/P1/P2 surface against the written specification and record the retrospective/learnings.
- [ ] Verify linear history with `git rev-list --merges --count origin/main..HEAD` equal to `0` and commit the final closeout atomically.

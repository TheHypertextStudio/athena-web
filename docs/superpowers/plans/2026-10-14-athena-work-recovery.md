# Athena work recovery and work templates implementation plan

**Goal:** Recover useful unfinished work without loss, then deliver versioned work templates,
composed blueprints, Program schedules, and reviewed Athena proposals.

**Spec:** [Work templates overview](../specs/2026-09-14-work-templates-overview-design.md).

## Constraints and decisions

Preserve refs, staged/unstaged changes, untracked files, and needed ignored captures privately
before integration or retirement. Recover missing behavior rather than replaying superseded work.
Keep typed queries, shared UI, tenant authorization, supported REST/MCP clients, and the existing
scheduler. Personal templates become author-only unpublished drafts. Existing team-only templates
remain team-visible unpublished drafts until explicitly published. Published versions are
immutable. One transactional blueprint creation produces at most 500 items. Product copy says
Work templates or template; code may use work_type. Per-template properties, status sets, and
completion rules follow the four delivery layers. Use linear history and one push per delivery.

## Task 1: Preserve and reconcile checkout state

- [x] Preserve refs, detached heads, staged/unstaged binary patches, untracked files, and captures.
- [x] Verify reconstructed tracked trees, archive file hashes, and complete Git bundles.
- [x] Give every checkout and candidate branch a recoverable disposition.
- [x] Quarantine broad dirty deletion snapshots and classify every unique file group.
- [ ] Retire only clean, unused checkouts with landed, superseded, or recoverably archived work.

## Task 2: Recover existing template and repeating-work UI

- [x] Replay guided setup and its two layout corrections onto current main.
- [x] Preserve Basics/Work/Review, direct editing, repeat setup, and shared series management.
- [x] Verify four kinds, vocabulary, sharing, dirty dismissal, failure retention, save/reopen,
      recurrence revisions, pause/resume, history, focus, and ordinary composers.
- [x] Capture populated authenticated desktop/phone/short-phone layouts in both themes and check
      keyboard interaction and 320px overflow using existing repository tools.
- [x] Review, document, commit, and integrate the accepted slice.

## Task 3: Recover remaining product slices

- [x] Recover missing relation-tool, placement, initiative-planning, and undo behavior.
- [x] Reconcile initiative connected-work creation/hierarchy and daily planning corrections.
- [x] Recover the daily-workload MCP App as a separate validated capability.
- [ ] Reconcile calendar/time/agenda, editor/navigation, people/team placement, ingestion, and
      API coverage candidates against current behavior; explain every superseded candidate.

## Task 4: Maintenance and operational acceptance

- [ ] Reconcile overlapping complexity refactors without raising debt or hiding violations.
- [ ] Reconcile bootstrap/cache adoption, CI, domains, release provenance, and native distribution.
- [ ] Recheck Workers/Mintlify, MCP interruption recovery, daily planning, Android inbound
      correlation, and billing evidence. Finish authorized independent work and identify exact
      external blockers. Historical worklog status does not establish current acceptance.

## Task 5: Work-template identity

- [x] Complete the detailed engineering specification and migration plan before coding.
- [x] Add identity, immutable published versions, and base templates for all four work kinds.
- [x] Convert workspace/team/private/seeded templates; batch-backfill existing work, then enforce
      required template/version associations. Imports and connectors receive base templates.
- [x] Add composer selection, New actions, row/header identity, filter/group support, settings,
      contributor policy, Change template, MCP discovery/creation, and compatibility adapters.
- [x] Prove an Event project retains identity after reopening and groups correctly by template.

## Task 6: Composed blueprints

- [ ] Specify and implement nested/pinned versions, optional steps, dependencies, assignment/team/
      cycle rules, relative timing, working weekdays, provenance, and manual date markers.
- [ ] Expand transactionally, rejecting loops and creation beyond 500 items before writes.
- [ ] Preserve manual dates, fill missing-anchor dates, and recalculate unpinned child dates.
- [ ] Add publishing, update/change-template previews, Save as template, and safe archiving.
- [ ] Migrate process definitions/instances without losing work or history.

## Task 7: Program schedules

- [ ] Specify and implement template-backed schedules using existing series/runs/exceptions.
- [ ] Add Program schedules, title patterns, step overrides, calendar anchors, failed-run recovery,
      and standalone repeats. Verify migrated data before removing legacy process tables.
- [ ] Prove recurring community-dinner creation, moves, retries, pause/resume, and history.

## Task 8: Athena and gallery

- [ ] Specify and implement curated installation/copying with origin/version provenance and
      explicit update previews; copies remain independently owned.
- [ ] Add Pro-gated Athena authoring/onboarding suggestions through ordinary authorization,
      Inbox review, adjustment, and undo. Preserve labels until conversion is confirmed.
- [ ] Prove a nonprofit workspace receives, inspects, keeps, and undoes an Event-template proposal.

## Validation and review

Run affected tests, typechecks, lint, complexity checks, and builds. Use real PostgreSQL for
migration ordering and retained-data validation. Keep scheduler suites passing through migration.
Test tenant isolation, permissions, concurrency, retries, version immutability, and partial-failure
recovery. Require current authenticated runtime/provider evidence for releases and a separate
final review before integration. Keep private inventory and operational evidence outside history.

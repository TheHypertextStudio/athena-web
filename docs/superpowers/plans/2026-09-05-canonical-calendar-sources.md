# Canonical Calendar Sources And Events Implementation Plan

> **For Codex:** REQUIRED SKILL: Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Show one logical calendar and event across connected accounts while preserving provider
identity, Docket metadata, and a future Microsoft adapter boundary.

**Architecture:** Provider adapters emit opaque source, event, and occurrence identities plus source
management capabilities. The sync engine persists them and soft-removes missing sources. A shared
calendar-domain resolver derives exact source groups, applies confirmed groups and preferences, and
canonicalizes occurrences before API serialization. Settings manages logical sources. Calendar,
Agenda, Today, and item details receive only canonical output.

**Authoritative design:**
`docs/superpowers/specs/2026-09-05-canonical-calendar-sources-design.md`

## Task 1: Add provider-neutral identities and persistence

Write failing schema and contract tests for source identity, event identity, recurring occurrence
identity, source relationship, management capability, and soft removal. Add the Drizzle columns and
source-group tables. Generate the migration through the repository script. Backfill Google rows from
`provider_raw` without using title or time. Update the planning contracts and exported TSDoc.

Verify the database package, planning domain, migration policy, and focused type checks.

## Task 2: Extend the provider adapter contract

Write failing adapter tests for Google calendar identity, `iCalUID`, `originalStartTime`, local-only
fallback identity, likely-group keys, and remove capability. Add a fake second provider adapter test
that uses different wire field names and satisfies the same shared contract. Extend the Google wire
types and adapter mapping. Keep provider normalization inside the adapter.

Verify adapter and sync-engine suites.

## Task 3: Canonicalize sources and events on the server

Write failing domain tests for exact source groups, confirmed groups, preference order, recurrence,
case-sensitive opaque values, title collisions, and cross-provider identities. Implement the pure
resolver. Integrate it into range reads, item detail, task-link aggregation, relation reads, Agenda,
and Today. Delete title-and-time matching from the web helper and remove client-only source-copy
metadata.

Verify domain, API read, Agenda, Today, and web calendar suites.

## Task 4: Reconcile and soft-remove sources

Write failing sync tests that prove a full source-list reconciliation marks missing sources removed,
stops their watches, retains their items and links, and revives the same rows when the source
returns. Implement reconciliation only for complete source-list responses. Filter removed sources
from reads and settings.

Verify sync, database integration, and settings-read suites.

## Task 5: Add logical source-group APIs

Write failing route tests for settings groups, combine suggestions, confirmed group creation,
separation, preferred-source changes, and atomic visibility. Implement user-scoped services and
OpenAPI contracts. Reject cross-user layers and group-member conflicts.

Verify route, contract, and OpenAPI suites.

## Task 6: Add provider source removal and incremental consent

Write failing adapter and route tests for supported removal, protected primary and owner sources,
pending writes, conflicts, missing scope, wrong account, idempotent provider absence, provider
failure, watch shutdown, and local soft removal. Add the optional
`removeSourceSubscription` capability. Add Google CalendarList removal and the narrow incremental
scope flow. Preserve the final confirmation after redirect.

Verify OAuth, adapter, route, and error-copy policy suites.

## Task 7: Replace settings and product-surface copy

Write failing component tests for one logical settings row, the compact **2 accounts** indicator,
source expansion, preferred selection, suggested combine flow, separation, and provider removal.
Update the Google settings surface and compact Calendar source controls. Remove “Also on,” copy
counts, and deduplication language from Calendar, Agenda, Today, and item details.

Verify component and accessibility suites.

## Task 8: Prove complete behavior in the browser

Update Playwright fixtures so two connected Google accounts expose the same personal calendar and
same event. Assert that Calendar, Agenda, Today, and item details show one event with no source-copy
language. Assert that settings alone shows the source count and expanded account rows. Capture the
populated settings state at 1440 by 900 and 390 by 844 in both themes, plus the 320-pixel overflow
check, through the repository's documented UI verification path.

Run root `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and the relevant Playwright suite
with concurrency bounded at two. Complete the WORKLOG entry, review the diff, and commit atomic
feature slices with the declared `time` scope.

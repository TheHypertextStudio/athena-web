# Task 1 — Pure field-version intent journal

## Status

Complete in the focused mutation primitive commit. The journal applies local field edits synchronously,
serializes delivery per field, and preserves newer overlays when older work settles.

## Delivered behavior

- Field identity is scoped by entity/query key plus field, so sibling fields remain independent.
- Local projection is published before transport settles; queued edits coalesce to the newest value.
- Success updates the authoritative base and removes only the owning live intent; stale settlements cannot
  clear a newer version.
- Fresh authoritative values reconcile beneath a live overlay. Refusals remain `needs_attention` until
  retry or discard, and discard restores the latest authoritative value.
- The module has no React, query, transport, or user-facing copy dependency.

## Test-first evidence

The focused suite first failed with the expected missing-module import. It now covers immediate projection,
field independence, out-of-order protection, coalescing, authoritative reconciliation, refusal recovery,
subscriber delivery, and settled-entry cleanup.

## Validation

- `pnpm --filter @docket/web exec vitest run tests/lib/mutations/intent-journal.test.ts` — 5 passed
- `pnpm --filter @docket/web typecheck` — passed
- Scoped ESLint for the five owned source/test files — passed

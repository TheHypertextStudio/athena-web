# MCP Library writes implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution. Repository instructions
> authorize proceeding with this plan and require local validation before committing.

**Goal:** Upload and attach usable context to all four work types through MCP.

**Architecture:** Destination-owned attachment snapshots, canonical external links, and atomic retry
receipts. One application service supplies MCP writes and a shared REST management surface.

**Tech stack:** Existing TypeScript, Zod, Drizzle/Postgres, MCP SDK, Hono and typed React Query.

**Spec:** `docs/superpowers/specs/2026-10-26-mcp-library-writes-design.md`

## Global constraints

- Support task, project, program, initiative; retain 4,194,304-byte file ceiling and current entitlements.
- Check source visibility and destination contribution independently; no cross-workspace copies.
- Never echo bytes, private attachment metadata, integration identifiers or storage keys in MCP output.
- Persist retry receipts with the attachment, retain removed-write identity, clean up failed blob writes.
- No new pricing promise, provider, production mutation, or complexity debt.

## Review focus

- Concurrent identical requests must leave one blob and attachment.
- Revoked permissions and removed attachments must not be revived by replay.
- Reused files must survive deletion of their source and have the destination audience.
- Provider-only attachment kinds must not copy integration credentials or private metadata.
- Program files must be discoverable, downloadable and removable in the ordinary product surface.

## Task 1: Resource write service and MCP tools

**Files:** New `apps/api/src/content/resource-write*.ts`, `apps/api/src/contracts/resource-write.ts`,
`apps/api/src/mcp/resource-write-tools.ts`, `packages/db/src/schema/resource-write.ts`, migration 0187;
modify attachment subject contracts, Library readers, MCP registration/scope. Tests:
`apps/api/tests/mcp/library-writes.test.ts` and `apps/api/tests/mcp/library-write-errors.test.ts`.

- [x] Write integration tests for all subjects, byte round trips, permissions, bounds, snapshots,
      retry identity/conflicts/concurrency and removal. Run the tests and observe missing-tool failures.
- [x] Add additive migration and atomic per-workspace/actor/request receipts; implement current
      target authorization, strict upload decoding, source snapshots and safe result projections.
- [x] Register `upload_resource` and `attach_resource` under `work:write` and rerun targeted tests,
      existing Library and scope/catalog tests.

## Task 2: Usable resource management

**Files:** New `apps/api/src/routes/work-resources.ts`, shared web resource hook/panel; modify org route
mount and project/initiative/program resource rendering; keep the existing shared ResourcesTab.

- [x] Add REST tests for list/download/remove across all four subject kinds, exact subject matching,
      download headers and source-independent lifetime.
- [x] Implement generic resource management routes using the same subject checks and blob lifecycle.
- [x] Connect a shared typed query panel to all four work pages; add Program Resources navigation.
- [x] Test and inspect seeded resource views at phone/desktop widths in both themes through the
      documented guarded dev stack. Reset the shared dev database after stopping it.

## Task 3: Delivery evidence and documentation

- [x] Update README and MCP reference with exact inputs, limits, sharing/snapshot semantics and
      retry behavior; document product/business tradeoffs without claiming production availability.
- [x] Run affected package checks/builds and unchanged complexity gate under the capacity guard.
- [x] Independently review permissions, migration, retries, cleanup, rendered behavior and final diff.
- [x] Complete WORKLOG validation/retrospection and commit the coherent slice using repository hooks.

## Delivery notes

The implementation also preserves published comment/update files as readable Library sources while
keeping private drafts outside Library reuse. It reuses the shared attachment cleanup queue, adds
container-deletion coverage, retains the existing local-model catalog ceiling, and makes resource
controls usable with enlarged text. Migration 0185 follows the concurrent demo-workspace migration.

CI footprint: one new browser regression runs inside the existing Chromium suite, with one account
and four work destinations. Its measured local run took 16 seconds with a saved session. No new
workflow trigger, runner job, provider, dependency, pricing tier or complexity exemption was added.

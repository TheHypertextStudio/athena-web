# Unified resumable uploads implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Repository instructions authorize proceeding without a plan approval pause.

**Goal:** Upload files up to 100 MiB once through a resumable lifecycle for work resources and private comment/update deliverables.

**Architecture:** Storage owns bounded byte transfer, metadata, streams and independent copies. A shared application session owns authentication, retry identity, reservations and atomic publication. REST, MCP and browser clients use that same session.

**Tech Stack:** TypeScript, Hono, Zod, Drizzle/PostgreSQL, Google Cloud Storage, local disk, TanStack Query, Vitest and Playwright.

**Spec:** docs/superpowers/specs/2026-10-26-unified-resumable-uploads-design.md

## Global Constraints

- 100 MiB file ceiling; 4 MiB inline and legacy body ceiling; 8 MiB chunks.
- Unfinished sessions expire after 24 hours; completed receipts remain until workspace deletion.
- Same actor, performer and client own retries; reauthorize destination at completion.
- No deployment, provider configuration changes, new billing policy or PR operations.
- Run tests/builds under disk-janitor guard with the required external scratch ownership.

## Review Focus

- A lost last-chunk or completion response recovers without duplicating a resource.
- Cancellation racing completion never deletes accepted bytes.
- A posted or deleted draft cannot be recreated by replaying its upload.
- Permission revocation and a different OAuth client cannot publish/recover a pending upload.
- Large downloads and Library copies never call whole-object get().

### Task 1: Bounded storage transfer

**Files:** packages/blob-store/src/{index,transfer,local-transfer,gcs-transfer}.ts, existing adapters, packages/blob-store/tests/transfers/*.test.ts; domains/work upload contracts/checksum.
**Interfaces:** BlobStore.transfer exposes begin, status, cancel, stat, stream and copy; local transfer additionally accepts bounded chunks. CRC32C is incremental and portable.

- [x] Write tests for CRC32C vectors, local interrupted continuation, overlap rejection, completion integrity, streamed range and independent copy; GCS SDK creation metadata/preconditions and probe/cancel responses.
- [x] Run focused blob tests; expect missing capability failures.
- [x] Implement provider/local transfer ports and the shared 100 MiB contract.
- [x] Run blob tests/typecheck/lint; expect passing. Record storage evidence for the coherent delivery commit.

### Task 2: One private upload lifecycle

**Files:** packages/db/src/schema/file-upload.ts and migration 0188; apps/api/src/content/upload-{session,completion,cleanup,crypto}.ts; apps/api/src/contracts/uploads.ts; routes/uploads.ts and upload-bytes.ts; mcp/uploads.ts and registration; existing resource/deliverable adapters, cleanup scheduler and streaming routes.
**Interfaces:** beginUpload(org,actor,input), readUpload(org,actor,id), completeUpload(org,actor,id), cancelUpload(org,actor,id); return a validated UploadSessionOut with optional capability and accepted file metadata. Work completion inserts resource audit/index jobs; draft completion retains current post-claim semantics.

- [x] Write API tests for all four destinations, private draft/post claim, replay/conflicts, 100 MiB validation, bounded reservations, expired/cancelled sessions, checksum mismatch, revoked access and client ownership.
- [x] Run focused API tests; expect missing session behavior failures.
- [x] Implement durable reservations, encrypted capabilities, current authority, provider integrity and locked completion/cleanup. Retain completed receipts. Route small adapters through the same lifecycle, preserving issued legacy tokens.
- [x] Add one compact MCP management tool and authenticated REST operations. Stream reads with single ranges; use storage-side Library copies.
- [x] Run affected API/DB/domain tests, typechecks and lint; expect passing. Include the migration and API docs in the coherent delivery commit.

### Task 3: Shared browser transfer and acceptance

**Files:** apps/web/src/lib/resumable-upload.ts, deliverable-upload-queue.ts, use-work-resources.ts, typed query definitions and existing resource upload UI; focused web tests and e2e/work/{deliverables,work-resources}.spec.ts; README and WORKLOG.
**Interfaces:** transferFile(file, destination, stableRequestId, signal, onProgress) returns accepted DeliverableOut; both resource and post flows retain the same session across retry.

- [x] Write browser tests for acknowledged partial progress, lost final response, pause/retry, provider credential isolation and changed-file conflicts.
- [x] Run focused tests; expect missing transport behavior failures.
- [x] Implement shared bounded checksum/chunk transfer, typed metadata requests, status probes and completion. Update limits/progress while preserving existing composer interactions.
- [x] Run relevant web tests/typecheck/lint/build. Use the established guarded dev stack for a real file above 4 MiB, interrupted continuation, all work types and comment/update claim, downloads and media ranges.
- [x] Review the rendered upload states in both themes; update docs with actual evidence and cost implications. Request one fresh whole-branch code review, fix substantive findings, commit the coherent slice.

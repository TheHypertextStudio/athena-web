# Unified resumable file uploads

## Outcome and scope

Use one upload lifecycle for files attached directly to tasks, projects, programs and initiatives,
and for private files later claimed by a comment or update. The user selected a 100 MiB per-file
ceiling. Preserve the existing small inline MCP inputs and legacy multipart entry points as adapters.
No production deployment, bucket/IAM change or new pricing tier is authorized by this implementation.

## Approaches

1. Increase buffered JSON/multipart limits: little initial work, but retains full-file memory use,
   repeats interrupted transfers and grows MCP context. This does not meet the requested outcome.
2. Proxy resumable chunks through the application: uniform deployment, but retains application
   bandwidth and duration costs. Keep this only as the local provider's protocol implementation.
3. Use storage-backed resumable sessions and one application completion transaction. This follows
   the previously discussed design, reuses private Google Cloud Storage, and keeps binary bytes out
   of MCP. This is the implementation choice; no second provider is introduced.

Repository instructions authorize proceeding with a documented plan. Engineering defaults below are
implementation decisions, not additional user agreements.

## Shared contract

A session binds workspace, authorizing actor, verified performer/client, filename, MIME type, title,
expected byte size and CRC32C integrity checksum, stable request ID, and destination. Destination is
one work resource reference or a private post draft. A reserved attachment ID and opaque blob key
remain stable. The session is recovered only by that same owner; capabilities are not saved in prose,
audit metadata, error text or logs. Persist provider bearer URIs encrypted using the existing runtime
secret with a dedicated upload purpose; never fall back to plaintext storage.

Authenticated REST and one MCP management tool expose begin/status/complete/cancel. Begin is
idempotent for identical normalized input and conflicts on changed input. Unfinished sessions expire after
24 hours. Completed receipts survive until workspace deletion, including after attachment removal. Keep the existing 30-new-writes/minute/workspace safety rate, and bound pending reservations
to 1 GiB per workspace. These are operational safety limits, not a new paid storage entitlement.
Existing workspace entitlement and destination permissions remain authoritative.

The returned upload URL uses the provider's resumable PUT protocol: bounded chunks, Content-Range,
308/Range acknowledgements, and a zero-body status probe. Clients resume from acknowledged bytes,
including after uncertain responses. The recommended chunk is 8 MiB; clients must not assume the
whole previous request arrived. The local disk adapter implements the same protocol with bounded
chunk writes, so local browser acceptance covers actual interruption and continuation.

## Completion and visibility

Before exposing a file, lock the session, recheck current ownership, entitlement and destination
contribution, inspect provider-owned object metadata, and require exact size/checksum agreement.
Provider objects are created with a generation precondition; an upload cannot replace an accepted
file. Completion inserts either a direct work attachment or a seven-day private draft, and records
its accepted result atomically. Direct work activity and search jobs commit with attachment metadata.
Post drafts remain private and are claimed by the existing atomic comment/update transaction.

A completed session replays the same accepted identity, including after the draft was posted.
Removing a completed attachment never lets the old session recreate it. Cancellation/expiry cannot
race completion into deleting accepted bytes. Pending reservations survive cleanup failures and are
released only after cancellation/byte cleanup is acknowledged; durable cleanup retries remain bounded.
Client cancellation pauses an in-progress transfer for explicit resume; removing a pending selection
can retire its uncompleted session. Accepted resources require their normal remove operation.

## Storage and reads

Extend the current blob port with provider-backed resumable creation, metadata inspection,
cancellation, streamed reads and server-side copy. Local disk supplies real bounded IO equivalents.
Google Cloud Storage supplies resumable object uploads, metadata, read streams and object copy.
Pending upload capabilities are not download capabilities. Browser provider transfers omit Docket
cookies and provenance headers; metadata/finalization requests retain normal authenticated attribution.

Authorize downloads/preview before opening a stream. Support a single byte range for media, safe
Content-Disposition, no-store, and existing safe media MIME rules. Library MCP inline content remains
bounded at 4 MiB; larger files expose metadata and an authenticated download reference. Library reuse
copies within storage and preserves independent destination-owned lifetimes without buffering the
whole source in the API.

## Compatibility and user experience

All new browser transfers use the same client for resources and post drafts: prepare checksum,
begin/recover session, transfer/resume acknowledged bytes, finalize, and return safe file metadata.
Preserve per-file progress, retry/pause and removal in post composers. Resource upload exposes honest
progress/recovery using the same transfer service. Text/inline MCP uploads retain their 4 MiB bound;
legacy multipart/capability endpoints remain bounded adapters into the shared session lifecycle.
Previously issued short-lived deliverable capabilities retain their existing compatibility reader.

The local-model MCP catalog ceiling remains unchanged. Do not add a tool per work type or put file
bytes in management results. No private draft becomes a Library source before it is posted.

## Verification and commercial implications

Tests must first fail for missing resumable/shared behavior, then cover chunk acknowledgement,
interruption, replay/conflicts, concurrent completion, changed checksums/size, permissions revoked
before completion, performer/client boundaries, expiry/cancel cleanup, all four work destinations and
post claims. Provider adapter tests verify real SDK/request shapes; local end-to-end tests prove byte
continuation and exact downloads, not hosted Cloud Storage acceptance. Verify a real file above the
old limit, the 100 MiB boundary, bounded reads/copies, and readable progress/error states in both themes.

Larger accepted files increase storage/transfer and later processing costs. Account for pending
reservations and completed bytes; do not confuse a per-file cap with a total-spend cap. Reuse existing
metering, keep previews/extraction independently bounded, and retain current billing policy. No new
workflow trigger/runner job is needed; add focused regressions to the affected suites.

## Research

- Google resumable protocol, Range acknowledgements and interruption recovery:
  https://docs.cloud.google.com/storage/docs/performing-resumable-uploads
- JSON API CORS behavior:
  https://docs.cloud.google.com/storage/docs/cross-origin
- Existing pinned @google-cloud/storage types and local blob/deliverable implementations are the
  owning integration contracts. Context7 quota was exhausted in this conversation; official docs and
  installed SDK source are used instead.

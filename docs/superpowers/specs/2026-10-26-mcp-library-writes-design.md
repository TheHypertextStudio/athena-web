# MCP Library writes

Agents must be able to leave usable files and references beside the work they support. Support tasks,
projects, programs, and initiatives. A successful write is discoverable through Library reads and
visible, downloadable, and removable on the destination's Resources surface without changing its brief.

## Approaches

- Append links to prose: already available, but cannot upload files and changes the work description.
- Share one mutable attachment across work: saves storage, but the current attachment model has one
  owning subject. Sharing needs a separate file lifecycle and migration of every deletion path.
- Create destination-owned attachments: reuse canonical external links and make independent snapshots
  of uploaded files. This is the implementation choice for this bounded delivery. It preserves current
  visibility and deletion semantics; each file snapshot consumes its own recorded storage allocation.

The user selected all four work types. Repository instructions authorize proceeding with the written
plan; the implementation choices below remain engineering decisions, not additional user agreements.

## Contract and behavior

- `upload_resource`: organization, subject type and ID, request ID, filename, optional title and MIME
  type, base64 bytes. Accept 1–4,194,304 decoded bytes. Bound encoded length before decoding,
  require a canonical byte round trip, and validate filename/MIME safety before reserving storage.
  Never fetch URLs or local paths.
- `attach_resource`: organization, subject type and ID, request ID, Library kind and resource ID,
  optional title. Sources are in the same workspace. External resources become URL attachments using
  their canonical identity. Uploaded files become independent byte-for-byte snapshots. Other attachment
  kinds with provider lifecycles are refused rather than copied with credentials or private metadata.
- Both require `work:write`, current MCP entitlement, current source visibility when applicable, and
  current destination `contribute`. Replays recheck authority. Attaching discloses the selected material
  to the destination audience; tool descriptions must state that plainly.
- Persist a per-actor, per-workspace request identity and argument fingerprint. Same request and input
  returns the original attachment; different input conflicts. Concurrent attempts must produce one
  attachment and one blob allocation. Removed writes retain a tombstone so retries cannot resurrect them.
- File writes use opaque attachment-scoped blob keys. Database failure cleans up only the attempted
  allocation. Results omit bytes, blob keys, arbitrary metadata and integration credentials. Content
  remains available through authenticated Library reads and attachment downloads served as downloads.
- Expose list, download and removal through a common REST resource path and reuse the ResourcesTab
  presentation. Existing APIs remain compatible. Programs gain a Resources tab. A shared panel keeps
  all four subjects consistent; ordinary web uploads and pasted URLs remain usable there.
- Record provenance and search jobs atomically with the attachment. Removal and permanent container
  deletion reuse the shared durable attachment-blob cleanup queue; abandoned write reservations
  are reclaimed under their receipt lock. Published comment/update files remain readable Library
  sources, while unclaimed private drafts are refused.

## Business and operational implications

This closes the agent handoff loop: a person can open the actual report or evidence with the work,
and a later agent can rediscover it without the originating chat. Measure usefulness through successful
upload/attach followed by authorized retrieval, retry reliability, and retained bytes by workspace;
do not add analytics containing filenames or content. Existing storage accounting includes file copies.

Keep current product entitlement, per-file limit, and billing behavior. Apply a safety rate of 30 new
resource writes per minute per workspace, serialized at reservation; identical retries reuse their slot.
Do not introduce an unlimited-storage promise, a new paid tier, a new vendor, or a provider-content mirroring service.
Snapshots add at most 4 MiB per accepted file operation; external references add no copied file bytes.
Base64 expands request size by roughly one third and can consume client context, so clients should reuse
Library references and avoid sending bytes through a model when the host can supply them directly.
Workspace aggregate storage quotas remain a separate existing product-policy question, not an invented
claim that per-file bounds cap total spend. No production release or adoption claim follows from local tests.

## Verification

Real MCP tests cover all subjects, read-only tokens, registered-agent boundaries, private and archived
sources/destinations, revoked grants, cross-workspace refusal, malformed/oversized uploads, bytes,
duplicate and conflicting requests, concurrency, failed persistence, resource discovery and deletion.
REST and UI checks establish usable download/removal, safe headers, loading/errors, phone widths and
both themes. Run affected checks and builds under the required capacity guard. Inspect the final diff
and obtain an independent review before committing. No provider credentials or private work enter the repo.

## Agent context cost

The combined tool catalog must remain below its existing local-model prompt ceiling. Use concise
first paragraphs for tool routing, retain detailed usage notes for MCP clients, and choose the
smallest lossless fragment-pooling candidate. Recursive and anchored schemas retain their original
resolution scope. No validation rule or registered tool is removed to meet the budget.

# Intent-preserving interactions

**Date:** 2026-08-11

**Status:** Concept approved; expanded written specification ready for review

**Area:** App-wide interaction responsiveness, typed data layer, API idempotency, and offline outbox

**Refines:**

- `docs/engineering/specs/data-layer.md`
- `docs/engineering/specs/inline-editing-titles-and-quick-add.md`
- `docs/engineering/specs/design-system.md`
- `docs/engineering/specs/offline.md`
- `docs/engineering/specs/pwa.md`

**Evidence:** `docs/design/audits/2026-08-11-mutation-ux.md`

## Objective

Make every interaction acknowledge a person's intent immediately without pretending that remote
work can never fail. Local controls respond in the next rendered frame, navigation and reads retain
orientation while they load, property edits remain usable while they synchronize, rapid inline
creation accepts the next item without waiting for the previous request, and longer transitions
visibly acknowledge activation within 100ms. Failures preserve work and offer recovery instead of
silently snapping back, clearing a newer draft, blanking useful content, or leaving a control
pixel-identical.

The design also makes this behavior difficult to regress. A Docket-wide Interaction Responsiveness
Standard defines what “instant” means, named async interactions publish a measurable receipt, every
production mutation receives an interaction class, shared utilities own concurrency and submission
bookkeeping, and repository and browser policies reject new network-locked, silent, or
settlement-unsafe patterns.

## Observed problem

The service-worker update handshake is mechanically correct: the page posts `SKIP_WAITING`, the
waiting worker activates and claims the client, and `controllerchange` reloads the page, with a
four-second fallback. The card still feels dead because accepting it leaves its label, enabled
state, visual treatment, and accessible state unchanged until reload.

Inline Task creation is worse. `QuickAddTaskRow` disables and defocuses its only input while it
awaits the POST and settlement refetch. Known-value list renames are invalidate-only, whole-record
optimistic snapshots are unsafe when responses settle out of order, and several composers clear the
current draft after an older submission resolves. Milestones combine invalidate-only writes with a
global pending lock. These are different symptoms of one missing contract: components decide
individually what pending means.

There is also a transport gap behind durable pending creation. Docket's account-scoped offline
outbox already keeps rejected writes, displays them, expires them, and supports retry/discard. The
database already contains the documented 24-hour idempotency table. However, no API middleware
uses that table, Task creation ignores `Idempotency-Key`, CORS does not allow the header, and the
outbox persists only method, path, body, and content type. A POST that commits and then loses its
response can therefore be replayed as a duplicate. Pending creation cannot be called safe until the
same submission identity survives the foreground request and every replay.

The prevention layer is missing outside mutations too. Online navigation has no shared pending
destination, URL-backed view controls wait for settled search parameters, and command search can
replace useful results with a skeleton on every query-key change. Docket has no browser
responsiveness observer today. Its action registry has stable semantic ids but observes only after
an awaited action settles and covers a small subset of product interactions. Playwright already
runs production-build Chromium with retained traces, but its broad E2E workflow is explicitly
non-gating and its timeouts detect stalls rather than a 100ms acknowledgement. None of those seams
currently prevents a fast handler with pixel-identical output from shipping.

## Accepted product requirements

1. A routine reversible edit appears locally within 100ms and does not disable its editor or sibling
   properties.
2. Pressing Enter in a rapid-create field moves that exact draft into a pending row, clears and
   refocuses the input immediately, and accepts another submission while earlier ones are in flight.
3. Temporary delivery failure preserves local intent and retries safely. An authoritative rejection
   keeps the attempted value or pending row visible as needing attention, with application-owned
   recovery actions.
4. Routine success is quiet. A subtle syncing treatment may appear after 300ms; the interface does
   not toast every ordinary save.
5. Only the exact duplicate activation may be blocked. One pending operation never freezes a
   neighboring property, a whole list, or the next draft.
6. Older success or failure can never overwrite newer intent, including when two edits touch the
   same field and settle out of order.
7. Settlement can clear only the draft or pending projection owned by that submission.
8. A server-confirmed transition changes visible and accessible state in the same interaction turn.
9. Errors use application-owned language and branch on stable error type, status, or Problem code;
   provider and exception prose never reaches the interface.
10. Existing offline ownership remains in the page outbox. The service worker remains read-only for
    application writes.
11. Every production mutation is classified and routed through its matching shared lifecycle before
    this feature is complete; no unclassified migration debt remains.
12. Every user action receives visible or accessible acknowledgement in the next rendered frame and
    within 100ms in the deterministic browser budget. Remote work never has to finish before that
    acknowledgement appears.
13. Navigation, background refresh, and remote search preserve the last useful content or render a
    final-geometry placeholder. Pending work never replaces a populated surface with a blank frame.
14. Every named asynchronous interaction publishes an app-owned receipt from activation through
    acknowledgement, progress, settlement, and recovery. Receipt labels contain no user text,
    entity identifiers, or other payload data.
15. Docket does not claim that every network response or every device will complete work in 100ms.
    The guarantee is architectural: supported interaction paths do not wait on remote settlement to
    respond, and release tests measure the acknowledgement that the product actually renders.
16. A checked-in inventory classifies every production user-interaction boundary, including local
    and continuous interactions. Every entry names its shared primitive or lifecycle and the
    component/browser evidence that owns its responsiveness contract.

## Interaction Responsiveness Standard

The Craft Rubric's “feedback within 100ms” rule becomes an engineering contract rather than review
advice. “Instant” has one precise meaning in Docket: after pointer, keyboard, or assistive-technology
activation, the next useful visual or semantic state is committed in the next rendered frame and no
later than 100ms in the deterministic browser harness. That state may be the final local result, a
requested destination, a pending projection, or truthful progress. It may not be an unchanged
control whose handler happens to be running.

Activating an already-settled no-op, such as choosing the currently selected tab, does not need an
invented animation or status cycle: its persistent selected/current state is the acknowledgement.
An enabled control that starts new work, however, must publish a changed state.

This is a continuity guarantee, not a latency fiction. Docket can ensure that its own architecture
does not wait for a network round trip before responding. It cannot guarantee server completion,
browser scheduling, connectivity, or arbitrary hardware within 100ms. Deterministic release and
post-deploy synthetic tests enforce the product-owned path without silently collecting real-user
interaction telemetry.

### Interaction categories

Every interactive path belongs to one category. Categories describe the acknowledgement the person
must receive; they do not force every click through one universal component.

| Category                           | Examples                                                         | Immediate acknowledgement                                                                      | While work continues                                                                              |
| ---------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Local disclosure or view transform | Open a menu/dialog, switch a tab, select, expand, filter locally | Commit the final local state in the next frame and retain correct focus ownership              | No network state; expensive derivation yields rather than blocking input                          |
| Navigation and reveal              | Follow an app link, open detail, reveal a lazy panel             | Mark the requested destination without falsely declaring it current; keep the app shell stable | Preserve the current surface or show a final-geometry skeleton; never show a blank app frame      |
| Query-backed search or read        | Search remotely, refresh, change a server-backed view            | Echo the query/filter/view choice immediately and keep the latest useful result                | Mark stale/loading state after the quiet threshold; only the latest request may publish results   |
| Direct manipulation                | Drag, resize, schedule, reorder                                  | Capture the pointer or keyboard gesture and render a local preview by the next animation frame | Keep the final projection visible while persistence settles; never flash back to the old position |
| Mutation                           | Edit a property, create, delete, update the app                  | Use the instant-edit, pending-insert, or server-confirmed lifecycle below                      | Preserve intent, permit unrelated work, and expose truthful sync/recovery state                   |
| Long-running work                  | Import, export, provider handshake, agent run                    | Show accepted/queued/starting state immediately                                                | Show durable progress or “Still working”; provide Cancel, Retry, or a safe exit when meaningful   |

Typing, scrolling, pointer movement, and drag previews are continuous interactions: they must remain
responsive frame to frame and must not be gated on I/O. Network synchronization begins from the
resulting intent, never from the input loop itself.

Categories have one receipt owner even when implementation layers overlap. The user-visible action
owns the root receipt; subordinate work links to it locally and does not emit a second activation:

1. A drag/reorder/resize remains **direct manipulation** through preview and drop; its persistence
   mutation is a child transport lifecycle.
2. A link or server-backed tab remains **navigation and reveal**; destination reads are child query
   lifecycles.
3. Import/export/provider launch remains **long-running work**; its job-creation mutation is a child
   lifecycle.
4. A record change activated directly by the person is **mutation**, even if settlement later starts
   a refetch.
5. A fully local disclosure or transform is local only. If it starts remote work, it adopts the
   applicable navigation, read, mutation, or long-running owner instead.

`parentInvocationId` links root and child lifecycles only inside the bounded local trace. Production
behavior and synthetic tests report one acknowledgement per activation, preventing duplicate status,
double counting, or contradictory wrapper choices.

### Coverage inventory

`interaction-responsiveness-manifest.ts` is the checked-in coverage authority. The source inventory
enumerates production interactive JSX props, forms/server-action boundaries, action definitions,
router calls, native listeners, timers or transitions that publish user-facing work, and the shared
components that encapsulate them. Each manifest entry declares:

- stable interaction id and primary category;
- whether it is critical or standard;
- owning shared primitive/lifecycle or a documented synchronous-local implementation;
- pointer, keyboard, and assistive-technology modalities that apply;
- required widths, themes, reduced-motion state, latency fixture, acknowledgement predicate, focus
  owner, and continuity assertions; and
- component-test evidence for standard entries and production-build browser evidence for critical
  entries.

Typing, scrolling, and gesture loops are explicit entries rather than assumed coverage. Shared UI
primitives may own many call sites, but custom production handlers remain independently inventoried.
The generated source inventory, manifest, and exception registry must reconcile with no missing or
orphaned entries before completion.

### Timing ladder

- **0–100ms — acknowledge:** Commit a changed visual or semantic state. For an async operation the
  receipt changes from `idle` to `acknowledged` synchronously and is marked only after its DOM/ARIA
  representation commits.
- **After 300ms — explain:** If work remains unsettled, expose quiet, persistent progress in the
  affected context. Do not flash a spinner for a fast action and do not toast routine success.
- **After 5s — sustain trust:** Change generic progress to application-owned “Still working” copy
  and offer Cancel, Retry, or a safe way to continue elsewhere where the operation permits it.
- **On settlement — preserve continuity:** Success adopts authoritative state without unexpected
  reflow or focus loss. Navigation/reveal may perform its category-owned focus transition and
  final-geometry replacement. Failure retains the person's work or last useful content and exposes
  an in-context recovery path.

The 300ms and five-second thresholds govern feedback escalation, not request cancellation. A request
may remain valid longer, and an ambiguous write may not be retried until its idempotency contract can
make that safe.

### Continuity rules

1. Never disable a parent surface because one child interaction is pending. Suppress only an exact
   duplicate whose repetition would be unsafe.
2. Never clear confirmed content merely because a refetch starts. Background reads update beneath
   the last useful result; a settled empty response, not a loading flag, owns the empty state.
3. Never clear or replace input that a different submission now owns. Focus remains in the person's
   workflow unless their action intentionally moves it.
4. Never let an older async result publish over a newer query, navigation, draft, or edit intent.
5. Keep progress local to the affected object. App-wide blocking UI is reserved for the rare case
   where the whole authenticated session is genuinely unsafe to use.
6. Use text, semantics, and stable geometry as well as color. Reduced motion removes animation, not
   acknowledgement.

### Shared receipts and instrumentation

`InteractionReceipt` is the common, privacy-safe observation shape for named async work. It records
a closed interaction id and category, an allowlisted route-template id, `startedAt`,
`acknowledgedAt`, optional `progressAt`, `settledAt`, and an app-owned outcome code. A fresh ephemeral
`invocationId` correlates two rapid activations and links child work while the page is alive; it is
never serialized, persisted, logged, or exposed to an observation sink. The receipt never accepts
typed text, actual pathnames, URLs supplied by a person, entity ids, names, request bodies, browser
entry objects, action exceptions, or exception messages.

The existing `InteractionProvider` becomes the root observation seam. Mutation wrappers emit
receipts automatically. `useResponsiveAction` owns non-mutation async phases and returns explicit
`phase`, `blocksTrigger`, and accessible status props; it does not expose a generic pending boolean.
`useResponsiveRouter` and a navigation-intent store make `DocketLink` and imperative navigation
publish the same phases; raw product `useRouter` navigation is restricted to that seam.
`useImmediateUrlState` renders URL-backed view choices locally before persistence, and remote reads
use the existing previous-data query contract plus latest-request ownership. Existing gesture
utilities retain pointer capture, local previews, and keyboard/assistive-technology equivalents
rather than being replaced by a ceremonial wrapper. Direct local controls need no async wrapper,
but remain covered by browser Event Timing observation and responsive component tests.

An acknowledgement timestamp is emitted from the committed state, not from the event handler that
requested it. The manifest supplies a semantic DOM/ARIA predicate. After that predicate commits, a
double `requestAnimationFrame` marker proves it survived a paint before `acknowledgedAt` is recorded;
the browser harness independently asserts the same predicate. Unsupported Event Timing browsers
still receive the product behavior and semantic test; only the passive timing enrichment is omitted.

Development and test builds retain a bounded in-memory trace so the harness can compare activation,
painted acknowledgement, progress, and settlement without relying on test-runner wall-clock timing.
The buffer retains at most 512 completed receipts and 128 live receipts. Completed history evicts
oldest-first. Exceeding the live cap terminates the oldest receipt as `timed_out` and emits a test/dev
leak failure; live work is never silently evicted.

Terminal outcomes are `succeeded`, `needs_attention`, `failed`, `handed_off`, `superseded`,
`abandoned`, and `timed_out`. An authoritative refusal that awaits Retry/Revert ends its automatic
lifecycle as `needs_attention`; the product's recovery state persists separately. Outbox adoption,
OAuth/external navigation, and the intentional app-update reload terminate as `handed_off`. A newer
intent terminates obsolete unsent work as `superseded`. Page teardown marks unowned in-memory work
`abandoned`; it cannot imply failure for work already handed to a durable owner.

This feature sends no real-user responsiveness events. There is no existing client RUM system or
approved telemetry-governance contract, so adding a “first-party” endpoint would be a separate data
collection feature, not an implementation detail. Production verification uses a seeded synthetic
account and the same privacy-safe manifest after deployment. Any future RUM proposal must separately
define consent/control, exact serialized wire shape, credentials/referrer behavior, sampling,
retention, deletion, operational ownership, and public privacy copy before collection begins.

Performance observation and semantic receipts answer different questions. Event Timing catches a
main-thread stall even if product code intended to acknowledge quickly. A receipt catches the
Update-card failure mode, where the handler is cheap but the rendered state remains unchanged. A
release gate needs both.

### Budgets and regression gates

- Every critical browser journey must record a semantic acknowledgement within 100ms under an
  injected 2.5-second network or worker delay.
- The same journey must preserve usable content, focus, and unrelated controls throughout the
  delay; a fast timestamp cannot compensate for a blank or frozen interface.
- The browser harness runs one unmeasured warm-up, then three clean measured activations for each
  manifest variant. Every measured semantic painted acknowledgement must be at or below 100ms; one
  over-budget sample fails the gate. Results retain the acknowledgement predicate, semantic receipt,
  Event Timing interaction, and trace for diagnosis rather than passing on an ad hoc retry.
- Continuous gesture fixtures run for at least two seconds. Every synthesized pointer/keyboard step
  must publish its preview by the next animation frame, and the gesture interval may contain no
  browser Long Task entry of 50ms or more. Scroll and typing entries apply the same next-frame rule
  to their owned visual state without requiring a network settlement.
- Development emits a named warning for missing acknowledgement, a receipt left unsettled, or a
  main-thread interaction over budget. Tests promote warnings on covered critical journeys to
  failures.
- Repository policy and the runtime watchdog require user-initiated async actions to use the matching
  mutation, navigation, read, or responsive-action lifecycle. Temporary inventory ledgers may only
  shrink and are empty before this feature is complete.
- A focused production-build Playwright `responsiveness` job is required by CI and by the production
  deploy job. Broad non-deterministic E2E and field-vitals trends remain separate; neither can stand
  in for the deterministic held-network contract.
- The same focused manifest runs as a post-deploy synthetic check against the released build. A
  failed synthetic check is a release incident; it does not silently rewrite the release gate's
  budget.

## Approaches considered

### Selected: intent-preserving local state with background settlement

The interface records intent first, then synchronizes it. Routine edits use field-version ownership;
creates use local pending projections keyed by a stable submission token; server-confirmed
transitions expose an explicit applying state. The model is truthful because every non-settled item
has a sync state and every rejected item remains recoverable.

This costs more than adding spinners, but it solves latency, concurrency, offline replay, focus, and
failure as one system. It also gives the source policy a meaningful contract to enforce.

### Rejected: optimistic cache snapshot plus rollback

Snapshot rollback feels fast only when requests settle in order and never fail. With overlapping
edits, an older rollback can restore a whole stale record over newer work, while an older success can
adopt stale server fields. Even a correct rollback surprises the person by erasing visible intent.
Whole-record rollback remains unsuitable for routine properties.

### Rejected: wait, disable, and refetch

This model is simple and authoritative, but it serializes the person behind the network. It is
reserved neither as a default nor as a fallback. Operations that truly require server confirmation
still acknowledge immediately and block only duplicate activation.

## Interaction classes

Every production mutation declares exactly one class.

### Instant edit

Use for a reversible change whose next visible value is known locally: title/name, status, priority,
assignment, dates, labels, estimates, ownership, and other properties.

- Apply the value synchronously to every visible cache projection.
- Keep the initiating editor and neighboring editors usable.
- Track ownership by query target, entity, field, and monotonically increasing operation version.
- Advance the authoritative base for an accepted operation even while a newer local layer remains
  visible. Settlement history is independent from which layer currently wins rendering.
- Retain the latest authoritatively rejected intent as a non-sending `needs-attention` layer. Retry
  replaces it with a new operation; Revert removes it. A newer same-field intent supersedes an older
  rejected layer without prompting about work the person already replaced.
- Let authoritative refetches update the base beneath active, queued, and needs-attention layers,
  then rematerialize those owned fields. Pending intent never blocks unrelated server changes from
  arriving.
- Apply local layers immediately but send same-entity operations through one ordered transport
  queue. A later intent may not commit on the server before an earlier ambiguous or queued write is
  resolved.
- Expose `syncState`, not a generic pending boolean intended for `disabled`.

An authoritative rejection does not masquerade as saved. The attempted value remains in its editing
context with “Couldn’t save” and Retry/Revert actions. Other derived surfaces may continue to use the
last authoritative value until the conflict is resolved.

### Pending insert

Use for server-identity creation where the final entity cannot be fabricated: Tasks, subtasks,
comments, entity updates, URL attachments, and milestones.

- Capture the submitted draft and a stable client submission token atomically.
- Insert a local projection in its final list position without inventing a server entity id.
- Clear and refocus the composer immediately if its current draft still belongs to that capture.
- Allow any number of distinct submissions in flight.
- Replace the projection with the returned server entity on foreground success.
- Keep the projection as Pending sync when the existing outbox takes responsibility.
- Keep an authoritative rejection in place as Needs attention with Retry, Edit, and Discard.
- Rebuild offline pending projections from outbox entries after reload so queued intent remains
  visible in context, not only in the global sync indicator.
- Keep one key only for byte-equivalent retries of an ambiguously delivered attempt. Retry after an
  authoritative refusal, or Edit, creates a new submission/key and atomically supersedes the
  rejected attempt.

### Server-confirmed transition

Use only when local final-state prediction would be dishonest: destructive actions, permission or
authentication ceremonies, server-derived transformations, external handshakes, and the app-update
transition.

- Change visible copy/state within 100ms.
- Set the exact trigger to `aria-busy` and suppress only duplicate activation.
- Keep surrounding navigation and editing available unless the transition itself makes them unsafe.
- Render a persistent application-owned failure with Retry when confirmation does not arrive.
- Declare a closed reason code; a free-form “server confirmed” escape hatch is not accepted.

## Shared architecture

### Typed mutation entry points

`useApiMutation` remains the one authenticated Hono/TanStack write boundary. Three typed entry
points build on it:

- `useInstantMutation` applies and settles field-versioned intent layers and returns `syncState`.
- `usePendingInsert` owns submission records, pending projections, reconciliation, and retry actions.
- `useConfirmedMutation` returns an explicit transition state and `blocksTrigger` for duplicate
  suppression.

Routine wrappers do not expose `isPending`, making the easiest component implementation the safe
one. Raw `useApiMutation` is an internal primitive restricted to the three wrappers and closed,
documented authentication ceremonies; production surfaces cannot satisfy the contract by adding a
label to an otherwise invalidate-only mutation. Direct TanStack `useMutation` is restricted to that
same shared boundary. Existing callers migrate onto the wrapper whose lifecycle they actually use.

### Field-version intent journal

The journal is stored per `QueryClient` and cache target without retaining a client after it is
destroyed. Each operation declares the entity, fields, and cache projections it owns. For every
field the journal holds an authoritative base/version plus ordered local layers whose state is
`local`, `sending`, `queued`, or `needs-attention`.

Rendering is always `latest authoritative base + applicable local layers`. Settlement advances the
base independently from visibility. If edit A then edit B touch the same field, B renders
immediately. When A succeeds, its accepted value becomes the base beneath B and A's layer leaves. If
B then fails, its layer becomes Needs attention until Retry/Revert; reverting reveals accepted A.
If A failed before B, reverting B reveals the original base. A response never writes fields owned
by a later version, but its accepted touched fields still enter settlement history so they are not
lost when the later layer resolves.

Every authoritative query update is passed through journal reconciliation: the fetched entity
refreshes the base, then current local layers are reapplied to their fields before the cache is
published. This means a queued title cannot suppress a fresh assignee, status, or permission change.
The journal guards against its own rematerialization writes so cache subscription cannot recurse.

Local acknowledgement never waits. Transport does: writes for one entity leave in intent order, and
an ambiguous/queued A holds later B until A is accepted, refused, discarded, or expired. Unsent
same-field layers may be coalesced only when doing so cannot erase a distinct audit-worthy intent;
once an attempt has left the client, it is never reordered. The current serialized optimistic-write
helper may remain for complex multi-cache operations during migration, but it is not the routine
property primitive.

Queued and needs-attention edit layers are reconstructed from structured metadata on the existing
outbox entry after reload. The outbox is therefore both the delivery owner and durable intent
ledger; this design does not create a second queue or persistence store.

### Submission and draft ownership

A shared submission utility creates an immutable capture containing the current draft, a version
token, and the stable request key. Clearing is a compare-and-clear operation: it succeeds only when
the live draft still has the captured version. Older completion therefore cannot erase newer typing.

For rapid creation, the capture immediately becomes a pending projection and the composer starts a
fresh draft. For composers that intentionally retain the editor while posting, the same token rule
allows continued typing and clears only the submitted text when appropriate.

The outbox publishes a keyed settlement event for every replay attempt: entry id, submission key,
outcome, status, and response body when one exists. Product adapters validate that body against the
endpoint's output schema before using it. A successful pending projection leaves only after the
exact returned entity id is present in the authoritative cache; a generic “queue drained” signal is
not enough to correlate two rapid submissions.

### Shared feedback states

Routine surfaces use a small shared state vocabulary:

- `local` — acknowledged immediately; no network treatment yet.
- `syncing` — still unsettled after 300ms; subtle, non-blocking progress.
- `queued` — saved on this device and represented in the existing outbox.
- `needs-attention` — authoritatively rejected or retries exhausted; persistent actions available.
- `synced` — settled quietly and removed from transient status.

`MutationStatus` provides consistent iconography, application-owned copy, `aria-live="polite"`, and
pending/failed row affordances. It does not become a universal toast. Product surfaces still own
their domain noun and recovery copy.

## Transport and idempotency

The existing Postgres idempotency table becomes functional rather than adding another persistence
system.

1. A reusable API helper validates an optional `Idempotency-Key`, hashes method, path, and canonical
   validated body, and scopes the key to the authenticated user.
2. The route's normal current organization/resource authorization runs before a key is claimed or a
   cached result is returned. A completed matching claim is replayed only after the caller still has
   the endpoint's create capability and, when a returned entity still exists, current view access to
   it. Membership removal or permission loss returns the route's ordinary not-found/forbidden policy
   without executing and without exposing the stored body. Deletion returns not-found while leaving
   the key consumed so replay cannot recreate it.
3. The first authorized request atomically claims the key. A completed matching claim returns the
   stored status and minimal validated endpoint output without executing again. A different hash
   returns Problem code `idempotency_key_reuse`. A concurrent in-progress claim never executes the
   handler twice.
4. Each adopted endpoint completes the idempotency record in the same database transaction as its
   entity, relations, and other database-owned effects. External follow-up work remains driven from
   the committed entity and must itself be idempotent.
5. The idempotency row retains only status, the validated output needed for exact replay
   reconciliation, the resource type/id needed for reauthorization, and expiry metadata. It does not
   retain request headers, diagnostics, or a second copy of the request body beyond its hash.
6. Expired claims are treated atomically as reclaimable, and routine cleanup removes records after
   the documented 24-hour lifetime.
7. CORS accepts `Idempotency-Key` for the session-authenticated web origin.
8. `usePendingInsert` generates one key per captured draft and sends it on every attempt.
9. Outbox entries persist and replay that exact key plus structured projection metadata (entity,
   fields/context, local value, and interaction class). The key identifies the local projection, so
   foreground, reload, and replay settlement refer to the same intent. Foreground authoritative
   rejection creates a non-replayable blocked entry so recovery survives reload without a second
   store.
10. The outbox changes from “every `/v1` write is queueable” to an explicit registry of
    replay-safe method/path pairs. An endpoint enters that registry only after its idempotency or
    equivalent deduplication contract is tested. An unsupported rejected write fails honestly rather
    than being replayed ambiguously.

Initial adoption covers every replayable mutation migrated by this feature: Task create/PATCH/state,
subtask create, comments, entity updates, URL attachments, milestones, and the full-composer create
endpoints classified as pending inserts. Update endpoints can emit observations even when their
stored value is naturally idempotent, so a lost response must not duplicate their effects. The
helper is route-agnostic; an endpoint is not added to the replay-safe registry until its contract is
attached and tested. The OpenAPI description is corrected so it names only routes that actually
honor the contract; it cannot continue claiming universal coverage ahead of implementation.

An ambiguous-delivery retry reuses its original key and byte-equivalent request. Retry after a
stored authoritative refusal, or any edited payload, generates a new key and atomically marks the
old blocked entry superseded. Reusing the refused key would only replay the cached refusal; editing
under that key would correctly produce `idempotency_key_reuse`.

PATCH-like writes that are naturally idempotent reuse a stable operation key where replay can emit
duplicate observations. Cross-device compare-and-set revisions are a separate consistency layer:
this design guarantees one-client intent ordering and duplicate-safe replay but does not claim to
resolve simultaneous edits from two devices without a server revision field.

## Concrete product flows

### Rapid Task creation

1. Enter captures title A and an idempotency key.
2. A pending Task projection appears in the Project or Cycle list; the input clears and receives
   focus in the same turn.
3. The person enters title B while A is still in flight; B receives an independent projection and
   key.
4. A foreground success replaces only A with its returned `TaskOut`.
5. An undeliverable A is adopted by the account outbox and remains in place as Pending sync.
6. An accepted replay emits A's keyed, schema-validated `TaskOut`, writes/refetches the authoritative
   list, and removes A's projection only after that exact Task id is present.
7. A refused A stays as Needs attention with Retry, Edit, and Discard. Retry after refusal and Edit
   create a new keyed attempt while superseding A; B is unaffected.

The project and cycle pages use the same shared quick-add behavior. Task Subtasks, comments, entity
updates, attachments, and milestones adopt the same submission ownership as they migrate.

### Routine property edit

Selecting a new value updates the visible field synchronously. The menu closes normally and remains
available for another choice. A fast success adds no toast. A slow request gains subtle syncing
status after 300ms. A queued request stays locally applied and appears in the outbox. A definitive
rejection preserves the attempted value inside a marked editing context with Retry/Revert; it never
silently restores a whole record. Reload reconstructs queued or rejected field overlays from the
outbox metadata. Later same-entity edits render immediately but leave through the ordered transport
queue, so an older ambiguous write cannot replay over a newer server commit.

Task, Project, Program, Initiative, and Cycle detail mutations and list renames migrate from whole-
record snapshots or invalidate-only writes to this model. Status and Priority triggers no longer
disable merely because an earlier value is settling.

### App update

The sidebar separates status from action:

- title: **Update available**
- supporting copy: **Reload to use the latest version**
- action: **Reload now**

Activation immediately changes the card to **Applying update…**, sets `aria-busy`, and suppresses
only another activation. The existing `SKIP_WAITING` → activate/claim → `controllerchange` reload
handshake remains intact. If posting cannot be initiated because the waiting worker disappeared or
`postMessage` fails synchronously, the card shows **Couldn’t apply update** with **Retry**. A missing
`controllerchange` is not presented as failure: at four seconds the card changes to
**Reloading…** and the existing hard-reload fallback runs. The provider test pins these observable
transitions instead of an unchanged ready card.

## Migration scope

The implementation includes all eight issues identified by the audit, including the P2 composer and
settings failures, and establishes the broader responsiveness contract around them:

1. A production interaction inventory, `InteractionReceipt`, the root observer, responsive-action,
   navigation, and remote-read adapters, runtime watchdog, coverage manifest, deterministic browser
   timing harness, required CI job, and post-deploy synthetic check.
2. Shared mutation interaction types, field-version journal, pending-insert/submission utility,
   feedback state, and deferred-promise test helper.
3. Transactional idempotency for every replayable endpoint migrated below, CORS, a replay-safe
   outbox registry, durable projection metadata, keyed settlement events, and authoritative replay
   tests.
4. Project and Cycle `QuickAddTaskRow` flows with concurrent pending rows.
5. The app-update ready/applying/failure card.
6. Known-value renames and property mutations for Task, Project, Program, Initiative, and Cycle,
   including overlapping out-of-order settlement.
7. Token-safe drafts for Subtasks, comments, entity updates, and URL attachments.
8. Pending-item milestone create/edit behavior without a project-wide lock.
9. Full create composers and settings controls that currently disable unrelated editing or leave
   rejected local state divergent.
10. Critical non-mutation journeys for local controls, navigation, remote reads, direct
    manipulation, and long-running work, including slow-route, stale-result, gesture-frame, typing,
    and scroll coverage declared by the manifest.
11. Classification and coverage reconciliation for every production user-interaction boundary,
    standards, AST policy, runtime watchdog, component/browser evidence, and an empty temporary
    inventory ledger.

The mutation and broader interaction ledgers may exist while slices are in flight, but they are
one-way: new debt fails, counts cannot grow, and an entry disappears as soon as its call is migrated
or assigned to a tested shared primitive. Completion requires both ledgers to be empty, the generated
inventory/manifest/exception registry to reconcile, every user-initiated async interaction to use a
shared lifecycle, every local/continuous entry to name its test owner, and all P0/P1/P2 audit findings
to be corrected. A closed server-confirmed reason is a real interaction class, not a ledger
exemption.

Cross-device revision conflicts, collaborative presence, a redesign of the global outbox panel, and
real-user responsiveness telemetry are out of scope. The existing outbox receives the metadata and
events needed by pending projections but keeps its current ownership, expiry, retry, and discard
model.

## Standards and enforcement

The data-layer spec changes from “server-assigned identity inserts are invalidate-only” to “server
entities remain authoritative, but creation intent renders through a local pending projection.” The
inline-editing and engineering design-system specs lose their pending locks and blanket toast-plus-
rollback rule.

`web-interaction-responsiveness-policy.test.ts` follows the existing TypeScript-AST policy pattern
and owns the app-wide rule. Its production-tree scope is `apps/web/src/**/*.{ts,tsx}` excluding
tests, generated files, and server-only modules with no user-facing state. Its mutation slice:

1. flags direct `useMutation` and raw `useApiMutation` use outside the three shared wrappers and
   declared authentication seams;
2. requires every production caller to use `useInstantMutation`, `usePendingInsert`, or
   `useConfirmedMutation`, whose type shapes encode the matching lifecycle;
3. applies a one-way temporary debt ledger to existing callers and requires that ledger to be empty
   at feature completion;
4. flags `.isPending` in JSX `disabled` expressions, while confirmed transitions use the typed
   `blocksTrigger` result;
5. flags raw draft clearing after an `await` outside the token-aware submission utility; and
6. includes hostile positive/negative fixtures for aliases, optional chaining, spread, and multiline
   syntax so the scanner proves its own behavior.

Its async-interaction slice:

1. inventories async-capable JSX props, form/server-action boundaries, callbacks passed through
   product components, `void` calls, native listeners, timers, and transitions that can publish
   user-facing work; direct transport is already restricted to the typed query layer;
2. flags promise-returning or `await`-bearing event handlers that bypass the action registry,
   responsive-action, navigation/read adapter, or typed mutation boundary;
3. restricts raw `useRouter` navigation and product links to the shared responsive-navigation seam,
   while keeping framework and authentication redirects as closed documented exceptions;
4. requires stable closed interaction ids rather than arbitrary strings or accessible/user copy;
5. rejects global or ancestor disabling derived from a child interaction phase;
6. applies a one-way inventory ledger to existing async handlers and requires it to be empty at
   feature completion; and
7. keeps direct synchronous controls legal without ceremonial wrappers while requiring their source
   inventory entry to resolve to a shared primitive or manifest contract.

The shared result shapes are the primary prevention. The policy is the backstop: routine wrappers do
not expose a general pending boolean, so components cannot accidentally convert synchronization into
a global lock. The scanner does not claim to prove arbitrary imported code is synchronous. At
runtime, the query, mutation, action-registry, and navigation boundaries inherit the current trusted
activation token. Development and test fail if any boundary starts user-visible remote work without
a root receipt or declared autonomous owner. This catches hidden `void importedAsync()`, prop
indirection, and timers that syntax alone cannot classify. Browser proof remains necessary because
neither scanner nor watchdog can tell whether a fast handler produced meaningful visible or
accessible acknowledgement.

The source policy reconciles three checked-in artifacts: the generated interaction inventory, the
manifest, and a closed exception registry. Authentication ceremonies, framework redirects, external
links, startup work, subscriptions, autonomous refresh, and background timers are not blanket
escapes. User-facing entries still declare category, acknowledgement, receipt policy, and evidence;
truly autonomous work declares continuity/error ownership but has no invented activation or 100ms
receipt. Exceptions may bypass one wrapper only when their framework boundary and test evidence are
named. New or stale exceptions fail CI.

## Accessibility, responsiveness, and visual states

- The accepted intent is visible without relying on color. Pending and failed rows have text labels
  and semantic icons.
- Sync changes announce through a polite live region; routine fast success stays quiet.
- Focus remains in rapid-entry fields after every submission and failure. Failed rows provide named
  keyboard actions.
- A disabled confirmed trigger has `aria-busy` and changed explanatory copy; disabled state never
  appears without an explanation.
- Pending rows occupy the same list geometry as settled rows, avoiding reflow when the server entity
  replaces them.
- Light/dark and desktop/mobile use the same state vocabulary. At 320px the pending marker and row
  actions move into an accessible overflow rather than causing horizontal scroll.
- Reduced-motion mode receives state changes without relying on animation.
- Navigation and remote-read progress identifies the affected destination or region through
  `aria-busy` or a named live region without moving focus to a global spinner. `aria-current`
  remains reserved for the destination that actually settled.
- The five-second feedback escalation is announced once; recurring timers never create repeated
  live-region noise.

## Validation contract

### Shared behavior tests

A common typed `deferred<T>()` helper drives deterministic latency and settlement order. Tests prove:

- edit A then edit B renders B immediately;
- A rejection after B does not remove B;
- A success advances the base beneath B without replacing B; if B then rejects and is reverted, A
  is revealed;
- if A and B both reject, reverting B reveals the original authoritative base without a whole-
  record rollback;
- an authoritative refetch updates unrelated fields beneath a queued or needs-attention overlay;
- ambiguous A, local B, replayed A, then sent B commits in intent order while B remains visible the
  entire time;
- unrelated fields settle independently;
- rapid creates accept multiple outstanding titles, clear/refocus immediately, and reconcile each
  returned entity independently;
- queued, refused, retried, and discarded creates retain the correct projection;
- reload reconstructs queued/rejected edit and insert projections from the outbox;
- ambiguous-delivery retry preserves its key, while Retry after refusal and Edit use a new key and
  supersede the rejected attempt;
- draft A settling after draft B is typed never clears B; and
- confirmed actions change label and `aria-busy` in the same turn and suppress only duplicate
  activation.

### Responsiveness contract tests

- Receipt acknowledgement is recorded only after the manifest's DOM/ARIA predicate commits and
  survives the double-animation-frame painted marker.
- A named async action progresses through acknowledged, working, settled/recovered without exposing
  a generic pending flag or disabling unrelated controls.
- Two rapid activations receive distinct ephemeral invocation ids, correlate their own phases, and
  serialize no invocation id; a gesture/navigation/long-job plus child transport emits one root
  acknowledgement.
- A fast action never flashes delayed progress; a held action shows quiet progress after 300ms and
  “Still working” feedback after five seconds using fake clocks.
- Starting navigation marks the requested destination while retaining the shell and either the last
  useful surface or a final-geometry skeleton.
- Starting a background refetch preserves populated content; a settled empty result alone owns the
  empty state.
- Remote query A cannot replace newer query B when A resolves last.
- Receipt fixtures reject actual pathnames, user strings, entity ids, request values, browser/action
  objects, and exception text; a network spy proves no real-user receipt payload is sent.
- Every terminal outcome has deterministic teardown semantics. The bounded trace evicts completed
  history oldest-first, converts a live-cap breach into `timed_out` plus a test/dev failure, and
  distinguishes durable/external handoff from abandonment.
- A trusted activation that reaches query, mutation, action, or router transport without a parent
  receipt fails the runtime watchdog, including `void` and prop-indirection fixtures.
- The source inventory, manifest, and exception registry reconcile with no missing, orphaned, stale,
  or uncovered critical entries.
- Unsupported Event Timing browsers preserve behavior and semantic proof without throwing.

### API and outbox tests

- A table-driven suite covers every replay-safe endpoint adopted by this feature: same
  user/key/hash returns the original response and executes its database-owned effects once.
- Same user/key with a different payload returns `idempotency_key_reuse`.
- Concurrent claims do not execute creation twice.
- Membership removal and capability loss prevent a cached body from being returned and do not
  re-execute the handler.
- Deleting the created entity leaves the key consumed, returns the route's non-disclosing not-found
  response, and cannot recreate the entity on replay.
- Stored rows contain only the declared minimal response/resource metadata and request hash; expiry
  and cleanup remove that replay material after 24 hours.
- An expired key can be reclaimed under the documented rule and cleanup removes stale rows.
- CORS preflight allows `Idempotency-Key` only under the existing trusted-origin policy.
- A queued entry persists and replays the key byte-for-byte.
- A committed request with a lost response, followed by outbox replay, still creates one Task.
- Keyed settlement carries the validated response/entity id, and successful replay refreshes the
  authoritative list before that exact local projection leaves.

### Repository policy tests

The policy's hostile fixtures and full production-tree scan run in `@docket/test-utils`. Neither
migration ledger can grow, clean entries must be deleted, and any user-initiated production async
interaction outside a typed shared lifecycle fails CI. Autonomous user-facing work must instead
match its declared continuity owner in the exception registry. The final gate requires both ledgers
to be empty and all three coverage artifacts to reconcile.

### Browser proof

At 1440×900 and 390×844, in both themes where the manifest marks that variant applicable:

1. Hold Task POST A for at least 2.5 seconds, submit B, and verify the input remains focused and both
   pending rows are visible.
2. Verify B renders immediately but its transport waits behind ambiguous A; settle/replay A, then
   verify B sends and settles without duplication, disappearance, or stale reordering.
3. Reject one submission and exercise Retry/Edit/Discard without disturbing the other.
4. Hold two edits to the same property, settle them in reverse order, and verify the latest intent
   remains visible and editable.
5. Trigger the update card with a stalled worker handshake and verify Apply → Reloading → fallback
   reload is visibly different, `aria-busy`, and duplicate-safe; force synchronous post failure and
   verify Couldn’t apply update → Retry.
6. Measure no document overflow at 320px and verify keyboard focus/live-region behavior plus
   assistive-technology-style accessible-name, state, relationship, and announcement assertions.
7. Hold a representative app navigation and verify the requested destination acknowledges within
   100ms, the shell never blanks, unrelated navigation remains usable, and the final surface adopts
   without a focus jump.
8. Hold and reorder representative remote-search responses; verify the query changes immediately,
   the previous results remain usable with truthful progress, and only the newest result publishes.
9. Start a representative long-running operation; verify immediate accepted state, 300ms and
   five-second feedback escalation, and its supported continue/cancel/recovery path.
10. Hold persistence during a critical drag/reorder/resize journey. Pointer and keyboard previews
    update by the next animation frame, no 50ms Long Task occurs during the two-second gesture, and
    the dropped projection remains visible until settlement without a flash-back.
11. Exercise critical typing, scrolling, and expensive local-transform entries from the manifest;
    verify their owned visual state updates next-frame without being gated on I/O.
12. Export the semantic-receipt and Event Timing report for pointer and keyboard variants after one
    warm-up and three measured activations. Every measured acknowledgement must be at or below 100ms;
    one over-budget sample fails and retains its predicate, trace, and browser timing.
13. Run the critical manifest against the released build with the seeded synthetic account and
    attach the same continuity/timing evidence to deployment verification.

## Acceptance criteria

- Routine intent is visible within 100ms under injected latency.
- No audited routine property editor or rapid composer disables because a request is pending.
- No older response or rollback overwrites a newer same-field or newer-draft intent.
- Pending creates are duplicate-safe across ambiguous response loss and outbox replay.
- Every failed local intent remains visible with an actionable recovery path.
- The update control visibly and accessibly enters applying state before reload.
- The generated production interaction inventory, manifest, and exception registry reconcile;
  user-initiated async interactions use their matching lifecycle, local/continuous entries name a
  shared primitive or evidence owner, and both temporary ledgers are empty.
- Critical local-control, navigation, remote-read, direct-manipulation, mutation, and long-running
  journeys acknowledge within the deterministic 100ms/next-frame budgets while preserving content,
  focus, and unrelated work.
- Development/test receipts accept only allowlisted categories and route-template ids, exclude
  invocation correlation from serialization, and cannot ingest browser entries, user/entity values,
  request data, or diagnostics. No real-user responsiveness payload leaves the app.
- Every production mutation is classified through a shared lifecycle, the migration ledger is
  empty, and all P0/P1/P2 audit findings are corrected.
- The data-layer, inline-editing, design-system, offline, and PWA specifications describe the shipped
  behavior without contradiction.
- Focused unit/integration/E2E suites, typecheck, lint, policy tests, build, and the repository's full
  validation gates pass before completion.

## Rejected directions

- Do not add a second offline queue or move write replay into the service worker.
- Do not synthesize a successful API response or fabricate a server entity id.
- Do not hide synchronization failure behind a transient toast.
- Do not disable an input, property panel, list, or project because one mutation is settling.
- Do not serialize local acknowledgement behind an earlier network request.
- Do not use whole-record snapshots as the rollback unit for routine field edits.
- Do not clear mutable component state after `await` without checking submission ownership.
- Do not treat `server-confirmed` as a generic exemption from optimistic behavior.

# Program schedules and versioned work templates

Delivery layer 3 of the [approved work-template overview](../../superpowers/specs/2026-09-14-work-templates-overview-design.md), following [blueprints](work-template-blueprints.md). D23–D26 and D44 govern this layer.

## Product contract

A Program owns independent schedules that create Task or Project work inside it. A Task or Project can also repeat without a Program. Keep the existing calendar, completion, manual, and event trigger engine, cadence calculation, weekdays, exceptions, rolling horizon, missed-run policy, series revision boundaries, provider occurrence keys, and pause/resume/end behavior. Templates replace process definitions as the reusable structure. This layer does not introduce another scheduler or a second work writer.

A schedule selects a published Work template, carries a location-specific draft, and records the exact template/version closure used by every run. Its draft may name real teams, responsible people, step assignments and placement. A reusable template may not. New schedules default to the latest published root version; an explicit pin stays pinned. A run resolves latest references exactly once, under the publication locks already used by shared creation. Retrying that run retains its original closure even after publication or archive. Converted historical schedules retain their exact accepted selection and original source identities.

Existing schedules continue after archive with their saved versions. While publications remain
available, latest selection resolves normally. Archive continuity uses the most recent accepted
complete closure for that same series revision, or its authoring-time validated complete closure
when it has never run. It never reverts to an older authoring version after a later accepted run,
and never resolves new nested latest versions from an archived root pair alone. Persist the
authoring fallback independently of immutable run claims; only guarded persisted registration
authorizes continuity. New schedules cannot select archived templates. Show the archived state and
the version actually used, and recheck live permissions and destination validity for every run.

The Program Schedules section supports add, edit future runs, pause, resume, end, run history, retry, and visible failure reasons. Show the selected template, cadence, destination, title pattern, assignments, next run and archived-template state. Existing repeat editors supply cadence controls. Scope choices retain their existing meaning: one occurrence, or future revisions effective from a date. Past work and historical run bindings never change when a schedule draft changes.

For the community-dinner acceptance, the second Thursday schedule creates an Event Project titled `{month} Dinner`, uses that run's civil date as the Project target, assigns Book venue to Dana, and creates the nested Vendor booking tasks. Moving the event moves managed preparation dates, preserves a hand-set deposit date, and retains the same occurrence and provider key. Failure and retry are visible and never create a second dinner.

## Contracts and ownership

Use the existing `recurrence_series` and `recurrence_series_revision` records. Add a nullable same-tenant owning Program to the series. Ownership is immutable; moving a schedule uses an explicit reviewed destination edit on a new revision rather than silently moving generated work. A standalone series has no owning Program. Its destination draft may contain an actual Program/Project/Milestone/parent Task under the ordinary kind-specific placement rules. An owned schedule's root destination is its owning Program and cannot be overridden by an inconsistent draft.

Each revision holds the template target kind (Task or Project), template identity, latest-or-pinned selection, private location draft, title pattern, and per-step overrides keyed by canonical logical paths. Step overrides may assign a current workspace actor, team and cycle or preserve an explicit unassigned choice. They do not replace a child template's identity, authored structure or immutable provenance. Public contracts reuse ordinary creation validators and shared blueprint choice/date contracts. Validate all referenced entities, workflow keys, visibility and permissions with the existing creation preflight on the same transaction.

Move the existing browser-independent calendar cadence schemas to a leaf domain contract and re-export them through the current recurrence API contract. Reusable Program default schedules use a relative cadence form: interval, weekdays/monthly pattern, count end, and start offset from Program creation. They contain no absolute date, timezone, person, team, destination or provider identity. The instantiated Program schedule resolves its own start date and workspace timezone and owns an independent copy. Keep automation-event matching in its existing owning domain; avoid a work-to-planning import cycle.

Title patterns accept `{day}`, `{month}`, `{month_number}`, `{year}` and `{quarter}`. Render from the run's civil date in the saved schedule timezone, with English month names matching the current application vocabulary. Reject unknown/unclosed tokens and blank rendered titles. Bound authored patterns to 256 characters and rendered titles to the ordinary work title limit. Escape braces with `{{` and `}}`; do not evaluate expressions. Editing a pattern affects future work only; calendar moves do not overwrite an authored existing title.

A Program template may carry at most 20 default schedules. Each contains a stable key, display name, Task/Project template selection, title pattern, relative cadence and parent-based assignment rules. Publication resolves and validates referenced templates, bounds expansion, and includes schedule references in cycle detection: a Program default cannot indirectly regenerate its own template. Creating a Program installs these schedules transactionally with its work tree. A failed schedule preflight rolls back the Program, children and schedules together. Creation previews include the default schedules, destination and first-run date before acceptance. Changing or updating a Program template leaves its already owned schedule copies alone; their dedicated editor controls future revisions. Save as template captures reusable outlines and warns when private assignments or provider bindings are omitted.

## Run state and retained authority

An owning Program cannot be permanently deleted while any schedule refers to it, including ended
or archived schedules. Return a controlled conflict and preserve its run history; the existing
Program archive action remains available. Check this under the Program row lock so concurrent
schedule installation cannot turn removal into an unhandled foreign-key failure.

Keep occurrences as the durable run records. Extend their state with exact resolved invocation, generated root identities, attempt/failure code and time, next retry information where the current engine already supplies it, and completion facts. Use application-owned failure codes/copy; never display provider or exception text. An attempt ledger must be bounded/paginated and must not contain credentials, private draft documents or external error dumps. Expected, created, skipped, canceled and completed history remains readable; failed runs are additionally explicit and retryable.

All new runs call `createWorkBatchInTransaction`. They share its root/child permissions, status rules, optional choices, concrete dates, assignment triggers, search effects, aggregate receipt and 500-new-work-row cap. Program default schedules count separately against their limit, never hide additional work rows outside the shared cap. Attribution stays the real initiating/registered owner actor, including historically nullable attribution. Execution authority is an opaque transaction-registered persisted series/revision/occurrence capability. A caller-supplied manifest, fabricated actor, ordinary work creator, null actor or archived flag grants no execution rights.

Resolve and record an accepted latest-version closure in the occurrence's guarded claim transaction before its work transaction begins. The work transaction consumes only that persisted exact closure through registered authority. A work failure rolls back all work and effects, then records the failed attempt without discarding the accepted closure; retry cannot silently select a newer publication or bypass archive rules. A failure before a valid closure was accepted records its owned failure code without an executable binding. Retry of that unresolved run performs current validation; an accepted binding is immutable. Live permissions and destination validity are rechecked for every attempt. No arbitrary client manifest becomes a retained capability.

Existing roots are located through the occurrence's actual root references and each generated item's template/version/step origin. Historical private source identities that cannot safely become public origin remain restricted occurrence receipts. Do not introduce replacement process-instance or instance-mapping tables. Restricted retained receipt data exists only to preserve historical keys and exact date ownership; new canonical runs derive descendant identities from their concrete origin and actual hierarchy. Deleted children remain deleted on replay, completed/canceled roots stay terminal, manual/null dates stay manual, and archived templates continue only for an exact accepted retained binding.

Completion follows the recorded generated roots and actual descendant statuses using the existing terminal-state policy. It does not depend on a process instance's independent state. Completion-anchored schedules use the saved timezone and concrete completion facts. The same shared reflow engine handles foreground edits, completion changes, MCP edits, automation actions and provider calendar moves; managed run-date movement is a checked internal mutation, not an explicit user pin.

## Reversal and foreground work

Record installed Program default copies as companions of the same work-creation receipt. Undo uses
one existing atomic change-set transaction for the Program, its original included work and unchanged
installed copies. End those copies without deleting revisions, accepted runs or subsequently generated
work. An independently edited copy or work row refuses the whole reversal, retaining an actionable
receipt. Do not depend on change-set query order; delete created Milestones after their recorded Tasks
are archived.

Record native managed-date ownership before/after values with their ordinary work changes. Reversal
restores both atomically, including manual/null pins and last-derived dates. Only an exact persisted,
same-tenant receipt proof may clear a native manual pin; ordinary date writes cannot unpin it. Append
the guard migration without modifying earlier migration bytes.

If reflow discovers a date that already diverged from its last derived value, recognize its prior
manual intent without changing the public work row. That inferred recognition remains pinned when
the later anchor action is undone; it is not an action-owned companion to reverse. Explicit date,
null and same-value pins remain recorded and reversible with the ordinary current work permission.
Terminal and inferred-manual consumers do not become write seeds or consume the affected-write cap.

Foreground changes use the current editor's live work permissions. Authorize only affected writes;
read-only prerequisites and unrelated existing descendants do not require edit rights or consume the
500-write limit. Future execution still checks the saved schedule owner's current authority. Revoking
that owner must not strand another authorized person's existing generated work.

All public undo entrypoints pass the verified current principal into an authorization callback
inside the existing atomic reversal transaction. A stored receipt is provenance, not enduring
permission. For Program defaults require current private schedule management and current Program
management; check every other affected work row with its ordinary edit policy. Native/retained date
companions require current work edit rights without granting private schedule visibility. Resolve
personal Athena and phone users to their real active actor in the receipt's tenant; never use the
original creator as substitute authority.

A missed calendar occurrence awaiting a decision offers an explicit Create work action. It requires a
current authorized manager and resolves the exact stored occurrence/date/revision; background sweeping
cannot silently approve it. Failed attempts retain the separate Retry action and accepted closure.

## Migration and compatibility

Use an append-only expand → resumable conversion → enforce → remove sequence. Preserve all existing migration bytes. Test the complete historical journal on PostgreSQL, including populated team/private templates, archived sources, pending process drafts, nullable creators, partial executions, deleted work, calendar bindings and interrupted conversion. No `DROP ... CASCADE` retirement and no destructive rebuild of retained work.

Frozen 0154 retained child ordering in publications but not root or pending-source sort. Before the first archive, a changed original whole-source MD5 blocks retirement wherever original root or pending-source ordering cannot be independently proved, including suspected header-only edits. Keep legacy sources and reconcile independent original evidence; never infer ordering from retained arrays or replace the original fingerprint.

1. Expand series/revisions/occurrences with canonical schedule draft, ownership, run state and versioned invocation fields. Add same-tenant exact-publication references, bounded JSON guards and RLS. Add a manifest discriminant for native schedules while continuing to parse historical immutable invocation JSON unchanged. Historical source revision/step identifiers become opaque private lineage, not live foreign keys to soon-retired tables.
2. Convert every definition/revision to its existing canonical template publication or restricted unpublished draft. A single Task process becomes a schedule on the base Task with its private draft; multi-step definitions retain their converted template and forest without a fabricated visible wrapper. Preserve source key translation, specific assignments, dependencies, run/provider IDs, original/current dates and revision boundaries. Capture immutable source integrity facts needed for later retained proofs before retiring the source tables.
3. Convert instance completion/failure and exact generated-work references into the owning occurrence's run receipt. Verify one-to-one roots, descendant origins or restricted historical refs, retained date ownership and no changes to physical work. Ad hoc historical instances without a series get a non-running historical receipt; never manufacture an active schedule. Record resumable conversion receipts with source fingerprints. Ordinary migration verifies immutable archive integrity while deferring sources whose original ordering cannot be proved; strict retirement verification still fails closed on source drift. Never rewrite fingerprints to bless mutable source changes.
4. Switch the existing scheduler/materializer, completion advancement, recurrence backlinks, calendar synchronization and series editing to canonical records. Keep existing public REST/MCP shapes as explicit adapters over templates/schedules, preserving historical IDs as opaque aliases. Compatibility process creation/publish/edit maps to canonical template drafting/publication and private schedule drafts; it must not recreate retired SQL tables.
5. Verify no live source query, FK, trigger, RLS policy, search job, export, purge path or public adapter still requires process definitions/revisions/steps/specs/instances/maps. Verify exact old/new execution equivalence and source counts/checksums in PostgreSQL. Only then append the removal migration for those tables, after moving all restrictive FKs/guards to canonical schedule/invocation ownership. Keep occurrence/series/trigger/exception/weekday tables and calendar provider keys.

Legacy `define_process`, `schedule_process`, `repeat_task`, REST process routes and generated recurrence backlinks remain usable. Their adapters validate through the canonical domain contracts and use the same service/DAO path. Legacy response fields such as process/instance IDs are stable opaque aliases backed by migration receipts, not permission shortcuts. List/detail reads apply current visibility to the owning Program and private schedule draft; unauthorized callers cannot learn schedule names, assignments, hidden template bodies or historical private keys.

Private definition bodies require live workspace View and either the actual definition-head owner or workspace Manage; a Program manager does not acquire workspace source-authoring rights. An explicit null head owner never falls back to old creator attribution. If row-level security can hide a head, an absent visible head fails closed before any legacy fallback. Every legacy schedule alias uses the same actual Program or workspace scope policy as native schedules. Source capture checks the complete ordinary-work tree on its capture transaction, and generated backlinks/history omit currently unreadable work. Archiving a definition checks every affected schedule before committing any lifecycle changes.

## Interfaces and delivery plan

Implement in this order, committing usable source slices with affected checks before each delivery:

1. Extract cadence contracts; add strict schedule selections/drafts/title patterns and default schedules with pure tests.
2. Expand storage and write conversion/verifier fixtures, including resume and private-source guards; prove them on real PostgreSQL before API cutover.
3. Add canonical authoring/materialization to the retained scheduler and sole work creation service. Migrate history and completion. Add Program default schedule copies in the shared transaction and preview/capture paths.
4. Add canonical schedule REST routes and MCP discovery/create/edit/retry adapters. Preserve the old tools through explicit translation and test both contracts against the same stored schedules.
5. Add the typed-query Program Schedules section, shared repeat editor extensions, standalone Project repeat, history/failure/retry UI and accessible previews. Use shared components and application-owned failure copy.
6. Verify the populated dinner journey, calendar movement, after-completion continuation, pause/resume/retry, old API compatibility and migration cutover. Append retirement only after all source/runtime and migration checks establish canonical ownership.

Affected areas are `domains/work` leaf contracts, `domains/planning` recurrence calculations, `packages/db` canonical schema/migrations/conversion/purge, `apps/api/src/lib/recurrence`, shared creation/reflow/template services, recurrence/process contracts and routes/MCP tools, and `apps/web` Program/repeat/template/Inbox surfaces. Extend the existing typed query layer; do not call APIs directly from new components.

## Acceptance

- A populated Program creates October Dinner and preparation work, preserves exact template identities and step assignments, and shows its run history.
- Latest/pinned selections, independent Program default copies, month/quarter/year boundaries, invalid patterns and calendar/DST civil dates behave as specified.
- Moving the calendar event retains one occurrence and root, moves managed dates and preserves manual/null edits. Retries are idempotent; partial failures roll back all new work and retain a visible failed run outside that transaction.
- Pause/resume/end, one/future edits, completion cadence, exceptions, missed-run policy and horizons retain existing behavior. Historical runs and deleted work remain stable after template archive/publication.
- Hidden/private/foreign templates, suspended creators, invalid assignments, forged/cross-transaction authority and over-limit expansion fail without partial work or leaked details.
- Full-journal PostgreSQL upgrades, interrupted conversion and equivalent legacy REST/MCP execution pass before process-table removal. Required affected tests, types, lint, complexity and builds pass without ledger relaxation.
- Authenticated populated UI acceptance covers both themes, desktop/phone/short-phone/320px, keyboard interaction, failed run/retry and independent default-schedule editing. Provider release evidence remains distinct from local source/runtime evidence.

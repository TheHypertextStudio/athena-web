# Canonical private schedule cutover

This specification completes the legacy canonical conversion required by [Program schedules](work-template-schedules.md). Expand metadata and prove semantic parity before activating converted execution or removing source tables.

## Delivery boundary and order

The smallest independently deliverable next slice is **A1: immutable private revision aliases and canonical head-backed reads**, with an additive migration, resumable metadata backfill and actual PostgreSQL tests. It must not set `schedule_draft` on old revisions: that field immediately dispatches execution to the native engine. A1 is useful because private definition list/detail/history becomes source-independent for proved rows and authored publication numbers stop depending on mutable head counters.

Then deliver **B1: exact private timing/title/completion contracts and their shared-engine support**, **B2: nonexecuting conversion preview/receipts**, and **A2/B3: canonical-only fresh legacy authoring plus explicitly registered activation of proved schedules**. This order prevents a new legacy definition from publishing a canonical graph that the retained engine cannot actually run.

Do not combine expansion, activation and retirement into one migration. Existing SQL through0164 and the original MD5/invocation JSON remain unchanged. The installed journal ends at index164 (165 entries). Reserve the next migration number immediately before implementation; names below describe intent rather than allocating numbers concurrently.

## What exists, and why a direct switch is unsafe

| Installed seam                                                                                                                                  | Required consequence                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `work_template_invocation_head` retains definition ID, owner, metadata, CAS `revision`, latest draft/published invocation pointers              | CAS revision is not a process publication number. A metadata rename must not manufacture publication2. No API currently writes these heads; old metadata writes still touch `process_definition`. Establish one metadata owner before changing that.               |
| `work_template_blueprint_conversion` maps old revision -> immutable invocation and original MD5; source archive/hash is write-once              | Keep it as evidence, not a mutable canonical authoring table. Fresh authoring must not fabricate an old revision or MD5.                                                                                                                                           |
| Historical manifests are `published`/`pending_draft` with old source IDs; native forests are kind `forest`, revision1                           | Parse old documents unchanged; a typed adapter may normalize them in memory. Pending original roots can have null selections, whereas even native `pending_draft` forests require valid selected publications and at least one root. They are not interchangeable. |
| `scheduleDraft` is null on retained series revisions; `materializeCanonicalSchedule` selects canonical execution as soon as it is nonnull       | Conversion storage is separate from activation. A failed/partial conversion must not dispatch to a different writer.                                                                                                                                               |
| `schedule-timing.ts` and native ownership `anchor:work` derive from planned Task due/Project target                                             | They do not represent `after_step_completion` or Project start. Do not encode completion as planned-date timing.                                                                                                                                                   |
| Legacy `datesOf`/`retainedDateRule` use literal field offsets first, then primary timing: Task due, Project start, Milestone target             | Preserve this precedence and explicit absent dates. A Project target without a literal target offset is null, not automatically the run date.                                                                                                                      |
| Legacy name rendering substitutes `{date}`, padded `{month}`, `{year}`, `{monthName}`; unknown braces remain literal                            | Native `{month}` is an English name and numeric tokens are unpadded. Native escaping/token validation is not a lossless translation.                                                                                                                               |
| `processTasksComplete` requires each authored source Task to have a mapped `completed_at`; ignores Project status and template-only descendants | Native terminal-root/all-descendant completion is different. Preserve the legacy policy on converted/legacy-authored definitions. Canceled/missing source Tasks do not automatically count as completed.                                                           |
| Retained applied root refs may use arbitrary original `sourceKey`; full accepted closure may be absent                                          | Do not rewrite immutable applied refs or synthesize `accepted_claim` from root/version pairs. Imported receipt authority is distinct from a newly accepted native claim.                                                                                           |
| Old source/archive/map FKs and trigger checks are still live                                                                                    | A/B installs proof and adapters; it does not establish source-query retirement.                                                                                                                                                                                    |

## A1 storage: one immutable revision registry

Add `work_template_invocation_revision` as **canonical authoring/alias metadata**, not a process-instance/work-mapping replacement. Proposed columns:

- `id` = compatibility revision alias. Imported rows keep exact `process_revision.id`; fresh rows receive an ordinary new ULID with no old SQL row.
- `organization_id`, `head_id`, `invocation_id`: exact same-tenant references to existing canonical head/invocation identities.
- `number`: original authored revision number; positive and unique `(head_id,organization_id,number)`. This includes retained pending authored revisions; published eligibility is separate.
- `state`: `published` or `pending_draft`; `published_at` nullable with matching shape; original `creation_mode` preserved as compatibility metadata.
- Original revision audit timestamps/nullable creator attribution as private immutable metadata. Attribution is not authority.
- `origin`: `retained` or `authored`. Retained rows reference their original conversion receipt and verified archive hash/MD5, without replacing either. Authored rows have no fabricated retained fingerprint.
- A versioned immutable compatibility key/order projection: exact original step alias and `sourceKey`, canonical root key/path/kind, original sort and stable tie-break facts. This is authoring lineage, not physical work IDs. Imported order must come from independently proved original source/publication, never invocation array position.

Use composite uniqueness `(id,organization_id,head_id)` and `(invocation_id,organization_id)` as required for exact references; same-tenant FK for every relationship. Guard UPDATE/DELETE as immutable except the existing complete-workspace purge exception. Head pointer guards must verify that draft/published invocations belong to this head's registered revision and published pointer targets a published row. Null head owner never gains old-creator fallback.

Add an explicit head authoring-owner marker (`legacy_mirror`/`canonical`, or a write-once `canonical_authoring_at`). Until canonical ownership is registered, legacy metadata remains authoritative. At the one-time ownership transaction, lock the source definition and head, copy current mutable name/description/lifecycle to head, retain the old frozen header in evidence, then stop old metadata writes for that head. Do not let a resumed backfill overwrite a canonical user rename. Increment head CAS only for real head edits, not each resumed metadata batch.

RLS registry access inherits the head's current workspace View plus owner/actual workspace Manage policy. All body reads continue through `requireLegacyDefinitionAccess`; Program management alone does not reveal workspace source definitions. A private series may return its existing opaque definition/revision aliases after schedule access without returning the source body.

### A1 service interfaces

- `resolveLegacyDefinitionAlias(tx, caller, definitionId, access)` -> canonical head plus edit capability; fail closed on hidden/unconverted head, no legacy fallback after canonical registration.
- `resolveLegacyRevisionAlias(tx, head, revisionAlias?)` -> immutable exact revision; explicit aliases must belong to that head/tenant. Scheduling default resolves `publishedInvocationId`, not newest pending number.
- `loadCanonicalPrivateDefinition(tx, registeredRevision)` -> normalized in-memory private definition from original invocation/overrides + proved archival metadata, or fresh canonical payload. No live process query.
- `projectLegacyDefinition(head, revision, privateDefinition)` -> existing `ProcessDefinitionDetailOut`/summary/revision DTOs, including exact step keys, numbers and audit fields.
- `listCanonicalPrivateDefinitionIds(...)` -> visible-only cursor pages/refill, then project authorized bodies.

`list-store.ts`, `loadProcessDefinitionDetail`, `listProcessDefinitions` use these for canonical-registered definitions. Keep unproved/unconverted definitions on the current authorized source path with a counted private disposition; absence of a registered alias is not permission to expose it. Alias metadata creation does not publish a Work template or authorize execution.

## B1 contracts: private definition and exact date semantics

Add internal leaf contracts in `domains/work` and server validation together. No new MCP generic forest authoring, raw manifest input, alternate query layer or public retained-authority DTO.

1. **CanonicalPrivateWorkDefinition v1**: private authoring payload with published/pending state, ordered root selections, reusable root/child draft parts, exact source-key translation, qualified dependencies and compatibility policies. Definition payload is timezone-neutral; timezone belongs to each installed schedule. Fresh payload uses a new explicit manifest discriminator in `blueprintInvocation`, not fake `legacyProcessRevisionId`. Original manifest/overrides remain byte-for-byte unchanged. Reuse `WorkScheduleRootDraft`, `WorkScheduleStepOverride`, optional choices and template selection primitives rather than copying their validators.
2. **PendingPrivateWorkDefinition v1**: nonexecuting private source envelope with nullable/missing selections and zero roots allowed when genuinely retained. Store original body/projection losslessly; do not force it through the runnable forest validator, resolve latest, publish placeholders or infer a publication from a draft name. A pending envelope can be read/re-entered by its owner; explicit publication validates a new immutable publication before scheduling is allowed. Unsupported/oversized retained source stays preserved and nonexecuting, with an owned review disposition.
3. **PrivateScheduleForest v2** (keep existing forestv1 parser/behavior): qualified target **field** plus explicit date policy. Each target `(rootKey,path,field)` has one of `run_offset`, `planned_work_date` (explicit prerequisite field), `after_completion` (qualified accepted prerequisite), or `absent`. Offsets carry their unit; retained conversion uses calendar days. `absent` suppresses a new native default/template date without pretending that a generated null was manually pinned. Selected-path and cycle validation remains bounded. Keep physical parent-creation/existence edges separate from per-field date derivation edges: a Project may already exist with startDate waiting on one of its child Tasks. Reject genuine semantic date/dependency cycles without turning that lawful relationship into a creation cycle.
4. Versioned title rendering policy: native tokens stay unchanged. Legacy policy preserves the exact four replacement tokens, padded numeric month, literal unknown braces, and replacement order used by `renderName`. Apply to all authored Task/Project/Milestone titles where the old adapter did, not just roots. Preserve literal Markdown and blank-document replacement. Rendered output still passes ordinary title constraints; oversize failures are owned failures, not truncation.
5. Versioned completion policy: native actual-tree terminal policy unchanged; legacy policy records the exact authored Task paths that require concrete `completed_at` facts. Project state/template-only children cannot newly block old continuation. Missing/deleted source Task facts retain the old noncompletion behavior. Preserve creationMode in DTOs while keeping current eager shared creation for both modes; after-completion timing defers dates, not creation.

A native/private future forestv2 is still at most500 selected new work rows. Do not cap complete historical reference storage/reads at that limit. A pending source needing more than500 new rows remains nonexecuting until a valid publication is explicitly authored.

### Exact retained date translation

For each step, compile every supported target date field, not one inferred primary field:

| Kind             | Literal offset, if present | Fallback if absent |
| ---------------- | -------------------------- | ------------------ |
| Task start       | run + start_offset_days    | absent/null        |
| Task due         | run + due_offset_days      | source step timing |
| Project start    | run + start_offset_days    | source step timing |
| Project target   | run + target_offset_days   | absent/null        |
| Milestone target | run + target_offset_days   | source step timing |

Source timing is run for on_trigger, run+offset for relative_to_trigger, and actual accepted prerequisite Task completion civil date+offset for after_step_completion. Missing completion yields null. The existing old contract can reference a non-Task prerequisite; it has no Task completion fact and must retain its null-date behavior rather than inventing a Project completion timestamp. Per-field literal offsets take precedence over that timing.

Bind timezone from existing calendar revision timezone. For manual/event/after_completion revisions, capture the actual existing planning context timezone deterministically during registration; a source definition has no timezone to invent. Record this choice in the immutable schedule conversion proof. If original historical timezone is not independently recoverable, preserve stored absolute/current dates and mark historical derivation unproved; current preferences are not proof of an old completion's civil date. Keep that run nonexecuting until a lawful explicit future revision/adoption supplies the missing context. Never use today's date to reinterpret offsets or an original run's anchor.

Extend `compileScheduleTiming`, `nativeDateOwnership`, `planNativeScheduleReflow`, `schedule-native-affected`, and snapshot/completion fact construction together. Reuse shared `deriveBlueprintDate`, `completionCivilDate`, working-day logic and foreground affected-write authorization. Add explicit completion anchors to private ownership and matching SQL JSON validation; a planned date cannot act as a completion fact. Keep manual/null/inferred pins, terminal exclusions, same-transaction undo companions and500-affected-write cap intact. Reading prerequisite facts does not grant schedule-body visibility or require edit rights on unrelated descendants.

## B2 conversion: prepare first, activate only after proof

Add immutable `canonical_conversion`/`canonical_import_receipt` metadata on the existing revision/occurrence records (or a single revision receipt table if column shape is impractical); do not add instance/map tables. Receipt discriminants distinguish registered conversion, imported history and future executable claims. Proposal:

- Revision receipt: original invocation/alias, exact source archive hash + original MD5 reference, compiler revision, frozen timezone, candidate forestv2, complete key translation, execution eligibility/disposition.
- Occurrence import receipt: exact existing occurrence/series/revision/provider key/original/current date; old instance alias; original archived evidence reference; complete physical mapping/selection/tombstone facts; exact accepted versions where independently known; captured date ownership/manual flags; original completion/failure and continuation facts; eligibility `history_only`, `partial_resume` or `applied`.
- New receipts are write-once and private. Ordinary actual work/state remains mutable through existing services. Original archive, original invocation, existing applied refs and native accepted claims are never rewritten.

Use bounded transactions and shared lock order **head (when authoring) -> series -> series revision -> occurrence -> referenced work/publications**, with a consistent documented source-row lock placement during import. Never hold a legacy source lock then attempt series locks in one path while another takes the reverse order. Batches are idempotent by unique source identity, checkpoint observers run after commit, and rescans recover skipped/lower-ID/concurrent writes. Every deferred row gets a stable owned reason; counts may be logged, bodies stay private.

### Original proof before translation

- Existing original MD5 equals `md5(docket_blueprint_retained_source(id)::text)` at original conversion. Verify retained archive integrity separately.
- When an existing archive contains the exact original graph, compute `md5((source_archive->'source')::text)` in PostgreSQL and compare to the untouched original MD5. This can independently prove original root/pending sort even if today's definition header was renamed. Do not substitute the JS SHA serialization or hash of the entire archive wrapper.
- Feed the original archived source and independent original-publication sort facts through the existing source/field/dependency/order verification. An archived snapshot made by an older buggy archiver is not proof merely because its SHA matches itself.
- Compare current normalized structural/spec/edge/order facts against proved original facts under locks. A header-only change is mutable head metadata, not a new publication. Changed specs/order/assignments need an explicit separately proved revision/adoption disposition; do not silently call them the old immutable publication.
- If neither unchanged original source nor a complete independently verified original archive proves root/pending order, quarantine/retain. No MD5 restamp, array-position inference, repaired publication number, or bypass flag.

The current strict `verifyWorkScheduleArchives` must remain fail closed. A/B does not automatically turn mutable-header/instance drift into a passing retirement check. Eventual retirement needs a separate locked final cutover proof that preserves both original immutable evidence and authorized final mutable facts; replacing strict verification with ordinary integrity is forbidden.

### Runs and history

1. Preserve **all** old runs, not only materialized/active or first50. Existing `legacyInstanceId` is the exact instance alias; unbound ad hoc instances stay `runKind:historical`, no executable claim/series, no synthesized successor.
2. Copy complete source mappings and selection tombstones. Existing `readScheduleHistoricalReferences` already pages private JSON references; use it and visible-work filtering. Historical >500 references remain complete/nonexecuting. Do not truncate to fit `AcceptedScheduleRoots`.
3. Never infer original nested latest choices from current publications/current work. Full persisted `resolvedManifest`+`selectedWork`, exact physical origins, original mappings and verified source projection must agree before importing replay authority. Root/version pairs alone can be history facts only.
4. Applied legacy roots may have noncanonical original keys and immutable refs. Store the canonical key translation in the new import receipt; do not mutate those refs or present imported history as a newly accepted native claim. Extend a transaction-registered imported receipt factory used by existing retained/shared creation/snapshot services. Its data is private provenance; only the factory's exact persisted row/tenant/transaction proof grants authority.
5. Partial executions adopt only independently proved original physical work. Existing edited fields/manual dates remain; missing original slots can be completed through the sole `createWorkBatchInTransaction` with checked retained binding. Deleted/terminal work never resurrects; replacement work at an equal path is not the old selection. Do not invoke that writer during backfill itself.
6. Missing closure, unproved mapping, invalid current destination, unsupported pending body or oversized execution becomes a retained disposition. Keep the authorized legacy runtime available until a specific schedule is safely activated; no migration silently disables an active schedule to achieve a green count.
7. Null creators preserve null attribution. Future work uses existing transaction-registered `authorizeRetainedRecurrence`/canonical registered capability, never an arbitrary owner actor. A live revoked/inactive nonnull creator cannot be replaced by null or another actor. Foreground edits of existing generated work retain the actual editor's work-scoped rights.
8. Capture current completion facts without invoking completion advancement. Add an internal immutable run-origin/continuation-eligibility discriminator, derived during checked registration and never accepted from clients. Imported completed/history runs cannot become new continuation sources during checkpoint, resume, recovery or sweep; adopted current runs can continue after a later real completion. Link an already-existing successor only when identity is proved; future real completion events use the unique continuedFromOccurrenceId path and original governing revision boundaries. Do not put continuation keys in the provider namespace or infer links merely from date adjacency.

Only after the candidate and complete required run receipts verify, register the canonical schedule draft/fallback/activation marker in one series-locked transaction. For histories needing imported authority, materializer/completion dispatch must read that registered discriminator first; do not rely solely on nonnull draft or null definitionId. A2/B3 cannot activate until those consumers support the receipt.

## A2: canonical-only legacy authoring and alias constraints

Fresh `define_process`/REST authoring compiles directly from the existing strict ProcessDefinitionCreate DTO, with stable generated compatibility aliases; use `prepareProcessTemplates` and canonical publication/preflight services on the same transaction. A single Task selects its actual/base publication with private fields, avoiding an unnecessary visible template. Multi-root work stays an ordered private forest with no fabricated visible parent. Reusable template publications contain structural defaults; literal source bodies, real actors/teams/cycles/destinations remain private. Use the existing sanitizing `recurrenceWorkTemplateDefinition` pattern without reloading normalized source rows.

Persist canonical invocation, immutable alias row and head pointers atomically. `createPublishedProcessDefinition`/`appendPublishedProcessRevision` keep their current return shape including exact authored `stepIdsByKey`. `updateProcessDefinitionMetadata` touches canonical head CAS only after ownership; archive retains the legacy action of atomically authorizing/ending every affected series, independently of normal Work-template archive semantics. `/from-project` continues the existing complete-source capture authorization before any body serialization.

Before allowing fresh aliases in scheduling, append the alias-reference migration:

- `recurrence_series.definition_id` and calendar binding.definition_id -> same-tenant canonical head, preserving exact existing strings.
- `recurrence_series_revision.process_revision_id` -> same-tenant registered revision alias checked against the series' head, preserving exact old strings. Native rows remain null where appropriate.
- Replace source-dependent series/invocation guard branches for **new** private-definition payload and registered revision aliases. Preserve old guarded manifest shapes until their separate retirement proof; do not remove original source checks prematurely.
- Validate/backfill registry before dropping any old FK. New canonical rows must not need a shadow process_definition/revision. Cross-tenant/wrong-head/mismatched invocation aliases fail in PostgreSQL, not just app code.
- Define restrictive deletion and explicit whole-workspace/account purge ordering. Canonical heads/revisions/history survive ordinary template/Program archive; full tenant purge must still pass the accepted-run case.

`createRecurrenceSeriesInTransaction` resolves authorized canonical definition/publication and installs a private per-series schedule snapshot with current scope and normalized trigger data. Factor the existing schedule-authoring insertion/preflight into a shared internal helper supporting an explicit exact alias ID; do not expose raw aliases/manifests as authority. `createScheduledProcess`, `createRecurringTask` and calendar binding creation delegate this same path. Cadence/weekdays/exceptions/horizon/missed policies remain in existing trigger storage/sweep.

## Exact integration points and source ownership

| Existing file/function                                                          | Bounded change                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB invocation-head/blueprint schemas, migration checkpoint                      | registry/head ownership/receipt schemas, append-only guards, resumable registration; no old manifest edits                                                             |
| `process-definition.ts` persistRevision/create/append/read/list/update/archive  | replace normalized persistence with canonical private definition authoring after A1/B1; exact DTO projections                                                          |
| `list-store.ts`, `legacy-definition-access.ts`, `legacy-definition-archive.ts`  | head-backed privacy, visible cursors, scoped atomic archive; preserve current actual actor/tenant checks                                                               |
| `work-template-authoring.ts` / source / definition / task-template-identity     | pure DTO-to-private-definition compiler; reuse canonical template service and sanitization; remove source reload from fresh authoring                                  |
| `series.ts` latestProcessRevision/persistSeriesRevision/create/future edit      | resolve exact alias, shared canonical authoring insertion, original effective boundaries; no new scheduler                                                             |
| `authoring.ts`, `recurring-task.ts`, calendar-binding service                   | preserve existing initial-window behavior over canonical installation; same provider binding IDs                                                                       |
| `schedule-compiler/timing/preflight/authority/runtime`                          | parse v1/v2 privately, exact title/date policies, guarded fallback/claim; imported receipt capability distinct from native claim                                       |
| `schedule-native-*` affected/facts/timing/status/completion/reflow              | exact legacy completion facts/fields/policy, same foreground rights/undo/dedup; no project-status substitution                                                         |
| `materialize.ts`, `schedule-materialize-adapter.ts`, `work-template-adapter.ts` | registered dispatch; shared work writer; original source-key output projection, exact existing instance alias; stop instance/map inserts only for canonical-ready rows |
| `retained-authority/source`, retained snapshot/paths/date-rules/reflow          | reconstruct original identities from registered canonical/import receipts instead of live source queries for activated rows; preserve strict transaction-scoped proof  |
| `series.ts` occurrenceOutputs/history/backlink                                  | canonical actual roots/private import receipt and visible work; do not replace legacy full DTO arrays with first native page                                           |

The final rows of this table touch part of C, but they are **activation prerequisites**, not optional later cleanup. A1/B1/B2 may ship with zero activation; A2/B3 must not ship canonical-only writers while these required consumers still query nonexistent new process rows. The source-query retirement inventory must be verified against installed runtime readers and PostgreSQL dependencies before removal.

## Migration/checkpoint sequence

1. **Alias expand**: new immutable registry, head ownership marker, composite identities/RLS and source-independent private payload discriminator. No old FK removal, draft activation or data rewriting. Full fresh journal test now.
2. **Alias checkpoint**: proved source registrations in bounded committed batches; pending bodies preserved; exact source MD5/order independent proof. Project canonical list/detail only for registered rows. Defer unresolved proofs with private reason and retry; no retirement success claim.
3. **Semantics/import expand**: strict forestv2 and ownership/completion/title policies, candidate/import receipt guards, current v1 support unchanged. Services/pure tests before any registration/activation.
4. **Prepare checkpoint**: per-series candidate docs, exact complete run/history receipts, source-key/provider/closure/ownership parity verifier; no work creation, dispatch switch or completion advancement. Imported histories may be arbitrarily large but paged; candidate expansion stays500.
5. **Alias enforce + canonical writers**: only after the required tenant-wide alias FK populations verify and registered discriminator consumers are ready. Replace exact FKs/guard branches, enable fresh canonical aliases, bridge head metadata ownership, register activation transactionally for verified series. Unproved retained schedules keep explicit source-dependent disposition and sources remain present.
6. **Separate C/D**: finish every remaining source reader/writer/trigger/export/purge dependency, then writer barrier and strict final proof, restricted source-permission-denial runtime tests, explicit named drops withoutCASCADE. A/B completion is not permission to remove tables.

Implementation can combine adjacent expand DDL only when the same checkpoint/rollback and permissions are proved; never run enforcement before its backfill. Preserve all prior migration hashes/snapshots and test both fresh full journal and upgrade from the populated predecessor.

## Required RED -> GREEN evidence before each activation

- **A1 alias/privacy**: imported revision numbers1/3 plus pending4; metadata rename increments head CAS while publication remains3; fresh aliases no process rows/MD5; exact old keys and latest-published selection; second actor/Program-only manager/revoked/inactive/foreign denied; real restricted PostgreSQL RLS, hidden-head and null-owner cases. Duplicate alias/number, wrong-head/tenant/invocation FK rejected. Account purge with accepted run still works.
- **B1 semantic differential**: same fixture through retained compiler and canonical compiler: Task start/due, Project start/target, Milestone target, literal-over-completion precedence, cross-root completion, missing/non-Task prerequisite, manual-null pins, DST/timezone boundaries, negative offsets, working days for newly authored rules. Planned due change must not trigger completion date. Actual completion move/reopen/undo reflows only still-managed affected work. No 501st write/partial tree.
- **Title parity**: `{date}`, `{month}`, `{monthName}`, `{year}`, unknown/literal braces, child/Milestone names, short/empty/long Markdown, exact blank replacement, maximum title failure; native title behavior unchanged.
- **Completion parity**: Project remains planned while every source Task has completed_at -> old-style completion; nested template-only open work does not unexpectedly block; canceled or deleted source Task does not silently complete; zero-Task case and archived sources explicit; both creation modes create complete selected work eagerly with dependent null date until actual completion.
- **B2 history/proof**: immutable JSON/MD5/hash byte equality before/after; original valid archived order proof versus stale/forged self-consistent archive; header-only rename with independently proved original archive; changed root/pending order defers, never restamps; pending missing selections/empty roots remain nonexecuting; partial work/edited prose/deleted rows/replacements/manual dates retained; complete historical501+ refs paginated, never runnable.
- **Concurrency/resume**: interruption after each committed alias/candidate/import batch; repeated migration no duplicated aliases/heads/receipts; concurrent old write either waits or invalidates candidate before activation; lower IDs/relocked rows retried; racing provider move/future edit uses original provider revision; conversion/scheduler cannot create work twice. Real PostgreSQL transactions/constraints required, not mocked SQL only.
- **Actual integration**: old REST+MCP define/schedule/repeat/from-project and calendar bind -> canonical rows only for fresh writes, exact old DTOs, full history beyond50, same provider/current/original keys, failure/retry/archive continuity, after-completion month-end successor exactly once; no successor on imported completion. Privileged source-write observer verifies no new process/spec/instance/map rows. Activated paths still work with process source SELECT/INSERT/UPDATE revoked in an actual restricted role; unconverted paths fail closed/retain explicit source dependency.

Use existing package-db retained fixtures, storage/source-order/upgrade tests and owned PostgreSQL verifier seam on a disposable task database with explicit lease. Extend fixtures rather than changing them to grant access artificially. Preserve normal migration ordering and exact journal execution. Existing `work-template-cutover`, `work-template-retained-*`, `work-schedule-*`, legacy disclosure/alias route+MCP and purge suites are the affected regression base. Run actual RED before wiring, affected types/lint/complexity/build graph after source freeze; provider production acceptance remains a separate release gate.

## Non-negotiable blocked dispositions

A source with unproved original root/pending order, unknown original accepted nested closure, missing/ambiguous historical physical identity or changed immutable source body remains retained. Its presence can block global retirement/enforcement; it must not block unrelated ordinary upgrades indefinitely. No fake native accepted claim, fabricated actor/old revision/MD5, array-order guess, artificial public wrapper, history truncation, silent schedule disable, ledger relaxation, frozen migration edit or second work writer is an acceptable resolution.

## B2 preparation and activation boundaries

Deliver preparation metadata, v2 engine support, and explicit activation as separate checked slices.
Preparation writes no `schedule_draft` and grants no execution authority. An appended migration after
the copy-reference migration adds immutable revision conversion receipts and actual-work import
receipts, independent hashes, and separate retryable private review dispositions on the existing
revision/occurrence rows. Do not introduce another instance/map store or mutable completion cache.

Revision receipts bind original head/revision/invocation aliases, untouched MD5/archive proof, exact
pinned selected closure, compiler version, and a saved timezone with independently recorded proof.
Current preferences cannot establish a historical timezone. Historical receipts preserve original
instance aliases, root receipts, source keys, physical identities/tombstones, immediate publication
and projection origins, date ownership, provider IDs, and successor facts. Terminal history remains
noncontinuing; copying an old completion timestamp must create zero successors. Unknown closure or
origin facts stay reviewable and nonexecuting.

Lock ordering requires actual concurrency proof. Existing normalized append takes source definition
before canonical head. A source-bound importer therefore takes source `FOR NO KEY UPDATE` before the
canonical head → series → revision → occurrence → referenced-work chain; `FOR UPDATE` would conflict
with registered creation's head-share/source-FK key-share order. Legacy advance also takes instance
before occurrence while materialization takes occurrence first. Do not register adopted-current
authority until these writers share a proved owning serialization boundary. Preparation may retain
non-authoritative previews and independently proved terminal history while that barrier is pending.

V2 runtime support must preserve exact per-field timing, absent dates, legacy title tokens, actual
authored-Task completion policy, current foreground permissions, manual pins and atomic Undo. Native
v1 semantics stay intact. Historical imports use a distinct transaction-bound registered capability;
they never receive a fabricated native pre-work accepted claim. Future new runs acquire ordinary
native authority through current preflight after explicit activation.

Activation is the final lock/revalidation transaction. It binds `schedule_draft` and a write-once
activation marker to the exact immutable conversion receipt. Compatibility adapters must project
the original instance alias and source keys, not native path-derived aliases or occurrence IDs.
History pages preserve every authorized actual reference beyond the execution cap. Required proof
includes the full populated PostgreSQL journal, interruption/resume, actual append/create/archive
and completion/provider races, purge, restricted role privacy, and activated runtime with every old
source table denied. Source FK/table retirement remains later work.

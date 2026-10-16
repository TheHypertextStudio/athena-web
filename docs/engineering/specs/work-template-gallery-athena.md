# Work-template gallery and Athena review

Delivery layer 4 of the [approved work-template overview](../../superpowers/specs/2026-09-14-work-templates-overview-design.md), following identity, blueprints and [Program schedules](work-template-schedules.md). D7, D8, D33–D37 and the full catalog in overview §7.7 govern this layer.

## Product contract

The gallery provides the complete curated catalog in the overview, with usable outlines, children and Program default schedules. A workspace installs independent copies it owns. People can also copy an authorized template into another workspace they belong to. Neither installation nor copying subscribes a workspace to future changes. Show origin and source version, and offer a separately reviewed copy/update when a newer gallery release exists.

All template authoring, gallery installation, cross-workspace copy, blueprint creation and schedules remain available on every plan, including personal workspaces. Only Athena drafting/editing, tailored onboarding proposals and automated label-group conversion require the existing `athena` product capability. Apply the live workspace authoring setting in addition to the commercial gate. Do not use generic shared-work billing guards to charge for manual template maintenance or infer automated authorship from a client name.

Athena proposes a template based on the onboarding conversation, authorized imported work, repeated work in Docket or connected source material already available to that session. The person reviews the outline and children in Inbox, keeps or adjusts it, or undoes it. No unattended proposal publishes a template, relabels work, deletes labels or replaces existing work. Existing personal/team draft privacy remains unchanged.

## Curated catalog

Store a versioned catalog as repository-owned structured data in the work domain. Each entry has a stable opaque catalog/template identity and immutable version identity, slug, category, name, kind, short use description, explicit fork tags (startup/nonprofit/agency/personal), canonical starting document, blueprint and Program defaults. Catalog origin is provenance, not a foreign-key dependency on another workspace. Separate the two Renewal entries by kind and slug; preserve their distinct intended uses. Include every row in overview §7.7, plus the Event template needed for the approved dinner journey. Validate every entry with the same canonical template contracts and expansion limits used by workspace publications.

For ticket-shaped entries, turn the overview's listed fields into clear Markdown headings with brief contextual prompts, not fake submitted answers. Optional labels such as Bug/Feature resolve explicitly in the destination; absence is a visible warning, never a foreign label ID. Named Design/Marketing defaults are destination offering suggestions for an administrator to confirm, not literal reusable team assignments.

For blueprint-shaped entries, each listed action is concrete child work with a relevant goal/checklist document. Children of Tasks are subtasks; children of Projects are Tasks/Milestones; Initiative children are linked Projects/Programs. Use the approved parent/creator rules and relative dates. Finalize offsets in catalog data for the actual journey: Event Book venue is 21 calendar days before its target; Vendor booking has Get quote, Confirm and Pay deposit; preparation for a partnership event includes the Ready to host Milestone; Quarterly report's finish step follows all three preparation siblings. Offset-free steps remain undated rather than receiving invented absolute deadlines. Other entries use meaningful dependencies and relative sequencing appropriate to the listed outline without adding properties, status sets or completion rules.

Program entries install actual default schedules referencing their copied child templates: Content calendar → Blog post/Newsletter issue; Client engagement → Monthly client report, plus Kickoff Project; Program delivery → Session or Cohort; Event series → Community event or Workshop. Define the additional Session/Kickoff outlines in catalog data when required by those references. Catalog references resolve by exact stable entry/version IDs before installation, not name matching. The Program creation acceptance from layer 3 proves their independently owned schedule copies.

The gallery page lives in the dedicated Work templates workspace at `/orgs/[orgId]/work-templates/gallery` and supports category/kind/fork/search filtering, a detail preview of the root/outline/child tree/default schedules, and a reviewed Add to workspace action. The action states that the selected reusable definitions become workspace-visible published copies. It previews all transitively required definitions, label/image omissions, and offering suggestions before confirmation. A person may instead save a private draft bundle and review/publish its dependencies in the existing editor. Both operations use the same installation planner and canonical writer; publication is explicit.

## Transitive installation and cross-workspace copy

Add a bounded domain copy planner, not another DAO. Input is an authorized exact source template/version closure or a checked catalog closure, requested root selections, destination workspace and explicit offering choices. Output maps each distinct source identity/version to one destination identity, rewrites every blueprint and Program-default schedule reference to the corresponding copied identity/version, and lists dropped destination-specific references. Preserve explicit pins; latest references are resolved once in the source snapshot and pinned to the installed independent copies for that installation. Further destination edits may explicitly switch to latest destination versions.

Authorize source visibility before reading bodies or dependency metadata, and recheck the source fingerprint and destination authoring/offerings on acceptance. Copies must not widen private/team source access before the person explicitly confirms destination publication. Clear source ownership, team offerings, people, cycles, provider bindings, absolute dates, work IDs and execution receipts. Preserve work-only documents, reusable rules, nested structure, selected optional defaults and independently copied schedules. Resolve labels by an explicit selected destination mapping; otherwise drop them with a warning. Strip image references that the destination cannot lawfully retain and warn; do not download private assets or transfer credentials/sessions.

Bound installation to 100 distinct definitions, 500 expanded work nodes per root and 2,000 dependency edges; reject cycles, oversized closures and duplicated conflicting versions before writes. Mint destination identities in one transaction, validate and publish dependencies in topological order through the existing canonical creation/publication seam, then publish roots. One failed dependency rolls back the bundle. Record source-origin/version pairs for every copy and one aggregate undo receipt. Idempotent request IDs return the original bundle without duplicating templates; retries cannot erase later destination edits.

Undo uses the existing catalog/change-set engine. It removes or archives only the created copies that still match that receipt; templates used by work/schedules or independently edited since installation remain recoverable and are reported as retained/conflicted. Never undo by deleting the generated work or changing the source workspace. Templates used by later work archive rather than disappear. Manual copy and gallery installation share the exact planner, authoring validation, projection and undo path.

The aggregate edge budget counts explicit nested-template and default-schedule references plus
authored work-dependency and timing links once per distinct copied source identity/version.
Containment alone does not consume this dependency budget. The existing blueprint engine separately
validates each root's complete expansion and prerequisites against the 500-item boundary.
Different legitimate historical pins of one source identity become independent destination copies;
contradictory content for the same exact source identity/version is rejected.

## Honest source identities and private copy bundles

Copy sources are discriminated facts: an actual published tenant/template/version; an authorized
unpublished tenant/template/draft revision and fingerprint; or a catalog identity in its immutable
release namespace. Draft revision zero is valid. A draft or catalog entry is never represented as a
fabricated database publication, workspace or blueprint projection. Fingerprint the complete
normalized definition and reviewed copy decisions. Explicit copying of an authorized archived
publication is allowed; an archived source never resolves implicit latest selection.

Factor validation-only prospective blueprint facts from the existing structural engine. They carry
logical keys and honest source identities, without physical version/step IDs. Keep executable
publication resolution, ordinary creation, origin and retained-run inputs restricted to actual
immutable publications. A prospective preview cannot grant execution authority.

Persist one copy bundle and its entries as metadata around the canonical template writer. Each entry
retains its immutable destination template ID, globally unique reserved first-publication ID, exact
source origin, dependency order, original after-state fingerprint and pending/consumed/void state.
Private copies create real canonical draft rows and zero publication/projection rows. The first
explicitly reviewed publication consumes its reserved ID through ordinary appendPublication; later
versions use normal generated IDs. Reservations bind identity, allowing lawful private edits before
first publication. They do not grant source access or automatically publish dependencies.

Use a nullable live destination reference beside the immutable destination ID. Its same-tenant FK is
NO ACTION, DEFERRABLE INITIALLY DEFERRED; installed pending/consumed entries must have a lawful live
destination at commit. Undo voids an unpublished reservation and clears this reference while deleting
its unchanged unused draft in the same transaction. Keep the entry tombstone and unique reserved ID
forever within the workspace, so retries cannot resurrect or reuse it. Consumed entries retain the
same-tenant exact version/template reference and archive published destinations instead of deleting
versions. Account deletion must not cascade reservations required by surviving team copies; retain
an immutable audit actor key with a nullable live actor reference. Workspace purge removes the bundle.

The canonical writer accepts only an opaque server capability bound to its exact transaction, bundle,
entry, tenant, accepting principal and persisted identity reservation. Public JSON cannot choose an
identity or version. A storage guard rejects alternate first IDs, reservation stealing, void-ID
publication, foreign tenants and inconsistent consumption, while preserving existing immutable
version, closure and projection checks. Ordinary later team publication may read minimal checked
reservation facts without learning the acceptor's private review metadata.

Resolve source and destination actors independently from the verified principal's user identity and
active tenant membership. Caller-supplied actor IDs and capabilities are not proof. Bundle provenance
and review metadata remain acceptor-private after destination publication. Redact cross-workspace
origin IDs unless the current reader can see that source. Existing application scope checks must not
be claimed as database RLS protection; add actual restricted projections/policies before granting
restricted roles access to private bodies or receipt snapshots.

The existing central undo entry points dispatch bundles through their persisted receipt binding.
Derive parent-before-dependency reversal from trusted entry metadata, not query order or a client flag.
Check current reference existence immediately before each tentative removal. A retained parent's
current references protect its dependencies; removed historical edges do not. Deliberately compare offerings and reservation state as well as template
fields. Protect active plans of every work kind, private blueprint/default-schedule references, live
composer selections and retained bundle dependencies. Return only a safe in-use result for hidden
references, without counts or identities. Reference writers update the pending copy entry's private
concurrency epoch before locking/revalidating destination rows. Undo locks the complete same sorted
entry set before targets, making a committed READ COMMITTED reference invalidate a stale SERIALIZABLE
snapshot. The epoch is excluded from authored fingerprints and public projections. Prove the actual
snapshot-before-writer race and bounded retry; row locks alone do not establish this guarantee.

A narrowly privileged reference-integrity boundary may return existence only after checking current
principal authority. It requires a fixed safe search path, qualified objects, revoked public execution,
a non-login owner with minimal privileges, same-tenant scans and generic unauthorized/not-found
failures. Current-reference checks run after parent removals without any exclusion list or SQL access
to receipt bodies. A separate server-only exact receipt-binding discriminator prevents generic Undo
fallback even for callerless internal calls; it grants no read or mutation authority. Resolve current
human acceptor/View for terminal replay and current authoring for installed mutation. Preserve current canonical creation/publication/image effects and the existing change-set
engine; no second template writer, notification store or general undo system is introduced.

Before API/UI integration, prove real restricted-role PostgreSQL acceptance for deferred FK failures,
private bundles with zero publications, first-ID theft/void rejection, consumption after independent
edits, normal version two, teammate metadata privacy, source-principal isolation, rollback, concurrent
idempotence, terminal retries, account/workspace purge, hidden reference races and every generic undo
entry point. Each accepted install rechecks source fingerprints and current destination authoring and
offering policy in its transaction. Reinstall after undo requires a new request ID.

## Athena authority and drafts

Use actual persisted execution identity. User-owned Athena sessions already execute through a verified user principal and retain server-owned Athena provenance; registered agents execute as their own org-scoped agent principal. Do not invent a human actor, use an item's creator as authority, or trust a caller-supplied agent/client label. A trusted session/executor proof is registered inside the server and revalidated against the tenant, active membership, product capability and current template-authoring policy on execution.

For a user-owned Athena session, draft authoring uses the actual verified owner principal and the existing personal draft writer; the notification belongs to that same persisted user. Athena may produce a proposed canonical definition without writing it first when the existing approval policy requires review. Keep/adjust executes the reviewed exact stored definition through the existing canonical writer, records agent/session provenance and retains a single reversible receipt. An autonomous draft write remains unpublished and appears in Inbox with the same keep/adjust/undo controls. It cannot publish by taking the legacy immediate-publish tool path.

A registered agent's personal draft remains readable only by that agent. A proposal intended for human review instead stores a restricted proposed definition attached to the existing action/proposal record and a validated recipient. The recipient must be an active same-workspace human author selected under actual assignment/review authority, with their user linkage read from storage. Keep materializes a new reviewer-owned private draft under that human's real authorization and preserves the actual proposing agent in provenance. This does not grant the recipient general access to the agent's other private templates. Missing or revoked review authority fails closed; never select an arbitrary workspace member.

Extend MCP template discovery/authoring and Athena's existing toolbox with structured canonical definitions, blueprint/default-schedule summaries, catalog proposal references and review metadata. Existing human REST/MCP behavior remains available through adapters. Automated new/edit operations produce unpublished drafts or reviewable stored proposals; publish remains a person's explicit action. Editing an existing publication creates a separate draft/revision and cannot mutate a published body or existing work.

## Inbox review, onboarding and labels

Reuse the notification inbox, proposal/action state machine and change-set engine. Add a typed template-review payload with proposal/session/target identifiers, safe summary and allowed actions. The notification body contains no private template document. Opening a review loads its authorized detail through the typed query layer. Do not call the current generic notification act endpoint and merely mark it read: keep, adjust, dismiss and undo must execute the corresponding checked state transition, then settle the notification.

The review shows the use case, work kind, outline, child/date/default-schedule summary, destination visibility and specific omissions. Keep retains the private draft or materializes the accepted stored proposal; Adjust opens the canonical sample-item editor with that exact draft; Publish is explicit there. Undo reverses only that action through its aggregate receipt with normal conflict detection. Mark read is independent of approval and must not silently keep a proposal. Repeated actions are idempotent; stale revisions refresh the preview while preserving authored edits. Failed actions keep an actionable notification and application-owned recovery copy.

Onboarding exposes the approved startup/nonprofit/agency/personal fork and a previewable starter selection. A person's explicit starter installation uses the ordinary gallery planner and does not require Athena. With Pro and current authoring rights, Athena may tailor a proposed set using the actual saved conversation and authorized import context. The proposal retains a stable source/fork fingerprint to avoid duplicate suggestions after restart/import retries. An empty account or unavailable connector must still offer the curated defaults; do not fabricate evidence that the workspace used a template before.

Label-group conversion begins with a read-only proposal over authorized label-group/work usage. Show the proposed template identities and exact affected work, with a bounded selection preview and warning that labels remain until explicitly confirmed. Keeping a draft does not change labels or work. A separate Confirm conversion action assigns the selected published templates using the same selective identity-change/preview service and removes only explicitly selected stand-in labels after permission checks on every affected row. Declining or undoing preserves/restores labels and work; other labels, descriptions, children and manual dates stay intact. Limit a confirmation batch to 100 work rows; retain the ordinary 500-new-row blueprint cap and require separate reviewed batches for larger groups.

## Storage, migration and delivery plan

Use append-only migrations for catalog-origin/review/idempotency records only where current canonical template, proposal/action and notification records cannot express the required state. Never create another template definition/version table or general notification system. Keep restricted proposal payloads tenant/recipient scoped with RLS and explicit purge/export behavior. Existing templates and notifications need no automatic publishing or destructive backfill.

1. Finalize every catalog entry and pure closure/remapping/title/offset/default-schedule validation. Add a completeness test against the approved catalog inventory and real expansion tests rather than source-text policy tests.
2. Add source-authorized copy previews, same-transaction installation, provenance, idempotency and aggregate undo through the existing template services. Validate cross-workspace private/team reads and destination assignment omissions.
3. Add gallery list/detail/install/copy routes, MCP discovery/installation adapters and the Settings UI using the typed query layer and shared primitives. Pro gating must not affect manual installation.
4. Add trusted Athena authoring provenance, unpublished draft/proposal behavior, paid capability enforcement and existing Inbox review transitions. Test both user-owned Athena and registered-agent review privacy.
5. Add explicit starter selection, Pro-tailored onboarding suggestions and confirmed label-group conversion. Use retained conversation/import facts, not a second connector/data path.
6. Verify the nonprofit Event proposal in the populated Inbox: review, adjust, keep, publish, create Event preparation work, undo only the proposal/install action, and preserve existing work and labels. Run both themes, keyboard and all standard responsive widths, then required source checks/builds.

## Acceptance

- Every catalog entry has a complete usable outline, validated graph, fork/category metadata and independent origin/version provenance. Program entries create independent schedules through layer 3.
- Transitive copy rewrites nested and default-schedule references without foreign IDs, cycles, duplicate definitions or source visibility leaks. Failure rolls back the whole bundle; retry and undo preserve later edits and work.
- Personal and team-private drafts remain private. Human authoring/copy/gallery works without Pro; actual Athena draft/edit/proposal paths require Pro and current authoring policy.
- A nonprofit workspace receives an Event proposal through real persisted Athena/session context, reviews it in Inbox, keeps/adjusts/undoes it, and retains its existing work.
- Existing template publication stays immutable. No automated legacy-tool path publishes without explicit human action; no forged, foreign or revoked recipient/session proof is accepted.
- Onboarding selections install the intended fork independently of AI. Tailored proposals use authorized facts and dedupe after retries. Label conversion changes nothing before explicit confirmation and restores exact labels/identities on lawful undo.
- Tenant/RLS, API/MCP, source policy, affected types/lint/complexity/builds and authenticated responsive journeys pass. Provider/model execution evidence is distinguished from deterministic local fixture coverage.

## Guided organization flow

Follow the [gallery organization flow](../../design/work-template-gallery-flow.md) for outcome-first
discovery, exact full-fork selection, nested work review and durable draft-bundle reentry. A selected
curated subset is explicit; it never silently replaces the approved full fork. All acceptance and
publication controls use the checked canonical copy services described above.

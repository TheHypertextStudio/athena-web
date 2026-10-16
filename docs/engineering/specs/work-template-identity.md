# Work-template identity and published versions

This is delivery layer 1 of the [approved overview](../../superpowers/specs/2026-09-14-work-templates-overview-design.md).
It gives every Initiative, Program, Project, and Task a stable template and an immutable published
version. Blueprints, Program schedules, and gallery/Athena proposals follow in their own layers.

## Invariants

- Each work item references one published version of a template of the same kind and workspace.
- Each workspace has four non-archivable base templates. Their outlines are editable; vocabulary
  settings continue to own kind names.
- Publishing appends a version. It never rewrites a published payload or an existing work body.
- Published templates are workspace-visible. Team narrowing controls where they are offered,
  never access to existing items. Work visibility still follows ordinary resource authorization.
- Personal starting drafts remain author-only and unpublished. Existing team starting drafts
  remain team-visible and unpublished until someone explicitly publishes them.
- Draft editing, publishing, and archive operations use current contribution rights
  and the workspace's authoring policy. Choosing a published template for work uses the work item's
  normal contribution rights; restricting authoring never makes template use admin-only. The default policy permits contributors; admins may
  restrict authoring to admins. A setting does not make a private draft readable.
- Imports, connectors, captures, and schedules that supply no identity receive the kind's base
  template. No new generator, alternate data-access layer, or fork of the creation model is added.

## Persistence

The existing physical `template` table becomes the canonical work-type definition. It keeps its
name during this migration so existing REST/MCP behavior and stored references remain compatible.
`workType` is an engineering alias for that same table, not a second entity. `TemplateId` and
`WorkTypeId` denote the same identity. `WorkTypeVersionId` is a new branded ULID.

The definition adds `is_base`, publication state, icon, draft revision, a draft definition, and a
latest-published-version pointer. A draft definition contains name, description, icon, and the
existing discriminated `TemplateDraft`, plus an optional default status key. The existing name/description/payload columns are the
legacy projection: the last published definition for a published template, or the current private/
team draft for an unpublished template. Editing a published draft does not change that projection.
The kind is immutable. Team narrowing lives in `work_type_team`, with workspace-consistent team
references. Base templates cannot be narrowed or archived.

`work_type_version` stores workspace, template, monotonically increasing version number, published
definition, publishing actor, and publication time. A unique `(template, number)` key and a row
lock on the definition serialize publishing. Compare-and-swap draft revisions reject stale edits
and publishing. Database constraints bind the version to its definition's workspace; an update
guard makes published snapshots immutable. Deletes are allowed only as part of authorized workspace
purging, not through the version API.

All four work tables add `work_type_id`, `work_type_version_id`, assignment time, and assignment
source. Composite foreign keys prevent cross-workspace and mismatched definition/version pairs.
A database assignment guard verifies kind and publication state. For omitted identities it looks
up the workspace's base and current published version. This covers all existing insert paths,
including connectors and background jobs. An explicit template with no version resolves to its
current publication. An explicit version without its matching template is rejected. Changing an
identity to an archived template is rejected; ordinary edits to existing archived-template work
remain valid.

The final columns are non-null. Their database default is `NULL`, consumed by the before-insert
guard, so older insert callers may omit them while selected rows always have complete references.
The guard never generates IDs. Workspace provisioning uses the existing `genId` implementation to
seed definitions and versions transactionally with statuses. The existing bootstrap export remains
compatible and delegates to this complete set of required work defaults.

The Task-only legacy `templateId` remains starting-draft provenance. It is not an immutable-version
reference and is not substituted for one. Existing work bodies and children are never regenerated
by this layer.

## Migration ordering and interruption recovery

Use an expand → batched data migration → enforce sequence through the existing migration runner.
The SQL journal remains authoritative; the runner uses the normal Drizzle migrator for SQL, with
an explicit checkpoint between the expansion and enforcement migrations. A temporary prefix of
the original journal and unchanged SQL files allows the standard migrator to stop at expansion.
It changes neither migration hashes nor the final journal. After backfill, the runner applies the
remaining journal normally and removes its temporary directory.

1. **Expand.** Add definitions' publication metadata, version/team tables, nullable work references,
   and tenant constraints. A temporary `legacy_pending` state distinguishes pre-migration records
   from intentionally unpublished new definitions. Do not install a guard that requires bases
   before they exist.
2. **Provision bases.** Process workspace IDs in bounded batches. Seed four blank published bases
   with application-generated ULIDs. Uniqueness and transactional retries make reruns idempotent.
3. **Convert definitions.** Lock bounded batches of pending templates. Personal and team templates
   become unpublished drafts with their original owner/team visibility. Workspace templates become
   published baseline versions. Preserve archived state, payloads, audit fields, and image subjects.
   Seeded templates follow their actual visibility; being seeded never makes a private body public.
4. **Backfill work.** Process each work table in bounded transactions, selecting rows whose
   references are still incomplete. Unidentified work receives its base. A Task with a valid legacy
   pointer to a published workspace Task template receives that definition's migration baseline.
   Private/team starting-draft pointers retain the base identity until publication. Mark every
   backfilled association `migration_baseline`: it records the upgrade's known state and does not
   claim to reconstruct the template at the item's original creation time.
5. **Recheck.** Repeat missing-workspace, pending-definition, and incomplete-work scans until empty.
   A crash resumes from incomplete rows, not from a cursor that could miss an older ULID. Already
   created versions and completed item associations remain unchanged.
6. **Enforce.** Lock the affected tables, install assignment guards, validate all references, and
   set both work references non-null. Remove the temporary publication state/default. If a
   concurrent legacy writer left another incomplete row, enforcement fails closed; rerun backfill
   before retrying. SQL failure never marks the checkpoint complete.

Template-definition writes must be quiesced while baseline versions are converted. Enforcement
checks that legacy projections still match those baselines and refuses a concurrent definition
edit rather than publishing a stale outline. Work creation may continue between batches and is
re-scanned without a creation-ID cursor.

The API release must run this entire sequence before serving the new contracts. During expansion,
old REST/MCP callers continue to use existing columns. After enforcement, omitted insert fields
receive bases through the guard. New workspace provisioning must be released with enforcement;
old server binaries are not a supported steady state after that checkpoint. Client compatibility
does not depend on a simultaneous mobile/desktop client upgrade.

Test fresh and populated migration ordering on real PostgreSQL, including a database paused at
expansion, an interrupted batch, repeated migration invocation, newly created work during backfill,
and enforcement refusal with incomplete references. The PGlite schema snapshot remains useful for
ordinary API tests, but its empty-database SQL replay is not backfill acceptance.

## Services, contracts, and compatibility

`domains/work` owns definition, version, identity-reference, authoring-policy, publish, and archive
contracts. The identity-reference module imports only IDs, keeping existing Task/Template contract
dependencies acyclic. The starting-draft union remains the existing contract; status defaults use
the destination status set and its normal fallback. No per-template status sets or properties are
introduced. Estimate defaults stay outside this identity layer; existing composer estimates remain
manual, and the blueprint layer specifies per-step effort. Base names and icons are derived from
current workspace vocabulary/display settings when projected (Blank campaign under a Campaign
skin), while stored version snapshots remain unchanged.

One API persistence service owns definitions, draft revisions, publishing, visibility, and archive.
Legacy `/templates` routes and MCP tools call its compatibility adapters. Canonical definition and
version subroutes extend that surface with typed request/output validation; they do not introduce
another repository or component-level fetch path.

- Legacy private/team reads and writes retain their existing permissions and draft behavior.
- Legacy workspace writes publish a new version transactionally, preserving their immediate shared
  starting-draft behavior. Explicitly sharing a private/team draft to the workspace is publication.
- Canonical draft editing never publishes implicitly. Publication requires its explicit operation.
- Existing personal/team starting drafts remain usable by legacy clients. Applying one fills the
  work body while retaining the base identity; publication is the step that makes it a work type.
- Current work responses include their identity, version, and a bounded display projection. The
  legacy read contract tolerates omitted fields in retained cached records; current server outputs
  are validated as complete. Caches refetch instead of inventing identity or discarding user drafts.
- New create contracts accept a template and optional published version. The existing creation
  path validates tenant, kind, publication, and team offering before applying its starting draft.
  Explicitly supplied work values override defaults; a missing status key uses the destination's
  ordinary default. The database guard enforces identity for indirect creators too.

Never resolve draft names or bodies before their visibility check. Published versions and team
narrowing use tenant keys throughout. New tables receive tenant policies for restricted database
roles as well as composite constraints; application access still uses the established live resource
authorization. Tests distinguish those two boundaries rather than assuming a database-owner
connection exercises row policies.

## Product surfaces

The composer shows the chosen template in its top row; its menu is headed **Start from…**. A base
is always available. Applying another published template updates identity and starting defaults
without destroying entered content; dirty replacement requires the existing discard/keep choice.
Unpublished legacy starting drafts remain explicitly identified as drafts and do not claim a
published identity. Failed creates retain both the selected version and the entered content.

Rows and headers show template icon/name using shared display primitives. Ordinary base work keeps
a compact presentation; non-base identity remains discoverable and filterable. Work-list contracts,
server validation, saved views, and the existing query layer add template filters and grouping
together. The field is `workTypeId`, labeled Template, declared on all four work-view contracts as
filterable/groupable and read-only for drag grouping; changing identity requires its preview.
Each work table gets an `(organization_id, work_type_id)` index. Existing search projectors add a
`workTypeId` facet to work documents, and search filters apply it through the existing candidate
query and index. Definitions themselves remain outside general work search. A typed projector
backfill refreshes existing work documents without copying private draft bodies into the index.
Group/filter choices include archived templates already used by visible work. Individual template definitions
do not add sidebar rows. A person may pin an ordinary filtered view.

The dedicated **Work templates** workspace groups definitions by readiness and work kind, with clear
draft/publication/archive state. Authoring permissions alone remain in Settings.
Editing uses a full-page sample item and the normal document layout; the current guided creation
flow remains a useful way to start a draft. Publishing has an explicit revision-aware action.
Administrators manage contributor authoring policy in Settings → Template permissions; team
offerings remain in definition authoring. Command-palette search
for template/type/blueprint finds the Work templates workspace; published definitions supply **New {template}** actions
and Program add choices.

Work headers offer **Change template**. In this layer its preview explains identity and optional
starting-draft changes; existing children remain. Only explicitly selected content changes apply.
Completed/canceled work is never automatically updated by a newer publication. Later layers extend
the same preview contract with blueprint differences rather than adding another mutation path.

MCP discovery returns published kind-matched templates with versions and starting-draft summaries.
Creation accepts identity/version on all four kinds through the existing write/placement service.
Existing template discovery/definition remains a compatibility adapter. No schedule, work creation,
or publishing is implied by a discovery request.

## Acceptance and implementation sequence

1. Add contract tests for four-kind references, kind/draft mismatch, publish revisions, policy, and
   the personal/team privacy decisions before implementation.
2. Add expand/enforce schema migrations, base provisioning, the batched checkpoint, and real
   PostgreSQL retained-data/interruption tests. Prove indirect creators receive bases.
3. Implement the shared persistence/authorization service and REST/MCP adapters. Verify stale
   publication, immutable versions, tenant isolation, private/team visibility, archive behavior,
   and image-reference preservation.
4. Extend all work outputs, create inputs, list filters/grouping, saved views, and query definitions
   together. Exercise import, capture, connector, repeating-work, and ordinary creation paths.
5. Deliver composer selection, row/header identity, full-page settings editor, authoring policy,
   Change template, command actions, and MCP discovery/creation through existing primitives.
6. Create an Event Project from a published template, reopen it with the same identity/version,
   publish a later version without changing it, and group a populated Project list by template.
   Repeat the permission/failure journeys and authenticated responsive capture matrix in both
   themes. Run affected tests, types, lint, complexity, and builds; obtain independent review before
   linear integration.

The milestone is complete only when the full identity journey is usable and migrated data satisfies
the enforced invariants. Blueprint expansion and later roadmap interfaces remain separate work.

## References

The [Drizzle policy documentation](https://orm.drizzle.team/docs/rls) describes policy declarations
and default-deny behavior. Schema syntax follows the installed dependency version; retained-data
and restricted-role tests exercise PostgreSQL directly.

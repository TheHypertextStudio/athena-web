# Workspace-Wide Search Design

## Objective

Build a workspace-wide search foundation for Athena/Docket that can find every visible object,
piece of context, and activity entry without flattening their semantics into anonymous text hits.
Search must work from the command palette for fast jumping and from a richer search page for
faceted exploration. The first implementation is Postgres-owned and event-log-aware, with a clean
future seam for an external or vector-backed index.

## Product Contract

Search is the user's "find anything I can act on" layer.

The existing command palette remains the fast entry point. `Cmd/Ctrl+K` should show top hits across
the Hub or the active workspace, with result rows that keep their type, org chip, snippet, and route.
A task result shows task context; a project result shows project context; a comment result shows the
comment and its parent object; an activity result shows source, actor, verb, entity, and time.

A dedicated `/search` surface uses the same API for deeper exploration. It adds filters, facets,
saved result URLs, and larger cursor-paginated result sets. Palette is for jumping. The page is for
investigating.

V1 result coverage:

- Work objects: `task`, `project`, `program`, `initiative`, `milestone`, `cycle`, `label`,
  `saved_view`.
- People and agents: `organization`, `team`, `member`, `agent`, `agent_session`.
- Content and context: `comment`, `update`, `attachment`, `calendar_event`.
- Activity: canonical `event` rows as `activity` results.

Activity is first-class, but distinct. A search for "budget" may return a project, a task, a comment
under the project, an attached worksheet, and a Slack/Docket activity event that mentioned budget.
Those are different result kinds with different routes and actions.

## Information Architecture

Every result is organized around three questions:

1. What is it?
2. Where does it live?
3. Why did it match?

Each result has a narrow `kind` and a broader `family`.

| Family     | Kinds                                                                                   | Primary use                                               |
| ---------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `work`     | `task`, `project`, `program`, `initiative`, `milestone`, `cycle`, `label`, `saved_view` | Open, edit, filter, assign, inspect progress              |
| `people`   | `organization`, `team`, `member`, `agent`, `agent_session`                              | Find owners, actors, workspaces, automation sessions      |
| `content`  | `comment`, `update`, `attachment`, `calendar_event`                                     | Jump to context inside or beside work                     |
| `activity` | `activity`                                                                              | Understand what happened, from Docket or an external tool |

Content results carry a `subject` pointer. A comment on a task is still a `comment` result, but its
route opens the task with the comment highlighted. An attachment on a task routes to the task's
attachment panel or downloads through the existing authenticated binary route. A calendar event is
user-scoped and routes to the agenda/event context, not to an org unless it has been materialized as
work.

Activity results carry both the `event` identity and its canonical `entity` reference. If an event
maps to a Docket object, the result can route to the object. If it is external-only, it routes to the
stream position or external URL.

## Data Model

Add a search schema island to `@docket/db`, exported from `packages/db/src/schema/index.ts`.

### `search_document`

`search_document` is the durable read model. It is not source of truth.

Core columns:

- `id text primary key`: stable document id, derived as `<kind>:<scope>:<entityId>` so upserts are
  idempotent.
- `organization_id text null`: tenant scope for org-owned documents.
- `user_id text null`: user-private scope for calendar/account-scoped documents.
- `kind search_document_kind not null`: narrow semantic kind.
- `family search_document_family not null`: broad IA family.
- `source_table text not null`: source table or source stream, such as `task`, `comment`, `event`.
- `entity_id text not null`: source row id.
- `subject_kind text null`: containing or primary object kind for content/activity.
- `subject_id text null`: containing or primary object id.
- `source_system source_system null`: attribution for activity/integration-backed content.
- `external_url text null`: external destination when the source owns the canonical URL.
- `title text not null`: primary display label.
- `summary text null`: compact subtitle/snippet seed.
- `body text null`: longer searchable text.
- `facet jsonb not null default '{}'`: structured filters and context.
- `route jsonb not null`: semantic route target consumed by the web app.
- `visibility jsonb not null`: query-time permission metadata.
- `base_rank integer not null default 0`: entity-family rank prior.
- `occurred_at timestamp null`: activity/calendar time.
- `source_updated_at timestamp null`: the source row's latest known update timestamp.
- `indexed_at timestamp not null default now()`: when the projection was written.
- `created_at timestamp not null default now()`.
- `updated_at timestamp not null default now()`.
- `archived_at timestamp null`: set when the source is archived or the document should no longer
  appear by default.

Suggested enums:

- `search_document_family`: `work`, `people`, `content`, `activity`.
- `search_document_kind`: `organization`, `team`, `member`, `agent`, `agent_session`, `task`,
  `project`, `program`, `initiative`, `milestone`, `cycle`, `label`, `saved_view`, `comment`,
  `update`, `attachment`, `calendar_event`, `activity`.

Suggested indexes:

- `(organization_id, family, base_rank desc, updated_at desc)`.
- `(organization_id, kind, base_rank desc, updated_at desc)`.
- `(user_id, family, updated_at desc)`.
- `(source_table, entity_id)` unique.
- `(subject_kind, subject_id)`.
- GIN on `facet`.
- Full-text index over weighted `title`, `summary`, and `body`.

The first migration should use core Postgres full text search. Trigram and vector search are follow-up
mirrors, not the initial foundation. PGlite migration compatibility must be verified before relying
on any extension-only feature.

### `search_index_job`

`search_index_job` is the durable indexing outbox. It prevents the search model from depending on
best-effort in-process hooks.

Core columns:

- `id text primary key`.
- `organization_id text null`.
- `user_id text null`.
- `source_table text not null`.
- `entity_id text not null`.
- `operation text not null`: `upsert` or `delete`.
- `reason text not null`: `entity_write`, `event_log`, `backfill`, `repair`, or `manual`.
- `source_event_id text null`: canonical `event.id` when the job came from the data log.
- `dedupe_key text not null`.
- `status text not null`: `pending`, `processing`, `succeeded`, `failed`.
- `attempts integer not null default 0`.
- `run_after timestamp not null default now()`.
- `locked_at timestamp null`.
- `last_error text null`.
- `created_at timestamp not null default now()`.
- `processed_at timestamp null`.

Indexes:

- unique partial index on `dedupe_key where status in ('pending','processing')`.
- `(status, run_after, created_at)`.
- `(source_table, entity_id)`.

The job processor can run from an API cron route and a local script. Jobs are idempotent: processing
the same source row twice produces the same `search_document` id and upserts it.

## Projection Registry

Create `apps/api/src/search/` as the service layer.

Key modules:

- `types.ts`: internal projection interfaces and `SearchRoute` / `SearchFacet` / `SearchVisibility`
  shapes.
- `registry.ts`: maps source table names to projector functions.
- `projectors/*.ts`: one small projector per entity family or source table.
- `enqueue.ts`: durable job enqueue helpers.
- `process-jobs.ts`: leases pending jobs and writes documents.
- `backfill.ts`: paged source scans that enqueue or directly upsert documents.
- `query.ts`: builds and executes permission-filtered search queries.
- `rank.ts`: deterministic ranking helpers.

Projector contract:

```ts
export interface SearchProjector {
  readonly sourceTable: string;
  project(input: SearchProjectionInput): Promise<SearchDocumentDraft | null>;
}
```

The registry is the only place that knows how to turn source rows into search documents. Routes and
domain services should enqueue jobs, not duplicate search document construction.

Projection rules:

- Entity objects produce one document per row.
- Comments, updates, and attachments produce content documents that inherit subject visibility.
- Calendar events produce user-scoped documents.
- Canonical `event` rows produce `activity` documents.
- Event rows that point at a Docket entity also enqueue a reindex job for that entity, because
  recent activity is a ranking signal and can change snippets/facets.
- Archiving a source row marks the document `archived_at`, rather than deleting immediately.
- Hard-deleting by org cascade removes docs through `organization_id` cascade where possible.

## Event Log Integration

The canonical `event` table is both searchable content and indexing signal.

1. Every canonical event becomes an `activity` search document.
2. The activity document stores `sourceSystem`, `kind`, `actor`, `entity`, `occurredAt`, and
   external URL facets.
3. If `event.entity.docketEntityId` or a Docket-source `event.externalId` maps to a source entity,
   the indexer enqueues a reproject for that object.
4. The job row stores `source_event_id` so indexing provenance is traceable back to the data log.
5. The indexer is allowed to lag the event log, but repair/backfill must be able to reconcile by
   scanning `event` rows newer than the last indexed event and by comparing `source_updated_at`.

Internal `emitEvent` remains best-effort for awareness and should not be the only indexing path for
domain objects. Domain mutations enqueue search jobs in the write transaction when feasible. The
event-log bridge supplies activity docs and secondary reindex signals.

## Permission Model

The search index never grants access. It finds candidates; query-time filtering enforces visibility.

Visibility metadata is stored in `search_document.visibility` with one of these modes:

- `user_private`: only `user_id = session.user.id`.
- `org_members`: active human actor membership in `organization_id`.
- `grantable`: a work object or content inheriting from a work object. Requires either public
  visibility for a non-guest member or an effective grant on the object/ancestor chain.
- `event`: canonical activity. If mapped to a Docket object, inherit that object's visibility. If
  external-only, use org stream membership and, for personal-only events, `event_recipient`.

The query service resolves the caller once:

- active org memberships and actor ids,
- role default visibility/guest status,
- org ids,
- explicit grants needed for private grantable docs,
- the user id for private docs and personal activity.

Content documents must not leak private subjects. A comment body on a private task is visible only
when the task is visible. An activity event about a private task is visible only when the task is
visible or the event was explicitly routed to the caller as a personal recipient.

## Query API

Keep `/v1/hub/search` as the command-palette-compatible cross-org endpoint, but upgrade its response
to a richer search DTO. Add an org-scoped endpoint for workspace-only pages:

- `GET /v1/hub/search`
- `GET /v1/orgs/:orgId/search`

Query parameters:

- `q`: required text query.
- `limit`: default 20, max 50 for palette; page surface may request up to 100.
- `cursor`: opaque keyset cursor.
- `families`: comma-separated filter.
- `kinds`: comma-separated filter.
- `sources`: comma-separated source systems.
- `orgIds`: optional narrowing for Hub search, intersected with caller membership.
- `from` / `to`: date range against `occurredAt` or source update time.
- `includeArchived`: default false.

Response shape:

```ts
{
  query: string;
  items: SearchResult[];
  facets: SearchFacetSummary[];
  nextCursor?: string;
}
```

`SearchResult`:

- `id`
- `organizationId`
- `userId`
- `kind`
- `family`
- `title`
- `summary`
- `snippet`
- `matchedFields`
- `route`
- `subject`
- `source`
- `facets`
- `actions`
- `score`

Palette can render the same shape by mapping `kind` to icon and `route` to navigation. The old
`HubSearchHit` shape can be removed during the implementation slice, because the app and API live in
one repo and the palette is the only known consumer.

## Ranking

Ranking is deterministic and explainable.

Score components:

- full-text rank with `title` weighted above `summary`, and `summary` above `body`;
- exact title match boost;
- prefix title match boost for short command-palette queries;
- entity prior via `base_rank` (`task`, `project`, and `comment` outrank low-signal objects);
- recency boost from `source_updated_at` or `occurred_at`;
- relationship boost when the caller is assignee, owner, participant, follower, or activity
  recipient;
- workspace boost for the active org when supplied by the client;
- diversity cap so one noisy family cannot crowd out all others in palette top hits.

The query service should return `matchedFields` and a text snippet so users understand why a result
appeared. Snippet generation can start simple: choose the first matching field in priority order and
highlight matching terms client-side.

## UX Surfaces

Command palette changes:

- Use the upgraded `/v1/hub/search`.
- Support all result kinds.
- Keep Hub/org scope toggle.
- Show `family` grouping only when it helps; top results should still feel fast.
- Use org chips for org-scoped docs and source badges for activity/external docs.
- Route through typed `route`, not a local `switch` on three entity types.

Search page:

- Add `/search` under the authenticated app group.
- Use the same query definition and key convention, for example `queryKeys.search(params)`.
- Provide filters for family, kind, workspace, source, owner/assignee, label, status/health, and
  date range.
- Do not create a marketing-style landing page. The first screen is the search input and results.

## Rollout Plan

Phase 1: foundation and parity.

- Add DB enums/tables/migration.
- Add DTOs in `packages/types/src/search.ts`.
- Add projection service with projectors for `task`, `project`, `program`, and `event`.
- Add durable job enqueue/processor and backfill script.
- Upgrade `/v1/hub/search`.
- Update command palette to consume typed route results.
- Preserve or improve current behavior for task/project/program title searches.

Phase 2: semantics expansion.

- Add projectors for initiative, milestone, cycle, team, member, agent, agent session, comment,
  update, attachment, label, saved view, organization, and calendar event.
- Add inherited visibility tests for comments/attachments/events.
- Add org-scoped `/v1/orgs/:orgId/search`.

Phase 3: search page.

- Add `/search` page with facets and cursor paging.
- Add SSR hydration if the page opens with query params.
- Add saved/shared result URLs.

Phase 4: quality and scale.

- Add trigram/prefix helpers if Postgres/PGlite compatibility is clean.
- Add external index mirror only after the internal read model is stable.
- Add semantic/vector retrieval as a second-stage reranker, not a replacement for permissions or
  typed results.

## Validation

Test-first implementation expectations:

- DB migration applies in PGlite from `0000` through the new migration.
- Projector unit tests prove each entity kind maps to the expected title, body, route, facets, and
  visibility.
- Job processor tests prove idempotent upsert, archive, retry, and dedupe behavior.
- API tests prove:
  - Hub search returns only caller-visible org/user documents.
  - Org search cannot cross tenants.
  - Comments/attachments inherit subject visibility.
  - Activity docs are first-class and keep source/event semantics.
  - Existing task/project/program title search behavior still works.
  - Cursor paging is stable.
- Web tests prove the palette renders task, content, and activity results and navigates via typed
  routes.
- Final gate: targeted tests first, then package typecheck/lint/test for touched packages, then the
  repo's broader validation as runtime allows.

## Risks And Controls

- **Stale index**: mitigated by durable jobs, idempotent backfill, and repair scans comparing
  `source_updated_at` to `indexed_at`.
- **Permission leakage**: mitigated by query-time visibility filtering and inherited subject
  visibility for content/activity.
- **Noisy activity results**: mitigated by family filters, recency/rank tuning, and result diversity
  caps in palette mode.
- **PGlite incompatibility with advanced FTS features**: mitigated by starting with core FTS and
  verifying migration compatibility before adding extension-dependent trigram search.
- **Projection drift**: mitigated by a single projection registry and projector tests rather than
  ad hoc route-specific serialization.

## Acceptance Criteria

The design is ready to implement when:

- The spec is committed.
- The implementation plan splits DB/DTOs, projection service, API, palette, search page, and
  expansion projectors into separately verifiable tasks.
- Each task starts with failing tests and has an explicit validation command.

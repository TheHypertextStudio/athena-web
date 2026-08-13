# Notion sync

> **Status**: Two modes, both running. **Linked databases** shipped (connector + two-way sync +
> Docket-wins conflict resolution + the incremental `last_edited_time` cursor, §4/§8.9).
> **Docket-designed databases** provision, project, pull Notion edits back onto Task/Project
> (including `task.state`, via `setTaskState`), and adopt Notion-created rows as new tasks/projects
> — all under the shared sync lease, driven by webhooks with polling as the safety net.
> **Owner surface**: `packages/integrations/src/notion*.ts`, `apps/api/src/routes/notion-mirror*.ts`,
> `apps/api/src/routes/sync-notion.ts`
> **Related**: [`integration-sync.md`](./integration-sync.md) (the shared sync spine),
> [`../../migration/sunsama-to-docket.md`](../../migration/sunsama-to-docket.md)

## 0. Two modes, one connection

Docket relates to a Notion workspace in two independent ways, on one integration row:

|                     | **Linked databases** (§1–§7)                                          | **Docket-designed databases** (§8)                                                |
| ------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Who owns the schema | Notion. Docket derives a mapping from whatever the database declares. | Docket. The user shapes it in a table designer.                                   |
| Direction           | Notion → Docket, with task edits pushed back                          | Docket → Notion, with edits read back on two entities                             |
| Scope               | Tasks                                                                 | Tasks, projects, initiatives, programs, teams, cycles, milestones, labels, people |
| Answers             | "I already keep my work in Notion."                                   | "I want my Docket work visible and editable in Notion."                           |

Neither disturbs the other. A workspace can run one, the other, or both — and a task already
linked from an existing database is **excluded** from the designed Tasks database, so the same
work never appears twice in one Notion workspace.

---

Docket syncs Notion databases with Docket's own tasks, in both directions, **with Docket as the
source of truth on conflict**. It does not, and per §3a cannot, sync Notion's built-in personal "My
Tasks" home view as a distinct thing — see §3a for why, and what to sync instead to get the same
data.

That last clause is the whole point, and it is not a default that fell out of the existing
machinery. Before this connector, every Docket connector resolved a two-sided edit by _last write
wins_: a later edit in the external tool silently overwrote local work, and the losing value was
kept nowhere. A sync built to let Docket **supersede** the incumbent tool cannot behave that way —
if the external tool can still overwrite you, you have not replaced it, you have added a second
place your work can be changed from behind your back.

---

## 1. Why Notion is a connector, not a migration

Docket models two relationships with an external tool:

- **migration** — a one-time replace: import the work, then stop talking to the tool.
- **connector** — an ongoing relationship: keep both sides current.

Notion is registered as a `connector` (`packages/types/src/provider-catalog.ts`), because the
requirement is ongoing two-way sync, and only the connector pattern carries the `syncMode` /
`writeBack` semantics that drive it. **That Docket holds the source of truth is a property of the
conflict policy, not of the pattern** — see §5.

The sequencing this enables is the "embrace, extend, extinguish" arc:

| Phase          | What is true                    | What Docket does                                                                                                                                                                |
| -------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Embrace**    | The team still works in Notion. | Pull every row, continuously, into Docket tasks with a stored Notion page id.                                                                                                   |
| **Extend**     | Work exists in both.            | Cycles, portfolio, Athena and scheduling operate on imported rows with the same affordances as native ones — imported tasks are ordinary Docket tasks with provenance.          |
| **Extinguish** | Docket is where work happens.   | Every Docket edit is pushed to Notion, and a contested edit resolves in Docket's favour. Notion stays current until the day it is switched off, and nothing is lost when it is. |

Disconnecting the integration does not touch the migrated tasks: `task.source_integration_id` is
`ON DELETE SET NULL`, so a disconnected workspace keeps every previously synced row, fully editable.

---

## 2. Notion's data model, as the adapter meets it

Notion API version **`2026-03-11`** (`NOTION_API_VERSION`), current as verified against Notion's
own versioning reference and changelog (2026-08-09). Data sources — a **database** owning one or
more **data sources**, with rows, schemas and page parents all data-source scoped — were introduced
in the `2025-09-03` release and are unaffected by the bump to `2026-03-11`, whose three breaking
changes (block position, `archived` → `in_trash`, a block-type rename) are otherwise unrelated to
data sources. The `in_trash` rename is the one that touches this adapter — see §4. So:

- `ResourceRef.id` (what Docket calls a "list", what the UI calls a database) is a **data source
  id**.
- It is stored per task as `task.external_list_id`, so a write-back always addresses the collection
  the row actually lives in.

Endpoints used, all with the mandatory `Notion-Version` header:

| Purpose                      | Call                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Identity + workspace binding | `GET /v1/users/me`                                                           |
| Enumerate databases to sync  | `POST /v1/search` `{ filter: { property: 'object', value: 'data_source' } }` |
| Read a database's schema     | `GET /v1/data_sources/{id}`                                                  |
| Read rows                    | `POST /v1/data_sources/{id}/query` (twice — see §4)                          |
| Update a page                | `PATCH /v1/pages/{id}`                                                       |
| Create a page                | `POST /v1/pages` with `parent: { type: 'data_source_id', data_source_id }`   |
| Delete a page                | `PATCH /v1/pages/{id}` `{ in_trash: true }`                                  |

Notion exposes **no entity tag**, so the two-way anchor is `last_edited_time` alone and
`task.external_etag` stays null for Notion rows. The adapter does not invent one.

---

## 3. The field mapping is derived, not hard-coded

Notion has no fixed task schema — every database declares its own property names and types. So the
mapping is derived from each data source's own schema at sync time (`readNotionSchema`), and every
other mapping function is a pure function of the derived `NotionSchema`.

Roles are resolved **by property type, with a name preference**, so a workspace that calls its date
property "Due" gets the same treatment as one that calls it "Due date".

### Property → Docket

| Notion property type                  | Chosen by                                                     | Docket destination                                                                                              |
| ------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `title` (exactly one per data source) | structural                                                    | `task.title` — a blank Notion title becomes `Untitled`, because `task.title` is NOT NULL with a not-blank CHECK |
| `status`                              | structural (preferred over checkbox)                          | completion, via the **groups** — see below                                                                      |
| `checkbox`                            | only when there is no `status` property                       | completion                                                                                                      |
| `date`                                | name preference: `due date`, `due`, `deadline`, `due on`      | `task.due_date`                                                                                                 |
| `rich_text`                           | name preference: `description`, `notes`, `details`, `summary` | `task.description`                                                                                              |
| `select`                              | name preference: `priority`, `urgency`                        | read and reported (Docket's priority enum is not Notion's option set, so it is not written blindly)             |
| `people`                              | name preference: `assignee`, `assigned to`, `owner`, `person` | read as Notion user ids for external-actor resolution                                                           |
| `last_edited_time`                    | structural (the page field, not the property)                 | `task.external_updated_at` — the sync anchor                                                                    |

### Completion reads Notion's status **groups**, not option names

Notion's status property groups its options into `to_do` / `in_progress` / `complete`. The option
_names_ are workspace-authored ("Done", "Shipped", "Substantially complete"); the _groups_ are
Notion's own semantics. So:

- **Reading**: a page is complete iff its status option belongs to the `complete` group.
- **Writing**: completing a task writes the **first option in the target group**, so a workspace
  whose done column is called "Shipped" gets "Shipped" — never a literal `"Done"` that its schema
  does not contain (Notion would reject that with a 400).

Both the array shape the REST API returns (`groups: [{ name, option_ids }]` + a flat `options`
list) and the keyed shape (`groups: { to_do: [...] }`) are understood.

### Properties with no Docket destination

Every property the mapping does not carry is recorded on `NotionSchema.unmappedProperties` with its
type, so the sync surface can name it rather than dropping it silently. On the real LVBT `Tasks
Tracker` database those are:

| Property                                         | Type               | Why it does not map                                                                                                                                |
| ------------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Effort level`                                   | `select`           | Docket's estimate is a duration (`estimate_minutes`), not a T-shirt size; there is no non-arbitrary conversion from Small/Medium/Large to minutes. |
| `Project`                                        | `relation`         | Notion relations point at other Notion pages. Resolving one to a Docket project requires a project-level mapping the connector does not yet have.  |
| `Parent Task` / `Subtasks`                       | `relation`         | Same: the Docket parent must exist before the child can point at it, which needs a second reconciliation pass.                                     |
| `Updated at`                                     | `last_edited_time` | Already carried, as the page-level `last_edited_time` anchor — mapping the property too would double-count it.                                     |
| `Source` (synthetic test fixture only — see §3a) | `rollup`           | A rollup is a computed view of another database's rows; it has no independent value to store.                                                      |

---

## 3a. Notion's native "My Tasks" view is not a syncable database, and there is no per-row source-type field

An earlier pass of this spec (and the `MY_TASKS_PROPERTIES` fixture in
`packages/integrations/tests/notion/notion-fixtures.ts`) described Notion's built-in, per-person
"My Tasks" sidebar view as a second real database in the LVBT workspace, with its own simple schema
(`Task name`/`Status`/`Due`/`Assignee`/`Source`) distinguishable from an ordinary database row by a
source-type field. **A 2026-08-02 re-check against the live LVBT workspace, through the same
connected Notion MCP, found this to be wrong**, and the requirement it was meant to satisfy
(surface a `sourceType` field that tells a native-task-system row apart from a plain database row)
cannot be met as written, for a structural reason rather than a missing feature:

- Fetching the "My Tasks" database (id `6f60a403-0e08-47a3-8948-9fa25cdf97be`) returns no
  `<data-sources>` block at all — unlike `Tasks Tracker`, whose database fetch lists its data
  source explicitly — and the one view "My Tasks" has is filtered to "assigned to me" over
  `dataSourceUrl: ""` (empty).
- `GET /v1/data_sources/6f60a403-0e08-47a3-8948-9fa25cdf97be` — the exact call
  `NotionProviderClient.schemaFor` makes for any data source — 404s: `"Could not find data_source
with ID: …"`. This is not an MCP-tool quirk: it is Notion's own API answering that no data source
  exists at that id, which is what `GET /v1/data_sources/{id}` would tell the real connector too.
- Querying the "My Tasks" view's rows and then fetching one of those rows directly shows its real
  `<parent-data-source>` is `collection://383c7791-208f-802e-9508-000b6d244e57` — `Tasks Tracker`
  itself. "My Tasks" has no rows of its own to have a schema for; it is Notion's own cross-database
  "assigned to me, still open" filter over rows that already live in a real database.

**The practical consequence:** a public Notion integration — which is what Docket's OAuth grant is
— can never be given access to "My Tasks" (there is nothing shareable to grant access to), so
`listContainers()` structurally never offers it as a database to sync, and there is no row Docket's
connector could ever receive that originated from it. Every task assignee sees in their personal
"My Tasks" view is already reachable by syncing the real database it lives in (`Tasks Tracker`, in
LVBT's case) — which the connector already does, fully, today. So there is no genuine "native task
row" for a `sourceType` field to distinguish: the requirement's premise does not correspond to
anything reachable through Notion's public API, and adding a field that always reads "custom
database" (there being no alternative value it could ever take) would be dead code standing in for
a distinction the API cannot produce. `MY_TASKS_PROPERTIES` is kept in the fixture file as a
synthetic stand-in for a differently-named custom database — useful for exercising
`readNotionSchema`'s type/name-preference resolution — but is no longer presented as a second real,
live-verified schema.

---

## 4. Deletions arrive as data, not as absence

The default data-source query returns only live pages. A trashed page simply stops appearing —
indistinguishable, to the reconciler, from a page filtered out by the integration's database
selection. And the reconciler is right to leave those alone: absence must never destroy local work.

So the adapter runs the query **twice** per data source — once normally, once with
`in_trash: true` — and maps a trashed page to a tombstone (`ImportedItem.removed`). Reconciliation
then archives the local linked task on an explicit tombstone. (`in_trash` is the `2026-03-11`
parameter name; the adapter previously sent a nonstandard `is_archived`, which the installed SDK's
own declared types never recognized at any version — an independent bug, fixed alongside the
version bump rather than left for a rename Notion's changelog happened to formalize.)

The two partitions are disjoint by definition, but results are de-duplicated by page id with the
**live copy winning**, so a page that moved to the trash mid-pagination cannot archive a Docket task
on the strength of a race.

---

## 5. Docket wins. And the losing value is written down.

`planTaskReconcile` (`apps/api/src/routes/integration-reconcile.ts`) decides direction per task from
two facts: whether the local task is **dirty** (`updated_at > external_updated_at`) and whether the
remote is **newer than the anchor**.

| Local dirty | Remote newer | Action                                                                             |
| ----------- | ------------ | ---------------------------------------------------------------------------------- |
| no          | no           | `noop`                                                                             |
| no          | yes          | `pull` — a one-sided remote change is not a conflict; Docket still learns          |
| yes         | no           | `push`                                                                             |
| **yes**     | **yes**      | **`push`, with a `conflict`** — Docket wins regardless of which timestamp is later |

The previous rule for the last row was `local.updatedAt >= remoteMs ? push : pull`. That is
last-write-wins, and it is now gone from both the task reconciler and the work-graph reconciler
(`planWorkItemReconcile`), with one deliberate exception: a genuinely newer remote **tombstone**
still archives locally, because a deleted page cannot be resurrected by pushing a title at it.

### The conflict log

A decision that discards the other side's value without recording it is the "silently overwrote your
work" failure the launch requirements name. So the losing remote values ride along on the action as
a `TaskSyncConflict` and are persisted **before** the push that overwrites them
(`recordSyncConflict`, `apps/api/src/routes/sync-notion.ts`):

```
audit_event
  subject_type = 'task'
  subject_id   = <the Docket task that won>
  type         = 'updated'
  metadata     = {
    kind: 'sync_conflict',
    provider, integrationId,
    resolution: 'docket_wins',
    externalId, remoteUpdatedAt, localUpdatedAt,
    remoteTitle, remoteBody, remoteDueDate, remoteCompleted
  }
```

**Why `audit_event` and not a new table.** It is already the universal, org-scoped,
actor-attributed feed with a JSONB payload and an index on `(subject_type, subject_id)` — every
property a conflict record needs. Reusing it means this capability ships with **no migration at
all** against a database holding live production data, and a conflict appears in the task's own
history rather than in a side channel nobody opens. `listSyncConflicts` filters on the JSONB
discriminator in SQL, so an integration with a long ordinary audit history is not scanned in memory.

`ReconcileResult.conflicts` counts them, and the count and the durable rows cannot disagree —
they are incremented by the same branch.

---

## 6. Connecting it

Notion is a native Better Auth social provider, gated on `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET`
(both optional — absent means Notion is simply not offered). Notion's OAuth has **no scope
parameter**: a **Public Connection**'s capabilities are declared on the connection itself and the
person chooses which pages to share during consent. So, unlike Linear, there is no read-vs-write
scope gate and Notion **defaults `writeBack` on** at connect (`WRITE_BACK_CAPABLE_PROVIDERS`).

Configuration is per workspace, like every other connector: the integration row is org-scoped, and
`config.listIds` holds the Notion data source ids that workspace syncs. A workspace with no Notion
integration row shows Notion unconnected; connecting it in one workspace changes nothing in another.

Setup (also walked by `pnpm integrations`):

1. `app.notion.com/developers` → **Connections** → **New connection**. Notion retired the old
   "integrations" naming for this **Connections** model: an **Internal Connection** is a static
   token scoped to one workspace, a **Personal Access Token** is user-scoped with no OAuth, and a
   **Public Connection** is OAuth 2.0, installable across many workspaces, Marketplace-eligible —
   that last one is what Docket uses, since it serves many separate customer workspaces from one
   integration.
2. Connection name: `Docket` (shown during consent, not the personal default). Authentication
   method: OAuth. Installable in: any/public workspace.
3. Redirect URIs — the callback is browser-facing (Better Auth's native `/api/auth/callback/notion`
   route, same as every other social provider, reached through the web app's same-origin proxy, not
   the raw API host):
   - Dev: `https://docket.localhost/api/auth/callback/notion`
   - Prod: `https://docket.hypertext.studio/api/auth/callback/notion`
4. On the created connection's **Configuration** tab, under **Capabilities**, check all three
   content capabilities — **Read content**, **Update content**, **Insert content** — and under
   **User capabilities** (a radio group, mutually exclusive) select **"Read user information
   including email addresses"**, not the no-email option above it. People matching
   (`syncExternalActors`) is built entirely on `GET /v1/users` returning emails; without this
   selected, matching silently returns everyone as unmatched rather than erroring.
5. Copy **Client ID** (not a secret — Notion echoes it in the plaintext Authorization URL on the
   same page) into `NOTION_CLIENT_ID`, and **Client secret** (reveal via the eye icon) into
   `NOTION_CLIENT_SECRET`.
6. The **Webhooks** tab is a separate, later step — Notion mints `NOTION_WEBHOOK_TOKEN` itself
   during the subscription handshake, not at connection-creation time. Leave it unset until then;
   the mirror falls back to its polling cadence in the meantime.
7. In Docket: **Settings → Connections → Notion → Connect**, then pick the databases to sync.

---

## 7. Files

| Path                                                    | What it holds                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/integrations/src/notion-mapping.ts`           | The pure schema derivation and property mapping (no HTTP).                                                                                 |
| `packages/integrations/src/notion.ts`                   | `NotionProviderClient` — the provider I/O edge, read + write.                                                                              |
| `packages/integrations/tests/notion/notion-fixtures.ts` | The real LVBT `Tasks Tracker` schema, transcribed from the live workspace, plus one synthetic differently-named-database schema (see §3a). |
| `packages/integrations/tests/notion/*.test.ts`          | 36 tests over the mapping and the client.                                                                                                  |
| `apps/api/src/routes/sync-notion.ts`                    | The sync conflict log: `recordSyncConflict`, `listSyncConflicts`.                                                                          |
| `apps/api/src/routes/integration-reconcile.ts`          | `planTaskReconcile` — where Docket wins.                                                                                                   |

Everything else — the lease, the `sync_run` rows, the cron sweep, the cursor bookkeeping — is the
shared spine in [`integration-sync.md`](./integration-sync.md). Notion adds no parallel engine.

---

## 8. Docket-designed databases

The inverse of everything above: Docket creates the databases, authors their schema, and projects
its own work into them.

### 8.1 The table designer is the setup surface

Not a wizard that reports what it built — a designer that shows the database before it exists,
rendered as a Notion-style table and filled with the workspace's **real** rows. The user renames
the database, renames or removes columns, and chooses how each person-valued field appears. What
they approve is what gets provisioned.

When an entity has no rows yet the preview falls back to plainly generic samples and says so. A
designer that quietly shows invented data teaches the reader to distrust every number on it.

Under every column header sits the Docket field it is bound to, in mono. Once titles are
user-chosen, the link between "the column called DRI" and `task.assignee` is otherwise invisible.

### 8.2 Bindings address property ids, never titles

`property_map` binds a Docket field key to a Notion **property id**. Titles are user-chosen here
and freely renameable inside Notion; ids survive a rename and titles do not. Binding by title
would let someone rename a column in Notion and silently sever the sync.

The map also carries an explicit `order`. `property_map` is a `jsonb` column and PostgreSQL
normalizes object key order (by key length, then bytes), so insertion order is gone by the first
read back — relying on it silently rearranged every design's columns.

### 8.3 A person is a per-column representation choice

Notion's native `people` property can only reference members of the Notion workspace, which in
most workspaces is not most of the roster. So how a person appears is chosen per column:

- **Plain text** — the default. The only representation that holds every human, including those
  with no Notion account and no Docket account.
- **Notion person** — native @-mentions and notifications, for the matched subset only.
- **A People table Docket creates** — everyone gets a row, account or not.
- **A table you already keep** — a relation to an existing directory. Not implemented: Docket owns
  no page ids in a database it did not create, so it could only fill such a column by matching
  display names, the same ambiguity §8.9 refuses for person pull-back. `applyDesignPatch` rejects
  it with a 409 rather than accepting the choice and silently leaving the column blank.

**Notion person adds a column; it never replaces one.** Choosing it provisions the parent column as
rich text _and_ a derived companion column (`<field>NotionPerson`, titled `<Title> (Notion)`) as the
native `people` property. Substituting one for the other would delete the only column able to hold a
person with no Notion account — precisely the population the choice exists to serve. Companions are
generated from the parent on every save, never sent by the client, and never offered in the
designer's field palette, so a stale browser cannot desync a column from the choice that produces
it. Consequently `provisionedKind` never returns `people` from a _representation_: a `people`
property is always a column of its own.

The projected People database keeps its native `people` column (`notionUser`) _separate_ from its
title for the same reason: the title must hold every actor, the native column can only hold the
matched subset, and both are wanted at once.

**Resolution, and known-empty versus unknown.** Loaders emit a person field as an actor _reference_;
`resolveMirrorValues` renders it once the pass has loaded two maps — `actorId → Notion user`
(matched rows only) and `actorId → People page id`. The distinction that matters:

- No assignee at all resolves to an empty value, which _clears_ the Notion property. Correct: the
  assignee really was removed.
- A page id not known _yet_ omits the field entirely, so it lands in neither the payload nor the
  content hash. Writing an empty value would be indistinguishable from the first case and would
  confidently erase a cell somebody may have filled in by hand. The pass reports it as
  `unresolvedPending` and marks itself incomplete so the sweep returns; the next pass sees a
  different hash and issues exactly one write.
- A matched-subset column with no Notion account for that actor is an honest empty and is reported
  as `unresolvedPermanent`. It deliberately does **not** mark the pass incomplete, or one
  account-less person would keep a workspace from ever recording a full sync.

### 8.3.1 Identity has three states, not two

An `external_actor` row is matched, undecided, or **deliberately excluded**:

| `actorId` | `ignoredAt` | meaning                                              |
| --------- | ----------- | ---------------------------------------------------- |
| set       | null        | matched, by `email` or `manual` (see `matchedBy`)    |
| null      | null        | undecided — nobody has said what this person maps to |
| null      | set         | excluded — somebody chose "don't sync them"          |

The third state needs its own column, and the reason is concrete: without it, recording a skip
wrote `{actorId: null, matchedBy: null}` — byte-identical to the row's existing state. The person
reappeared in the "needs a decision" list on the very next read, so pressing Apply looked like it
did nothing and the surface could never be finished. Worse, `syncExternalActors` re-evaluates any
row that is not `manual`, so a matching email would silently overturn the decision on the next
pass. An ignored row is therefore immune to re-matching in exactly the way a `manual` one is, and
`ignoredAt` is absent from the upsert's `set` clause so the exclusion survives by construction.

Every non-`skip` decision clears `ignoredAt` — including the generic
`PATCH …/external-actors/:externalActorId` — since deciding anything about somebody supersedes an
earlier decision to exclude them, and a stale exclusion would keep the row immune forever.

A timestamp rather than a new `external_actor_match` value, for two reasons. `matchedBy` answers
_how `actorId` was resolved_ and is non-null iff `actorId` is; an `'ignored'` member would break
that invariant for every reader. And adding a value to a Postgres enum and using it in the same
transaction fails with 55P04 — the hazard `packages/db/src/migrate.ts` maintains an
`ENUM_PREFLIGHT` list for. A nullable timestamp is a plain `ADD COLUMN` with neither problem.

### 8.3.2 Running the mirror by hand

`POST /v1/orgs/:orgId/integrations/:id/notion/sync` runs one pass against the container page
already chosen. Distinct from `/provision`, which _chooses_ that page and rewrites the connection's
config; this one only runs, so it is the safe repeat action — and, until it existed, there was no
way to re-run the mirror after setup at all, which left a stalled sync recoverable only by
reconnecting.

It answers 409 when no container page has been chosen, deliberately **without** calling through:
`runNotionMirrorSync` throws in that case, and the leased spine records any throw as a connector
failure — demoting a healthy connection to `error` and notifying its owner about a setup step
nobody had finished. A held lease is also 409. A _failed_ run is a 200 carrying
`status: 'failed'`, so clients must read `status` rather than the response code.

The shared `POST /:id/sync` additionally runs the mirror for a Notion connection that has one
configured. Both directions are needed for "Sync" to mean what it says there: running only the task
pull reported success having never touched the mirror. One response cannot carry two runs, so the
body is the failed run if either failed, otherwise the mirror's — failure wins, because only the
opposite error lets a broken sync look healthy. Both remain readable at `GET /:id/runs` by
`purpose`.

`sweepNotionMirror` reports a `stalled` count for connections that can never run as configured (no
container page, or no owning actor to borrow credentials from). They used to be skipped in silence,
which made a permanently stuck workspace indistinguishable from one with nothing due.

### 8.4 Provenance lives in a side table

`notion_mirror_database` (one per entity kind) and `notion_mirror_row` (one per projected record),
deliberately **not** the provenance columns on `task`/`project`/`cycle`. A task can be linked
_from_ an existing database and projected _into_ a designed one simultaneously — two Notion pages,
one slot — and `initiative`/`program`/`team`/`milestone`/`actor` have no provenance columns at
all, where `source = 'linked'` would be false anyway.

### 8.5 Webhooks, and the echo guard

Notion webhooks wake the pull-back through the existing `/internal/ingest` inbox. Polling remains
the safety net, because deliveries get missed and a connector that quietly stops syncing is the
failure this codebase refuses.

Docket's own writes fire webhooks, so replaying them would loop forever. Two guards:

- **Authors.** The payload carries `authors: [{ id, type }]`. A delivery authored _solely_ by
  Docket's own bot is dropped. Every author must be the bot — a page a person edited in the same
  window lists both, and that delivery carries a real change.
- **Timestamps.** Polling has no author information, so `isRemoteEdited` compares against
  `last_pushed_at` rather than the anchor: only an edit made after Docket's own write counts.

### 8.6 Direction, per entity

Tasks and projects are two-way; everything else is a projection. On a projection, an edit made in
Notion is drift — Docket's values are restored **and the loss is recorded**, because a revert the
user cannot see is indistinguishable from data loss.

Two-way entities follow the same matrix as §5: a one-sided remote change is pulled, a one-sided
local change is pushed, and when both moved Docket wins regardless of which is newer, with the
losing remote values recorded first. Absence never deletes — an incremental read returns only what
changed, so a missing row is unchanged, not gone.

### 8.7 The rate limit is a design constraint

Notion allows roughly three requests a second. A content hash over the _projected_ values means an
entity whose `updated_at` moved for a reason this database does not carry costs no write at all.
Rich text caps at 2000 characters and relations at 100 per request; both truncate and report what
they dropped.

### 8.8 Why not Notion's own Sync/Workers

Notion ships a first-party **Sync** capability (a **Worker** subtype, `app.notion.com/product/dev`)
that does the same _shape_ of thing as the push-only entities here: continuously upsert external
records into a Notion database from a declarative schema on a persistent cursor. It was not used,
for three independently-sourced reasons rather than a preference:

- **Locked properties.** A Sync worker creates and owns its own database; the properties it writes
  are visible and copyable in Notion's UI but not editable there. That is incompatible with the
  table designer for every entity, not only the two-way ones — the whole point is a database the
  person can rename, re-column, and work in normally.
- **One-way only**, external → Notion, by Notion's own guidance ("use Sync when the external system
  is the source of truth"; "for bidirectional workflows, regular Workers are recommended instead").
  Tasks and projects need two-way.
- **Multi-tenancy does not fit the billing model.** Every source describing Workers pricing frames
  credits as purchased by "workspace admins" against _that workspace's own_ Business/Enterprise
  plan, pooled per-workspace — not one deployment serving many separate OAuth-installing customer
  workspaces, which is Docket's actual model. The one source that speaks to third-party SaaS
  distribution directly says the opposite: "for most SaaS builders, public connections with OAuth
  2.0 are the right choice" — the REST-API-plus-OAuth path this file documents, not Workers.

This is inference from an absence of a stated third-party multi-tenant model, not an explicit "no."
Revisit if Notion documents per-installation Worker provisioning for Public Connections on arbitrary
customer plans.

### 8.8 The SDK is the source of truth

`@notionhq/client` supplies every request and response shape, pins the API version, retries
throttled requests, and ships the webhook signature helpers. Docket's narrower schema — nine
entities, twelve property kinds, four person representations — is pinned to it by two type-level
assertions that fail the build if it drifts. That immediately caught a real difference:
`databases.create` and `dataSources.update` do not accept the same property union.

### 8.9 How a pass runs, and what is still open

`runNotionMirrorSync` executes on the shared leased spine with `purpose: 'notion_mirror'`, ordered
**provision → pull back → project**. That order is load-bearing: pulling first means a remote edit
made since the last sweep is reconciled against the values Docket is about to write, rather than
being clobbered by a projection that then rediscovers its own write as a remote change.

Provisioning runs in two waves, because a Notion relation must name an existing data source: every
database is created with its scalar columns, then each is patched to add relations once their
targets exist. It skips anything already carrying a data source id, which makes it the repair path
too. Wave two also runs for any design holding a column with no property id yet — otherwise a
column _added_ to an already-provisioned database would exist in Docket's map and nowhere in
Notion, and every value written to it would be silently dropped.

Projection is ordered by `MIRROR_PROJECTION_ORDER`, which puts **`person` first**. A relation can
only carry a page id that already exists, so every other entity's person columns depend on the
People rows having been written. The order is explicit rather than incidental: the design query
returns rows in whatever order Postgres chooses, which also made budget spend unpredictable.

A shared write budget (400 writes at ~3/second) is spent across every entity so one large database
cannot starve the rest. A pass that exhausts it reports what it actually wrote and sets
`stampFullSync: false`, so the sweep resumes next tick instead of being recorded as a complete sync
it never was.

`sweepNotionMirror` is a separate sweep rather than a branch inside `sweepConnectorSync` — calling
the spine from the spine would be an import cycle, and the two purposes deserve independent
cadences anyway. It runs on the same cron tick and in the dev scheduler.

The whole flow runs with **no Notion account**: `MockNotionMirror` is a behavioural in-memory
workspace (pages stored, `last_edited_time` advancing, `since` honoured, trash surfaced), selected
by the container in `local`/`test` mode exactly as `MockConnector` is.

**`pull` is applied** for Task and Project (`applyPulledValues`, `notion-mirror-entities.ts`), via
`readMirrorProperties` (`notion-mirror-values.ts`) matching by property id, the same rename-safety
rule everything else in this file follows. Deliberately narrower than the full projection catalog:

- **Person fields** (`assignee`/`lead`) are excluded — but no longer because the ids are ambiguous.
  A `people` or `relation` value carries an unambiguous id that resolves through `external_actor`
  or `notion_mirror_row`. Three other reasons stand: one Docket field is now backed by _two_ Notion
  properties (the column and its companion), so an edit to each is a conflict class with no rule
  yet; Notion's `people` is multi-valued while `task.assigneeId` is not, so a two-person cell has
  no honest single reading; and assignment has event and notification side effects that
  `applyPulledValues`' plain column write bypasses — the reason `task.state` already routes through
  `setTaskState` instead.
- **`docketUrl`** is derived from the entity's own id and was never stored, so there is nothing to
  read back.

`priority`/`status`/`health` are applied when the pulled option exactly matches one of Docket's
fixed enum values, an unrecognized option (a rename, a typo) treated as "not read" rather than
written blind. `task.state` goes through `setTaskState` — the same shared transition
`PATCH /tasks/:id/status` uses — rather than a plain column write, since it is per-team
configurable and needs `completedAt`/`canceledAt` derivation and event emission; an unrecognized
state name is caught the same way.

A contested edit's conflict record still carries honest gaps for the fields this reader does not
apply, rather than inventing values for them.

**`adopt` is applied too** (`adoptEntity`, `notion-mirror-entities.ts`) — a row created directly in
Notion, on a two-way entity, becomes a first-class Docket task or project. It reuses
`resolveImportTeam` (`integration-import.ts`), the exact team-landing answer the linked-database
mode already settled on for the identical problem: prefer `config.teamId` when configured, else
the org's earliest-created team. A new task's initial state is the landing team's own open-type
workflow state (`resolveStateKeys`), never a Notion status value — interpreting an arbitrary select
option as a _starting_ state has no more principled an answer than "the team's default", the same
reasoning `applyPulledValues` already applies to an _edit_.

The incremental `last_edited_time` cursor for the **linked** mode (§4) is done: `runSync`'s flat
path (`integration-sync.ts`) passes `ImportWorkInput.since` on every non-full sync, and
`NotionProviderClient.queryDataSource` (`notion.ts`) filters both the live and trashed queries to
`last_edited_time.on_or_after` it — the same full-vs-incremental policy the work-graph branch
already used, now shared by the flat path so Notion stops re-reading every row on every sweep.

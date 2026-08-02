# Sunsama → Docket migration

> **Status**: The read half is built and proven offline. **No migration has been performed**, and
> `--apply` is deliberately refused — see §5 for the two things that block it, both named precisely.
> **Tool**: `pnpm sunsama:import` (`scripts/import-sunsama.ts`)
> **Reader**: `packages/integrations/src/sunsama.ts` · **Mapping/routing**: `sunsama-mapping.ts`
> **Run report**: [`sunsama-run.json`](./sunsama-run.json)

All active work moves from Sunsama into Docket, through Sunsama's MCP server, preserving every
source field that has anywhere to go and **naming every field that does not**.

---

## 1. The data comes from MCP, and only from MCP

`packages/integrations/src/sunsama.ts` contains no HTTP client for Sunsama, no HTML parsing and no
CSV path. Every record arrives as the result of an MCP `tools/call`. That is the whole mechanism —
the alternative does not exist in the source, which is what makes the requirement checkable rather
than asserted.

**Tool names are discovered, not assumed.** Sunsama has shipped its tools under more than one
naming convention (its own changelog names `GET_BACKLOG_TASKS` and `get_task_by_id`; the widely
mirrored community server uses `get-tasks-backlog`). `resolveSunsamaTools` matches what the server
actually advertises through `tools/list` against a documented alias table, case-insensitively and
ignoring `-`/`_` differences. A capability it cannot resolve is **reported**; a _required_ one that
it cannot resolve **aborts the run**. An empty migration that reports success is the failure mode
this guards against.

| Capability     | Aliases accepted                                                              | Required? |
| -------------- | ----------------------------------------------------------------------------- | --------- |
| `getUser`      | `get_user`, `get-user`, `get_current_user`                                    | no        |
| `listStreams`  | `get_streams`, `get-streams`, `list_streams`                                  | no        |
| `listBacklog`  | `get_backlog_tasks`, `get-tasks-backlog`, `get_tasks_backlog`, `list_backlog` | **yes**   |
| `listByDay`    | `get_tasks_by_day`, `get-tasks-by-day`, `get_tasks_for_day`                   | no        |
| `listArchived` | `get_archived_tasks`, `get-archived-tasks`                                    | no        |
| `getTask`      | `get_task_by_id`, `get-task-by-id`                                            | no        |

Every call is recorded — capability, tool name, arguments, task count, error flag — and the run
report embeds the log. That log is the evidence of _how_ the data was obtained.

Sunsama's planned work is addressed one day at a time, so "all active work" = the backlog plus a
day sweep. The default live window is 30 days back and 60 forward (`--days=` overrides it, and the
report states the window used, so nobody has to guess what was covered).

**Nothing is ever written to Sunsama.** The migration only reads; the source account is left exactly
as it was, which is half of "preserve all existing data".

---

## 2. Field mapping

Generated from `SUNSAMA_FIELD_MAPPING` in `packages/integrations/src/sunsama-mapping.ts`, which a
test asserts is exhaustive over the normalized task shape — adding a field to the reader without
deciding its destination fails the build rather than shipping a silent drop.

| Sunsama field          | Docket destination                                            | Note                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | `task.externalId` (with `task.source = "linked"`)             | The migration join key. Unique per (integration, externalId), so a re-run updates rather than duplicating.                                                                                                                      |
| `title`                | `task.title`                                                  | Direct. A blank Sunsama title would violate Docket's not-blank CHECK, so it becomes "Untitled task".                                                                                                                            |
| `notes`                | `task.description`                                            | Markdown preferred over HTML when the server offers both.                                                                                                                                                                       |
| `completed`            | `task.state` (the team's first completed-type workflow state) | Docket has no boolean done flag; completion is a workflow state, resolved per team.                                                                                                                                             |
| `completedAt`          | `task.completedAt`                                            | Direct. Preserved so historical completion timestamps survive the move.                                                                                                                                                         |
| `plannedDate`          | `task.startDate`                                              | Sunsama's "the day I intend to do this" is Docket's **start** date, not its due date — conflating the two would invent deadlines that were never set.                                                                           |
| `dueDate`              | `task.dueDate`                                                | Direct.                                                                                                                                                                                                                         |
| `timeEstimateMinutes`  | `task.estimateMinutes`                                        | Direct; both are minutes.                                                                                                                                                                                                       |
| `actualTimeMinutes`    | **not mapped**                                                | Docket's tracked time is a ledger of `time_record` segments with real start/stop boundaries, not a scalar total; writing a bare number would fabricate segments that never happened. **Preserved in the run report, per task.** |
| `streamIds`            | workspace routing (§3)                                        | The stream decides which workspace the task lands in — routing, not a stored field.                                                                                                                                             |
| `streamNames`          | workspace routing (display side)                              | Used when a run maps by stream _name_ rather than id.                                                                                                                                                                           |
| `subtasks`             | child task rows (`task.parentTaskId`)                         | Each subtask becomes its own Docket task parented to the migrated one, so its title survives as work rather than as prose in a note.                                                                                            |
| `subtasks[].completed` | child `task.state`                                            | Each subtask keeps its own completion.                                                                                                                                                                                          |
| `backlog`              | `task.startDate = null`                                       | A backlog item is precisely one with no planned day; Docket needs no separate flag.                                                                                                                                             |
| `archived`             | excluded from the active migration                            | Archived work is read and counted in the report, but it is not active work.                                                                                                                                                     |
| `createdAt`            | **not mapped**                                                | `task.createdAt` is Docket's own insert time; back-dating it would misreport when the row entered this system. **Preserved in the run report, per task.**                                                                       |
| `updatedAt`            | `task.externalUpdatedAt`                                      | The sync anchor, so a later two-way sync can tell a Sunsama edit from a Docket one.                                                                                                                                             |
| `sourceIntegration`    | `task.externalUrl` when it is a URL                           | Sunsama's GitHub/Linear/Gmail provenance string; kept verbatim in the report when it is not a URL.                                                                                                                              |
| everything else        | **not mapped**                                                | Anything the normalizer did not recognise — e.g. `recurringDefinitionId`, since Docket has no task-recurrence model. **Enumerated per task in the run report** so nothing disappears without being named.                       |

"Not mapped" never means "discarded". Every one of those values is written into the run report's
`preservedFields`, keyed by Sunsama task id.

---

## 3. Workspace routing — declared before the run, verified after

Sunsama organizes work into **streams**; Docket organizes it into **workspaces**. A migration that
dumps everything into one catch-all is not a migration, so the destination for every stream is
declared in `SUNSAMA_ROUTING` (`scripts/import-sunsama.ts`) **before** a run, and the run checks
itself against the declaration.

| Sunsama stream                                  | Docket workspace                                             |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `str-transit` / "Las Vegans for Better Transit" | Las Vegans for Better Transit                                |
| `str-newsletter` / "Weekly newsletter"          | The Willie Diaries                                           |
| `str-personal` / "Personal"                     | Personal Life                                                |
| `str-docket` / "Docket"                         | Hypertext Studio                                             |
| "Reasonable Tech"                               | Reasonable Tech Company                                      |
| "Rebuilding America"                            | Rebuilding America Project                                   |
| "Oasis"                                         | Project Oasis                                                |
| "Vibe Code Cleanup"                             | Willie Enterprises (dba Vibe Code Cleanup Company)           |
| _(anything unmatched)_                          | **fallback:** Personal Life — **expected count declared: 1** |

Matching is by stream **id** first (a stream can be renamed; its id cannot), then by name,
case-insensitively.

Three properties the tool enforces, all failing the run non-zero:

1. **Every destination is one of the eight real workspaces.** `validateSunsamaRouting` rejects a
   ninth name rather than creating one, and the migration never creates a workspace implicitly —
   an absent destination is an error telling you to run `pnpm workspaces:provision`.
2. **No task is ever unrouted.** `routeSunsamaTask` returns a workspace, not `workspace | null`; the
   report's `unroutedCount` must be `0`.
3. **The fallback count must equal what was declared.** Discovering _after_ a run that four hundred
   tasks landed in a catch-all is exactly what the declaration prevents.

---

## 4. Preserving what is already in Docket

The migration is **additive only** by construction. It creates tasks that do not already exist and
skips ones already carrying the same Sunsama id (`task.external_id`, unique per integration for
`linked` rows). It never updates, archives or deletes a pre-existing record, so a pre/post diff of
the destination account can only show insertions.

Reconciliation, written into the report:

- `sunsamaActiveCount` — active tasks read from the source.
- `docketMatchedCount` — Docket tasks carrying one of those Sunsama ids after the run.
- `unmatchedSunsamaIds` — source tasks with no Docket counterpart. **Must be empty.**
- `unmatchedDocketIds` — Docket tasks carrying a Sunsama id the source no longer has. **Must be
  empty.**

A non-empty list on either side exits non-zero.

---

## 5. What blocks a real migration — two things, named exactly

**Nothing has been migrated.** The committed [`sunsama-run.json`](./sunsama-run.json) is a _fixture,
dry-run_ report — its `source` is `"fixture"` and its `applied` is `false`, so it cannot be mistaken
for one. Two independent blockers stand between here and a real run, and neither is papered over.

### 5.1 Reading the real account needs one interactive authorization

`https://api.sunsama.com/mcp` speaks the MCP OAuth flow: protected-resource discovery, PKCE, a
browser consent screen. **A headless script cannot complete a browser consent.**

`--source=live` therefore requires an already-minted credential in `SUNSAMA_MCP_TOKEN`, obtained by
connecting Sunsama once under **Settings → Connections → MCP connectors**. Without it the tool fails
with exactly that instruction. It does not fall back to the fixture and call the result a migration.

### 5.2 `--apply` is refused, because the write path cannot record where a task came from

`POST /v1/orgs/:orgId/tasks` accepts **no provenance**. That is correct API design — `TaskProvenance`
is machine metadata the reconcile engine owns, and a client must not be able to claim a task is
`linked`. But it means a migration written through that endpoint produces tasks carrying no Sunsama
id, and therefore:

1. a second run could not recognise its own prior output, so it would duplicate every task;
2. the id-level reconciliation in §4 — every Sunsama id mapping to exactly one Docket task id, both
   unmatched lists empty — would be **unanswerable**, because there would be nothing on the Docket
   side to match against;
3. the report would say "migrated" while being unable to prove it.

So `--apply` throws with that explanation rather than writing work it cannot account for. Running it
and reporting success is the precise failure this project has already been burned by.

**What closes it:** a Sunsama `ConnectorProvider` client, the way Notion has one, so migrated work
flows through the reconcile engine that _does_ stamp `task.external_id` (and gains idempotent
re-runs and two-way sync as a side effect). Everything upstream of that — tool discovery, reading,
normalization, routing, mapping, the report — is built and tested and would be reused unchanged.

### Running what exists

```sh
# prove the pipeline offline — no accounts, no network, no writes
pnpm sunsama:import --source=fixture

# dry-run against the real account once SUNSAMA_MCP_TOKEN is set
pnpm sunsama:import --source=live
```

---

## 6. The fixture account

`packages/integrations/src/sunsama-fixtures.ts` is not a toy. Each task carries the full field set
Sunsama's MCP server returns — notes, subtasks with their own completion, planned day, due date,
planned vs actual time, streams, completion timestamp, backlog flag, creation/modification
timestamps, integration provenance — plus one field (`recurringDefinitionId`) the normalizer
deliberately does **not** consume, so the "nothing is silently dropped" guarantee has something to
catch. Seven active tasks across four streams, one of them stream-less to exercise the declared
fallback, and one archived task.

The server advertises its tools under Sunsama's own snake_case names, so alias resolution is
exercised against a real convention rather than one invented to match the code.

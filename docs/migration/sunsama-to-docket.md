# Sunsama → Docket migration

> **Status**: The full pipeline — read → normalize → route → map → reconcile with real provenance
> — is built and proven **end-to-end on the offline fixture**, including an idempotent second run
> (§5.2). **No real Sunsama account has been migrated.** One named blocker remains, and only one:
> a human must authorize Sunsama's MCP OAuth consent and set `SUNSAMA_MCP_TOKEN` (§5.1) —
> `--apply --source=live` is refused until then.
> **Tool**: `pnpm sunsama:import` (`scripts/import-sunsama.ts`)
> **Reader**: `packages/integrations/src/sunsama.ts` · **Mapping/routing**: `sunsama-mapping.ts` ·
> **Connector adapter**: `sunsama-connector.ts`
> **Run report**: [`sunsama-run.json`](./sunsama-run.json) (fixture, **applied**)

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

| Sunsama field          | Docket destination                                                                                                         | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | `task.externalId` (with `task.source = "linked"`, `task.sourceIntegrationId` = a real `migration`-pattern integration row) | The migration join key. Unique per (integration, externalId), so a re-run **updates rather than duplicating — proven, not just intended**: `sunsama-connector.ts` stamps every task's Sunsama id onto `ImportedItem.provenance.externalId`, and a real `--apply` run followed by a second one against the unchanged fixture inserts 7 tasks the first time and 0 the second (see §5.2).                                                                             |
| `title`                | `task.title`                                                                                                               | Direct. A blank Sunsama title would violate Docket's not-blank CHECK, so it becomes "Untitled task".                                                                                                                                                                                                                                                                                                                                                                |
| `notes`                | `task.description`                                                                                                         | Markdown preferred over HTML when the server offers both.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `completed`            | `task.state` (the team's first completed-type workflow state)                                                              | Docket has no boolean done flag; completion is a workflow state, resolved per team.                                                                                                                                                                                                                                                                                                                                                                                 |
| `completedAt`          | `task.completedAt`                                                                                                         | Direct. Preserved so historical completion timestamps survive the move.                                                                                                                                                                                                                                                                                                                                                                                             |
| `plannedDate`          | `task.startDate`                                                                                                           | Sunsama's "the day I intend to do this" is Docket's **start** date, not its due date — conflating the two would invent deadlines that were never set. **Designed destination; not yet written by `--apply`** — see §5.3: the shared `ImportedItem`/`reconcileTasks` write path every connector adapter uses carries no `startDate` field, so this value is computed correctly by `mapSunsamaTask` but not persisted. Reported per task in `notWrittenByReconciler`. |
| `dueDate`              | `task.dueDate`                                                                                                             | Direct, and written by `--apply` (`ImportedItem.dueDate` is on the shared write path).                                                                                                                                                                                                                                                                                                                                                                              |
| `timeEstimateMinutes`  | `task.estimateMinutes`                                                                                                     | Direct; both are minutes. **Designed destination; not yet written by `--apply`** — same §5.3 gap as `plannedDate`. Reported per task in `notWrittenByReconciler`.                                                                                                                                                                                                                                                                                                   |
| `actualTimeMinutes`    | **not mapped**                                                                                                             | Docket's tracked time is a ledger of `time_record` segments with real start/stop boundaries, not a scalar total; writing a bare number would fabricate segments that never happened. **Preserved in the run report, per task.**                                                                                                                                                                                                                                     |
| `streamIds`            | workspace routing (§3)                                                                                                     | The stream decides which workspace the task lands in — routing, not a stored field.                                                                                                                                                                                                                                                                                                                                                                                 |
| `streamNames`          | workspace routing (display side)                                                                                           | Used when a run maps by stream _name_ rather than id.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `subtasks`             | child task rows (`task.parentTaskId`)                                                                                      | Each subtask becomes its own Docket task parented to the migrated one, so its title survives as work rather than as prose in a note. **Designed destination; not yet written by `--apply`** — §5.3 again: `ImportedItem` has no parent-task linkage at all, so subtasks are counted (`notWrittenByReconciler[id].subtaskCount`) but not yet created as rows.                                                                                                        |
| `subtasks[].completed` | child `task.state`                                                                                                         | Each subtask keeps its own completion — once the row above exists to hold it.                                                                                                                                                                                                                                                                                                                                                                                       |
| `backlog`              | `task.startDate = null`                                                                                                    | A backlog item is precisely one with no planned day; Docket needs no separate flag.                                                                                                                                                                                                                                                                                                                                                                                 |
| `archived`             | excluded from the active migration                                                                                         | Archived work is read and counted in the report, but it is not active work.                                                                                                                                                                                                                                                                                                                                                                                         |
| `createdAt`            | **not mapped**                                                                                                             | `task.createdAt` is Docket's own insert time; back-dating it would misreport when the row entered this system. **Preserved in the run report, per task.**                                                                                                                                                                                                                                                                                                           |
| `updatedAt`            | `task.externalUpdatedAt`                                                                                                   | The sync anchor, so a later two-way sync can tell a Sunsama edit from a Docket one.                                                                                                                                                                                                                                                                                                                                                                                 |
| `sourceIntegration`    | `task.externalUrl` when it is a URL                                                                                        | Sunsama's GitHub/Linear/Gmail provenance string; kept verbatim in the report when it is not a URL.                                                                                                                                                                                                                                                                                                                                                                  |
| everything else        | **not mapped**                                                                                                             | Anything the normalizer did not recognise — e.g. `recurringDefinitionId`, since Docket has no task-recurrence model. **Enumerated per task in the run report** so nothing disappears without being named.                                                                                                                                                                                                                                                           |

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

A non-empty list on either side exits non-zero. On a `--source=fixture --apply` run these four
numbers are computed for real, by reconciling and then re-querying Docket — not asserted. The
committed [`sunsama-run.json`](./sunsama-run.json) is that real run's report: `docketMatchedCount`
is `7`, both unmatched lists are `[]`.

---

## 5. What still blocks a real migration — one thing, named exactly

### 5.1 Reading the real account needs one interactive authorization — still true, still blocking

`https://api.sunsama.com/mcp` speaks the MCP OAuth flow: protected-resource discovery, PKCE, a
browser consent screen. **A headless script cannot complete a browser consent, and this tool will
not scrape, guess, or fabricate a credential to get around that.**

`--source=live` therefore requires an already-minted credential in `SUNSAMA_MCP_TOKEN`, obtained by
connecting Sunsama once under **Settings → Connections → MCP connectors**. Without it the tool fails
with exactly that instruction. `--apply --source=live` is refused outright, independent of the
token check (`refuseLiveApply` in `scripts/import-sunsama.ts`) — the fixture path being proven does
not make a live apply safe to attempt without the human step above. **This is the one remaining,
named blocker** on a real migration of the author's actual Sunsama account.

### 5.2 CLOSED: `--apply` writes real, traceable, idempotent Docket tasks (on the fixture)

This used to be the second blocker: `POST /v1/orgs/:orgId/tasks` accepts no provenance, so a task
written through it would carry no Sunsama id and a re-run would duplicate every one. It is closed —
not by changing that public endpoint (which is correctly provenance-blind), but by giving Sunsama a
connector-shaped adapter (`packages/integrations/src/sunsama-connector.ts`) that maps
`SunsamaTask` → `ImportedItem` — the same shape `notion-mapping.ts` and the Google Tasks/GitHub/
Linear adapters already produce — and reconciling each destination workspace's tasks through
`apps/api/src/routes/integration-reconcile.ts`'s `reconcileTasks`, the write path that **does**
stamp `task.source_integration_id` + `task.external_id`.

**This is a `migration`-pattern integration, never a `connector`.** The row `--apply` creates has
`integration.pattern = 'migration'`; `'sunsama'` is not, and must never be, in
`provider-catalog.ts`'s `CONNECTOR_PROVIDER_IDS` — that would wire an OAuth sign-in affordance and
a "Connect" entry in the Connections wizard for a provider that has neither and never will (Sunsama
is a one-time **replace**, not an ongoing **complement** — see `packages/types/src/integration.ts`'s
`IntegrationPattern` doc). `sunsama-connector.ts`'s own top doc has the full boundary rationale.

**Proven, not asserted — run twice.** `pnpm sunsama:import --source=fixture --apply`, run against a
dedicated database, produced [`sunsama-run.json`](./sunsama-run.json): all 7 active fixture tasks
created, `docketMatchedCount: 7`, both unmatched lists `[]`. Run a **second** time against the same
database, every task's `sourceIntegrationId` + `externalId` already matches a `linked` row, so
`reconcileTasks` reports `inserted: 0` for all four workspaces (`alreadyPresent` covers all 7
instead) — zero duplicates, zero mutated pre-existing rows. `apps/api/tests/routes/
integration-reconcile-sunsama.test.ts` asserts exactly this (read → map → route → reconcile → a
second reconcile is a no-op) against the pglite test harness, so it runs in every `pnpm test`
without a database of its own.

**What §5.2 does NOT close** — named honestly, not glossed over:

- **The real author's Sunsama/Docket accounts.** This is proof the _pipeline_ is correct on the
  fixture. It is not a migration of `willieechalmers@gmail.com`'s real Sunsama account — that
  still needs §5.1's human step.
- **A production sample of "10 randomly sampled migrated tasks" (WIL-03's acceptance).** The
  fixture has 7 tasks total, not 10; every one of them is checked (a smaller, honest proxy), but a
  genuine 10-task sample needs a real run.
- **`plannedDate`/`timeEstimateMinutes`/subtasks-as-child-rows** — see §5.3.

### 5.3 A narrower, newly-visible gap: three fields the shared write path still drops

Building the connector adapter surfaced something the field-mapping table (§2) had a _destination_
for but the actual write path never delivers on, for **every** connector/migration adapter, not
just Sunsama's: `ImportedItem` (the port every adapter maps into) has `title`/`body`/`completed`/
`dueDate` and provenance — no `startDate`, no `estimateMinutes`, no parent-task linkage. So
`reconcileTasks`'s `insertLinked`/`applyPull` never write `task.startDate` or
`task.estimateMinutes` from an import, and a Sunsama subtask never becomes its own child `task` row,
even though `mapSunsamaTask` computes all three correctly. They are not silently lost — every
mapped task's `notWrittenByReconciler` (in `sunsama-connector.ts` and the run report) names exactly
which of the three it had and what the value was — but they are not persisted by `--apply` today.

Closing this means extending the shared `ImportedItem`/`reconcileTasks` contract itself, which is
out of scope here (`integration-reconcile.ts` is off-limits to this change, and the fix benefits
every connector, not just Sunsama — it belongs to whoever owns that shared contract next).

### Running what exists

```sh
# prove the pipeline offline — no accounts, no network, no writes
pnpm sunsama:import --source=fixture

# apply it for real, against a dedicated database (see below — NOT the shared dev-stack one)
DATABASE_URL="pglite://.data/sunsama-fixture-proof" pnpm --filter @docket/db db:migrate  # once
DATABASE_URL="pglite://.data/sunsama-fixture-proof" pnpm dotenv -e .env.local -- \
  pnpm sunsama:import --source=fixture --apply

# dry-run against the real account once SUNSAMA_MCP_TOKEN is set
pnpm sunsama:import --source=live
```

### 5.4 An operational hazard this feature's own development ran into

PGlite (the embedded local database behind `DATABASE_URL=pglite://...`) is a **single-process**
engine. Two Node processes opening the same on-disk store at once is not merely unsupported, it is
actively destructive: during this feature's own development, running `--apply` against the
interactive dev stack's live `pglite://.data/docket` **while `./scripts/dev-stack.sh` was also
running against it** corrupted the store badly enough that even `drizzle-kit migrate` could no
longer open it — every query, including the dev API's own background scheduler tick, failed with
`RuntimeError: Aborted()`. Recovering meant `pnpm db:reset`, which wipes the _entire_ shared
database, including any other agent's dev-stack data.

`scripts/import-sunsama.ts`'s `--apply` path now refuses to run at all without an explicit,
non-shared `DATABASE_URL` (`assertSafeApplyDatabase`) — it will not default to `.env.local`'s value,
and it refuses that exact value by name. Point it at a dedicated database instead (as shown above).
This is a general PGlite hazard, not specific to this tool: **anything** that opens
`pglite://.data/docket` in a second process while the dev stack is running risks the same outcome.

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

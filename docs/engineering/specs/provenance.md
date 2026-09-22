# Docket — Provenance Spec

> **Area:** `provenance` · **Contract:** `domains/work/src/contracts/provenance.ts` · **Recorder:** `apps/api/src/lib/provenance/context.ts` + `apps/api/src/mcp/change-set.ts`

Provenance answers "where did this come from?" for every task, project, program, and initiative
change. Docket records it on every write and shows it only when someone asks.

---

## 1. The model

Every recorded change has three parts.

| Part          | Meaning                                           | Stored as                                        |
| ------------- | ------------------------------------------------- | ------------------------------------------------ |
| **Authority** | The member whose permissions the change ran under | `change_set.actor_id`; the entity's `created_by` |
| **Performer** | Who did the typing                                | `origin.performer`                               |
| **Channel**   | The door the change came through                  | `origin.channel` (+ `origin.surface`)            |

Authority never changes meaning. Athena and third-party MCP clients act with their owner's
authority, so `created_by` keeps naming that person; the performer is what names Athena or the
client. A registered agent has its own actor, and that actor is both the authority and the
performer.

### Channels

| Channel  | Meaning                                            | Surfaces                                                                               | Performer                       |
| -------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------- |
| `app`    | A person working in the Docket app                 | `home`, `inbox`, `detail`, `list`, `canvas`, `plan`, `calendar`, `capture`, `settings` | `person`                        |
| `athena` | Athena working for its owner                       | `chat`, `session`, `phone`                                                             | `athena`                        |
| `mcp`    | An MCP client (Claude, Cursor, a registered agent) | —                                                                                      | `agent`, named by the client    |
| `api`    | The REST API with an OAuth token                   | —                                                                                      | `agent`, named by the client    |
| `email`  | Mail to the Athena inbox, accepted as work         | —                                                                                      | `athena`                        |
| `sync`   | A connected tool's ongoing sync                    | —                                                                                      | `docket`, named by the provider |
| `import` | A one-time import from a connected tool            | —                                                                                      | `docket`, named by the provider |
| `rule`   | A schedule or rule Docket runs                     | `recurrence`, `routing`, `cycle_roll`, `calendar_link`, `time_anchor`                  | `docket`                        |

`sync` and `import` are separate channels because one-time import and ongoing sync are separate
product surfaces.

### Client names

An OAuth client is named by the `name` it registered with. Docket validated that name when the
client registered, and it is the name the person saw on the consent screen. A client registered
without one is named by the host of its client id, or the id itself. The `clientInfo` a client
declares on MCP `initialize` is its own claim, so it never names the client; Docket keeps it on
`mcp_session` (trimmed and capped at 100 characters) and records only its version.

---

## 2. Recording

`ChangeOrigin` (the `change_set.origin` column, and `audit_event.origin`) is a superset of the
first version. `tool`, `client`, `sessionId`, `planId`, and `planOwnerUserId` keep their
top-level spelling because phone call summaries, Athena undo, and canvas replay query them. New
rows carry `v: 2`, `channel`, and `performer`.

Entry points declare provenance once, with `runWithProvenance`:

| Entry point                            | Declares                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| REST middleware (`rest-middleware.ts`) | `app` + the `Docket-Surface` header for a session; `api` + the client for an OAuth token                    |
| `registerTools` (`mcp/tools.ts`)       | `mcpProvenance(ctx)` for a registered agent or the bearer client; Athena's toolbox passes `athena` / `chat` |
| Phone tools (`voice-tools.ts`)         | `athena` / `phone` with the voice session id                                                                |
| Workers and jobs                       | `rule`, `sync`, `import`, or `email`                                                                        |

Writers call `recordChangeSet*` and supply only the operation name and any session or plan link;
`originFor` merges them with the declared base. A change recorded outside any scope throws
`MissingProvenanceError`, so a new write path cannot silently skip provenance.

`readOrigin` normalizes any stored origin. First-version rows map by what they recorded: the
`athena-phone` client, the `canvas` and `plan_commit` tools, an MCP client name, or an Athena
session id. A first-version row with none of those returns null and renders nothing.

---

## 3. Reading (planned)

> Not built yet: this section and §4 describe the read endpoint and presentation that land in
> the following slices of PROVENANCE-001 (see `docs/WORKLOG.md`). Recording (§1–§2) is live.

`GET /v1/orgs/{orgId}/provenance/{kind}/{id}` will return the change that created the entity, the
most recent change, and how many recorded changes touched it. The web app fetches it only when a
person opens the origin card.

Task activity rows will carry a compact `origin` so the feed can name the real performer.

---

## 4. Presentation (planned)

Provenance stays out of the way. It is never a badge, a column, or a banner.

- **The Created row** on task, project, and initiative pages still reads just the date. Hovering
  or focusing it opens the origin card: who created it, who last changed it, and how.
- **The activity feed** names the performer and shows their avatar kind, so an MCP change reads
  "Claude Code set Status to Done". The channel detail sits in the timestamp's tooltip. Rows a
  person made in the app look exactly as before.
- **Show origin** is an action on every task, project, and initiative, reachable from the
  command palette and the right-click menu. It opens the same card.

Display labels come from one formatter (`apps/web/src/lib/provenance/format.ts`):

| Recorded                    | Shown                 |
| --------------------------- | --------------------- |
| `app`, performer = you      | You                   |
| `app`, performer = teammate | Their name            |
| `athena` / `chat`           | Athena · Chat         |
| `athena` / `phone`          | Athena · Phone call   |
| `mcp`, client Claude Code   | Claude Code · for You |
| `api`, client X             | X · API               |
| `email`                     | Athena · From email   |
| `sync`, Linear              | Linear · Synced       |
| `import`, Notion            | Notion · Imported     |
| `rule` / `recurrence`       | Repeats               |
| Unknown or pre-provenance   | Nothing (date only)   |

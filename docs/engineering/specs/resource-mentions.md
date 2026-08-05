# Resource mentions

> **Status**: Implemented (rich-text surfaces). Plain-text surfaces pending.
> **Audience**: Anyone adding a structured source, changing the editor, or touching the
> `mention` / `external_resource` tables.
> **Read this before**: adding a provider, changing how prose is stored, or changing the picker.

Typing `@` anywhere opens a picker that searches Docket entities and the user's connected
sources. The result inserts as an inline chip that navigates on click and previews on hover.
Every referenced thing carries structured metadata, and anything referenced inside an entity's
prose appears in that entity's Resources tab without anyone attaching it.

## How a mention is stored

An ordinary Markdown link carrying a machine ref in the link-title slot:

```
[Q3 launch plan](https://www.notion.so/Launch-1f2e… "docket:v1:external")
[Platform rebuild](/orgs/01JX…/projects/01JY… "docket:v1:project:01JY…")
```

Descriptions stay Markdown strings, so nothing about storage changed. The title slot is native
Markdown that renderers we do not control silently drop, so a digest, an export, or an agent
prompt still shows a working link. Where Docket controls rendering, the marker distinguishes a
deliberate mention from a URL the author typed — the two get different treatments.

The grammar lives in `packages/types/src/mention.ts` because two implementations must agree on
it byte for byte: the Tiptap node serializing on the client, and `reconcileMentions` parsing on
the server.

## The three tables

Split by who is allowed to see what, not by technology.

| Table               | Scope                                            | Written when                                |
| ------------------- | ------------------------------------------------ | ------------------------------------------- |
| `external_resource` | Org, deduped by `(organizationId, canonicalKey)` | A resource is disclosed into shared content |
| `mention`           | Org                                              | Derived from prose after every write        |
| `mention_usage`     | Per user, no metadata columns                    | A reference is inserted                     |

`external_resource` is org-scoped because mentioning a file in a project description _is_ telling
everyone who can read that description what the file is called. Picker results are never
persisted — searching your own Drive discloses nothing.

`mention_usage` deliberately holds only a key and counters. Recency is a personal signal; a title
is a disclosure. Keeping them apart means ranking can be personal without one person's picker
history revealing what they can see.

`mention` carries two CHECK constraints enforcing the XOR between its entity and external arms, so
an invalid row cannot exist. Its `(organizationId, targetEntityKind, targetEntityId)` index gives
backlinks with no second table.

## Reconcile is a projection, not a log

`reconcileMentions` re-reads committed prose and makes the edge set match. It rides
`enqueueSearchUpsert` in `apps/api/src/search/write-through.ts`, for the reason that seam already
documents: a write path that forgets is indistinguishable from prose with no mentions, and there
are around forty write paths.

Three properties follow from being a projection rather than a delta:

- Racing writes each derive the same answer from the same committed text.
- A reconcile failure cannot roll back a legitimate write, because it runs post-commit.
- A missed reconcile self-heals on the next write.

Link extraction uses `marked`'s lexer, pinned to the major `@tiptap/markdown` uses. A regex would
match inside fenced code blocks, so a document _about_ Markdown would grow phantom mentions
nobody could delete.

## Adding a structured source

Two steps. Neither touches URL matching, canonicalization, dedupe, unfurl routing, or any UI.

**1. Declare it** in `RESOURCE_PROVIDERS` (`packages/types/src/resource-provider.ts`): id, label,
the hosts it owns, the URL shapes that identify one of its resources, and whether metadata needs
the viewer's credential. Add the id to the `ResourceProvider` enum and to the `resource_provider`
Postgres enum — a test asserts those two agree, so forgetting the migration fails a test rather
than an insert.

Declaring a source is worth doing before you can search it. Recognition alone means a pasted link
is labelled correctly, deduped by its real document id rather than by URL string, and parked as
needing a connection instead of being fetched anonymously into a sign-in page titled "Sign in".

**2. Implement `ResourceSearch`** (`packages/integrations/src/resource-search.ts`) on the
provider client, add the id to `RESOURCE_SEARCH_CAPABLE_PROVIDERS`, and add a fixture block so the
build and tests need no account. `RealConnector.asResourceSearch()` narrows structurally, so the
manifest and the code cannot drift; `capability-manifest`-style tests assert they agree.

Host matching is exact or dot-bounded, so `contoso.sharepoint.com` matches and
`sharepoint.com.attacker.example` does not. That boundary is what keeps a lookalike host from
being handed a viewer's credential.

## How the pieces are wired

A domain write publishes one event to `EntityWriteBus`
(`apps/api/src/events/entity-write-bus.ts`) and knows nothing about who listens. Three subscribers
are registered at `entity-write-registry.ts`: the search index, the mention reconciler, and the MCP
notifier. Adding a listener touches that registry and the new subscriber, never the ~40 call sites
that write entities.

Subscribers are isolated. One that throws is reported by name and the rest still run, because a
failing notification is a display bug while failing the caller's write would be a lost edit. They
run concurrently, and `publish` is awaited so someone who saves a description and switches tabs
does not race the reconcile.

Storage is three ports in `mention-ports.ts` — mention edges, shared resource rows, subject prose —
each naming an operation the domain performs rather than exposing a query builder, so a caller
cannot reach past the port and write its own `WHERE`. `drizzle-mention-storage.ts` is the only
module in the slice that knows tables exist. The edge write is `replaceForSubject`, because the
domain operation _is_ a convergence: the caller has derived the complete truth and the store's job
is to match it.

Reaching a connected source goes through `ConnectorGateway` (`connector-gateway.ts`), which exists
because the alternative was a service importing from `../routes/`. The port says "give me a
resource search for this provider on behalf of this actor, or tell me why you cannot" and says
nothing about tokens or OAuth.

The payoff is `reconcile-mentions-in-memory.test.ts`: twelve domain rules verified in well under a
second with no database, leaving the companion suite over the real adapter to prove the SQL.

## Two independent permission gates

A forged `docket:` marker naming another org's task is refused at **write** time: reconcile proves
the target exists in the writing org before creating an edge. Visibility is re-checked at **read**
time, because a grant can be revoked after prose is written. Neither gate alone is sufficient.

An inaccessible entity hydrates to `accessible: false` carrying no other field — not a blanked
title, because a card rendering "Restricted task" still confirms the id names something real.
Absence and denial are indistinguishable, so hydrate cannot be used to probe for ids.

Everything permission-filtered goes through `searchWorkspace`, `loadRecentDocuments`, or
`loadVisibleDocuments` in `apps/api/src/search/query.ts`. **Do not write a second `WHERE` over
`search_document`.** A mention card is exactly the surface where a subtly different permission
check would leak a title, and nothing in the types would catch it.

## Unfurling

Runs off the write path: `reconcileMentions` creates rows `pending` and
`POST /internal/cron/unfurl-resources` fills them in, so saving a description never waits on a
third-party fetch. The lease lives on the resource row, so one row is one URL is one job.

A source whose registry entry says `resolution: 'credentialed'` is never fetched anonymously — it
is parked as `requires_connection` until its adapter can resolve it with the owner's credential.

Generic web unfurling goes through the hardened boundary in
`packages/integrations/src/safe-fetch.ts` (implemented in `mcp-network.ts`): HTTPS only, every
non-public address rejected, connect-time address pinning against rebinding, per-hop redirect
re-validation, and bounds on time and bytes. **Do not write a second SSRF guard.**

## The picker

Two requests, not one. The local wave answers from the search index and can never be delayed by a
third-party outage; the external wave fans out under a 1200 ms per-source deadline. The client
fires both and merges, which is what lets results stream in without the list going blank.

A provider failure is data, never an HTTP error: `/mentions/external` returns 200 with a closed
status enum per source, so one degraded app never empties a menu someone is reading. Provider text
never reaches a Docket surface.

Rows group by entity kind with a per-group cap, so a query matching eight tasks cannot bury the
one project that also matched. The anti-jump rules — stable active key, external groups always
last, highlight pinned once the user has arrowed — live as one pure function in
`mention-merge.ts` so they are testable rather than aspirational.

## Known gaps

- Plain-text surfaces (comments, updates, Today capture, Athena composers) do not have the picker
  yet. Rich text does.
- Drive search needs Google verification plus a CASA Tier-2 assessment before a real account can
  grant `drive.metadata.readonly`. Everything builds and tests on fixtures until then.
- Thumbnails need content scope, so hovercards show icons only.
- OneDrive, SharePoint, Notion, Dropbox, Box, Figma, and Confluence are recognized by URL but have
  no search adapter yet.

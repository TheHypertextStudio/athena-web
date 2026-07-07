# Discord Observation — mentions in the firehose, against a hostile transport

> **Status**: implemented; Phase 1 serverless seam, identity attribution, firehose UI hooks, and
> Phase 2 Gateway relay are in-tree. Live Discord test-guild smoke remains the deployment
> acceptance check, not an implementation blocker.
> **Extends**: [`activity-feed.md`](./activity-feed.md) — this is one more tool on the canonical
> Event substrate, plus the two things Discord forces that Slack did not.
> **Related decisions**: `DECISIONS.md` → "Discord message mentions require a Gateway relay" and
> "External-mention attribution resolves participants to Docket users".

## What it is, for a person

You get @-mentioned in a Discord server the same way you get mentioned in Slack — and you want
both to land in the _one_ place that already shows everything concerning you: your personal
Stream ("you were mentioned in Slack", now also "you were mentioned in #eng on Discord"). No new
surface, no second inbox. Open the feed, filter to **Mentions**, and every place your name came
up across every connected tool is right there, newest first.

Two smaller promises come with it:

- **It's _your_ mentions, not the workspace's.** A Discord mention surfaces for the specific
  person who was named (or is in the named role, or was replied to, or was DM'd) — resolved to
  their Docket account — not blasted to whoever happened to connect the integration.
- **Docket's spine doesn't bend for Discord.** Discord is an unusually hostile source to observe
  (see below), but the feed, the router, the pagination, and the assistant don't know or care.
  All the awkwardness is quarantined in one small, replaceable piece.

## The platform limitation (the whole reason this spec exists)

Slack was easy: its Events API **pushes every message over HTTP** to a signed endpoint, so a
mention arrives as a stateless POST that a serverless function verifies and files. Docket's entire
ingestion spine is built on that shape — thin HTTP edge → write-ahead inbox → cron drain — with
**no persistent processes** (Vercel Functions, `env-vars-only` deploy, DB-as-queue).

Discord does not offer that shape for what we need:

| Discord surface       | Delivery                 | Carries normal `@you` in a message?                                      |
| --------------------- | ------------------------ | ------------------------------------------------------------------------ |
| Interactions endpoint | HTTP POST (Ed25519)      | No — only slash commands / components                                    |
| Webhook Events (app)  | HTTP POST (Ed25519)      | No — app-lifecycle events only                                           |
| **Gateway**           | **persistent WebSocket** | **Yes — `MESSAGE_CREATE`, with the privileged `MESSAGE_CONTENT` intent** |

So the one capability this feature is _about_ — seeing ordinary message mentions — is available
**only over a long-lived Gateway socket**, which a serverless function fundamentally cannot hold
open. This is the architectural tension, stated plainly: **the product goal lives on the exact
transport our platform can't run.**

### How we resolve it — a transport-agnostic edge + a quarantined relay

The ingest edge (`apps/api/src/routes/ingest.ts`) already doesn't care _who_ POSTs to it — it
verifies, routes, and files an `inbound_event`. That is the lever. We keep Docket's brain
serverless and push the one unavoidable persistent thing to the outside:

```
   Discord Gateway (WebSocket, MESSAGE_CONTENT intent)
            │  MESSAGE_CREATE
            ▼
   ┌──────────────────────────┐        Docket stays serverless
   │  discord-relay (sidecar) │        ───────────────────────────────
   │  · holds the socket      │        · no socket, no queue, no worker
   │  · expands role/reply/DM │        · one more Observer Adapter
   │  · NO business logic     │        · the existing cron drain
   └───────────┬──────────────┘
               │  HTTP POST  (Docket-issued ingest token)
               ▼
   POST /internal/ingest/discord/:token  ──►  inbound_event  ──►  drain  ──►  event ──► you
        (peer of Discord's own webhook POSTs; different auth)
```

The relay is **just another event producer** — architecturally a peer of Discord's own servers,
which also POST to this edge. It is an **Anti-Corruption Layer**: it speaks the Gateway protocol
so nothing downstream has to, and it emits the same canonical-ish payload the HTTP path does. It
holds **no state that matters** — Docket's `inbound_event` inbox is the source of truth, so a
relay crash/reconnect loses nothing but a few seconds of latency. And it is **replaceable**: the
day Discord ships message events over HTTP Webhook Events, the relay is deleted with _zero_ core
changes.

Two inbound authentications for one provider, by design:

- **Discord-direct HTTP** (interactions, webhook events, and the setup handshake): **Ed25519**
  over `timestamp + rawBody`, headers `x-signature-ed25519` / `x-signature-timestamp`, verified
  against the app's **public key**. The setup handshake is a `type:1` PING answered with a
  `type:1` PONG (the analog of Slack's `url_verification` challenge).
- **Relay traffic**: a **Docket-issued opaque ingest token** in the URL
  (`event_subscription.ingestToken`, already in the schema for exactly "providers without
  payload-based routing"). Relay POSTs are our own trusted component, not Discord-signed, so they
  carry the token instead of an Ed25519 signature.

## The mention-attribution seam (the part that isn't just "add an adapter")

Here is the non-obvious gap. Today the external drain routes an event to recipients with only
`{ organizationId, kind, entity, ownerUserId }` (`event-sync.ts` → `routeAndWriteRecipients`).
The `ownerUserId` is the **integration owner** — whoever connected the tool. So a Slack "mention"
today notifies _that one person_, regardless of who was actually named. The normalized
`participants` on the draft are stored for display but **never used for routing**.

"See everywhere **you** are mentioned" cannot be built on that. It needs the router to resolve the
_actually-mentioned_ people to Docket users. The substrate already anticipates this — `ActorRef`
reserves a `docketActorId` enrichment slot ("resolve an external ref to its Docket twin later;
null today"). We fill it in the drain:

1. **Identity link** (Phase 1B). "Connect Discord" (per-user OAuth2, `identify` scope) stores the
   Discord snowflake ↔ Docket user mapping. We **reuse Better Auth account linking** — its
   `account` table already keys `(providerId, accountId) → userId`, and Discord's `accountId`
   _is_ the snowflake. No new table, no new discriminator.
2. **Resolution in the drain** (Phase 1C). After `normalize()`, for each
   `draft.participants[].externalId` in this `sourceSystem`, look up the linked Docket user, and
   pass the resolved ids as a new `participantUserIds` on the routable event.
3. **Routing** (Phase 1C). `resolveRecipients` adds each `participantUserIds` entry as a recipient
   with `reason='mention'` — a small addition that **mirrors the existing `ownerUserId` fallback**
   (already-resolved user id in, one relevance reason out), not a rewrite of the resolver.

This seam is deliberately **provider-neutral infrastructure**: any source whose observer emits
mentioned `participants` _and_ whose users link that identity (via Better Auth) gets per-user
mention routing for free. Today Discord is the first (and only) such source — the Slack and Linear
observers emit no `participants` (Slack has no OAuth identity link at all; Linear's webhook only
carries the acting user), so they are **not** retroactively upgraded; their mentions still fall
back to the integration owner until their observers are taught to emit participants. The seam is
**testable through the mock observer** (its `participants` fixture) without any live Discord infra.

## Mention scope (v1) and where each kind is expanded

The feature captures four kinds of "you were mentioned", but the substrate only ever sees a flat
list of mentioned Discord user ids — the **expansion happens in the relay**, upstream, so Docket's
model stays simple:

| Kind           | Discord signal on `MESSAGE_CREATE` | Relay expands to                                          |
| -------------- | ---------------------------------- | --------------------------------------------------------- |
| Direct `@user` | `mentions[]`                       | those user ids                                            |
| `@role`        | `mention_roles[]`                  | members of those roles (from guild state the relay holds) |
| Reply          | `referenced_message.author`        | the replied-to author's id                                |
| DM             | channel `type = DM`                | the DM recipient's id                                     |

By the time it reaches Docket, all four are just `participants` on the draft with
`kind='mention'`. The attribution seam then keeps only those who have linked their Discord account
(others simply get no recipient row — the integration-owner fallback still applies for org-level
visibility).

## Bounded contexts (the relay sits _upstream_ of the substrate, never inside it)

```
 discord-relay (its own deployable; no @docket/db, no business logic)
        │  HTTP + ingest token
        ▼
 Ingestion (raw)                     ← activity-feed.md substrate, unchanged in shape
   ingest.ts (Ed25519 | token) ─► inbound_event ─► event-sync drain
        │  observer-discord (Adapter) + Better Auth account link (attribution)
        ▼
   event log ─► routing.ts (+participantUserIds) ─► event_recipient ─► your Stream
```

One-way dependencies hold: the substrate never imports the relay; the relay never imports the
substrate (it only knows a URL + a token). The assistant remains a Phase-2 _consumer_ of the feed,
untouched — Discord ingestion produces canonical events and nothing else.

## Design patterns (what's reused, what's new)

| Seam                                   | Pattern                             | Where                                                                                                       |
| -------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Discord source translation             | **Adapter**                         | `packages/boundaries/src/real/observer-discord.ts` behind the `Observer` port (mirrors `observer-slack.ts`) |
| Picking the observer by provider       | **Strategy (registry)**             | `select.ts` `OBSERVER_FACTORIES['discord']`                                                                 |
| `normalize`: typed detail → `generic`  | **Chain of Responsibility**         | the Discord detail-builder chain, ending in `genericDetail`                                                 |
| Gateway → canonical ingest             | **Anti-Corruption Layer / Gateway** | `services/discord-relay` (Phase 2)                                                                          |
| Relay → org routing without payload id | **token routing**                   | `event_subscription.ingestToken` + `/discord/:token`                                                        |
| External participant → Docket user     | **enrichment (reserved slot)**      | drain resolution via Better Auth `account` (fills `ActorRef.docketActorId` intent)                          |
| Mentioned users → recipients           | **Strategy (registry)**             | `routing.ts` `resolveRecipients` (+`participantUserIds`)                                                    |

Deliberately **not** built: a Discord-specific events table, a `provider`-string discriminator, a
bespoke identity table, or any assistant coupling. Each of those would re-introduce exactly the
"discriminator-is-not-a-boundary" anti-pattern the feed was re-architected to remove.

## Adding Discord — the leaves (Phase 1)

Per `activity-feed.md`'s "adding a new tool touches only leaves", plus the two Discord-specific
additions (Ed25519 auth mode, attribution seam):

1. **Types** — `SourceSystemKind += 'discord'`; a `discord.message` arm on the `EventDetail` union
   (`packages/types/src/event.ts`). `EventKind` (message/mention/reaction) and
   `CanonicalEntityKind` (thread/message) already suffice.
2. **Schema** — `'discord'` on the `sourceSystem` pgEnum (`packages/db/src/enums.ts`) — a Drizzle
   migration, following the `0015_whole_bloodaxe.sql` precedent that added `slack`.
3. **Observer Adapter** — `ObserverProvider += 'discord'`; `RealDiscordObserver` (Ed25519 verify,
   PING→PONG, guild-id routing, mention/message/reaction normalize with a `discord.message` detail
   chain); mock header + fixture.
4. **Composition** — `DISCORD_PUBLIC_KEY` on `BoundaryEnv` + `observerSecret()` + the
   `OBSERVER_FACTORIES['discord']` entry (`select.ts`); the env var in `@docket/env`.
5. **Ingest** — `.post('/discord', …)` + the PING branch; `PROVIDER_SOURCE_SYSTEM['discord']` in
   the drain; `'discord'` in `OBSERVER_PROVIDERS`.
6. **Attribution seam** — `participantUserIds` on `RoutableEvent`; the drain's account-link
   resolution (`identityProviderForSource` + `resolveParticipantUserIds`); the `resolveRecipients`
   wiring. Provider-neutral infra; Discord is its first (currently only) consumer.
7. **Identity** — Discord as a linkable Better Auth OAuth provider (`identify` scope); the live
   catalog entry in `identity-providers.ts` (its connectability is read from `/v1/config`).
8. **Firehose UI** — render the `relevance='mention'` "Mentioned you" chip (row + drawer); the
   Discord source badge + Source-filter option. The mentions view is the existing **Kind → Mention**
   toolbar filter (`event.kind='mention'`): `relevance` lives on `event_recipient` (personal-feed
   only) and toolbar predicates compile against `event` columns shared by both scopes, so a
   `relevance` catalog filter would break the org firehose — the Kind filter is the scope-safe path.

## Phase 2 — the Gateway relay

`services/discord-relay/` (new standalone worker, deployed to an always-on host — _not_ Vercel):
a Gateway client with the `GUILDS` + `GUILD_MESSAGES` + `MESSAGE_CONTENT` intents, the role/reply/
DM expansion above, and a single outbound: POST to `/internal/ingest/discord/:token`. Stateless
with respect to correctness (resumes on reconnect; the inbox is the ledger). The
token-routed ingest variant and token issuance (`event_subscription.ingestToken`) are the only
core additions Phase 2 makes.

## Verification

1. **Attribution seam** (`event-sync-attribution.test.ts`): seed a linked Better Auth `account`
   (`providerId='discord'`, `accountId=<snowflake>`) for a non-owner user; drive a `discord` inbound
   event whose normalized draft carries that snowflake as a participant (via the mock observer's
   `participants` fixture); run `sweepInboundEvents`; assert an `event_recipient` row with
   `reason='mention'` for the linked user — and that an _unlinked_ snowflake yields no recipient.
   Proves the hardest layer with zero live Discord infra.
2. **Discord leaves**: `observer-discord.test.ts` (Ed25519 verify, PING handshake, route,
   normalize→mention+participants) and `ingest-discord.test.ts` (PING→PONG, signed→routed, bad
   sig→400) against the mock adapter.
3. **UI**: the personal Stream with the **Kind → Mention** filter shows the "Mentioned you" chip +
   Discord badge (design-review both widths/themes).
4. **Gates**: `pnpm typecheck && pnpm lint && pnpm test`; rebuild `@docket/api` dist so web RPC
   types pick up `discord`.
5. **Phase 2 (when built)**: relay against a test guild → `@mention` a linked user → event in the
   firehose within the drain interval.

## Out of scope (v1)

Discord threads as first-class entities beyond `entity.kind='thread'`; posting _into_ Discord;
reactions-as-mentions; edit/delete sync; historical backfill (the feed is forward-only from
connect time).

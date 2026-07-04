# @docket/discord-relay

The one always-on process Docket's serverless core can't be. It holds the Discord **Gateway**
WebSocket (the only place ordinary message mentions are available), expands `@role`/reply/DM
mentions into concrete user ids, and forwards mention-bearing messages to Docket's token-routed
ingest edge. It holds **no business logic** and **no Docket database access** — Docket's
`inbound_event` inbox is the source of truth, so a crash/reconnect loses nothing.

See the architecture in [`docs/engineering/specs/discord-observation.md`](../../docs/engineering/specs/discord-observation.md).

## How it fits

```
Discord Gateway ──MESSAGE_CREATE──▶ discord-relay ──HTTP (ingest token)──▶ POST /internal/ingest/discord/:token ──▶ Docket
```

The relay is architecturally a **peer of Discord's own webhook POSTs** — Docket's ingest edge
doesn't care who POSTs, only that the ingest token is valid. If Discord ever ships message events
over HTTP Webhook Events, this whole service is deleted with zero changes to Docket's core.

## Run

Deploy to an always-on host (Fly / Railway / a container) — **not** Vercel (a serverless function
can't hold a socket open). Requires Node ≥ 24.15 (uses the global `WebSocket` + `fetch`; no runtime
dependencies).

```sh
DISCORD_BOT_TOKEN=…        # the bot whose Gateway session this holds (needs the MESSAGE_CONTENT + GUILD_MEMBERS privileged intents enabled in the Discord developer portal)
DOCKET_INGEST_URL=https://docket-api.hypertext.studio/internal/ingest/discord   # the API origin (API_URL) + this path
DOCKET_INGEST_TOKEN=…      # the per-integration event_subscription.ingestToken
pnpm --filter @docket/discord-relay start
```

`DOCKET_INGEST_URL` is the **API** origin (the `API_URL` repo variable — `docket-api.hypertext.studio`
in production, `api.docket.localhost` in local dev), _not_ the web app host. The relay appends
`/<DOCKET_INGEST_TOKEN>` to this base to hit `POST /internal/ingest/discord/:token`.

## What's here

| File            | Role                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/expand.ts` | Pure: direct/`@role`/reply/DM mentions → a flat, de-duplicated user-id set (unit-tested).                          |
| `src/relay.ts`  | Pure: build the ingest envelope + forward it (injectable `fetch`, unit-tested).                                    |
| `src/index.ts`  | The Gateway WebSocket wiring — the IO boundary, verified by running against a test guild (excluded from coverage). |

## Out of scope (v1)

Gateway **resume**/sharding (on disconnect it reconnects fresh; Docket's inbox dedups any
re-delivery), and reading DMs between two other users (a bot only receives DMs sent to it).

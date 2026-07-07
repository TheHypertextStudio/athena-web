# Slack Integration — User Mentions, DMs & Threads in the Stream

> **Status**: Implemented (2026-07-02)
> **Depends on**: `activity-feed.md` (the Event substrate), API container + domain package composition

## Product story

An end user clicks **Connect Slack** in Settings → Connections, consents once, and from that
moment every Slack message that **@mentions them**, **DMs them**, or **replies in a thread they
participated in** appears in their personal Stream ("concerns me"), with the same messages in the
org firehose. No workspace admin ceremony, no per-channel bot invites — end-user-first.

## The access-model decision (why user tokens)

Slack's `app_mention` event fires when the **bot** is mentioned — it cannot express "the user was
mentioned". A bot token only receives `message.*` events for channels the bot was invited to, and
never for the user's DMs. The only access model that can fulfil "messages that concern _me_" is a
**user token** (`xoxp-`): the shared Docket Slack app requests only `user_scope`
(`channels:history groups:history im:history mpim:history users:read`) and subscribes to the
matching **user events** (`message.channels/groups/im/mpim`), so Slack delivers every message the
authorizing user can see. The app has no bot user at all (`infra/slack/docket-app-manifest.yaml`).

Token rotation is off → user tokens never expire → no refresh machinery. MVP ingestion never
calls the Slack Web API (events are pushed); the token is captured at connect time for future
enrichment (`users.info`, `chat.getPermalink`) without re-consent.

## Pipeline

```
Slack Events API (user-scope message events)
  → POST /internal/ingest/slack        verify v0= HMAC → route team_id → ALL matching
                                       integrations → ONE inbound_event per org
                                       (externalEventId suffixed :orgId — per-org retry dedup)
  → sweepInboundEvents (drain cron)    observer.normalize() (pure display facts)
                                       + slackMessageFacts(payload) (pure routing facts)
  → slack-relevance resolver           connected-user map + thread_participation lookup
  → concerns nobody? → SKIP            no canonical event; raw payload stays in the WAL
  → concerns someone → event row (org firehose)
                       + event_recipient rows (personal Stream, ranked reason)
                       + publishEvent (SSE)
```

## Identity mapping

One `integration` row per **(org, connecting user)** — no schema change:

| Field                            | Value                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `provider` / `pattern` / `roles` | `slack` / `connector` / `['signal']`                                                                                |
| `externalAccountId`              | the user's Slack id (`authed_user.id`) — partial unique `(org, provider, externalAccountId)` gives one row per user |
| `connection.externalWorkspaceId` | `team.id` — the ingest routing key                                                                                  |
| `connection.credentialsRef`      | `account:slack:<slackUserId>` (token lives in Better Auth `account`, `providerId='slack'`)                          |
| `createdBy`                      | the connecting user's Actor → resolves Slack id → Docket user at drain time                                         |

Connect flow: `GET /:id/connect-url` (slack branch) → `oauth.v2.authorize` with a signed state
(`{integrationId, orgId, userId}`, HMAC envelope in `apps/api/src/lib/oauth-state.ts`) →
`GET /internal/integrations/slack/callback` exchanges the code (`apps/api/src/lib/slack-app.ts`),
upserts the `account` row, stamps the integration `connected`. In `APP_MODE=local/test` the whole
handshake short-circuits to `T-MOCK`/`U-MOCK-…` fixtures — zero Slack account needed.

## Relevance rules (`apps/api/src/consumers/slack-relevance.ts`)

Per connected user, strongest reason wins (merged through `routing.ts`'s single
`RELEVANCE_RANK` via the new `RoutableEvent.externalUserRecipients` input):

1. **`mention`** — message text contains `<@theirSlackId>` (shared regex
   `slackMentionedUserIds` in `packages/integrations`).
2. **`mention`** — the message is an `im`/`mpim` to them. Gated against DM leaks: with several
   connected users the recipient must appear in the payload's `authorizations[].user_id`, or be
   the sole connected non-author. (Full fix: `apps.event.authorizations.list`, follow-up.)
3. **`participant`** — the message has a `thread_ts` and the user previously posted in that
   thread, per the `thread_participation` table (org, provider, workspace, channel, threadTs,
   externalUserId — provider-generic for future Teams/Discord). Participation is recorded for
   every message by a connected user, **including messages skipped as events** (a top-level
   message roots a thread under its own `ts`).

The author never self-notifies. The integration-owner fallback (`ownerUserId`) is suppressed for
Slack — it would fan the whole workspace's traffic to whoever connected it.

**Noise control**: a message that concerns nobody creates **no canonical event** (inbox row →
`skipped`). The org firehose therefore carries relevant Slack traffic, not every message of every
channel; raw payloads remain in `inbound_event` for re-normalization if product wants more later.
The observer additionally drops noise subtypes (`message_changed/deleted`, `channel_join/leave/
topic`, `bot_message`, any `bot_id`) before drafts exist.

## Operational notes

- **3-second ACK deadline**: the WAL ingest (verify → insert → 200) satisfies it, but Cloud Run
  scale-to-zero cold starts are a risk — Slack disables an app's deliveries at >5% failures over
  60 min. Run `docket-api` with `min-instances=1`.
- **Freshness is cron-bound**: personal-feed latency = the event-drain cron interval; consider a
  1-minute cadence. A Cloud Tasks push after ingest is the noted future path.
- **One request URL per Slack app**: prod and dev tunnels need separate apps (same manifest).
  The dev tunnel now routes `^/internal/.*` to the local API (`scripts/tunnel.ts`).
- **Setup**: `pnpm integrations` walks through creating the app from
  `infra/slack/docket-app-manifest.yaml`; env is `SLACK_CLIENT_ID` + `SLACK_CLIENT_SECRET` +
  `SLACK_SIGNING_SECRET` (absent ⇒ Slack simply isn't offered; local mock always works).

## Known follow-ups

- `authorizations:read` + `apps.event.authorizations.list` for exact DM visibility with ≥2
  connected users per workspace.
- Subscribe `tokens_revoked` and flip the integration to `error` on revocation (today it
  surfaces reactively).
- A distinct `direct_message` relevance chip (DMs currently rank as `mention`).
- WAL volume on busy workspaces: loop the sweep within a time budget + prune processed rows.
- Backfill-on-connect (`search.messages`) if the empty-feed-at-connect experience warrants it.

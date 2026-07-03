# Mail Providers

> **Status**: Mail port + Gmail client shipped (M2); cursor storage + the consuming sweep
> shipped (M3/M4); the Outlook/Graph client shipped **dormant** (M6) — fully implemented and
> unit-tested against canned Graph JSON, hidden by `/v1/config` until `MICROSOFT_CLIENT_ID`/
> `MICROSOFT_CLIENT_SECRET` are configured. Lighting up Outlook = env values + a smoke test.
> **Last Updated**: 2026-07-02
> **Owners**: Platform

How Docket talks to mailboxes, provider-agnostically. The mail surface is a **capability**
of the connector boundary — not a per-provider code path — so adding a mail provider means
implementing one interface and updating one manifest, never editing the app layer.

## 1. Capability model: structural, with a declarative manifest

Two artifacts, kept in lockstep by a tripwire test
(`packages/boundaries/tests/real/capability-manifest.test.ts`):

- **Structural capability (real adapters).** A provider is mail-capable iff its provider
  client implements `MailActionsProviderClient`
  (`packages/boundaries/src/real/connector-provider-client.ts`). The connector's
  `asMailActor()` discovers it via the `isMailActionsProviderClient` guard — there are no
  `if (provider === 'gmail')` gates anywhere.
- **Declarative manifest.** `MAIL_CAPABLE_PROVIDERS` (`packages/boundaries/src/ports/mail.ts`)
  is the single set consumed by the mock connector's gate and by app-layer provider
  selection (e.g. which integrations the email-ingest sweep considers). Its sibling
  `WRITE_BACK_CAPABLE_PROVIDERS` (`ports/connector.ts`) plays the same role for task
  write-back — mail and task write-back are separate capabilities.

Provider → client construction is the declarative `PROVIDER_CLIENT_FACTORIES` registry
(`packages/boundaries/src/real/connector.ts`), typed `Record<ConnectorProvider, …>` so
adding a provider to the union is a compile error until every site is filled.

## 2. The mail port (`packages/boundaries/src/ports/mail.ts`)

| Piece                        | Purpose                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MailActions`                | The capability: `listThreads` (incremental ingest), `applyMailAction` (mailbox mutation), `fetchThread` (on-demand render).                                |
| `MailThreadSummary`          | One ingest row: provider-native `threadId`, `subject`, `snippet`, real RFC 5322 `from`, `receivedAt`, optional `rfc822MessageId`, canonical `externalUrl`. |
| `ListThreadsInput`           | `cursor?` (opaque, provider-owned) + required `maxThreads` (caller-supplied bound; no hidden default).                                                     |
| `MailListPage`               | `{kind:'page', threads, nextCursor}` \| `{kind:'cursorExpired'}` — cursor expiry is data, not an exception.                                                |
| `MailAction`                 | Provider-neutral verbs: `archive`, `markRead`, `markUnread`, `trash`, `applyLabel{label}`, `removeLabel{label}`.                                           |
| `MailMessage` / `MailThread` | Render shapes; `MailMessage` carries `rfc822MessageId?`, `inReplyTo?`, `references[]`. Bodies are read-on-demand and **never persisted**.                  |

## 3. Identity semantics (the standards story)

- **`threadId` is provider-native and integration-local**: Gmail's `threadId`; Microsoft
  Graph's `conversationId`. Never compare thread ids across providers.
- **`rfc822MessageId` is the cross-provider identity**: the RFC 5322 `Message-ID` of the
  thread's latest message (Graph surfaces it as `internetMessageId`). Globally unique per
  message and stable across mailboxes — it is the dedup key that stops the same email,
  seen through two providers, from producing two suggestions (persisted on
  `email_suggestion.rfc822_message_id` from M3).
- **Threading headers**: `fetchThread` returns `In-Reply-To` and the `References` chain
  (oldest first) per message, enabling future cross-mailbox conversation stitching.
- **`externalUrl` is captured at listing time**, from the provider (Gmail: derived deep
  link; Graph: `webLink`). The app layer never fabricates provider URLs.

## 4. The cursor protocol

`listThreads` is a resumable, incremental listing:

1. **Cold pull** (no cursor): the provider's recent threads, bounded by `maxThreads`, plus
   a fresh cursor anchoring "now".
2. **Warm pull** (cursor): only changes since the cursor. An unchanged mailbox costs one
   request.
3. **Expiry**: providers invalidate old cursors. The client maps the provider's signal to
   `{kind:'cursorExpired'}`; the caller's documented recovery is **one retry without a
   cursor** (a full re-pull). Idempotent ingest (unique thread + Message-ID indexes) makes
   the re-pull safe.
4. Any other failure throws `ConnectorError` (`auth` / `rate_limit` / `provider`) as usual.

| Provider     | Cursor                                                                                      | Warm endpoint                                                      | Expiry signal                  |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| Gmail        | `historyId` (from `users.getProfile` on cold pulls; the `history.list` response thereafter) | `GET /users/me/history?startHistoryId=…&historyTypes=messageAdded` | HTTP **404** on `history.list` |
| Outlook (M6) | `deltaLink`                                                                                 | `GET /me/mailFolders('inbox')/messages/delta`                      | HTTP **410 Gone**              |

Cursor **storage** is the integration's `sync_state` jsonb (M3), written only while the
sync lease is held (see `integration-sync.md`, M4).

## 5. MailAction → provider mapping

| Verb                         | Gmail (`threads.modify` deltas) | Outlook / Graph (M6)                               |
| ---------------------------- | ------------------------------- | -------------------------------------------------- |
| `archive`                    | remove label `INBOX`            | move message(s) to the `archive` well-known folder |
| `markRead`                   | remove label `UNREAD`           | `PATCH { isRead: true }`                           |
| `markUnread`                 | add label `UNREAD`              | `PATCH { isRead: false }`                          |
| `trash`                      | `POST /threads/{id}/trash`      | move to `deleteditems`                             |
| `applyLabel` / `removeLabel` | add/remove the label id         | read-modify-write of `categories[]`                |

Gmail acts on whole threads; Graph acts on messages, so `MicrosoftProviderClient` fans a
thread action out over the conversation's messages (see its module remarks).
Rule-layer idempotency is the `attachment.lastEmailStateAction` ledger — providers don't
need their own.

## 6. Per-provider clients

| Provider            | Client                                                    | Capabilities                        |
| ------------------- | --------------------------------------------------------- | ----------------------------------- |
| `gmail`             | `real/connector-gmail.ts` `GmailProviderClient`           | base + mail                         |
| `drive`             | `real/connector-google.ts` `GoogleDriveProviderClient`    | base                                |
| `calendar`          | `real/connector-google.ts` `GoogleCalendarProviderClient` | base                                |
| `gtasks`            | `real/connector-google.ts` `GoogleTasksProviderClient`    | base + task write-back + containers |
| `github` / `linear` | existing clients                                          | base                                |
| `outlook` (M6)      | `real/connector-microsoft.ts`                             | base + mail                         |

The mock (`mock/connector.ts`) implements the same capability gates from the manifests and
serves deterministic `MAIL_THREAD_SUMMARIES` fixtures (`fixtures/index.ts`): one actionable
thread from a person and one promotional thread from a no-reply sender, so the ingest
funnel and the dismiss-promotions automation are exercisable with zero external accounts.
`MockConnector.EXPIRED_CURSOR` triggers the `cursorExpired` path offline.

## 7. How to add a mail provider (checklist)

1. **Union**: add the provider to `ConnectorProvider` (`ports/connector.ts`) — the compiler
   then walks you through every `Record<ConnectorProvider, …>` site (API base, factory
   registry, fixtures, provider directory).
2. **Client**: implement `MailActionsProviderClient` in `real/connector-<provider>.ts` —
   `listThreads` (cold + warm + expiry mapping), `applyMailAction` (verb table above),
   `fetchThread` (RFC 5322 headers), plus the base methods. Unit-test request building and
   response mapping against canned JSON via the injected HTTP client.
3. **Manifest**: add the provider to `MAIL_CAPABLE_PROVIDERS`. The tripwire test fails
   until manifest and structure agree.
4. **Fixtures**: add a `MAIL_THREAD_SUMMARIES` entry (at least one actionable + one
   no-reply promo thread) so the mock serves it.
5. **Auth**: map the provider to its Better Auth social provider in `socialProviderId`
   (`apps/api/src/routes/integration-provider.ts`) and add env-gated credentials in
   `packages/auth/src/auth-builder.ts`.
6. **Web**: icon/badge entries in the integrations directory.

Nothing in `apps/api/src/lib/email-to-task/` changes — the sweep operates on the port.

## 8. Testing

- `tests/real/connector-gmail.test.ts` — verb deltas, RFC-header parsing, cold/warm
  listing, 404 ⇒ `cursorExpired`, non-404 still throws.
- `tests/real/capability-manifest.test.ts` — manifest ⇔ structural-shape tripwire across
  all providers.
- `tests/mock/connector-mail.test.ts` — mock gating, fixture listing, expired-cursor
  sentinel, record-only action log.

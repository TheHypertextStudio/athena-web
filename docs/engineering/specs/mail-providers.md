# Mail Providers

> **Status**: Gmail mail port, cursor storage, and the consuming sweep shipped (M2–M4).
> **Last Updated**: 2026-07-02
> **Owners**: Platform

How Docket talks to mailboxes, provider-agnostically. The mail surface is a **capability**
of the connector boundary — not a per-provider code path — so adding a mail provider means
implementing one interface and updating one manifest, never editing the app layer.

## 1. Capability model: structural, with a declarative manifest

Two artifacts, kept in lockstep by a tripwire test
(`packages/integrations/tests/capability-manifest.test.ts`):

- **Structural capability (real adapters).** A provider is mail-capable iff its provider
  client implements `MailActionsProviderClient`
  (`packages/integrations/src/provider-client.ts`). The connector's
  `asMailActor()` discovers it via the `isMailActionsProviderClient` guard — there are no
  `if (provider === 'gmail')` gates anywhere.
- **Declarative manifest.** `MAIL_CAPABLE_PROVIDERS` (`packages/integrations/src/mail.ts`)
  is the single set consumed by the mock connector's gate and by app-layer provider
  selection (e.g. which integrations the email-ingest sweep considers). Its sibling
  `WRITE_BACK_CAPABLE_PROVIDERS` (`ports/connector.ts`) plays the same role for task
  write-back — mail and task write-back are separate capabilities.

Provider → client construction is the declarative `PROVIDER_CLIENT_FACTORIES` registry
(`packages/integrations/src/real-connector.ts`), typed `Record<ConnectorProvider, …>` so
adding a provider to the union is a compile error until every site is filled.

## 2. The mail-actions port (`packages/integrations/src/mail.ts`)

| Piece                        | Purpose                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MailActions`                | The capability: `listThreads` (incremental ingest), `applyMailAction` (mailbox mutation), `fetchThread` (on-demand render).                                |
| `MailThreadSummary`          | One ingest row: provider-native `threadId`, `subject`, `snippet`, real RFC 5322 `from`, `receivedAt`, optional `rfc822MessageId`, canonical `externalUrl`. |
| `ListThreadsInput`           | `cursor?` (opaque, provider-owned) + required `maxThreads` (caller-supplied bound; no hidden default).                                                     |
| `MailListPage`               | `{kind:'page', threads, nextCursor}` \| `{kind:'cursorExpired'}` — cursor expiry is data, not an exception.                                                |
| `MailAction`                 | Provider-neutral verbs: `archive`, `markRead`, `markUnread`, `trash`, `applyLabel{label}`, `removeLabel{label}`.                                           |
| `MailMessage` / `MailThread` | Render shapes; `MailMessage` carries `rfc822MessageId?`, `inReplyTo?`, `references[]`. Bodies are read-on-demand and **never persisted**.                  |

## 3. Identity semantics (the standards story)

- **`threadId` is Gmail's provider-native, integration-local thread id.** Never compare
  thread ids across Gmail integrations.
- **`rfc822MessageId` is the cross-mailbox identity**: the RFC 5322 `Message-ID` of the
  thread's latest message. It is globally unique per message and stable across mailboxes.
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

| Provider | Cursor                                                                                      | Warm endpoint                                                      | Expiry signal                  |
| -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| Gmail    | `historyId` (from `users.getProfile` on cold pulls; the `history.list` response thereafter) | `GET /users/me/history?startHistoryId=…&historyTypes=messageAdded` | HTTP **404** on `history.list` |

Cursor **storage** is the integration's `sync_state` jsonb (M3), written only while the
sync lease is held (see `integration-sync.md`, M4).

### 4.1 Never advance a cursor past un-fetched data

Both clients bound their **walk** by `maxThreads`, not just the returned list, and only
persist a cursor that represents real forward progress:

- **Gmail**: `historyId` on a `history.list` response is the mailbox's _current_ history
  record, not a per-page resumption token. The client advances the cursor only once the
  walk has fully drained (no `nextPageToken` left); if `maxThreads` caps the walk mid-page,
  the cursor is left unchanged so the next sweep resumes the same `startHistoryId` window
  (re-fetching a few already-seen threads is harmless — ingest dedups downstream) instead of
  skipping the un-fetched, older history forever.
  even if more delta pages remain. The client always returns a real resumption cursor: the
  page's `@odata.nextLink` when capped mid-walk (Graph's own pagination token — safe to
  replay), or the terminal `@odata.deltaLink` once the walk genuinely drains. A backlog
  spanning more delta pages than the per-call budget (`MAX_DELTA_PAGES`) also resumes from
  the last page's `nextLink` rather than an empty cursor — the previous behavior silently
  discarded the walk's progress and reprocessed the same window on every sweep, forever.

Getting this wrong reads as a passing sync (no error, no `cursorExpired`) while quietly and
permanently dropping mail — the cursor `MailListPage` returns must always be honest about
what was actually consumed.

## 5. MailAction → provider mapping

| Verb                         | Gmail (`threads.modify` deltas) |
| ---------------------------- | ------------------------------- | ----------------------------------- |
| `archive`                    | remove label `INBOX`            |
| `markRead`                   | remove label `UNREAD`           | `PATCH { isRead: true }`            |
| `markUnread`                 | add label `UNREAD`              | `PATCH { isRead: false }`           |
| `trash`                      | `POST /threads/{id}/trash`      | move to `deleteditems`              |
| `applyLabel` / `removeLabel` | add/remove the label id         | read-modify-write of `categories[]` |

Gmail acts on whole threads.
Rule-layer idempotency is the `attachment.lastEmailStateAction` ledger — providers don't
need their own.

## 6. Per-provider clients

| Provider            | Client                                                    | Capabilities                        |
| ------------------- | --------------------------------------------------------- | ----------------------------------- |
| `gmail`             | `real/connector-gmail.ts` `GmailProviderClient`           | base + mail                         |
| `calendar`          | `real/connector-google.ts` `GoogleCalendarProviderClient` | base                                |
| `gtasks`            | `real/connector-google.ts` `GoogleTasksProviderClient`    | base + task write-back + containers |
| `github` / `linear` | existing clients                                          | base                                |

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

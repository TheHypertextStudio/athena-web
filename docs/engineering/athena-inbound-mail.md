# Athena's native email channel

Athena has a dedicated receiving address independent of connected Gmail or Outlook accounts. The
owner can enable automatic replies to their verified account email in `/athena/mail`. Email to
other recipients requires approval of the exact message in signed-in Docket. Closing Docket does
not stop receiving, execution or sending: scheduled server work owns these operations.

## Addresses and enrollment

An address is `{key}@{ATHENA_INBOUND_MAIL_HOST}`. Only the random local part is stored on
`athena_mailbox`; the host is explicit deployment configuration, never inferred from a website
hostname. The 12-symbol key is not an identity secret or authorization credential. Sub-addresses
such as `key+notes@host` route to the same inbox.

Reading the address or channel creates a mailbox without enabling automation. Enrollment requires
a verified account email, an active human membership in the selected workspace, and explicit
consent to owner replies. The channel stores the enrolled email and a revision. Disabling it or
changing settings increments the revision, cancels queued sends and cancels active email jobs.
Current verification, consent, revision and membership are checked again before execution,
continuation and sending. Already accepted provider mail cannot be recalled.

## Durable receiving and execution

`POST {API_URL}/webhooks/mail/inbound` is public and authenticates the exact raw body with the
Resend endpoint's Svix signing secret. It is outside the session-authenticated `/v1` API. A valid
signature authenticates the provider notification, not the sender of the email.

The production receiver normalizes metadata without making a receiving-API request in the
webhook. `deliverInboundMail` stores an idempotent `athena_inbound_message` before acknowledging.
Duplicate redelivery does not create another message. Stream announcement remains ancillary to
the durable row. An accepted message with missing content is `metadata-only`, never interpreted
as a blank request.

Scheduled `sweepMailIngress` retrieves content from Resend's receiving API and retries failures
from the stored provider message ID. It reads structured receiving-server `authentication`
results; sender-supplied `Authentication-Results` and `Received-SPF` headers cannot grant trust.
Automatic execution requires an exact enrolled From address, passing DMARC and DKIM, and no
automatic/bulk-mail loop indicators. Other senders and uncertain authentication remain captured
context and cannot start privileged generation or trigger a reply.

An eligible message creates an isolated job on the existing Athena runtime, with an immutable
`athena-mail:<inbound id>` reference and a canonical conversation parent. It gets the specific
message and bounded authorized thread context, rather than unrelated canonical history. Email
jobs always ask before acting regardless of the owner's general autonomy setting. Received or
forwarded text cannot approve an action. Ordinary non-destructive text questions may be answered
by a correlated owner reply; destructive questions and action approval remain in signed-in
Docket. Continuations recheck current channel authority before recording an answer or waking work.

Every sweep processes a bounded batch; running work rotates fairly, and restart recovery can
resume hydrated messages, admission, execution and text answers. The existing server scheduler
must be configured and firing in the deployed environment; a browser poll is not a scheduler.

## Replies and approved external email

A settled response, question or approval request is correlated to the specific email job and
stored once in `athena_mail_outbox`. Owner replies always go to the currently enrolled address;
`Reply-To`, Cc and addresses mentioned in content cannot choose the destination. Message IDs and
thread headers link subsequent replies to the right operation. Automatic responses identify
themselves with `Auto-Submitted` to prevent reply loops.

The `send_email` tool proposes a message and optional supported private attachments for authenticated review. Execution
queues the reviewed recipient, subject, body and attachment identities as an immutable snapshot. Sending rechecks the
approval and rejects snapshot changes or revoked authority. Repeated approval cannot create a
second outbox intent. External recipients do not get automatic conversational replies.

The outbox uses leases and a stable provider idempotency key. Confirmed permanent provider
rejection becomes `failed`; rate limits, transient failures and lost responses use bounded
retries without claiming delivery. Resend's 24-hour idempotency lifetime is a hard boundary: an unresolved operation
becomes `uncertain` rather than blindly resending after deduplication expires. Provider acceptance
is displayed as **Provider accepted**, distinct from **Delivered**. Signed `email.delivered` and
`email.bounced` callbacks are durably recorded, including callbacks that race the send receipt,
and reconciled without downgrading a bounce. Disabling the channel cancels work not yet sent.

### Supported content

Inbound bodies are converted to plain text for execution and message display; raw sender HTML
is not rendered inside Docket. Subject/body and per-owner admission budgets bound automatic work.
Attachments are restricted to inert UTF-8 `.txt`, `.md` and `.csv` files with matching MIME
metadata, at most five files of 64 KiB each. The receiving API authorizes retrieval before a
bounded download from the exact provider CDN origin/path; redirects, excessive sizes, mismatched
metadata, invalid UTF-8 and unsafe controls are rejected. No document engine, scripts, formulas
or remote links are evaluated. Supported bytes are stored privately with a server-computed
SHA-256 digest. Each extracted preview admits at most the first 12,000 characters and labels
that limit; continuation context is capped at 20,000 characters with an explicit truncation notice.
Extracted text is marked untrusted; unsupported or unavailable files
are explicitly explained. This is an inert-text boundary, not a claim of antivirus scanning or
PDF/Office support or process sandboxing. UTF-8 decoding is isolated from active-content
engines by admitting only inert text; no external parser is started.

Outgoing attachments refer to owner-held message/attachment identities and exact digests. The
reviewed snapshot includes filenames, types, sizes and hashes; dispatch rechecks ownership,
channel consent and private bytes before sending. Changes invalidate approval. An authenticated
owner download endpoint streams bytes as a download without exposing a public storage URL.

## Storage and work context

`athena_inbound_message` is a first-class owner-scoped context object with stable ID, title,
content status, provenance and timestamps. It is separate from connector email, so disconnecting
Gmail does not delete native mail. Ordinary polymorphic attachments use `kind = 'athena_email'`
and the message ID to attach it to tasks, projects or initiatives. No special mail join table is
needed. Ownership and target-workspace authorization apply on every API read or attachment write.

`athena_mail_outbox` stores immutable send intents, leases, retries and provider receipts.
`athena_mail_provider_event` stores signed delivery callbacks for race recovery. A separate
`athena_mail_blob` cleanup ledger survives source-message/account deletion; scheduled cleanup
removes unreferenced private bytes after a grace period and retains failed deletion intents for
retry. Upload intent is recorded before private storage writes so a crash cannot orphan bytes. Migration
`0168_athena_email_channel.sql` adds channel consent, processing state and these durable tables.

## Configuration

| Variable                        | Purpose                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| `ATHENA_INBOUND_MAIL_HOST`      | Explicit verified sending/receiving domain for Athena addresses            |
| `RESEND_API_KEY`                | Existing sending credential; preserve restrictions for account mail        |
| `RESEND_RECEIVING_API_KEY`      | Separate key authorized to retrieve received messages                      |
| `RESEND_INBOUND_WEBHOOK_SECRET` | Secret issued for this exact webhook endpoint                              |
| `RESEND_RECEIVING_API_BASE`     | Optional receiving-API override                                            |
| `MAIL_FROM`                     | Existing account-mail configuration, required by production mail transport |

The receiving adapter prefers the dedicated receiving key; fallback to the sending key only
works if that key actually has receiving permission. Do not silently replace a restricted
account-mail key with an unrestricted one. Production receiver construction fails closed without
the required credentials. Local/test use the fixture adapter and captured outbound mail.
`configured` reflects runtime configuration, not DNS verification or successful mailbox delivery.

## Provider and deployment acceptance

1. Add a dedicated Athena subdomain in the Studio Resend account. Configure sending and receiving;
   publish its MX, SPF and DKIM records and verify domain state. Preserve existing account-mail DNS.
2. Create an environment-specific webhook at `/webhooks/mail/inbound`, subscribed to
   `email.received`, `email.delivered` and `email.bounced`. Keep its signing secret in Secret Manager.
3. Bind the dedicated receiving credential and endpoint signing secret to the API deployment.
   Set `ATHENA_INBOUND_MAIL_HOST`; apply the migration and deploy the server scheduler/runtime.
4. Enroll the verified owner through ordinary UI and send a real outside-mailbox request.
   Close all Docket clients and verify a real response arrives with correct sender and threading.
5. Reply from the owner mailbox and verify thread continuation while clients remain closed.
   Verify no external email sends before signed-in review, and exercise revocation and recovery.

Provider acceptance, unit tests and UI screenshots are separate evidence. None substitutes for
actual recipient delivery with Docket closed. Keep deployment receipts and mailbox proof in
operational records rather than hard-coding transient environment status into this specification.

## Owner API and surfaces

All owner endpoints are under `/v1/me/athena/mail`:

| Route                                                | Behavior                                        |
| ---------------------------------------------------- | ----------------------------------------------- |
| `GET /address`                                       | Read/mint address without enabling automation   |
| `GET /channel`                                       | Read setup and provider-configuration state     |
| `PUT /channel`                                       | Explicit enrollment/settings change or disable  |
| `GET /attachments/:messageId/:attachmentId`          | Download an authorized immutable private file   |
| `GET /channel/outbox`                                | Owner send and delivery state                   |
| `GET /`                                              | Received messages, newest first                 |
| `GET /attached?subjectType&subjectId&organizationId` | Messages attached to authorized work            |
| `GET /:id`                                           | One owned message                               |
| `GET /:id/attachments`                               | Attached work and titles                        |
| `POST /:id/attachments`                              | Attach to an authorized task/project/initiative |
| `DELETE /:id/attachments/:attachmentId`              | Detach without deleting the message             |

`/athena/mail` offers setup, copying the address, composing a real test email, inbox and delivery
state. `/athena/mail/[id]` shows plain text and work attachments. Approval uses the existing
Athena session approval surface. Polling these screens only observes work; it cannot drive it.

## Offline verification

Use the existing dev-stack and authenticated-session tools documented in
[`ui-verification.md`](ui-verification.md). Seed a verified owner and workspace membership, then
enroll through the channel endpoint or UI. `buildInboundFixturePayload` supplies a receiving
notification with fixture content and explicit structured authentication for deterministic tests.
Fixture authentication is development-only and does not replace real provider trust.

`packages/mail/tests/inbound/resend-inbound.test.ts` covers real Svix verification, metadata-only
acknowledgment and separate receiving-API hydration. API tests under
`apps/api/tests/services/athena-mail` cover durable admission, isolated runtime execution,
continuations, approvals, revocation, retries, loop prevention and delivery reconciliation. Tests
use deterministic model/provider adapters; they do not claim real email delivery.

### Attachment retention

Supported attachment bytes remain private for the lifetime of their received message. Disabling
email immediately revokes downloads and outgoing file use but preserves received work context.
A durable blob intent is stored before upload and survives message/account cascades. The existing
server scheduler reclaims at most 100 source-orphaned objects per pass after a one-hour writer
grace, deleting the intent only after storage confirms deletion. Failed deletions retain their
intent for retry. Retention of live received messages is not shortened by an arbitrary file TTL.

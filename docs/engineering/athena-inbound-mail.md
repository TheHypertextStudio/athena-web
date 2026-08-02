# Athena's inbound mail

> Athena receives email natively. No mailbox to connect, no import step, and no relationship to
> the mail Docket syncs out of a connected Gmail or Outlook account.

This document covers what was built, how to configure the receiving domain at the provider, and
how to exercise the whole path offline.

---

## 1. What a received message is

A message that arrives at Athena's address becomes a row in **`athena_inbound_message`** — Athena's
own store — and that row is modelled as a **context object**, not as an email.

The context-object contract (`packages/types/src/athena-mail.ts`, `ContextObjectOut`) is:

| field           | meaning                                                               |
| --------------- | --------------------------------------------------------------------- |
| `id`            | stable opaque id; the value attachments reference                     |
| `kind`          | `athena_email` today; the discriminator a generic surface switches on |
| `title`         | the subject line                                                      |
| `content`       | the plain-text body                                                   |
| `contentStatus` | `complete`, or `metadata-only` when the body could not be retrieved   |
| `source`        | `{ system, provider, reference, label }` — its provenance             |
| `occurredAt`    | when it was received                                                  |
| `createdAt`     | when Docket stored it                                                 |
| `permalink`     | its in-app surface                                                    |

Nothing in that list is email-shaped. `AthenaMailMessageOut` extends it with the envelope a
_message_ additionally has (sender, recipient address, HTML body, files). A surface that renders a
context object, a picker that lists them, or an agent that reads one needs no knowledge of mail.

### Why a separate table

`attachment{kind:'email'}` and `email_suggestion` are **connector** constructs: both are keyed by
an `integration_id`, both describe content that lives in Gmail, and both cascade away when that
integration is disconnected. A message Athena received belongs to no integration — Docket received
it and Docket holds every byte. Putting it in those tables would mean a single query could not
answer "did this arrive natively or did we sync it", and Athena's mail would vanish when somebody
disconnected an unrelated mailbox.

The separation is structural, and there is a test for each direction:
`apps/api/tests/routes/inbound-mail.test.ts` → _separation from mail Docket syncs_.

### How it attaches to work

Through the ordinary polymorphic `attachment` table, with `kind = 'athena_email'` and
`external_id` = the message's id. There is **no mail-specific join table**, which is what makes
"attachable to stuff, not just emails" true rather than aspirational: a task, a project and an
initiative accept one through the same table every other attachable resource uses.

---

## 2. Addresses

An address is `{key}@{ATHENA_INBOUND_MAIL_HOST}`.

The **host is never stored** — only the local part is, on `athena_mailbox.key`. Moving Athena to
her final receiving domain is therefore one environment variable and zero rows.

`key` is 12 symbols over a 32-symbol Crockford-style alphabet (no `i`/`l`/`o`/`u`), minted with
`crypto.randomBytes`. It is random rather than derived from a name or user id for two reasons: an
inbox address is public by construction, so a derived form would leak the owner's identity to
everyone they give it to, and a sequential form would let a stranger enumerate every mailbox.

Sub-addressing works: `key+newsletters@host` reaches the same mailbox as `key@host`.

A mailbox is minted on the first read of `GET /v1/me/athena/mail/address`, so a person who never
opens the inbox never gets a row.

---

## 3. The receiving path

```
provider  ──POST──▶  /webhooks/mail/inbound          (public, signature-authenticated)
                          │
                          ▼
                   InboundMailReceiver               (packages/mail — port)
                     ├─ ResendInboundReceiver        real: Svix signature + body read
                     └─ FixtureInboundReceiver       offline: same parser, fixture bodies
                          │  InboundMessage
                          ▼
                   deliverInboundMail                (apps/api/src/routes/inbound-mail-delivery.ts)
                          ├─ 1. store    athena_inbound_message   (idempotent)
                          ├─ 2. announce emitInboundEmail → the universal event stream
                          ├─ 3. deliver  postReplyAndResume → Athena's one conversation
                          └─ 4. link     stream event id + session id back onto the row
```

Steps 2–4 are best-effort **around a committed row**. If the stream write or Athena's turn fails,
the message is still stored, still visible and still attachable. The opposite order — announce then
store — could show a person an email that does not exist.

### The mount

`POST {API_URL}/webhooks/mail/inbound`

It sits beside `/webhooks/calendar` rather than under `/internal/*` for the same reason that one
does: Docket registers this exact URL _with the provider_, so it is a public machine edge that
authenticates itself.

Status codes are chosen for what a provider does with them:

| status | meaning                                                                                    |
| ------ | ------------------------------------------------------------------------------------------ |
| `204`  | accepted — delivered, a duplicate redelivery, unroutable, or an event type we don't handle |
| `401`  | not signed by us (`missing-signature`, `invalid-signature`, `stale-timestamp`)             |
| `400`  | signed by us but unreadable (`malformed-payload`)                                          |

The response body carries a stable machine code and never provider or exception text. A delivered
request also carries `x-docket-inbound-outcome: delivered | duplicate | unroutable`.

### Signature verification

Resend signs with Svix. `packages/mail/src/svix-signature.ts` implements the published scheme
manually rather than pulling the SDK — the algorithm is ~30 lines, and a signature check is the
last place to want an extra runtime dependency:

1. secret is `whsec_<base64>`; the bytes after the prefix are the HMAC key
2. signed content is `{svix-id}.{svix-timestamp}.{raw body}`
3. signature is `base64(HMAC-SHA256(key, content))`
4. `svix-signature` is a space-delimited list of `v1,<sig>`; **any** match passes (secret rotation)
5. `svix-timestamp` must be within ±300s (replay guard)

The handler reads the **raw bytes** and never a re-parsed object; the signature is over the exact
body received.

### Why the body needs a second call

Resend's `email.received` webhook carries **metadata only** — sender, recipients, subject,
attachment list — and explicitly not the body. `ResendInboundReceiver` fetches it from
`GET https://api.resend.com/emails/receiving/{email_id}` with the API key.

A failed body read does not fail the delivery. The message genuinely arrived, so it is stored with
`body_status = 'metadata-only'` and every surface says the body has not been retrieved rather than
implying the sender wrote nothing.

---

## 4. Configuration

| variable                        | required          | meaning                                             |
| ------------------------------- | ----------------- | --------------------------------------------------- |
| `ATHENA_INBOUND_MAIL_HOST`      | to receive at all | the receiving domain. **Never derived.**            |
| `RESEND_API_KEY`                | production        | reads message bodies (and sends transactional mail) |
| `RESEND_INBOUND_WEBHOOK_SECRET` | production        | the `whsec_…` endpoint signing secret               |
| `RESEND_RECEIVING_API_BASE`     | no                | receiving-API base override                         |

`ATHENA_INBOUND_MAIL_HOST` is never derived from `PUBLIC_ROOT_DOMAIN` on purpose: a derived value
would claim a host with no MX records, and every message sent to it would bounce while the config
looked healthy. Absent, the API reports `configured: false` and the inbox surface says Athena has
no address yet rather than printing one that would fail.

In production the container **refuses to build the receiver** without both credentials
(`buildInboundReceiverFromEnv`). An unauthenticated receiving endpoint is worse than no receiving
endpoint: anyone who learned the URL could write into a person's Athena.

Local and test always get the offline fixture receiver, so the whole path runs with no account.

---

## 5. Provider setup (operator checklist)

Not yet performed — no Resend credential exists in this environment and the final domain is not
chosen. When it is:

1. **Add the receiving domain** in Resend → Domains, using the value you will set as
   `ATHENA_INBOUND_MAIL_HOST`.
2. **Publish the MX record** Resend shows for that domain. Resend's own requirement: the MX record
   must carry the **lowest priority value** in the zone, or mail will not route to them. Verify
   with `dig <host> MX +short` — an empty answer means every message bounces.
3. **Publish the domain-verification records** (SPF/DKIM) Resend lists, and wait for the domain to
   report verified.
4. **Create the webhook** subscribed to `email.received`, pointing at
   `https://<api host>/webhooks/mail/inbound`. Copy the `whsec_…` signing secret into
   `RESEND_INBOUND_WEBHOOK_SECRET`.
5. **Set `ATHENA_INBOUND_MAIL_HOST`** and redeploy. No code changes at any step — the address is
   composed from configuration at request time.
6. **Verify** by sending a message from an outside mailbox and watching it appear in
   `/athena/mail`, in the activity stream, and in Athena's conversation.

Moving to the final domain later is step 1–5 again with a different value. Nothing stored changes.

---

## 6. Exercising it offline

The fixture receiver reads the same payload shape through the same parser the production adapter
uses, so an offline exercise is an exercise of the real normalization.

```bash
eval "$(./scripts/dev-stack.sh env)"
COOKIE=…                       # a signed-in session cookie

# 1. Ask Athena for her address (mints the mailbox on first read).
ADDR=$(curl -sS "$API_URL/v1/me/athena/mail/address" -H "Cookie: $COOKIE" \
        | python3 -c "import sys,json;print(json.load(sys.stdin)['address'])")

# 2. Deliver a message through the real webhook.
curl -sS -X POST "$API_URL/webhooks/mail/inbound" -H 'content-type: application/json' -d "$(cat <<JSON
{"type":"email.received","created_at":"2026-08-02T20:05:00.000Z",
 "data":{"email_id":"e_demo_001","created_at":"2026-08-02T20:05:00.000Z",
         "from":"Nadia Okoro <nadia@northwind.example>","to":["$ADDR"],
         "cc":[],"bcc":[],"received_for":["$ADDR"],
         "message_id":"<e_demo_001@example.com>",
         "subject":"Signed vendor contract for the Q3 refresh",
         "text":"Renewal date is 14 October.","attachments":[]}}
JSON
)" -D - -o /dev/null | grep -i x-docket-inbound-outcome

# 3. Read it back.
curl -sS "$API_URL/v1/me/athena/mail" -H "Cookie: $COOKIE"
```

`buildInboundFixturePayload` (`@docket/mail`) constructs that body from TypeScript, and is what the
tests use.

Set `RESEND_INBOUND_WEBHOOK_SECRET` locally and the fixture receiver verifies signatures with the
real algorithm, so the crypto path can be exercised before production is ever touched
(`signSvixPayload` mints a valid header set).

---

## 7. Surfaces

| surface               | what it is                                                              |
| --------------------- | ----------------------------------------------------------------------- |
| `/athena/mail`        | the address (with copy) and every received message                      |
| `/athena/mail/[id]`   | one message in full, what it is attached to, and the attach action      |
| `/stream`, org stream | the message as an `email_received` entry, interleaved with everything   |
| task / project detail | an "Email" section listing what is attached, via `MailAttachmentsPanel` |

The message detail renders the **plain-text** body, never the sender's HTML: rendering
stranger-supplied HTML inside the app would hand them a styling and tracking surface inside
somebody's workspace.

---

## 8. API

All owner-scoped and cross-workspace, under `/v1/me/athena/mail`:

| route                                                | does                                              |
| ---------------------------------------------------- | ------------------------------------------------- |
| `GET /address`                                       | the caller's address (mints the mailbox)          |
| `GET /`                                              | received messages, newest first                   |
| `GET /attached?subjectType&subjectId&organizationId` | messages attached to one entity                   |
| `GET /:id`                                           | one message in full                               |
| `GET /:id/attachments`                               | what it is attached to, with the entities' titles |
| `POST /:id/attachments`                              | attach it to a task / project / initiative        |
| `DELETE /:id/attachments/:attachmentId`              | detach (never deletes the message)                |

Ownership comes from the session on every route; another person's message id reads as **absent**,
not forbidden. The attach route's tenant check is membership in the _target_ workspace.

---

## 9. Files

| path                                           | what                                                        |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `packages/mail/src/inbound.ts`                 | the `InboundMailReceiver` port + shared helpers             |
| `packages/mail/src/svix-signature.ts`          | manual Svix verification                                    |
| `packages/mail/src/resend-inbound.ts`          | the real adapter + the shared payload parser                |
| `packages/mail/src/fixture-inbound.ts`         | the offline adapter + payload builder                       |
| `packages/mail/src/inbound-transport.ts`       | env-driven selection (fails closed in production)           |
| `packages/db/src/schema/athena-mail.ts`        | `athena_mailbox`, `athena_inbound_message`                  |
| `packages/types/src/athena-mail.ts`            | the context-object contract + the mail DTOs                 |
| `apps/api/src/routes/inbound-mail.ts`          | the public webhook                                          |
| `apps/api/src/routes/inbound-mail-delivery.ts` | store → announce → deliver → link                           |
| `apps/api/src/routes/athena-mail-store.ts`     | mailbox minting, address resolution, projections            |
| `apps/api/src/routes/athena-mail.ts`           | the owner-facing API                                        |
| `apps/web/src/components/athena/mail-*.tsx`    | the inbox, the message, the attach picker, the entity panel |

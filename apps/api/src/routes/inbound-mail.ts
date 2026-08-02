/**
 * `@docket/api` — Athena's inbound-mail webhook (mounted OUTSIDE the typed `/v1` app).
 *
 * @remarks
 * `POST /webhooks/mail/inbound` is the address the receiving provider is configured to deliver to.
 * It sits beside `/webhooks/calendar` rather than under `/internal/*` for the same reason that one
 * does: Docket registers this exact URL *with the provider*, so it is a public machine edge that
 * authenticates itself, not an internal call Docket makes to itself.
 *
 * Everything about authentication lives behind the {@link InboundMailReceiver} port. This handler
 * reads the raw bytes (never a re-parsed object — the signature is over the exact body), hands
 * them to the resolved adapter, and turns the adapter's closed result union into a status code.
 * It cannot be tricked into skipping verification because it has no verification of its own to
 * skip.
 *
 * Status codes are chosen for what a *provider* does with them, since no human ever sees this
 * response:
 * - `204` — accepted (delivered, a duplicate redelivery, unroutable, or an event type we do not
 *   handle). All four are "stop retrying"; retrying would not change any of them.
 * - `401` — the request was not signed by us. The provider should not retry a forged request, and
 *   an operator watching for these sees attempted forgery rather than a parse bug.
 * - `400` — signed by us but unreadable. Retrying identical bytes cannot help.
 *
 * The response body carries a stable machine code and never provider or exception text.
 */
import type { InboundRejectionCode } from '@docket/mail';
import { Hono } from 'hono';

import { getContainer } from '../container';

import { deliverInboundMail } from './inbound-mail-delivery';

/** The path the provider is configured to deliver to, relative to the mount. */
export const INBOUND_MAIL_WEBHOOK_PATH = '/inbound';

/**
 * HTTP status for each rejection code.
 *
 * @remarks
 * A total map rather than an `if` chain, so a new rejection code is a compile error here instead
 * of silently defaulting to the wrong class of failure.
 */
const REJECTION_STATUS: Readonly<Record<InboundRejectionCode, 401 | 400>> = {
  'missing-signature': 401,
  'invalid-signature': 401,
  'stale-timestamp': 401,
  'malformed-payload': 400,
  'no-recipient': 400,
};

/** Athena's inbound-mail edge: authenticate through the port, then deliver. */
const inboundMail = new Hono().post(INBOUND_MAIL_WEBHOOK_PATH, async (c) => {
  // Raw bytes first, always. Parsing before verification is the one mistake that makes a signed
  // webhook accept anything.
  const rawBody = await c.req.text();
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(c.req.header())) {
    if (typeof value === 'string') headers[name.toLowerCase()] = value;
  }

  const result = await getContainer().inboundMail.receive({ rawBody, headers });

  if (result.status === 'rejected') {
    return c.json({ received: false, code: result.code }, REJECTION_STATUS[result.code]);
  }
  if (result.status === 'ignored') {
    // Authentic, and about something else. A `204` stops the provider retrying an event we will
    // never handle, without pretending we acted on it.
    return c.body(null, 204);
  }

  const outcome = await deliverInboundMail(result.message, getContainer().inboundMail.providerId);
  c.header('x-docket-inbound-outcome', outcome.status);
  return c.body(null, 204);
});

export default inboundMail;

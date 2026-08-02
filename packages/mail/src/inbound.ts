/**
 * `@docket/mail` — the `InboundMailReceiver` port: the single typed edge a message *arriving*
 * at a Docket-owned address crosses.
 *
 * @remarks
 * The mirror of {@link Mailer}, and deliberately its own port rather than a method on it: sending
 * is a command Docket issues, receiving is an untrusted request some stranger on the internet
 * issues, so the two edges have opposite trust properties and opposite failure modes. Everything
 * an adapter can conclude about an inbound HTTP request collapses into one closed
 * {@link InboundReceiveResult} union whose failure arms carry a **stable machine code** and never
 * provider or exception text — the route above renders application-owned copy from that code, so
 * a provider changing its error wording can never change what a person reads.
 *
 * The port takes the raw request (bytes plus headers) rather than a parsed body on purpose:
 * every webhook signature in existence is computed over the exact bytes received, so re-parsing
 * before verification is the one mistake that silently disables authentication.
 *
 * Two adapters implement it — {@link ResendInboundReceiver} (real: Svix signature, then the
 * provider's receiving API for the body) and {@link FixtureInboundReceiver} (offline: the same
 * payload shape, bodies inline or from a fixture) — so the whole delivery pipeline is exercisable
 * with no network and no provider account.
 */

/** One file carried by an inbound message. Metadata only; bytes are fetched on demand. */
export interface InboundAttachment {
  /** The provider's id for this attachment, used to fetch its bytes later. */
  readonly id: string;
  /** Filename as the sender's client supplied it. */
  readonly filename: string;
  /** MIME type as declared by the sender, or `null` when the provider omitted it. */
  readonly contentType: string | null;
  /** `inline` vs `attachment`, when the provider reports it. */
  readonly contentDisposition: string | null;
  /** `Content-ID` for inline parts referenced from the HTML body. */
  readonly contentId: string | null;
}

/**
 * Whether the adapter obtained the message body.
 *
 * @remarks
 * Its own field rather than "body is null" because the two are different facts: a message may
 * genuinely have no text part, and a body fetch may have failed. Recording which one happened is
 * what keeps the surface from claiming a complete capture it does not have.
 */
export type InboundBodyStatus = 'complete' | 'metadata-only';

/** A message that arrived at a Docket-owned address, normalized across providers. */
export interface InboundMessage {
  /** The receiving provider's own id for this message — the idempotency key. */
  readonly providerMessageId: string;
  /** RFC 5322 `Message-ID`, when the provider surfaces it. */
  readonly rfc822MessageId: string | null;
  /** The sender's address, lowercased. */
  readonly fromAddress: string;
  /** The sender's display name, when the `From` header carried one. */
  readonly fromName: string | null;
  /** Every `To` address, lowercased. */
  readonly to: readonly string[];
  /** Every `Cc` address, lowercased. */
  readonly cc: readonly string[];
  /** Subject line, verbatim (may be empty — an empty subject is a real thing senders do). */
  readonly subject: string;
  /** Plain-text body, when present. */
  readonly text: string | null;
  /** HTML body, when present. */
  readonly html: string | null;
  /** Whether the body was retrieved at all — see {@link InboundBodyStatus}. */
  readonly bodyStatus: InboundBodyStatus;
  /** ISO-8601 instant the provider accepted the message. */
  readonly receivedAt: string;
  /** File metadata for anything the sender attached. */
  readonly attachments: readonly InboundAttachment[];
}

/**
 * Why an inbound request was refused, as a stable code.
 *
 * @remarks
 * These strings are part of the contract: they are logged, asserted in tests and mapped to
 * application-owned copy. They are never provider text.
 *
 * - `missing-signature` — one of the signature headers was absent.
 * - `invalid-signature` — the signature did not match the body under our secret.
 * - `stale-timestamp` — the signed timestamp is outside the replay window.
 * - `malformed-payload` — the body verified but is not a payload we can read.
 * - `no-recipient` — verified and well-formed, but addressed to nobody we can route to.
 */
export type InboundRejectionCode =
  | 'missing-signature'
  | 'invalid-signature'
  | 'stale-timestamp'
  | 'malformed-payload'
  | 'no-recipient';

/**
 * What an adapter concluded about one inbound HTTP request.
 *
 * @remarks
 * Three arms, and the middle one earns its place: a receiving webhook is subscribed to a *topic*,
 * and providers deliver adjacent event types on the same endpoint. `ignored` is "authentic, and
 * not ours" — a `200` with no effect — which is categorically different from `rejected`
 * ("someone is posting things they cannot sign"), and conflating them would either bounce
 * legitimate traffic or hide forgery behind a success code.
 */
export type InboundReceiveResult =
  | { readonly status: 'received'; readonly message: InboundMessage }
  | { readonly status: 'ignored'; readonly eventType: string }
  | { readonly status: 'rejected'; readonly code: InboundRejectionCode };

/** One inbound webhook request, as bytes plus headers. */
export interface InboundWebhookRequest {
  /**
   * The exact bytes of the request body, un-parsed.
   *
   * @remarks
   * Signature verification is computed over these bytes. Handing this port an object that was
   * parsed and re-serialized is the classic way to make a webhook look authenticated while
   * accepting anything.
   */
  readonly rawBody: string;
  /** Request headers, lowercased keys. */
  readonly headers: Readonly<Record<string, string>>;
  /** Request time, injectable so replay-window behaviour is testable without faking the clock. */
  readonly now?: Date;
}

/** The provider an inbound adapter speaks for — recorded on every stored message as provenance. */
export type InboundProviderId = 'resend' | 'fixture';

/**
 * The inbound-mail port: verify one webhook request and normalize it, or say why not.
 *
 * @remarks
 * Implementations do exactly two things — authenticate the request and shape the payload. They
 * never touch the database, never decide who a message belongs to, and never render copy; all of
 * that is the route's job, which is what keeps this edge swappable.
 */
export interface InboundMailReceiver {
  /** Which provider this adapter speaks for. */
  readonly providerId: InboundProviderId;
  /**
   * Authenticate and normalize one inbound webhook request.
   *
   * @param request - The raw request bytes and headers.
   * @returns what the request turned out to be (see {@link InboundReceiveResult}).
   */
  receive(request: InboundWebhookRequest): Promise<InboundReceiveResult>;
}

/**
 * Split an address header value into a display name and a bare address.
 *
 * @remarks
 * Handles the two forms providers actually emit — `Name <addr@host>` and a bare `addr@host` —
 * and lowercases the address so routing and dedupe compare like with like while leaving the
 * display name's capitalization alone. Anything unparseable yields a `null` name and the trimmed
 * input as the address, because dropping a message we cannot pretty-print would be worse than
 * showing it plainly.
 *
 * @param value - One address header value.
 * @returns the display name (or `null`) and the lowercased address.
 */
export function parseAddress(value: string): { name: string | null; address: string } {
  const trimmed = value.trim();
  const angled = /^(.*?)<([^>]+)>\s*$/.exec(trimmed);
  if (angled) {
    const rawName = (angled[1] ?? '')
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .trim();
    return {
      name: rawName.length > 0 ? rawName : null,
      address: (angled[2] ?? '').trim().toLowerCase(),
    };
  }
  return { name: null, address: trimmed.toLowerCase() };
}

/**
 * The local part of an address, with any `+tag` sub-address removed.
 *
 * @remarks
 * Sub-addressing is how a person hands out a disposable variant of their own inbox address, so
 * `key+newsletters@host` must route exactly like `key@host`. Returns `null` for anything without
 * a single `@`, which the caller treats as "addressed to nobody we can route to" rather than
 * guessing.
 *
 * @param address - A full email address.
 * @returns the lowercased local part without its `+tag`, or `null` when the address is malformed.
 */
export function mailboxKeyOf(address: string): string | null {
  const at = address.indexOf('@');
  if (at <= 0 || address.includes('@', at + 1)) return null;
  const local = address.slice(0, at).toLowerCase();
  const plus = local.indexOf('+');
  const key = plus === -1 ? local : local.slice(0, plus);
  return key.length > 0 ? key : null;
}

/**
 * The host part of an address, lowercased.
 *
 * @param address - A full email address.
 * @returns the domain, or `null` when the address is malformed.
 */
export function mailboxHostOf(address: string): string | null {
  const at = address.indexOf('@');
  if (at <= 0 || address.includes('@', at + 1)) return null;
  const host = address.slice(at + 1).toLowerCase();
  return host.length > 0 ? host : null;
}

/**
 * A short plain-text preview of a message body.
 *
 * @remarks
 * Collapses whitespace and truncates on a word boundary so a preview never ends mid-word and
 * never leaks the raw line structure of a quoted reply chain. HTML is not converted here — the
 * caller passes whichever body it has, and a message with only an HTML part gets its snippet
 * from the stripped text the adapter produced.
 *
 * @param body - The body text to preview.
 * @param limit - Maximum characters (default 200).
 * @returns the preview, or `null` when there is nothing to preview.
 */
export function snippetOf(body: string | null, limit = 200): string | null {
  if (body === null) return null;
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return null;
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * Reduce an HTML body to readable plain text.
 *
 * @remarks
 * Deliberately small: it strips `script`/`style` wholesale, turns block boundaries into newlines,
 * removes remaining tags and decodes the five XML entities plus `&nbsp;`. It is a *fallback* for
 * messages that carry no text part, not a rendering engine — the stored row keeps the original
 * HTML, so nothing is lost by this being approximate.
 *
 * @param html - The HTML body.
 * @returns the flattened text.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

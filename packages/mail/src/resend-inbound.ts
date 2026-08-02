/**
 * `@docket/mail` — the real Resend inbound adapter, and the payload shape both adapters read.
 *
 * @remarks
 * Resend's receiving product delivers a `email.received` webhook that carries **metadata only** —
 * sender, recipients, subject, attachment list — and explicitly not the body, headers, or
 * attachment bytes. Those are fetched afterwards from the receiving API
 * (`GET /emails/receiving/{email_id}`). That two-step is the whole shape of this adapter:
 * authenticate the notification, then go and get the content it is telling us about.
 *
 * Everything network-facing is injected ({@link HttpClient}, and the clock through
 * {@link InboundWebhookRequest.now}) so the adapter is unit-testable end to end with no account,
 * no DNS and no outbound socket.
 *
 * A failed body fetch does **not** fail the delivery. The message genuinely arrived, and dropping
 * it because a second HTTP call went wrong would lose mail; instead the normalized message is
 * marked `bodyStatus: 'metadata-only'` so every surface downstream can say plainly that the body
 * could not be retrieved rather than implying the sender wrote nothing.
 */
import { defaultHttpClient, type HttpClient } from './http';
import {
  htmlToText,
  type InboundAttachment,
  type InboundMailReceiver,
  type InboundMessage,
  type InboundProviderId,
  type InboundReceiveResult,
  type InboundWebhookRequest,
  parseAddress,
} from './inbound';
import {
  SVIX_ID_HEADER,
  SVIX_SIGNATURE_HEADER,
  SVIX_TIMESTAMP_HEADER,
  verifySvixSignature,
} from './svix-signature';

/** Resend's receiving API base — the `{base}/{email_id}` read that returns a message's content. */
export const RESEND_RECEIVING_ENDPOINT = 'https://api.resend.com/emails/receiving';

/** The webhook event type that means "a message arrived at one of your inbound domains". */
export const RESEND_INBOUND_EVENT_TYPE = 'email.received';

/** The normalized notification carried by a `email.received` webhook (metadata only). */
export interface ResendInboundNotification {
  /** Resend's id for the received message — the idempotency key and the body-fetch handle. */
  readonly emailId: string;
  /** The `From` header value, still in `Name <addr>` form. */
  readonly from: string;
  /** Every `To` address. */
  readonly to: readonly string[];
  /** Every `Cc` address. */
  readonly cc: readonly string[];
  /** The addresses Resend actually accepted the message *for* (after aliases/forwards). */
  readonly receivedFor: readonly string[];
  /** RFC 5322 `Message-ID`, when present. */
  readonly messageId: string | null;
  /** Subject line. */
  readonly subject: string;
  /** ISO-8601 instant Resend accepted the message. */
  readonly createdAt: string;
  /** Attachment metadata. */
  readonly attachments: readonly InboundAttachment[];
  /** A body carried inline, when the payload has one (the fixture adapter's path). */
  readonly inline: { readonly text: string | null; readonly html: string | null } | null;
}

/** Narrow an unknown value to a plain JSON object. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read a string field, or `null` when it is absent or the wrong type. */
function str(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

/** Read an array-of-strings field, tolerating a single bare string and absent keys. */
function strings(source: Record<string, unknown>, key: string): readonly string[] {
  const value = source[key];
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** Map the payload's attachment list, keeping only entries with an id and a filename. */
function readAttachments(source: Record<string, unknown>): readonly InboundAttachment[] {
  const raw = source['attachments'];
  if (!Array.isArray(raw)) return [];
  const out: InboundAttachment[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = str(record, 'id');
    const filename = str(record, 'filename');
    if (!id || !filename) continue;
    out.push({
      id,
      filename,
      contentType: str(record, 'content_type'),
      contentDisposition: str(record, 'content_disposition'),
      contentId: str(record, 'content_id'),
    });
  }
  return out;
}

/**
 * The result of reading an inbound webhook body.
 *
 * @remarks
 * A closed union rather than "notification or null" because "this is a real Resend event about
 * something else" and "this is not a Resend event at all" must not collapse: the first is a
 * `200` no-op and the second is a rejection.
 */
export type ResendPayloadRead =
  | { readonly kind: 'inbound'; readonly notification: ResendInboundNotification }
  | { readonly kind: 'other'; readonly eventType: string }
  | { readonly kind: 'malformed' };

/**
 * Read a Resend webhook body into a normalized notification.
 *
 * @remarks
 * Deliberately tolerant about *extra* fields and strict about the handful it depends on: a
 * provider adding a field must never break receiving, and a payload missing `email_id` or `from`
 * cannot be stored or routed, so it is malformed rather than silently half-imported.
 *
 * Shared by both adapters so the offline fixture path exercises the same parsing the production
 * path uses — a mock that parses differently proves nothing.
 *
 * @param rawBody - The exact request body bytes.
 * @returns what the body turned out to be (see {@link ResendPayloadRead}).
 */
export function readResendInboundPayload(rawBody: string): ResendPayloadRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { kind: 'malformed' };
  }
  const envelope = asRecord(parsed);
  if (!envelope) return { kind: 'malformed' };
  const type = str(envelope, 'type');
  if (!type) return { kind: 'malformed' };
  if (type !== RESEND_INBOUND_EVENT_TYPE) return { kind: 'other', eventType: type };

  const data = asRecord(envelope['data']);
  if (!data) return { kind: 'malformed' };
  const emailId = str(data, 'email_id') ?? str(data, 'id');
  const from = str(data, 'from');
  if (!emailId || !from) return { kind: 'malformed' };

  const inlineText = str(data, 'text');
  const inlineHtml = str(data, 'html');

  return {
    kind: 'inbound',
    notification: {
      emailId,
      from,
      to: strings(data, 'to'),
      cc: strings(data, 'cc'),
      receivedFor: strings(data, 'received_for'),
      messageId: str(data, 'message_id'),
      subject: str(data, 'subject') ?? '',
      createdAt: str(data, 'created_at') ?? str(envelope, 'created_at') ?? new Date().toISOString(),
      attachments: readAttachments(data),
      inline:
        inlineText !== null || inlineHtml !== null ? { text: inlineText, html: inlineHtml } : null,
    },
  };
}

/**
 * Fold a notification plus whatever body was obtained into the port's {@link InboundMessage}.
 *
 * @remarks
 * Two normalizations happen here and nowhere else, so both adapters agree: recipient lists are
 * lowercased (routing compares them), and a message with only an HTML part gets a derived text
 * body so every consumer — the snippet, Athena's transcript, search — has something to read
 * without each one re-implementing HTML stripping.
 *
 * @param notification - The parsed webhook metadata.
 * @param body - The retrieved body, or `null` when it could not be retrieved.
 * @returns the normalized message.
 */
export function toInboundMessage(
  notification: ResendInboundNotification,
  body: { readonly text: string | null; readonly html: string | null } | null,
): InboundMessage {
  const sender = parseAddress(notification.from);
  const html = body?.html ?? null;
  const text = body?.text ?? (html ? htmlToText(html) : null);
  // Every address the message was accepted for, then its explicit `To` list: a forwarded or
  // aliased delivery names the real destination only in `received_for`, and routing must see it.
  const recipients = [...notification.receivedFor, ...notification.to].map((address) =>
    address.trim().toLowerCase(),
  );
  return {
    providerMessageId: notification.emailId,
    rfc822MessageId: notification.messageId,
    fromAddress: sender.address,
    fromName: sender.name,
    to: [...new Set(recipients)],
    cc: notification.cc.map((address) => address.trim().toLowerCase()),
    subject: notification.subject,
    text,
    html,
    bodyStatus: body === null ? 'metadata-only' : 'complete',
    receivedAt: notification.createdAt,
    attachments: notification.attachments,
  };
}

/** Validated configuration for {@link ResendInboundReceiver}. */
export interface ResendInboundConfig {
  /** The endpoint signing secret Resend issued for this webhook (`whsec_…`). */
  readonly signingSecret: string;
  /** The Resend API key used to fetch message bodies. */
  readonly apiKey: string;
  /** Receiving API base; overridable so tests never touch the network. */
  readonly apiBase?: string;
  /** Replay-window override in seconds. */
  readonly toleranceSeconds?: number;
}

/**
 * The production inbound adapter: verify Resend's signature, then fetch the body it describes.
 *
 * @remarks
 * Holds the signing secret and API key privately; neither appears in a returned value, a thrown
 * error, or a log line. Every failure it can reach the caller with is one of the port's stable
 * codes, so nothing a provider writes ever becomes something a person reads.
 */
export class ResendInboundReceiver implements InboundMailReceiver {
  /** {@inheritDoc InboundMailReceiver.providerId} */
  readonly providerId: InboundProviderId = 'resend';

  private readonly config: ResendInboundConfig;
  private readonly http: HttpClient;

  /**
   * @param config - Signing secret, API key and optional endpoint/tolerance overrides.
   * @param http - HTTP transport (defaults to the platform `fetch`).
   */
  constructor(config: ResendInboundConfig, http: HttpClient = defaultHttpClient) {
    this.config = config;
    this.http = http;
  }

  /**
   * Fetch one received message's body from the receiving API.
   *
   * @remarks
   * Returns `null` for every failure mode — non-2xx, unreadable JSON, a network throw — because
   * the caller's decision is the same in all three ("we have metadata, not content") and
   * distinguishing them here would only tempt a surface into rendering provider text.
   *
   * @param emailId - Resend's id for the received message.
   * @returns the body, or `null` when it could not be retrieved.
   */
  private async fetchBody(
    emailId: string,
  ): Promise<{ text: string | null; html: string | null } | null> {
    const base = this.config.apiBase ?? RESEND_RECEIVING_ENDPOINT;
    try {
      const response = await this.http(`${base}/${encodeURIComponent(emailId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      });
      if (!response.ok) return null;
      const payload: unknown = await response.json();
      const record = asRecord(payload);
      if (!record) return null;
      // The receiving read has been observed both flat and wrapped in `data`; accept either
      // rather than losing a body to an envelope change.
      const source = asRecord(record['data']) ?? record;
      return { text: str(source, 'text'), html: str(source, 'html') };
    } catch {
      return null;
    }
  }

  /** {@inheritDoc InboundMailReceiver.receive} */
  async receive(request: InboundWebhookRequest): Promise<InboundReceiveResult> {
    const verification = verifySvixSignature({
      secret: this.config.signingSecret,
      id: request.headers[SVIX_ID_HEADER],
      timestamp: request.headers[SVIX_TIMESTAMP_HEADER],
      signature: request.headers[SVIX_SIGNATURE_HEADER],
      payload: request.rawBody,
      now: request.now ?? new Date(),
      ...(this.config.toleranceSeconds === undefined
        ? {}
        : { toleranceSeconds: this.config.toleranceSeconds }),
    });
    if (!verification.ok) return { status: 'rejected', code: verification.code };

    const read = readResendInboundPayload(request.rawBody);
    if (read.kind === 'malformed') return { status: 'rejected', code: 'malformed-payload' };
    if (read.kind === 'other') return { status: 'ignored', eventType: read.eventType };

    const inline = read.notification.inline;
    const body = inline ?? (await this.fetchBody(read.notification.emailId));
    return { status: 'received', message: toInboundMessage(read.notification, body) };
  }
}

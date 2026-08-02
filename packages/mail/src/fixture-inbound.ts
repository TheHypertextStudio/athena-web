/**
 * `@docket/mail` — the offline inbound adapter and its canned messages.
 *
 * @remarks
 * The mock half of the inbound port. It reads the **same** Resend payload shape through the
 * **same** parser the production adapter uses, so exercising the pipeline offline exercises the
 * real normalization rather than a parallel simplification — a mock that agrees with its real
 * counterpart only by coincidence is worse than no mock.
 *
 * Two things differ from production, and only two:
 *
 * 1. **Bodies come from the payload or a fixture**, never from the network. Resend's real webhook
 *    carries metadata only; here an inline `text`/`html` on the payload, or a fixture registered
 *    under the message id, stands in for the receiving-API read.
 * 2. **Signature verification is optional.** With a secret configured it verifies exactly as
 *    production does (so the crypto path is exercisable locally with
 *    {@link signSvixPayload}); without one it accepts unsigned posts, which is what makes
 *    `curl`-ing a fixture into a dev stack a one-liner.
 *
 * It is never selected outside `local`/`test` — {@link buildInboundReceiverFromEnv} decides that
 * structurally, not by flag.
 */
import {
  type InboundMailReceiver,
  type InboundProviderId,
  type InboundReceiveResult,
  type InboundWebhookRequest,
} from './inbound';
import { readResendInboundPayload, toInboundMessage } from './resend-inbound';
import {
  SVIX_ID_HEADER,
  SVIX_SIGNATURE_HEADER,
  SVIX_TIMESTAMP_HEADER,
  verifySvixSignature,
} from './svix-signature';

/** A body the fixture adapter serves in place of the receiving API. */
export interface InboundFixtureBody {
  /** Plain-text body. */
  readonly text: string | null;
  /** HTML body. */
  readonly html: string | null;
}

/** Configuration for {@link FixtureInboundReceiver}. */
export interface FixtureInboundConfig {
  /** When set, requests are signature-verified exactly as production verifies them. */
  readonly signingSecret?: string;
  /** Bodies keyed by provider message id, standing in for the receiving-API read. */
  readonly bodies?: Readonly<Record<string, InboundFixtureBody>>;
  /** Replay-window override in seconds. */
  readonly toleranceSeconds?: number;
}

/**
 * Build a Resend-shaped `email.received` webhook body.
 *
 * @remarks
 * The one place a test or a dev script constructs an inbound payload, so every offline exercise
 * of the pipeline starts from the shape the provider actually sends. Bodies are carried inline
 * here (a real webhook would not) because that is the fixture adapter's stand-in for the
 * receiving-API read; the production parser ignores inline bodies it never receives.
 *
 * @param input - The message to represent.
 * @returns the JSON body to POST at the inbound webhook.
 */
export function buildInboundFixturePayload(input: {
  readonly emailId: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly messageId?: string;
  readonly receivedAt?: string;
  readonly attachments?: readonly {
    readonly id: string;
    readonly filename: string;
    readonly contentType?: string;
  }[];
}): string {
  const createdAt = input.receivedAt ?? new Date().toISOString();
  return JSON.stringify({
    type: 'email.received',
    created_at: createdAt,
    data: {
      email_id: input.emailId,
      created_at: createdAt,
      from: input.from,
      to: [...input.to],
      cc: [],
      bcc: [],
      received_for: [...input.to],
      message_id: input.messageId ?? `<${input.emailId}@fixture.docket>`,
      subject: input.subject,
      ...(input.text === undefined ? {} : { text: input.text }),
      ...(input.html === undefined ? {} : { html: input.html }),
      attachments: (input.attachments ?? []).map((a) => ({
        id: a.id,
        filename: a.filename,
        content_type: a.contentType ?? 'application/octet-stream',
        content_disposition: 'attachment',
        content_id: null,
      })),
    },
  });
}

/**
 * The offline inbound adapter: the production parser, fixture bodies, optional signing.
 *
 * @remarks
 * See the module remarks for why it verifies signatures when a secret is present — the point is
 * that "signed correctly" is provable locally, not stubbed away.
 */
export class FixtureInboundReceiver implements InboundMailReceiver {
  /** {@inheritDoc InboundMailReceiver.providerId} */
  readonly providerId: InboundProviderId = 'fixture';

  private readonly config: FixtureInboundConfig;

  /** @param config - Optional signing secret and fixture bodies. */
  constructor(config: FixtureInboundConfig = {}) {
    this.config = config;
  }

  /** {@inheritDoc InboundMailReceiver.receive} */
  async receive(request: InboundWebhookRequest): Promise<InboundReceiveResult> {
    if (this.config.signingSecret) {
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
      if (!verification.ok) return Promise.resolve({ status: 'rejected', code: verification.code });
    }

    const read = readResendInboundPayload(request.rawBody);
    if (read.kind === 'malformed') {
      return Promise.resolve({ status: 'rejected', code: 'malformed-payload' });
    }
    if (read.kind === 'other') {
      return Promise.resolve({ status: 'ignored', eventType: read.eventType });
    }

    const body =
      read.notification.inline ?? this.config.bodies?.[read.notification.emailId] ?? null;
    return Promise.resolve({
      status: 'received',
      message: toInboundMessage(read.notification, body),
    });
  }
}

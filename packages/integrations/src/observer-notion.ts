/**
 * `@docket/integrations` — `RealNotionObserver` (Notion webhook → the mirror's pull-back trigger).
 *
 * @remarks
 * Notion signs each delivery with HMAC-SHA256 over the **exact raw body**, keyed by the
 * subscription's verification token, and sends the hex digest as `X-Notion-Signature:
 * sha256=<hex>`. That contract is the SDK's, not a reading of the docs — `@notionhq/client`
 * ships `verifyWebhookSignature`/`signWebhookPayload` and documents it precisely.
 *
 * The shared observer port accepts synchronous or asynchronous verification. Notion therefore
 * delegates the complete signature protocol to the SDK's `verifyWebhookSignature` helper instead
 * of maintaining a second HMAC implementation beside it.
 *
 * ## `normalize` returns nothing, deliberately
 *
 * Notion webhooks exist here to *wake the mirror's pull-back*, not to populate the activity feed.
 * Docket's `source_system` enum has no `notion` member, and adding one to emit drafts nothing
 * renders would be a migration in service of dead data. The delivery is still recorded in the
 * `inbound_event` inbox — which is what the reconciler drains — so nothing is lost.
 *
 * ## The verification handshake is recorded, not logged
 *
 * Creating a subscription makes Notion POST a one-time `{ verification_token }` body, unsigned
 * (there is no token yet to sign with). Rather than 400 that and print the token to a log the
 * operator has to go digging for, it is accepted and written to the inbox like any other
 * delivery: durable, queryable, and already the place inbound webhook data lives.
 */
import { createHash } from 'node:crypto';
import { verifyWebhookSignature } from '@notionhq/client';

import { asRecord, str } from './json';
import type {
  EventDraft,
  InboundRouting,
  Observer,
  ObserverProvider,
  RawInboundEvent,
  VerifySignatureInput,
} from './observer';

/** The header Notion signs each delivery with. */
const SIGNATURE_HEADER = 'x-notion-signature';

/** The synthetic event type recorded for the one-time subscription handshake. */
export const NOTION_VERIFICATION_EVENT = 'notion.verification';

/** Configuration for {@link RealNotionObserver}. */
export interface RealNotionObserverConfig {
  /** The subscription's verification token, from `NOTION_WEBHOOK_TOKEN`. */
  readonly verificationToken: string;
}

/**
 * Read the one-time verification token out of a handshake body.
 *
 * @remarks
 * Exported so the operator-facing surface can present the token from a recorded inbox row rather
 * than requiring a log dig.
 *
 * @param payload - The parsed request body.
 * @returns the token, or undefined when this is not a handshake.
 */
export function readVerificationToken(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (record === undefined) return undefined;
  // A handshake carries the token and nothing else; a real event always carries a `type`.
  if ('type' in record) return undefined;
  return str(record, 'verification_token');
}

/**
 * Whether every author of a delivery is the given bot.
 *
 * @remarks
 * **The echo guard.** Docket's own writes fire webhooks, so replaying them would push, pull, and
 * push again forever. Notion's payload carries `authors: [{ id, type: 'person' | 'bot' }]`, which
 * makes the check exact rather than heuristic: an event authored solely by Docket's own
 * integration bot is Docket hearing itself and is dropped.
 *
 * Requires *every* author to be the bot. A page edited by a person in the same window as Docket's
 * write lists both, and that delivery carries a real human change that must not be discarded.
 *
 * @param payload - The parsed webhook body.
 * @param botId - Docket's own Notion bot user id, from `GET /users/me`.
 * @returns true when the delivery was caused only by Docket's own write.
 */
export function isSelfAuthored(payload: unknown, botId: string | undefined): boolean {
  if (botId === undefined || botId.length === 0) return false;
  const authors = asRecord(payload)?.['authors'];
  if (!Array.isArray(authors) || authors.length === 0) return false;
  return authors.every((author) => {
    const record = asRecord(author);
    return record?.['type'] === 'bot' && str(record, 'id') === botId;
  });
}

/** The env-driven {@link Observer} for Notion. */
export class RealNotionObserver implements Observer {
  /** {@inheritDoc Observer.provider} */
  readonly provider: ObserverProvider = 'notion';

  private readonly verificationToken: string;

  /**
   * @param config - The subscription's verification token.
   */
  constructor(config: RealNotionObserverConfig) {
    this.verificationToken = config.verificationToken;
  }

  /**
   * {@inheritDoc Observer.verifySignature}
   *
   * @remarks
   * The handshake is accepted unsigned because it structurally cannot be signed — it is the
   * delivery that *carries* the signing token. Every other delivery must present a matching
   * digest, compared in constant time.
   */
  async verifySignature(input: VerifySignatureInput): Promise<boolean> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      return false;
    }
    if (readVerificationToken(parsed) !== undefined) return true;

    return verifyWebhookSignature({
      body: input.rawBody,
      signature: input.headers[SIGNATURE_HEADER],
      verificationToken: this.verificationToken,
    });
  }

  /**
   * {@inheritDoc Observer.route}
   *
   * @remarks
   * `workspace_id` maps the delivery to the connected integration, and the delivery's own `id`
   * dedupes retries through the inbox's `(provider, external_event_id)` unique index.
   */
  route(payload: unknown): InboundRouting | null {
    const record = asRecord(payload);
    if (record === undefined) return null;

    const token = readVerificationToken(payload);
    if (token !== undefined) {
      // No workspace to route to yet, so the delivery is recorded unrouted. The id is a DIGEST of
      // the token, never a slice of it: `external_event_id` is a plain indexed text column, and
      // putting part of a signing secret there would leave it queryable by anything that can read
      // the inbox. Hashing still dedupes a retried handshake and still distinguishes two different
      // subscriptions, which is all the id has to do.
      const digest = createHash('sha256').update(token).digest('hex').slice(0, 32);
      return {
        externalEventId: `verification:${digest}`,
        eventType: NOTION_VERIFICATION_EVENT,
      };
    }

    const eventType = str(record, 'type');
    const externalEventId = str(record, 'id');
    if (eventType === undefined || externalEventId === undefined) return null;
    const externalWorkspaceId = str(record, 'workspace_id');
    return {
      externalEventId,
      eventType,
      ...(externalWorkspaceId !== undefined ? { externalWorkspaceId } : {}),
    };
  }

  /**
   * {@inheritDoc Observer.normalize}
   *
   * @remarks
   * Always empty — see the module remarks. A Notion delivery drives the mirror's pull-back from
   * the inbox; it contributes no activity-feed event, and inventing one would mean adding a
   * `source_system` value nothing renders.
   */
  normalize(_event: RawInboundEvent): EventDraft[] {
    return [];
  }
}

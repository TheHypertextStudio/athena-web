/**
 * `@docket/notifications` — the Web Push contract: subscriptions, actionable messages, the sender port.
 *
 * @remarks
 * Deliberately separate from the token-based {@link @docket/integrations#PushSender}. That port
 * hands a provider an opaque device token and a title; the browser Push API hands *the user agent's
 * own push service* an encrypted payload that only that browser can read, and the payload can carry
 * **action buttons**. That difference is the whole reason this module exists: an elicitation's
 * options have to arrive as buttons on the notification, because a notification that can only say
 * "open the app" does not let anyone answer without losing the context of the task that prompted it.
 *
 * Nothing here imports `node:crypto`, so this module is safe to import from browser code that needs
 * the subscription shape. The signing/encrypting sender lives in `./node`.
 */
import { z } from 'zod';

/** Hostnames that are a bare IPv4/IPv6 literal rather than a resolvable push-service name. */
const IP_LITERAL = /^(\[.*\]|\d{1,3}(\.\d{1,3}){3})$/;

/**
 * Whether a push endpoint is shaped like a real push service rather than an internal address.
 *
 * @remarks
 * The server POSTs to this URL, so an unconstrained value is a server-side request forgery
 * primitive: the subscription is attacker-chosen and the 404/410-prunes-the-row behavior in
 * `elicitation-notify` leaks the outcome back as a three-state oracle.
 *
 * These are the checks that cost nothing in compatibility — every shipping push service is HTTPS
 * on a named host. The address-level guarantee (no private/loopback/link-local resolution, no
 * redirect off a public address) comes from `mcpSafeFetch` in the sender, not from here, because
 * resolving DNS at registration time would be checked at the wrong moment. A hostname allowlist
 * was considered and rejected: it breaks whenever a browser vendor adds an endpoint, and the
 * pinned-address fetch already makes it redundant.
 *
 * @param value - The candidate endpoint URL.
 * @returns whether the endpoint may be stored and later posted to.
 */
export function isDeliverablePushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  return !IP_LITERAL.test(url.hostname);
}

/** The subscription a browser hands back from `PushManager.subscribe`. */
export const WebPushSubscription = z
  .object({
    /** The user agent's push service URL; also the uniqueness key for a subscription. */
    endpoint: z.url().refine(isDeliverablePushEndpoint, {
      error: 'endpoint must be an https URL on a named host',
    }),
    /** Milliseconds since epoch after which the subscription is dead, when the browser says. */
    expirationTime: z.number().nullable().default(null),
    keys: z.object({
      /** The client's public ECDH key on P-256, base64url, uncompressed point (65 bytes). */
      p256dh: z.string().min(1),
      /** The client's 16-byte authentication secret, base64url. */
      auth: z.string().min(1),
    }),
  })
  .meta({
    id: 'WebPushSubscription',
    description: 'A browser push subscription, as returned by PushManager.subscribe.',
  });
/** A {@link WebPushSubscription} value. */
export type WebPushSubscription = z.infer<typeof WebPushSubscription>;

/**
 * One button rendered on the notification itself.
 *
 * @remarks
 * `action` is the machine identifier the service worker receives in `notificationclick`; it is what
 * turns a tap into a recorded answer rather than a navigation. Browsers cap how many they display
 * (see {@link WEB_PUSH_MAX_ACTIONS}) — extra actions are not an error, they simply do not render,
 * which is why {@link WebPushMessage.data} must always carry enough to answer in the app too.
 */
export const WebPushAction = z
  .object({
    action: z.string().min(1).max(64),
    title: z.string().min(1).max(64),
  })
  .meta({ id: 'WebPushAction', description: 'One action button on a web push notification.' });
/** A {@link WebPushAction} value. */
export type WebPushAction = z.infer<typeof WebPushAction>;

/**
 * How many action buttons a notification may carry.
 *
 * @remarks
 * `Notification.maxActions` is 2 on every shipping browser that implements actions at all. The
 * builder truncates to this and marks the overflow, rather than emitting buttons that silently
 * vanish on the user's device.
 */
export const WEB_PUSH_MAX_ACTIONS = 2;

/** How long a push service should hold an undelivered message, in seconds. */
export const WEB_PUSH_DEFAULT_TTL_SECONDS = 3600;

/** Delivery urgency, passed through to the push service as the `Urgency` header. */
export const WebPushUrgency = z.enum(['very-low', 'low', 'normal', 'high']);
/** A {@link WebPushUrgency} value. */
export type WebPushUrgency = z.infer<typeof WebPushUrgency>;

/** One actionable notification, as the service worker will render it. */
export const WebPushMessage = z
  .object({
    title: z.string().min(1),
    body: z.string().default(''),
    /**
     * Collapse key.
     *
     * @remarks
     * Two notifications sharing a tag replace each other rather than stacking, which is what keeps
     * a re-raised or re-notified question from becoming a pile of identical banners.
     */
    tag: z.string().min(1),
    /** Buttons; see {@link WebPushAction}. */
    actions: z.array(WebPushAction).max(WEB_PUSH_MAX_ACTIONS).default([]),
    /** Where a body-click lands, as an in-app path. */
    url: z.string().min(1),
    /** Opaque payload the service worker reads to answer without opening the app. */
    data: z.record(z.string(), z.unknown()).default({}),
    /** Keep the banner on screen until the person deals with it. */
    requireInteraction: z.boolean().default(false),
    urgency: WebPushUrgency.default('normal'),
    ttlSeconds: z.number().int().min(0).default(WEB_PUSH_DEFAULT_TTL_SECONDS),
  })
  .meta({
    id: 'WebPushMessage',
    description: 'An actionable web push notification with option buttons.',
  });
/** A {@link WebPushMessage} value. */
export type WebPushMessage = z.infer<typeof WebPushMessage>;

/** Why one web push send failed, as a stable code. */
export type WebPushErrorCode = 'gone' | 'invalid_subscription' | 'not_configured' | 'push_service';

/** A typed web push failure. Carries a code, never provider text. */
export class WebPushSendError extends Error {
  /** Machine-readable failure kind. */
  readonly code: WebPushErrorCode;
  /** The push service's HTTP status, when there was a response. */
  readonly status: number | null;

  /**
   * @param code - Machine-readable failure kind.
   * @param status - The push service's HTTP status, when there was one.
   */
  constructor(code: WebPushErrorCode, status: number | null = null) {
    super(`web push send failed: ${code}`);
    this.name = 'WebPushSendError';
    this.code = code;
    this.status = status;
  }
}

/** Metadata for one accepted web push send. */
export interface SentWebPush {
  /** The subscription endpoint the message went to. */
  readonly endpoint: string;
  /** ISO-8601 instant the push service accepted it. */
  readonly sentAt: string;
  /** The push service's HTTP status. */
  readonly status: number;
}

/** The web push sender port. */
export interface WebPushSender {
  /**
   * Encrypt and deliver one message to one browser subscription.
   *
   * @param subscription - The browser's subscription.
   * @param message - The actionable notification to render.
   * @returns metadata for the accepted send.
   * @throws {WebPushSendError} When the push service refuses or the sender is unconfigured.
   */
  send(subscription: WebPushSubscription, message: WebPushMessage): Promise<SentWebPush>;
}

/**
 * An in-memory sender that captures every message for assertions.
 *
 * @remarks
 * Lives here rather than in `./testing` so a browser-safe test can use it without pulling in the
 * crypto sender.
 */
export class CaptureWebPushSender implements WebPushSender {
  private counter = 0;
  /** Endpoints that should fail with `gone`, to exercise the subscription-pruning path. */
  private readonly goneEndpoints: ReadonlySet<string>;
  /** Every message captured so far, in send order. */
  readonly outbox: { subscription: WebPushSubscription; message: WebPushMessage }[] = [];

  /**
   * @param goneEndpoints - Endpoints that should report themselves permanently gone.
   */
  constructor(goneEndpoints: ReadonlySet<string> = new Set<string>()) {
    this.goneEndpoints = goneEndpoints;
  }

  /** {@inheritDoc WebPushSender.send} */
  async send(subscription: WebPushSubscription, message: WebPushMessage): Promise<SentWebPush> {
    if (this.goneEndpoints.has(subscription.endpoint)) {
      throw new WebPushSendError('gone', 410);
    }
    this.counter += 1;
    this.outbox.push({ subscription, message });
    return {
      endpoint: subscription.endpoint,
      sentAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.counter)).toISOString(),
      status: 201,
    };
  }

  /** The most recently captured message, or `undefined` when nothing has been sent. */
  last(): WebPushMessage | undefined {
    return this.outbox[this.outbox.length - 1]?.message;
  }
}

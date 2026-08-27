/**
 * `@docket/api` — delivering one time-sensitive question as an actionable web notification.
 *
 * @remarks
 * The whole reason this path exists rather than reusing the generic notification intent pipeline:
 * an intent renders a subject and a body, and a question needs **its own options as buttons**. A
 * banner that can only say "Athena needs you" costs exactly the context the product promises to
 * preserve — you would have to find the task again by hand to answer it.
 *
 * Reliability rule, and it is the one this module is written around: **never report a delivery that
 * did not happen**. {@link notifyElicitation} returns how many browsers actually accepted the push
 * and why the others did not, a `410 Gone` disables the dead subscription rather than being
 * swallowed, and an unconfigured deployment reports `not_configured` instead of silently
 * succeeding.
 */
import { contactPoint, db } from '@docket/db';
import {
  WebPushSendError,
  WebPushSubscription,
  elicitationPushMessage,
  type WebPushSender,
} from '@docket/notifications/webpush';
import { VapidWebPushSender, vapidKeysFromEnv } from '@docket/notifications/webpush/node';
import { and, eq } from 'drizzle-orm';

// Type-only, and deliberately so: this module is imported *by* the service, and a value import
// back the other way would close a runtime cycle around the path that raises a question.
import type { ElicitationRow } from './elicitation-service';

/** The in-app path a person lands on to answer one question in the context of its task. */
function permalink(elicitationId: string): string {
  return `/athena?elicitation=${encodeURIComponent(elicitationId)}`;
}

/**
 * The deployment's VAPID identity, resolved once.
 *
 * @remarks
 * Cached because deriving and validating the key pair costs an elliptic-curve multiplication, and
 * because a half-configured deployment should say so once rather than on every question.
 */
let cachedKeys: ReturnType<typeof vapidKeysFromEnv> | undefined;

function vapidKeys(): ReturnType<typeof vapidKeysFromEnv> {
  cachedKeys ??= vapidKeysFromEnv({
    WEB_PUSH_VAPID_PUBLIC_KEY: process.env['WEB_PUSH_VAPID_PUBLIC_KEY'],
    WEB_PUSH_VAPID_PRIVATE_KEY: process.env['WEB_PUSH_VAPID_PRIVATE_KEY'],
    WEB_PUSH_VAPID_SUBJECT: process.env['WEB_PUSH_VAPID_SUBJECT'],
  });
  return cachedKeys;
}

/** Forget the cached identity; used by tests that set env between cases. */
export function resetWebPushIdentity(): void {
  cachedKeys = undefined;
}

/**
 * The application server key a browser needs to subscribe, or `null` when push is unconfigured.
 *
 * @returns The base64url VAPID public key, or `null`.
 */
export function vapidPublicKey(): string | null {
  return vapidKeys()?.publicKey ?? null;
}

/** Why one elicitation produced no push. */
export type ElicitationNotifySkip =
  'not_time_sensitive' | 'not_configured' | 'no_subscription' | 'already_settled';

/** What one notification attempt actually did. */
export interface ElicitationNotifyResult {
  /** How many browsers accepted the push. Zero is a real outcome, never dressed up as success. */
  readonly delivered: number;
  /** How many subscriptions were disabled because the push service reported them gone. */
  readonly pruned: number;
  /** How many refused for a reason that is not the subscription's fault. */
  readonly failed: number;
  /** Why nothing was attempted, when nothing was. */
  readonly skipped: ElicitationNotifySkip | null;
}

/** Read every usable browser subscription for one person. */
async function activeSubscriptions(
  userId: string,
): Promise<readonly { id: string; subscription: WebPushSubscription }[]> {
  const rows = await db
    .select({ id: contactPoint.id, value: contactPoint.value })
    .from(contactPoint)
    .where(
      and(
        eq(contactPoint.userId, userId),
        eq(contactPoint.type, 'push_token'),
        eq(contactPoint.status, 'active'),
      ),
    );
  const usable: { id: string; subscription: WebPushSubscription }[] = [];
  for (const row of rows) {
    const parsed = WebPushSubscription.safeParse(safeJson(row.value));
    // A contact point that cannot be parsed back into a subscription can never deliver; disabling
    // it here is what keeps "subscribed" from meaning "we have a row" instead of "we can reach you".
    if (!parsed.success) {
      await db
        .update(contactPoint)
        .set({ status: 'disabled', disabledAt: new Date() })
        .where(eq(contactPoint.id, row.id));
      continue;
    }
    usable.push({ id: row.id, subscription: parsed.data });
  }
  return usable;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** Optional injection points, used by tests to avoid a real push service. */
export interface NotifyElicitationDeps {
  /** The sender to deliver through; defaults to the deployment's VAPID sender. */
  readonly sender?: WebPushSender;
}

/**
 * Deliver one time-sensitive question to every browser the person has subscribed.
 *
 * @remarks
 * Delivered to *every* registered browser rather than a single "primary" one, because the whole
 * premise is that the person is not at the surface that raised the question. The shared collapse
 * tag means the same question never stacks into a pile of banners on the device that shows it.
 *
 * @param row - The question to announce.
 * @param taskTitle - The title of the task it exists to implement.
 * @param deps - Optional sender injection.
 * @returns What was actually delivered; see {@link ElicitationNotifyResult}.
 */
export async function notifyElicitation(
  row: ElicitationRow,
  taskTitle: string,
  deps: NotifyElicitationDeps = {},
): Promise<ElicitationNotifyResult> {
  const empty = { delivered: 0, pruned: 0, failed: 0 };
  if (!row.timeSensitive) return { ...empty, skipped: 'not_time_sensitive' };
  if (row.status !== 'pending') return { ...empty, skipped: 'already_settled' };

  const keys = vapidKeys();
  const sender = deps.sender ?? (keys ? new VapidWebPushSender(keys) : null);
  if (!sender) return { ...empty, skipped: 'not_configured' };

  const subscriptions = await activeSubscriptions(row.askedUserId);
  if (subscriptions.length === 0) return { ...empty, skipped: 'no_subscription' };

  const message = elicitationPushMessage({
    elicitationId: row.id,
    actionSummary: row.actionSummary,
    question: row.question,
    spec: row.spec,
    taskTitle,
    url: permalink(row.id),
    expiresAt: row.expiresAt.toISOString(),
  });

  let delivered = 0;
  let pruned = 0;
  let failed = 0;
  for (const entry of subscriptions) {
    try {
      await sender.send(entry.subscription, message);
      delivered += 1;
    } catch (error) {
      if (error instanceof WebPushSendError && error.code === 'gone') {
        await db
          .update(contactPoint)
          .set({ status: 'disabled', disabledAt: new Date() })
          .where(eq(contactPoint.id, entry.id));
        pruned += 1;
        continue;
      }
      failed += 1;
    }
  }
  return { delivered, pruned, failed, skipped: null };
}

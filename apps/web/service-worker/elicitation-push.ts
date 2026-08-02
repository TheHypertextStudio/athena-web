/**
 * Answering Athena from the notification itself.
 *
 * @remarks
 * Two behaviours, both of which exist so that answering a question does not cost you the context of
 * the task that prompted it:
 *
 * - **An action button records the answer without opening the app.** The answer travels inside the
 *   `notificationclick` action id (the only channel the event gives us), and the worker POSTs it to
 *   the same route the in-app card uses. That is the whole point of putting the question's own
 *   options on the banner: two taps from anywhere, and the blocked work resumes.
 * - **The banner body lands you on the question, in context.** Not on a generic inbox — on the card
 *   itself, scrolled into view, inside the conversation where the task lives.
 *
 * Pure functions, so the routing decisions are testable without a browser: `sw.ts` supplies the
 * platform (`fetch`, `clients`, `showNotification`) and this module decides what to do.
 */

/** The prefix an action id carries when it encodes an answer. Mirrors `@docket/notifications`. */
export const ANSWER_ACTION_PREFIX = 'answer:';

/** The payload the server sends inside a push message. */
export interface ElicitationPushPayload {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly url: string;
  readonly requireInteraction: boolean;
  readonly actions: readonly { readonly action: string; readonly title: string }[];
  readonly data: Record<string, unknown>;
}

/** What a `notificationclick` should do. */
export type NotificationIntent =
  | {
      readonly kind: 'answer';
      readonly elicitationId: string;
      readonly value: unknown;
      readonly url: string;
    }
  | { readonly kind: 'open'; readonly url: string }
  | { readonly kind: 'ignore' };

/**
 * Read a push message body into a renderable payload.
 *
 * @param raw - The decrypted push body, as text.
 * @returns The payload, or `null` when the message is not one of ours.
 */
export function readPushPayload(raw: string | null): ElicitationPushPayload | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record['title'] !== 'string' || typeof record['tag'] !== 'string') return null;
    return {
      title: record['title'],
      body: typeof record['body'] === 'string' ? record['body'] : '',
      tag: record['tag'],
      url: typeof record['url'] === 'string' ? record['url'] : '/athena',
      requireInteraction: record['requireInteraction'] === true,
      actions: Array.isArray(record['actions'])
        ? record['actions'].flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return [];
            const action = entry as Record<string, unknown>;
            if (typeof action['action'] !== 'string' || typeof action['title'] !== 'string') {
              return [];
            }
            return [{ action: action['action'], title: action['title'] }];
          })
        : [],
      data:
        record['data'] && typeof record['data'] === 'object'
          ? (record['data'] as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}

/**
 * Decide what one notification click means.
 *
 * @param action - The `notificationclick` action id; empty when the banner body was clicked.
 * @param data - The notification's `data` payload.
 * @returns The intent to carry out.
 */
export function resolveNotificationIntent(
  action: string,
  data: Record<string, unknown>,
): NotificationIntent {
  const url = typeof data['url'] === 'string' ? data['url'] : '/athena';
  const elicitationId = typeof data['elicitationId'] === 'string' ? data['elicitationId'] : null;
  if (!elicitationId) return { kind: 'open', url };
  if (!action.startsWith(ANSWER_ACTION_PREFIX)) return { kind: 'open', url };
  try {
    const value: unknown = JSON.parse(action.slice(ANSWER_ACTION_PREFIX.length));
    return { kind: 'answer', elicitationId, value, url };
  } catch {
    // An action id we cannot decode is never guessed at — land the person on the question instead.
    return { kind: 'open', url };
  }
}

/**
 * The answer endpoint for one question.
 *
 * @param apiOrigin - The API origin baked into the worker at build time.
 * @param elicitationId - The question being answered.
 */
export function answerEndpoint(apiOrigin: string, elicitationId: string): string {
  return `${apiOrigin.replace(/\/$/, '')}/v1/me/elicitations/${encodeURIComponent(elicitationId)}/answer`;
}

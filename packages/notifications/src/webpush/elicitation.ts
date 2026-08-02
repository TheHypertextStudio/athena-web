/**
 * `@docket/notifications` — turning one elicitation into one actionable notification.
 *
 * @remarks
 * The rule this module exists to enforce: a notification raised by a time-sensitive question must
 * carry *that question's own options* as buttons. A generic "Athena needs you — open the app"
 * banner fails the requirement, because answering it means finding the task again by hand, which
 * is exactly the context loss the product promises to avoid.
 *
 * Only two response kinds have a bounded, nameable option set that fits on a notification: a
 * confirmation (its two labels) and a selection (its first options). Everything else — free text, a
 * date, a file, a whole form — cannot be answered from a banner, so those get a body-click that
 * lands on the question in context rather than buttons that would lie about what they do.
 */
import type { ElicitationSpec } from '@docket/types';

import {
  WEB_PUSH_MAX_ACTIONS,
  type WebPushAction,
  type WebPushMessage,
  type WebPushUrgency,
} from './types';

/** The `notificationclick` action id meaning "open the app at this question". */
export const ELICITATION_PUSH_OPEN_ACTION = 'open';

/** The prefix every answer-in-place action id carries, followed by the encoded answer. */
export const ELICITATION_PUSH_ANSWER_PREFIX = 'answer:';

/** Everything needed to render one elicitation as a notification. */
export interface ElicitationPushInput {
  /** The elicitation's id; the service worker posts the answer against it. */
  readonly elicitationId: string;
  /** The concrete action the answer authorizes. This is the notification's title. */
  readonly actionSummary: string;
  /** The question, shown as the body. */
  readonly question: string;
  /** The declared answer shape; its options become the buttons. */
  readonly spec: ElicitationSpec;
  /** The task this question exists to implement, for the body-click landing. */
  readonly taskTitle: string;
  /** In-app path to the question in the context of its task. */
  readonly url: string;
  /** When the question stops waiting, ISO-8601. */
  readonly expiresAt: string;
}

/**
 * The answer value one notification action submits, encoded into its action id.
 *
 * @remarks
 * The action id is the only channel `notificationclick` gives us, so the answer travels inside it.
 * Only JSON scalars ever appear here (a boolean for a confirmation, an option's `value` for a
 * selection), which is why a plain `JSON.stringify` round-trips exactly.
 *
 * @param value - The answer this button submits.
 * @returns The action id to put on the button.
 */
export function encodeElicitationAnswerAction(value: unknown): string {
  return `${ELICITATION_PUSH_ANSWER_PREFIX}${JSON.stringify(value)}`;
}

/**
 * Read the answer back out of a notification action id.
 *
 * @param action - The `notificationclick` action id.
 * @returns The answer to submit, or `undefined` when this action is not an answer.
 */
export function decodeElicitationAnswerAction(action: string): unknown {
  if (!action.startsWith(ELICITATION_PUSH_ANSWER_PREFIX)) return undefined;
  try {
    return JSON.parse(action.slice(ELICITATION_PUSH_ANSWER_PREFIX.length)) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The buttons one elicitation spec can offer on a notification.
 *
 * @remarks
 * Returns an empty list for any spec whose answer cannot be expressed as a tap. That is a feature:
 * the caller then renders a body-click-only notification rather than inventing a button.
 *
 * @param spec - The elicitation's declared answer shape.
 * @returns Up to {@link WEB_PUSH_MAX_ACTIONS} buttons, in the order they should appear.
 */
export function elicitationPushActions(spec: ElicitationSpec): readonly WebPushAction[] {
  if (spec.kind === 'confirm') {
    return [
      { action: encodeElicitationAnswerAction(true), title: spec.confirmLabel },
      { action: encodeElicitationAnswerAction(false), title: spec.declineLabel },
    ];
  }
  if (spec.kind === 'select' && !spec.multiple) {
    const options = spec.options.slice(0, WEB_PUSH_MAX_ACTIONS);
    // One option is not a choice; two is. A single-option select is really a confirmation and is
    // better answered in the app, where the person can see what they are agreeing to.
    if (options.length < 2) return [];
    return options.map((option) => ({
      action: encodeElicitationAnswerAction(option.value),
      title: option.label.slice(0, 64),
    }));
  }
  return [];
}

/**
 * Build the actionable notification for one time-sensitive elicitation.
 *
 * @remarks
 * `requireInteraction` is set because the whole point of a time-sensitive question is that work has
 * stopped; a banner that auto-dismisses after four seconds while you are in another window is the
 * same as no banner. `tag` is the elicitation id, so re-notifying replaces rather than stacks.
 *
 * @param input - See {@link ElicitationPushInput}.
 * @returns The message to hand a {@link WebPushSender}.
 *
 * @example
 * ```typescript
 * const message = elicitationPushMessage({
 *   elicitationId: 'elc_1',
 *   actionSummary: 'Post the sprint update to the Acme project channel',
 *   question: 'Should I post it now?',
 *   spec: { kind: 'confirm', confirmLabel: 'Post it', declineLabel: 'Hold' },
 *   taskTitle: 'Weekly sprint update',
 *   url: '/athena?elicitation=elc_1',
 *   expiresAt: '2026-08-02T18:00:00.000Z',
 * });
 * // message.actions -> [{ title: 'Post it' }, { title: 'Hold' }]
 * ```
 */
export function elicitationPushMessage(input: ElicitationPushInput): WebPushMessage {
  const actions = elicitationPushActions(input.spec);
  const urgency: WebPushUrgency = 'high';
  return {
    title: input.actionSummary,
    body: `${input.question}\n${input.taskTitle}`,
    tag: `elicitation:${input.elicitationId}`,
    actions: [...actions],
    url: input.url,
    data: {
      kind: 'elicitation',
      elicitationId: input.elicitationId,
      url: input.url,
      expiresAt: input.expiresAt,
      // Present for every message, answerable or not: the service worker needs a landing route
      // whether the person taps a button or the banner body.
      answerable: actions.length > 0,
    },
    requireInteraction: true,
    urgency,
    ttlSeconds: 3600,
  };
}

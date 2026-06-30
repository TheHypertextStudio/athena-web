/**
 * `@docket/api` — the email-to-task funnel: a cheap, pure task-worthiness classifier.
 *
 * @remarks
 * Stage one of the two-stage funnel (`docs/engineering/specs/email-to-task.md` §6): a cheap
 * deterministic scorer that drops most mail for ~free, so the expensive synthesis (Athena)
 * only runs on survivors. Pure and fully unit-tested — no I/O, no LLM. The pass threshold is
 * supplied by the caller (runtime config), never hardcoded here.
 */

/** The signal a classifier scores — a thread projected to its subject/snippet/sender. */
export interface ThreadSignal {
  readonly subject: string;
  readonly snippet: string;
  readonly sender: string;
}

/** The classifier's verdict for one thread. */
export interface ThreadVerdict {
  /** 0–100 task-worthiness score. */
  readonly score: number;
  /** A coarse category, when detected (e.g. `promotions`) — surfaced to pipeline rules. */
  readonly category?: string;
  /** Whether the score met the supplied threshold. */
  readonly worthy: boolean;
}

/** Phrases that signal someone is asking *you* to do something. */
const ACTION_CUES = [
  'can you',
  'could you',
  'please',
  'review',
  'schedule',
  'confirm',
  'sign',
  'approve',
  'deadline',
  'due',
  'reply',
  'respond',
  'send',
  'complete',
  'rsvp',
  'action required',
];

/** Markers of bulk/promotional mail that is almost never a personal task. */
const PROMO_CUES = ['unsubscribe', 'newsletter', 'sale', '% off', 'limited time', 'promo code'];

/** True when the sender is an unattended/no-reply mailbox. */
function isNoReply(sender: string): boolean {
  return /no[-_]?reply|do[-_]?not[-_]?reply|notifications?@/i.test(sender);
}

/**
 * Score a thread's task-worthiness, deterministically.
 *
 * @remarks
 * Adds points for action cues and a direct question, subtracts for promotional cues and
 * no-reply senders. A promotional thread is tagged `category: 'promotions'` (so a pipeline
 * rule can auto-dismiss it) and floored low. The result is compared against `threshold` to
 * set `worthy` — the threshold is the caller's runtime config, not a literal here.
 *
 * @param signal - The thread's subject/snippet/sender.
 * @param threshold - The pass score (0–100), supplied by config.
 */
export function classifyTaskWorthiness(signal: ThreadSignal, threshold: number): ThreadVerdict {
  const haystack = `${signal.subject}\n${signal.snippet}`.toLowerCase();
  const isPromo = PROMO_CUES.some((cue) => haystack.includes(cue));
  if (isPromo) {
    const score = 5; // promotional mail floors low; almost never a personal task
    return { score, category: 'promotions', worthy: score >= threshold };
  }

  let score = 30; // a neutral baseline for a real personal thread
  for (const cue of ACTION_CUES) if (haystack.includes(cue)) score += 18;
  if (haystack.includes('?')) score += 10;
  if (isNoReply(signal.sender)) score -= 25;
  score = Math.max(0, Math.min(100, score));

  return { score, worthy: score >= threshold };
}

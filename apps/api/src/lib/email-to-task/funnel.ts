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

/**
 * One criterion lifted out of an active, user-authored routing rule.
 *
 * @remarks
 * The funnel's cues are generic guesses about mail in general; a routing rule is a specific
 * statement by this person about this mailbox ("anything mentioning LVBT belongs in the LVBT
 * workspace"). {@link classifyTaskWorthiness} takes these as the stronger evidence, so a thread
 * the person has explicitly asked for is not thrown away by a generic heuristic before the rule
 * ever gets to see it. The extraction lives in `lib/automation/routing-cues.ts`; this module only
 * knows how to compare one.
 */
export interface RoutingCue {
  /** Which part of the mail the rule names. */
  readonly field: 'sender' | 'content';
  /** The literal the rule compares against, lowercased. */
  readonly value: string;
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

/**
 * Markers of bulk/promotional mail that is almost never a personal task.
 *
 * @remarks
 * Urgency wording stays on this list, and both spellings of it: bulk mail leans on "limited time"
 * constantly, and dropping the cue to rescue the occasional real opportunity would trade one
 * silent failure for a far noisier inbox. The rescue is the routing-cue exemption in
 * {@link classifyTaskWorthiness}, which is scoped to mail a person's own rule already names.
 */
const PROMO_CUES = [
  'unsubscribe',
  'newsletter',
  'sale',
  '% off',
  'limited time',
  'limited-time',
  'promo code',
];

/** The score a thread gets for being one the person's own rule asked for. */
const REQUESTED_SCORE = 70;

/** True when the sender is an unattended/no-reply mailbox. */
function isNoReply(sender: string): boolean {
  return /no[-_]?reply|do[-_]?not[-_]?reply|notifications?@/i.test(sender);
}

/**
 * Whether any active routing rule names this thread by sender or by keyword.
 *
 * @remarks
 * Deliberately case-insensitive and deliberately looser than the predicate interpreter, which
 * compares `contains` case-sensitively. The two are allowed to disagree in exactly one direction:
 * the funnel may keep a thread the rule then declines, which costs one synthesis call, and must
 * never drop a thread the rule would have matched, which costs the person the task they asked
 * for. Over-keeping is recoverable; over-dropping is the silent failure this guards against.
 */
function matchesRoutingCue(signal: ThreadSignal, cues: readonly RoutingCue[]): boolean {
  if (cues.length === 0) return false;
  const sender = signal.sender.toLowerCase();
  const content = `${signal.subject}\n${signal.snippet}`.toLowerCase();
  return cues.some((cue) => (cue.field === 'sender' ? sender : content).includes(cue.value));
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
 * A thread matching one of the caller's `routingCues` is exempt from all of that. Those cues come
 * from rules this person wrote about this mailbox, and an explicit instruction outranks a generic
 * spam signal: promotional wording is precisely how a real limited-time opportunity is worded, so
 * scoring "limited-time LVBT opportunity" as junk would suppress the mail before the LVBT rule
 * could ever act on it. Such a thread is neither floored nor tagged `promotions` (the tag would
 * hand it to the shipped dismiss-promotions rule instead), scores {@link REQUESTED_SCORE}, and
 * passes regardless of threshold — the person already decided, so the threshold has nothing left
 * to decide. Mail matching no rule keeps the full promotional filter, unchanged.
 *
 * @param signal - The thread's subject/snippet/sender.
 * @param threshold - The pass score (0–100), supplied by config.
 * @param routingCues - Criteria from the org's active routing rules; empty means none exist.
 */
export function classifyTaskWorthiness(
  signal: ThreadSignal,
  threshold: number,
  routingCues: readonly RoutingCue[] = [],
): ThreadVerdict {
  const haystack = `${signal.subject}\n${signal.snippet}`.toLowerCase();
  const requested = matchesRoutingCue(signal, routingCues);
  const isPromo = PROMO_CUES.some((cue) => haystack.includes(cue));
  if (isPromo && !requested) {
    const score = 5; // promotional mail floors low; almost never a personal task
    return { score, category: 'promotions', worthy: score >= threshold };
  }

  let score = 30; // a neutral baseline for a real personal thread
  for (const cue of ACTION_CUES) if (haystack.includes(cue)) score += 18;
  if (haystack.includes('?')) score += 10;
  if (isNoReply(signal.sender)) score -= 25;
  if (requested) score = Math.max(score, REQUESTED_SCORE);
  score = Math.max(0, Math.min(100, score));

  return { score, worthy: requested || score >= threshold };
}

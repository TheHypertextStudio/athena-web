/**
 * Decide when an `@` in running text is a mention attempt, and what has been typed after it.
 *
 * @remarks
 * Pure, and driven only by the text before the caret, so the same rules govern a ProseMirror
 * document and a plain textarea. Every decision here is about not getting in the way: the menu
 * opening while someone types an email address is far more annoying than it failing to open on an
 * unusual keystroke, so the rules err toward staying closed.
 */

/** The longest query both mention-search routes accept. */
const MAX_QUERY = 128;

/** An open mention attempt. */
export interface MentionTrigger {
  /** Offset of the `@` itself. */
  readonly start: number;
  /** What has been typed after the `@`, which may be empty. */
  readonly query: string;
}

/** Characters that may sit immediately before an `@` for it to start a mention. */
function opensMention(prev: string | undefined): boolean {
  // Start of text, or after whitespace or an opening bracket. Notably *not* after a word
  // character, which is what keeps `someone@example.com` from opening the menu on every keystroke.
  if (prev === undefined) return true;
  return /[\s([{<"'>]/u.test(prev);
}

/**
 * Find the mention attempt the caret currently sits inside, if any.
 *
 * @param textBeforeCaret - Everything from the start of the block up to the caret.
 * @returns The trigger, or undefined when the caret is not in one.
 *
 * @example
 * ```typescript
 * findMentionTrigger('Blocked by @dri');   // { start: 11, query: 'dri' }
 * findMentionTrigger('mail me@example.com'); // undefined
 * ```
 */
export function findMentionTrigger(textBeforeCaret: string): MentionTrigger | undefined {
  const at = textBeforeCaret.lastIndexOf('@');
  if (at === -1) return undefined;

  if (!opensMention(at === 0 ? undefined : textBeforeCaret[at - 1])) return undefined;

  const query = textBeforeCaret.slice(at + 1);
  if (query.length > MAX_QUERY) return undefined;
  // A newline ends the attempt outright: a mention never spans a paragraph.
  if (/[\n\r]/u.test(query)) return undefined;

  return { start: at, query };
}

/** A caret scan, in whatever coordinate space the surface counts positions in. */
export interface TriggerScan {
  /** Everything from the start of the block or line up to the caret. */
  readonly textBeforeCaret: string;
  /** The position {@link textBeforeCaret} starts at, added to every offset in the result. */
  readonly origin: number;
  /** Position of an `@` the reader dismissed with Escape, if one is still dismissed. */
  readonly dismissedStart: number | undefined;
}

/** What a surface should do with the trigger a scan found. */
export type TriggerDecision =
  | { readonly kind: 'open'; readonly trigger: MentionTrigger }
  /** A trigger is there, but the reader already dismissed this one. Stay shut. */
  | { readonly kind: 'suppressed' }
  /** No trigger at the caret, so any dismissal has served its purpose and expires. */
  | { readonly kind: 'none' };

/**
 * Resolve a caret scan into an open/stay-shut decision.
 *
 * @remarks
 * Escape has to survive the events that follow it. A textarea fires `keyup` for the Escape press
 * itself and a ProseMirror surface re-scans on the next caret move, so a controller that only
 * cleared its state would re-derive the same trigger and reopen the menu it was just told to
 * dismiss. Keying the dismissal to the `@`'s position rather than to the query means typing more
 * of the same word keeps it shut, while starting a new `@` anywhere gets a menu again.
 *
 * @param scan - The text before the caret, its origin, and the dismissed position.
 * @returns What the caller should do.
 *
 * @example
 * ```typescript
 * decideTrigger({ textBeforeCaret: 'Blocked by @dri', origin: 0, dismissedStart: 11 });
 * // { kind: 'suppressed' }
 * ```
 */
export function decideTrigger(scan: TriggerScan): TriggerDecision {
  const found = findMentionTrigger(scan.textBeforeCaret);
  if (found === undefined) return { kind: 'none' };

  const start = scan.origin + found.start;
  if (start === scan.dismissedStart) return { kind: 'suppressed' };
  return { kind: 'open', trigger: { start, query: found.query } };
}

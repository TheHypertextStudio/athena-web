/**
 * Decide when an `@` in running text is a mention attempt, and what has been typed after it.
 *
 * @remarks
 * Pure, and driven only by the text before the caret, so the same rules govern a ProseMirror
 * document and a plain textarea. Every decision here is about not getting in the way: the menu
 * opening while someone types an email address is far more annoying than it failing to open on an
 * unusual keystroke, so the rules err toward staying closed.
 */

/** How many characters may follow the `@` before we conclude this is not a mention. */
const MAX_QUERY = 48;

/** How many spaces the query may contain, so `@design review` works but a sentence does not. */
const MAX_WORDS = 2;

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
  if (query.split(' ').length > MAX_WORDS) return undefined;
  // A trailing space with nothing after it reads as abandoning the attempt, not as searching for
  // a two-word name, so `@ ` closes rather than listing everything.
  if (query.endsWith(' ') && query.trim().split(' ').length >= MAX_WORDS) return undefined;

  return { start: at, query };
}

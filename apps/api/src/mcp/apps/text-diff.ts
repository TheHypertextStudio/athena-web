/**
 * `@docket/api` — the words that changed between two versions of a piece of writing.
 *
 * @remarks
 * A change report used to strike through a whole old brief and print the whole new one, so a
 * one-word edit produced a card thousands of pixels tall and the edit itself was the hardest thing
 * on it to find. This finds the changed run by trimming the words the two versions share at each
 * end, and keeps a few words of context either side. One pass, no alignment table: an edit is
 * almost always one contiguous change, and when it is not, the run spans the edits and says so in
 * its word counts.
 */

/** The changed run of words, with context, ready to draw as ...lead ~~removed~~ **inserted** tail... */
export interface WordRewrite {
  readonly lead: string;
  readonly removed: string;
  readonly inserted: string;
  readonly tail: string;
  /** Whether words before `lead` were left out. */
  readonly leadCut: boolean;
  /** Whether words after `tail` were left out. */
  readonly tailCut: boolean;
  readonly wordsAdded: number;
  readonly wordsRemoved: number;
}

/** Words of unchanged context kept either side of the change. */
const CONTEXT_WORDS = 6;

/** The most of a removed or inserted run a card shows. */
const RUN_WORDS = 30;

const wordsOf = (text: string): string[] => text.split(/\s+/).filter((word) => word !== '');

/** A run of words, shortened with an ellipsis past {@link RUN_WORDS}. */
function runOf(words: readonly string[]): string {
  const shown = words.slice(0, RUN_WORDS).join(' ');
  return words.length > RUN_WORDS ? `${shown} …` : shown;
}

/** How many leading words two lists share. */
function sharedPrefix(a: readonly string[], b: readonly string[]): number {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
  return count;
}

/** How many trailing words two lists share, never reaching back past `floor`. */
function sharedSuffix(a: readonly string[], b: readonly string[], floor: number): number {
  let count = 0;
  while (
    a.length - count > floor &&
    b.length - count > floor &&
    a[a.length - 1 - count] === b[b.length - 1 - count]
  ) {
    count += 1;
  }
  return count;
}

/**
 * Find the words that changed between two versions of the same text.
 *
 * @param before - The earlier version, as plain text.
 * @param after - The later version, as plain text.
 * @returns The changed run with context, or `null` when the words are the same.
 */
export function wordRewrite(before: string, after: string): WordRewrite | null {
  const a = wordsOf(before);
  const b = wordsOf(after);
  const start = sharedPrefix(a, b);
  const end = sharedSuffix(a, b, start);
  const removed = a.slice(start, a.length - end);
  const inserted = b.slice(start, b.length - end);
  if (removed.length === 0 && inserted.length === 0) return null;
  const leadFrom = Math.max(0, start - CONTEXT_WORDS);
  const tailTo = Math.min(a.length, a.length - end + CONTEXT_WORDS);
  return {
    lead: a.slice(leadFrom, start).join(' '),
    removed: runOf(removed),
    inserted: runOf(inserted),
    tail: a.slice(a.length - end, tailTo).join(' '),
    leadCut: leadFrom > 0,
    tailCut: tailTo < a.length,
    wordsAdded: inserted.length,
    wordsRemoved: removed.length,
  };
}

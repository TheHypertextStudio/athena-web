/**
 * Deterministic lexical normalization shared by conversation search and segmentation.
 *
 * The intentionally small stop-word list keeps the algorithm domain-neutral. It avoids encoding
 * today's work vocabulary into a primitive that should work just as well in a future desktop host.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'about',
  'after',
  'again',
  'all',
  'also',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'done',
  'for',
  'from',
  'get',
  'got',
  'had',
  'has',
  'have',
  'he',
  'her',
  'here',
  'hers',
  'him',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'let',
  'like',
  'make',
  'me',
  'more',
  'most',
  'my',
  'need',
  'no',
  'not',
  'now',
  'of',
  'ok',
  'on',
  'one',
  'only',
  'or',
  'other',
  'our',
  'out',
  'over',
  'please',
  'put',
  'really',
  'said',
  'same',
  'say',
  'see',
  'she',
  'should',
  'so',
  'some',
  'still',
  'such',
  'sure',
  'take',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'thing',
  'things',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'up',
  'us',
  'use',
  'very',
  'want',
  'was',
  'we',
  'well',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  'yours',
]);

/**
 * Collapse a small set of English inflections without over-stemming unrelated topic words.
 */
export function stemWord(word: string): string {
  let stem = word;
  for (const suffix of [
    'ations',
    'ation',
    'ingly',
    'edly',
    'ings',
    'ing',
    'ers',
    'er',
    'ies',
    'ied',
    'es',
    'ed',
    's',
  ]) {
    if (stem.length > suffix.length + 2 && stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length);
      if (suffix === 'ies' || suffix === 'ied') stem += 'y';
      else if (suffix.startsWith('ing') || suffix === 'ed' || suffix === 'edly') {
        const last = stem.at(-1) ?? '';
        if (stem.length > 2 && last === stem.at(-2) && !'lszaeiou'.includes(last)) {
          stem = stem.slice(0, -1);
        }
      }
      break;
    }
  }
  return stem;
}

/** Convert raw conversation text to lowercased, stop-word-free topic terms. */
export function topicTerms(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .map(stemWord);
}

import { describe, expect, it } from 'vitest';

import { wordRewrite } from '../../src/mcp/apps/text-diff';

describe('wordRewrite', () => {
  it('finds a one-word swap with the words either side of it', () => {
    expect(wordRewrite('a short media campaign', 'a week-long media campaign')).toEqual({
      lead: 'a',
      removed: 'short',
      inserted: 'week-long',
      tail: 'media campaign',
      leadCut: false,
      tailCut: false,
      wordsAdded: 1,
      wordsRemoved: 1,
    });
  });

  it('keeps six words of context and marks what it left out', () => {
    const before =
      'one two three four five six seven eight nine old ten eleven twelve thirteen fourteen fifteen sixteen';
    const rewrite = wordRewrite(before, before.replace('old', 'new'));
    expect(rewrite).toMatchObject({
      lead: 'four five six seven eight nine',
      tail: 'ten eleven twelve thirteen fourteen fifteen',
      leadCut: true,
      tailCut: true,
    });
  });

  it('reports pure insertions and deletions', () => {
    expect(wordRewrite('keep this', 'keep all of this')).toMatchObject({
      removed: '',
      inserted: 'all of',
      wordsAdded: 2,
      wordsRemoved: 0,
    });
    expect(wordRewrite('drop these words', 'drop words')).toMatchObject({
      removed: 'these',
      inserted: '',
    });
    expect(wordRewrite('', 'new text')).toMatchObject({ inserted: 'new text', lead: '', tail: '' });
  });

  it('shortens a long changed run', () => {
    const rewrite = wordRewrite('start end', `start ${'word '.repeat(40)}end`);
    expect(rewrite?.inserted.endsWith('…')).toBe(true);
    expect(rewrite?.wordsAdded).toBe(40);
  });

  it('finds nothing when only the spacing moved', () => {
    expect(wordRewrite('same  words\nhere', 'same words here')).toBeNull();
  });
});

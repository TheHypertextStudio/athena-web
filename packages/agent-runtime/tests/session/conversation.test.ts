import { describe, expect, it } from 'vitest';

import {
  LexicalCohesionSegmenter,
  matchSpans,
  searchConversation,
  stemWord,
  topicTerms,
  withinRange,
  type ConversationMessage,
} from '../../src/index';

/** Build a chronological conversation from `[role, text]` pairs, one minute apart. */
function conversation(
  pairs: readonly (readonly [ConversationMessage['role'], string])[],
  startIso = '2026-06-01T09:00:00.000Z',
): ConversationMessage[] {
  const start = Date.parse(startIso);
  return pairs.map(([role, text], index) => ({
    id: `m${String(index).padStart(3, '0')}`,
    role,
    text,
    at: new Date(start + index * 60_000),
  }));
}

/**
 * Three unmistakably different topics with no shared vocabulary: hiring, a database migration,
 * and a newsletter. If lexical cohesion cannot find these boundaries it cannot find any.
 */
const THREE_TOPICS = conversation([
  ['user', 'We need to hire a senior designer for the brand team this quarter.'],
  ['agent', 'I drafted a designer job description and a hiring scorecard for the brand team.'],
  ['user', 'Add a portfolio review round to the designer interview loop.'],
  ['agent', 'Added a portfolio review to the designer interview loop, before the onsite.'],
  ['user', 'Separately, the Postgres migration keeps timing out on the events table.'],
  ['agent', 'The Postgres migration on the events table needs a concurrent index build.'],
  ['user', 'Can we run that migration in batches instead of one transaction?'],
  ['agent', 'Batching the migration avoids the long transaction lock on Postgres.'],
  ['user', "Let's hold the newsletter until Tuesday so the announcement lands first."],
  ['agent', 'Holding the newsletter until Tuesday; the announcement goes out Monday evening.'],
  ['user', 'Who writes the newsletter intro paragraph?'],
  ['agent', 'You write the newsletter intro; I will assemble the rest of the issue.'],
]);

describe('topicTerms / stemWord', () => {
  it('drops conversational filler and collapses inflections of the same topic word', () => {
    expect(
      topicTerms('We are shipping the newsletters, and the newsletter ships Tuesday.'),
    ).toEqual(['ship', 'newslett', 'newslett', 'ship', 'tuesday']);
  });

  it('leaves short words and irregular endings alone rather than over-stemming', () => {
    expect(stemWord('bus')).toBe('bus');
    expect(stemWord('is')).toBe('is');
    expect(stemWord('stories')).toBe('story');
  });
});

describe('LexicalCohesionSegmenter', () => {
  const segmenter = new LexicalCohesionSegmenter();

  it('finds the two topic changes in a three-topic conversation, with no user action', () => {
    const segments = segmenter.segment(THREE_TOPICS);
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.startId)).toEqual(['m000', 'm004', 'm008']);
    expect(segments.map((segment) => segment.endId)).toEqual(['m003', 'm007', 'm011']);
  });

  it('names each segment from what the person actually asked in it', () => {
    const segments = segmenter.segment(THREE_TOPICS);
    expect(segments[0]?.title).toBe(
      'We need to hire a senior designer for the brand team this quart…',
    );
    expect(segments[1]?.title).toBe(
      'Separately, the Postgres migration keeps timing out on the even…',
    );
    expect(segments[2]?.title).toContain('newsletter');
  });

  it('gives each segment the terms that distinguish it from the others', () => {
    const segments = segmenter.segment(THREE_TOPICS);
    expect(segments[0]?.keywords).toContain('design');
    expect(segments[1]?.keywords).toContain('migr');
    expect(segments[2]?.keywords).toContain('newslett');
    expect(segments[0]?.keywords).not.toContain('newslett');
  });

  it('scores the first segment’s boundary at zero and later boundaries above it', () => {
    const segments = segmenter.segment(THREE_TOPICS);
    expect(segments[0]?.boundaryScore).toBe(0);
    expect(segments[1]?.boundaryScore).toBeGreaterThan(0);
    expect(segments[2]?.boundaryScore).toBeGreaterThan(0);
  });

  it('covers every message exactly once, contiguously', () => {
    const segments = segmenter.segment(THREE_TOPICS);
    expect(segments.reduce((sum, segment) => sum + segment.messageCount, 0)).toBe(
      THREE_TOPICS.length,
    );
    expect(segments[0]?.startedAt).toEqual(THREE_TOPICS[0]?.at);
    expect(segments.at(-1)?.endedAt).toEqual(THREE_TOPICS.at(-1)?.at);
  });

  it('keeps a single-topic conversation as one segment', () => {
    const single = conversation([
      ['user', 'How is the Postgres migration going?'],
      ['agent', 'The Postgres migration is halfway through the events table.'],
      ['user', 'Any lock contention on that migration?'],
      ['agent', 'No lock contention; the migration batches cleanly.'],
    ]);
    expect(segmenter.segment(single)).toHaveLength(1);
  });

  it('returns nothing for an empty conversation and one segment for a single message', () => {
    expect(segmenter.segment([])).toEqual([]);
    expect(segmenter.segment(conversation([['user', 'hello there friend']]))).toHaveLength(1);
  });

  it('names a wordless segment from its keywords rather than leaving it blank', () => {
    const wordless = conversation([
      ['agent', ''],
      ['agent', '   '],
    ]);
    expect(wordless.length).toBe(2);
    expect(segmenter.segment(wordless)[0]?.title).toBe('Untitled topic');
  });

  it('exposes the cohesion curve it segments from', () => {
    const scores = segmenter.cohesion(THREE_TOPICS);
    expect(scores).toHaveLength(THREE_TOPICS.length - 1);
    // The gap between hiring and the migration shares no vocabulary at all.
    expect(scores[3]).toBe(0);
    // The gap inside the hiring topic does.
    expect(scores[1] ?? 0).toBeGreaterThan(0);
  });

  it('respects a minimum segment size so a one-message aside cannot become a topic', () => {
    const strict = new LexicalCohesionSegmenter({ minSegmentSize: 6 });
    expect(strict.segment(THREE_TOPICS).length).toBeLessThan(3);
  });
});

describe('searchConversation', () => {
  it('returns every message containing an exact term and no message that does not', () => {
    const result = searchConversation(THREE_TOPICS, { text: 'newsletter' });
    const expected = THREE_TOPICS.filter((message) => /newsletter/i.test(message.text)).map(
      (message) => message.id,
    );
    expect(result.hits.map((hit) => hit.message.id).sort()).toEqual(expected.sort());
    expect(result.total).toBe(expected.length);
    expect(result.hits.every((hit) => hit.lexical)).toBe(true);
  });

  it('reports the matched span so the caller can highlight the term it searched for', () => {
    const result = searchConversation(THREE_TOPICS, { text: 'Postgres' });
    const hit = result.hits.find((candidate) => candidate.message.id === 'm004');
    expect(hit).toBeDefined();
    const span = hit?.highlights[0];
    expect(span).toBeDefined();
    expect(hit?.message.text.slice(span?.start ?? 0, span?.end ?? 0)).toBe('Postgres');
  });

  it('reports an empty result rather than a silent partial one when nothing matches', () => {
    const result = searchConversation(THREE_TOPICS, { text: 'kubernetes' });
    expect(result.hits).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.terms).toEqual(['kubernet']);
  });

  it('returns only messages inside an inclusive date range, both boundary days included', () => {
    const spread = conversation(
      [
        ['user', 'first day note about designers'],
        ['user', 'second day note about designers'],
        ['user', 'third day note about designers'],
      ],
      '2026-06-01T00:00:00.000Z',
    ).map((message, index) => ({
      ...message,
      at: new Date(Date.parse('2026-06-01T12:00:00.000Z') + index * 86_400_000),
    }));

    const result = searchConversation(spread, {
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-02T23:59:59.999Z'),
    });
    expect(result.hits.map((hit) => hit.message.id)).toEqual(['m001', 'm000']);
  });

  it('composes a term with a date range so results satisfy both', () => {
    const both = searchConversation(THREE_TOPICS, {
      text: 'migration',
      from: THREE_TOPICS[6]?.at,
    });
    expect(both.hits.map((hit) => hit.message.id)).toEqual(
      expect.arrayContaining(['m006', 'm007']),
    );
    expect(both.hits.map((hit) => hit.message.id)).not.toContain('m004');
  });

  it('restores the unfiltered set when the range is cleared', () => {
    const filtered = searchConversation(THREE_TOPICS, {
      text: 'migration',
      from: THREE_TOPICS[6]?.at,
    });
    const cleared = searchConversation(THREE_TOPICS, { text: 'migration' });
    expect(cleared.total).toBeGreaterThan(filtered.total);
  });

  it('reports semantic: false when no vectors were supplied, instead of implying meaning matching', () => {
    expect(searchConversation(THREE_TOPICS, { text: 'newsletter' }).semantic).toBe(false);
  });

  it('admits a vector-only match and marks it as not literal', () => {
    const target = THREE_TOPICS[8];
    expect(target).toBeDefined();
    const result = searchConversation(
      THREE_TOPICS,
      { text: 'postponed email blast' },
      {
        vectors: {
          query: [1, 0],
          byMessageId: new Map([[target?.id ?? '', [1, 0] as readonly number[]]]),
        },
      },
    );
    expect(result.semantic).toBe(true);
    const hit = result.hits[0];
    expect(hit?.message.id).toBe(target?.id);
    expect(hit?.lexical).toBe(false);
  });

  it('applies a limit without misreporting how many matched', () => {
    const result = searchConversation(THREE_TOPICS, { text: 'the' }, { limit: 2 });
    expect(result.hits.length).toBeLessThanOrEqual(2);
    expect(result.total).toBeGreaterThan(result.hits.length);
  });

  it('orders a date-only query newest first', () => {
    const result = searchConversation(THREE_TOPICS, {});
    expect(result.hits[0]?.message.id).toBe('m011');
    expect(result.hits.at(-1)?.message.id).toBe('m000');
  });
});

describe('matchSpans / withinRange / cosine', () => {
  it('matches whole words only, case-insensitively', () => {
    expect(matchSpans('Newsletter newsletters news', ['newsletter'])).toEqual([
      { start: 0, end: 10 },
    ]);
    expect(matchSpans('anything at all', [])).toEqual([]);
  });

  it('treats an absent bound as unbounded on that side', () => {
    const at = new Date('2026-06-05T00:00:00.000Z');
    expect(withinRange(at)).toBe(true);
    expect(withinRange(at, new Date('2026-06-06T00:00:00.000Z'))).toBe(false);
    expect(withinRange(at, undefined, new Date('2026-06-04T00:00:00.000Z'))).toBe(false);
  });
});

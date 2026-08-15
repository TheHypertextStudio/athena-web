import { describe, expect, it } from 'vitest';

import {
  LexicalCohesionSegmenter,
  searchConversation,
  stemWord,
  topicTerms,
  type ConversationMessage,
} from '../src/conversation';

function conversation(
  pairs: readonly (readonly [ConversationMessage['role'], string])[],
): ConversationMessage[] {
  const start = Date.parse('2026-06-01T09:00:00.000Z');
  return pairs.map(([role, text], index) => ({
    id: `m${String(index).padStart(3, '0')}`,
    role,
    text,
    at: new Date(start + index * 60_000),
  }));
}

const TOPICS = conversation([
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

describe('Athena conversation browsing', () => {
  it('derives stable topic boundaries, titles, and keywords without a model call', () => {
    const segments = new LexicalCohesionSegmenter().segment(TOPICS);

    expect(segments.map((segment) => segment.startId)).toEqual(['m000', 'm004', 'm008']);
    expect(segments.map((segment) => segment.keywords)).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['design']),
        expect.arrayContaining(['migr']),
      ]),
    );
    expect(segments.reduce((total, segment) => total + segment.messageCount, 0)).toBe(
      TOPICS.length,
    );
  });

  it('keeps lexical normalization conservative and highlights only literal matching messages', () => {
    expect(stemWord('stories')).toBe('story');
    expect(topicTerms('We are shipping the newsletters.')).toEqual(['ship', 'newslett']);

    const result = searchConversation(TOPICS, { text: 'newsletter' });
    expect(result.hits.map((hit) => hit.message.id).sort()).toEqual([
      'm008',
      'm009',
      'm010',
      'm011',
    ]);
    expect(result.hits.every((hit) => hit.lexical)).toBe(true);
  });

  it('composes date ranges with the search term and keeps a truthful semantic flag', () => {
    const result = searchConversation(TOPICS, { text: 'migration', from: TOPICS[6]?.at });

    expect(result.hits.map((hit) => hit.message.id)).toEqual(
      expect.arrayContaining(['m006', 'm007']),
    );
    expect(result.hits.map((hit) => hit.message.id)).not.toContain('m004');
    expect(result.semantic).toBe(false);
  });
});

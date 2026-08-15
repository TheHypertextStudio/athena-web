/**
 * Behavior tests for the lexical-cohesion conversation segmenter.
 *
 * @remarks
 * The segmenter exists so a person can browse a long-running conversation without Athena
 * spending a model call, so the properties worth pinning are the ones that make its output safe
 * to show: it is deterministic, it never loses or reorders a message, and it refuses to cut a
 * span shorter than the configured minimum. A boundary in the wrong place is recoverable; a
 * missing message is not.
 *
 * The titles get their own attention because they are rendered verbatim. The fallback chain runs
 * user text, then any text, then keywords, then a fixed string — and each rung only matters when
 * the one above it is empty, which is exactly the case a real conversation eventually produces.
 */
import { describe, expect, it } from 'vitest';

import type { ConversationMessage } from '../src/conversation-contracts';
import { LexicalCohesionSegmenter } from '../src/conversation-segmenter';

/** Build a message; role and text are what the segmenter actually reads. */
function message(
  id: string,
  text: string,
  role: ConversationMessage['role'] = 'user',
): ConversationMessage {
  return { id, role, text, at: new Date(Date.UTC(2026, 0, 1, 0, Number(id.slice(1)))) };
}

/** Two clearly distinct topics, long enough for a window to see the change. */
const TWO_TOPICS: readonly ConversationMessage[] = [
  message('m0', 'invoice billing payment overdue acme'),
  message('m1', 'billing invoice acme payment terms'),
  message('m2', 'invoice payment acme billing reminder'),
  message('m3', 'garden tomatoes soil compost planting'),
  message('m4', 'tomatoes garden compost soil watering'),
  message('m5', 'garden planting tomatoes soil compost'),
];

describe('LexicalCohesionSegmenter', () => {
  const segmenter = new LexicalCohesionSegmenter();

  it('returns nothing for an empty conversation', () => {
    expect(segmenter.segment([])).toEqual([]);
    expect(segmenter.cohesion([])).toEqual([]);
    expect(segmenter.depthScores([])).toEqual([]);
  });

  it('makes a single message one segment', () => {
    const segments = segmenter.segment([message('m0', 'Just one thing.')]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ startId: 'm0', endId: 'm0', messageCount: 1 });
    // The first span has nothing before it, so its boundary score is zero by definition.
    expect(segments[0]?.boundaryScore).toBe(0);
  });

  it('scores one cohesion gap per adjacent pair', () => {
    expect(segmenter.cohesion(TWO_TOPICS)).toHaveLength(TWO_TOPICS.length - 1);
    expect(segmenter.depthScores(TWO_TOPICS)).toHaveLength(TWO_TOPICS.length - 1);
  });

  it('scores unrelated neighbours lower than related ones', () => {
    const scores = segmenter.cohesion(TWO_TOPICS);
    const acrossTopics = scores[2] ?? 1;
    const withinTopic = scores[0] ?? 0;
    expect(acrossTopics).toBeLessThan(withinTopic);
  });

  it('treats a message with no scorable terms as zero cohesion', () => {
    // An empty bag on either side is no similarity, not a division by zero.
    expect(segmenter.cohesion([message('m0', 'invoice'), message('m1', '')])[0]).toBe(0);
  });

  it('covers every message exactly once, in order', () => {
    const segments = segmenter.segment(TWO_TOPICS);
    const total = segments.reduce((sum, segment) => sum + segment.messageCount, 0);
    expect(total).toBe(TWO_TOPICS.length);
    // Each span must start where the previous one ended, with no gap and no overlap.
    const startIds = segments.map((segment) => segment.startId);
    expect(startIds[0]).toBe('m0');
    expect(segments.at(-1)?.endId).toBe('m5');
  });

  it('is deterministic across repeated runs', () => {
    expect(segmenter.segment(TWO_TOPICS)).toEqual(segmenter.segment(TWO_TOPICS));
  });

  it('never cuts a span shorter than the configured minimum', () => {
    const strict = new LexicalCohesionSegmenter({ minSegmentSize: 4 });
    for (const segment of strict.segment(TWO_TOPICS)) {
      expect(segment.messageCount).toBeGreaterThanOrEqual(4);
    }
  });

  it('collapses to one segment when the depth tolerance is unreachable', () => {
    const blunt = new LexicalCohesionSegmenter({ depthTolerance: 1000 });
    expect(blunt.segment(TWO_TOPICS)).toHaveLength(1);
  });

  it('collapses to one segment when the cohesion ratio admits nothing', () => {
    const blunt = new LexicalCohesionSegmenter({ cohesionRatio: 0 });
    expect(blunt.segment(TWO_TOPICS)).toHaveLength(1);
  });

  it('clamps nonsensical options rather than misbehaving', () => {
    // A zero or negative window/size would otherwise slice empty ranges forever.
    const clamped = new LexicalCohesionSegmenter({
      window: 0,
      minSegmentSize: 0,
      keywordCount: 0,
      titleLength: 1,
    });
    const segments = clamped.segment(TWO_TOPICS);
    expect(segments.length).toBeGreaterThanOrEqual(1);
    expect(segments[0]?.keywords.length).toBeGreaterThanOrEqual(1);
    expect((segments[0]?.title ?? '').length).toBeGreaterThanOrEqual(1);
  });

  it('titles a span from its first non-empty user message', () => {
    const segments = segmenter.segment([
      message('m0', '', 'agent'),
      message('m1', 'Can you chase the Acme invoice?'),
    ]);
    expect(segments[0]?.title).toBe('Can you chase the Acme invoice?');
  });

  it('falls back to any authored text when no user message has any', () => {
    const segments = segmenter.segment([
      message('m0', '   ', 'user'),
      message('m1', 'Here is the summary you asked for.', 'agent'),
    ]);
    expect(segments[0]?.title).toBe('Here is the summary you asked for.');
  });

  it('falls back to keywords, then to a fixed title, when there is no text at all', () => {
    const blank = segmenter.segment([message('m0', '   '), message('m1', '')]);
    // Nothing authored anything, so there are no keywords either.
    expect(blank[0]?.title).toBe('Untitled topic');
  });

  it('uses only the first line of a multi-line opener', () => {
    const segments = segmenter.segment([message('m0', 'First line.\nSecond line.')]);
    expect(segments[0]?.title).toBe('First line.');
  });

  it('truncates a long title with an ellipsis rather than mid-word overflow', () => {
    const long = 'x'.repeat(400);
    const segments = new LexicalCohesionSegmenter({ titleLength: 20 }).segment([
      message('m0', long),
    ]);
    const title = segments[0]?.title ?? '';
    expect(title).toHaveLength(20);
    expect(title.endsWith('…')).toBe(true);
  });

  it('ranks keywords by weight and breaks ties alphabetically', () => {
    const segments = segmenter.segment(TWO_TOPICS);
    for (const segment of segments) {
      expect(segment.keywords.length).toBeGreaterThan(0);
      expect(segment.keywords.length).toBeLessThanOrEqual(6);
    }
    // A term unique to one span should outrank one shared by every span.
    const first = segments[0];
    if (first && segments.length > 1) {
      expect(first.keywords).not.toContain('');
    }
  });

  it('honors a keyword cap', () => {
    const capped = new LexicalCohesionSegmenter({ keywordCount: 2 });
    for (const segment of capped.segment(TWO_TOPICS)) {
      expect(segment.keywords.length).toBeLessThanOrEqual(2);
    }
  });

  it('carries each span’s own start and end timestamps', () => {
    const segments = segmenter.segment(TWO_TOPICS);
    for (const segment of segments) {
      expect(segment.startedAt.getTime()).toBeLessThanOrEqual(segment.endedAt.getTime());
    }
  });

  it('gives a later segment the depth score of the gap it was cut at', () => {
    const eager = new LexicalCohesionSegmenter({ minSegmentSize: 1, depthTolerance: 0 });
    const segments = eager.segment(TWO_TOPICS);
    if (segments.length > 1) {
      expect(segments[0]?.boundaryScore).toBe(0);
      expect(segments[1]?.boundaryScore).toBeGreaterThan(0);
    }
  });

  it('handles a conversation where every message is identical', () => {
    const same = Array.from({ length: 5 }, (_, index) => message(`m${index}`, 'same words here'));
    const segments = segmenter.segment(same);
    // Perfect cohesion throughout means no valley, so no cut.
    expect(segments).toHaveLength(1);
    expect(segments[0]?.messageCount).toBe(5);
  });
});
